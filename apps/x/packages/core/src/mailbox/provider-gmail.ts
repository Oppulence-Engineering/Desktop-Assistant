/**
 * Gmail provider adapter.
 *
 * Implements the provider-neutral {@link MailboxProvider} contract on top of the
 * desktop app's existing Gmail sync. All I/O is delegated to a {@link GmailBridge}
 * so this class stays pure and testable: the bridge is the only impure seam, and
 * the concrete bridge lives in `provider-gmail-bridge.ts`.
 *
 * Native Gmail failures thrown by the bridge are wrapped in
 * {@link MailboxProviderError} via {@link classifyProviderError} so the sync
 * controller and UI see stable error codes.
 */

import type { GmailThreadSnapshot } from "../knowledge/sync_gmail.js";

import { capabilitiesFromScopes } from "./capabilities.js";
import { MailboxProviderError, classifyProviderError } from "./errors.js";
import { normalizeGmailSnapshot, threadToSummary } from "./normalize.js";
import type { MailboxProvider } from "./provider.js";
import type {
  MailboxAccount,
  MailboxAccountStatus,
  MailboxCapability,
  MailboxDraft,
  MailboxDraftInput,
  MailboxForwardInput,
  MailboxHistoryPage,
  MailboxLabel,
  MailboxMessage,
  MailboxMessagePage,
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

export type GmailConnectionInfo = {
  connected: boolean;
  hasRequiredScope: boolean;
  missingScopes: string[];
  email: string | null;
  grantedScopes?: string[];
};

export type GmailSendReplyBridgeInput = {
  threadId?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  inReplyTo?: string;
  references?: string;
};

/**
 * The narrow surface the Gmail adapter needs. Implementations delegate to the
 * existing desktop sync code (`provider-gmail-bridge.ts`) or to mocks in tests.
 * Every method rejects with a native/Gmail-shaped error on failure; the adapter
 * classifies it.
 */
export interface GmailBridge {
  listThreads(
    section: "important" | "other",
    opts: { cursor?: string; limit?: number },
  ): Promise<{ snapshots: GmailThreadSnapshot[]; nextCursor: string | null }>;
  getThreadSnapshot(providerThreadId: string): Promise<GmailThreadSnapshot | null>;
  archiveThread(providerThreadId: string): Promise<void>;
  trashThread(providerThreadId: string): Promise<void>;
  markThreadRead(providerThreadId: string): Promise<void>;
  sendReply(input: GmailSendReplyBridgeInput): Promise<{ messageId?: string; threadId?: string }>;
  getConnectionInfo(): Promise<GmailConnectionInfo>;
  triggerSync(): void;
}

const NEWEST_FIRST_QUEUES = new Set(["important"]);

export class GmailMailboxProvider implements MailboxProvider {
  readonly kind = "gmail" as const;

  constructor(
    readonly account: MailboxAccount,
    private readonly bridge: GmailBridge,
  ) {}

  private wrap(operation: string, error: unknown): MailboxProviderError {
    return classifyProviderError(error, {
      provider: "gmail",
      operation,
      accountId: this.account.id,
    });
  }

  private notSupported(operation: string): MailboxProviderError {
    return new MailboxProviderError(
      `Gmail operation not available in the desktop bridge: ${operation}`,
      "unknown",
      { provider: "gmail", operation, accountId: this.account.id },
    );
  }

  async getCapabilities(): Promise<MailboxCapability[]> {
    try {
      const info = await this.bridge.getConnectionInfo();
      if (info.grantedScopes?.length) {
        return capabilitiesFromScopes("gmail", info.grantedScopes);
      }
      return this.account.capabilities;
    } catch (error) {
      throw this.wrap("getCapabilities", error);
    }
  }

  async getConnectionStatus(): Promise<MailboxAccountStatus> {
    try {
      const info = await this.bridge.getConnectionInfo();
      if (!info.connected) return "needs_reconnect";
      if (!info.hasRequiredScope) return "missing_scope";
      return "connected";
    } catch (error) {
      const wrapped = this.wrap("getConnectionStatus", error);
      if (wrapped.needsReconnect) return "needs_reconnect";
      return "sync_error";
    }
  }

  async listThreads(query: MailboxQuery): Promise<MailboxThreadPage> {
    const section = query.queue && !NEWEST_FIRST_QUEUES.has(query.queue) ? "other" : "important";
    try {
      const { snapshots, nextCursor } = await this.bridge.listThreads(section, {
        cursor: query.cursor,
        limit: query.limit,
      });
      const threads = snapshots.map((snapshot) =>
        threadToSummary(normalizeGmailSnapshot(this.account, snapshot)),
      );
      return { threads, nextCursor: nextCursor ?? undefined };
    } catch (error) {
      throw this.wrap("listThreads", error);
    }
  }

  async getThread(ref: MailboxThreadRef): Promise<MailboxThread> {
    try {
      const snapshot = await this.bridge.getThreadSnapshot(ref.providerThreadId);
      if (!snapshot) {
        throw new MailboxProviderError("Thread not found in local cache", "not_found", {
          provider: "gmail",
          operation: "getThread",
          accountId: this.account.id,
        });
      }
      return normalizeGmailSnapshot(this.account, snapshot);
    } catch (error) {
      throw this.wrap("getThread", error);
    }
  }

  async searchMessages(query: MailboxSearchQuery): Promise<MailboxMessagePage> {
    const needle = query.query.trim().toLowerCase();
    const limit = query.limit ?? 20;
    const matches: MailboxMessage[] = [];
    try {
      for (const section of ["important", "other"] as const) {
        const { snapshots } = await this.bridge.listThreads(section, { limit: 100 });
        for (const snapshot of snapshots) {
          const thread = normalizeGmailSnapshot(this.account, snapshot);
          for (const message of thread.messages) {
            if (messageMatches(message, needle)) {
              matches.push(message);
              if (matches.length >= limit) return { messages: matches };
            }
          }
        }
      }
      return { messages: matches };
    } catch (error) {
      throw this.wrap("searchMessages", error);
    }
  }

  async listLabels(): Promise<MailboxLabel[]> {
    // Gmail system labels the desktop path reasons about. A full label list
    // would need a native labels.list call; the product only relies on these.
    return GMAIL_SYSTEM_LABELS;
  }

  async listFolders(): Promise<MailboxLabel[]> {
    return GMAIL_SYSTEM_LABELS.filter((label) => label.folderLike);
  }

  async archiveThread(ref: MailboxThreadRef): Promise<void> {
    try {
      await this.bridge.archiveThread(ref.providerThreadId);
    } catch (error) {
      throw this.wrap("archiveThread", error);
    }
  }

  async trashThread(ref: MailboxThreadRef): Promise<void> {
    try {
      await this.bridge.trashThread(ref.providerThreadId);
    } catch (error) {
      throw this.wrap("trashThread", error);
    }
  }

  async markThreadRead(ref: MailboxThreadRef): Promise<void> {
    try {
      await this.bridge.markThreadRead(ref.providerThreadId);
    } catch (error) {
      throw this.wrap("markThreadRead", error);
    }
  }

  async applyLabel(_ref: MailboxThreadRef, _labelId: string): Promise<void> {
    throw this.notSupported("applyLabel");
  }

  async moveThread(_ref: MailboxThreadRef, _folderId: string): Promise<void> {
    throw this.notSupported("moveThread");
  }

  // Provider drafts are opt-in. The reply workflow keeps drafts local by default
  // (see reply/drafts.ts); these throw until native draft support is wired.
  async createDraft(_input: MailboxDraftInput): Promise<MailboxDraft> {
    throw this.notSupported("createDraft");
  }

  async updateDraft(_providerDraftId: string, _input: MailboxDraftInput): Promise<MailboxDraft> {
    throw this.notSupported("updateDraft");
  }

  async deleteDraft(_providerDraftId: string): Promise<void> {
    throw this.notSupported("deleteDraft");
  }

  async sendDraft(_providerDraftId: string): Promise<MailboxSentMessage> {
    throw this.notSupported("sendDraft");
  }

  async sendEmail(input: MailboxSendInput): Promise<MailboxSentMessage> {
    return this.send("sendEmail", {
      to: joinParticipants(input.to),
      cc: input.cc ? joinParticipants(input.cc) : undefined,
      bcc: input.bcc ? joinParticipants(input.bcc) : undefined,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml ?? textToHtml(input.bodyText),
    });
  }

  async reply(input: MailboxReplyInput): Promise<MailboxSentMessage> {
    return this.send("reply", {
      threadId: input.providerThreadId,
      to: joinParticipants(input.to),
      cc: input.cc ? joinParticipants(input.cc) : undefined,
      bcc: input.bcc ? joinParticipants(input.bcc) : undefined,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml ?? textToHtml(input.bodyText),
      inReplyTo: input.inReplyToHeaderMessageId,
    });
  }

  async forward(_input: MailboxForwardInput): Promise<MailboxSentMessage> {
    throw this.notSupported("forward");
  }

  private async send(
    operation: string,
    input: GmailSendReplyBridgeInput,
  ): Promise<MailboxSentMessage> {
    try {
      const result = await this.bridge.sendReply(input);
      return {
        accountId: this.account.id,
        provider: "gmail",
        providerThreadId: result.threadId ?? input.threadId ?? "",
        providerMessageId: result.messageId ?? "",
        sentAt: Date.now(),
      };
    } catch (error) {
      throw this.wrap(operation, error);
    }
  }

  async listHistory(_cursor: string | undefined): Promise<MailboxHistoryPage> {
    // The desktop sync loop owns Gmail history internally; the mailbox layer
    // triggers a sync and consumes updated snapshots rather than reading raw
    // history here.
    this.bridge.triggerSync();
    return { changes: [] };
  }

  async renewWatch(): Promise<MailboxWatchState> {
    throw this.notSupported("renewWatch");
  }
}

function messageMatches(message: MailboxMessage, needle: string): boolean {
  if (!needle) return true;
  return (
    message.subject.toLowerCase().includes(needle) ||
    message.from.email.toLowerCase().includes(needle) ||
    (message.from.name?.toLowerCase().includes(needle) ?? false) ||
    (message.textBody?.toLowerCase().includes(needle) ?? false)
  );
}

function joinParticipants(participants: { name?: string; email: string }[]): string {
  return participants.map((p) => (p.name ? `"${p.name}" <${p.email}>` : p.email)).join(", ");
}

function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .split(/\n/)
    .map((line) => (line.length ? `<div>${line}</div>` : "<div><br></div>"))
    .join("");
}

const GMAIL_SYSTEM_LABELS: MailboxLabel[] = [
  { id: "INBOX", providerLabelId: "INBOX", name: "Inbox", kind: "system", folderLike: true },
  { id: "UNREAD", providerLabelId: "UNREAD", name: "Unread", kind: "system", folderLike: false },
  { id: "STARRED", providerLabelId: "STARRED", name: "Starred", kind: "system", folderLike: false },
  { id: "SENT", providerLabelId: "SENT", name: "Sent", kind: "system", folderLike: true },
  { id: "DRAFT", providerLabelId: "DRAFT", name: "Drafts", kind: "system", folderLike: true },
  { id: "SPAM", providerLabelId: "SPAM", name: "Spam", kind: "system", folderLike: true },
  { id: "TRASH", providerLabelId: "TRASH", name: "Trash", kind: "system", folderLike: true },
];
