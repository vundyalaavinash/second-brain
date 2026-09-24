import { getDb } from "@/db/client";
import { localDay } from "@/domain/activity";
import { Crumb } from "@/components/shell/crumb";
import { ReviewPage } from "@/components/review/review-page";
import { reviewPayload } from "@/lib/review";
import { CalendarDateString } from "@/lib/validation";
import { weekStart } from "@/lib/week";

export const dynamic = "force-dynamic";

/**
 * The four panes, assembled on the server exactly as `/api/review` would answer them, so the
 * first paint already has the week's figures rather than a shell that fills in. `?week=` names
 * any day of the week under review; `weekStart` pins it to that week's Monday the same way the
 * route does, so a link built off any day of the week lands on the same review.
 */
export default async function Review({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const parsed = CalendarDateString.safeParse(week);
  const shown = weekStart(parsed.success ? parsed.data : localDay(new Date().toISOString()));
  return (
    <>
      <Crumb title="Review" />
      {/* Keyed by the week: arriving at another one replaces the page's state rather than
        * leaving the previous week's draft and step sitting in it. */}
      <ReviewPage key={shown} initial={reviewPayload(getDb(), shown, new Date())} />
    </>
  );
}
