import { z } from "zod";
import { CONTAINER_KINDS, RESOURCE_CATEGORIES } from "@/db/enums";

export const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ContainerBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  goal: z.string().optional(),
  deadline: DateString.nullable().optional(),
  standard: z.string().optional(),
  category: z.enum(RESOURCE_CATEGORIES).nullable().optional(),
  nextSteps: z.string().optional(),
});

export const CreateContainerBody = ContainerBody.extend({ kind: z.enum(CONTAINER_KINDS) });
export const PatchContainerBody = ContainerBody.partial().extend({ sortOrder: z.number().int().optional() });
