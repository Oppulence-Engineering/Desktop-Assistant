import type {
  MeetingsSettings,
  MeetingSessionMeta,
  MeetingTranscript,
  MeetingTranscriptSegment,
} from "@x/shared/dist/meetings.js";
import type { RelationshipObservationInput } from "@x/shared/dist/relationships.js";
import type { Counterparty, LedgerCommitment } from "../meetings/meetings.js";
import {
  canonicalTranscriptObservation,
  attachConversationExtraction,
  conversationFingerprint,
  resolveSpokenDueAt,
} from "./conversation-evidence.js";
import type { ConversationExtractor } from "./conversation-extractor.js";
import { HybridConversationExtractor } from "./conversation-extractor.js";

const MAX_TRANSCRIPT_PAYLOAD_CHARS = 250_000;
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
]);

function emailDomain(email: string | undefined): string | undefined {
  const normalized = email?.trim().toLowerCase();
  const at = normalized?.lastIndexOf("@") ?? -1;
  if (!normalized || at < 1 || at === normalized.length - 1) return undefined;
  const domain = normalized.slice(at + 1);
  return PERSONAL_EMAIL_DOMAINS.has(domain) ? undefined : domain;
}

function relationshipIdentity(counterparty: Counterparty) {
  const domain = emailDomain(counterparty.email);
  return {
    displayName: counterparty.organization || domain || counterparty.label,
    ...(counterparty.email ? { primaryEmail: counterparty.email } : {}),
    ...(domain ? { accountDomain: domain } : {}),
    participants: [
      {
        displayName: counterparty.label,
        ...(counterparty.email ? { email: counterparty.email } : {}),
        role: counterparty.role || "contact",
        ...(counterparty.role ? { title: counterparty.role } : {}),
      },
    ],
  };
}

function boundedSegments(segments: MeetingTranscriptSegment[]): {
  segments: MeetingTranscriptSegment[];
  truncated: boolean;
} {
  let chars = 0;
  const kept: MeetingTranscriptSegment[] = [];
  for (const segment of segments) {
    const next = JSON.stringify(segment).length;
    if (chars + next > MAX_TRANSCRIPT_PAYLOAD_CHARS) {
      return { segments: kept, truncated: true };
    }
    kept.push(segment);
    chars += next;
  }
  return { segments: kept, truncated: false };
}

function meetingTitle(meta: MeetingSessionMeta): string {
  if (!meta.calendar_event) return "Meeting";
  try {
    const event = JSON.parse(meta.calendar_event) as { summary?: unknown };
    return typeof event.summary === "string" && event.summary.trim()
      ? event.summary.trim()
      : "Meeting";
  } catch {
    return "Meeting";
  }
}

/**
 * Compile a finished, locally durable transcript into one immutable relationship
 * observation. No inferred state is asserted here: the transcript is evidence, and
 * later inference/correction layers decide what it means.
 */
export function meetingTranscriptObservation(args: {
  sessionId: string;
  meta: MeetingSessionMeta;
  transcript: MeetingTranscript;
  counterparty: Counterparty;
  settings?: Pick<MeetingsSettings, "keepAudio" | "syncRelationshipEvidence">;
  capturePolicy?: string;
  participantDisclosure?: string;
}): RelationshipObservationInput {
  const bounded = boundedSegments(args.transcript.segments);
  const title = meetingTitle(args.meta);
  const identity = relationshipIdentity(args.counterparty);
  const remoteSpeakerIsAggregate = bounded.segments.some((segment) => segment.speaker === "them");
  const counterpartySpeakerId = `meeting-participant:${conversationFingerprint(
    `${args.sessionId}:${
      args.counterparty.email?.trim().toLowerCase() || args.counterparty.label.trim().toLowerCase()
    }`,
  )}`;
  const receiptSeed = `${args.sessionId}:${args.meta.started}`;
  const observation = canonicalTranscriptObservation({
    identity,
    source: {
      provider: "oppulence",
      sourceRecordId: args.sessionId,
      title,
      occurredAt: args.meta.started,
      participants: identity.participants,
      segments: bounded.segments.map((segment) => ({
        speakerId: segment.speaker === "me" ? "local-user" : counterpartySpeakerId,
        speakerLabel: segment.speaker === "me" ? "You" : args.counterparty.label,
        speakerConfidence: segment.speaker === "me" ? 1 : 0.9,
        startMs: segment.start_ms,
        endMs: segment.end_ms,
        text: segment.text,
      })),
      captureCaveats: [
        ...args.meta.warnings,
        ...(bounded.truncated ? ["transcript payload was truncated"] : []),
        ...(remoteSpeakerIsAggregate
          ? [
              "remote speaker was resolved from the 1:1 calendar attendee; the system track may still contain other voices and no persistent voiceprint was created",
            ]
          : []),
      ],
      governance: {
        receiptId: `governance:${receiptSeed}`,
        capturedAt: args.meta.started,
        capturePolicy:
          args.capturePolicy ??
          (args.meta.calendar_event ? "calendar_prompt_or_manual" : "manual_capture"),
        routing: args.settings?.syncRelationshipEvidence
          ? "local_transcription_to_oppulence"
          : "local_only",
        region: "local_device",
        retention: args.settings?.keepAudio ?? "untilTranscribed",
        participantDisclosure: args.participantDisclosure ?? "not_recorded",
        legalHold: false,
        deletionOutcome: args.meta.audio_deleted_at
          ? `deleted:${args.meta.audio_deleted_at}`
          : args.settings?.keepAudio === "always"
            ? "retained_by_user_policy"
            : "scheduled_after_transcription",
        evidenceClip: "not_retained",
      },
    },
  });
  return {
    ...observation,
    normalizedFacts: {
      ...observation.normalizedFacts,
      session_id: args.sessionId,
      meeting_title: title,
      transcript_segments: args.transcript.segments.length,
      transcript_payload_truncated: bounded.truncated,
      transcription_engine: args.transcript.engine,
      transcription_model: args.transcript.model,
      tracks: args.meta.tracks.map((track) => ({
        id: track.id,
        silent: track.silent,
        peak: track.peak,
      })),
    },
  };
}

