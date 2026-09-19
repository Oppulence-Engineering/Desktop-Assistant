import { Table as TableIcon } from "@sim/emcn/icons";
import { CONNECTION_KNOB_PEAK_PX } from "@sim/workflow-renderer";
import {
  AgentIcon,
  ApiIcon,
  CodeIcon,
  ConditionalIcon,
  GmailIcon,
  StartIcon,
} from "@/components/sim/icons";
import { BLOCK_WIDTH, type BlockDef, blockHeight } from "./workflow-data";

/**
 * Design-space geometry for the hero's live workflow stage — the commitment
 * register flow the chat conversation builds: Start feeds Gmail and HubSpot
 * reads, candidate rows are confirmed, and a condition routes strong sentences
 * into the register while the alternate path holds external sends.
 * The graph follows production's left-input/right-output topology and extends
 * beyond the initial viewport so the homepage canvas has useful space to pan.
 *
 * Blocks are ordered by build sequence - the stage reveals `blocks[0..built-1]`
 * as the loop's build counter advances, and an edge draws once both its
 * endpoints are on canvas.
 */
export const STAGE_BLOCKS: BlockDef[] = [
  {
    id: "start",
    name: "Start",
    type: "start_trigger",
    typeLabel: "Start",
    icon: StartIcon,
    bgColor: "var(--text-muted)",
    isTrigger: true,
    rows: [],
    x: 40,
    y: 310,
  },
  {
    id: "enrich",
    name: "Read Gmail",
    type: "gmail",
    typeLabel: "Gmail",
    isIntegration: true,
    icon: GmailIcon,
    bgColor: "#EA4335",
    sentence: {
      segments: ["Read", { subBlockId: "mailbox", noun: "mailbox" }],
      values: { mailbox: "Acme thread" },
    },
    rows: [],
    x: 390,
    y: 278,
  },
  {
    id: "score",
    name: "Read HubSpot",
    type: "hubspot",
    typeLabel: "HubSpot",
    isIntegration: true,
    icon: AgentIcon,
    bgColor: "#FF7A59",
    sentence: {
      segments: ["Pull", { subBlockId: "object", noun: "deal fields" }],
      values: { object: "closed deal" },
    },
    rows: [],
    x: 740,
    y: 278,
  },
  {
    id: "route",
    name: "Strong sentence?",
    type: "condition",
    typeLabel: "Condition",
    icon: ConditionalIcon,
    bgColor: "#FF752F",
    rows: [
      { title: "If", value: "source-linked" },
      { title: "Else", value: "needs review" },
    ],
    x: 1090,
    y: 266,
  },
  {
    id: "slack",
    name: "Confirm rows",
    type: "register",
    typeLabel: "Register",
    icon: CodeIcon,
    bgColor: "var(--text-primary)",
    sentence: {
      segments: ["Draft", { subBlockId: "rows", noun: "register rows" }],
      values: { rows: "candidate sentences" },
    },
    rows: [],
    x: 1440,
    y: 170,
  },
  {
    id: "tables",
    name: "Hold external sends",
    type: "approval",
    typeLabel: "Approval",
    icon: TableIcon,
    bgColor: "#10B981",
    isTerminal: true,
    sentence: {
      segments: ["Wait for", { subBlockId: "approval", noun: "approval" }],
      values: { approval: "your confirmation" },
    },
    rows: [],
    x: 1790,
    y: 170,
  },
  {
    id: "verify",
    name: "Queue for review",
    type: "api",
    typeLabel: "Queue",
    icon: ApiIcon,
    bgColor: "#2F55FF",
    isTerminal: true,
    sentence: {
      segments: ["Send", { subBlockId: "queue", noun: "weak rows" }, "to the attention queue"],
      values: { queue: "uncertain sentences" },
    },
    rows: [],
    x: 1440,
    y: 430,
  },
];

/** Source → target pairs, drawn in order as their endpoints land on canvas. */
export const STAGE_EDGES: ReadonlyArray<readonly [string, string]> = [
  ["start", "enrich"],
  ["enrich", "score"],
  ["score", "route"],
  ["route", "slack"],
  ["slack", "tables"],
  ["route", "verify"],
];

/** Initial camera viewport. The workflow continues to the right. */
export const STAGE_CANVAS = { width: 860, height: 720 } as const;

/**
 * Rounded orthogonal ("smoothstep") path for a VERTICAL flow - from a source's
 * bottom-center handle to a target's top-center handle, stepping at the
 * vertical midpoint with `r`-radius corners. The horizontal-flow counterpart
 * lives in `hero-visual/workflow-data.ts`.
 */
export function verticalSmoothStep(sx: number, sy: number, tx: number, ty: number, r = 8): string {
  if (Math.abs(tx - sx) < 1) return `M ${sx} ${sy} L ${tx} ${ty}`;
  const midY = (sy + ty) / 2;
  const dir = tx >= sx ? 1 : -1;
  return [
    `M ${sx} ${sy}`,
    `L ${sx} ${midY - r}`,
    `Q ${sx} ${midY} ${sx + dir * r} ${midY}`,
    `L ${tx - dir * r} ${midY}`,
    `Q ${tx} ${midY} ${tx} ${midY + r}`,
    `L ${tx} ${ty}`,
  ].join(" ");
}

/** Handle anchor points for a block at its fixed position. */
export function handleAnchors(block: BlockDef) {
  return {
    out: {
      x: block.x + BLOCK_WIDTH / 2,
      y: block.y + blockHeight(block) + CONNECTION_KNOB_PEAK_PX,
    },
    in: { x: block.x + BLOCK_WIDTH / 2, y: block.y - CONNECTION_KNOB_PEAK_PX },
  };
}
