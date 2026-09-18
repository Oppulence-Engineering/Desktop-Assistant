import { z } from "zod";

export const WorkOSLoginQuerySchema = z.object({
  return_to: z.string().optional(),
});

export const WorkOSCallbackQuerySchema = z.object({
  error: z.string().optional(),
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
});

export const LogoutQuerySchema = z.object({
  return_to: z.string().optional(),
});
