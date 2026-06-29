#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const DEFAULT_WORKSPACE_DIR = path.join(os.homedir(), ".rowboat");
const DEFAULT_API_DB = path.join(repoRoot, "apps/rowboat-api/rowboat-dev.db");
const API_MIGRATION = path.join(repoRoot, "apps/rowboat-api/migrations/0001_init.sql");

const IsoDate = z.string().min(1);
const RelPath = z
  .string()
  .min(1)
  .refine((value) => !path.isAbsolute(value) && !value.includes(".."), {
    message: "must be a workspace-relative path without '..'",
  });

const TriggerSchema = z.object({
  cronExpr: z.string().optional(),
  windows: z
    .array(
      z.object({
        startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      }),
    )
    .optional(),
  eventMatchCriteria: z.string().optional(),
});

const WorkspaceFileSchema = z.object({
  path: RelPath,
  body: z.string(),
  mtime: IsoDate.optional(),
});

const DesktopTaskSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  instructions: z.string().min(1),
  active: z.boolean(),
  executionTarget: z.enum(["desktop", "api"]),
  triggers: TriggerSchema.optional(),
  createdAt: IsoDate,
  lastAttemptAt: IsoDate.optional(),
  lastRunId: z.string().optional(),
  lastRunAt: IsoDate.optional(),
  lastRunSummary: z.string().optional(),
  scheduleSyncState: z.enum(["current", "syncing", "failed", "paused"]).optional(),
  scheduleSyncedAt: IsoDate.optional(),
  artifact: z.string(),
  runs: z.array(z.string()).default([]),
});

const GmailMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string().optional(),
  cc: z.string().optional(),
  date: IsoDate,
  subject: z.string(),
  body: z.string(),
  bodyHtml: z.string().optional(),
  unread: z.boolean().optional(),
  messageIdHeader: z.string().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        mimeType: z.string().optional(),
        sizeBytes: z.number().int().nonnegative().optional(),
        savedPath: z.string(),
      }),
    )
    .optional(),
});

const GmailThreadSchema = z.object({
  threadId: z.string().min(1),
  threadUrl: z.string().url(),
  summary: z.string().optional(),
  subject: z.string(),
  from: z.string(),
  to: z.string().optional(),
  date: IsoDate,
  latest_email: z.string(),
  past_summary: z.string().optional(),
  unread: z.boolean().optional(),
  importance: z.enum(["important", "other"]).optional(),
  draft_response: z.string().optional(),
  messages: z.array(GmailMessageSchema).min(1),
});

const ApiUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  workosUserId: z.string().min(1),
  workosOrgId: z.string().optional(),
});

const ApiTaskSchema = z.object({
  id: z.string().uuid(),
  artifactId: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  instructions: z.string().min(1),
  active: z.boolean(),
  triggers: TriggerSchema.optional(),
  executionTarget: z.enum(["desktop", "api"]),
  createdAt: IsoDate,
  lastAttemptAt: IsoDate.optional(),
  lastRunId: z.string().optional(),
  lastRunAt: IsoDate.optional(),
  lastRunSummary: z.string().optional(),
  scheduleSyncState: z.enum(["current", "syncing", "failed", "paused"]).default("paused"),
  scheduleSyncedAt: IsoDate.optional(),
  artifact: z.string(),
});

const ApiRunSchema = z.object({
  id: z.string().uuid(),
  taskSlug: z.string().min(1),
  runId: z.string().min(1),
  trigger: z.enum(["manual", "cron", "window", "event", "retry"]),
  status: z.enum(["queued", "running", "succeeded", "failed", "stopped"]),
  executor: z.enum(["desktop", "api"]),
  startedAt: IsoDate,
  completedAt: IsoDate.optional(),
  summary: z.string().optional(),
  progressPercent: z.number().int().min(0).max(100).optional(),
  progressMessage: z.string().optional(),
  cloudEventKey: z.string().optional(),
  events: z.array(
    z.object({
      id: z.string().uuid(),
      seq: z.number().int().nonnegative(),
      eventType: z.string(),
      event: z.record(z.string(), z.unknown()),
      receivedAt: IsoDate,
    }),
  ),
});

