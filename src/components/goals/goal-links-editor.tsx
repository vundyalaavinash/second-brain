"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import type { ContainerKind } from "@/db/enums";
import type { GoalDetailDTO } from "@/lib/dto";
import { Button, IconButton, List, Row } from "../ui";
import { KindIcon } from "../type-icon";
import { ContainerPicker } from "../container-picker";

type GoalLink = GoalDetailDTO["links"][number];

interface Props {
  goalId: number;
  links: GoalLink[];
  /** Handed the whole refreshed detail: linking a container moves the goal's own measure too,
   * not only its list of links. */
  onChange: (goal: GoalDetailDTO) => void;
}

/**
 * Which projects and areas a goal's progress is drawn from. Every edit PUTs the whole set
 * (setGoalLinks replaces it in one transaction), then reads the goal back for the refreshed
 * per-link progress and tells anything else watching this goal to catch up.
 */
export function GoalLinksEditor({ goalId, links, onChange }: Props) {
  const [picker, setPicker] = useState<ContainerKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function put(containerIds: number[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/goals/${goalId}/links`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ containerIds }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
      const detailRes = await fetch(`/api/goals/${goalId}`);
      // The write already landed; a failed re-read must say so rather than leave the list
      // showing the pre-edit set as if nothing happened.
      if (!detailRes.ok) throw new Error("Saved, but could not refresh the list. Reload to see the change.");
      onChange((await detailRes.json()) as GoalDetailDTO);
      window.dispatchEvent(new Event("sb:goals-changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function remove(containerId: number) {
    void put(links.filter((l) => l.container.id !== containerId).map((l) => l.container.id));
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-fg">Where the work is</h2>
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" size="sm" icon={Plus} disabled={busy} onClick={() => setPicker("project")}>
            Project
          </Button>
          <Button variant="secondary" size="sm" icon={Plus} disabled={busy} onClick={() => setPicker("area")}>
            Area
          </Button>
        </div>
      </div>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      {links.length === 0 ? (
        <p className="text-[13px] text-fg-faint">Nothing linked yet. A goal&rsquo;s progress comes from the projects and areas serving it.</p>
      ) : (
        <List>
          {links.map(({ container, progress }) => (
            <Row key={container.id}>
              <KindIcon kind={container.kind} />
              <Link href={`/c/${container.slug}`} className="focus-ring flex-1 truncate text-[13.5px] hover:text-violet-bright">
                {container.name}
              </Link>
              <span className="font-mono text-[11px] text-fg-faint">{progress.percent}%</span>
              <IconButton label={`Unlink ${container.name}`} icon={X} disabled={busy} onClick={() => remove(container.id)} />
            </Row>
          ))}
        </List>
      )}
      {picker && (
        <ContainerPicker
          kind={picker}
          title={`Link ${picker}`}
          onClose={() => setPicker(null)}
          onPick={(c) => {
            setPicker(null);
            if (c && !links.some((l) => l.container.id === c.id)) void put([...links.map((l) => l.container.id), c.id]);
          }}
        />
      )}
    </section>
  );
}
