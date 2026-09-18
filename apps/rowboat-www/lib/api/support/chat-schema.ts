import { z } from "zod";

/** Runtime contract for GET /api/support/chat responses. */
export const SupportChatConfigSchema = z.object({
  configured: z.boolean(),
  appId: z.string().min(1).optional(),
  labelTypeIds: z.array(z.string().min(1)).optional(),
  customer: z
    .object({
      email: z.string().min(1),
      emailHash: z.string().min(1),
    })
    .optional(),
});

export type SupportChatConfig = z.infer<typeof SupportChatConfigSchema>;
