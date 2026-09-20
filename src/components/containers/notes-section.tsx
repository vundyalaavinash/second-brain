"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import type { ItemDTO } from "@/lib/dto";
import { relativeTime } from "@/lib/format";
import { Button, List, Row, SectionHeading } from "../ui";

const JSON_HEADERS = { "content-type": "application/json" };

// Leading list/heading/quote markers ("# ", "- ", "* ", "> ", any run of them).
const LEADING_MARKERS = /^[#*>\-\s]+/;
// A task checkbox ("[ ]", "[x]", "[X]") or a callout tag ("[!note]", "[!tip]", "[!warning]"),
// optionally backslash-escaped on either bracket (the rich editor escapes brackets in markdown).
const TASK_OR_CALLOUT_MARKER = /^\\?\[(?:[ xX]|!\w+)\\?\]\\?\s*/;

function stripMarkers(line: string): string {
  return line.replace(LEADING_MARKERS, "").replace(TASK_OR_CALLOUT_MARKER, "").trim();
}

/** The first non-empty line of `body`, markers stripped, that isn't just a repeat of `title`
 * (case-insensitive, trimmed) — so a heading matching the item's own title doesn't show twice. */
export function previewOf(body: string, title: string = ""): string {
  const normalizedTitle = title.trim().toLowerCase();
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (const line of lines) {
    const stripped = stripMarkers(line);
    if (!stripped || stripped.toLowerCase() === normalizedTitle) continue;
    return stripped;
  }
  return "";
}

function byUpdated(a: ItemDTO, b: ItemDTO): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

export function NotesSection({
  containerId,
  initial,
  readOnly = false,
}: {
  containerId: number;
  initial: ItemDTO[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function addNote() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: "note", title: "Untitled note", body: "", containerId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not create the note");
        return;
      }
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
        {!readOnly && (
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => void addNote()}>
            New note
          </Button>
        )}
      </div>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
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
              <span className="flex-1 truncate text-[12px] text-fg-faint">{previewOf(item.body, item.title)}</span>
              <span className="font-mono text-[11px] text-fg-faint shrink-0">{relativeTime(item.updatedAt)}</span>
            </Row>
          ))}
        </List>
      )}
    </section>
  );
}
