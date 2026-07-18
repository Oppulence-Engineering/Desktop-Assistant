/**
 * Model-backed AI implementations.
 *
 * Concrete implementations of the AI seams the engine and reply tracker depend
 * on ({@link MailAiMatcher}, {@link ReplyClassifier}, {@link MailDraftGenerator}).
 * Every call routes email content through the prompt-injection guard and the
 * prompt-safe thread view, resolves the model through the repo's default model
 * resolution, and records usage. On any model failure they fall back to a safe,
 * conservative default rather than throwing into a sync loop.
 */

import { z } from "zod";
import { generateObject } from "ai";

import { createProvider } from "../models/models.js";
import {
  getDefaultModelAndProvider,
  getKgModel,
  resolveProviderConfig,
} from "../models/defaults.js";
import { captureLlmUsage } from "../analytics/usage.js";
import { withUseCase } from "../analytics/use_case.js";

import type { MailAiMatcher, MailAiMatchResult } from "./rules/conditions.js";
import type { MailDraftGenerator, GeneratedDraft } from "./reply/drafts.js";
import type { ReplyClassifier } from "./reply/tracker.js";
import type { ReplyClassification } from "./reply/types.js";
import { buildMailPromptContext } from "./privacy/prompt-injection.js";
import { findRelevantReplyMemories } from "./reply/memory.js";
import type { MailboxStore } from "./store.js";
import type { MailboxMessage, MailboxParticipant, MailboxThread } from "./types.js";

/** Resolve the shared knowledge model and run a guarded structured-output call. */
async function generateMailObject<T>(input: {
  subUseCase: string;
  systemTask: string;
  thread: MailboxThread;
  schema: z.ZodType<T>;
  extraInstruction?: string;
  knowledge?: { source: string; text: string }[];
}): Promise<T> {
  const modelId = await getKgModel();
  const { provider } = await getDefaultModelAndProvider();
  const config = await resolveProviderConfig(provider);
  const model = createProvider(config).languageModel(modelId);

  const messages = buildMailPromptContext({
    systemTask: input.extraInstruction
      ? `${input.systemTask}\n${input.extraInstruction}`
      : input.systemTask,
    thread: input.thread,
    retrievedKnowledge: input.knowledge,
  });

  const result = await withUseCase(
    { useCase: "knowledge_sync", subUseCase: input.subUseCase },
    () =>
      generateObject({
        model,
        schema: input.schema,
        messages,
      }),
  );

  captureLlmUsage({
    useCase: "knowledge_sync",
    subUseCase: input.subUseCase,
    model: modelId,
    provider,
    usage: result.usage,
  });

  return result.object;
}

// --- AI rule condition matcher --------------------------------------------

const AiMatchSchema = z.object({
  matched: z.boolean().describe("Whether the email satisfies the instruction"),
  confidence: z.number().min(0).max(1).describe("Confidence between 0 and 1"),
  reason: z.string().optional().describe("Short justification citing the email"),
});

export class LlmAiMatcher implements MailAiMatcher {
  async match(input: {
    instructions: string;
    minConfidence: number;
    thread: MailboxThread;
    message: MailboxMessage;
  }): Promise<MailAiMatchResult> {
    try {
      const object = await generateMailObject({
        subUseCase: "mail_rule_ai_condition",
        systemTask:
          "You decide whether the latest message in an email thread satisfies a user's rule instruction. " +
          `Instruction: ${input.instructions}`,
        thread: input.thread,
        schema: AiMatchSchema,
      });
      return { matched: object.matched, confidence: object.confidence, reason: object.reason };
    } catch {
      // Fail closed: an unmatchable condition never triggers automation.
      return { matched: false, confidence: 0, reason: "AI matcher unavailable" };
    }
  }
}

// --- Reply classifier ------------------------------------------------------

const ReplyClassificationSchema = z.object({
  status: z
    .enum(["needs_reply", "awaiting_reply", "needs_action", "done"])
    .describe("Whether the account owner owes a reply, an action, or nothing"),
  reason: z.string().optional().describe("Short reason for the status"),
  confidence: z.number().min(0).max(1).optional(),
});

const OutboundExpectsReplySchema = z.object({
  expectsReply: z.boolean().describe("Whether this sent message expects a response back"),
  reason: z.string().optional(),
});

