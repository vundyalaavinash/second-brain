import type Database from "better-sqlite3";
import { EMBEDDING_DIMENSIONS } from "@/providers/embed/types";

export const SEARCH_TABLES_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, content='chunks', content_rowid='id');

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(embedding float[${EMBEDDING_DIMENSIONS}] distance_metric=cosine);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  DELETE FROM chunks_vec WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
`;

export function ensureSearchTables(sqlite: Database.Database): void {
  sqlite.exec(SEARCH_TABLES_SQL);
}
