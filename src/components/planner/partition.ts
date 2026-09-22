import type { TaskDTO } from "@/lib/dto";

/** Open dated tasks split into what is late and what is due today; future and undated drop out. */
export function partitionDue(tasks: TaskDTO[], today: string): { overdue: TaskDTO[]; today: TaskDTO[] } {
  const open = tasks.filter((t) => t.status === "open" && t.dueDate);
  return { overdue: open.filter((t) => t.dueDate! < today), today: open.filter((t) => t.dueDate === today) };
}
