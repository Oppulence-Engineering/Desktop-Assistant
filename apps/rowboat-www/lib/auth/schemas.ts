import { z } from "zod";

const NonEmptyStringSchema = z.string().min(1);

/**
 * Rowboat-api's WorkOS broker token response. The API deliberately exposes the
 * same snake_case token bundle that the desktop stores so both clients can use
 * the same confidential WorkOS exchange/refresh implementation.
 */
export const WorkOSTokenBundleSchema = z.object({
  access_token: NonEmptyStringSchema,
  refresh_token: NonEmptyStringSchema.optional(),
  expires_at: z.number().int().positive(),
  token_type: z.string().min(1).default("Bearer"),
  user_id: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
});

export type WorkOSTokenBundle = z.infer<typeof WorkOSTokenBundleSchema>;

/**
 * Claims read from a WorkOS AuthKit access token for display and logout only.
 * Authorization still belongs to rowboat-api, which verifies the JWT signature
 * and resolves the actor before any dashboard data endpoint is served.
 */
export const WorkOSAccessTokenClaimsSchema = z
  .object({
    sub: z.string().optional(),
    sid: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    org_id: z.string().optional(),
    role: z.string().optional(),
    permissions: z.array(z.string()).optional(),
    exp: z.number().int().positive().optional(),
    iat: z.number().int().positive().optional(),
  })
  .passthrough();

export type WorkOSAccessTokenClaims = z.infer<typeof WorkOSAccessTokenClaimsSchema>;

/**
 * The sealed, HTTP-only browser session. It stores the rowboat-api bearer token
 * plus a refresh token so the Next server can refresh before proxying dashboard
 * requests. The browser never reads this payload directly.
 */
export const DashboardSessionCookieSchema = z.object({
  version: z.literal(1),
  accessToken: NonEmptyStringSchema,
  refreshToken: NonEmptyStringSchema.optional(),
  tokenType: z.string().min(1),
  expiresAt: z.number().int().positive(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  user: z.object({
    workosUserId: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    sessionId: z.string().optional(),
    organizationId: z.string().optional(),
    role: z.string().optional(),
    permissions: z.array(z.string()).default([]),
  }),
});

export type DashboardSessionCookie = z.infer<typeof DashboardSessionCookieSchema>;

/**
 * Short-lived PKCE state kept in an HTTP-only cookie while WorkOS redirects the
 * user through AuthKit. The state must match before rowboat-www asks rowboat-api
 * to exchange the authorization code.
 */
export const WorkOSPKCECookieSchema = z.object({
  version: z.literal(1),
  state: NonEmptyStringSchema,
  codeVerifier: NonEmptyStringSchema,
  returnTo: z.string().min(1),
  createdAt: z.number().int().positive(),
});

export type WorkOSPKCECookie = z.infer<typeof WorkOSPKCECookieSchema>;

export const WorkOSLoginURLResponseSchema = z.object({
  url: z.string().url(),
});

export const RowboatAPIErrorSchema = z
  .object({
    error: z.string().optional(),
    message: z.string().optional(),
    code: z.string().optional(),
  })
  .passthrough();

/**
 * GET /v1/me response. The auth session route calls this after login so
 * rowboat-api performs first-sight onboarding and returns the local user/billing
 * state that the dashboard can render.
 */
export const ViewerResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().email().optional().or(z.literal("")),
  }),
  billing: z
    .object({
      plan: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
      trialExpiresAt: z.string().nullable().optional(),
      usage: z.unknown().optional(),
    })
    .passthrough(),
});

export type ViewerResponse = z.infer<typeof ViewerResponseSchema>;

export const BrowserSessionResponseSchema = z.discriminatedUnion("authenticated", [
  z.object({
    authenticated: z.literal(false),
  }),
  z.object({
    authenticated: z.literal(true),
    user: z.object({
      id: z.string().optional(),
      workosUserId: z.string().optional(),
      email: z.string().optional(),
      sessionId: z.string().optional(),
      organizationId: z.string().optional(),
      role: z.string().optional(),
      permissions: z.array(z.string()).default([]),
    }),
    billing: ViewerResponseSchema.shape.billing.optional(),
    expiresAt: z.number().int().positive(),
  }),
]);

export type BrowserSessionResponse = z.infer<typeof BrowserSessionResponseSchema>;
