import type { ItemStatus, ItemType, ContainerKind, ContainerStatus, ResourceCategory, GoalHorizon, GoalStatus, FocusOutcome } from "@/db/enums";
import type { ReviewStep } from "@/domain/review";

export interface ContainerRefDTO {
  id: number;
  name: string;
  slug: string;
  kind: ContainerKind;
}

export interface PersonRefDTO {
  id: number;
  name: string;
  slug: string;
}

export interface ItemDTO {
  id: number;
  type: ItemType;
  title: string;
  body: string;
  status: ItemStatus;
  error: string | null;
  sourceUrl: string | null;
  filePath: string | null;
  mimeType: string | null;
  extractedText: string;
  meta: Record<string, unknown>;
  tags: string[];
  journalDate: string | null;
  reviewWeek: string | null;
  containerId: number | null;
  container: ContainerRefDTO | null;
  archivedAt: string | null;
  pinned: boolean;
  people: PersonRefDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface PinnedLinkDTO {
  id: number;
  title: string;
  url: string;
  domain: string;
}

export interface SearchResultDTO {
  item: ItemDTO;
  snippet: string;
  score: number;
  chunkId: number;
}

export interface ProgressDTO {
  open: number;
  done: number;
  total: number;
  percent: number;
  nextTask: { id: number; title: string; dueDate: string | null } | null;
}

/** One session of a task on the timeline. */
export interface BlockDTO {
  id: number;
  taskId: number;
  startsAt: string;
  minutes: number;
}

export interface TaskDTO {
  id: number;
  title: string;
  notes: string;
  status: "open" | "done" | "dropped";
  priority: "low" | "normal" | "high";
  dueDate: string | null;
  containerId: number | null;
  sourceItemId: number | null;
  estimateMinutes: number | null;
  /** How long each placed session should be; null leaves the sizing to the scheduler. */
  sessionMinutes: number | null;
  /** The task's sessions, ordered by start, across every day it holds one. */
  blocks: BlockDTO[];
  /** The active goals the task's container serves; empty with no container or none active. */
  goals: GoalRefDTO[];
  /** Minutes actually run against the task, summed from every run that booked anything — 0
   * with no run landed yet, never a run's own zero (an abandoned run books nothing at all). */
  spentMinutes: number;
  completedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** A task as it sits on one day's plan: `sortOrder` is the plan's order, not the task's order
 * inside its container, and `planId` is the plan entry itself. */
export interface PlanTaskDTO extends TaskDTO {
  planId: number;
}

export interface PlanDTO {
  date: string;
  tasks: PlanTaskDTO[];
  unfinishedYesterday: TaskDTO[];
}

export interface ContainerDTO {
  id: number;
  kind: ContainerKind;
  name: string;
  slug: string;
  description: string;
  status: ContainerStatus;
  goal: string;
  deadline: string | null;
  standard: string;
  category: ResourceCategory | null;
  sortOrder: number;
  archivedAt: string | null;
  itemCount: number;
  totalItemCount: number;
  progress: ProgressDTO;
  pinnedLinks: PinnedLinkDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface SourceGroupDTO {
  /** Only what a home heading needs: a group carries no counts of its own. */
  container: ContainerRefDTO;
  tasks: TaskDTO[];
}

/** Every open task, by where it lives, for the plan picker. */
export interface PlannerSourcesDTO {
  inbox: TaskDTO[];
  due: { overdue: TaskDTO[]; today: TaskDTO[] };
  projects: SourceGroupDTO[];
  areas: SourceGroupDTO[];
}

export interface CapacityDTO {
  freeMinutes: number;
  plannedMinutes: number;
  unestimated: number;
  workHours: string;
  blockedMinutes: number;
  unplacedMinutes: number;
}

export interface PersonDTO {
  id: number;
  name: string;
  slug: string;
  profile: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityCategoryDTO { id: number; name: string; color: string; sortOrder: number }
export interface ActivityRuleDTO { id: number; matchKind: "app" | "domain" | "title_contains"; pattern: string; categoryId: number; sortOrder: number }
export interface ActivityExclusionDTO { id: number; kind: "app" | "domain"; pattern: string }
export interface HelperStateDTO {
  lastSeen: string | null;
  version: string | null;
  permissions: { accessibility: boolean; calendar: boolean; automation: Record<string, boolean> } | null;
  calendarsSeen: number | null;
}
export interface ActivitySessionDTO {
  id: number; startedAt: string; endedAt: string; appId: string | null; appName: string | null; title: string | null;
  domain: string | null; categoryId: number | null; afk: boolean; meetingId: number | null;
}
export interface ActivityMeetingDTO {
  id: number; title: string; startsAt: string; endsAt: string; attendees: number; hasCallLink: boolean; interview: boolean;
  scheduledMs: number; actualMs: number; itemId: number | null;
  organizer: string; attendeeNames: string[]; location: string; joinUrl: string | null; allDay: boolean;
  status: "accepted" | "tentative" | "declined" | "none"; calendarTitle: string; noRecord: boolean;
}
export interface ActivityDayDTO {
  day: string;
  activeMs: number;
  sessions: ActivitySessionDTO[];
  byCategory: { categoryId: number | null; ms: number }[];
  byApp: { appId: string | null; appName: string | null; ms: number }[];
  bySite: { key: string; label: string; ms: number }[];
  meetings: ActivityMeetingDTO[];
  categories: ActivityCategoryDTO[];
  helper: HelperStateDTO;
  paused: boolean;
  retentionDays: number;
}
export interface ActivityWeekDTO {
  start: string;
  days: { day: string; activeMs: number; byCategory: { categoryId: number | null; ms: number }[] }[];
  categories: ActivityCategoryDTO[];
}

/** The recording session as the chip and the Record buttons read it. */
export interface RecorderStatusDTO {
  state: "idle" | "recording" | "stopping" | "error";
  itemId?: number;
  title?: string;
  startedAt?: string;
  systemAudio?: boolean;
  error?: string;
  autoStarted?: boolean;
  keep?: boolean;
  /** Tool keys `checkTools` could not find; a non-empty list puts Record out of reach. */
  missing: string[];
}

/** A published calendar link and the state of its last sync. */
export interface CalendarFeedDTO {
  feedUrl: string;
  syncedAt: string | null;
  error: string | null;
  count: number;
  /** Present on the answers to a save or a "Sync now". */
  sync?: { state: "off" } | { state: "ok"; count: number; syncedAt: string } | { state: "error"; error: string };
}

/** The two auto-record switches in the Meetings header. */
export interface MeetingSettingsDTO {
  autoRecord: boolean;
  autoRecordNeedsCallLink: boolean;
}

/** What the Planner knows about the helper's calendar access, for the setup card. */
export interface PlannerCalendarDTO {
  /** How many calendars the helper can see; null until it has reported at all. */
  calendarsSeen: number | null;
  permission: boolean;
}

export interface PlannerDayDTO {
  date: string;
  plan: PlanTaskDTO[];
  unfinishedYesterday: TaskDTO[];
  meetings: MeetingListDTO[];
  calendar: PlannerCalendarDTO;
  sources: PlannerSourcesDTO;
  capacity: CapacityDTO;
}

export interface PlannerWeekDayDTO {
  date: string;
  meetings: ActivityMeetingDTO[];
  due: TaskDTO[];
  capacity: { freeMinutes: number; plannedMinutes: number; blockedMinutes: number };
}

export interface PlannerWeekDTO {
  start: string;
  days: PlannerWeekDayDTO[];
}

/** What the linked meeting item already holds, so a row can badge it without loading the item. */
export interface MeetingItemDTO {
  id: number;
  hasNotes: boolean;
  hasTranscript: boolean;
  hasSummary: boolean;
}

export type MeetingListDTO = ActivityMeetingDTO & { item?: MeetingItemDTO };

export interface PlannerMeetingsDTO {
  from: string;
  to: string;
  meetings: MeetingListDTO[];
  calendar: PlannerCalendarDTO;
}

/** One timed thing on the day: the meeting or session Home shows as now, or as what comes next. */
export interface HomeItemDTO {
  kind: "meeting" | "session";
  title: string;
  /** A meeting's own instant (UTC), a session's local wall clock — each as its source records it. */
  startsAt: string;
  endsAt: string;
  meetingId?: number;
  joinUrl?: string;
  taskId?: number;
  blockId?: number;
}

/** An active project as Home's compact card reads it. */
export interface ProjectCardDTO {
  id: number;
  name: string;
  slug: string;
  open: number;
  done: number;
  nextTask: { id: number; title: string } | null;
  deadline: string | null;
  updatedAt: string;
}

/** One of the last items touched; `meeting` is set only on a meeting item, for its chip. */
export interface RecentItemDTO {
  id: number;
  type: ItemType;
  title: string;
  updatedAt: string;
  status: ItemStatus;
  meeting?: { hasTranscript: boolean; hasSummary: boolean };
}

/** Where the day stands, in one payload: the Planner's day plus what Home adds around it. */
export interface HomeDTO {
  date: string;
  today: string;
  /** The instant the payload was built, so "2 h ago" reads the same on the server and on the
   * first client render rather than drifting between them. */
  generatedAt: string;
  day: PlannerDayDTO;
  counts: { planned: number; meetings: number; inbox: number };
  now: HomeItemDTO | null;
  /** Up to two, in start order, never the one `now` holds. */
  next: HomeItemDTO[];
  projects: ProjectCardDTO[];
  recent: RecentItemDTO[];
  /** Null until the helper has reported at all, which is what hides the section. */
  activity: { activeMs: number; top: { label: string; ms: number }[] } | null;
  /** What today has cost so far: booked minutes and run count, and the run still going, if
   * one is — the same live run a focus-aware surface reads through `useFocus()`, carried here
   * too so the page's first paint already knows it rather than waiting on that store's own
   * fetch. */
  focus: { minutes: number; running: FocusRunDTO | null };
}

export interface GoalMeasureDTO {
  open: number;
  done: number;
  total: number;
  percent: number;
  movement: number;
  lastClosedAt: string | null;
  stalled: boolean;
}

/** The goal a task's project serves, as a row chip shows it. */
export interface GoalRefDTO {
  id: number;
  title: string;
}

export interface GoalDTO {
  id: number;
  title: string;
  outcome: string;
  horizon: GoalHorizon;
  targetDate: string;
  status: GoalStatus;
  notes: string;
  sortOrder: number;
  closedAt: string | null;
  measure: GoalMeasureDTO;
  containers: ContainerRefDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface GoalDetailDTO extends GoalDTO {
  /** Each linked container with its own progress, so the goal page shows where the work is. */
  links: { container: ContainerRefDTO; progress: ProgressDTO }[];
  recentCloses: { id: number; title: string; completedAt: string; containerName: string }[];
}

/** One stretch of focused work on a task, live or finished. `endedAt`, `actualMinutes` and
 * `outcome` are null while the run is still going. */
export interface FocusRunDTO {
  id: number;
  taskId: number;
  taskTitle: string;
  blockId: number | null;
  startedAt: string;
  endedAt: string | null;
  plannedMinutes: number;
  actualMinutes: number | null;
  outcome: FocusOutcome | null;
}

export interface FocusSettingsDTO {
  defaultMinutes: number;
  shortBreak: number;
  longBreak: number;
  longBreakEvery: number;
}

export interface FocusSummaryDTO {
  minutes: number;
  runs: number;
  byTask: { taskId: number; title: string; minutes: number; runs: number }[];
}

/** What a review has answered so far, one entry per step; `goals` is a note per goal id. */
export interface ReviewAnswersDTO {
  clear?: string;
  back?: string;
  goals?: Record<string, string>;
  ahead?: string;
}

/**
 * The week's review, assembled: what the week itself looked like — done, dropped, still open,
 * booked focus time, the projects that moved — and what is coming in the week after, read from
 * the same domains Home and the Planner already read them from, so the two screens can never
 * disagree about the same week.
 */
export interface ReviewDTO {
  /** The Monday the review is for. */
  week: string;
  label: string;
  days: string[];
  /** Whether the week being reviewed is the one the app is being used in. */
  current: boolean;
  /** Where to resume: the first step with no answer yet, or the last step once every one does. */
  step: ReviewStep;
  answers: ReviewAnswersDTO;
  clear: {
    inbox: number;
    /** Still open on any day of the week, each counted once even if planned on several. */
    leftover: PlanTaskDTO[];
  };
  back: {
    done: number;
    dropped: number;
    /** Planned in the week and still open — the same set `clear.leftover` lists, as a count. */
    slipped: number;
    focusMinutes: number;
    focusRuns: number;
    /** Meetings not declined and not all-day — the same rule `homePayload` counts by. */
    meetings: number;
    projects: { container: ContainerRefDTO; closed: number; percent: number }[];
  };
  /** Active goals, each with its measure. */
  goals: GoalDTO[];
  ahead: {
    /** Next Monday. */
    week: string;
    due: TaskDTO[];
    deadlines: { container: ContainerRefDTO; deadline: string }[];
    meetings: ActivityMeetingDTO[];
  };
  savedAt: string | null;
}
