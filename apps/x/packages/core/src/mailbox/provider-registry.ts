/**
 * Provider registry.
 *
 * Resolves the {@link MailboxProvider} for an account. Product code asks the
 * registry for a provider by account id and never constructs one directly, so
 * adding Outlook later is a single registration point.
 */

import { MailboxProviderError } from "./errors.js";
import { GmailMailboxProvider, type GmailBridge } from "./provider-gmail.js";
import type { MailboxProvider } from "./provider.js";
import type { MailboxStore } from "./store.js";

export interface MailboxProviderRegistry {
  get(accountId: string): Promise<MailboxProvider>;
  tryGet(accountId: string): Promise<MailboxProvider | null>;
}

export type MailboxProviderRegistryDeps = {
  store: MailboxStore;
  gmailBridge: GmailBridge;
};

export class DefaultMailboxProviderRegistry implements MailboxProviderRegistry {
  constructor(private readonly deps: MailboxProviderRegistryDeps) {}

  async get(accountId: string): Promise<MailboxProvider> {
    const provider = await this.tryGet(accountId);
    if (!provider) {
      throw new MailboxProviderError("Mailbox account not found", "not_found", {
        provider: "gmail",
        operation: "resolveProvider",
        accountId,
      });
    }
    return provider;
  }

  async tryGet(accountId: string): Promise<MailboxProvider | null> {
    const account = await this.deps.store.getAccount(accountId);
    if (!account) return null;

    switch (account.provider) {
      case "gmail":
        return new GmailMailboxProvider(account, this.deps.gmailBridge);
      case "outlook":
        throw new MailboxProviderError("Outlook provider is not enabled yet", "unknown", {
          provider: "outlook",
          operation: "resolveProvider",
          accountId,
        });
      default:
        return null;
    }
  }
}
