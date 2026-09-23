import type { ItemStatus, ItemType, ContainerKind, ContainerStatus, ResourceCategory } from "@/db/enums";

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
  /** Only what the drawer heading needs: a group carries no counts of its own. */
  container: ContainerRefDTO;
  tasks: TaskDTO[];
}

/** Every open task, by where it lives, for the planning drawer. */
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
  /** Open tasks due on or before the date that are not already on the plan. */
  due: { overdue: TaskDTO[]; today: TaskDTO[] };
  meetings: MeetingListDTO[];
  calendar: PlannerCalendarDTO;
  sources: PlannerSourcesDTO;
  capacity: CapacityDTO;
}

export interface PlannerWeekDayDTO {
  date: string;
  meetings: ActivityMeetingDTO[];
  due: TaskDTO[];
  capacity: { freeMinutes: number; plannedMinutes: number };
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
