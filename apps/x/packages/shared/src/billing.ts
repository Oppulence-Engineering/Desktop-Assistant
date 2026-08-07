import { z } from 'zod';

/**
 * Must match the `plan` validator on the Subscription ent schema.
 *
 * `intelligence` is the cloud-research tier (RFC 039). A separate plan rather
 * than a higher `pro`, because research is consent-gated and users who decline
 * it must not be repriced for a capability they switched off.
 */
export const BillingPlanSchema = z.enum(['free', 'starter', 'pro', 'intelligence']);
export type BillingPlan = z.infer<typeof BillingPlanSchema>;

export const BillingUsageBucketSchema = z.object({
  sanctionedCredits: z.number(),
  usedCredits: z.number(),
  availableCredits: z.number(),
});
export type BillingUsageBucket = z.infer<typeof BillingUsageBucketSchema>;

export const BillingInfoSchema = z.object({
  userEmail: z.string().nullable(),
  userId: z.string().nullable(),
  subscriptionPlan: BillingPlanSchema.nullable(),
  subscriptionStatus: z.string().nullable(),
  trialExpiresAt: z.string().nullable(),
  monthly: BillingUsageBucketSchema,
  daily: BillingUsageBucketSchema.extend({
    usageDay: z.string(),
  }),
});
export type BillingInfo = z.infer<typeof BillingInfoSchema>;
