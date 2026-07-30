import { z } from "zod";

const IFRAME_LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isAllowedIframeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;
    return IFRAME_LOCAL_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export const ImageBlockSchema = z.object({
  src: z.string(),
  alt: z.string().optional(),
  caption: z.string().optional(),
});

export type ImageBlock = z.infer<typeof ImageBlockSchema>;

export const EmbedBlockSchema = z.object({
  provider: z.enum(["youtube", "figma", "tweet", "generic"]),
  url: z.string().url(),
  caption: z.string().optional(),
});

export type EmbedBlock = z.infer<typeof EmbedBlockSchema>;

export const IframeBlockSchema = z.object({
  url: z.string().url().refine(isAllowedIframeUrl, {
    message: "Iframe URLs must use https:// or local http://localhost / 127.0.0.1.",
  }),
  title: z.string().optional(),
  caption: z.string().optional(),
  height: z.number().int().min(240).max(1600).optional(),
  allow: z.string().optional(),
});

export type IframeBlock = z.infer<typeof IframeBlockSchema>;

export const ChartBlockSchema = z.object({
  chart: z.enum(["line", "bar", "pie"]),
  title: z.string().optional(),
  data: z.array(z.record(z.string(), z.unknown())).optional(),
  source: z.string().optional(),
  x: z.string(),
  y: z.string(),
});

export type ChartBlock = z.infer<typeof ChartBlockSchema>;

export const TableBlockSchema = z.object({
  columns: z.array(z.string()),
  data: z.array(z.record(z.string(), z.unknown())),
  title: z.string().optional(),
});

export type TableBlock = z.infer<typeof TableBlockSchema>;

export const CalendarEventSchema = z.object({
  summary: z.string().optional(),
  start: z
    .object({
      dateTime: z.string().optional(),
      date: z.string().optional(),
    })
    .optional(),
  end: z
    .object({
      dateTime: z.string().optional(),
      date: z.string().optional(),
    })
    .optional(),
  location: z.string().optional(),
  htmlLink: z.string().optional(),
  conferenceLink: z.string().optional(),
  source: z.string().optional(),
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const CalendarBlockSchema = z.object({
  title: z.string().optional(),
  events: z.array(CalendarEventSchema),
  showJoinButton: z.boolean().optional(),
});

export type CalendarBlock = z.infer<typeof CalendarBlockSchema>;

export const EmailBlockSchema = z.object({
  threadId: z.string().optional(),
  threadUrl: z.string().url().optional(),
  summary: z.string().optional(),
  subject: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  date: z.string().optional(),
  latest_email: z.string().optional(),
  past_summary: z.string().optional(),
  draft_response: z.string().optional(),
  response_mode: z.enum(["inline", "assistant", "both"]).optional(),
});

export type EmailBlock = z.infer<typeof EmailBlockSchema>;

export const GmailAttachmentSchema = z.object({
  filename: z.string(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  savedPath: z.string(),
});

export type GmailAttachment = z.infer<typeof GmailAttachmentSchema>;

export const GmailThreadMessageSchema = z.object({
  id: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cc: z.string().optional(),
  date: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  bodyHtml: z.string().optional(),
  unread: z.boolean().optional(),
  bodyHeight: z.number().int().positive().optional(),
  attachments: z.array(GmailAttachmentSchema).optional(),
  messageIdHeader: z.string().optional(),
});

export type GmailThreadMessage = z.infer<typeof GmailThreadMessageSchema>;

export const GmailThreadSchema = EmailBlockSchema.extend({
  threadId: z.string(),
  threadUrl: z.string().url(),
  unread: z.boolean().optional(),
  importance: z.enum(["important", "other"]).optional(),
  gmail_draft: z.string().optional(),
  messages: z.array(GmailThreadMessageSchema),
});

export type GmailThread = z.infer<typeof GmailThreadSchema>;

// --- Provider-neutral mailbox blocks --------------------------------------
// These mirror the desktop core `mailbox` module's public types so the renderer
// can speak a provider-neutral surface (`mailbox:*` IPC) alongside the existing
// Gmail-specific one.

export const MailboxProviderKindSchema = z.enum(["gmail", "outlook"]);

export const MailboxCapabilitySchema = z.enum([
  "mail.read",
  "mail.modify",
  "mail.send",
  "mail.draft",
  "mail.watch",
  "mail.attachments",
  "calendar.read",
  "drive.write",
  "channels.notify",
]);

export const MailboxAccountStatusSchema = z.enum([
  "connected",
  "missing_scope",
  "needs_reconnect",
  "paused",
  "rate_limited",
  "sync_error",
]);

export const MailboxErrorShapeSchema = z.object({
  code: z.string(),
  message: z.string(),
  operation: z.string().optional(),
  retryAt: z.number().optional(),
  providerStatus: z.number().optional(),
});

export const MailboxAccountBlockSchema = z.object({
  id: z.string(),
  provider: MailboxProviderKindSchema,
  providerAccountId: z.string(),
  email: z.string(),
  displayName: z.string().optional(),
  capabilities: z.array(MailboxCapabilitySchema),
  status: MailboxAccountStatusSchema,
  lastSyncAt: z.number().optional(),
  watchExpiresAt: z.number().optional(),
  lastError: MailboxErrorShapeSchema.optional(),
});

export type MailboxAccountBlock = z.infer<typeof MailboxAccountBlockSchema>;

export const MailboxParticipantSchema = z.object({
  name: z.string().optional(),
  email: z.string(),
});

export const MailboxAttachmentBlockSchema = z.object({
  id: z.string(),
  providerAttachmentId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().optional(),
  inline: z.boolean(),
  contentId: z.string().optional(),
  localPath: z.string().optional(),
  downloadState: z.enum(["not_downloaded", "downloaded", "failed"]),
});

export const MailboxMessageBlockSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  provider: MailboxProviderKindSchema,
  providerThreadId: z.string(),
  providerMessageId: z.string(),
  headerMessageId: z.string().optional(),
  subject: z.string(),
  from: MailboxParticipantSchema,
  to: z.array(MailboxParticipantSchema),
  cc: z.array(MailboxParticipantSchema),
  bcc: z.array(MailboxParticipantSchema),
  sentAt: z.number(),
  snippet: z.string().optional(),
  textBody: z.string().optional(),
  htmlBodyRef: z.string().optional(),
  attachments: z.array(MailboxAttachmentBlockSchema),
  labels: z.array(z.string()),
  folderIds: z.array(z.string()),
  unread: z.boolean(),
  draft: z.boolean(),
  sent: z.boolean(),
  inbox: z.boolean(),
  isOutbound: z.boolean(),
});

export type MailboxMessageBlock = z.infer<typeof MailboxMessageBlockSchema>;

export const MailboxThreadSummaryBlockSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  provider: MailboxProviderKindSchema,
  providerThreadId: z.string(),
  subject: z.string(),
  participants: z.array(MailboxParticipantSchema),
  latestMessageAt: z.number(),
  unread: z.boolean(),
  categories: z.array(z.string()),
  labels: z.array(z.string()),
  snippet: z.string().optional(),
  summary: z.string().optional(),
  messageCount: z.number(),
});

