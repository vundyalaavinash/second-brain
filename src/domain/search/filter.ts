import type { ItemType } from "@/db/schema";

export interface SearchFilter {
  type?: ItemType;
  tag?: string;
  /** Inclusive lower bound on created date, YYYY-MM-DD (local start of day). */
  from?: string;
  /** Inclusive upper bound on created date, YYYY-MM-DD (local end of day). */
  to?: string;
  /** A container id, or null for the Inbox. Omit for any home. */
  containerId?: number | null;
  /** Archived items are hidden unless this is true. */
  includeArchived?: boolean;
}

/** Extra WHERE clauses against an `items` table aliased as `i`. Each starts with " AND ". */
export function filterSql(filter: SearchFilter = {}): { where: string; params: unknown[] } {
  let where = "";
  const params: unknown[] = [];
  if (filter.type) {
    where += " AND i.type = ?";
    params.push(filter.type);
  }
  if (filter.tag) {
    where += " AND i.id IN (SELECT it.item_id FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE t.name = ?)";
    params.push(filter.tag.trim().toLowerCase());
  }
  if (filter.from) {
    where += " AND i.created_at >= ?";
    params.push(new Date(`${filter.from}T00:00:00`).toISOString());
  }
  if (filter.to) {
    where += " AND i.created_at <= ?";
    params.push(new Date(`${filter.to}T23:59:59.999`).toISOString());
  }
  if (filter.containerId === null) where += " AND i.container_id IS NULL";
  else if (typeof filter.containerId === "number") {
    where += " AND i.container_id = ?";
    params.push(filter.containerId);
  }
  if (!filter.includeArchived) where += " AND i.archived_at IS NULL";
  return { where, params };
}
