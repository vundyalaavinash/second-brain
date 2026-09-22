"use client";

import { Inbox as InboxIcon } from "lucide-react";
import type { ItemDTO } from "@/lib/dto";
import { formatDate } from "@/lib/format";
import { headings } from "@/lib/headings";
import { domainOf } from "@/lib/text";
import { Chip } from "../ui";
import { Rail, RailRow, RailSection } from "../shell/rail";
import { KIND_ICON, StatusDot, TYPE_LABEL, TypeIcon } from "../type-icon";

// Nesting is shown by indent alone: the outline is a flat list of jump targets, not a tree.
const INDENT: Record<1 | 2 | 3, string> = { 1: "pl-0", 2: "pl-3", 3: "pl-6" };

/** The item page's context column: an outline of the body, the item's details, and its tags. */
export function ItemRail({
  item,
  body,
  onScrollTo,
  onMove,
}: {
  item: ItemDTO;
  body: string;
  onScrollTo: (text: string) => void;
  onMove: () => void;
}) {
  const outline = headings(body);
  const domain = item.sourceUrl ? domainOf(item.sourceUrl) : "";
  return (
    <Rail>
      <RailSection label="Outline" count={outline.length}>
        {outline.length === 0 ? (
          <p className="text-[13px] text-fg-faint">No headings yet</p>
        ) : (
          <ul role="list" className="list-none m-0 p-0 flex flex-col">
            {outline.map((h, i) => (
              <li key={`${i}-${h.text}`}>
                <button
                  type="button"
                  onClick={() => onScrollTo(h.text)}
                  className={`focus-ring block w-full rounded-sm py-1 text-left truncate text-[13px] text-fg-muted hover:text-fg ${INDENT[h.level]}`}
                >
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </RailSection>

      <RailSection label="Details">
        <div className="flex flex-col gap-2">
          <RailRow label="Type">
            <span className="inline-flex items-center gap-1.5">
              <TypeIcon type={item.type} className="w-3.5 h-3.5 text-fg-muted shrink-0" />
              {TYPE_LABEL[item.type]}
            </span>
          </RailRow>
          <RailRow label="Status">
            <StatusDot status={item.status} error={item.error} />
          </RailRow>
          <RailRow label="Home">
            <Chip icon={item.container ? KIND_ICON[item.container.kind] : InboxIcon} onClick={onMove}>
              {item.container ? item.container.name : "Inbox"}
            </Chip>
          </RailRow>
          {domain && (
            <RailRow label="Source">
              <a href={item.sourceUrl!} target="_blank" rel="noreferrer" className="focus-ring rounded-sm text-violet-bright underline underline-offset-[3px]">
                {domain}
              </a>
            </RailRow>
          )}
          <RailRow label="Created">
            <span className="font-mono">{formatDate(item.createdAt)}</span>
          </RailRow>
          <RailRow label="Updated">
            <span className="font-mono">{formatDate(item.updatedAt)}</span>
          </RailRow>
          <RailRow label="Id">
            <span className="font-mono">#{item.id}</span>
          </RailRow>
        </div>
      </RailSection>

      <RailSection label="Tags" count={item.tags.length}>
        {item.tags.length === 0 ? (
          <p className="text-[13px] text-fg-faint">No tags</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <Chip key={tag} href={`/search?tag=${encodeURIComponent(tag)}`}>
                {tag}
              </Chip>
            ))}
          </div>
        )}
      </RailSection>
    </Rail>
  );
}
