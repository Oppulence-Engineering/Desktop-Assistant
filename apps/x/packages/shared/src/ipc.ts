import { z } from "zod";
import {
  RelPath,
  Encoding,
  Stat,
  DirEntry,
  ReaddirOptions,
  ReadFileResult,
  WorkspaceChangeEvent,
  WriteFileOptions,
  WriteFileResult,
  RemoveOptions,
} from "./workspace.js";
import { ListToolsResponse } from "./mcp.js";
import {
  AskHumanResponsePayload,
  CreateRunOptions,
  Run,
  ListRunsOptions,
  ListRunsResponse,
  ToolPermissionAuthorizePayload,
} from "./runs.js";
import { LlmModelConfig } from "./models.js";
import { AgentScheduleConfig, AgentScheduleEntry } from "./agent-schedule.js";
import { AgentScheduleState } from "./agent-schedule-state.js";
import { ServiceEvent } from "./service-events.js";
import { LiveNoteAgentEvent, LiveNoteSchema } from "./live-note.js";
import {
  BackgroundTaskAgentEvent,
  BackgroundTaskArtifactSyncSchema,
  BackgroundTaskCloudRunEventSchema,
  BackgroundTaskCloudRunSchema,
  BackgroundTaskCloudRunStatusSchema,
  BackgroundTaskCloudScheduleStateSchema,
  BackgroundTaskOfflineRunsEventSchema,
  BackgroundTaskPatchSchema,
  BackgroundTaskRunExecutor,
  BackgroundTaskRunStatus,
  BackgroundTaskSignal,
  BackgroundTaskSchema,
  BackgroundTaskSummarySchema,
  BackgroundTaskTrigger,
  TriggersSchema,
} from "./background-task.js";
import { NotificationsConfigSchema } from "./notifications.js";
import { UserMessageContent } from "./message.js";
import { SolomonApiConfig } from "./solomon-account.js";
import { BrowserStateSchema } from "./browser-control.js";
import { BillingInfoSchema } from "./billing.js";
import {
  RelationshipActionSchema,
  RelationshipDetailSchema,
  RelationshipObservationSchema,
  RelationshipSchema,
  RelationshipSemanticMatchSchema,
  RelationshipSourceStatusSchema,
  RelationshipStateSnapshotSchema,
} from "./relationships.js";
import {
  GmailThreadSchema,
  MailboxAccountBlockSchema,
  MailboxActionRunBlockSchema,
  MailboxDraftBlockSchema,
  MailboxMessageBlockSchema,
  MailboxRuleBlockSchema,
  MailboxRuleRunBlockSchema,
  MailboxThreadBlockSchema,
  MailboxThreadSummaryBlockSchema,
  MailboxTrackerBlockSchema,
} from "./blocks.js";
import { PermissionDecision, ApprovalPolicy } from "./code-mode.js";
import {
  TranscriptionProvider,
  TranscriptionConfig,
  WhisperAccel,
  WhisperSegment,
  WhisperModelSummary,
  WhisperModelProgress,
  WhisperModelHealth,
  WhisperBenchmarkProfile,
  VoiceCommandIntent,
  WhisperDiagnosticResult,
  VoicePrivacySettings,
  DiarizationSettings,
} from "./transcription.js";
import * as meetings from "./meetings.js";

// ============================================================================
// Runtime Validation Schemas (Single Source of Truth)
// ============================================================================

const ConnectorTrustTierSchema = z.enum(["read", "write", "act", "money-moving"]);

const ConnectorTemplateBlockSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  requiredScopes: z.array(z.string()).optional(),
  mcpTools: z.array(z.string()).optional(),
  trustTier: ConnectorTrustTierSchema,
  samplePrompt: z.string().optional(),
});

const ConnectorMCPToolPolicySchema = z.object({
  name: z.string(),
  trustTier: ConnectorTrustTierSchema.optional(),
});

const ConnectorViewSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  mcpUrl: z.string(),
  authType: z.enum(["oauth", "api_key"]),
  scopes: z.array(z.string()).optional(),
  iconUrl: z.string().optional(),
  mcpTools: z.array(ConnectorMCPToolPolicySchema).optional(),
  templateBlocks: z.array(ConnectorTemplateBlockSchema).optional(),
  connected: z.boolean(),
  connectedAt: z.string().optional(),
});

const SlackLocalWorkspaceSchema = z.object({
  url: z.string(),
  name: z.string(),
});

const SlackWorkspaceSchema = z.object({
  url: z.string().optional(),
  name: z.string(),
  teamId: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  connectedAt: z.string().optional(),
  source: z.enum(["managed", "local"]).optional(),
});

const SlackReplyDraftSchema = z.object({
  teamId: z.string(),
  channel: z.string(),
  threadTs: z.string(),
  text: z.string(),
});

