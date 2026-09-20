"use client";

import { useState } from "react";
import { Archive, Layers, BookMarked, Inbox } from "lucide-react";
import type { ContainerDTO } from "@/lib/dto";
import { Button } from "./ui";
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
      <div className="frost w-[480px] max-w-[92vw] rounded-lg p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[16px] font-medium">Complete “{container.name}”</h2>
        <p className="text-[13px] text-fg-muted">Archiving this project. Its {container.itemCount} items can:</p>
        <Button variant="secondary" icon={Archive} disabled={busy} onClick={() => void archive()} className="w-full justify-start h-9">
          Archive them with it (open tasks are dropped)
        </Button>
        <Button variant="secondary" icon={Layers} disabled={busy} onClick={() => setPicker("area")} className="w-full justify-start h-9">
          Move them to an area
        </Button>
        <Button variant="secondary" icon={BookMarked} disabled={busy} onClick={() => setPicker("resource")} className="w-full justify-start h-9">
          Move them to a resource
        </Button>
        <Button variant="secondary" icon={Inbox} disabled={busy} onClick={() => void archive(null)} className="w-full justify-start h-9">
          Send them back to the Inbox
        </Button>
        {error && <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        <Button variant="ghost" size="sm" onClick={onClose} className="self-end">
          Cancel
        </Button>
      </div>
    </div>
  );
}
