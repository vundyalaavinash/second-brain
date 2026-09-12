"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ContainerKind } from "@/db/enums";

export function NewContainerForm({ kind }: { kind: ContainerKind }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/containers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, name: name.trim() }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
      setName("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex items-center gap-2"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`New ${kind}`}
        className="h-8 flex-1 max-w-sm bg-surface-1 border border-line rounded-md px-3 text-[13px] outline-none focus:border-accent"
      />
      <button type="submit" disabled={!name.trim() || busy} className="h-8 px-3 rounded-md text-[12px] font-medium bg-accent text-bg disabled:opacity-40">
        Add
      </button>
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </form>
  );
}
