import { z } from "zod";

/**
 * Runtime contract for GET /api/support/chat responses.
 *
 * Email without a hash is an unverified hint for the inbox. emailHash is the
 * verified bearer credential — it must never be sent without the same email,
 * because a lone or mismatched hash takes the widget down.
 */
export const SupportChatCustomerSchema = z
  .object({
    externalId: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
    emailHash: z.string().min(1).optional(),
  })
  .refine((customer) => Boolean(customer.externalId) || Boolean(customer.email), {
    message: "customer needs externalId or an email",
  })
  .refine((customer) => !customer.emailHash || Boolean(customer.email), {
    message: "emailHash cannot be sent without the email it signs",
  });

export const SupportChatConfigSchema = z.object({
  configured: z.boolean(),
  appId: z.string().min(1).optional(),
  labelTypeIds: z.array(z.string().min(1)).optional(),
  customer: SupportChatCustomerSchema.optional(),
});

export type SupportChatCustomer = z.infer<typeof SupportChatCustomerSchema>;
export type SupportChatConfig = z.infer<typeof SupportChatConfigSchema>;
