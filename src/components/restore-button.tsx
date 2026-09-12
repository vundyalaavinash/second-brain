"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RestoreButton({ kind, id }: { kind: "container" | "item"; id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function restore() {
    setBusy(true);
    try {
      const res =
        kind === "container"
          ? await fetch(`/api/containers/${id}/restore`, { method: "POST" })
          : await fetch(`/api/items/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: false }) });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button onClick={() => void restore()} disabled={busy} className="h-6 px-2 rounded-sm font-mono text-[10px] uppercase tracking-wider border border-line hover:border-accent hover:text-accent disabled:opacity-40">
      restore
    </button>
  );
}
