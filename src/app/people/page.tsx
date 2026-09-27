import { Users } from "lucide-react";
import { getDb } from "@/db/client";
import { listPeople } from "@/domain/people";
import { serializePerson } from "@/lib/api";
import { NewPersonForm } from "@/components/new-person-form";
import { PersonCard } from "@/components/person-card";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function PeoplePage() {
  const people = listPeople(getDb()).map((p) => serializePerson(p));
  const now = new Date().getTime();
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 min-[1900px]:grid-cols-5 gap-4">
          {people.map((p) => (
            <PersonCard key={p.id} person={p} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
