import {
  GetRevenueDigest200Response,
  GetRevenueImpact200Response,
} from "@/lib/api/generated/zod/revenue/revenue";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";
import type { RevenueDigest, RevenueImpact } from "@/lib/revenue/types";

const IMPACT_PATH = "/revenue-impact";
const DIGEST_PATH = "/revenue-digest";

function numberRecord(value: Record<string, unknown> | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, item] of Object.entries(value ?? {})) {
    if (typeof item === "number" && Number.isFinite(item)) counts[key] = item;
  }
  return counts;
}

export async function loadImpact(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<RevenueImpact> {
  const impact = await request({
    path: IMPACT_PATH,
    schema: GetRevenueImpact200Response,
    signal,
  });
  return {
    surfaced: impact.surfaced,
    open: impact.open,
    handled: impact.handled,
    snoozed: impact.snoozed ?? 0,
    dismissed: impact.dismissed ?? 0,
    approved: impact.approved,
    executed: impact.executed,
    replied: impact.replied ?? 0,
    meetingsBooked: impact.meetingsBooked ?? 0,
    won: impact.won ?? 0,
    lost: impact.lost ?? 0,
    replyRate: impact.replyRate ?? null,
    meetingRate: impact.meetingRate ?? null,
    outcomes: numberRecord(impact.outcomes),
    byDetector: (impact.byDetector ?? []).map((row) => ({
      detector: row.detector ?? "",
      surfaced: row.surfaced ?? 0,
      handled: row.handled ?? 0,
    })),
    relationships: impact.relationships ?? 0,
    atRiskRelationships: impact.atRiskRelationships ?? 0,
    criticalRelationships: impact.criticalRelationships ?? 0,
    portfolioRiskScore: impact.portfolioRiskScore ?? 0,
    overdueCommitments: impact.overdueCommitments ?? 0,
    overdueByUs: impact.overdueByUs ?? 0,
    overdueByThem: impact.overdueByThem ?? 0,
    longestOverdueDays: impact.longestOverdueDays ?? 0,
    riskReasons: impact.riskReasons ?? [],
  };
}

export async function loadDigest(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<RevenueDigest> {
  return request({
    path: DIGEST_PATH,
    schema: GetRevenueDigest200Response,
    signal,
  });
}

export function fetchImpact(signal?: AbortSignal): Promise<RevenueImpact> {
  return loadImpact(requestJson, signal);
}

export function fetchDigest(signal?: AbortSignal): Promise<RevenueDigest> {
  return loadDigest(requestJson, signal);
}
