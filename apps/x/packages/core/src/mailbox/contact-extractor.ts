import { z } from "zod";
import { generateObject } from "ai";
import {
  getDefaultModelAndProvider,
  getMeetingNotesModel,
  resolveProviderConfig,
} from "../models/defaults.js";
import { createProvider } from "../models/models.js";
import { withUseCase } from "../analytics/use_case.js";
import { providerDataLocation } from "../voice/routing.js";
import { getTranscriptionConfig } from "../voice/voice.js";
import { MAIL_UNTRUSTED_CONTENT_GUARD } from "./privacy/prompt-injection.js";
import { parseEmailSignature } from "./signature.js";
import type { MailboxParticipant } from "./types.js";

/**
 * Model-assisted contact extraction — the fallback for when signature parsing finds
 * nothing.
 *
 * Structurally a copy of HybridConversationExtractor (semantic attempt, deterministic
 * fallback, local-only route check) because those properties are the reason that one
 * is safe. Three deliberate differences:
 *
 *   1. **A narrower redactor.** The conversation redactor replaces *every email
 *      address* with a placeholder, which destroys the exact key a contact extractor
 *      needs to attach a title to a person. This one redacts credentials, card
 *      numbers and health terms and keeps addresses. Do not "fix" it back.
 *   2. **A hard confidence ceiling of 0.5**, and only consulted when the
 *      deterministic parse returned nothing. An LLM guess about a job title must
 *      never outrank a literal line under `-- `; inverting that is how a
 *      hallucinated VP title overwrites a correct IC one.
 *   3. **The untrusted-content guard is non-negotiable** — this reads
 *      attacker-supplied email bodies.
 */

/** An inference is never more than a suggestion. */
export const MAX_MODEL_CONTACT_CONFIDENCE = 0.5;

const CONTACT_MODEL_TIMEOUT_MS = 20_000;
const MAX_BODY_CHARS = 8_000;

export const CONTACT_EXTRACTOR_VERSION = "contact-semantic-v1";
export const CONTACT_PROMPT_VERSION = "contact-title-org-v1";

const ContactModelOutputSchema = z.object({
  contacts: z
    .array(
      z.object({
        email: z.string(),
        title: z.string().optional(),
        organization: z.string().optional(),
        seniority: z.enum(["ic", "manager", "executive"]).optional(),
        confidence: z.number().min(0).max(1).default(0.3),
      }),
    )
    .default([]),
});

export interface ContactExtractionRequest {
  messages: Array<{ from: MailboxParticipant; sentAt: string; body: string }>;
  knownParticipants: MailboxParticipant[];
  extractorVersion: string;
}

export interface ExtractedContact {
  email: string;
  title?: string;
  organization?: string;
  seniority?: "ic" | "manager" | "executive";
  confidence: number;
}

