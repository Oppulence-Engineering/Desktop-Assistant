import { z } from "zod";

/** Public shape shared by the dev health route and its browser consumer. */
export const DevHealthResponseSchema = z.object({
  www: z.object({
    ok: z.boolean(),
    warnings: z.array(z.string()),
    errors: z.array(z.string()),
  }),
  api: z.object({
    ok: z.boolean(),
    status: z.number().int().optional(),
    latencyMs: z.number().int().nonnegative().optional(),
    error: z.string().optional(),
  }),
  env: z.object({
    apiProxyUrl: z.url(),
    publicAppUrl: z.url().optional(),
  }),
});

export const DevHealthErrorResponseSchema = z.object({
  error: z.literal("not found"),
});

export type DevHealthResponse = z.infer<typeof DevHealthResponseSchema>;
