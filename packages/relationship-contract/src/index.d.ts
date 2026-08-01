export const MISSION_CONTROL_QUESTIONS: readonly [
  { readonly key: "state"; readonly label: "What is true now?" },
  { readonly key: "change"; readonly label: "What changed?" },
  { readonly key: "evidence"; readonly label: "Why should I trust it?" },
  { readonly key: "action"; readonly label: "What should happen next?" },
];
export const RELATIONSHIP_CLIENT_CAPABILITIES: readonly string[];
export const RELATIONSHIP_DIMENSION_LABELS: Record<string, string>;
export const COMPLETENESS_LABELS: Record<string, string>;
export const AUTHORITY_LABELS: Record<string, string>;
export function relationshipLabel(value?: string): string;
export function completenessTone(status: string): "safe" | "caution" | "blocked";
export interface ImportedTranscriptObservationInput {
  relationshipId: string;
  title?: string;
  transcript: string;
  occurredAt?: string;
  sourceRecordId?: string;
  participantDisclosure?: string;
}
export interface ImportedTranscriptObservation {
  relationshipId: string;
  source: "meeting";
  sourceAccountId: "upload";
  externalId: string;
  sourceVersion: string;
  eventType: "conversation_evidence_compiled";
  occurredAt: string;
  summary: string;
  normalizedFacts: Record<string, unknown>;
  payload: Record<string, unknown>;
  assertions: [];
}
export function buildImportedTranscriptObservation(
  input: ImportedTranscriptObservationInput,
): ImportedTranscriptObservation;
