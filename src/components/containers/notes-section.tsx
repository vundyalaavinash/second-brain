"use client";

import { useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import type { ItemDTO } from "@/lib/dto";
import { relativeTime } from "@/lib/format";
import { Button, List, Row, SectionHeading } from "../ui";

const JSON_HEADERS = { "content-type": "application/json" };

function preview(body: string): string {
  const line = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ? line.replace(/^[#*>\-\s]+/, "") : "";
}

function byUpdated(a: ItemDTO, b: ItemDTO): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

export function NotesSection({ containerId, initial }: { containerId: number; initial: ItemDTO[] }) {
  const router = useRouter();
  const submittingRef = useRef(false);

  async function addNote() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: "note", title: "Untitled note", body: "", containerId }),
      });
      if (!res.ok) return;
      const item = (await res.json()) as ItemDTO;
      router.push(`/items/${item.id}`);
    } finally {
      submittingRef.current = false;
    }
  }

  const sorted = [...initial].sort(byUpdated);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <SectionHeading count={initial.length}>Notes</SectionHeading>
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => void addNote()}>
          New note
        </Button>
      </div>
      {sorted.length === 0 ? (
        <p className="text-[13px] text-fg-faint">No notes yet.</p>
      ) : (
        <List>
          {sorted.map((item) => (
            <Row key={item.id}>
              <FileText className="w-4 h-4 text-fg-muted shrink-0" aria-hidden />
              <Link href={`/items/${item.id}`} className="focus-ring shrink-0 max-w-[45%] truncate text-[13.5px] hover:text-accent">
                {item.title}
              </Link>
              <span className="flex-1 truncate text-[12px] text-fg-faint">{preview(item.body)}</span>
              <span className="font-mono text-[11px] text-fg-faint shrink-0">{relativeTime(item.updatedAt)}</span>
            </Row>
          ))}
        </List>
      )}
    </section>
  );
}