export interface ContactExtraction {
  contacts: ExtractedContact[];
  provenance: {
    extractorVersion: string;
    promptVersion: string;
    provider: string;
    model: string;
    routing: "device" | "remote" | "deterministic" | "unknown";
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
}

export interface ContactExtractor {
  readonly version: string;
  extract(request: ContactExtractionRequest): Promise<ContactExtraction>;
}

type RedactionMap = Map<string, string>;

/**
 * Redact secrets while PRESERVING email addresses.
 *
 * The address is the join key: without it an extracted title cannot be attached to
 * anyone, and the whole extraction is inert. Everything genuinely sensitive is still
 * removed.
 */
export function redactContactModelInput(text: string, replacements: RedactionMap): string {
  let index = replacements.size;
  const replace = (pattern: RegExp, label: string) => {
    text = text.replace(pattern, (match) => {
      const placeholder = `[REDACTED_${label}_${++index}]`;
      replacements.set(placeholder, match);
      return placeholder;
    });
  };
  replace(/\b(?:api[_ -]?key|password|secret|token)\s*[:=]\s*[^\s,;"']+/gi, "CREDENTIAL");
  replace(/\b(?:\d[ -]*?){13,19}\b/g, "FINANCIAL");
  replace(/\b(?:diagnosis|patient|medical record|prescription)\b[^.!?]*/gi, "HEALTH");
  // Email addresses are deliberately NOT redacted. See the doc comment.
  return text;
}

function emptyExtraction(
  routing: ContactExtraction["provenance"]["routing"],
  startedAt: number,
  contacts: ExtractedContact[] = [],
): ContactExtraction {
  const completed = startedAt;
  return {
    contacts,
    provenance: {
      extractorVersion: CONTACT_EXTRACTOR_VERSION,
      promptVersion: CONTACT_PROMPT_VERSION,
      provider: routing === "deterministic" ? "local" : "unknown",
      model: routing === "deterministic" ? "signature-parser" : "unknown",
      routing,
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(completed).toISOString(),
      durationMs: 0,
    },
  };
}

/** Signature parsing only. Always available, never leaves the device. */
export class DeterministicContactExtractor implements ContactExtractor {
  readonly version = "contact-deterministic-v1";

  async extract(request: ContactExtractionRequest): Promise<ContactExtraction> {
    const startedAt = Date.now();
    const byEmail = new Map<string, ExtractedContact>();
    for (const message of request.messages) {
      const parsed = parseEmailSignature({ body: message.body, from: message.from });
      if (!parsed) continue;
      const email = message.from.email.trim().toLowerCase();
      if (!email || byEmail.has(email)) continue;
      byEmail.set(email, {
        email,
        ...(parsed.title ? { title: parsed.title } : {}),
        ...(parsed.organization ? { organization: parsed.organization } : {}),
        confidence: parsed.confidence,
      });
    }
    return emptyExtraction("deterministic", startedAt, [...byEmail.values()]);
  }
}

const CONTACT_TASK = `Identify the job title and employing organization of each external
person in this email thread.

Rules:
- Only report what the text states or clearly implies about the SENDER of a message.
- Never infer a title from the topic of the conversation.
- Use the exact email address given; do not invent or correct addresses.
- Omit a person entirely rather than guessing.
- Return an empty list when the thread says nothing about anyone's role.`;

/** One model pass. Throws when no permitted route exists. */
export class StructuredContactExtractor implements ContactExtractor {
  readonly version = CONTACT_EXTRACTOR_VERSION;

  async extract(request: ContactExtractionRequest): Promise<ContactExtraction> {
    const startedAt = Date.now();
    const model = await getMeetingNotesModel();
    const { provider } = await getDefaultModelAndProvider();
    const config = await resolveProviderConfig(provider);
    const location = providerDataLocation(config);
    const transcription = await getTranscriptionConfig();
    // Same gate as the conversation extractor: local-only means local-only, and the
    // Hybrid below falls back to signature parsing rather than failing the user.
    if (transcription.privacy.localOnly && location !== "device") {
      throw new Error("contact extraction has no permitted local model route");
    }

    const replacements: RedactionMap = new Map();
    const body = request.messages
      .map((message) => {
        const text = redactContactModelInput(message.body.slice(0, MAX_BODY_CHARS), replacements);
        return `From: ${message.from.name ?? ""} <${message.from.email}>\nSent: ${message.sentAt}\n${text}`;
      })
      .join("\n\n---\n\n");

    const languageModel = createProvider(config).languageModel(model);
    const result = await withUseCase(
      { useCase: "meeting_note", subUseCase: "contact_extraction" },
      () =>
        Promise.race([
          generateObject({
            model: languageModel,
            schema: ContactModelOutputSchema,
            messages: [
              // Non-negotiable: this reads attacker-supplied email bodies.
              { role: "system" as const, content: `${CONTACT_TASK}\n\n${MAIL_UNTRUSTED_CONTENT_GUARD}` },
              { role: "user" as const, content: body },
            ],
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("contact extraction timed out")), CONTACT_MODEL_TIMEOUT_MS),
          ),
        ]),
    );

    const known = new Set(
      request.knownParticipants.map((participant) => participant.email.trim().toLowerCase()),
    );
    const contacts: ExtractedContact[] = [];
    for (const contact of result.object.contacts) {
      const email = contact.email.trim().toLowerCase();
      // A model must not introduce a person who was never on the thread.
      if (!known.has(email)) continue;
      if (!contact.title && !contact.organization) continue;
      contacts.push({
        email,
        ...(contact.title ? { title: contact.title } : {}),
        ...(contact.organization ? { organization: contact.organization } : {}),
        ...(contact.seniority ? { seniority: contact.seniority } : {}),
        confidence: Math.min(contact.confidence, MAX_MODEL_CONTACT_CONFIDENCE),
      });
    }

    const completedAt = Date.now();
    return {
      contacts,
      provenance: {
        extractorVersion: this.version,
        promptVersion: CONTACT_PROMPT_VERSION,
        provider,
        model,
        routing: location === "device" ? "device" : "remote",
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date(completedAt).toISOString(),
        durationMs: completedAt - startedAt,
      },
    };
  }
}

/**
 * Semantic first, deterministic fallback — and the model only fills gaps.
 *
 * A model answer is discarded outright for any address the signature parser already
 * resolved. That ordering is the safety property: the literal line under `-- ` always
 * wins over an inference, without needing to compare confidences at all.
 */
export class HybridContactExtractor implements ContactExtractor {
  readonly version = CONTACT_EXTRACTOR_VERSION;

  constructor(
    private readonly semantic: ContactExtractor = new StructuredContactExtractor(),
    private readonly deterministic: ContactExtractor = new DeterministicContactExtractor(),
  ) {}

  async extract(request: ContactExtractionRequest): Promise<ContactExtraction> {
    const parsed = await this.deterministic.extract(request);
    const resolved = new Set(parsed.contacts.map((contact) => contact.email));

    let semantic: ContactExtraction | null = null;
    try {
      semantic = await this.semantic.extract(request);
    } catch {
      // No permitted route, or the model failed. Signature parsing stands alone.
      return parsed;
    }

    const merged = [...parsed.contacts];
    for (const contact of semantic.contacts) {
      if (resolved.has(contact.email)) continue;
      merged.push({ ...contact, confidence: Math.min(contact.confidence, MAX_MODEL_CONTACT_CONFIDENCE) });
    }
    return { contacts: merged, provenance: semantic.provenance };
  }
}
