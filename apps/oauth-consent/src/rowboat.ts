import { z } from 'zod';
import type { Config } from './config.js';
import { hookSignatureV1, randomToken, safeEqual } from './crypto.js';
import { AppError, upstream } from './errors.js';

const TrustTierSchema = z.enum(['low', 'medium', 'high', 'money-moving']);
export type TrustTier = z.infer<typeof TrustTierSchema>;

export const ScopeDefinitionSchema = z
  .object({
    name: z.string().min(1),
    display_name: z.string().min(1),
    description: z.string().min(1),
    tier: TrustTierSchema,
    required: z.boolean(),
    requires_step_up: z.boolean(),
  })
  .strict()
  .superRefine((scope, ctx) => {
    if (scope.tier === 'money-moving' && !scope.requires_step_up) {
      ctx.addIssue({ code: 'custom', message: 'money-moving scopes must require step-up' });
    }
  });

const SafeUpgradeUrlSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'rowboat:';
    } catch {
      return false;
    }
  }, 'upgrade_url must use https or rowboat');

export const ConsentContextSchema = z
  .object({
    request_id: z.string().min(1),
    subject: z.string().min(1),
    client: z
      .object({
        id: z.string().min(1),
        display_name: z.literal('Rowboat Desktop'),
      })
      .strict(),
    connector: z
      .object({
        id: z.string().min(1),
        display_name: z.string().min(1),
        audience: z.string().min(1),
      })
      .strict(),
    scopes: z.array(ScopeDefinitionSchema).min(1),
    entitlement: z
      .object({
        allowed: z.boolean(),
        reason: z
          .enum(['no_subscription', 'scope_not_in_plan', 'user_banned', 'org_mismatch', 'connector_disabled'])
          .optional(),
        required_plan: z.string().min(1).optional(),
        upgrade_url: SafeUpgradeUrlSchema.optional(),
        message: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((context, ctx) => {
    const names = context.scopes.map((scope) => scope.name);
    if (new Set(names).size !== names.length) ctx.addIssue({ code: 'custom', message: 'duplicate scope definitions' });
    if (!context.entitlement.allowed && !context.entitlement.reason) {
      ctx.addIssue({ code: 'custom', message: 'denied entitlement requires reason' });
    }
  });

export type ConsentContext = z.infer<typeof ConsentContextSchema>;

const AuditResponseSchema = z.object({ accepted: z.literal(true) }).strict();

export type ConsentAuditEvent = 'consent.shown' | 'consent.granted' | 'consent.denied';

export interface ContextRequest {
  challenge: string;
  workosUserId: string;
  hydraClientId: string;
  requestedAudience: string[];
  requestedScopes: string[];
}

export interface AuditRequest {
  eventId?: string;
  occurredAt?: string;
  event: ConsentAuditEvent;
  sessionId: string;
  context: ConsentContext;
  scopes: string[];
  result?: string;
}

export class RowboatHooks {
  constructor(
    private readonly cfg: Config['rowboatApi'],
    private readonly timeoutMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  context(input: ContextRequest): Promise<ConsentContext> {
    return this.signedPost(
      this.cfg.contextPath,
      {
        version: 1,
        challenge: input.challenge,
        workos_user_id: input.workosUserId,
        hydra_client_id: input.hydraClientId,
        requested_audience: input.requestedAudience,
        requested_scopes: input.requestedScopes,
      },
      ConsentContextSchema,
    );
  }

  async audit(input: AuditRequest): Promise<void> {
    await this.signedPost(
      this.cfg.auditPath,
      {
        version: 1,
        event_id: input.eventId ?? randomToken(),
        event: input.event,
        occurred_at: input.occurredAt ?? new Date(this.now()).toISOString(),
        consent_session_id: input.sessionId,
        context_request_id: input.context.request_id,
        workos_user_id: input.context.subject,
        client_id: input.context.client.id,
        connector_id: input.context.connector.id,
        audience: input.context.connector.audience,
        scopes: input.scopes,
        ...(input.result ? { result: input.result } : {}),
      },
      AuditResponseSchema,
    );
  }

  private async signedPost<T>(path: string, payload: unknown, schema: z.ZodType<T>): Promise<T> {
    const body = JSON.stringify(payload);
    const timestamp = String(this.now());
    const nonce = randomToken(16);
    const endpoint = new URL(path, this.cfg.baseUrl);
    const signature = hookSignatureV1(this.cfg.hookSecret, 'POST', endpoint.pathname, timestamp, nonce, body);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-hook-timestamp': timestamp,
          'x-hook-nonce': nonce,
          'x-hook-signature': `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw upstream('rowboat_hook');
    }
    if (!response.ok) throw upstream('rowboat_hook', response.status);
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > 1_000_000) throw upstream('rowboat_hook');
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.length > 1_000_000) throw upstream('rowboat_hook');
    this.verifyResponse(response.headers, raw, nonce, endpoint.pathname);
    try {
      return schema.parse(JSON.parse(raw.toString('utf8')));
    } catch {
      throw upstream('rowboat_hook');
    }
  }

  private verifyResponse(headers: Headers, body: Buffer, requestNonce: string, path: string): void {
    const timestamp = headers.get('x-hook-timestamp') ?? '';
    const nonce = headers.get('x-hook-nonce') ?? '';
    const supplied = headers.get('x-hook-signature') ?? '';
    const signature = supplied.startsWith('sha256=') ? supplied.slice(7) : '';
    const age = Math.abs(this.now() - Number(timestamp));
    const expected = hookSignatureV1(this.cfg.hookSecret, 'POST', path, timestamp, nonce, body);
    if (
      !timestamp ||
      nonce !== requestNonce ||
      !Number.isFinite(age) ||
      age > this.cfg.signatureMaxAgeMs ||
      !safeEqual(signature, expected)
    ) {
      throw new AppError(
        502,
        'rowboat_hook_signature_invalid',
        'The authorization service is temporarily unavailable.',
      );
    }
  }
}
