"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "./ui";

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
    <Button variant="secondary" size="sm" icon={RotateCcw} onClick={() => void restore()} disabled={busy}>
      Restore
    </Button>
  );
}
