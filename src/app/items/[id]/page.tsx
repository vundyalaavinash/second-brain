import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getItem } from "@/domain/items";
import { serializeItem } from "@/lib/api";
import { ItemEditor } from "@/components/item-editor";

export const dynamic = "force-dynamic";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const db = getDb();
  const item = getItem(db, n);
  if (!item) notFound();
  return <ItemEditor key={item.id} initial={serializeItem(db, item)} />;
}
