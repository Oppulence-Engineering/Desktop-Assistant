/**
 * Provider-neutral mailbox data model.
 *
 * These types are the product contract for every email feature in the desktop
 * app. Product code (rules, reply tracking, cleanup, the command center UI, the
 * assistant) operates on these normalized shapes and never on Gmail- or
 * Outlook-specific structures. Provider adapters translate native payloads into
 * these types on the way in and translate refs back into native ids on the way
 * out.
 *
 * Identity rule: every object carries both a stable Rowboat id (a deterministic
 * hash, see {@link ./ids}) and the opaque provider-native ids required to make
 * API calls. Product state keys on the Rowboat id; provider calls use the native
 * ids.
 */

export type MailboxProviderKind = "gmail" | "outlook";

/**
 * Fine-grained capabilities an account has been granted. Capabilities are
 * tracked separately from the provider so features can reason about "can this
 * account send?" without knowing which provider backs it.
 */
export type MailboxCapability =
  | "mail.read"
  | "mail.modify"
  | "mail.send"
  | "mail.draft"
  | "mail.watch"
  | "mail.attachments"
  | "calendar.read"
  | "drive.write"
  | "channels.notify";

/**
 * Account availability. A missing scope or an expired refresh token is an
 * availability state, never a silent sign-out.
 */
export type MailboxAccountStatus =
  | "connected"
  | "missing_scope"
  | "needs_reconnect"
  | "paused"
  | "rate_limited"
  | "sync_error";

export type MailboxErrorCode =
  | "auth_reconnect_required"
  | "missing_scope"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "cursor_invalid"
  | "action_policy_denied"
  | "not_found"
  | "unknown";

export type MailboxErrorShape = {
  code: MailboxErrorCode;
  message: string;
  operation?: string;
  retryAt?: number;
  providerStatus?: number;
};

export type MailboxAccount = {
  id: string;
  provider: MailboxProviderKind;
  providerAccountId: string;
  email: string;
  displayName?: string;
  capabilities: MailboxCapability[];
  status: MailboxAccountStatus;
  lastSyncAt?: number;
  watchExpiresAt?: number;
  lastError?: MailboxErrorShape;
};

export type MailboxParticipant = {
  name?: string;
  email: string;
};

export type MailboxProviderRef = {
  accountId: string;
  provider: MailboxProviderKind;
};

export type MailboxThreadRef = MailboxProviderRef & {
  providerThreadId: string;
  rowboatThreadId?: string;
};

export type MailboxMessageRef = MailboxThreadRef & {
  providerMessageId: string;
  headerMessageId?: string;
  rowboatMessageId?: string;
};

export type MailboxAttachmentDownloadState = "not_downloaded" | "downloaded" | "failed";

export type MailboxAttachment = {
  id: string;
  providerAttachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  inline: boolean;
  contentId?: string;
  localPath?: string;
  downloadState: MailboxAttachmentDownloadState;
};

export type MailboxMessage = {
  id: string;
  accountId: string;
  provider: MailboxProviderKind;
  providerThreadId: string;
  providerMessageId: string;
  headerMessageId?: string;
  subject: string;
  from: MailboxParticipant;
  to: MailboxParticipant[];
  cc: MailboxParticipant[];
  bcc: MailboxParticipant[];
  sentAt: number;
  snippet?: string;
  textBody?: string;
  /** Reference (local path or store key) to the full HTML body; never the raw HTML inline. */
  htmlBodyRef?: string;
  attachments: MailboxAttachment[];
  labels: string[];
  folderIds: string[];
  unread: boolean;
  draft: boolean;
  sent: boolean;
  inbox: boolean;
  /**
   * True when this message was authored by the account owner. Derived from the
   * `from` address matching the account email, not from provider label state,
   * so it survives normalization across providers.
   */
  isOutbound: boolean;
};

export type MailboxThread = {
  id: string;
  accountId: string;
  provider: MailboxProviderKind;
  providerThreadId: string;
  subject: string;
  participants: MailboxParticipant[];
  latestMessageAt: number;
  unread: boolean;
  /** Rowboat system/user category ids applied to the thread. */
  categories: string[];
  labels: string[];
  folderIds: string[];
  snippet?: string;
  summary?: string;
  messages: MailboxMessage[];
};

