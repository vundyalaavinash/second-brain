"use client";

import { useState } from "react";
import type { ContainerDTO } from "@/lib/dto";
import { ContainerPicker } from "./container-picker";

interface Props {
  container: ContainerDTO;
  onDone: () => void;
  onClose: () => void;
}

/** Archive a project; its items either go with it or move to an area or resource. */
export function CompleteProjectDialog({ container, onDone, onClose }: Props) {
  const [picker, setPicker] = useState<"area" | "resource" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive(moveItemsTo?: number | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/containers/${container.id}/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(moveItemsTo === undefined ? {} : { moveItemsTo }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (picker) {
    return (
      <ContainerPicker
        kind={picker}
        title={`Move ${container.itemCount} items to ${picker}`}
        onClose={() => setPicker(null)}
        onPick={(c) => {
          setPicker(null);
          if (c) void archive(c.id);
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="w-[480px] max-w-[92vw] bg-surface-2 border border-line-strong rounded-lg shadow-2xl p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-medium">Complete “{container.name}”</h2>
        <p className="text-[13px] text-fg-muted">
          The project is archived. What happens to its {container.itemCount} items?
        </p>
        <button disabled={busy} onClick={() => void archive()} className="h-9 rounded-md border border-line hover:border-line-strong text-[13px] text-left px-3">
          Archive them with the project
        </button>
        <button disabled={busy} onClick={() => setPicker("area")} className="h-9 rounded-md border border-line hover:border-line-strong text-[13px] text-left px-3">
          Move them to an area
        </button>
        <button disabled={busy} onClick={() => setPicker("resource")} className="h-9 rounded-md border border-line hover:border-line-strong text-[13px] text-left px-3">
          Move them to a resource
        </button>
        <button disabled={busy} onClick={() => void archive(null)} className="h-9 rounded-md border border-line hover:border-line-strong text-[13px] text-left px-3">
          Send them back to the Inbox
        </button>
        {error && <div className="text-[12px] text-danger">{error}</div>}
        <button onClick={onClose} className="self-end text-[12px] text-fg-muted hover:text-fg">
          Cancel
        </button>
      </div>
    </div>
  );
}
