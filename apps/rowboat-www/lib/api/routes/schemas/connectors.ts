import { z } from "zod";

import { ConnectorSlugSchema } from "@/lib/api/routes/schemas/common";

export const ConnectorRouteParamsSchema = z.object({
  name: ConnectorSlugSchema,
});

export const ConnectorOAuthCallbackQuerySchema = z.object({
  connector: z.string().default(""),
  status: z.enum(["success", "error", "restart_required"]).optional(),
  session: z.string().max(2048).optional(),
});

export const ConnectorStartFormSchema = z.object({
  requested_scope: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(64)
    .transform((scopes) => [...new Set(scopes)]),
});
