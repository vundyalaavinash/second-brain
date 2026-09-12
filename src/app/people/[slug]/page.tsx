import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPersonBySlug, getPersonTimeline } from "@/domain/people";
import { serializeItem, serializePerson } from "@/lib/api";
import { PersonEditor } from "@/components/person-editor";
import { TypeBadge } from "@/components/badges";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const person = getPersonBySlug(db, slug);
  if (!person) notFound();
  const timeline = getPersonTimeline(db, person.id).map((i) => serializeItem(db, i));
  return (
    <div className="w-full max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-8">
      <PersonEditor key={person.id} initial={serializePerson(person, timeline.length)} />
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[10px] tracking-wider uppercase text-fg-faint">Timeline · {timeline.length}</h2>
        <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
          {timeline.length === 0 && <li className="px-3 h-10 flex items-center text-fg-faint text-[13px]">No linked items yet.</li>}
          {timeline.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-3 h-10">
              <span className="font-mono text-[10px] text-fg-faint w-20">{formatDate(i.createdAt)}</span>
              <TypeBadge type={i.type} />
              <Link href={`/items/${i.id}`} className="flex-1 truncate text-[13px] hover:text-accent">{i.title}</Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
