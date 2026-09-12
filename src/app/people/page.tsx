import Link from "next/link";
import { getDb } from "@/db/client";
import { listPeople } from "@/domain/people";
import { serializePerson } from "@/lib/api";
import { NewPersonForm } from "@/components/new-person-form";

export const dynamic = "force-dynamic";

export default function PeoplePage() {
  const people = listPeople(getDb()).map((p) => serializePerson(p));
  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight">People</h1>
        <span className="font-mono text-[10px] text-fg-faint">{people.length} people · mention with @slug in any note</span>
      </header>
      <NewPersonForm />
      <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
        {people.length === 0 && <li className="px-3 h-10 flex items-center text-fg-faint text-[13px]">Nobody yet.</li>}
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-3 h-10 hover:bg-surface-2 transition-colors duration-150">
            <Link href={`/people/${p.slug}`} className="flex-1 truncate text-[13.5px] hover:text-accent">{p.name}</Link>
            <span className="font-mono text-[10px] text-fg-faint">@{p.slug}</span>
            <span className="font-mono text-[10px] text-fg-faint w-14 text-right">{p.itemCount} items</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
