import { z } from "zod";
import { CONTAINER_KINDS, RESOURCE_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES } from "@/db/enums";

export const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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
});
export const PatchTaskBody = TaskBody.partial().omit({ sourceItemId: true }).extend({ status: z.enum(TASK_STATUSES).optional() }).strict();
export const ReorderTasksBody = z.object({ containerId: z.number().int().positive().nullable(), ids: z.array(z.number().int().positive()) });

export const PlanBody = z.object({ date: DateString, taskId: z.number().int().positive() }).strict();
export const ReorderPlanBody = z.object({ date: DateString, taskIds: z.array(z.number().int().positive()) }).strict();
export const CarryOverBody = z.object({ from: DateString, to: DateString }).strict();
