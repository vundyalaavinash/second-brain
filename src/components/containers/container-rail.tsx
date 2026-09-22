"use client";

import { Link2 } from "lucide-react";
import type { ContainerDTO } from "@/lib/dto";
import { formatDate, titleCase } from "@/lib/format";
import { Chip } from "../ui";
import { Rail, RailRow, RailSection } from "../shell/rail";
import { KIND_LABEL } from "../type-icon";

/** The container page's context column: what this container is, and the links pinned to it. */
export function ContainerRail({ container, taskCount, itemCount }: { container: ContainerDTO; taskCount: number; itemCount: number }) {
  const { open, done } = container.progress;
  return (
    <Rail>
      <RailSection label="Details">
        <div className="flex flex-col gap-2">
          <RailRow label="Kind">{KIND_LABEL[container.kind]}</RailRow>
          {container.kind === "project" && (
            <RailRow label="Deadline">
              {container.deadline ? <span className="font-mono">{formatDate(`${container.deadline}T00:00:00`)}</span> : <span className="text-fg-faint">None set</span>}
            </RailRow>
          )}
          {container.kind === "resource" && <RailRow label="Category">{titleCase(container.category ?? "other")}</RailRow>}
          <RailRow label="Status">{titleCase(container.status)}</RailRow>
          <RailRow label="Items">
            <span className="font-mono">{itemCount}</span>
          </RailRow>
          <RailRow label="Tasks">
            {taskCount === 0 ? (
              <span className="text-fg-faint">None yet</span>
            ) : (
              <span>
                <span className="font-mono">{open}</span> open, <span className="font-mono">{done}</span> done
              </span>
            )}
          </RailRow>
        </div>
      </RailSection>

      <RailSection label="Pinned links" count={container.pinnedLinks.length}>
        {container.pinnedLinks.length === 0 ? (
          <p className="text-[13px] text-fg-faint">None pinned</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {container.pinnedLinks.map((link) => (
              <Chip key={link.id} href={`/items/${link.id}`} icon={Link2} title={link.title}>
                {link.domain}
              </Chip>
            ))}
          </div>
        )}
      </RailSection>
    </Rail>
  );
}
