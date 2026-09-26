import { z } from "zod";
import { CONTAINER_KINDS, RESOURCE_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES, GOAL_HORIZONS, GOAL_STATUSES, FOCUS_OUTCOMES, MEETING_DECISIONS, type ReviewStep } from "@/db/enums";
import { MIN_FOCUS_MINUTES, MAX_FOCUS_MINUTES } from "@/domain/focus";

export const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const LocalTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

/** `DateString`, plus a real calendar date: `2026-13-45` matches the regex but `new Date` rolls
 * it over to 2027-02-08, and the review routes write a permanent record keyed by whatever date
 * they are given, so a malformed-but-well-formed date must 400 here rather than silently open
 * a different week's review. (The regex-only gap is pre-existing elsewhere in the app, e.g.
 * `/api/plan` — out of scope to fix everywhere from this route.) */
export const CalendarDateString = DateString.refine((s) => {
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}, "not a real calendar date");

export const ContainerBody = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    goal: z.string().optional(),
    deadline: DateString.nullable().optional(),
    standard: z.string().optional(),
    category: z.enum(RESOURCE_CATEGORIES).nullable().optional(),
  })
  .strict();

export const CreateContainerBody = ContainerBody.extend({ kind: z.enum(CONTAINER_KINDS) });
export const PatchContainerBody = ContainerBody.partial().extend({ sortOrder: z.number().int().optional() });

export const TaskBody = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: DateString.nullable().optional(),
  containerId: z.number().int().positive().nullable().optional(),
  sourceItemId: z.number().int().positive().nullable().optional(),
  estimateMinutes: z.number().int().min(5).max(480).nullable().optional(),
  sessionMinutes: z.number().int().min(15).max(480).nullable().optional(),
});
export const PatchTaskBody = TaskBody.partial().omit({ sourceItemId: true }).extend({ status: z.enum(TASK_STATUSES).optional() }).strict();
export const ReorderTasksBody = z.object({ containerId: z.number().int().positive().nullable(), ids: z.array(z.number().int().positive()) });

export const PlanBody = z.object({ date: DateString, taskId: z.number().int().positive() }).strict();
/** A session on the timeline: a start in local time and how long it runs. */
export const BlockBody = z.object({ taskId: z.number().int().positive(), startsAt: LocalTimestamp, minutes: z.number().int().min(5).max(480) }).strict();
export const PatchBlockBody = BlockBody.partial().omit({ taskId: true }).strict();
/** Place one task's sessions, or every unplaced plan task's when no task is named. */
export const PlaceBody = z.object({ date: DateString, taskId: z.number().int().positive().optional() }).strict();
export const ReorderPlanBody = z.object({ date: DateString, taskIds: z.array(z.number().int().positive()) }).strict();
export const CarryOverBody = z.object({ from: DateString, to: DateString }).strict();

export const MeetingPatchBody = z.object({ noRecord: z.boolean() }).strict();
/** `PATCH /api/meetings/[id]/decision` — `note` defaults to "" the same as the column it writes;
 * `scope: "series"` is rejected downstream (`setMeetingDecision`, 400) when the event has no
 * `seriesId`, not here, because that is a fact about the row, not about the shape of the body. */
export const MeetingDecisionBody = z
  .object({ decision: z.enum(MEETING_DECISIONS), note: z.string().optional(), scope: z.enum(["occurrence", "series"]) })
  .strict();
/** `0`-`365` or `null` ("keep forever") -- see `AUDIO_RETENTION_KEY` in `domain/meetings/audio-retention.ts`. */
export const MeetingSettingsBody = z
  .object({
    autoRecord: z.boolean(),
    autoRecordNeedsCallLink: z.boolean(),
    audioRetentionDays: z.union([z.number().int().min(0).max(365), z.null()]),
  })
  .partial()
  .strict();

/** One of the three ways a recording is aimed: a calendar row, a meeting item, or nothing yet. */
export const StartRecordingBody = z
  .object({
    calendarEventId: z.number().int().positive().optional(),
    itemId: z.number().int().positive().optional(),
    adhoc: z.boolean().optional(),
  })
  .strict();

export const CreateGoalBody = z
  .object({
    title: z.string().min(1),
    outcome: z.string().optional(),
    horizon: z.enum(GOAL_HORIZONS),
    targetDate: DateString,
    notes: z.string().optional(),
  })
  .strict();

export const PatchGoalBody = CreateGoalBody.partial()
  .extend({ status: z.enum(GOAL_STATUSES).optional(), sortOrder: z.number().int().optional() })
  .strict();

export const GoalLinksBody = z.object({ containerIds: z.array(z.number().int().positive()) }).strict();

export const StartFocusBody = z
  .object({
    taskId: z.number().int().positive(),
    blockId: z.number().int().positive().nullable().optional(),
    minutes: z.number().int().min(MIN_FOCUS_MINUTES).max(MAX_FOCUS_MINUTES).optional(),
  })
  .strict();

export const FinishFocusBody = z.object({ outcome: z.enum(FOCUS_OUTCOMES) }).strict();

export const FocusSettingsBody = z
  .object({
    defaultMinutes: z.number().int().min(MIN_FOCUS_MINUTES).max(MAX_FOCUS_MINUTES),
    shortBreak: z.number().int().min(1).max(60),
    longBreak: z.number().int().min(1).max(60),
    longBreakEvery: z.number().int().min(2).max(12),
  })
  .partial()
  .strict();

/** Ties `step` to the shape `value` must take: a piece of prose for every step but `goals`,
 * which takes a note per goal id. A plain union of the two value types would accept a string for
 * `goals` — silently spread into an index-keyed object by `saveReviewStep` — or a record for
 * any other step, rendered as `[object Object]` in the body; the discriminant rules both out at
 * the door. */
export const SaveReviewBody = z.discriminatedUnion("step", [
  z.object({ week: CalendarDateString, step: z.literal("clear"), value: z.string() }).strict(),
  z.object({ week: CalendarDateString, step: z.literal("back"), value: z.string() }).strict(),
  z.object({ week: CalendarDateString, step: z.literal("goals"), value: z.record(z.string(), z.string()) }).strict(),
  z.object({ week: CalendarDateString, step: z.literal("ahead"), value: z.string() }).strict(),
]);

/** Ties the four literals above to `REVIEW_STEPS` without building the union programmatically
 * (which `z.discriminatedUnion` can't infer a literal tuple type from): `StepsMatch` is `true`
 * only when the two string unions have exactly the same members, so a step added to, removed
 * from, or renamed in `REVIEW_STEPS` without a matching edit here fails to compile instead of
 * type-checking everywhere and being silently rejected at the route. */
type StepsMatch<A extends string, B extends string> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type SaveReviewStep = z.infer<typeof SaveReviewBody>["step"];
const _reviewStepsTiedToSaveReviewBody: StepsMatch<ReviewStep, SaveReviewStep> = true;
void _reviewStepsTiedToSaveReviewBody;

export const ReviewPlanBody = z.object({ week: CalendarDateString, taskIds: z.array(z.number().int().positive()) }).strict();
