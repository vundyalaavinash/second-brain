import type { Job } from "@/db/schema";

export function jobPayload<T = Record<string, unknown>>(job: Job): T {
  try {
    return JSON.parse(job.payload) as T;
  } catch {
    return {} as T;
  }
}
