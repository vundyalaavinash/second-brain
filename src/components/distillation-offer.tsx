"use client";

import type { Distillation } from "@/domain/distill";
import { Button, Chip } from "./ui";

interface Props {
  distillation: Distillation | undefined;
  onKeep: () => void;
  onDismiss: () => void;
}

/** The one thing this app is careful never to do: a distillation offer never touches the item's
 * own text. Keep and Not-useful are the whole interaction -- no per-quote picking, since the note
 * was never at risk from either choice. Renders nothing once dismissed (a "not now" the sweep
 * never re-offers) and nothing at all before a distillation exists. */
export function DistillationOffer({ distillation, onKeep, onDismiss }: Props) {
  if (!distillation || distillation.status === "dismissed") return null;

  return (
    <section className="pane p-3 flex flex-col gap-3" aria-label="Distillation">
      <p className="text-[13.5px] text-fg m-0">{distillation.gist}</p>
      <div className="flex flex-wrap gap-1.5">
        {distillation.quotes.map((q, i) => (
          <Chip key={i} as="span" className="max-w-[40ch] truncate" title={q}>
            {q}
          </Chip>
        ))}
      </div>
      {distillation.status === "pending" && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onKeep}>
            Keep
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Not useful
          </Button>
        </div>
      )}
    </section>
  );
}
