import { Table as TableIcon } from "@sim/emcn/icons";
import {
  AgentIcon,
  ConditionalIcon,
  GmailIcon,
  HumanInTheLoopIcon,
  SlackIcon,
  StartIcon,
} from "@/components/sim/icons";
import type { BlockDef } from "./workflow-data";

/** Column pitch: production's 250px card plus a 100px run of edge. */
const COLUMN = 350;
const col = (index: number) => 40 + index * COLUMN;
/** Row pitch: room for the tallest card plus a clear gap. */
const ROW = 200;
const row = (index: number) => index * ROW;

/**
 * Commitment-register workflow the composer builds after the Acme prompt — same
 * geometry as Sim's public demo graph (triggers, condition split, approval gate,
 * register table) with Oppulence integrations only.
 */
export const DEMO_BLOCKS: BlockDef[] = [
  {
    id: "start",
    name: "Start",
    type: "start_trigger",
    icon: StartIcon,
    bgColor: "#34B5FF",
    isTrigger: true,
    rows: [],
    x: col(0),
    y: row(2) + 44,
  },
  {
    id: "ticket",
    name: "Acme deal closed",
    type: "hubspot",
    typeLabel: "HubSpot",
    isIntegration: true,
    icon: AgentIcon,
    bgColor: "#FF7A59",
    isTrigger: true,
    sentence: {
      segments: ["Run on", { subBlockId: "selectedTriggerId", noun: "closed-won" }],
      values: { selectedTriggerId: "Deal closed" },
    },
    rows: [],
    x: col(0),
    y: row(1),
  },
  {
    id: "runbook",
    name: "Read Gmail",
    type: "gmail",
    typeLabel: "Gmail",
    isIntegration: true,
    icon: GmailIcon,
    bgColor: "#EA4335",
    sentence: {
      segments: ["Read", { subBlockId: "thread", noun: "Acme thread" }],
      values: { thread: "kickoff mail" },
    },
    rows: [],
    x: col(1),
    y: row(2),
  },
  {
    id: "classify",
    name: "Read HubSpot",
    type: "hubspot",
    typeLabel: "HubSpot",
    isIntegration: true,
    icon: AgentIcon,
    bgColor: "#FF7A59",
    sentence: {
      segments: ["Pull", { subBlockId: "fields", noun: "deal fields" }],
      values: { fields: "closed-won record" },
    },
    rows: [],
    x: col(2),
    y: row(2),
  },
  {
    id: "severity",
    name: "Strong sentence?",
    type: "condition",
    typeLabel: "Condition",
    icon: ConditionalIcon,
    bgColor: "#FF752F",
    rows: [
      { title: "If", value: "source-linked" },
      { title: "Else", value: "needs review" },
    ],
    x: col(3),
    y: row(2),
  },
  {
    id: "draft",
    name: "Draft register rows",
    type: "agent",
    typeLabel: "Agent",
    icon: AgentIcon,
    bgColor: "var(--text-primary)",
    sentence: {
      segments: ["Draft", { subBlockId: "rows", noun: "candidate rows" }],
      values: { rows: "commitment sentences" },
    },
    rows: [],
    x: col(4),
    y: row(3),
  },
  {
    id: "approve",
    name: "Hold external sends",
    type: "human_in_the_loop",
    typeLabel: "Approval",
    icon: HumanInTheLoopIcon,
    bgColor: "#10B981",
    sentence: {
      segments: ["Pause until you confirm the register rows"],
      values: {},
    },
    rows: [],
    x: col(5),
    y: row(4),
  },
  {
    id: "reply",
    name: "Confirm rows",
    type: "register",
    typeLabel: "Register",
    icon: AgentIcon,
    bgColor: "var(--text-primary)",
    sentence: {
      segments: ["Mark", { subBlockId: "rows", noun: "approved rows" }, "confirmed"],
      values: { rows: "register entries" },
    },
    rows: [],
    x: col(6),
    y: row(4),
  },
  {
    id: "log",
    name: "Save to register",
    type: "table",
    typeLabel: "Register",
    icon: TableIcon,
    bgColor: "#10B981",
    isTerminal: true,
    sentence: {
      segments: ["Insert rows into", { subBlockId: "tableId", noun: "the register" }],
      values: { tableId: "Commitment register" },
    },
    rows: [],
    x: col(7),
    y: row(4),
  },
  {
    id: "page",
    name: "Queue for review",
    type: "function",
    typeLabel: "Queue",
    icon: AgentIcon,
    bgColor: "#2F55FF",
    sentence: {
      segments: ["Send", { subBlockId: "items", noun: "weak rows" }, "to attention queue"],
      values: { items: "uncertain sentences" },
    },
    rows: [],
    x: col(4),
    y: row(1),
  },
  {
    id: "incident",
    name: "Notify delivery lead",
    type: "slack",
    typeLabel: "Slack",
    isIntegration: true,
    icon: SlackIcon,
    bgColor: "#611F69",
    sentence: {
      segments: [
        "Post",
        { subBlockId: "message", noun: "summary" },
        "to",
        { subBlockId: "channel", noun: "channel" },
      ],
      values: { message: "review needed", channel: "#delivery" },
    },
    rows: [],
    x: col(5),
    y: row(0),
  },
  {
    id: "alert",
    name: "Watch stale promises",
    type: "agent",
    typeLabel: "Watch",
    icon: AgentIcon,
    bgColor: "var(--text-primary)",
    isTerminal: true,
    sentence: {
      segments: ["Watch", { subBlockId: "window", noun: "14-day window" }],
      values: { window: "after kickoff" },
    },
    rows: [],
    x: col(6),
    y: row(0),
  },
];

export const DEMO_EDGES: ReadonlyArray<readonly [string, string]> = [
  ["start", "runbook"],
  ["ticket", "runbook"],
  ["runbook", "classify"],
  ["classify", "severity"],
  ["severity", "page"],
  ["severity", "draft"],
  ["draft", "approve"],
  ["approve", "reply"],
  ["reply", "log"],
  ["page", "incident"],
  ["incident", "alert"],
];

export const DEMO_CANVAS = { width: col(7) + 250 + 40, height: row(4) + 140 + 40 } as const;