export class LlmReplyClassifier implements ReplyClassifier {
  async classifyInbound(input: {
    thread: MailboxThread;
    message: MailboxMessage;
  }): Promise<ReplyClassification> {
    try {
      const object = await generateMailObject({
        subUseCase: "mail_reply_classify_inbound",
        systemTask:
          "Classify the latest inbound message. Use 'needs_reply' when it asks a question or requests a response, " +
          "'needs_action' when the owner owes a non-email action, and 'done' when no response is required.",
        thread: input.thread,
        schema: ReplyClassificationSchema,
      });
      return { status: object.status, reason: object.reason, confidence: object.confidence };
    } catch {
      // Fail safe: unknown classification does not create a needs-reply nag.
      return { status: "done", reason: "Reply classifier unavailable" };
    }
  }

  async outboundExpectsReply(input: {
    thread: MailboxThread;
    message: MailboxMessage;
  }): Promise<boolean> {
    try {
      const object = await generateMailObject({
        subUseCase: "mail_reply_classify_outbound",
        systemTask:
          "Decide whether the account owner's latest sent message expects a reply back from the recipient.",
        thread: input.thread,
        schema: OutboundExpectsReplySchema,
      });
      return object.expectsReply;
    } catch {
      return false;
    }
  }
}

// --- Draft generator -------------------------------------------------------

const DraftSchema = z.object({
  bodyText: z
    .string()
    .describe("The reply body as plain text with real line breaks. No quoted history."),
  confidence: z.number().min(0).max(1).describe("Confidence this is a good draft"),
  reasoningSummary: z.string().optional().describe("One line on the approach taken"),
});

export type LlmDraftGeneratorDeps = {
  store?: MailboxStore;
  /** User writing-style guide text, if available. */
  styleGuide?: string;
};

export class LlmDraftGenerator implements MailDraftGenerator {
  constructor(private readonly deps: LlmDraftGeneratorDeps = {}) {}

  async generate(input: {
    accountId: string;
    thread: MailboxThread;
    source: string;
    instruction?: string;
  }): Promise<GeneratedDraft> {
    const recipients = deriveReplyRecipients(input.thread);
    const knowledge = await this.collectKnowledge(input.accountId, input.thread);

    let bodyText = "";
    let confidence = 0.3;
    let reasoningSummary: string | undefined;

    try {
      const object = await generateMailObject({
        subUseCase: "mail_draft_reply",
        systemTask: [
          "Draft a reply to the latest message in this thread on behalf of the account owner.",
          "Match the owner's writing style. Be concise. Do not include quoted history or a subject line.",
          input.instruction ? `The owner asked for: ${input.instruction}` : "",
          this.deps.styleGuide ? `Writing style guide:\n${this.deps.styleGuide}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        thread: input.thread,
        schema: DraftSchema,
        knowledge,
      });
      bodyText = object.bodyText;
      confidence = object.confidence;
      reasoningSummary = object.reasoningSummary;
    } catch {
      bodyText = "";
      confidence = 0;
      reasoningSummary = "Draft generator unavailable";
    }

    return {
      subject: replySubject(input.thread.subject),
      bodyText,
      to: recipients.to,
      cc: recipients.cc,
      bcc: [],
      confidence,
      reasoningSummary,
    };
  }

  private async collectKnowledge(
    accountId: string,
    thread: MailboxThread,
  ): Promise<{ source: string; text: string }[]> {
    if (!this.deps.store) return [];
    const latest = thread.messages.at(-1);
    if (!latest) return [];
    const memories = await this.deps.store.listReplyMemories(accountId);
    const relevant = findRelevantReplyMemories(memories, latest.from.email);
    return relevant.map((memory) => ({
      source: `reply-memory:${memory.pattern}`,
      text: memory.instruction,
    }));
  }
}

/**
 * Reply recipients are the latest inbound sender plus other non-owner
 * participants. This is the recipient-correctness property the evals guard: the
 * reply must never be addressed back to the account owner.
 */
export function deriveReplyRecipients(thread: MailboxThread): {
  to: MailboxParticipant[];
  cc: MailboxParticipant[];
} {
  const lastInbound = [...thread.messages].reverse().find((m) => !m.isOutbound);
  if (!lastInbound) {
    return { to: [], cc: [] };
  }

  const to = [lastInbound.from];
  const ownerEmails = new Set(
    thread.messages.filter((m) => m.isOutbound).map((m) => m.from.email.toLowerCase()),
  );

  const cc = lastInbound.cc.filter(
    (p) =>
      !ownerEmails.has(p.email.toLowerCase()) &&
      p.email.toLowerCase() !== lastInbound.from.email.toLowerCase(),
  );

  return { to, cc };
}

function replySubject(subject: string): string {
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}
