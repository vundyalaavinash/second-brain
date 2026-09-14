import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import { getDb } from "@/db/client";
import { getPersonBySlug, getPersonTimeline } from "@/domain/people";
import { serializeItem, serializePerson } from "@/lib/api";
import { PersonEditor } from "@/components/person-editor";
import { TypeIcon } from "@/components/type-icon";
import { formatDate } from "@/lib/format";
import { EmptyState, List, Row, SectionHeading } from "@/components/ui";

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
        <SectionHeading count={timeline.length}>Timeline</SectionHeading>
        {timeline.length === 0 ? (
          <EmptyState icon={Clock} text="No linked items yet." />
        ) : (
          <List>
            {timeline.map((i) => (
              <Row key={i.id}>
                <TypeIcon type={i.type} />
                <Link href={`/items/${i.id}`} className="flex-1 truncate text-[13.5px] hover:text-accent">
                  {i.title}
                </Link>
                <span className="font-mono text-[11px] text-fg-faint">{formatDate(i.createdAt)}</span>
              </Row>
            ))}
          </List>
        )}
      </section>
    </div>
  );
}