const ApiSeedSchema = z.object({
  user: ApiUserSchema,
  subscription: z.object({
    id: z.string().uuid(),
    plan: z.enum(["free", "starter", "pro"]),
    status: z.enum(["active", "trialing", "past_due", "canceled"]),
    sanctionedCredits: z.number().int().nonnegative(),
  }),
  tasks: z.array(ApiTaskSchema),
  runs: z.array(ApiRunSchema),
  cloudEvents: z.array(
    z.object({
      id: z.string().uuid(),
      key: z.string().min(1),
      source: z.enum([
        "gmail",
        "google_calendar",
        "google_drive",
        "slack",
        "webhook",
        "mcp",
        "github",
        "linear",
        "stripe",
        "internal",
      ]),
      sourceEventId: z.string().optional(),
      sourceAccountId: z.string().optional(),
      eventType: z.string().optional(),
      subject: z.string().optional(),
      text: z.string().optional(),
      dedupeKey: z.string(),
      routingStatus: z.enum(["pending", "routed", "skipped", "failed"]),
      matchedTaskCount: z.number().int().nonnegative(),
      occurredAt: IsoDate,
      routing: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  oauthConnections: z.array(
    z.object({
      id: z.string().uuid(),
      provider: z.string(),
      externalAccountId: z.string(),
      scopes: z.array(z.string()),
    }),
  ),
  mcpConnections: z.array(
    z.object({
      id: z.string().uuid(),
      connector: z.string(),
      audience: z.string(),
      scopes: z.array(z.string()),
      connectedAt: IsoDate,
      lastUsedAt: IsoDate,
    }),
  ),
  composioAccounts: z.array(
    z.object({
      id: z.string().uuid(),
      accountId: z.string(),
      toolkit: z.string(),
    }),
  ),
  llmUsage: z.array(
    z.object({
      id: z.string().uuid(),
      requestId: z.string().uuid(),
      model: z.string(),
      useCase: z.string(),
      subUseCase: z.string(),
      agentName: z.string(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      costUnits: z.number().int().nonnegative(),
      ts: IsoDate,
    }),
  ),
  creditLedger: z.array(
    z.object({
      id: z.string().uuid(),
      requestId: z.string().uuid(),
      delta: z.number().int(),
      reason: z.string(),
      ts: IsoDate,
    }),
  ),
  meetingMinutes: z.object({
    id: z.string().uuid(),
    period: z.string(),
    usedSeconds: z.number().int().nonnegative(),
    reservedSeconds: z.number().int().nonnegative(),
  }),
});

const SeedSchema = z.object({
  generatedAt: IsoDate,
  workspace: z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    files: z.array(WorkspaceFileSchema),
    tasks: z.array(DesktopTaskSchema),
    runs: z.array(
      z.object({
        id: z.string().min(1),
        events: z.array(z.record(z.string(), z.unknown())).min(1),
      }),
    ),
    gmailThreads: z.array(GmailThreadSchema),
  }),
  api: ApiSeedSchema,
});

type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;
type DesktopTask = z.infer<typeof DesktopTaskSchema>;
type GmailThread = z.infer<typeof GmailThreadSchema>;
type ApiTask = z.infer<typeof ApiTaskSchema>;
type ApiRun = z.infer<typeof ApiRunSchema>;
type ApiSeed = z.infer<typeof ApiSeedSchema>;
type Seed = z.infer<typeof SeedSchema>;
type SqlDialect = "sqlite" | "postgres";

type CliArgs = {
  workspaceDir: string;
  apiDb: string;
  skipDesktop: boolean;
  skipApi: boolean;
  dryRun: boolean;
  help: boolean;
};

type RunEventsInput = {
  runId: string;
  ts: string;
  title: string;
  summary: string;
  agentName: string;
  useCase: string;
  subUseCase: string;
  toolName: string;
  toolInput: string;
  toolResult: string;
};

type GmailThreadInput = {
  threadId: string;
  date: string;
  from: string;
  to?: string;
  subject: string;
  latest: string;
  summary: string;
  importance?: GmailThread["importance"];
  unread?: boolean;
  draft?: string;
};

type ApiRunInput = {
  key: string;
  taskSlug: string;
  runId: string;
  trigger: ApiRun["trigger"];
  startedAt: string;
  completedAt?: string;
  summary?: string;
  cloudEventKey?: string;
};

function uuid(seed: string): string {
  const bytes = crypto.createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const t = {
  now: "2026-06-28T15:30:00.000Z",
  plus1h: "2026-06-28T16:30:00.000Z",
  morning: "2026-06-28T13:05:00.000Z",
  earlier: "2026-06-28T11:40:00.000Z",
  yesterday: "2026-06-27T20:15:00.000Z",
  week: "2026-06-22T17:00:00.000Z",
};

const taskSlugs = {
  followup: "customer-follow-up-digest",
  renewal: "renewal-risk-monitor",
  competitive: "competitive-signal-watch",
};

const runIds = {
  followup: "2026-06-28T15-12-44Z-demo-follow-up",
  renewal: "2026-06-28T14-02-19Z-demo-renewal-risk",
  competitive: "2026-06-28T13-18-06Z-demo-competitive",
};

const desktopTasks: DesktopTask[] = [
  {
    slug: taskSlugs.followup,
    name: "Customer follow-up digest",
    instructions:
      "Every weekday morning, summarize customer emails and meeting notes that need an owner, a response, or an escalation.",
    active: true,
    executionTarget: "api",
    triggers: {
      cronExpr: "0 9 * * 1-5",
      eventMatchCriteria:
        "Customer email, meeting note, or webhook event that mentions a promise, blocker, renewal risk, security question, or executive follow-up.",
    },
    createdAt: t.week,
    lastAttemptAt: t.now,
    lastRunId: runIds.followup,
    lastRunAt: t.now,
    lastRunSummary: "Found 4 open customer follow-ups and prepared owner-ready next actions.",
    scheduleSyncState: "current",
    scheduleSyncedAt: t.now,
    runs: [runIds.followup],
    artifact: `# Customer follow-up digest

Updated ${t.now}

## Needs action
| Customer | Owner | Ask | Suggested next step |
| --- | --- | --- | --- |
| Acme Capital | Noah | Security scope explanation | Send scoped OAuth answer |
| Northstar Labs | Priya | Champion handoff | Book stakeholder reset |
| Meridian Health | Maya | Support workflow expansion | Share embedded widget plan |

## Draftable responses
- Acme Capital: concise security note with OAuth scopes and data-retention boundaries.
- Meridian Health: propose a two-week widget trial against their internal help center.
`,
  },
  {
    slug: taskSlugs.renewal,
    name: "Renewal risk monitor",
    instructions:
      "Keep renewal risk notes current by watching customer communication, meeting notes, and support status changes.",
    active: true,
    executionTarget: "api",
    triggers: {
      cronExpr: "15 8 * * 1-5",
      windows: [{ startTime: "08:00", endTime: "11:00" }],
    },
    createdAt: t.week,
    lastAttemptAt: t.morning,
    lastRunId: runIds.renewal,
    lastRunAt: t.morning,
    lastRunSummary: "Updated Acme risk from security questions and added a dashboard follow-up.",
    scheduleSyncState: "current",
    scheduleSyncedAt: t.morning,
    runs: [runIds.renewal],
    artifact: `# Renewal risk monitor

## Risk changes
- Acme Capital remains green, but security answers are now the gating item.
- Northstar Labs moved to watch because the champion changed roles.
- Meridian Health is ready for a second workflow if support widget scope is approved.

## Recommended focus
Prioritize Acme security answers and get one explicit owner for GitHub/Linear scope.
`,
  },
  {
    slug: taskSlugs.competitive,
    name: "Competitive signal watch",
    instructions:
      "Track market, competitor, and customer-language signals that should change Oppulence positioning.",
    active: true,
    executionTarget: "desktop",
    triggers: {
      cronExpr: "30 9 * * 1-5",
    },
    createdAt: t.week,
    lastAttemptAt: t.earlier,
    lastRunId: runIds.competitive,
    lastRunAt: t.earlier,
    lastRunSummary: "Captured new positioning around owned memory and embedded support agents.",
    scheduleSyncState: "paused",
    runs: [runIds.competitive],
    artifact: `# Competitive signal watch

## Signals to reuse
- Owned memory is now a buying criterion for agent deployments.
- Static FAQ widgets are being replaced by account-aware support surfaces.
- Customers want a clear review boundary before tools act on external systems.

## Messaging
Lead with "owned work graph for reviewable agents" rather than "AI help center".
`,
  },
];

const seed: Seed = SeedSchema.parse({
  generatedAt: t.now,
  workspace: {
    id: "oppulence-demo-workspace",
    displayName: "Oppulence Demo Workspace",
    files: [
      {
        path: "config/demo-seed.json",
        mtime: t.now,
        body: `${JSON.stringify(
          {
            workspaceId: "oppulence-demo-workspace",
            apiUser: "demo@oppulence.ai",
            seededAt: t.now,
          },
          null,
          2,
        )}\n`,
      },
      {
        path: "config/note_creation.json",
        mtime: t.now,
        body: `${JSON.stringify(
          {
            strictness: "medium",
            configured: false,
            onboardingComplete: true,
          },
          null,
          2,
        )}\n`,
      },
      {
        path: "knowledge/Customers/Acme Capital.md",
        mtime: t.now,
        body: `---
tags: [customer, revenue, pilot]
owner: Maya Patel
status: active-pilot
---
# Acme Capital

Acme Capital is evaluating Oppulence for relationship-aware support and renewal operations.

## Current goals
- Replace weekly manual account reviews with a live renewal desk.
- Give support agents context from Gmail, meetings, and product notes before they respond.
- Keep executive follow-ups in one reviewable queue.

## Open commitments
- Send security follow-up by Tuesday.
- Share a 30-day adoption dashboard proposal.
- Confirm whether GitHub and Linear sync should be scoped to the sandbox project first.

## Related
- [[Projects/Oppulence Pilot]]
- [[People/Maya Patel]]
- [[Live Notes/Renewal Desk Pulse]]
`,
      },
      {
        path: "knowledge/Projects/Oppulence Pilot.md",
        mtime: t.morning,
        body: `---
tags: [project, pilot, implementation]
stage: implementation
---
# Oppulence Pilot

The pilot connects Gmail, Calendar, meeting notes, and background tasks into one workspace.

## Workstreams
| Workstream | Status | Next step |
| --- | --- | --- |
| Gmail ingestion | Ready for validation | Review three seeded follow-up threads |
| Meeting notes | In review | Confirm summary format with Maya |
| Live renewal pulse | Active | Refresh every weekday morning |
| API worker tasks | Active | Mirror local task status in rowboat-api |

## Launch criteria
- Customer summary can be prepared from the knowledge graph.
- Background tasks show last run status and cloud execution metadata.
- Support reply draft includes customer-specific commitments.
`,
      },
      {
        path: "knowledge/People/Maya Patel.md",
        mtime: t.earlier,
        body: `---
tags: [person, customer, executive-sponsor]
company: Acme Capital
---
# Maya Patel

Maya is the executive sponsor for the Acme Capital pilot. She cares about auditability, executive visibility, and not letting follow-ups disappear after meetings.

## Preferences
- Short status updates with clear owner/date.
- Escalate risks early.
- Attach source context when recommending an action.

## Recent context
- Asked whether Oppulence can distinguish product-source context from account-specific commitments.
- Wants a weekly digest of renewal risk and open support loops.
`,
      },
      {
        path: "knowledge/People/Noah Kim.md",
        mtime: t.earlier,
        body: `---
tags: [person, internal, success]
team: customer-success
---
# Noah Kim

Noah owns the Acme pilot rollout and reviews the generated customer follow-up digest each morning.

## Operating notes
- Keep the digest under five bullets.
- Include direct links to customer notes and meeting notes.
- Escalate missing security answers before drafting outbound email.
`,
      },
      {
        path: "knowledge/Live Notes/Renewal Desk Pulse.md",
        mtime: t.now,
        body: `---
tags: [live-note, renewal, customer-success]
live:
  objective: |-
    Keep the renewal desk current with customer risk, open executive commitments, and recommended follow-ups.
  active: true
  triggers:
    cronExpr: "0 8 * * 1-5"
    eventMatchCriteria: |-
      Customer email, calendar, Slack, Linear, or GitHub events that change renewal risk or executive follow-up priority.
  lastAttemptAt: "${t.morning}"
  lastRunAt: "${t.morning}"
  lastRunId: "${runIds.renewal}"
  lastRunSummary: "Updated Acme Capital risk, open commitments, and next-best follow-up."
---
# Renewal Desk Pulse

## Highest priority
1. **Acme Capital security follow-up** - Maya asked for SOC 2 timeline and Google OAuth scope notes.
2. **Pilot adoption dashboard** - Noah needs a draft dashboard for the Friday readout.
3. **GitHub/Linear scope** - Product team wants the first sync limited to sandbox repositories.

## Customer health
| Account | Status | Signal | Next action |
| --- | --- | --- | --- |
| Acme Capital | Green with risk | Security questions open | Send scoped answer |
| Northstar Labs | Watch | Champion changed teams | Rebuild stakeholder map |
| Meridian Health | Green | Meeting notes adopted | Expand to support queue |

## Agent recommendation
Draft a concise email to Maya with the security answer, link the pilot dashboard proposal, and ask for one owner for GitHub/Linear scope approval.
`,
      },
      {
        path: "knowledge/Live Notes/Competitive Watch.md",
        mtime: t.earlier,
        body: `---
tags: [live-note, market, research]
live:
  objective: |-
    Track competitor and market signals that should change positioning for agent memory, support automation, or customer-success workflows.
  active: true
  triggers:
    cronExpr: "30 9 * * 1-5"
  lastAttemptAt: "${t.earlier}"
  lastRunAt: "${t.earlier}"
  lastRunId: "${runIds.competitive}"
  lastRunSummary: "Captured three positioning changes around memory ownership and embedded support agents."
---
# Competitive Watch

## Signals
- Buyers are asking who owns the memory layer after support tickets close.
- Embedded support agents are moving from FAQ-only answers toward account-aware resolution.
- Procurement teams want clearer boundaries between source ingestion and external tool execution.

## Positioning to use
Oppulence is the owned memory and workflow layer for agents that need durable work context, not a rented answer widget.
`,
      },
      {
        path: "knowledge/Meetings/fireflies/2026-06-28/Acme Capital Pilot Kickoff.md",
        mtime: t.now,
        body: `# Acme Capital Pilot Kickoff

**Date:** 2026-06-28  
**Attendees:** Maya Patel, Noah Kim, Priya Desai, Oppulence team

## Summary
Acme wants the first pilot to prove that Oppulence can brief account teams, draft follow-ups, and keep renewal risks current without hiding source context.

## Decisions
- Start with Gmail, Calendar, meeting notes, and the sandbox Linear project.
- Use a human review gate before any outbound customer message.
- Keep notes in Markdown so Acme can inspect and correct the memory graph.

## Action items
- Noah: draft a 30-day adoption dashboard.
- Oppulence: send Google OAuth scope explanation.
- Maya: confirm GitHub repository scope.
`,
      },
      {
        path: "knowledge/Meetings/fireflies/2026-06-27/Support Automation Review.md",
        mtime: t.yesterday,
        body: `# Support Automation Review

**Date:** 2026-06-27  
**Attendees:** Support Ops, Product, Customer Success

## Key points
- Support wants answers that cite product docs and account-specific commitments.
- Product prefers escalating unclear requests to Linear instead of answering from stale docs.
- Customer Success wants a daily digest of unresolved executive asks.

## Follow-up
Create a background task that scans customer emails and meeting notes for unresolved commitments.
`,
      },
      {
        path: "knowledge/Workspace/Revenue Ops/Weekly Readout.md",
        mtime: t.now,
        body: `# Weekly Readout

## Pipeline
- 3 active pilots.
- 2 accounts ready for embedded support widget proof of concept.
- 1 procurement review waiting on security documentation.

## This week
- Ship the Acme pilot dashboard.
- Expand the renewal pulse to include Slack and GitHub events.
- Validate API worker runs in rowboat-api for scheduled tasks.
`,
      },
    ],
    tasks: desktopTasks,
    runs: [
      {
        id: runIds.followup,
        events: runEvents({
          runId: runIds.followup,
          ts: t.now,
          title: "Summarize customer follow-ups for today",
          summary:
            "I found four open customer follow-ups, grouped them by owner, and updated the digest artifact.",
          agentName: "background-task-agent",
          useCase: "background_task_agent",
          subUseCase: taskSlugs.followup,
          toolName: "workspace.search",
          toolInput: "customer follow-up OR security OR renewal",
          toolResult: "Matched Acme Capital, Renewal Desk Pulse, and two meeting notes.",
        }),
      },
      {
        id: runIds.renewal,
        events: runEvents({
          runId: runIds.renewal,
          ts: t.morning,
          title: "Refresh renewal risk monitor",
          summary: "Acme remains green with a security follow-up risk. Northstar moved to watch.",
          agentName: "background-task-agent",
          useCase: "background_task_agent",
          subUseCase: taskSlugs.renewal,
          toolName: "workspace.writeFile",
          toolInput: "knowledge/Live Notes/Renewal Desk Pulse.md",
          toolResult: "Updated risk table and next action.",
        }),
      },
      {
        id: runIds.competitive,
        events: runEvents({
          runId: runIds.competitive,
          ts: t.earlier,
          title: "Track competitive positioning changes",
          summary:
            "Updated the competitive watch note with three market signals around memory ownership.",
          agentName: "background-task-agent",
          useCase: "background_task_agent",
          subUseCase: taskSlugs.competitive,
          toolName: "workspace.readFile",
          toolInput: "knowledge/Live Notes/Competitive Watch.md",
          toolResult: "Read existing positioning notes and appended new signals.",
        }),
      },
      {
        id: "2026-06-28T15-25-01Z-demo-chat",
        events: runEvents({
          runId: "2026-06-28T15-25-01Z-demo-chat",
          ts: "2026-06-28T15:25:01.000Z",
          title: "Brief me on Acme before I reply to Maya",
          summary:
            "Acme is active-pilot, security is the open blocker, and the best reply is a scoped OAuth explanation plus dashboard next step.",
          agentName: "copilot",
          useCase: "copilot_chat",
          subUseCase: "customer-brief",
          toolName: "memory.search",
          toolInput: "Acme Capital Maya security pilot",
          toolResult: "Found customer note, kickoff meeting, and renewal pulse.",
        }),
      },
    ],
    gmailThreads: [
      gmailThread({
        threadId: "demo-acme-security",
        date: t.now,
        from: "Maya Patel <maya@acme-capital.example>",
        to: "Noah Kim <noah@oppulence.ai>",
        subject: "Security notes before the pilot readout",
        latest:
          "Can you send the Google OAuth scope explanation and clarify which data stays in the local workspace before Tuesday's readout?",
        summary:
          "Maya needs the OAuth scope explanation, local data boundary, and security timeline before the Acme pilot readout.",
        importance: "important",
        unread: true,
        draft:
          "Hi Maya, yes. The pilot uses scoped Google access for mail/calendar sync, keeps generated notes in your local workspace, and gates outbound actions behind review. I will send the short security note and dashboard outline today.",
      }),
      gmailThread({
        threadId: "demo-meridian-widget",
        date: t.morning,
        from: "Elliot Grey <elliot@meridian-health.example>",
        to: "Noah Kim <noah@oppulence.ai>",
        subject: "Support widget trial scope",
        latest:
          "The support team wants the widget trial limited to internal help-center answers first. Can you share the checklist?",
        summary:
          "Meridian is ready for a limited internal support widget trial and needs the rollout checklist.",
        importance: "important",
        unread: true,
      }),
      gmailThread({
        threadId: "demo-northstar-handoff",
        date: t.yesterday,
        from: "Dana Ortiz <dana@northstar.example>",
        to: "Noah Kim <noah@oppulence.ai>",
        subject: "Champion handoff for renewal workflow",
        latest:
          "I am moving teams next month. Can we reset the stakeholder map before the renewal workflow expands?",
        summary:
          "Northstar champion is changing teams; renewal workflow needs a stakeholder reset.",
        importance: "other",
        unread: false,
      }),
    ],
  },
  api: {
    user: {
      id: uuid("user:oppulence-demo"),
      email: "demo@oppulence.ai",
      workosUserId: "user_oppulence_demo",
      workosOrgId: "org_oppulence_demo",
    },
    subscription: {
      id: uuid("subscription:oppulence-demo"),
      plan: "pro",
      status: "active",
      sanctionedCredits: 2000000,
    },
    tasks: [
      apiTaskFromDesktop("api-task:followup", "api-artifact:followup", taskSlugs.followup),
      apiTaskFromDesktop("api-task:renewal", "api-artifact:renewal", taskSlugs.renewal),
      apiTaskFromDesktop("api-task:competitive", "api-artifact:competitive", taskSlugs.competitive),
    ],
    runs: [
      apiRun({
        key: "api-run:followup",
        taskSlug: taskSlugs.followup,
        runId: runIds.followup,
        trigger: "event",
        startedAt: "2026-06-28T15:12:44.000Z",
        completedAt: "2026-06-28T15:14:02.000Z",
        summary: "Found 4 open customer follow-ups and prepared owner-ready next actions.",
        cloudEventKey: "cloud:event:acme-security",
      }),
      apiRun({
        key: "api-run:renewal",
        taskSlug: taskSlugs.renewal,
        runId: runIds.renewal,
        trigger: "cron",
        startedAt: "2026-06-28T14:02:19.000Z",
        completedAt: "2026-06-28T14:05:30.000Z",
        summary: "Updated Acme risk from security questions and added a dashboard follow-up.",
      }),
    ],
    cloudEvents: [
      {
        id: uuid("cloud:event:acme-security"),
        key: "cloud:event:acme-security",
        source: "gmail",
        sourceEventId: "gmail-history-demo-1042",
        sourceAccountId: "demo@oppulence.ai",
        eventType: "message.new",
        subject: "Security notes before the pilot readout",
        text: "Maya asked for Google OAuth scope explanation and local workspace data boundary before Tuesday's readout.",
        dedupeKey: "gmail:demo-acme-security:2026-06-28",
        routingStatus: "routed",
        matchedTaskCount: 1,
        occurredAt: t.now,
        routing: {
          matched: [taskSlugs.followup],
          reason: "Customer email contains security follow-up and pilot readout deadline.",
        },
      },
      {
        id: uuid("cloud:event:calendar-readout"),
        key: "cloud:event:calendar-readout",
        source: "google_calendar",
        sourceEventId: "cal-demo-readout",
        sourceAccountId: "demo@oppulence.ai",
        eventType: "event.updated",
        subject: "Acme pilot readout moved to Tuesday",
        text: "Calendar update changed the pilot readout window and increased follow-up priority.",
        dedupeKey: "calendar:acme-readout:2026-06-28",
        routingStatus: "routed",
        matchedTaskCount: 1,
        occurredAt: t.morning,
        routing: {
          matched: [taskSlugs.renewal],
          reason: "Readout changed the renewal risk timeline.",
        },
      },
    ],
    oauthConnections: [
      {
        id: uuid("oauth:google:demo"),
        provider: "google",
        externalAccountId: "demo@oppulence.ai",
        scopes: [
          "https://www.googleapis.com/auth/gmail.modify",
          "https://www.googleapis.com/auth/calendar.readonly",
          "https://www.googleapis.com/auth/drive.readonly",
        ],
      },
    ],
    mcpConnections: [
      {
        id: uuid("mcp:github:demo"),
        connector: "github",
        audience: "github-api",
        scopes: ["repo:read", "issues:read"],
        connectedAt: t.week,
        lastUsedAt: t.now,
      },
      {
        id: uuid("mcp:linear:demo"),
        connector: "linear",
        audience: "linear-api",
        scopes: ["issues:read", "teams:read"],
        connectedAt: t.week,
        lastUsedAt: t.morning,
      },
    ],
    composioAccounts: [
      {
        id: uuid("composio:gmail:demo"),
        accountId: "ca_oppulence_demo_gmail",
        toolkit: "gmail",
      },
      {
        id: uuid("composio:slack:demo"),
        accountId: "ca_oppulence_demo_slack",
        toolkit: "slack",
      },
    ],
    llmUsage: [
      {
        id: uuid("llm:followup"),
        requestId: uuid("request:followup"),
        model: "openai/gpt-5-mini",
        useCase: "background_task_agent",
        subUseCase: taskSlugs.followup,
        agentName: "Customer follow-up digest",
        inputTokens: 8420,
        outputTokens: 1210,
        costUnits: 385,
        ts: t.now,
      },
      {
        id: uuid("llm:chat"),
        requestId: uuid("request:chat"),
        model: "openai/gpt-5-mini",
        useCase: "copilot_chat",
        subUseCase: "customer-brief",
        agentName: "copilot",
        inputTokens: 5120,
        outputTokens: 740,
        costUnits: 220,
        ts: "2026-06-28T15:25:01.000Z",
      },
    ],
    creditLedger: [
      {
        id: uuid("ledger:grant"),
        requestId: uuid("request:grant"),
        delta: 2000000,
        reason: "grant",
        ts: t.week,
      },
      {
        id: uuid("ledger:followup"),
        requestId: uuid("request:followup"),
        delta: -385,
        reason: "llm_settle",
        ts: t.now,
      },
      {
        id: uuid("ledger:chat"),
        requestId: uuid("request:chat"),
        delta: -220,
        reason: "llm_settle",
        ts: "2026-06-28T15:25:01.000Z",
      },
    ],
    meetingMinutes: {
      id: uuid("meeting-minutes:2026-06"),
      period: "2026-06",
      usedSeconds: 5400,
      reservedSeconds: 0,
    },
  },
});

function runEvents({
  runId,
  ts,
  title,
  summary,
  agentName,
  useCase,
  subUseCase,
  toolName,
  toolInput,
  toolResult,
}: RunEventsInput): Record<string, unknown>[] {
  const base = { runId, subflow: [], ts };
  return [
    {
      ...base,
      type: "start",
      agentName,
      model: "openai/gpt-5-mini",
      provider: "openai",
      permissionMode: "auto",
      useCase,
      subUseCase,
    },
    {
      ...base,
      type: "message",
      messageId: `${runId}:user`,
      message: { role: "user", content: title },
    },
    {
      ...base,
      type: "tool-invocation",
      toolCallId: `${runId}:tool`,
      toolName,
      input: toolInput,
    },
    {
      ...base,
      type: "tool-result",
      toolCallId: `${runId}:tool`,
      toolName,
      result: toolResult,
    },
    {
      ...base,
      type: "message",
      messageId: `${runId}:assistant`,
      message: { role: "assistant", content: summary },
    },
    { ...base, type: "run-processing-end" },
  ];
}

function gmailThread({
  threadId,
  date,
  from,
  to,
  subject,
  latest,
  summary,
  importance,
  unread,
  draft,
}: GmailThreadInput): GmailThread {
  return {
    threadId,
    threadUrl: `https://mail.google.com/mail/u/0/#all/${threadId}`,
    summary,
    subject,
    from,
    to,
    date,
    latest_email: latest,
    past_summary:
      "Previous discussion covered pilot success criteria, review gates, and source visibility.",
    unread,
    importance,
    draft_response: draft,
    messages: [
      {
        id: `${threadId}-m1`,
        from,
        to,
        date,
        subject,
        body: latest,
        bodyHtml: `<p>${escapeHtml(latest)}</p>`,
        unread,
        messageIdHeader: `<${threadId}-m1@example.local>`,
      },
    ],
  };
}

function apiTaskFromDesktop(taskIdSeed: string, artifactIdSeed: string, slug: string): ApiTask {
  const task = seedlessDesktopTask(slug);
  return {
    id: uuid(taskIdSeed),
    artifactId: uuid(artifactIdSeed),
    slug: task.slug,
    name: task.name,
    instructions: task.instructions,
    active: task.active,
    triggers: task.triggers,
    executionTarget: task.executionTarget,
    createdAt: task.createdAt,
    lastAttemptAt: task.lastAttemptAt,
    lastRunId: task.lastRunId,
    lastRunAt: task.lastRunAt,
    lastRunSummary: task.lastRunSummary,
    scheduleSyncState: task.scheduleSyncState ?? "paused",
    scheduleSyncedAt: task.scheduleSyncedAt,
    artifact: task.artifact,
  };
}

function seedlessDesktopTask(slug: string): DesktopTask {
  const task = desktopTasks.find((item) => item.slug === slug);
  if (!task) throw new Error(`Missing desktop task ${slug}`);
  return task;
}

function apiRun({
  key,
  taskSlug,
  runId,
  trigger,
  startedAt,
  completedAt,
  summary,
  cloudEventKey,
}: ApiRunInput): ApiRun {
  return {
    id: uuid(key),
    taskSlug,
    runId,
    trigger,
    status: "succeeded",
    executor: "api",
    startedAt,
    completedAt,
    summary,
    progressPercent: 100,
    progressMessage: "Completed",
    cloudEventKey,
    events: [
      {
        id: uuid(`${key}:event:0`),
        seq: 0,
        eventType: "run_started",
        receivedAt: startedAt,
        event: { type: "run_started", runId, taskSlug, trigger },
      },
      {
        id: uuid(`${key}:event:1`),
        seq: 1,
        eventType: "artifact_updated",
        receivedAt: completedAt ?? startedAt,
        event: { type: "artifact_updated", runId, taskSlug, summary },
      },
      {
        id: uuid(`${key}:event:2`),
        seq: 2,
        eventType: "run_completed",
        receivedAt: completedAt ?? startedAt,
        event: { type: "run_completed", runId, taskSlug, status: "succeeded" },
      },
    ],
  };
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    workspaceDir: DEFAULT_WORKSPACE_DIR,
    apiDb: process.env.ROWBOAT_API_DATABASE_URL || process.env.DATABASE_URL || DEFAULT_API_DB,
    skipDesktop: false,
    skipApi: false,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--workspace-dir" && next) {
      out.workspaceDir = next;
      index += 1;
    } else if (arg.startsWith("--workspace-dir=")) {
      out.workspaceDir = arg.slice("--workspace-dir=".length);
    } else if ((arg === "--api-db" || arg === "--database-url") && next) {
      out.apiDb = next;
      index += 1;
    } else if (arg.startsWith("--api-db=")) {
      out.apiDb = arg.slice("--api-db=".length);
    } else if (arg.startsWith("--database-url=")) {
      out.apiDb = arg.slice("--database-url=".length);
    } else if (arg === "--skip-desktop") {
      out.skipDesktop = true;
    } else if (arg === "--skip-api") {
      out.skipApi = true;
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  out.workspaceDir = expandHome(out.workspaceDir);
  out.apiDb = expandHome(out.apiDb);
  return out;
}

function help(): string {
  return `Seed Oppulence demo data for the desktop workspace and rowboat-api DB.

Usage:
  npm run seed:demo -- [options]

Options:
  --workspace-dir <path>  Desktop workspace to populate. Default: ~/.rowboat
  --api-db <path|url>     SQLite file or Postgres URL. Default: apps/rowboat-api/rowboat-dev.db
  --skip-desktop          Do not write desktop workspace files.
  --skip-api              Do not write rowboat-api database rows.
  --dry-run               Validate and print what would be written.
`;
}

function expandHome(value: string): string {
  if (!value || value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function writeDesktopWorkspace(workspaceDir: string, data: Seed, dryRun: boolean) {
  const files: WorkspaceFile[] = [...data.workspace.files];

  for (const task of data.workspace.tasks) {
    files.push({
      path: `bg-tasks/${task.slug}/task.yaml`,
      body: taskYaml(task),
      mtime: task.lastRunAt ?? task.createdAt,
    });
    files.push({
      path: `bg-tasks/${task.slug}/index.md`,
      body: task.artifact,
      mtime: task.lastRunAt ?? task.createdAt,
    });
    files.push({
      path: `bg-tasks/${task.slug}/runs.log`,
      body: task.runs.length ? `${task.runs.join("\n")}\n` : "",
      mtime: task.lastRunAt ?? task.createdAt,
    });
  }

  for (const run of data.workspace.runs) {
    const firstEventTs = run.events[0]?.ts;
    files.push({
      path: `runs/${run.id}.jsonl`,
      body: `${run.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      mtime: typeof firstEventTs === "string" ? firstEventTs : data.generatedAt,
    });
  }

  for (const thread of data.workspace.gmailThreads) {
    files.push({
      path: `inbox_lists/${encodeURIComponent(thread.threadId)}.json`,
      body: `${JSON.stringify(
        {
          historyId: `history-${thread.threadId}`,
          fetchedAt: data.generatedAt,
          parserVersion: 3,
          snapshot: thread,
        },
        null,
        2,
      )}\n`,
      mtime: thread.date,
    });
  }

  if (dryRun) {
    return {
      workspaceDir,
      files: files.map((file) => file.path),
      taskCount: data.workspace.tasks.length,
      gmailThreadCount: data.workspace.gmailThreads.length,
      runCount: data.workspace.runs.length,
    };
  }

  for (const file of files) {
    const target = path.join(workspaceDir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.body, "utf8");
    if (file.mtime) {
      const stamp = new Date(file.mtime);
      fs.utimesSync(target, stamp, stamp);
    }
  }

  return {
    workspaceDir,
    files: files.map((file) => file.path),
    taskCount: data.workspace.tasks.length,
    gmailThreadCount: data.workspace.gmailThreads.length,
    runCount: data.workspace.runs.length,
  };
}

function taskYaml(task: DesktopTask): string {
  const lines = [
    `name: ${yamlString(task.name)}`,
    "instructions: |-",
    ...indent(task.instructions),
    `active: ${task.active ? "true" : "false"}`,
  ];
  if (task.triggers) {
    lines.push("triggers:");
    if (task.triggers.cronExpr) lines.push(`  cronExpr: ${yamlString(task.triggers.cronExpr)}`);
    if (task.triggers.windows?.length) {
      lines.push("  windows:");
      for (const window of task.triggers.windows) {
        lines.push(`    - startTime: ${yamlString(window.startTime)}`);
        lines.push(`      endTime: ${yamlString(window.endTime)}`);
      }
    }
    if (task.triggers.eventMatchCriteria) {
      lines.push("  eventMatchCriteria: |-");
      lines.push(...indent(task.triggers.eventMatchCriteria, 4));
    }
  }
  lines.push(`executionTarget: ${task.executionTarget}`);
  lines.push(`createdAt: ${yamlString(task.createdAt)}`);
  if (task.lastAttemptAt) lines.push(`lastAttemptAt: ${yamlString(task.lastAttemptAt)}`);
  if (task.lastRunId) lines.push(`lastRunId: ${yamlString(task.lastRunId)}`);
  if (task.lastRunAt) lines.push(`lastRunAt: ${yamlString(task.lastRunAt)}`);
  if (task.lastRunSummary) lines.push(`lastRunSummary: ${yamlString(task.lastRunSummary)}`);
  if (task.scheduleSyncState) lines.push(`scheduleSyncState: ${task.scheduleSyncState}`);
  if (task.scheduleSyncedAt) lines.push(`scheduleSyncedAt: ${yamlString(task.scheduleSyncedAt)}`);
  return `${lines.join("\n")}\n`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function indent(value: string, spaces = 2): string[] {
  const prefix = " ".repeat(spaces);
  return value.split("\n").map((line) => `${prefix}${line}`);
}

function seedApiDb(apiDb: string, data: Seed, dryRun: boolean) {
  const dialect =
    apiDb.startsWith("postgres://") || apiDb.startsWith("postgresql://") ? "postgres" : "sqlite";
  const sql = buildApiSql(data.api, dialect);

  if (dryRun) {
    return {
      dialect,
      apiDb,
      user: data.api.user.workosUserId,
      tasks: data.api.tasks.map((task) => task.slug),
      runs: data.api.runs.map((run) => run.runId),
      statementsBytes: sql.length,
    };
  }

  if (dialect === "sqlite") {
    fs.mkdirSync(path.dirname(apiDb), { recursive: true });
    ensureSqliteSchema(apiDb);
    runSqlite(apiDb, sql);
  } else {
    runPostgres(apiDb, sql);
  }

  return {
    dialect,
    apiDb,
    user: data.api.user.workosUserId,
    tasks: data.api.tasks.map((task) => task.slug),
    runs: data.api.runs.map((run) => run.runId),
  };
}

function ensureSqliteSchema(dbPath: string): void {
  const probe = spawnSync(
    "sqlite3",
    [dbPath, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='users';"],
    {
      encoding: "utf8",
    },
  );
  if (probe.error) throw probe.error;
  if (probe.status !== 0) {
    throw new Error(`sqlite schema probe failed: ${probe.stderr.trim()}`);
  }
  if (probe.stdout.trim() === "1") return;
  const migration = fs.readFileSync(API_MIGRATION, "utf8");
  runSqlite(dbPath, `PRAGMA foreign_keys=ON;\n${migration}`);
}

function runSqlite(dbPath: string, sql: string): void {
  const result = spawnSync("sqlite3", [dbPath], {
    input: `PRAGMA foreign_keys=ON;\n${sql}`,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`sqlite seed failed:\n${result.stderr}`);
  }
}

function runPostgres(databaseUrl: string, sql: string): void {
  const result = spawnSync("psql", [databaseUrl, "--set", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const spawnError = result.error as NodeJS.ErrnoException | undefined;
  if (spawnError?.code === "ENOENT") {
    throw new Error("psql is required to seed a Postgres rowboat-api database.");
  }
  if (spawnError) throw spawnError;
  if (result.status !== 0) {
    throw new Error(`postgres seed failed:\n${result.stderr}`);
  }
}

function buildApiSql(api: ApiSeed, dialect: SqlDialect): string {
  const q = (value: unknown): string => sqlString(value);
  const json = (value: unknown): string => q(JSON.stringify(value));
  const bool = (value: boolean): string =>
    dialect === "postgres" ? (value ? "TRUE" : "FALSE") : value ? "1" : "0";
  const bytes = (value: string): string => {
    const hex = Buffer.from(value, "utf8").toString("hex");
    return dialect === "postgres" ? `decode('${hex}', 'hex')` : `X'${hex}'`;
  };
  const nullable = <T>(
    value: T | null | undefined,
    mapper: (mappedValue: T) => string = q,
  ): string => (value === undefined || value === null ? "NULL" : mapper(value));
  const userRef = `(SELECT id FROM users WHERE workos_user_id = ${q(api.user.workosUserId)})`;
  const taskRef = (slug: string): string =>
    `(SELECT id FROM background_tasks WHERE slug = ${q(slug)} AND user_background_tasks = ${userRef})`;
  const cloudEventIdByKey = new Map(api.cloudEvents.map((event) => [event.key, event.id]));
  const taskIdBySlug = new Map(api.tasks.map((task) => [task.slug, task.id]));
  const lines = ["BEGIN;"];

  lines.push(`
INSERT INTO users (id, created_at, updated_at, email, workos_user_id, workos_org_id)
VALUES (${q(api.user.id)}, ${q(t.now)}, ${q(t.now)}, ${q(api.user.email)}, ${q(api.user.workosUserId)}, ${nullable(api.user.workosOrgId)})
ON CONFLICT(workos_user_id) DO UPDATE SET
  email = excluded.email,
  workos_org_id = excluded.workos_org_id,
  updated_at = excluded.updated_at;
`);

  lines.push(`
DELETE FROM background_task_run_events WHERE user_background_task_run_events = ${userRef};
DELETE FROM background_task_runs WHERE user_background_task_runs = ${userRef};
DELETE FROM background_task_artifacts WHERE user_background_task_artifacts = ${userRef};
DELETE FROM background_task_schedule_states WHERE user_background_task_schedule_states = ${userRef};
DELETE FROM background_tasks WHERE user_background_tasks = ${userRef};
DELETE FROM cloud_events WHERE user_cloud_events = ${userRef};
DELETE FROM oauth_connections WHERE user_oauth_connections = ${userRef};
DELETE FROM mcp_connections WHERE user_mcp_connections = ${userRef};
DELETE FROM composio_accounts WHERE user_composio_accounts = ${userRef};
DELETE FROM llm_usages WHERE user_llm_usages = ${userRef};
DELETE FROM meeting_minute_usages WHERE user_meeting_minute_usages = ${userRef};
DELETE FROM credit_ledgers WHERE user_ledger_entries = ${userRef};
DELETE FROM subscriptions WHERE user_subscription = ${userRef};
`);

  lines.push(`
INSERT INTO subscriptions (id, created_at, updated_at, plan, status, sanctioned_credits, user_subscription)
VALUES (${q(api.subscription.id)}, ${q(t.week)}, ${q(t.now)}, ${q(api.subscription.plan)}, ${q(api.subscription.status)}, ${api.subscription.sanctionedCredits}, ${userRef});
`);

  for (const entry of api.creditLedger) {
    lines.push(`
INSERT INTO credit_ledgers (id, delta, reason, request_id, ts, user_ledger_entries)
VALUES (${q(entry.id)}, ${entry.delta}, ${q(entry.reason)}, ${q(entry.requestId)}, ${q(entry.ts)}, ${userRef});
`);
  }

  for (const connection of api.oauthConnections) {
    lines.push(`
INSERT INTO oauth_connections (id, created_at, updated_at, provider, refresh_token_encrypted, scopes, external_account_id, user_oauth_connections)
VALUES (${q(connection.id)}, ${q(t.week)}, ${q(t.now)}, ${q(connection.provider)}, ${bytes(`demo-refresh-token:${connection.provider}`)}, ${json(connection.scopes)}, ${q(connection.externalAccountId)}, ${userRef});
`);
  }

  for (const connection of api.mcpConnections) {
    lines.push(`
INSERT INTO mcp_connections (id, created_at, updated_at, connector, audience, scopes, api_key_encrypted, connected_at, last_used_at, user_mcp_connections)
VALUES (${q(connection.id)}, ${q(connection.connectedAt)}, ${q(connection.lastUsedAt)}, ${q(connection.connector)}, ${q(connection.audience)}, ${json(connection.scopes)}, ${bytes(`demo-api-key:${connection.connector}`)}, ${q(connection.connectedAt)}, ${q(connection.lastUsedAt)}, ${userRef});
`);
  }

  for (const account of api.composioAccounts) {
    lines.push(`
INSERT INTO composio_accounts (id, created_at, updated_at, account_id, toolkit, user_composio_accounts)
VALUES (${q(account.id)}, ${q(t.week)}, ${q(t.now)}, ${q(account.accountId)}, ${q(account.toolkit)}, ${userRef});
`);
  }

  lines.push(`
INSERT INTO meeting_minute_usages (id, created_at, updated_at, period, used_seconds, reserved_seconds, user_meeting_minute_usages)
VALUES (${q(api.meetingMinutes.id)}, ${q(t.week)}, ${q(t.now)}, ${q(api.meetingMinutes.period)}, ${api.meetingMinutes.usedSeconds}, ${api.meetingMinutes.reservedSeconds}, ${userRef});
`);

  for (const usage of api.llmUsage) {
    lines.push(`
INSERT INTO llm_usages (id, model, use_case, sub_use_case, agent_name, input_tokens, output_tokens, cost_units, request_id, ts, user_llm_usages)
VALUES (${q(usage.id)}, ${q(usage.model)}, ${q(usage.useCase)}, ${q(usage.subUseCase)}, ${q(usage.agentName)}, ${usage.inputTokens}, ${usage.outputTokens}, ${usage.costUnits}, ${q(usage.requestId)}, ${q(usage.ts)}, ${userRef});
`);
  }

  for (const task of api.tasks) {
    lines.push(`
INSERT INTO background_tasks (
  id, created_at, updated_at, slug, name, instructions, active, triggers_json,
  execution_target, task_created_at, last_attempt_at, last_run_id, last_run_at,
  last_run_summary, schedule_sync_state, schedule_synced_at, revision, user_background_tasks
) VALUES (
  ${q(task.id)}, ${q(task.createdAt)}, ${q(t.now)}, ${q(task.slug)}, ${q(task.name)}, ${q(task.instructions)},
  ${bool(task.active)}, ${nullable(task.triggers, json)}, ${q(task.executionTarget)}, ${q(task.createdAt)},
  ${nullable(task.lastAttemptAt)}, ${nullable(task.lastRunId)}, ${nullable(task.lastRunAt)},
  ${nullable(task.lastRunSummary)}, ${q(task.scheduleSyncState)}, ${nullable(task.scheduleSyncedAt)}, 1, ${userRef}
);
`);
    lines.push(`
INSERT INTO background_task_artifacts (
  id, created_at, updated_at, body, revision, updated_by_run_id, content_type, background_task_id, user_background_task_artifacts
) VALUES (
  ${q(task.artifactId)}, ${q(task.createdAt)}, ${q(t.now)}, ${q(task.artifact)}, 1, ${nullable(task.lastRunId)}, 'text/markdown', ${taskRef(task.slug)}, ${userRef}
);
`);
  }

  for (const event of api.cloudEvents) {
    lines.push(`
INSERT INTO cloud_events (
  id, created_at, updated_at, source, source_event_id, source_account_id, event_type,
  subject, text, routing_json, dedupe_key, routing_status, matched_task_count,
  occurred_at, received_at, routed_at, user_cloud_events
) VALUES (
  ${q(event.id)}, ${q(event.occurredAt)}, ${q(t.now)}, ${q(event.source)}, ${nullable(event.sourceEventId)},
  ${nullable(event.sourceAccountId)}, ${nullable(event.eventType)}, ${nullable(event.subject)}, ${nullable(event.text)},
  ${nullable(event.routing, json)}, ${q(event.dedupeKey)}, ${q(event.routingStatus)}, ${event.matchedTaskCount},
  ${q(event.occurredAt)}, ${q(event.occurredAt)}, ${event.routingStatus === "routed" ? q(event.occurredAt) : "NULL"}, ${userRef}
);
`);
  }

  for (const run of api.runs) {
    const cloudEventId = run.cloudEventKey ? cloudEventIdByKey.get(run.cloudEventKey) : undefined;
    lines.push(`
INSERT INTO background_task_runs (
  id, created_at, updated_at, run_id, trigger, status, executor, attempt, model, provider,
  use_case, sub_use_case, requested_context, summary, temporal_workflow_id,
  progress_percent, progress_message, last_heartbeat_at, started_at, completed_at,
  revision, background_task_id, cloud_event_id, user_background_task_runs
) VALUES (
  ${q(run.id)}, ${q(run.startedAt)}, ${q(run.completedAt ?? run.startedAt)}, ${q(run.runId)}, ${q(run.trigger)}, ${q(run.status)}, ${q(run.executor)}, 1,
  'openai/gpt-5-mini', 'openai', 'background_task_agent', ${q(run.taskSlug)}, 'demo seed',
  ${nullable(run.summary)}, ${q(`background-task/user/${run.taskSlug}/${run.runId}`)},
  ${nullable(run.progressPercent, (value) => String(value))}, ${nullable(run.progressMessage)}, ${q(run.completedAt ?? run.startedAt)},
  ${q(run.startedAt)}, ${nullable(run.completedAt)}, 1, ${taskRef(run.taskSlug)}, ${nullable(cloudEventId)}, ${userRef}
);
`);
    for (const event of run.events) {
      lines.push(`
INSERT INTO background_task_run_events (
  id, created_at, updated_at, seq, event_type, event_json, received_at,
  background_task_id, background_task_run_id, user_background_task_run_events
) VALUES (
  ${q(event.id)}, ${q(event.receivedAt)}, ${q(event.receivedAt)}, ${event.seq}, ${q(event.eventType)}, ${json(event.event)}, ${q(event.receivedAt)},
  ${q(taskIdBySlug.get(run.taskSlug))}, ${q(run.id)}, ${userRef}
);
`);
    }
  }

  lines.push("COMMIT;");
  return lines.join("\n");
}

function sqlString(value: unknown): string {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function printDesktopSummary(label: string, workspaceDir: string, data: Seed): void {
  console.log(`${label}:`);
  console.log(`  workspaceDir: ${workspaceDir}`);
  console.log(
    `  files: ${
      data.workspace.files.length +
      data.workspace.tasks.length * 3 +
      data.workspace.runs.length +
      data.workspace.gmailThreads.length
    }`,
  );
  console.log(`  tasks: ${data.workspace.tasks.length}`);
  console.log(`  gmailThreads: ${data.workspace.gmailThreads.length}`);
  console.log(`  runs: ${data.workspace.runs.length}`);
}

function printApiSummary(label: string, apiDb: string, data: Seed): void {
  const dialect =
    apiDb.startsWith("postgres://") || apiDb.startsWith("postgresql://") ? "postgres" : "sqlite";
  console.log(`${label}:`);
  console.log(`  dialect: ${dialect}`);
  console.log(`  tasks: ${data.api.tasks.length}`);
  console.log(`  runs: ${data.api.runs.length}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(help());
    return;
  }

  console.log(
    `Validated seed: ${seed.workspace.files.length} notes/files, ${seed.workspace.tasks.length} tasks, ${seed.workspace.gmailThreads.length} Gmail threads.`,
  );

  if (!args.skipDesktop) {
    writeDesktopWorkspace(args.workspaceDir, seed, args.dryRun);
    printDesktopSummary("desktop workspace", args.workspaceDir, seed);
  }
  if (!args.skipApi) {
    seedApiDb(args.apiDb, seed, args.dryRun);
    printApiSummary("rowboat api db", args.apiDb, seed);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