/** Run validated semantic extraction in shadow mode for a finished meeting. */
export async function meetingTranscriptObservationWithExtraction(
  args: Parameters<typeof meetingTranscriptObservation>[0] & {
    extractor?: ConversationExtractor;
  },
): Promise<RelationshipObservationInput> {
  const observation = meetingTranscriptObservation(args);
  const envelope = (
    observation.payload as {
      envelope: import("@x/shared/dist/relationships.js").CanonicalTranscriptEnvelope;
    }
  ).envelope;
  const extractor = args.extractor ?? new HybridConversationExtractor();
  const extraction = await extractor.extract({
    envelope,
    extractorVersion: extractor.version,
    requestedClaimKinds: [
      "risk",
      "objection",
      "decision",
      "milestone",
      "sentiment",
      "stakeholder",
      "lifecycle",
      "commitment",
    ],
  });
  return attachConversationExtraction(observation, extraction);
}

/**
 * A user confirmation is a source fact, not an AI inference. A promise by the local
 * user also becomes the relationship's next action; a promise by the counterparty is
 * preserved as a commitment without pretending it is the user's task.
 */
export function confirmedCommitmentObservation(args: {
  commitment: LedgerCommitment;
  counterparty: Counterparty;
}): RelationshipObservationInput {
  const commitment = args.commitment;
  // Local Markdown paths may contain usernames or workspace structure and are not
  // resolvable by the shared web client. The stable session/commitment identities are
  // sufficient provenance, so do not include the local-only path in cloud evidence.
  const { note_path: _localNotePath, ...sharedCommitment } = commitment;
  const identity = relationshipIdentity(args.counterparty);
  const promisedByMe = commitment.owner === "me";
  return {
    ...identity,
    source: "meeting",
    externalId: `commitment:${commitment.id}`,
    sourceVersion: "1",
    eventType: "commitment_confirmed",
    occurredAt: commitment.confirmed_at,
    summary: `${promisedByMe ? "We" : args.counterparty.label} committed to: ${commitment.text}`,
    normalizedFacts: {
      commitment_id: commitment.id,
      commitment_owner: commitment.owner,
      commitment_direction: promisedByMe ? "promised_by_me" : "promised_by_them",
      commitment_text: commitment.text,
      commitment_status: commitment.status,
      commitment_due_phrase: commitment.due_phrase,
      commitment_due_at: resolveSpokenDueAt(commitment.due_phrase, commitment.confirmed_at),
      user_confirmed: true,
      session_id: commitment.session_id,
      evidence_quote: commitment.evidence,
      evidence_start_ms: commitment.start_ms,
      evidence_end_ms: commitment.end_ms,
    },
    payload: {
      commitment: sharedCommitment,
      evidence: {
        quote: commitment.evidence,
        startMs: commitment.start_ms,
        endMs: commitment.end_ms,
        sessionId: commitment.session_id,
      },
    },
    assertions: promisedByMe
      ? [
          {
            dimension: "next_action",
            value: commitment.text,
            sourceType: "source_fact",
            confidence: 1,
            reason: "User confirmed this commitment from the cited meeting transcript.",
            validFrom: commitment.confirmed_at,
          },
        ]
      : [],
  };
}

/** Later user-confirmed fulfillment/cancellation reconciles the durable cloud promise. */
export function commitmentStatusObservation(args: {
  commitment: LedgerCommitment;
  status: "open" | "done" | "dropped";
  counterparty: Counterparty;
  occurredAt?: string;
}): RelationshipObservationInput {
  const occurredAt = args.occurredAt ?? new Date().toISOString();
  const status =
    args.status === "done" ? "fulfilled" : args.status === "dropped" ? "cancelled" : "open";
  return {
    ...relationshipIdentity(args.counterparty),
    source: "meeting",
    externalId: `commitment-update:${args.commitment.id}:${status}`,
    sourceVersion: "1",
    eventType: "commitment_status_changed",
    occurredAt,
    summary: `Commitment marked ${status}: ${args.commitment.text}`,
    normalizedFacts: {
      session_id: args.commitment.session_id,
      commitment_updates: [
        {
          commitmentId: args.commitment.id,
          status,
          text: args.commitment.text,
          dueAt: resolveSpokenDueAt(args.commitment.due_phrase, args.commitment.confirmed_at),
        },
      ],
      user_confirmed: true,
    },
    payload: {
      commitmentId: args.commitment.id,
      previousEvidence: args.commitment.evidence,
      status,
    },
  };
}
