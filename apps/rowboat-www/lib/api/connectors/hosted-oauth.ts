import { z } from "zod";

import type { HostedOAuthOutcome } from "@/lib/connectors/hosted-oauth";

const OutcomeSchema = z.enum([
  "active",
  "entitlement",
  "error",
  "expired",
  "replay",
  "restart",
  "retry",
  "scope",
]);

const StartResponseSchema = z.union([
  z.object({ authorizationUrl: z.url() }),
  z.object({ signInUrl: z.string().startsWith("/api/auth/workos/login?") }),
  z.object({ outcome: OutcomeSchema }),
]);

export type HostedOAuthStartResult =
  | { kind: "authorization"; authorizationUrl: string }
  | { kind: "sign-in"; signInUrl: string }
  | { kind: "failure"; outcome: HostedOAuthOutcome };

export async function startHostedOAuth(
  action: string,
  body: FormData,
  signal: AbortSignal,
): Promise<HostedOAuthStartResult> {
  const response = await fetch(action, {
    method: "POST",
    headers: { Accept: "application/json" },
    body,
    credentials: "same-origin",
    signal,
  });
  const raw: unknown = JSON.parse(await response.text());
  const data = StartResponseSchema.parse(raw);

  if (response.ok && "authorizationUrl" in data) {
    return { kind: "authorization", authorizationUrl: data.authorizationUrl };
  }
  if (response.status === 401 && "signInUrl" in data) {
    return { kind: "sign-in", signInUrl: data.signInUrl };
  }
  if ("outcome" in data) return { kind: "failure", outcome: data.outcome };
  return { kind: "failure", outcome: "error" };
}