const ipcSchemas = {
  "app:getVersions": {
    req: z.null(),
    res: z.object({
      chrome: z.string(),
      node: z.string(),
      electron: z.string(),
    }),
  },
  "analytics:bootstrap": {
    req: z.null(),
    res: z.object({
      installationId: z.string(),
      apiUrl: z.string(),
      appVersion: z.string(),
    }),
  },
  "workspace:getRoot": {
    req: z.null(),
    res: z.object({
      root: z.string(),
    }),
  },
  "workspace:exists": {
    req: z.object({
      path: RelPath,
    }),
    res: z.object({
      exists: z.boolean(),
    }),
  },
  "workspace:stat": {
    req: z.object({
      path: RelPath,
    }),
    res: Stat,
  },
  "workspace:readdir": {
    req: z.object({
      path: z.string(), // Empty string allowed for root directory
      opts: ReaddirOptions.optional(),
    }),
    res: z.array(DirEntry),
  },
  "workspace:readFile": {
    req: z.object({
      path: RelPath,
      encoding: Encoding.optional(),
    }),
    res: ReadFileResult,
  },
  "workspace:writeFile": {
    req: z.object({
      path: RelPath,
      data: z.string(),
      opts: WriteFileOptions.optional(),
    }),
    res: WriteFileResult,
  },
  "workspace:mkdir": {
    req: z.object({
      path: RelPath,
      recursive: z.boolean().optional(),
    }),
    res: z.object({
      ok: z.literal(true),
    }),
  },
  "workspace:rename": {
    req: z.object({
      from: RelPath,
      to: RelPath,
      overwrite: z.boolean().optional(),
    }),
    res: z.object({
      ok: z.literal(true),
    }),
  },
  "workspace:copy": {
    req: z.object({
      from: RelPath,
      to: RelPath,
      overwrite: z.boolean().optional(),
    }),
    res: z.object({
      ok: z.literal(true),
    }),
  },
  "workspace:remove": {
    req: z.object({
      path: RelPath,
      opts: RemoveOptions.optional(),
    }),
    res: z.object({
      ok: z.literal(true),
    }),
  },
  "workspace:didChange": {
    req: WorkspaceChangeEvent,
    res: z.null(),
  },
  "gmail:getImportant": {
    req: z.object({
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    res: z.object({
      threads: z.array(GmailThreadSchema),
      nextCursor: z.string().nullable(),
    }),
  },
  "gmail:getEverythingElse": {
    req: z.object({
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    res: z.object({
      threads: z.array(GmailThreadSchema),
      nextCursor: z.string().nullable(),
    }),
  },
  "gmail:triggerSync": {
    req: z.object({}),
    res: z.object({}),
  },
  "gmail:sendReply": {
    req: z.object({
      threadId: z.string().min(1).optional(),
      to: z.string().min(1),
      cc: z.string().optional(),
      bcc: z.string().optional(),
      subject: z.string(),
      bodyHtml: z.string(),
      bodyText: z.string(),
      inReplyTo: z.string().optional(),
      references: z.string().optional(),
    }),
    res: z.object({
      messageId: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  "gmail:getConnectionStatus": {
    req: z.object({}),
    res: z.object({
      connected: z.boolean(),
      hasRequiredScope: z.boolean(),
      missingScopes: z.array(z.string()),
      email: z.string().nullable(),
    }),
  },
  "gmail:getAccountEmail": {
    req: z.object({}),
    res: z.object({
      email: z.string().nullable(),
    }),
  },
  "gmail:archiveThread": {
    req: z.object({ threadId: z.string().min(1) }),
    res: z.object({ ok: z.boolean(), error: z.string().optional() }),
  },
  "gmail:trashThread": {
    req: z.object({ threadId: z.string().min(1) }),
    res: z.object({ ok: z.boolean(), error: z.string().optional() }),
  },
  "gmail:markThreadRead": {
    req: z.object({ threadId: z.string().min(1) }),
    res: z.object({ ok: z.boolean(), error: z.string().optional() }),
  },
  "gmail:saveMessageHeight": {
    req: z.object({
      threadId: z.string().min(1),
      messageId: z.string().min(1),
      height: z.number().int().positive(),
    }),
    res: z.object({}),
  },

  // --- Provider-neutral mailbox surface (email-001..004) ------------------
  "mailbox:getAccounts": {
    req: z.object({}),
    res: z.object({ accounts: z.array(MailboxAccountBlockSchema) }),
  },
  "mailbox:getConnectionStatus": {
    req: z.object({}),
    res: z.object({ status: MailboxAccountBlockSchema.shape.status }),
  },
  "mailbox:listThreads": {
    req: z.object({
      accountId: z.string().optional(),
      queue: z
        .enum([
          "important",
          "other",
          "unread",
          "attachments",
          "needs_reply",
          "awaiting_reply",
          "needs_action",
          "newsletter",
          "cold_email",
        ])
        .optional(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    }),
    res: z.object({
      threads: z.array(MailboxThreadSummaryBlockSchema),
      nextCursor: z.string().nullable(),
    }),
  },
  "mailbox:getThread": {
    req: z.object({
      accountId: z.string().optional(),
      providerThreadId: z.string().min(1),
    }),
    res: z.object({ thread: MailboxThreadBlockSchema }),
  },
  "mailbox:search": {
    req: z.object({
      accountId: z.string().optional(),
      query: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    res: z.object({ messages: z.array(MailboxMessageBlockSchema) }),
  },
  "mailbox:triggerSync": {
    req: z.object({}),
    res: z.object({}),
  },
  "mailbox:archiveThread": {
    req: z.object({ accountId: z.string().optional(), providerThreadId: z.string().min(1) }),
    res: z.object({ status: z.string(), error: z.string().optional() }),
  },
  "mailbox:trashThread": {
    req: z.object({ accountId: z.string().optional(), providerThreadId: z.string().min(1) }),
    res: z.object({ status: z.string(), error: z.string().optional() }),
  },
  "mailbox:markThreadRead": {
    req: z.object({ accountId: z.string().optional(), providerThreadId: z.string().min(1) }),
    res: z.object({ status: z.string(), error: z.string().optional() }),
  },
  "mailbox:sendReply": {
    req: z.object({
      accountId: z.string().optional(),
      providerThreadId: z.string().min(1),
      to: z.array(z.string()).min(1),
      cc: z.array(z.string()).optional(),
      bcc: z.array(z.string()).optional(),
      subject: z.string(),
      bodyText: z.string(),
      bodyHtml: z.string().optional(),
      inReplyToHeaderMessageId: z.string().optional(),
    }),
    res: z.object({
      ok: z.boolean(),
      providerMessageId: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  "mailbox:listRules": {
    req: z.object({ accountId: z.string() }),
    res: z.object({ rules: z.array(MailboxRuleBlockSchema) }),
  },
  "mailbox:createRule": {
    req: z.object({ rule: z.record(z.string(), z.unknown()) }),
    res: z.object({ rule: MailboxRuleBlockSchema }),
  },
  "mailbox:updateRule": {
    req: z.object({ id: z.string(), patch: z.record(z.string(), z.unknown()) }),
    res: z.object({ rule: MailboxRuleBlockSchema }),
  },
  "mailbox:deleteRule": {
    req: z.object({ id: z.string() }),
    res: z.object({}),
  },
  "mailbox:listTrackers": {
    req: z.object({
      accountId: z.string(),
      status: z.enum(["needs_reply", "awaiting_reply", "needs_action", "done"]).optional(),
    }),
    res: z.object({ trackers: z.array(MailboxTrackerBlockSchema) }),
  },
  "mailbox:markThreadStatus": {
    req: z.object({
      accountId: z.string(),
      threadId: z.string(),
      status: z.enum(["needs_reply", "awaiting_reply", "needs_action", "done"]),
      reason: z.string().optional(),
      dueInDays: z.number().optional(),
    }),
    res: z.object({ tracker: MailboxTrackerBlockSchema.nullable() }),
  },
  "mailbox:listDrafts": {
    req: z.object({ accountId: z.string() }),
    res: z.object({ drafts: z.array(MailboxDraftBlockSchema) }),
  },
  "mailbox:generateDraft": {
    req: z.object({
      accountId: z.string().optional(),
      providerThreadId: z.string().min(1),
      instruction: z.string().optional(),
    }),
    res: z.object({ draft: MailboxDraftBlockSchema }),
  },
  "mailbox:getActionRuns": {
    req: z.object({ accountId: z.string(), limit: z.number().int().min(1).max(500).optional() }),
    res: z.object({ runs: z.array(MailboxActionRunBlockSchema) }),
  },
  "mailbox:getRuleRuns": {
    req: z.object({ accountId: z.string(), limit: z.number().int().min(1).max(500).optional() }),
    res: z.object({ runs: z.array(MailboxRuleRunBlockSchema) }),
  },
  "mcp:listTools": {
    req: z.object({
      serverName: z.string(),
      cursor: z.string().optional(),
    }),
    res: ListToolsResponse,
  },
  "mcp:executeTool": {
    req: z.object({
      serverName: z.string(),
      toolName: z.string(),
      input: z.record(z.string(), z.unknown()),
    }),
    res: z.object({
      result: z.unknown(),
    }),
  },
  "runs:create": {
    req: CreateRunOptions,
    res: Run,
  },
  "runs:createMessage": {
    req: z.object({
      runId: z.string(),
      message: UserMessageContent,
      voiceInput: z.boolean().optional(),
      voiceOutput: z.enum(["summary", "full"]).optional(),
      searchEnabled: z.boolean().optional(),
      codeMode: z.enum(["claude", "codex"]).optional(),
      middlePaneContext: z
        .discriminatedUnion("kind", [
          z.object({
            kind: z.literal("note"),
            path: z.string(),
            content: z.string(),
          }),
          z.object({
            kind: z.literal("browser"),
            url: z.string(),
            title: z.string(),
          }),
        ])
        .optional(),
    }),
    res: z.object({
      messageId: z.string(),
    }),
  },
  "runs:authorizePermission": {
    req: z.object({
      runId: z.string(),
      authorization: ToolPermissionAuthorizePayload,
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  "runs:provideHumanInput": {
    req: z.object({
      runId: z.string(),
      reply: AskHumanResponsePayload,
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  "runs:stop": {
    req: z.object({
      runId: z.string(),
      force: z.boolean().optional().default(false),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  "runs:fetch": {
    req: z.object({
      runId: z.string(),
    }),
    res: Run,
  },
  "runs:list": {
    req: ListRunsOptions,
    res: ListRunsResponse,
  },
  "runs:delete": {
    req: z.object({
      runId: z.string(),
    }),
    res: z.object({ success: z.boolean() }),
  },
  "runs:downloadLog": {
    req: z.object({
      runId: z.string().min(1),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  "runs:events": {
    req: z.null(),
    res: z.null(),
  },
  "services:events": {
    req: ServiceEvent,
    res: z.null(),
  },
  "live-note-agent:events": {
    req: LiveNoteAgentEvent,
    res: z.null(),
  },
  "bg-task-agent:events": {
    req: BackgroundTaskAgentEvent,
    res: z.null(),
  },
  "models:list": {
    req: z.null(),
    res: z.object({
      providers: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          models: z.array(
            z.object({
              id: z.string(),
              name: z.string().optional(),
              release_date: z.string().optional(),
            }),
          ),
        }),
      ),
      lastUpdated: z.string().optional(),
    }),
  },
  "models:test": {
    req: LlmModelConfig,
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  "models:saveConfig": {
    req: LlmModelConfig,
    res: z.object({
      success: z.literal(true),
    }),
  },
  "oauth:connect": {
    req: z.object({
      provider: z.string(),
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  "oauth:disconnect": {
    req: z.object({
      provider: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
    }),
  },
  // Begins a rowboat-api connector OAuth connect: main asks the api for the
  // provider authorize_url and opens it in the system browser. The browser
  // completes at the api callback, which deep-links back to
  // solomon-ai://connection-complete?...&session=<state>, where main redeems it
  // via the connector /claim endpoint (see deeplink.ts / oauth-handler.ts).
  "connectors:connect": {
    req: z.object({
      connector: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  "connectors:list": {
    req: z.null(),
    res: z.object({
      connectors: z.array(ConnectorViewSchema),
      error: z.string().optional(),
    }),
  },
  "connectors:saveApiKey": {
    req: z.object({
      connector: z.string(),
      apiKey: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  "connectors:disconnect": {
    req: z.object({
      connector: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  // Begins a Slack workspace install (RFC 003 cloud events): main opens the
  // api's /oauth/slack/start in the system browser; the api callback parks the
  // sealed bundle and deep-links back to
  // solomon-ai://oauth/slack/done?session=<state>&status=success, where main
  // redeems it via /v1/slack-oauth/claim (see deeplink.ts / oauth-handler.ts).
  // Completion is surfaced on oauth:didConnect with provider "slack".
  "slack:connectWorkspace": {
    req: z.null(),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  "oauth:list-providers": {
    req: z.null(),
    res: z.object({
      providers: z.array(z.string()),
    }),
  },
  "oauth:getState": {
    req: z.null(),
    res: z.object({
      config: z.record(
        z.string(),
        z.object({
          connected: z.boolean(),
          error: z.string().nullable().optional(),
          userId: z.string().optional(),
          clientId: z.string().nullable().optional(),
        }),
      ),
    }),
  },
  "account:getSolomon": {
    req: z.null(),
    res: z.object({
      signedIn: z.boolean(),
      accessToken: z.string().nullable(),
      config: SolomonApiConfig.nullable(),
    }),
  },
  "account:getRowboat": {
    req: z.null(),
    res: z.object({
      signedIn: z.boolean(),
      accessToken: z.string().nullable(),
      config: SolomonApiConfig.nullable(),
    }),
  },
  "oauth:didConnect": {
    req: z.object({
      provider: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
      userId: z.string().optional(),
    }),
    res: z.null(),
  },
  "app:openUrl": {
    req: z.object({
      url: z.string(),
    }),
    res: z.null(),
  },
  "app:takeMeetingNotes": {
    req: z.object({
      // Pass the raw calendar event JSON through; renderer adapts to its existing flow.
      event: z.unknown(),
      // When true, the renderer should also open the meeting URL (Zoom/Meet/etc.)
      // in addition to triggering the take-notes flow.
      openMeeting: z.boolean().optional(),
    }),
    res: z.null(),
  },
  "app:consumePendingDeepLink": {
    req: z.null(),
    res: z.object({
      url: z.string().nullable(),
    }),
  },
  "granola:getConfig": {
    req: z.null(),
    res: z.object({
      enabled: z.boolean(),
    }),
  },
  "codeMode:getConfig": {
    req: z.null(),
    res: z.object({
      enabled: z.boolean(),
      approvalPolicy: ApprovalPolicy.optional(),
    }),
  },
  "codeMode:setConfig": {
    req: z.object({
      enabled: z.boolean(),
      approvalPolicy: ApprovalPolicy.optional(),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  // Answer a mid-run permission request from a code_agent_run coding turn.
  "codeRun:resolvePermission": {
    req: z.object({
      requestId: z.string(),
      decision: PermissionDecision,
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  "codeMode:checkAgentStatus": {
    req: z.null(),
    res: z.object({
      claude: z.object({ installed: z.boolean(), signedIn: z.boolean() }),
      codex: z.object({ installed: z.boolean(), signedIn: z.boolean() }),
    }),
  },
  "granola:setConfig": {
    req: z.object({
      enabled: z.boolean(),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  "slack:getConfig": {
    req: z.null(),
    res: z.object({
      enabled: z.boolean(),
      workspaces: z.array(SlackWorkspaceSchema),
      error: z.string().optional(),
    }),
  },
  "slack:setConfig": {
    req: z.object({
      enabled: z.boolean(),
      workspaces: z.array(SlackLocalWorkspaceSchema),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  "slack:disconnectWorkspace": {
    req: z.object({
      teamId: z.string().optional(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  "slack:sendReplyDraft": {
    req: SlackReplyDraftSchema,
    res: z.object({
      success: z.boolean(),
      teamId: z.string().optional(),
      channel: z.string().optional(),
      threadTs: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  "slack:listWorkspaces": {
    req: z.null(),
    res: z.object({
      workspaces: z.array(SlackLocalWorkspaceSchema),
      error: z.string().optional(),
    }),
  },
  "onboarding:getStatus": {
    req: z.null(),
    res: z.object({
      showOnboarding: z.boolean(),
    }),
  },
  "onboarding:markComplete": {
    req: z.null(),
    res: z.object({
      success: z.literal(true),
    }),
  },
  // Agent schedule channels
  "agent-schedule:getConfig": {
    req: z.null(),
    res: AgentScheduleConfig,
  },
  "agent-schedule:getState": {
    req: z.null(),
    res: AgentScheduleState,
  },
  "agent-schedule:updateAgent": {
    req: z.object({
      agentName: z.string(),
      entry: AgentScheduleEntry,
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  "agent-schedule:deleteAgent": {
    req: z.object({
      agentName: z.string(),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  // Shell integration channels
  "shell:openPath": {
    req: z.object({ path: z.string() }),
    res: z.object({ error: z.string().optional() }),
  },
  "shell:showItemInFolder": {
    req: z.object({ path: z.string() }),
    res: z.object({ success: z.literal(true) }),
  },
  "shell:readFileBase64": {
    req: z.object({ path: z.string() }),
    res: z.object({ data: z.string(), mimeType: z.string(), size: z.number() }),
  },
  // Native dialog channels
  "dialog:openDirectory": {
    req: z.object({
      defaultPath: z.string().optional(),
      title: z.string().optional(),
    }),
    res: z.object({
      path: z.string().nullable(),
    }),
  },
  // Knowledge version history channels
  "knowledge:history": {
    req: z.object({ path: RelPath }),
    res: z.object({
      commits: z.array(
        z.object({
          oid: z.string(),
          message: z.string(),
          timestamp: z.number(),
          author: z.string(),
        }),
      ),
    }),
  },
  "knowledge:fileAtCommit": {
    req: z.object({ path: RelPath, oid: z.string() }),
    res: z.object({ content: z.string() }),
  },
  "knowledge:restore": {
    req: z.object({ path: RelPath, oid: z.string() }),
    res: z.object({ ok: z.literal(true) }),
  },
  "knowledge:didCommit": {
    req: z.object({}),
    res: z.null(),
  },
  // Search channels
  "search:query": {
    req: z.object({
      query: z.string(),
      limit: z.number().optional(),
      types: z.array(z.enum(["knowledge", "chat"])).optional(),
    }),
    res: z.object({
      results: z.array(
        z.object({
          type: z.enum(["knowledge", "chat"]),
          title: z.string(),
          preview: z.string(),
          path: z.string(),
        }),
      ),
    }),
  },
  // Semantic memory channels (RFC 021)
  "memory:search": {
    req: z.object({
      query: z.string().min(1),
      k: z.number().int().min(1).max(25).optional(),
      pathPrefix: z.string().optional(),
    }),
    res: z.object({
      mode: z.enum(["hybrid", "lexical_fallback", "vector_only"]),
      results: z.array(
        z.object({
          path: z.string(),
          headingAnchor: z.string(),
          backlink: z.string(),
          snippet: z.string(),
          score: z.number(),
          highlights: z.array(z.object({ start: z.number(), end: z.number() })).optional(),
          scores: z
            .object({ vector: z.number().optional(), lexical: z.number().optional() })
            .optional(),
          startLine: z.number(),
          endLine: z.number(),
        }),
      ),
    }),
  },
  "memory:related": {
    req: z.object({ path: z.string(), k: z.number().int().min(1).max(25).optional() }),
    res: z.object({
      related: z.array(z.object({ path: z.string(), score: z.number() })),
    }),
  },
  "memory:status": {
    req: z.null(),
    res: z.object({
      enabled: z.boolean(),
      model: z.string().nullable(),
      dims: z.number(),
      chunkCount: z.number(),
      lastBuiltMs: z.number().nullable(),
    }),
  },
  "memory:indexProgress": {
    req: z.object({
      chunkCount: z.number(),
      filesProcessed: z.number(),
      chunksNew: z.number(),
      tokens: z.number(),
      rebuilt: z.boolean(),
      durationMs: z.number(),
    }),
    res: z.null(),
  },
  // Voice mode channels
  "voice:getConfig": {
    req: z.null(),
    res: z.object({
      deepgram: z.object({ apiKey: z.string() }).nullable(),
      elevenlabs: z.object({ apiKey: z.string(), voiceId: z.string().optional() }).nullable(),
    }),
  },
  "voice:synthesize": {
    req: z.object({
      text: z.string(),
    }),
    res: z.object({
      audioBase64: z.string(),
      mimeType: z.string(),
    }),
  },
  "voice:parseCommand": {
    req: z.object({ text: z.string(), surface: z.enum(["global", "chat", "email", "meeting"]) }),
    res: z.object({ intent: VoiceCommandIntent, requiresConfirmation: z.boolean() }),
  },
  "voice:executeCommand": {
    req: z.object({ intent: VoiceCommandIntent, confirmed: z.boolean().default(false) }),
    res: z.object({ success: z.boolean(), message: z.string().optional() }),
  },
  // ---- Local on-device transcription (whisper.cpp) — RFC 009 §11 ----
  // Capability probe: which accel backend is compiled in + whether local is viable here.
  "whisper:capability": {
    req: z.null(),
    res: z.object({
      supported: z.boolean(),
      accel: WhisperAccel,
      cores: z.number(),
      reason: z.string().optional(),
    }),
  },
  "whisper:diagnose": {
    req: z.object({
      pcm16: z.instanceof(ArrayBuffer),
      sampleRate: z.literal(16000),
      expectedText: z.string().optional(),
    }),
    res: WhisperDiagnosticResult,
  },
  // Model catalog with per-model install state for the settings picker.
  "whisper:listModels": {
    req: z.null(),
    res: z.object({ models: z.array(WhisperModelSummary) }),
  },
  "whisper:verifyModel": {
    req: z.object({ id: z.string() }),
    res: WhisperModelHealth,
  },
  // Download (+ verify) a model; resolves once present. `code` carries the failure taxonomy.
  "whisper:ensureModel": {
    req: z.object({ id: z.string() }),
    res: z.object({ success: z.boolean(), code: z.string().optional() }),
  },
  "whisper:repairModel": {
    req: z.object({ id: z.string() }),
    res: WhisperModelHealth,
  },
  "whisper:removeModel": {
    req: z.object({ id: z.string() }),
    res: z.object({ success: z.boolean() }),
  },
  "whisper:benchmark": {
    req: z.object({ model: z.string().optional(), sampleSeconds: z.number().default(10) }),
    res: WhisperBenchmarkProfile,
  },
  // Batch transcription (voice mode): one structured-clone of the PCM on submit().
  "whisper:transcribe": {
    req: z.object({
      pcm16: z.instanceof(ArrayBuffer),
      sampleRate: z.literal(16000),
      channels: z.union([z.literal(1), z.literal(2)]),
      model: z.string().optional(),
      lang: z.string().optional(),
    }),
    res: z.object({
      success: z.boolean(),
      text: z.string().optional(),
      segments: z.array(WhisperSegment).optional(),
      rtf: z.number().optional(),
      durationMs: z.number().optional(),
      code: z.string().optional(),
      message: z.string().optional(),
    }),
  },
  // Streaming transcription (meetings): opens a MessageChannel; the port is transferred
  // out-of-band via the `whisper:streamPort` raw channel (see preload). The invoke result
  // only carries the streamId (or a failure code).
  "whisper:openStream": {
    req: z.object({
      model: z.string().optional(),
      channels: z.union([z.literal(1), z.literal(2)]),
    }),
    res: z.object({ streamId: z.string(), code: z.string().optional() }),
  },
  "whisper:closeStream": {
    req: z.object({ streamId: z.string() }),
    res: z.object({ success: z.boolean() }),
  },
  // Event (ipc.on): model-download progress, main → renderer.
  "whisper:modelProgress": {
    req: WhisperModelProgress,
    res: z.null(),
  },
  // ---- Resolved provider selection (tiering + capability gate) — RFC 009 §12/§16 ----
  "transcription:getVoiceProvider": {
    req: z.null(),
    res: z.object({ provider: TranscriptionProvider }),
  },
  "transcription:getMeetingProvider": {
    req: z.null(),
    res: z.object({
      provider: TranscriptionProvider,
      reason: z
        .enum(["user", "remote", "capability", "quota", "fallback", "privacy", "local_unavailable"])
        .optional(),
    }),
  },
  // Read/write the user's explicit transcription.json (settings UI).
  "transcription:getConfig": {
    req: z.null(),
    res: TranscriptionConfig,
  },
  "notifications:getConfig": {
    req: z.null(),
    res: NotificationsConfigSchema,
  },
  "notifications:setConfig": {
    req: z.object({
      cloudRunsOfflineNotify: z.boolean().optional(),
      suppressDesktopScheduleQuitReminder: z.boolean().optional(),
    }),
    res: NotificationsConfigSchema,
  },
  "transcription:setConfig": {
    req: z.object({
      voiceProvider: TranscriptionProvider.optional(),
      meetingProvider: TranscriptionProvider.optional(),
      model: z.string().optional(),
      privacy: VoicePrivacySettings.partial().optional(),
      // RFC 017: on-device diarization settings (incl. the Local-diarization-beta toggle).
      diarization: DiarizationSettings.partial().optional(),
    }),
    res: TranscriptionConfig,
  },
  "meeting:checkScreenPermission": {
    req: z.null(),
    res: z.object({
      granted: z.boolean(),
    }),
  },
  "meeting:openScreenRecordingSettings": {
    req: z.null(),
    res: z.object({ success: z.boolean() }),
  },
  "meeting:summarize": {
    req: z.object({
      transcript: z.string(),
      meetingStartTime: z.string().optional(),
      calendarEventJson: z.string().optional(),
    }),
    res: z.object({
      notes: z.string(),
    }),
  },
  // ---- Native dual-track capture (oppulence-audiocap sidecar) ----
  /** Which engine a start would actually use, so the renderer knows whether to run
   *  its own pipeline or hand off to the sidecar. */
  "meeting:captureEngine": {
    req: z.null(),
    res: z.object({ engine: meetings.MeetingResolvedEngine }),
  },
  "meeting:startCapture": {
    req: z.object({ calendarEventJson: z.string().optional() }),
    res: z.object({
      started: z.boolean(),
      sessionId: z.string().optional(),
      notePath: z.string().optional(),
      tracks: z.array(meetings.MeetingTrackId).default([]),
      warnings: z.array(z.string()).default([]),
      error: z.string().optional(),
    }),
  },
  "meeting:stopCapture": {
    req: z.null(),
    res: z.object({
      stopped: z.boolean(),
      sessionId: z.string().optional(),
      queued: z.boolean().default(false),
    }),
  },
  "meeting:captureStatus": {
    req: z.null(),
    res: meetings.MeetingCaptureStatus,
  },
  "meeting:listSessions": {
    req: z.null(),
    res: z.object({ sessions: z.array(meetings.MeetingSessionSummary) }),
  },
  "meeting:retranscribe": {
    req: z.object({ sessionId: z.string() }),
    res: z.object({ queued: z.boolean(), error: z.string().optional() }),
  },
  "meeting:deleteSession": {
    req: z.object({ sessionId: z.string() }),
    res: z.object({ deleted: z.boolean() }),
  },
  "meeting:captureDoctor": {
    req: z.null(),
    res: meetings.MeetingDoctorReport,
  },
  /** Event (ipc.on): capture state changed. Broadcast on every transition so a
   *  tray-started session shows up in the window, and vice versa. */
  "meeting:captureState": {
    req: meetings.MeetingCaptureStatus,
    res: z.null(),
  },
  /** Event (ipc.on): per-track peak levels while recording, main → renderer. */
  "meeting:captureLevel": {
    req: meetings.MeetingLevels,
    res: z.null(),
  },
  /** Event (ipc.on): transcription queue progress, main → renderer. */
  "meeting:captureProgress": {
    req: meetings.MeetingTranscriptionProgress,
    res: z.null(),
  },
  /** Event (ipc.on): capture stopped without being asked (sidecar crash, quit). */
  "meeting:captureEnded": {
    req: z.object({
      sessionId: z.string(),
      crashed: z.boolean(),
      queued: z.boolean(),
    }),
    res: z.null(),
  },
  // Inline task schedule classification
  "export:note": {
    req: z.object({
      markdown: z.string(),
      format: z.enum(["md", "pdf", "docx"]),
      title: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  "inline-task:classifySchedule": {
    req: z.object({
      instruction: z.string(),
    }),
    res: z.object({
      schedule: z
        .union([
          z.object({
            type: z.literal("cron"),
            expression: z.string(),
            startDate: z.string(),
            endDate: z.string(),
            label: z.string(),
          }),
          z.object({
            type: z.literal("window"),
            cron: z.string(),
            startTime: z.string(),
            endTime: z.string(),
            startDate: z.string(),
            endDate: z.string(),
            label: z.string(),
          }),
          z.object({ type: z.literal("once"), runAt: z.string(), label: z.string() }),
        ])
        .nullable(),
    }),
  },
  "inline-task:process": {
    req: z.object({
      instruction: z.string(),
      noteContent: z.string(),
      notePath: z.string(),
    }),
    res: z.object({
      instruction: z.string(),
      schedule: z
        .union([
          z.object({
            type: z.literal("cron"),
            expression: z.string(),
            startDate: z.string(),
            endDate: z.string(),
          }),
          z.object({
            type: z.literal("window"),
            cron: z.string(),
            startTime: z.string(),
            endTime: z.string(),
            startDate: z.string(),
            endDate: z.string(),
          }),
          z.object({ type: z.literal("once"), runAt: z.string() }),
        ])
        .nullable(),
      scheduleLabel: z.string().nullable(),
      response: z.string().nullable(),
    }),
  },
  // Live-note channels
  "live-note:run": {
    req: z.object({
      filePath: z.string(),
      context: z.string().optional(),
    }),
    res: z.object({
      success: z.boolean(),
      runId: z.string().nullable().optional(),
      action: z.enum(["replace", "no_update"]).optional(),
      summary: z.string().nullable().optional(),
      contentAfter: z.string().nullable().optional(),
      error: z.string().optional(),
    }),
  },
  "live-note:get": {
    req: z.object({
      filePath: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      // Fresh, authoritative live-note object from frontmatter, or null when
      // the note is passive. Renderer should use this for display/edit —
      // never a stale cached copy.
      live: LiveNoteSchema.nullable().optional(),
      error: z.string().optional(),
    }),
  },
  "live-note:set": {
    req: z.object({
      filePath: z.string(),
      live: LiveNoteSchema,
    }),
    res: z.object({
      success: z.boolean(),
      live: LiveNoteSchema.nullable().optional(),
      error: z.string().optional(),
    }),
  },
  "live-note:setActive": {
    req: z.object({
      filePath: z.string(),
      active: z.boolean(),
    }),
    res: z.object({
      success: z.boolean(),
      live: LiveNoteSchema.nullable().optional(),
      error: z.string().optional(),
    }),
  },
  "live-note:delete": {
    req: z.object({
      filePath: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  "live-note:stop": {
    req: z.object({
      filePath: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  "live-note:listNotes": {
    req: z.null(),
    res: z.object({
      notes: z.array(
        z.object({
          path: RelPath,
          createdAt: z.string().nullable(),
          lastRunAt: z.string().nullable(),
          isActive: z.boolean(),
          objective: z.string(),
        }),
      ),
    }),
  },
  // Background-task channels
  "bg-task:run": {
    req: z.object({
      slug: z.string(),
      context: z.string().optional(),
    }),
    res: z.object({
      success: z.boolean(),
      runId: z.string().nullable().optional(),
      summary: z.string().nullable().optional(),
      run: BackgroundTaskCloudRunSchema.optional(),
      error: z.string().optional(),
    }),
  },
  "bg-task:get": {
    req: z.object({
      slug: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      task: BackgroundTaskSchema.nullable().optional(),
      error: z.string().optional(),
    }),
  },
  "bg-task:patch": {
    req: z.object({
      slug: z.string(),
      partial: BackgroundTaskPatchSchema,
    }),
    res: z.object({
      success: z.boolean(),
      task: BackgroundTaskSchema.nullable().optional(),
      error: z.string().optional(),
    }),
  },
  "bg-task:create": {
    req: z.object({
      name: z.string(),
      instructions: z.string(),
      triggers: TriggersSchema.optional(),
      model: z.string().optional(),
      provider: z.string().optional(),
      executionTarget: BackgroundTaskSchema.shape.executionTarget.optional(),
    }),
    res: z.object({
      success: z.boolean(),
      slug: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  "bg-task:delete": {
    req: z.object({
      slug: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  "bg-task:stop": {
    req: z.object({
      slug: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  "bg-task:list": {
    req: z.object({
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().optional(),
      sort: z.enum(["createdAt:desc", "createdAt:asc", "name:asc"]).optional(),
    }),
    res: z.object({
      items: z.array(BackgroundTaskSummarySchema),
      total: z.number().int().nonnegative(),
    }),
  },
  // Returns the runIds recorded in `bg-tasks/<slug>/runs.log` (newest first).
  // The renderer turns each id into a full Run via the existing `runs:fetch`
  // channel — bg-task transcripts now live at the global $WorkDir/runs/.
  "bg-task:listRunIds": {
    req: z.object({
      slug: z.string(),
      limit: z.number().int().positive().optional(),
    }),
    res: z.object({
      runIds: z.array(z.string()),
    }),
  },
  "bg-task:triggerCloudRun": {
    req: z.object({
      slug: z.string(),
      trigger: BackgroundTaskTrigger.optional(),
      context: z.string().optional(),
    }),
    res: z.object({
      success: z.boolean(),
      run: BackgroundTaskCloudRunSchema.optional(),
      error: z.string().optional(),
    }),
  },
  "bg-task:getCloudRun": {
    req: z.object({
      slug: z.string(),
      runId: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      run: BackgroundTaskCloudRunSchema.optional(),
      error: z.string().optional(),
    }),
  },
  "bg-task:getCloudRunStatus": {
    req: z.object({
      slug: z.string(),
      runId: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      status: BackgroundTaskCloudRunStatusSchema.optional(),
      error: z.string().optional(),
    }),
  },
  "bg-task:listCloudRuns": {
    req: z.object({
      slug: z.string(),
      status: BackgroundTaskRunStatus.optional(),
      executor: BackgroundTaskRunExecutor.optional(),
      limit: z.number().int().positive().max(500).optional(),
      cursor: z.string().optional(),
    }),
    res: z.object({
      success: z.boolean(),
      runs: z.array(BackgroundTaskCloudRunSchema),
      nextCursor: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  "bg-task:listCloudRunEvents": {
    req: z.object({
      slug: z.string(),
      runId: z.string(),
      afterSeq: z.number().int().nonnegative().optional(),
    }),
    res: z.object({
      success: z.boolean(),
      events: z.array(BackgroundTaskCloudRunEventSchema),
      error: z.string().optional(),
    }),
  },
  "bg-task:cancelCloudRun": {
    req: z.object({
      slug: z.string(),
      runId: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      run: BackgroundTaskCloudRunSchema.optional(),
      error: z.string().optional(),
    }),
  },
  "bg-task:retryCloudRun": {
    req: z.object({
      slug: z.string(),
      runId: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      run: BackgroundTaskCloudRunSchema.optional(),
      error: z.string().optional(),
    }),
  },
  "bg-task:signalCloudRun": {
    req: z.object({
      slug: z.string(),
      runId: z.string(),
      signal: BackgroundTaskSignal,
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
    res: z.object({
      success: z.boolean(),
      run: BackgroundTaskCloudRunSchema.optional(),
      error: z.string().optional(),
    }),
  },
  "bg-task:pullCloudArtifact": {
    req: z.object({
      slug: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  // Cross-task cloud run listing for the global Cloud Runs view.
  "bg-task:listAllCloudRuns": {
    req: z.object({
      status: BackgroundTaskRunStatus.optional(),
      trigger: BackgroundTaskTrigger.optional(),
      executor: BackgroundTaskRunExecutor.optional(),
      slug: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      limit: z.number().int().positive().max(500).optional(),
      cursor: z.string().optional(),
    }),
    res: z.object({
      success: z.boolean(),
      runs: z.array(BackgroundTaskCloudRunSchema),
      nextCursor: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  // Rerun-with-same-context: a fresh manual run reusing the original context.
  "bg-task:rerunCloudRun": {
    req: z.object({
      slug: z.string(),
      runId: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      run: BackgroundTaskCloudRunSchema.optional(),
      error: z.string().optional(),
    }),
  },
  "bg-task:getArtifactSyncState": {
    req: z.object({
      slug: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      sync: BackgroundTaskArtifactSyncSchema.optional(),
      error: z.string().optional(),
    }),
  },
  "bg-task:getCloudScheduleState": {
    req: z.object({
      slug: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      state: BackgroundTaskCloudScheduleStateSchema.optional(),
      error: z.string().optional(),
    }),
  },
  // Pushed from main → renderer after boot when cloud runs completed while
  // the app was closed (RFC 006 offline-return).
  "bg-task:offlineRuns": {
    req: BackgroundTaskOfflineRunsEventSchema,
    res: z.null(),
  },
  // Embedded browser (WebContentsView) channels
  "browser:setBounds": {
    req: z.object({
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int().nonnegative(),
      height: z.number().int().nonnegative(),
    }),
    res: z.object({ ok: z.literal(true) }),
  },
  "browser:setVisible": {
    req: z.object({ visible: z.boolean() }),
    res: z.object({ ok: z.literal(true) }),
  },
  "browser:newTab": {
    req: z.object({
      url: z
        .string()
        .min(1)
        .refine(
          (u) => {
            const lower = u.trim().toLowerCase();
            if (lower.startsWith("javascript:")) return false;
            if (lower.startsWith("data:")) return false;
            if (lower.startsWith("vbscript:")) return false;
            if (lower.startsWith("file://")) return false;
            if (lower.startsWith("chrome://")) return false;
            if (lower.startsWith("chrome-extension://")) return false;
            return true;
          },
          { message: "Unsafe URL scheme" },
        )
        .optional(),
    }),
    res: z.object({
      ok: z.boolean(),
      tabId: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  "browser:switchTab": {
    req: z.object({ tabId: z.string().min(1) }),
    res: z.object({ ok: z.boolean() }),
  },
  "browser:closeTab": {
    req: z.object({ tabId: z.string().min(1) }),
    res: z.object({ ok: z.boolean() }),
  },
  "browser:navigate": {
    req: z.object({
      url: z
        .string()
        .min(1)
        .refine(
          (u) => {
            const lower = u.trim().toLowerCase();
            if (lower.startsWith("javascript:")) return false;
            if (lower.startsWith("data:")) return false;
            if (lower.startsWith("vbscript:")) return false;
            if (lower.startsWith("file://")) return false;
            if (lower.startsWith("chrome://")) return false;
            if (lower.startsWith("chrome-extension://")) return false;
            return true;
          },
          { message: "Unsafe URL scheme" },
        ),
    }),
    res: z.object({
      ok: z.boolean(),
      error: z.string().optional(),
    }),
  },
  "browser:back": {
    req: z.null(),
    res: z.object({ ok: z.boolean() }),
  },
  "browser:forward": {
    req: z.null(),
    res: z.object({ ok: z.boolean() }),
  },
  "browser:reload": {
    req: z.null(),
    res: z.object({ ok: z.literal(true) }),
  },
  "browser:getState": {
    req: z.null(),
    res: BrowserStateSchema,
  },
  "browser:didUpdateState": {
    req: BrowserStateSchema,
    res: z.null(),
  },
  // Billing channels
  "billing:getInfo": {
    req: z.null(),
    res: BillingInfoSchema,
  },
  "billing:getCheckoutUrl": {
    req: z.object({
      plan: z.enum(["starter", "pro"]),
    }),
    res: z.object({
      url: z.string(),
    }),
  },
  "billing:getPortalUrl": {
    req: z.null(),
    res: z.object({
      url: z.string(),
    }),
  },
  "billing:sync": {
    req: z.null(),
    res: z.object({
      success: z.boolean(),
    }),
  },
  "relationships:list": {
    req: z.object({
      q: z.string().optional(),
      lifecycle: z.string().optional(),
      health: z.string().optional(),
      engagement: z.string().optional(),
    }),
    res: z.object({ relationships: z.array(RelationshipSchema) }),
  },
  "relationships:create": {
    req: z.object({
      kind: z.string().min(1),
      displayName: z.string().min(1),
      primaryEmail: z.string().optional(),
      accountDomain: z.string().optional(),
      summary: z.string().optional(),
    }),
    res: RelationshipSchema,
  },
  "relationships:search": {
    req: z.object({ query: z.string().min(1) }),
    res: z.object({
      available: z.boolean(),
      matches: z.array(RelationshipSemanticMatchSchema),
    }),
  },
  "relationships:get": {
    req: z.object({ id: z.string() }),
    res: RelationshipDetailSchema,
  },
  "relationships:timeline": {
    req: z.object({ id: z.string(), limit: z.number().int().min(1).max(100).optional() }),
    res: z.object({ observations: z.array(RelationshipObservationSchema) }),
  },
  "relationships:changes": {
    req: z.object({ id: z.string() }),
    res: z.object({ snapshots: z.array(RelationshipStateSnapshotSchema) }),
  },
  "relationships:sources": {
    req: z.null(),
    res: z.object({ sources: z.array(RelationshipSourceStatusSchema) }),
  },
  "relationships:evidence": {
    req: z.object({ relationshipId: z.string(), evidenceId: z.string() }),
    res: z.object({ observation: RelationshipObservationSchema, payload: z.unknown() }),
  },
  "relationships:correct": {
    req: z.object({
      id: z.string(),
      dimension: z.enum(["lifecycle", "engagement", "sentiment", "health", "next_action"]),
      value: z.string().min(1),
      reason: z.string().min(1),
    }),
    res: RelationshipSchema,
  },
  "relationships:approve": {
    req: z.object({ actionId: z.string(), acceptRisk: z.boolean().optional() }),
    res: RelationshipActionSchema,
  },
  "relationships:reject": {
    req: z.object({ actionId: z.string(), reason: z.string().min(1) }),
    res: RelationshipActionSchema,
  },
  // Feedback (relayed to Plain via the backend; signed-in only)
  "feedback:submit": {
    req: z.object({
      category: z.enum(["bug", "feature", "question", "other"]),
      message: z.string().min(1).max(5000),
    }),
    res: z.object({
      success: z.boolean(),
      errorCode: z.enum(["not_signed_in", "server"]).optional(),
      error: z.string().optional(),
    }),
  },
} as const;

// ============================================================================
// Type Helpers
// ============================================================================

export type IPCChannels = {
  [K in keyof typeof ipcSchemas]: {
    req: z.infer<(typeof ipcSchemas)[K]["req"]>;
    res: z.infer<(typeof ipcSchemas)[K]["res"]>;
  };
};

/**
 * Channels that use invoke/handle (request/response pattern)
 * These are channels with non-null responses
 */
export type InvokeChannels = {
  [K in keyof IPCChannels]: IPCChannels[K]["res"] extends null ? never : K;
}[keyof IPCChannels];

/**
 * Channels that use send/on (fire-and-forget pattern)
 * These are channels with null responses (no response expected)
 */
export type SendChannels = {
  [K in keyof IPCChannels]: IPCChannels[K]["res"] extends null ? K : never;
}[keyof IPCChannels];

// ============================================================================
// Type Guards
// ============================================================================

export function validateRequest<K extends keyof IPCChannels>(
  channel: K,
  data: unknown,
): IPCChannels[K]["req"] {
  const schema = ipcSchemas[channel].req;
  return schema.parse(data) as IPCChannels[K]["req"];
}

export function validateResponse<K extends keyof IPCChannels>(
  channel: K,
  data: unknown,
): IPCChannels[K]["res"] {
  const schema = ipcSchemas[channel].res;
  return schema.parse(data) as IPCChannels[K]["res"];
}
