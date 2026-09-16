"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Trash2, X } from "lucide-react";
import { Button, Chip, Input, List, Row, SectionHeading, Select, IconButton } from "../ui";
import type { ActivityCategoryDTO, ActivityExclusionDTO, ActivityRuleDTO } from "@/lib/dto";

const JSON_HEADERS = { "content-type": "application/json" };

const RULE_KIND_LABEL: Record<ActivityRuleDTO["matchKind"], string> = {
  app: "App",
  domain: "Domain",
  title_contains: "Title contains",
};

const EXCLUSION_KIND_LABEL: Record<ActivityExclusionDTO["kind"], string> = {
  app: "App",
  domain: "Domain",
};

interface Props {
  retentionDays: number;
  onClose: () => void;
  reload: () => void;
}

export function RulesDrawer({ retentionDays, onClose, reload }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [rules, setRules] = useState<ActivityRuleDTO[]>([]);
  const [exclusions, setExclusions] = useState<ActivityExclusionDTO[]>([]);
  const [categories, setCategories] = useState<ActivityCategoryDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [newRuleKind, setNewRuleKind] = useState<ActivityRuleDTO["matchKind"]>("app");
  const [newRulePattern, setNewRulePattern] = useState("");
  const [newRuleCategoryId, setNewRuleCategoryId] = useState<number | "">("");

  const [newExclusionKind, setNewExclusionKind] = useState<ActivityExclusionDTO["kind"]>("app");
  const [newExclusionPattern, setNewExclusionPattern] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const [rulesRes, exclusionsRes, categoriesRes] = await Promise.all([
          fetch("/api/activity/rules", { cache: "no-store" }),
          fetch("/api/activity/exclusions", { cache: "no-store" }),
          fetch("/api/activity/categories", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (rulesRes.ok) setRules(await rulesRes.json());
        if (exclusionsRes.ok) setExclusions(await exclusionsRes.json());
        if (categoriesRes.ok) setCategories(await categoriesRes.json());
        if (!rulesRes.ok || !exclusionsRes.ok || !categoriesRes.ok) setError("Could not load some activity settings.");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("button, input, select, textarea")?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function loadRules() {
    const res = await fetch("/api/activity/rules", { cache: "no-store" });
    if (res.ok) setRules(await res.json());
  }

  async function loadExclusions() {
    const res = await fetch("/api/activity/exclusions", { cache: "no-store" });
    if (res.ok) setExclusions(await res.json());
  }

  async function loadCategories() {
    const res = await fetch("/api/activity/categories", { cache: "no-store" });
    if (res.ok) setCategories(await res.json());
  }

  async function mutate(run: () => Promise<Response>, refetch?: () => Promise<void>) {
    setError(null);
    try {
      const res = await run();
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? res.statusText);
        return;
      }
      if (refetch) await refetch();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const ruleCategoryValue: number | "" = newRuleCategoryId !== "" ? newRuleCategoryId : (categories[0]?.id ?? "");

  async function addRule() {
    const pattern = newRulePattern.trim();
    if (!pattern || ruleCategoryValue === "") return;
    await mutate(
      () =>
        fetch("/api/activity/rules", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ matchKind: newRuleKind, pattern, categoryId: Number(ruleCategoryValue) }),
        }),
      async () => {
        await loadRules();
        setNewRulePattern("");
      },
    );
  }

  async function changeRuleCategory(id: number, categoryId: number) {
    await mutate(
      () => fetch(`/api/activity/rules/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ categoryId }) }),
      loadRules,
    );
  }

  async function moveRule(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= rules.length) return;
    const ids = rules.map((r) => r.id);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await mutate(
      () => fetch("/api/activity/rules/reorder", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ ids }) }),
      loadRules,
    );
  }

  async function deleteRule(id: number) {
    await mutate(() => fetch(`/api/activity/rules/${id}`, { method: "DELETE" }), loadRules);
  }

  async function addExclusion() {
    const pattern = newExclusionPattern.trim();
    if (!pattern) return;
    await mutate(
      () =>
        fetch("/api/activity/exclusions", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ kind: newExclusionKind, pattern }),
        }),
      async () => {
        await loadExclusions();
        setNewExclusionPattern("");
      },
    );
  }

  async function removeExclusion(id: number) {
    await mutate(() => fetch(`/api/activity/exclusions/${id}`, { method: "DELETE" }), loadExclusions);
  }

  async function updateCategoryName(id: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    await mutate(
      () => fetch(`/api/activity/categories/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ name: trimmed }) }),
      loadCategories,
    );
  }

  async function updateCategoryColor(id: number, color: string) {
    await mutate(
      () => fetch(`/api/activity/categories/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ color }) }),
      loadCategories,
    );
  }

  async function updateRetention(value: number) {
    if (!Number.isInteger(value) || value < 1 || value > 3650) return;
    await mutate(() => fetch("/api/activity/pause", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ retentionDays: value }) }));
  }

  return (
    <>
      <button type="button" aria-label="Close rules" onClick={onClose} className="focus-ring fixed inset-0 bg-black/40" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Activity rules" className="fixed inset-y-0 right-0 w-[420px] frost p-5 overflow-y-auto z-50">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-medium">Activity rules</h2>
          <IconButton label="Close" icon={X} onClick={onClose} />
        </div>

        {error && <p className="text-[13px] text-danger mb-3">{error}</p>}

        <section className="mb-6">
          <SectionHeading count={rules.length}>Rules</SectionHeading>
          {rules.length === 0 ? (
            <p className="text-fg-faint text-[13px] mb-3">No rules yet.</p>
          ) : (
            <List>
              {rules.map((rule, i) => (
                <Row key={rule.id}>
                  <Chip as="span">{RULE_KIND_LABEL[rule.matchKind]}</Chip>
                  <span className="flex-1 min-w-0 truncate font-mono text-[12px]">{rule.pattern}</span>
                  <div className="w-40 shrink-0">
                    <Select
                      size="sm"
                      className="w-full"
                      value={rule.categoryId}
                      onChange={(e) => void changeRuleCategory(rule.id, Number(e.target.value))}
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <IconButton label="Move up" icon={ArrowUp} disabled={i === 0} onClick={() => void moveRule(i, -1)} />
                  <IconButton label="Move down" icon={ArrowDown} disabled={i === rules.length - 1} onClick={() => void moveRule(i, 1)} />
                  <IconButton label="Delete rule" icon={Trash2} danger onClick={() => void deleteRule(rule.id)} />
                </Row>
              ))}
            </List>
          )}
          <div className="flex items-center gap-2 mt-3">
            <div className="w-40 shrink-0">
              <Select size="sm" className="w-full" value={newRuleKind} onChange={(e) => setNewRuleKind(e.target.value as ActivityRuleDTO["matchKind"])}>
                <option value="app">App</option>
                <option value="domain">Domain</option>
                <option value="title_contains">Title contains</option>
              </Select>
            </div>
            <Input
              size="sm"
              className="flex-1 min-w-0"
              placeholder="Bundle id, domain, or words in the title"
              value={newRulePattern}
              onChange={(e) => setNewRulePattern(e.target.value)}
            />
            <div className="w-40 shrink-0">
              <Select size="sm" className="w-full" value={ruleCategoryValue} onChange={(e) => setNewRuleCategoryId(Number(e.target.value))}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="primary" size="sm" onClick={() => void addRule()}>
              Add rule
            </Button>
          </div>
        </section>

        <section className="mb-6">
          <SectionHeading count={exclusions.length}>Never record</SectionHeading>
          {exclusions.length === 0 ? (
            <p className="text-fg-faint text-[13px] mb-3">Nothing excluded.</p>
          ) : (
            <List>
              {exclusions.map((ex) => (
                <Row key={ex.id}>
                  <Chip as="span">{EXCLUSION_KIND_LABEL[ex.kind]}</Chip>
                  <span className="flex-1 min-w-0 truncate font-mono text-[12px]">{ex.pattern}</span>
                  <IconButton label="Remove" icon={Trash2} danger onClick={() => void removeExclusion(ex.id)} />
                </Row>
              ))}
            </List>
          )}
          <div className="flex items-center gap-2 mt-3">
            <div className="w-40 shrink-0">
              <Select size="sm" className="w-full" value={newExclusionKind} onChange={(e) => setNewExclusionKind(e.target.value as ActivityExclusionDTO["kind"])}>
                <option value="app">App</option>
                <option value="domain">Domain</option>
              </Select>
            </div>
            <Input
              size="sm"
              className="flex-1 min-w-0"
              placeholder="Bundle id or domain"
              value={newExclusionPattern}
              onChange={(e) => setNewExclusionPattern(e.target.value)}
            />
            <Button variant="primary" size="sm" onClick={() => void addExclusion()}>
              Add exclusion
            </Button>
          </div>
        </section>

        <section className="mb-6">
          <SectionHeading count={categories.length}>Categories</SectionHeading>
          <List>
            {categories.map((c) => (
              <Row key={c.id}>
                <input
                  type="color"
                  defaultValue={c.color}
                  onBlur={(e) => void updateCategoryColor(c.id, e.target.value)}
                  aria-label={`${c.name} colour`}
                  className="focus-ring w-6 h-6 rounded-sm border border-line bg-transparent"
                />
                <Input size="sm" className="flex-1 min-w-0" defaultValue={c.name} onBlur={(e) => void updateCategoryName(c.id, e.target.value)} />
              </Row>
            ))}
          </List>
        </section>

        <section>
          <SectionHeading>Retention</SectionHeading>
          <div className="w-36">
            <Input
              size="sm"
              type="number"
              min={1}
              max={3650}
              defaultValue={retentionDays}
              onBlur={(e) => void updateRetention(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <p className="text-[12px] text-fg-faint mt-1.5">Sessions older than this are deleted nightly.</p>
        </section>
      </div>
    </>
  );
}
