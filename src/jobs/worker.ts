import type { DB } from "@/db/client";
import type { Job, JobType } from "@/db/schema";
import { claimNextJob, completeJob, failJob } from "./queue";

export type JobHandler = (job: Job) => Promise<void>;
export type JobHandlers = Partial<Record<JobType, JobHandler>>;

export interface WorkerOptions {
  pollMs?: number;
  log?: (message: string) => void;
}

export class JobWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private allowed: JobType[] | undefined;

  constructor(
    private readonly db: DB,
    private readonly handlers: JobHandlers,
    private readonly opts: WorkerOptions = {},
  ) {}

  /** Limit the worker to certain job types (used while a meeting is recording). Pass undefined to lift. */
  restrictTo(types: JobType[] | undefined): void {
    this.allowed = types;
  }

  /** Claim and run at most one job. Returns true if a job ran. */
  async runOnce(now: Date = new Date()): Promise<boolean> {
    const job = claimNextJob(this.db, now, this.allowed);
    if (!job) return false;
    const handler = this.handlers[job.type];
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await handler(job);
      completeJob(this.db, job.id);
      this.opts.log?.(`job ${job.id} ${job.type} done`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const updated = failJob(this.db, job.id, message);
      this.opts.log?.(`job ${job.id} ${job.type} failed (${updated.status}, attempt ${updated.attempts}): ${message}`);
    }
    return true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        let ran = true;
        while (ran && this.running) ran = await this.runOnce();
      } catch (err) {
        this.opts.log?.(`worker tick error: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (this.running) this.timer = setTimeout(tick, this.opts.pollMs ?? 1000);
    };
    void tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
