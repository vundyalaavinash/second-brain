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
