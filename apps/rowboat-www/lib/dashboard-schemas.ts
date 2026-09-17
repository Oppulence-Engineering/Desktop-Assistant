import { z } from "zod";

export const JsonObjectSchema = z.record(z.string(), z.unknown());

export const TextContentResponseSchema = z
  .object({
    content: z.string().optional(),
    raw: z.string().optional(),
  })
  .passthrough();

export const CreatedAgentSessionSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
  })
  .passthrough()
  .refine((value) => value.sessionId || value.id, {
    message: "Agent session response requires sessionId or id",
  })
  .transform((value) => {
    const sessionId = value.sessionId ?? value.id;
    if (!sessionId) throw new Error("Validated agent session id is missing");
    return { sessionId };
  });

export const ApprovalTokenResponseSchema = z
  .object({
    approvalToken: z.string().min(1),
  })
  .passthrough();

export const RunFileResponseSchema = z
  .object({
    parsed: z.unknown().optional(),
    raw: z.string().optional(),
  })
  .passthrough();

export const EmptyResponseSchema = z.null();
export const MutationResponseSchema = z.union([z.null(), JsonObjectSchema]);

/** Parses JSON editor text and enforces an object-shaped document. */
export function parseJsonObject(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The document is not valid JSON");
  }
  return JsonObjectSchema.parse(parsed);
}
