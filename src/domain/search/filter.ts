import type { ItemType } from "@/db/schema";

export interface SearchFilter {
  type?: ItemType;
  tag?: string;
  /** Inclusive lower bound on created date, YYYY-MM-DD. */
  from?: string;
  /** Inclusive upper bound on created date, YYYY-MM-DD. */
  to?: string;
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
    params.push(`${filter.from}T00:00:00.000Z`);
  }
  if (filter.to) {
    where += " AND i.created_at <= ?";
    params.push(`${filter.to}T23:59:59.999Z`);
  }
  return { where, params };
}
