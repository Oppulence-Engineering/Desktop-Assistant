import { randomBytes } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Config } from './config.js';
import { checkEntitlement } from './entitlement.js';
import { OryAdmin } from './ory.js';
import { WorkOS } from './workos.js';

const NONCE_COOKIE = 'consent_nonce';

// The opaque `state` round-tripped through WorkOS: a base64url-encoded JSON blob
// carrying the Ory login challenge and a CSRF nonce we match against the cookie.
const StateSchema = z.object({
  challenge: z.string(),
  nonce: z.string(),
});
type State = z.infer<typeof StateSchema>;

// rowboat-api is the first-party audience and is never gated for connection.
const FIRST_PARTY_AUDIENCE = 'rowboat-api';

export function buildApp(cfg: Config): Express {
  const app = express();
  const ory = new OryAdmin(cfg.ory.adminUrl);
  const workos = new WorkOS(cfg.workos);

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Step 1: Ory delegates login here. Federate to WorkOS.
  app.get('/login', asyncHandler(async (req, res) => {
    const challenge = String(req.query.login_challenge ?? '');
    if (!challenge) return res.status(400).send('missing login_challenge');

    const login = await ory.getLoginRequest(challenge);
    if (login.skip) {
      const { redirect_to } = await ory.acceptLogin(challenge, login.subject);
      return res.redirect(redirect_to);
    }

    const nonce = randomBytes(16).toString('hex');
    const state = b64url(JSON.stringify({ challenge, nonce }));
    res.cookie(NONCE_COOKIE, nonce, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600_000 });
    return res.redirect(await workos.authorizeURL(state));
  }));

  // Step 2: WorkOS redirects back. Verify, then accept the Ory login.
  app.get('/callback', asyncHandler(async (req, res) => {
    const code = String(req.query.code ?? '');
    const state = String(req.query.state ?? '');
    if (!code || !state) return res.status(400).send('missing code/state');

    let parsed: State;
    try {
      parsed = StateSchema.parse(JSON.parse(fromB64url(state)));
    } catch {
      return res.status(400).send('bad state');
    }
    if (parsed.nonce !== cookie(req, NONCE_COOKIE)) {
      return res.status(400).send('state/nonce mismatch');
    }

    const user = await workos.exchange(code);
    if (!user.workosUserId) return res.status(401).send('no subject from idp');

    res.clearCookie(NONCE_COOKIE);
    const { redirect_to } = await ory.acceptLogin(parsed.challenge, user.workosUserId);
    return res.redirect(redirect_to);
  }));

  // Step 3: Ory asks for consent. Gate connector audiences by entitlement.
  app.get('/consent', asyncHandler(async (req, res) => {
    const challenge = String(req.query.consent_challenge ?? '');
    if (!challenge) return res.status(400).send('missing consent_challenge');

    const consent = await ory.getConsentRequest(challenge);
    const audiences = consent.requested_access_token_audience ?? [];

    for (const aud of audiences) {
      if (aud === FIRST_PARTY_AUDIENCE) continue;
      const ent = await checkEntitlement(cfg.rowboatApi, consent.subject, aud);
      if (!ent.allow) {
        return res.status(200).send(upsellPage(aud, ent.upsell?.requiredPlan, ent.upsell?.message));
      }
    }

    const { redirect_to } = await ory.acceptConsent(challenge, {
      grantScope: consent.requested_scope ?? [],
      grantAudience: audiences,
      workosUserId: consent.subject,
    });
    return res.redirect(redirect_to);
  }));

  // Step 4: logout.
  app.get('/logout', asyncHandler(async (req, res) => {
    const challenge = String(req.query.logout_challenge ?? '');
    if (!challenge) return res.status(400).send('missing logout_challenge');
    const { redirect_to } = await ory.acceptLogout(challenge);
    return res.redirect(redirect_to);
  }));

  return app;
}

// --- helpers ---------------------------------------------------------------

type AsyncRoute = (req: Request, res: Response) => Promise<unknown>;
function asyncHandler(fn: AsyncRoute) {
  return (req: Request, res: Response): void => {
    fn(req, res).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('consent error:', err);
      if (!res.headersSent) res.status(500).send('internal error');
    });
  };
}

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}
function fromB64url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}
function cookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function upsellPage(audience: string, plan?: string, message?: string): string {
  const safePlan = escapeHtml(plan ?? 'a paid');
  const safeMsg = escapeHtml(message ?? `Upgrade to ${safePlan} to connect this product.`);
  const safeAud = escapeHtml(audience);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Upgrade required</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:5rem auto;padding:0 1rem;color:#111}
.card{border:1px solid #e5e7eb;border-radius:12px;padding:2rem}a.btn{display:inline-block;margin-top:1rem;background:#111;color:#fff;padding:.6rem 1.2rem;border-radius:8px;text-decoration:none}</style>
</head><body><div class="card"><h1>Upgrade required</h1>
<p>${safeMsg}</p><p style="color:#6b7280">Connector: ${safeAud} · Required plan: ${safePlan}</p>
<a class="btn" href="https://app.solomon-ai.co/billing">Upgrade plan</a></div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