export type MailboxThreadSummaryBlock = z.infer<typeof MailboxThreadSummaryBlockSchema>;

export const MailboxThreadBlockSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  provider: MailboxProviderKindSchema,
  providerThreadId: z.string(),
  subject: z.string(),
  participants: z.array(MailboxParticipantSchema),
  latestMessageAt: z.number(),
  unread: z.boolean(),
  categories: z.array(z.string()),
  labels: z.array(z.string()),
  folderIds: z.array(z.string()),
  snippet: z.string().optional(),
  summary: z.string().optional(),
  messages: z.array(MailboxMessageBlockSchema),
});

export type MailboxThreadBlock = z.infer<typeof MailboxThreadBlockSchema>;

export const MailboxTrackerBlockSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  threadId: z.string(),
  providerThreadId: z.string(),
  status: z.enum(["needs_reply", "awaiting_reply", "needs_action", "done"]),
  reason: z.string().optional(),
  confidence: z.number().optional(),
  dueAt: z.number().optional(),
  followUpAppliedAt: z.number().optional(),
  followUpDraftId: z.string().optional(),
  lastInboundMessageId: z.string().optional(),
  lastOutboundMessageId: z.string().optional(),
  notificationSentAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type MailboxTrackerBlock = z.infer<typeof MailboxTrackerBlockSchema>;

export const MailboxDraftBlockSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  trackerId: z.string().optional(),
  threadId: z.string(),
  providerThreadId: z.string(),
  providerDraftId: z.string().optional(),
  threadVersion: z.string(),
  subject: z.string(),
  bodyText: z.string(),
  bodyHtml: z.string().optional(),
  to: z.array(MailboxParticipantSchema),
  cc: z.array(MailboxParticipantSchema),
  bcc: z.array(MailboxParticipantSchema),
  confidence: z.number(),
  reasoningSummary: z.string().optional(),
  source: z.string(),
  status: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type MailboxDraftBlock = z.infer<typeof MailboxDraftBlockSchema>;

// Rules and audit runs are passed through opaquely to the renderer; their exact
// nested action shapes live in core and are not re-validated here.
export const MailboxRuleBlockSchema = z.record(z.string(), z.unknown());
export const MailboxActionRunBlockSchema = z.record(z.string(), z.unknown());
export const MailboxRuleRunBlockSchema = z.record(z.string(), z.unknown());

export const EmailsBlockSchema = z.object({
  title: z.string().optional(),
  emails: z.array(EmailBlockSchema),
});

export type EmailsBlock = z.infer<typeof EmailsBlockSchema>;

export const TranscriptBlockSchema = z.object({
  transcript: z.string(),
  /**
   * Timed entries, when the capture engine produced them.
   *
   * Optional on purpose: every note written before this existed still parses, and a
   * note someone edited by hand still parses. `transcript` stays the source of truth
   * for the *text* — this only adds where in the recording each line came from, so a
   * click can seek there.
   */
  segments: z
    .array(
      z.object({
        speaker: z.string(),
        text: z.string(),
        start_ms: z.number(),
        end_ms: z.number(),
        /** Which recorded file this came from: `mic` is you, `system` is them. */
        track: z.enum(["mic", "system"]).optional(),
      }),
    )
    .optional(),
  /** The recording these timings index into. Absent once the audio is gone. */
  sessionId: z.string().optional(),
});

export type TranscriptBlock = z.infer<typeof TranscriptBlockSchema>;

export const SuggestedTopicBlockSchema = z.object({
  title: z.string(),
  description: z.string(),
  category: z.string().optional(),
});

export type SuggestedTopicBlock = z.infer<typeof SuggestedTopicBlockSchema>;
