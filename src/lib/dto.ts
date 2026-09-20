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
  people: PersonRefDTO[];
  createdAt: string;
  updatedAt: string;
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
  completedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
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
  nextSteps: string;
  sortOrder: number;
  archivedAt: string | null;
  itemCount: number;
  totalItemCount: number;
  progress: ProgressDTO;
  createdAt: string;
  updatedAt: string;
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
}
export interface ActivitySessionDTO {
  id: number; startedAt: string; endedAt: string; appId: string | null; appName: string | null; title: string | null;
  domain: string | null; categoryId: number | null; afk: boolean; meetingId: number | null;
}
export interface ActivityMeetingDTO {
  id: number; title: string; startsAt: string; endsAt: string; attendees: number; hasCallLink: boolean; interview: boolean;
  scheduledMs: number; actualMs: number; itemId: number | null;
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
