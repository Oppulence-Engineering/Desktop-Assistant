import { z } from "zod";

/**
 * Privacy preferences that must be readable by the main process.
 *
 * The usage-data toggle previously lived in renderer `localStorage`, which the
 * main process cannot read — so the switch moved a value nobody consulted and
 * analytics ran regardless of what it said. A control that claims to govern
 * what leaves the machine has to be stored where the code doing the sending
 * can see it.
 */
export const PrivacyConfigSchema = z.object({
  /**
   * Send anonymous product analytics.
   *
   * Defaults true to match the behaviour this replaced — every existing install
   * has analytics on, and flipping that silently under people would be its own
   * kind of dishonesty. What changes is that turning it off now works.
   */
  shareUsageData: z.boolean().default(true),
});

export type PrivacyConfig = z.infer<typeof PrivacyConfigSchema>;
