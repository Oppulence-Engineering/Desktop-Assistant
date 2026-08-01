export const MISSION_CONTROL_QUESTIONS = [
  { key: "state", label: "What is true now?" },
  { key: "change", label: "What changed?" },
  { key: "evidence", label: "Why should I trust it?" },
  { key: "action", label: "What should happen next?" },
];

// User-facing RFC 038 capabilities that must remain reachable in both clients.
// Platform-specific capture mechanics may differ, but both clients must expose a
// path to publish reviewed transcript evidence into the same relationship state.
export const RELATIONSHIP_CLIENT_CAPABILITIES = [
  "source-lifecycle",
  "identity-review",
  "mission-control",
  "evidence-inspection",
  "state-correction",
  "assertion-retraction",
  "conversation-review",
  "contradiction-resolution",
  "commitment-management",
  "mutual-action-plans",
  "attention-queue",
  "governed-actions",
  "action-audit",
  "outcome-observation",
  "transcript-publication",
  "privacy-deletion",
  "support-diagnostics",
];

export const RELATIONSHIP_DIMENSION_LABELS = {
  lifecycle: "Lifecycle",
  engagement: "Engagement",
  sentiment: "Sentiment",
  health: "Health",
  summary: "Summary",
  next_action: "Next action",
  risk: "Risk",
  milestone: "Milestone",
};

export const COMPLETENESS_LABELS = {
  complete: "Evidence current",
  partial: "Partial evidence",
  stale: "Evidence stale",
  rebuilding: "Sources rebuilding",
  ambiguous: "Identity review required",
  disconnected: "Source disconnected",
};

export const AUTHORITY_LABELS = {
  user_correction: "Confirmed by a person",
  source_fact: "Source fact",
  deterministic: "Deterministic rule",
  ai_inference: "AI inference",
};

export function relationshipLabel(value) {
  return (value || "unknown")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function completenessTone(status) {
  if (status === "complete") return "safe";
  if (status === "partial" || status === "rebuilding") return "caution";
  return "blocked";
}

function stableFingerprint(value) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `import-${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function transcriptSegments(transcript) {
  let cursor = 0;
  return transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^([^:]{1,80}):\s+(.+)$/);
      const speakerLabel = match?.[1]?.trim() || "Unknown speaker";
      const text = match?.[2]?.trim() || line;
      const duration = Math.max(1_000, Math.min(30_000, text.length * 55));
      const segment = {
        id: `segment-${index + 1}`,
        speakerId: `imported-speaker-${stableFingerprint(speakerLabel.toLowerCase())}`,
        speakerLabel,
        speakerConfidence: match ? 0.9 : 0.5,
        startMs: cursor,
        endMs: cursor + duration,
        text,
      };
      cursor += duration;
      return segment;
    });
}

/** Build reviewable, append-only evidence from a user-supplied transcript. */
export function buildImportedTranscriptObservation({
  relationshipId,
  title,
  transcript,
  occurredAt,
  sourceRecordId,
  participantDisclosure = "confirmed_by_importer",
}) {
  const normalizedTranscript = String(transcript || "").trim();
  if (!relationshipId || !normalizedTranscript) {
    throw new Error("relationshipId and transcript are required");
  }
  const timestamp = new Date(occurredAt || Date.now()).toISOString();
  const normalizedTitle = String(title || "Imported conversation").trim();
  const segments = transcriptSegments(normalizedTranscript);
  const fingerprint = stableFingerprint(
    JSON.stringify({ relationshipId, normalizedTitle, normalizedTranscript, timestamp }),
  );
  const recordId = String(sourceRecordId || `${timestamp}:${fingerprint}`);
  const envelope = {
    schemaVersion: 1,
    provider: "upload",
    sourceRecordId: recordId,
    fingerprint,
    title: normalizedTitle,
    occurredAt: timestamp,
    participants: [],
    segments,
    captureCaveats: [
      "Transcript text was imported by a user; Oppulence did not verify the original audio.",
    ],
    governance: {
      receiptId: `governance:${fingerprint}`,
      capturedAt: timestamp,
      capturePolicy: "manual_transcript_import",
      routing: "reviewed_import_to_oppulence",
      region: "client",
      retention: "workspace_policy",
      participantDisclosure,
      legalHold: false,
      deletionOutcome: "managed_by_workspace_policy",
      evidenceClip: "not_retained",
    },
  };
  return {
    relationshipId,
    source: "meeting",
    sourceAccountId: "upload",
    externalId: `upload:${recordId}`,
    sourceVersion: fingerprint,
    eventType: "conversation_evidence_compiled",
    occurredAt: timestamp,
    summary: `${normalizedTitle} · ${segments.length} imported segment${segments.length === 1 ? "" : "s"}`,
    normalizedFacts: {
      provider: "upload",
      dedupe_fingerprint: fingerprint,
      canonical_transcript: {
        schema_version: 1,
        source_record_id: recordId,
        segment_count: segments.length,
      },
      conversation_claims: [],
      action_pack: [],
      governance_receipt: envelope.governance,
    },
    payload: { envelope },
    assertions: [],
  };
}
