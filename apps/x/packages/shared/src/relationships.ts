import { z } from "zod";

export const RelationshipSchema = z.object({
  id: z.string(),
  kind: z.string(),
  displayName: z.string(),
  primaryEmail: z.string().optional(),
  accountDomain: z.string().optional(),
  summary: z.string().optional(),
  status: z.string(),
  lastTouchAt: z.string().optional(),
  nextActionAt: z.string().optional(),
  openActions: z.number().optional(),
  nextAction: z.string().optional(),
  lifecycle: z.string(),
  engagement: z.string(),
  sentiment: z.string(),
  health: z.string(),
  stateReason: z.string().optional(),
  stateVersion: z.number(),
  lastChangedAt: z.string().optional(),
  risks: z.array(z.string()),
  milestones: z.array(z.string()),
});

export const RelationshipActionSchema = z.object({
  id: z.string(),
  relationshipId: z.string().optional(),
  actionType: z.string(),
  channel: z.string(),
  detector: z.string(),
  reason: z.string(),
  proposedSubject: z.string().optional(),
  proposedMessage: z.string().optional(),
  priorityScore: z.number(),
  queueStatus: z.string(),
  policyStatus: z.string(),
  approvalStatus: z.string(),
  executionStatus: z.string(),
  executionMode: z.string(),
});

export const RelationshipParticipantSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string().optional(),
  role: z.string(),
  title: z.string().optional(),
  active: z.boolean(),
  externalRefs: z.array(z.string()),
});

export const RelationshipCommitmentSchema = z.object({
  id: z.string(),
  direction: z.string(),
  text: z.string(),
  status: z.string(),
  dueAt: z.string().optional(),
  confidence: z.number(),
  userConfirmed: z.boolean(),
});

export const RelationshipObservationSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceAccountId: z.string().optional(),
  externalId: z.string(),
  sourceVersion: z.string(),
  eventType: z.string(),
  occurredAt: z.string(),
  receivedAt: z.string(),
  summary: z.string().optional(),
  normalizedFacts: z.record(z.string(), z.unknown()),
  contentHash: z.string(),
});

export const RelationshipStateSnapshotSchema = z.object({
  id: z.string(),
  version: z.number(),
  state: z.record(z.string(), z.unknown()),
  changedDimensions: z.array(z.string()),
  assertionIds: z.array(z.string()),
  createdAt: z.string(),
});

export const RelationshipSourceStatusSchema = z.object({
  source: z.string(),
  sourceAccountId: z.string(),
  status: z.string(),
  lastSuccessAt: z.string().optional(),
  lastObservationAt: z.string().optional(),
  lastError: z.string().optional(),
});

export const RelationshipSemanticMatchSchema = z.object({
  threadId: z.string(),
  subject: z.string(),
  counterparty: z.string(),
  classification: z.string(),
  summary: z.string(),
  score: z.number(),
});

export const RelationshipDetailSchema = z.object({
  relationship: RelationshipSchema,
  actions: z.array(RelationshipActionSchema),
  recommendations: z.array(RelationshipActionSchema),
  participants: z.array(RelationshipParticipantSchema),
  commitments: z.array(RelationshipCommitmentSchema),
});

export type Relationship = z.infer<typeof RelationshipSchema>;
export type RelationshipAction = z.infer<typeof RelationshipActionSchema>;
export type RelationshipDetail = z.infer<typeof RelationshipDetailSchema>;
export type RelationshipObservation = z.infer<typeof RelationshipObservationSchema>;
export type RelationshipStateSnapshot = z.infer<typeof RelationshipStateSnapshotSchema>;
export type RelationshipSourceStatus = z.infer<typeof RelationshipSourceStatusSchema>;
export type RelationshipSemanticMatch = z.infer<typeof RelationshipSemanticMatchSchema>;
