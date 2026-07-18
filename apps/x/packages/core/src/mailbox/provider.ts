/**
 * The provider contract.
 *
 * Everything above this line in the stack (store, services, rules, reply
 * tracking, UI, assistant) speaks only these methods. Each provider adapter
 * (Gmail today, Outlook later) implements this interface and owns all
 * translation to and from native APIs. No product code calls a provider SDK
 * directly.
 *
 * Methods are grouped by capability. An adapter may throw a
 * {@link ./errors.MailboxProviderError} with code `missing_scope` for any
 * operation its account is not authorized for.
 */

import type {
  MailboxAccount,
  MailboxCapability,
  MailboxAccountStatus,
  MailboxDraft,
  MailboxDraftInput,
  MailboxForwardInput,
  MailboxHistoryPage,
  MailboxLabel,
  MailboxFolder,
  MailboxMessagePage,
  MailboxProviderKind,
  MailboxQuery,
  MailboxReplyInput,
  MailboxSearchQuery,
  MailboxSendInput,
  MailboxSentMessage,
  MailboxThread,
  MailboxThreadPage,
  MailboxThreadRef,
  MailboxWatchState,
} from "./types.js";

export interface MailboxProvider {
  readonly kind: MailboxProviderKind;
  readonly account: MailboxAccount;

  getCapabilities(): Promise<MailboxCapability[]>;
  getConnectionStatus(): Promise<MailboxAccountStatus>;

  // read
  listThreads(query: MailboxQuery): Promise<MailboxThreadPage>;
  getThread(ref: MailboxThreadRef): Promise<MailboxThread>;
  searchMessages(query: MailboxSearchQuery): Promise<MailboxMessagePage>;
  listLabels(): Promise<MailboxLabel[]>;
  listFolders(): Promise<MailboxFolder[]>;

  // modify
  archiveThread(ref: MailboxThreadRef): Promise<void>;
  trashThread(ref: MailboxThreadRef): Promise<void>;
  markThreadRead(ref: MailboxThreadRef): Promise<void>;
  applyLabel(ref: MailboxThreadRef, labelId: string): Promise<void>;
  moveThread(ref: MailboxThreadRef, folderId: string): Promise<void>;

  // draft / send
  createDraft(input: MailboxDraftInput): Promise<MailboxDraft>;
  updateDraft(providerDraftId: string, input: MailboxDraftInput): Promise<MailboxDraft>;
  deleteDraft(providerDraftId: string): Promise<void>;
  sendDraft(providerDraftId: string): Promise<MailboxSentMessage>;
  sendEmail(input: MailboxSendInput): Promise<MailboxSentMessage>;
  reply(input: MailboxReplyInput): Promise<MailboxSentMessage>;
  forward(input: MailboxForwardInput): Promise<MailboxSentMessage>;

  // watch / history
  listHistory(cursor: string | undefined): Promise<MailboxHistoryPage>;
  renewWatch(): Promise<MailboxWatchState>;
}

/**
 * Guards each provider method against calls the account is not capable of, so
 * adapters can assume the capability is present. Adapters may still throw
 * `missing_scope` if the provider itself rejects the call.
 */
export const PROVIDER_METHOD_CAPABILITY: Partial<Record<keyof MailboxProvider, MailboxCapability>> =
  {
    listThreads: "mail.read",
    getThread: "mail.read",
    searchMessages: "mail.read",
    archiveThread: "mail.modify",
    trashThread: "mail.modify",
    markThreadRead: "mail.modify",
    applyLabel: "mail.modify",
    moveThread: "mail.modify",
    createDraft: "mail.draft",
    updateDraft: "mail.draft",
    deleteDraft: "mail.draft",
    sendDraft: "mail.send",
    sendEmail: "mail.send",
    reply: "mail.send",
    forward: "mail.send",
    listHistory: "mail.read",
    renewWatch: "mail.watch",
  };
