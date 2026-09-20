"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Link2, Plus, Star } from "lucide-react";
import type { ItemDTO } from "@/lib/dto";
import { isProbablyUrl } from "@/lib/text";
import { Button, IconButton, Input, List, Row, SectionHeading } from "../ui";

const JSON_HEADERS = { "content-type": "application/json" };

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function bySort(a: ItemDTO, b: ItemDTO): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export function LinksSection({ containerId, initial }: { containerId: number; initial: ItemDTO[] }) {
  const [links, setLinks] = useState<ItemDTO[]>(initial);
  const [url, setUrl] = useState("");
  const [duplicateId, setDuplicateId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  async function addLink() {
    const value = url.trim();
    if (!value || !isProbablyUrl(value)) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setDuplicateId(null);
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: "link", url: value, containerId }),
      });
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { existingId?: number };
        setDuplicateId(body.existingId ?? null);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not add link");
        return;
      }
      const item = (await res.json()) as ItemDTO;
      setLinks((prev) => [item, ...prev]);
      setUrl("");
    } finally {
      submittingRef.current = false;
    }
  }

  function toggleStar(item: ItemDTO) {
    const pinned = !item.pinned;
    const prev = links;
    setLinks((ls) => ls.map((l) => (l.id === item.id ? { ...l, pinned } : l)));
    void (async () => {
      const res = await fetch(`/api/items/${item.id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ pinned }) });
      if (!res.ok) {
        setLinks(prev);
        setError("Could not save that change");
      }
    })();
  }

  const sorted = [...links].sort(bySort);

  return (
    <section className="flex flex-col gap-2">
      <SectionHeading count={links.length}>Links</SectionHeading>
      <div className="flex items-center gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void addLink();
            }
          }}
          placeholder="Paste a link"
          aria-label="Paste a link"
          size="sm"
        />
        <Button variant="primary" size="sm" icon={Plus} onClick={() => void addLink()}>
          Add link
        </Button>
      </div>
      {duplicateId !== null && (
        <p className="text-[12.5px] text-fg-muted">
          Already captured.{" "}
          <Link href={`/items/${duplicateId}`} className="focus-ring text-accent hover:underline">
            View it
          </Link>
        </p>
      )}
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      {sorted.length === 0 ? (
        <p className="text-[13px] text-fg-faint">No links yet. Paste one above.</p>
      ) : (
        <List>
          {sorted.map((item) => (
            <Row key={item.id}>
              <Link2 className="w-4 h-4 text-fg-muted shrink-0" aria-hidden />
              <Link href={`/items/${item.id}`} className="focus-ring flex-1 truncate text-[13.5px] hover:text-accent">
                {item.title}
              </Link>
              <span className="font-mono text-[11px] text-fg-faint shrink-0">{domainOf(item.sourceUrl ?? "")}</span>
              <IconButton
                label={item.pinned ? "Unstar" : "Star"}
                icon={Star}
                active={item.pinned}
                aria-pressed={item.pinned}
                onClick={() => toggleStar(item)}
              />
            </Row>
          ))}
        </List>
      )}
    </section>
  );
}
