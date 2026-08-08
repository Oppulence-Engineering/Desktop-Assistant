import { ProviderV2 } from "@ai-sdk/provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { randomUUID } from "node:crypto";
import { getAccessToken } from "../auth/tokens.js";
import { getCurrentUseCase } from "../analytics/use_case.js";
import { API_URL } from "../config/env.js";
import { isInteractive, throughBackgroundBudget } from "./gateway-budget.js";

/**
 * Bearer-attaching fetch for the product gateway. Exported for tests: the
 * queue-wait behaviour below is only observable from outside the AI SDK.
 */
export const authedFetch: typeof fetch = async (input, init) => {
  // Read the analytics context here, not inside send(): it comes from an async
  // local store, and the queue invokes send() from its own context later.
  const ctx = getCurrentUseCase();
  // Stable across the queue wait — one key per HTTP request, as before. The AI
  // SDK retries by re-entering authedFetch, so each retry still gets its own.
  const idempotencyKey = randomUUID();

  // The bearer is minted at send time rather than at queue time.
  //
  // Access tokens here live minutes, and isTokenExpired only looks 60s ahead,
  // so a token can be handed out with a minute of life left. Background work
  // then waits in the budget queue — which, during a backlog, is far longer
  // than that. Every one of those requests went out with a bearer that had
  // expired while it waited, and the gateway answered 401 to all of them at
  // once as the queue drained.
  //
  // This is the same hazard the embeddings path already documents for its
  // abort timer: anything captured before the queue has to survive the wait,
  // and a bearer does not.
  //
  // Moving the call also means an AuthUnavailableError now surfaces from inside
  // the queue and counts toward the circuit breaker. That is the behaviour the
  // breaker asks for — it explicitly counts "401 when auth is dead" as the kind
  // of permanent client-side failure it exists to stop — and previously a
  // bricked session threw before queueing and was never counted at all.
  const send = async (): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${await getAccessToken()}`);
    // The metered LLM proxy requires an idempotency key per request
    // (httpx.RequireIdempotencyKey → 428 without it), same as the voice proxy.
    if (!headers.has("Idempotency-Key")) headers.set("Idempotency-Key", idempotencyKey);
    if (ctx?.useCase) headers.set("x-solomon-use-case", ctx.useCase);
    if (ctx?.subUseCase) headers.set("x-solomon-sub-use-case", ctx.subUseCase);
    if (ctx?.agentName) headers.set("x-solomon-agent-name", ctx.agentName);
    return fetch(input, { ...init, headers });
  };

  // Someone is waiting on this one — send it now. Background work is capped at
  // half the gateway budget precisely so this path always has room.
  if (isInteractive(ctx?.useCase, ctx?.subUseCase)) {
    return send();
  }
  // Queued per HTTP request, not per generateText call: the AI SDK retries
  // inside that call, so each retry re-enters here and is counted against the
  // budget rather than riding along on one already-granted slot.
  return throughBackgroundBudget(send);
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
  // Shares the /v1/llm limiter with chat and embeddings, so it draws on the
  // same budget — nobody is blocked on a model catalog refresh. The bearer is
  // minted inside the queued callback for the same reason as in authedFetch:
  // one taken before the wait can expire during it.
  const response = await throughBackgroundBudget(async () =>
    fetch(`${API_URL}/v1/llm/models`, {
      headers: { Authorization: `Bearer ${await getAccessToken()}` },
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
