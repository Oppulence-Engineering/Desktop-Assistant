import { z } from "zod";

export const ResourceKindSchema = z.enum(["agent", "config", "run", "task", "taskrun"]);

export const SelectedResourceSchema = z.object({
  kind: ResourceKindSchema,
  name: z.string().min(1),
});

export type ResourceKind = z.infer<typeof ResourceKindSchema>;
export type SelectedResource = z.infer<typeof SelectedResourceSchema>;
