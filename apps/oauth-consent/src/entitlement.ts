import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.js';

export const EntitlementSchema = z.object({
  allow: z.boolean(),
  upsell: z.object({ requiredPlan: z.string(), message: z.string() }).optional(),
});

export type Entitlement = z.infer<typeof EntitlementSchema>;

/**
 * checkEntitlement calls rowboat-api's HMAC-protected pre-consent webhook to
 * decide whether the user may connect the product behind `audience`.
 */
export async function checkEntitlement(
  cfg: Config['rowboatApi'],
  workosUserId: string,
  audience: string,
): Promise<Entitlement> {
  const body = JSON.stringify({ workos_user_id: workosUserId, requested_audience: audience });
  const sig = createHmac('sha256', cfg.hookSecret).update(body).digest('hex');
  try {
    const res = await fetch(`${cfg.baseUrl}/oauth-hooks/pre-consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Hook-Signature': `sha256=${sig}` },
      body,
    });
    if (!res.ok) {
      return { allow: false, upsell: { requiredPlan: 'unknown', message: 'Entitlement check failed' } };
    }
    return EntitlementSchema.parse(await res.json());
  } catch {
    return { allow: false, upsell: { requiredPlan: 'unknown', message: 'Entitlement service unavailable' } };
  }
}
