import type { DB } from "@/db/client";

export function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

/** Replace the vectors for the given chunk ids. Rowids must be bound as BigInt for sqlite-vec. */
export function upsertChunkVectors(db: DB, rows: { chunkId: number; vector: Float32Array }[]): void {
  if (rows.length === 0) return;
  const del = db.$client.prepare("DELETE FROM chunks_vec WHERE rowid = ?");
  const ins = db.$client.prepare("INSERT INTO chunks_vec(rowid, embedding) VALUES (?, ?)");
  const run = db.$client.transaction((batch: typeof rows) => {
    for (const r of batch) {
      del.run(BigInt(r.chunkId));
      ins.run(BigInt(r.chunkId), toBlob(r.vector));
    }
  });
  run(rows);
}

export function countChunkVectors(db: DB): number {
  const row = db.$client.prepare("SELECT count(*) AS c FROM chunks_vec").get() as { c: number };
  return row.c;
}
