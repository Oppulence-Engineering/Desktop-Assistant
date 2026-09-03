import type { ConsentSession } from './state.js';
import type { TrustTier } from './rowboat.js';

const TIER_ORDER: TrustTier[] = ['low', 'medium', 'high', 'money-moving'];
const TIER_LABELS: Record<TrustTier, string> = {
  low: 'Low trust',
  medium: 'Medium trust',
  high: 'High trust',
  'money-moving': 'Money-moving',
};

export function consentPage(session: ConsentSession): string {
  const { context } = session;
  const grouped = TIER_ORDER.map((tier) => ({
    tier,
    scopes: context.scopes.filter((scope) => scope.tier === tier),
  })).filter(({ scopes }) => scopes.length > 0);
  const hasHigh = context.scopes.some((scope) => scope.tier === 'high' || scope.tier === 'money-moving');
  const hasStepUp = context.scopes.some((scope) => scope.requires_step_up);
  const scopeGroups = grouped
    .map(
      ({ tier, scopes }) => `<section class="scope-group" data-tier="${tier}">
        <h2>${TIER_LABELS[tier]}</h2>
        ${scopes.map(renderScope).join('')}
      </section>`,
    )
    .join('');
  const confirmation = hasHigh
    ? `<label class="confirmation"><input type="checkbox" name="confirm_high" value="yes"> <span>I understand that the selected high-trust access can make consequential changes.</span></label>`
    : '';
  const stepUp = hasStepUp
    ? '<p class="notice">Money-moving access requires a separate multi-factor verification before Rowboat can approve it.</p>'
    : '';
  return layout(
    `Connect ${escapeHtml(context.connector.display_name)}`,
    `<main class="card">
      ${identityHeader(session)}
      <p class="lede">Choose the access to grant.</p>
      <form method="post" action="/consent/decision">
        <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
        ${scopeGroups}
        ${stepUp}
        ${confirmation}
        <div class="actions">
          <button class="primary" type="submit" name="decision" value="approve">Approve selected access</button>
          <button class="secondary" type="submit" name="decision" value="deny">Deny</button>
        </div>
      </form>
    </main>`,
  );
}

export function entitlementDeniedPage(session: ConsentSession): string {
  const { context } = session;
  const entitlement = context.entitlement;
  const message = entitlement.message ? `<p>${escapeHtml(entitlement.message)}</p>` : '';
  const plan = entitlement.required_plan
    ? `<p class="meta">Required plan: <strong>${escapeHtml(entitlement.required_plan)}</strong></p>`
    : '';
  const upgrade = entitlement.upgrade_url
    ? `<a class="primary link" rel="noreferrer" href="${escapeHtml(entitlement.upgrade_url)}">View plan options</a>`
    : '';
  return layout(
    'Connection unavailable',
    `<main class="card denial" data-entitlement-reason="${escapeHtml(entitlement.reason ?? '')}">
      ${identityHeader(session)}
      <h2>Connection unavailable</h2>
      ${message}
      ${plan}
      <p class="meta">Reason: ${escapeHtml(entitlement.reason ?? 'not_allowed')}</p>
      <form method="post" action="/consent/decision">
        <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
        <input type="hidden" name="decision" value="deny">
        <div class="actions">${upgrade}<button class="secondary" type="submit">Return without connecting</button></div>
      </form>
    </main>`,
  );
}

export function errorPage(message: string, code: string): string {
  return layout(
    'Authorization could not continue',
    `<main class="card error"><h1>Authorization could not continue</h1><p>${escapeHtml(message)}</p><p class="meta">Reference: ${escapeHtml(code)}</p></main>`,
  );
}

function identityHeader(session: ConsentSession): string {
  const { connector, client } = session.context;
  return `<div class="identities">
    <div class="identity"><span class="eyebrow">Product</span><strong>${escapeHtml(connector.display_name)}</strong></div>
    <div class="arrow" aria-hidden="true">→</div>
    <div class="identity"><span class="eyebrow">Client</span><strong>${escapeHtml(client.display_name)}</strong></div>
  </div>`;
}

function renderScope(scope: ConsentSession['context']['scopes'][number]): string {
  const control = scope.required
    ? `<input type="hidden" name="scope" value="${escapeHtml(scope.name)}"><input type="checkbox" checked disabled aria-label="Required scope">`
    : `<input type="checkbox" name="scope" value="${escapeHtml(scope.name)}" aria-label="Optional scope">`;
  return `<label class="scope" data-scope="${escapeHtml(scope.name)}" data-required="${scope.required}">
    ${control}
    <span><strong>${escapeHtml(scope.display_name)}</strong><span class="badge">${scope.required ? 'Required' : 'Optional'}</span>
    <small>${escapeHtml(scope.description)}</small></span>
  </label>`;
}

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title><style>
  :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f4ef;color:#171713}
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px;background:radial-gradient(circle at top,#fff 0,#f5f4ef 55%)}
  .card{width:min(680px,100%);background:#fff;border:1px solid #deddd5;border-radius:20px;padding:32px;box-shadow:0 24px 70px rgba(31,30,24,.09)}
  .identities{display:grid;grid-template-columns:1fr auto 1fr;gap:18px;align-items:center;padding-bottom:24px;border-bottom:1px solid #ecebe5}.identity{display:flex;flex-direction:column;gap:5px}.eyebrow{text-transform:uppercase;letter-spacing:.11em;font-size:11px;color:#706f67}.arrow{color:#96948a}.lede{font-size:18px;margin:26px 0}.scope-group{margin:24px 0}.scope-group h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#64635c}.scope{display:grid;grid-template-columns:22px 1fr;gap:12px;padding:16px 0;border-top:1px solid #efeee8}.scope input{margin-top:3px}.scope strong{font-size:15px}.scope small{display:block;margin-top:5px;color:#64635c;line-height:1.45}.badge{margin-left:9px;padding:3px 7px;border-radius:999px;background:#eeede7;color:#55544e;font-size:10px;text-transform:uppercase;letter-spacing:.05em}.notice,.confirmation{display:block;background:#fff5db;border:1px solid #f2d68c;border-radius:12px;padding:14px;line-height:1.45}.confirmation input{margin-right:8px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:26px}.primary,.secondary{appearance:none;border-radius:10px;padding:11px 16px;font:inherit;font-weight:650;cursor:pointer;text-decoration:none}.primary{border:1px solid #171713;background:#171713;color:#fff}.secondary{border:1px solid #cecdc5;background:#fff;color:#272620}.link{display:inline-block}.meta{color:#64635c;font-size:14px}.denial h2,.error h1{margin-top:28px}
  @media(max-width:520px){body{padding:16px}.card{padding:22px}.identities{grid-template-columns:1fr}.arrow{transform:rotate(90deg);justify-self:start}}
  </style></head><body>${body}</body></html>`;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
