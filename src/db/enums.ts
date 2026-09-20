export const ITEM_TYPES = ["note", "link", "file", "meeting", "journal", "review"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const ITEM_STATUSES = ["pending", "processing", "ready", "failed"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const JOB_TYPES = [
  "fetch_link",
  "extract_pdf",
  "ocr_image",
  "transcribe_final",
  "summarize_meeting",
  "embed",
  "weekly_reflect",
  "backup",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const CONTAINER_KINDS = ["project", "area", "resource"] as const;
export type ContainerKind = (typeof CONTAINER_KINDS)[number];

export const CONTAINER_STATUSES = ["active", "archived"] as const;
export type ContainerStatus = (typeof CONTAINER_STATUSES)[number];

export const RESOURCE_CATEGORIES = ["articles", "tools", "reference", "research", "inspiration", "videos", "other"] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

export const TASK_STATUSES = ["open", "done", "dropped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
