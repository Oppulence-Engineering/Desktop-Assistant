import { z } from "zod";
import type {
  CanonicalTranscriptEnvelope,
  ConversationCandidateRejection,
  ConversationClaimCandidate,
  ConversationExtractionProvenance,
  ConversationExtractionResult,
  ConversationNormalizedValue,
} from "@x/shared/dist/relationships.js";
import {
  ConversationExtractionResultSchema,
  ConversationNormalizedValueSchema,
} from "@x/shared/dist/relationships.js";
import { resolveSpokenDueAt } from "./conversation-dates.js";
import { conversationFingerprint, normalizeConversationText } from "./conversation-utils.js";

const EvidenceDraftSchema = z.object({
  exactQuote: z.string().min(1),
  speakerId: z.string().optional(),
  startMs: z.number().nonnegative().optional(),
});

/** Untrusted structured output shape. Stable ids and spans are derived, never trusted. */
export const ConversationCandidateDraftSchema = z.object({
  kind: z.enum([
    "risk",
    "objection",
    "decision",
    "milestone",
    "sentiment",
    "stakeholder",
    "lifecycle",
    "commitment",
  ]),
  normalizedValue: ConversationNormalizedValueSchema,
  evidence: z.array(EvidenceDraftSchema).min(1),
  speakerRef: z.string().optional(),
  subjectRef: z.string().optional(),
  counterpartyRef: z.string().optional(),
  stateDimension: z.string().optional(),
  confidence: z.number().min(0).max(1),
  caveats: z.array(z.string()).default([]),
});

export type ConversationCandidateDraft = z.infer<typeof ConversationCandidateDraftSchema>;

interface IndexedSegment {
  id: string;
  speakerId: string;
  speakerConfidence: number;
  startMs: number;
  endMs: number;
  from: number;
  to: number;
}

interface TranscriptIndex {
  text: string;
  segments: IndexedSegment[];
}

function buildTranscriptIndex(envelope: CanonicalTranscriptEnvelope): TranscriptIndex {
  let text = "";
  const segments: IndexedSegment[] = [];
  for (const segment of envelope.segments) {
    const normalized = normalizeConversationText(segment.text);
    if (!normalized) continue;
    if (text) text += " ";
    const from = text.length;
    text += normalized;
    segments.push({
      id: segment.id,
      speakerId: segment.speakerId,
      speakerConfidence: segment.speakerConfidence,
      startMs: segment.startMs,
      endMs: segment.endMs,
      from,
      to: text.length,
    });
  }
  return { text, segments };
}

function locateEvidence(
  index: TranscriptIndex,
  quoteValue: string,
  hintMs?: number,
): IndexedSegment[] | null {
  const quote = normalizeConversationText(quoteValue);
  if (quote.length < 4) return null;
  const matches: IndexedSegment[][] = [];
  for (let at = index.text.indexOf(quote); at >= 0; at = index.text.indexOf(quote, at + 1)) {
    const end = at + quote.length;
    const touched = index.segments.filter((segment) => segment.from < end && segment.to > at);
    if (touched.length > 0) matches.push(touched);
  }
  if (matches.length === 0) return null;
  if (matches.length === 1 || hintMs === undefined) return matches[0];
  return matches.reduce((best, candidate) =>
    Math.abs(candidate[0].startMs - hintMs) < Math.abs(best[0].startMs - hintMs) ? candidate : best,
  );
}

function displayValue(value: ConversationNormalizedValue): string {
  switch (value.kind) {
    case "risk":
    case "objection":
    case "decision":
    case "milestone":
      return value.text;
    case "sentiment":
      return value.sentiment;
    case "stakeholder":
      return value.role ? `${value.displayName} · ${value.role}` : value.displayName;
    case "lifecycle":
      return value.lifecycle;
    case "commitment":
      return value.action;
  }
}

function stateDimension(value: ConversationNormalizedValue): string | undefined {
  switch (value.kind) {
    case "risk":
    case "objection":
      return "risk";
    case "milestone":
      return "milestone";
    case "sentiment":
      return "sentiment";
    case "lifecycle":
      return "lifecycle";
    case "commitment":
      return "next_action";
    case "decision":
    case "stakeholder":
      return undefined;
  }
}

function rejection(
  index: number,
  reason: ConversationCandidateRejection["reason"],
  detail: string,
): ConversationCandidateRejection {
  return { index, reason, detail };
}

export interface ValidateConversationCandidatesArgs {
  envelope: CanonicalTranscriptEnvelope;
  rawCandidates: unknown[];
  provenance: ConversationExtractionProvenance;
  requestedKinds?: ReadonlySet<string>;
}

/**
 * Validate model/rule output against the immutable transcript.
 *
 * The validator derives evidence spans, due dates, ids, display values, and state
 * dimensions. A model cannot manufacture any of those authority-bearing fields.
 */
