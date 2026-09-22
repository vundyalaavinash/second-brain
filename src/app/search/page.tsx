import { SearchPanel } from "@/components/search-panel";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string }> }) {
  const { q, tag } = await searchParams;
  return <SearchPanel initialQuery={q ?? ""} initialTag={tag ?? ""} />;
}
