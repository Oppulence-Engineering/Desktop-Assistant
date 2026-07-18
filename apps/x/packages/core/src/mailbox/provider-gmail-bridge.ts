/**
 * Concrete Gmail bridge.
 *
 * The only place in the mailbox module that imports the existing Gmail sync
 * functions. It adapts their return shapes (synchronous inbox pages, `{ ok,
 * error }` action results) into the promise-based, throw-on-failure contract the
 * pure {@link GmailMailboxProvider} expects.
 */

import {
  archiveThread as legacyArchiveThread,
  getCachedThreadSnapshot,
  getConnectionStatus as legacyGetConnectionStatus,
  listEverythingElseThreads,
  listImportantThreads,
  markThreadRead as legacyMarkThreadRead,
  sendThreadReply,
  trashThread as legacyTrashThread,
  triggerSync as legacyTriggerSync,
  type GmailThreadSnapshot,
} from "../knowledge/sync_gmail.js";

import type {
  GmailBridge,
  GmailConnectionInfo,
  GmailSendReplyBridgeInput,
} from "./provider-gmail.js";

/** Raise a native-shaped error so {@link classifyProviderError} can map it. */
function throwActionError(operation: string, error: string | undefined): never {
  const err = new Error(error ?? `Gmail ${operation} failed`);
  throw err;
}

export function createGmailBridge(): GmailBridge {
  return {
    async listThreads(
      section: "important" | "other",
      opts: { cursor?: string; limit?: number },
    ): Promise<{ snapshots: GmailThreadSnapshot[]; nextCursor: string | null }> {
      const page =
        section === "important"
          ? listImportantThreads({ cursor: opts.cursor, limit: opts.limit })
          : listEverythingElseThreads({ cursor: opts.cursor, limit: opts.limit });
      return { snapshots: page.threads, nextCursor: page.nextCursor };
    },

    async getThreadSnapshot(providerThreadId: string): Promise<GmailThreadSnapshot | null> {
      return getCachedThreadSnapshot(providerThreadId);
    },

    async archiveThread(providerThreadId: string): Promise<void> {
      const result = await legacyArchiveThread(providerThreadId);
      if (!result.ok) throwActionError("archive", result.error);
    },

    async trashThread(providerThreadId: string): Promise<void> {
      const result = await legacyTrashThread(providerThreadId);
      if (!result.ok) throwActionError("trash", result.error);
    },

    async markThreadRead(providerThreadId: string): Promise<void> {
      const result = await legacyMarkThreadRead(providerThreadId);
      if (!result.ok) throwActionError("markThreadRead", result.error);
    },

    async sendReply(
      input: GmailSendReplyBridgeInput,
    ): Promise<{ messageId?: string; threadId?: string }> {
      const result = await sendThreadReply({
        threadId: input.threadId,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        inReplyTo: input.inReplyTo,
        references: input.references,
      });
      if (result.error) throwActionError("sendReply", result.error);
      return { messageId: result.messageId, threadId: input.threadId };
    },

    async getConnectionInfo(): Promise<GmailConnectionInfo> {
      const status = await legacyGetConnectionStatus();
      return {
        connected: status.connected,
        hasRequiredScope: status.hasRequiredScope,
        missingScopes: status.missingScopes,
        email: status.email,
      };
    },

    triggerSync(): void {
      legacyTriggerSync();
    },
  };
}
