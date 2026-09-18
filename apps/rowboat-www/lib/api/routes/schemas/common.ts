import { z } from "zod";

export const ConnectorSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "Invalid connector slug.");

export const ReturnToQuerySchema = z.object({
  return_to: z.string().optional(),
});

export const ApiErrorResponseSchema = z.object({
  code: z.string(),
  detail: z.string().optional(),
  error: z.string().optional(),
});