export function validateConversationCandidates(
  args: ValidateConversationCandidatesArgs,
): ConversationExtractionResult {
  const transcript = buildTranscriptIndex(args.envelope);
  const speakers = new Set(args.envelope.segments.map((segment) => segment.speakerId));
  const candidates: ConversationClaimCandidate[] = [];
  const rejectedCandidates: ConversationCandidateRejection[] = [];
  const dedupe = new Set<string>();

  for (const [index, raw] of args.rawCandidates.entries()) {
    const parsed = ConversationCandidateDraftSchema.safeParse(raw);
    if (!parsed.success) {
      rejectedCandidates.push(rejection(index, "schema_invalid", parsed.error.message));
      continue;
    }
    const draft = parsed.data;
    if (draft.kind !== draft.normalizedValue.kind) {
      rejectedCandidates.push(
        rejection(index, "kind_mismatch", "candidate kind does not match normalized value kind"),
      );
      continue;
    }
    if (args.requestedKinds && !args.requestedKinds.has(draft.kind)) {
      rejectedCandidates.push(
        rejection(index, "kind_mismatch", "candidate kind was not requested"),
      );
      continue;
    }
    if (draft.speakerRef && !speakers.has(draft.speakerRef)) {
      rejectedCandidates.push(
        rejection(index, "speaker_missing", "candidate speaker is absent from the envelope"),
      );
      continue;
    }
    if (
      draft.normalizedValue.kind === "commitment" &&
      !speakers.has(draft.normalizedValue.ownerSpeakerId)
    ) {
      rejectedCandidates.push(
        rejection(index, "owner_missing", "commitment owner is absent from the envelope"),
      );
      continue;
    }

    const evidence = [];
    let invalidEvidence: ConversationCandidateRejection | null = null;
    for (const item of draft.evidence) {
      if (normalizeConversationText(item.exactQuote).length < 4) {
        invalidEvidence = rejection(index, "quote_too_short", "evidence quote is too short");
        break;
      }
      const touched = locateEvidence(transcript, item.exactQuote, item.startMs);
      if (!touched) {
        invalidEvidence = rejection(
          index,
          "quote_missing",
          "evidence quote does not occur in the canonical transcript",
        );
        break;
      }
      if (item.speakerId && !touched.some((segment) => segment.speakerId === item.speakerId)) {
        invalidEvidence = rejection(
          index,
          "speaker_missing",
          "evidence quote does not touch the claimed speaker",
        );
        break;
      }
      const uniqueSpeakers = [...new Set(touched.map((segment) => segment.speakerId))];
      evidence.push({
        exactQuote: item.exactQuote.trim(),
        segmentIds: touched.map((segment) => segment.id),
        startMs: touched[0].startMs,
        endMs: touched[touched.length - 1].endMs,
        ...(uniqueSpeakers.length === 1 ? { speakerId: uniqueSpeakers[0] } : {}),
      });
    }
    if (invalidEvidence) {
      rejectedCandidates.push(invalidEvidence);
      continue;
    }

    let normalizedValue = draft.normalizedValue;
    let duePhrase: string | undefined;
    let dueAt: string | undefined;
    if (normalizedValue.kind === "commitment") {
      duePhrase = normalizedValue.duePhrase?.trim() || undefined;
      const resolved = resolveSpokenDueAt(duePhrase, args.envelope.occurredAt);
      if (normalizedValue.dueAt && (!resolved || normalizedValue.dueAt !== resolved)) {
        rejectedCandidates.push(
          rejection(index, "date_invalid", "model dueAt disagrees with deterministic resolution"),
        );
        continue;
      }
      dueAt = resolved;
      normalizedValue = { ...normalizedValue, ...(dueAt ? { dueAt } : {}) };
    }

    const key = JSON.stringify({
      kind: draft.kind,
      normalizedValue,
      evidence: evidence.map((item) => [item.startMs, item.endMs, item.exactQuote]),
    });
    if (dedupe.has(key)) {
      rejectedCandidates.push(rejection(index, "duplicate", "duplicate candidate"));
      continue;
    }
    dedupe.add(key);

    const touchedSegments = evidence.flatMap((item) =>
      item.segmentIds
        .map((segmentId) => args.envelope.segments.find((segment) => segment.id === segmentId))
        .filter((segment) => segment !== undefined),
    );
    const caveats = new Set([...args.envelope.captureCaveats, ...draft.caveats]);
    if (touchedSegments.some((segment) => segment.speakerConfidence < 0.75)) {
      caveats.add("speaker assignment requires review");
    }
    if (normalizedValue.kind === "commitment" && normalizedValue.acceptance === "ambiguous") {
      caveats.add("commitment acceptance requires review");
    }

    const candidateId = `candidate:${conversationFingerprint(
      `${args.envelope.fingerprint}:${key}`,
    )}`;
    candidates.push({
      candidateId,
      kind: draft.kind,
      normalizedValue,
      displayValue: displayValue(normalizedValue),
      evidence,
      ...(draft.speakerRef ? { speakerRef: draft.speakerRef } : {}),
      ...(draft.subjectRef ? { subjectRef: draft.subjectRef } : {}),
      ...(draft.counterpartyRef ? { counterpartyRef: draft.counterpartyRef } : {}),
      ...(stateDimension(normalizedValue)
        ? { stateDimension: stateDimension(normalizedValue) }
        : {}),
      ...(duePhrase ? { duePhrase } : {}),
      ...(dueAt ? { dueAt } : {}),
      confidence: draft.confidence,
      caveats: [...caveats],
      extractor: args.provenance,
    });
  }

  return ConversationExtractionResultSchema.parse({
    schemaVersion: 2,
    envelopeFingerprint: args.envelope.fingerprint,
    candidates,
    rejectedCandidates,
    provenance: args.provenance,
  });
}
