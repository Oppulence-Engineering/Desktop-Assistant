import { z } from "zod";

import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";
import type { CommunicationPolicy, CommunicationPrivacyRule } from "@/types/revenue";

const CommunicationPolicySchema = z
  .object({
    id: z.string(),
    sourceAccountId: z.string(),
    metadataVisibility: z.enum(["private", "workspace"]),
    shareSubject: z.boolean(),
    shareBody: z.boolean(),
    shareAttachments: z.boolean(),
    signatureEnrichment: z.boolean(),
    modelContactExtraction: z.boolean(),
    retentionDays: z.number(),
    version: z.number(),
  })
  .passthrough();

const CommunicationPrivacyRuleSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    value: z.string(),
    valueHash: z.string(),
    active: z.boolean(),
  })
  .passthrough();

const PrivacyRulesSchema = z.object({
  rules: z.array(CommunicationPrivacyRuleSchema).optional(),
});

function policyPath(sourceAccountId: string): string {
  return `/revenue-workspaces/current/communication-policy/${encodeURIComponent(sourceAccountId)}`;
}

export async function loadCommunicationPolicy(
  request: RequestJsonFn,
  sourceAccountId: string,
  signal?: AbortSignal,
): Promise<CommunicationPolicy> {
  return (await request({
    path: policyPath(sourceAccountId),
    schema: CommunicationPolicySchema,
    signal,
  })) as CommunicationPolicy;
}

export async function loadCommunicationPrivacyRules(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<CommunicationPrivacyRule[]> {
  const body = await request({
    path: "/revenue-workspaces/current/communication-privacy-rules",
    schema: PrivacyRulesSchema,
    signal,
  });
  return (body.rules ?? []) as CommunicationPrivacyRule[];
}

export function fetchCommunicationPolicy(
  sourceAccountId: string,
  signal?: AbortSignal,
): Promise<CommunicationPolicy> {
  return loadCommunicationPolicy(requestJson, sourceAccountId, signal);
}

export function fetchCommunicationPrivacyRules(
  signal?: AbortSignal,
): Promise<CommunicationPrivacyRule[]> {
  return loadCommunicationPrivacyRules(requestJson, signal);
}
