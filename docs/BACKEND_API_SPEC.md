# Rowboat Desktop Backend API Specification

> Target: a replacement for `https://api.x.rowboatlabs.com` that the forked desktop app (`apps/x`) can point at via the `API_URL` env var (`apps/x/packages/core/src/config/env.ts:1`).

This document is derived from grepping every `API_URL` call site in `apps/x/packages/core/src/`. If the desktop client adds a new call, this spec needs an update.

---

## Table of contents

1. [Scope and non-goals](#1-scope-and-non-goals)
2. [Recommended placement](#2-recommended-placement-oppulence-canvasappsx-api)
3. [Cross-cutting concerns](#3-cross-cutting-concerns)
4. [Endpoint reference](#4-endpoint-reference)
   - 4.1 [`GET /v1/config`](#41-get-v1config)
   - 4.2 [`GET /v1/me`](#42-get-v1me)
   - 4.3 [`POST /v1/google-oauth/claim`](#43-post-v1google-oauthclaim)
   - 4.4 [`POST /v1/google-oauth/refresh`](#44-post-v1google-oauthrefresh)
   - 4.5 [`POST /v1/llm/*` — OpenRouter-compatible LLM gateway](#45-post-v1llm--openrouter-compatible-llm-gateway)
   - 4.6 [`GET /v1/llm/models`](#46-get-v1llmmodels)
   - 4.7 [`POST /v1/voice/text-to-speech/{voiceId}`](#47-post-v1voicetext-to-speechvoiceid)
   - 4.8 [`POST /v1/search/exa`](#48-post-v1searchexa)
   - 4.9 [`* /v1/composio/*`](#49--v1composio--composio-passthrough-proxy)
5. [Out-of-band integrations](#5-out-of-band-integrations-not-this-api)
6. [Storage model](#6-storage-model)
7. [Build order](#7-build-order)
8. [Open questions](#8-open-questions)

---

## 1. Scope and non-goals

**In scope:** every endpoint the desktop client calls on `API_URL` today.

**Not in scope:**
- The legacy Rowboat web platform (`apps/rowboat`) — different product, different API surface.
- Sign-in / Supabase auth itself — desktop holds Supabase access tokens directly via its Supabase client. This backend just *verifies* them.
- PostHog — desktop sends events directly to PostHog Cloud.
- ElevenLabs / Deepgram / Exa / Composio direct mode — desktop falls back to direct API calls with user-supplied keys when not signed in.

## 2. Recommended placement: `oppulence-canvas/apps/x-api`

Built on the patterns established by `oppulence-canvas/packages/api`:

| Concern | Use |
|---------|-----|
| Runtime | Bun |
| HTTP framework | Hono |
| Auth | Supabase JWT verification (same provider Canvas already uses) |
| DB | `@oppulence/db` (Postgres + Drizzle) |
| Secrets at rest | `@oppulence/encryption` (for stored OAuth refresh tokens) |
| Cache | `@oppulence/cache` (Redis) for `/v1/config` and per-user quota counters |
| Observability | OpenTelemetry via `@oppulence/tracing` |
| Deploy | Fly.io, mirror `packages/api/fly.toml` |
| Tests | testcontainers (`@oppulence/testcontainers`) |

## 3. Cross-cutting concerns

### 3.1 Authentication

Every endpoint *except* `GET /v1/config` requires a Supabase bearer token in `Authorization: Bearer <jwt>`. The desktop client gets this from its embedded Supabase client (`apps/x/packages/core/src/auth/tokens.ts`).

Verification: validate signature against Supabase JWKS; reject expired tokens with `401`. Trust the `sub` claim as the canonical user id; mirror it into our own `users` table on first call.

### 3.2 Telemetry headers

LLM gateway calls carry these headers (set by `apps/x/packages/core/src/models/gateway.ts:11-13`):

| Header | Meaning |
|--------|---------|
| `x-rowboat-use-case` | Coarse-grained product surface (`chat`, `live-note`, `agent`, etc.) |
| `x-rowboat-sub-use-case` | Fine-grained (`note-creation`, `inbox-summary`, etc.) |
| `x-rowboat-agent-name` | Specific agent slug when an agent-style use-case is active |

These should be persisted on usage records for product analytics and per-feature cost allocation.

### 3.3 Billing & quotas

`/v1/me` returns sanctioned + available credits. The desktop client renders these and gates features client-side, but the backend MUST enforce server-side:

- Decrement available credits on every `/v1/llm/*` and `/v1/voice/*` and `/v1/search/exa` call.
- Pricing: per-1k-input-token / per-1k-output-token rates per model; flat charge per voice character; flat charge per Exa query. Source of truth lives in a `pricing` table.
- When `availableCredits <= 0`: return `402 Payment Required` with `{ "error": "insufficient_credits" }`.

### 3.4 Error envelope

```json
{ "error": "human_readable_message", "code": "machine_readable_slug" }
```

`google-oauth/refresh` adds an additional `reconnectRequired: boolean` field (consumed by `apps/x/packages/core/src/auth/google-backend-oauth.ts:100-103`).

### 3.5 Rate limits

Suggested: 60 req/min per user for LLM gateway, 30/min for voice, 60/min for Exa, 120/min for Composio. Return `429` with `Retry-After`.

---

## 4. Endpoint reference

### 4.1 `GET /v1/config`

**Auth:** none (public).

**Response 200:**
```json
{
  "appUrl": "https://app.solomon-ai.co",
  "supabaseUrl": "https://xxxxx.supabase.co",
  "websocketApiUrl": "wss://realtime.solomon-ai.co"
}
```

- `appUrl` is REQUIRED — the desktop bombs out without it (`apps/x/packages/core/src/config/remote-config.ts:28-30`).
- `supabaseUrl` and `websocketApiUrl` may be empty strings.

**Caller:** `remote-config.ts:23`, `config/rowboat.ts:11`. Used to discover the OAuth-callback webapp URL.

**Caching:** Desktop caches the response in-process; safe to set `Cache-Control: public, max-age=300`.

---

### 4.2 `GET /v1/me`

**Auth:** Supabase bearer.

**Response 200:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  },
  "billing": {
    "plan": "free" | "pro" | "team" | null,
    "status": "active" | "trialing" | "past_due" | "canceled" | null,
    "trialExpiresAt": "2026-06-01T00:00:00.000Z" | null,
    "usage": {
      "sanctionedCredits": 10000,
      "availableCredits": 8421
    }
  }
}
```

**Caller:** `apps/x/packages/core/src/billing/billing.ts:7`. Read shape from line 13-27 of that file.

**Notes:**
- `plan` values must match `BillingPlan` in `apps/x/packages/shared/src/billing.ts`.
- Credits are integer "units" — concrete dollar-to-unit conversion is a backend-side decision.

---

### 4.3 `POST /v1/google-oauth/claim`

Used in the "rowboat-mode" Google OAuth handoff: the webapp completes the OAuth dance, *parks* tokens keyed by a `state` ticket, and the desktop redeems that ticket here.

**Auth:** Supabase bearer.

**Request:**
```json
{ "session": "opaque-state-string-from-deeplink" }
```

**Response 200:**
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": 1735689600,
  "scope": "openid email https://www.googleapis.com/auth/gmail.readonly",
  "token_type": "Bearer"
}
```

`expires_at` is seconds-since-epoch. `scope` is space-delimited. `refresh_token` may be absent on rare Google responses (caller handles that).

**Error 4xx:**
```json
{ "error": "ticket_expired" }
```

**Caller:** `auth/google-backend-oauth.ts:82`.

**Storage:** Parked tickets live in `oauth_pending` with a short TTL (10 min). Reading consumes the row. The webapp inserts it after its callback succeeds.

---

### 4.4 `POST /v1/google-oauth/refresh`

The refresh step holds the Google OAuth *client secret*, so it can't run on the desktop.

**Auth:** Supabase bearer.

**Request:**
```json
{ "refreshToken": "1//0g..." }
```

**Response 200:** Same shape as `/claim`. Google often omits `refresh_token` and `scope` on refresh; caller preserves the previous values.

**Response 409:** Google `invalid_grant` (user revoked, refresh token expired).
```json
{
  "error": "Google reports invalid_grant; user must reconnect.",
  "reconnectRequired": true
}
```

The `reconnectRequired: true` field is required — the desktop branches on it (`google-backend-oauth.ts:101-103`) and throws a typed `ReconnectRequiredError`.

**Caller:** `auth/google-backend-oauth.ts:99`.

---

### 4.5 `POST /v1/llm/*` — OpenRouter-compatible LLM gateway

**This is the largest surface and the highest-cost path.** The desktop wraps it with `createOpenRouter()` from `@openrouter/ai-sdk-provider` (`models/gateway.ts:19-23`), which sends OpenRouter-style requests (which themselves are OpenAI-compatible).

**Auth:** Supabase bearer.

**Required telemetry headers:** see [§3.2](#32-telemetry-headers).

**Compatible endpoints to implement:**
- `POST /v1/llm/chat/completions` (primary)
- `POST /v1/llm/completions`
- `POST /v1/llm/embeddings` (if used)

**Request body** mirrors OpenAI Chat Completions:
```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 4000,
  "tools": [ ... ],
  "tool_choice": "auto"
}
```

**Streaming:** When `stream: true`, return `text/event-stream` with `data: { ... }\n\n` chunks terminated by `data: [DONE]\n\n`. Match OpenAI's delta envelope.

**Provider routing:** Internally, key the `model` string to an upstream:
- `anthropic/*` → Anthropic API
- `openai/*` → OpenAI API
- `google/*` → Vertex / Gemini API
- `openrouter/*` → OpenRouter passthrough
- (extend as needed)

**Quota gate:** Read `messages` token count + estimated output; if available credits would go negative, return `402` BEFORE proxying upstream. After upstream response, decrement actual tokens used.

**Cost recording:** Insert a row in `llm_usage` per call:
```
(user_id, ts, model, use_case, sub_use_case, agent_name, input_tokens, output_tokens, cost_units, request_id)
```

---

### 4.6 `GET /v1/llm/models`

**Auth:** Supabase bearer.

**Response 200:** OpenAI-compatible list envelope:
```json
{
  "data": [
    { "id": "anthropic/claude-sonnet-4-5" },
    { "id": "openai/gpt-4.1" },
    { "id": "google/gemini-2.5-pro" }
  ]
}
```

**Caller:** `models/gateway.ts:38-52`. Desktop only reads `id` from each row, so additional fields are tolerated but not required.

---

### 4.7 `POST /v1/voice/text-to-speech/{voiceId}`

ElevenLabs proxy. `voiceId` is the ElevenLabs voice id; default desktop falls back to `UgBBYS2sOqTuMpoF3BR0` (`voice.ts:43`).

**Auth:** Supabase bearer.

**Request:**
```json
{
  "text": "Hello, world.",
  "model_id": "eleven_flash_v2_5",
  "voice_settings": { "stability": 0.5, "similarity_boost": 0.75 }
}
```

**Response 200:**
- `Content-Type: audio/mpeg`
- Raw audio bytes (desktop base64-encodes for transport across IPC; we just emit bytes).

**Quota gate:** Decrement credits by `Math.ceil(text.length * VOICE_RATE)`.

**Caller:** `voice/voice.ts:45`.

**Implementation:** Pass-through to ElevenLabs `/v1/text-to-speech/{voiceId}` with our server-held `xi-api-key`.

---

### 4.8 `POST /v1/search/exa`

Exa Search proxy.

**Auth:** Supabase bearer.

**Request:** Pass-through to Exa's `POST /search`. Shape (subset):
```json
{
  "query": "...",
  "num_results": 10,
  "use_autoprompt": true,
  "type": "auto",
  "contents": { "text": true }
}
```

**Response:** Pass-through Exa response.

**Quota gate:** Flat charge per call.

**Caller:** `application/lib/builtin-tools.ts:1377`.

**Implementation:** Forward to `https://api.exa.ai/search` with our server-held `x-api-key`.

---

### 4.9 `* /v1/composio/*` — Composio passthrough proxy

Most complex non-LLM surface. Maps to `https://backend.composio.dev/api/v3/*`.

**Auth:** Supabase bearer; swap to our server-held `x-api-key` upstream.

**Routes consumed by the desktop** (from `composio/client.ts`):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/composio/toolkits` | List toolkits (with `sort_by`, optional `cursor`) |
| GET | `/v1/composio/toolkits/{slug}` | Toolkit detail |
| GET | `/v1/composio/auth_configs` | List auth configs (`toolkit_slug`, `cursor`, `is_composio_managed`) |
| POST | `/v1/composio/auth_configs` | Create auth config |
| POST | `/v1/composio/connected_accounts` | Create connected account |
| GET | `/v1/composio/connected_accounts/{id}` | Get connected account |
| DELETE | `/v1/composio/connected_accounts/{id}` | Delete connected account |
| GET | `/v1/composio/tools` | Search tools (`query`, `limit`, optional `toolkit_slug`) |
| POST | `/v1/composio/tools/execute/{actionSlug}` | Execute a tool action |

**Request bodies / response shapes:** match Composio v3 exactly. Don't translate.

**Scope hardening:** at minimum, enforce that `connected_accounts` and `auth_configs` are scoped to the authenticated user — Composio's tenancy maps to a Composio account that we hold per-user.

---

## 5. Out-of-band integrations (not this API)

These integrations are direct from the desktop and don't go through our backend, but you should know about them:

| System | How desktop reaches it | Notes |
|--------|------------------------|-------|
| **Supabase** | Direct, via Supabase client | Auth source of truth. Desktop holds access + refresh tokens. Backend only *verifies* the JWTs. |
| **PostHog** | Direct via `posthog-node` | Analytics + exception capture. Not proxied. |
| **Stripe** | Webapp (not desktop), via Polar fork | Billing source. Stripe → Polar → our DB. Desktop reads results via `/v1/me`. |
| **Google OAuth** | Webapp callback parks tokens; desktop redeems via [§4.3](#43-post-v1google-oauthclaim)/[§4.4](#44-post-v1google-oauthrefresh) | Web side holds OAuth client secret. |
| **ElevenLabs / Deepgram / Exa / Composio (signed-out)** | Desktop calls vendors directly with user-supplied keys from `~/.rowboat/config/*.json` | Fallback path. Backend only fronts these when user is *signed in*. |

## 6. Storage model

Minimum tables to support the surface above:

```
users               (id, email, supabase_sub, created_at)
oauth_pending       (state, user_id, payload_encrypted, expires_at)        — for /v1/google-oauth/claim
oauth_google        (user_id, refresh_token_encrypted, scopes, updated_at) — Google refresh storage
billing_plans       (id, name, sanctioned_credits, price_cents, ...)
user_subscriptions  (user_id, plan_id, status, trial_expires_at, ...)
credit_ledger       (id, user_id, delta, reason, ts, request_id)            — append-only
llm_usage           (id, user_id, ts, model, use_case, sub_use_case, agent_name, input_tokens, output_tokens, cost_units, request_id)
composio_links      (user_id, composio_account_id)                          — map our user → Composio entity
api_keys_vault      (user_id, vendor, encrypted_key)                        — server-held vendor keys per pool
rate_limits         (user_id, bucket, window_start, count)                  — or Redis-only
```

`credit_ledger` is append-only; `available_credits` is computed as `SUM(delta)`.

## 7. Build order

A staged rollout that gives the desktop usable functionality the fastest:

1. **Skeleton** — `apps/x-api` scaffolded in Canvas, Hono routing, Supabase JWT verification, OpenTel wired. Deploy a stub `/v1/config` and `/v1/me` returning hardcoded values.
2. **LLM gateway** — `/v1/llm/chat/completions` + `/v1/llm/models`, single provider (OpenAI), streaming. Credits enforced. This unblocks the entire desktop product.
3. **Billing real** — Stripe → Polar → `user_subscriptions` + `credit_ledger`; `/v1/me` reads from DB. Trial logic + paywall behavior. Top-up flow if applicable.
4. **Voice + Exa** — `/v1/voice/text-to-speech/{voiceId}` and `/v1/search/exa`. Cheap, isolated, optional features.
5. **Google OAuth** — `/v1/google-oauth/claim` + `/refresh`. Requires the webapp callback to also exist (parks the ticket).
6. **Composio proxy** — Last because the per-route surface is wide and most desktop features still work without it.

Step 1–2 alone is enough to make the desktop usable against your own backend. Everything else is incremental.

## 8. Open questions

Things this spec can't answer without product input:

1. **Pricing model.** Per-1k-token rates per model; voice/Exa flat charges; trial-vs-paid credit caps.
2. **Multi-tenancy.** Are users in this product tied to a Canvas `team_id`, or are they separate accounts? Affects `/v1/me` shape and Composio scoping.
3. **Free tier behavior.** Does an unauthenticated desktop see *any* of our backend, or only `/v1/config`? Current desktop falls back to direct vendor calls when not signed in.
4. **Model catalog source.** Do we hardcode the supported model list, mirror models.dev, or expose admin tooling to manage it?
5. **Streaming infra.** Hono streaming works for chat completions; if voice/Composio ever needs SSE or WS, the deploy target needs to support long-lived connections (Fly.io: fine; Lambda: not).
6. **Composio tenancy.** One shared Composio account with our key, or one Composio account per user? Affects `composio_links` and connected-account isolation.
