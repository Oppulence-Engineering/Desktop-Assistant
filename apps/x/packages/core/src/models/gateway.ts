import { ProviderV2 } from "@ai-sdk/provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { randomUUID } from "node:crypto";
import { getAccessToken } from "../auth/tokens.js";
import { getCurrentUseCase } from "../analytics/use_case.js";
import { API_URL } from "../config/env.js";
import { isInteractive, throughBackgroundBudget } from "./gateway-budget.js";

const authedFetch: typeof fetch = async (input, init) => {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  // The metered LLM proxy requires an idempotency key per request
  // (httpx.RequireIdempotencyKey → 428 without it), same as the voice proxy.
  if (!headers.has("Idempotency-Key")) headers.set("Idempotency-Key", randomUUID());
  const ctx = getCurrentUseCase();
  if (ctx?.useCase) headers.set("x-solomon-use-case", ctx.useCase);
  if (ctx?.subUseCase) headers.set("x-solomon-sub-use-case", ctx.subUseCase);
  if (ctx?.agentName) headers.set("x-solomon-agent-name", ctx.agentName);

  // Someone is waiting on this one — send it now. Background work is capped at
  // half the gateway budget precisely so this path always has room.
  if (isInteractive(ctx?.useCase, ctx?.subUseCase)) {
    return fetch(input, { ...init, headers });
  }
  // Queued per HTTP request, not per generateText call: the AI SDK retries
  // inside that call, so each retry re-enters here and is counted against the
  // budget rather than riding along on one already-granted slot.
  return throughBackgroundBudget(() => fetch(input, { ...init, headers }));
};

export function getGatewayProvider(): ProviderV2 {
  return createOpenRouter({
    baseURL: `${API_URL}/v1/llm`,
    apiKey: "managed-by-solomon",
    fetch: authedFetch,
  });
}

type ProviderSummary = {
  id: string;
  name: string;
  models: Array<{
    id: string;
    name?: string;
    release_date?: string;
  }>;
};

export async function listGatewayModels(): Promise<{ providers: ProviderSummary[] }> {
  const accessToken = await getAccessToken();
  // Shares the /v1/llm limiter with chat and embeddings, so it draws on the
  // same budget — nobody is blocked on a model catalog refresh.
  const response = await throughBackgroundBudget(() =>
    fetch(`${API_URL}/v1/llm/models`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  );
  if (!response.ok) {
    throw new Error(`Gateway /v1/models failed: ${response.status}`);
  }
  const body = (await response.json()) as { data: Array<{ id: string }> };
  const models = body.data.map((m) => ({ id: m.id }));
  return {
    providers: [
      {
        id: "solomon",
        name: "Solomon AI",
        models,
      },
    ],
  };
}
