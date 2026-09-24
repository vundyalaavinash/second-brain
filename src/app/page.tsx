import Link from "next/link";
import { getDb } from "@/db/client";
import { Crumb } from "@/components/shell/crumb";
import { homePayload } from "@/lib/home";

export const dynamic = "force-dynamic";

/**
 * Where the day stands. The payload is built on the server and handed to the page whole; the
 * sections that draw it arrive with the rest of Home.
 */
export default function HomePage() {
  const { counts } = homePayload(getDb(), new Date());
  const figures: { href: string; label: string }[] = [
    { href: "/planner", label: counts.planned ? `${counts.planned} planned` : "Nothing planned" },
    { href: "/planner/meetings", label: counts.meetings ? `${counts.meetings} meetings` : "No meetings" },
    { href: "/inbox", label: counts.inbox ? `${counts.inbox} in the inbox` : "Inbox clear" },
  ];
  return (
    <>
      <Crumb title="Home" />
      <main className="p-6">
        <h1 className="font-doc text-2xl text-fg">Today</h1>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-muted">
          {figures.map((f) => (
            <li key={f.href}>
              <Link href={f.href} className="focus-ring rounded-sm hover:text-fg">
                {f.label}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
