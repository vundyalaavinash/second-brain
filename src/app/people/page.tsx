import Link from "next/link";
import { Users } from "lucide-react";
import { getDb } from "@/db/client";
import { listPeople } from "@/domain/people";
import { serializePerson } from "@/lib/api";
import { NewPersonForm } from "@/components/new-person-form";
import { EmptyState, List, PageHeader, Row } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function PeoplePage() {
  const people = listPeople(getDb()).map((p) => serializePerson(p));
  return (
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-5">
      <PageHeader
        title="People"
        meta={
          <>
            <span>Mention @slug in a note to link them.</span> <span className="font-mono">{people.length} people</span>
          </>
        }
      />
      <NewPersonForm />
      {people.length === 0 ? (
        <EmptyState icon={Users} text="Nobody yet. Mention @slug in a note to link them." />
      ) : (
        <List>
          {people.map((p) => (
            <Row key={p.id}>
              <span className="w-6 h-6 rounded-full bg-layer-2 text-[11px] flex items-center justify-center shrink-0">
                {p.name.charAt(0).toUpperCase()}
              </span>
              <Link href={`/people/${p.slug}`} className="flex-1 truncate text-[13.5px] hover:text-violet-bright">
                {p.name}
              </Link>
              <span className="font-mono text-[11px] text-fg-faint">@{p.slug}</span>
              <span className="font-mono text-[11px] text-fg-faint w-16 text-right">{p.itemCount} items</span>
            </Row>
          ))}
        </List>
      )}
    </div>
  );
}