export type MailboxLabelKind = "system" | "user";

export type MailboxLabel = {
  id: string;
  providerLabelId: string;
  name: string;
  kind: MailboxLabelKind;
  /** Folder-style labels (Outlook folders, Gmail system categories) vs freeform labels. */
  folderLike: boolean;
};

export type MailboxFolder = MailboxLabel;

// --- Queries ---------------------------------------------------------------

/**
 * Product-level queue taxonomy. These are Rowboat concepts, not provider
 * labels; the store maps them onto local state.
 */
export type MailboxQueue =
  | "important"
  | "other"
  | "unread"
  | "attachments"
  | "needs_reply"
  | "awaiting_reply"
  | "needs_action"
  | "newsletter"
  | "cold_email";

export type MailboxQuery = {
  accountId?: string;
  queue?: MailboxQueue;
  /** Freeform provider search string, passed through to the provider when supported. */
  query?: string;
  limit?: number;
  cursor?: string;
};

export type MailboxSearchQuery = {
  accountId?: string;
  query: string;
  limit?: number;
  cursor?: string;
};

export type MailboxThreadSummary = {
  id: string;
  accountId: string;
  provider: MailboxProviderKind;
  providerThreadId: string;
  subject: string;
  participants: MailboxParticipant[];
  latestMessageAt: number;
  unread: boolean;
  categories: string[];
  labels: string[];
  snippet?: string;
  summary?: string;
  messageCount: number;
};

export type MailboxThreadPage = {
  threads: MailboxThreadSummary[];
  nextCursor?: string;
};

export type MailboxMessagePage = {
  messages: MailboxMessage[];
  nextCursor?: string;
};

// --- Drafts / sending ------------------------------------------------------

export type MailboxDraftInput = {
  accountId: string;
  /** When replying, the thread this draft belongs to. */
  providerThreadId?: string;
  /** header Message-ID of the message being replied to, for In-Reply-To/References. */
  inReplyToHeaderMessageId?: string;
  to: MailboxParticipant[];
  cc?: MailboxParticipant[];
  bcc?: MailboxParticipant[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
};

export type MailboxDraft = {
  providerDraftId: string;
  accountId: string;
  providerThreadId?: string;
  subject: string;
  updatedAt: number;
};

export type MailboxReplyInput = {
  accountId: string;
  providerThreadId: string;
  inReplyToHeaderMessageId?: string;
  to: MailboxParticipant[];
  cc?: MailboxParticipant[];
  bcc?: MailboxParticipant[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
};

export type MailboxForwardInput = {
  accountId: string;
  providerThreadId: string;
  providerMessageId: string;
  to: MailboxParticipant[];
  cc?: MailboxParticipant[];
  bcc?: MailboxParticipant[];
  note?: string;
};

export type MailboxSendInput = {
  accountId: string;
  to: MailboxParticipant[];
  cc?: MailboxParticipant[];
  bcc?: MailboxParticipant[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
};

export type MailboxSentMessage = {
  accountId: string;
  provider: MailboxProviderKind;
  providerThreadId: string;
  providerMessageId: string;
  headerMessageId?: string;
  sentAt: number;
};

// --- History / watches -----------------------------------------------------

export type MailboxHistoryChangeType =
  | "message_added"
  | "message_removed"
  | "labels_changed"
  | "thread_changed";

export type MailboxHistoryChange = {
  type: MailboxHistoryChangeType;
  providerThreadId: string;
  providerMessageId?: string;
  labelsAdded?: string[];
  labelsRemoved?: string[];
};

export type MailboxHistoryPage = {
  changes: MailboxHistoryChange[];
  nextCursor?: string;
  /** Set when the provider reports the supplied cursor is too old to resume from. */
  cursorInvalid?: boolean;
};

export type MailboxWatchState = {
  accountId: string;
  provider: MailboxProviderKind;
  expiresAt: number;
  cursor?: string;
};
