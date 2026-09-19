import { z } from "zod";

import {
  CreateRevenueAction201Response,
  CreateRevenueActionBody,
} from "@/lib/api/generated/zod/revenue/revenue";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const CreateRevenueActionInputSchema = CreateRevenueActionBody;

export type CreateRevenueActionInput = z.infer<typeof CreateRevenueActionInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Create revenue action. Validates the response with
 * CreateRevenueAction201Response. Do not cast the parsed result. Owned by `use-create-revenue-action.lit.ts`.
 */
export function createRevenueActionPath(): string {
  return "/revenue-actions";
}

export async function loadCreateRevenueAction(
  request: RequestJsonFn,
  body: CreateRevenueActionInput,
  signal?: AbortSignal,
) {
  return request({
    path: createRevenueActionPath(),
    method: "POST",
    schema: CreateRevenueAction201Response,
    body,
    signal,
  });
}

export function fetchCreateRevenueAction(body: CreateRevenueActionInput, signal?: AbortSignal) {
  return loadCreateRevenueAction(requestJson, body, signal);
}
