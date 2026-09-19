import { z } from "zod";

import {
  StartRevenueLeakScan202Response,
  StartRevenueLeakScanBody,
} from "@/lib/api/generated/zod/revenue/revenue";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const StartRevenueLeakScanInputSchema = StartRevenueLeakScanBody;

export type StartRevenueLeakScanInput = z.infer<typeof StartRevenueLeakScanInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Start revenue leak scan. Validates the response with
 * StartRevenueLeakScan202Response. Do not cast the parsed result. Owned by `use-start-revenue-leak-scan.lit.ts`.
 */
export function startRevenueLeakScanPath(): string {
  return "/revenue-leak-scans";
}

export async function loadStartRevenueLeakScan(
  request: RequestJsonFn,
  body: StartRevenueLeakScanInput,
  signal?: AbortSignal,
) {
  return request({
    path: startRevenueLeakScanPath(),
    method: "POST",
    schema: StartRevenueLeakScan202Response,
    body,
    signal,
  });
}

export function fetchStartRevenueLeakScan(body: StartRevenueLeakScanInput, signal?: AbortSignal) {
  return loadStartRevenueLeakScan(requestJson, body, signal);
}
