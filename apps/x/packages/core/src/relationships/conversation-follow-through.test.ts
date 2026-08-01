import { describe, expect, it } from "vitest";
import type {
  CommitmentProjection,
  ContradictionEvidenceSide,
  ConversationDeletionReceipt,
  ConversationPolicyLayer,
  MutualActionPlan,
} from "@x/shared/dist/relationships.js";
import { detectContradictionCase, resolveContradictionCase } from "./contradiction-cases.js";
import { evaluateCommitmentRecovery } from "./commitment-recovery.js";
import { detectLiveCoachingSignals, generateLiveCoachingCues } from "./live-coaching.js";
import {
  createMutualActionPlan,
  createPlanShareGrant,
  reviseMutualActionPlan,
} from "./mutual-action-plans.js";
import { rankRecommendation } from "./recommendation-ranker.js";
import {
  evaluateConversationPolicy,
  finalizeDeletionReceipt,
  redactConversationText,
  resolveConversationPolicy,
} from "./conversation-policy.js";

const side = (
  assertionId: string,
  value: string,
  sourceType: ContradictionEvidenceSide["sourceType"] = "source_fact",
  validFrom = "2026-07-01T00:00:00.000Z",
): ContradictionEvidenceSide => ({
  assertionId,
  sourceType,
  source: "crm",
  value: { kind: "date", value },
  validFrom,
  observedAt: validFrom,
  evidenceRefs: [`evidence-${assertionId}`],
  identityConfidence: 1,
});

const commitment: CommitmentProjection = {
  commitmentId: "commitment-1",
  version: 4,
  state: "open",
  acceptance: "accepted",
  ownerParticipantRef: "owner",
  counterpartyParticipantRef: "customer",
  action: "Send security packet",
  dueAt: "2026-08-01T17:00:00.000Z",
  evidenceRefs: ["evidence-1"],
};

describe("conversation follow-through domain", () => {
  it("distinguishes typed contradictions from equivalence and temporal change", () => {
    expect(
      detectContradictionCase({
        relationshipId: "r1",
        subjectRef: "account",
        dimension: "renewal_date",
        left: side("a", "2026-09-01T00:00:00Z"),
        right: side("b", "2026-09-01T00:00:00.000Z"),
        openedAt: "2026-07-31T12:00:00.000Z",
      }),
    ).toBeNull();

    const contradiction = detectContradictionCase({
      relationshipId: "r1",
      subjectRef: "account",
      dimension: "renewal_date",
      left: side("a", "2026-09-01T00:00:00Z"),
      right: side("b", "2026-10-01T00:00:00Z"),
      openedAt: "2026-07-31T12:00:00.000Z",
    });
    expect(contradiction?.status).toBe("open");
    expect(
      resolveContradictionCase({
        contradiction: contradiction!,
        selectedAssertionId: "b",
        resolutionAssertionId: "resolution-1",
        resolvedAt: "2026-07-31T12:05:00.000Z",
      }).status,
    ).toBe("user_resolved");

    expect(
      detectContradictionCase({
        relationshipId: "r1",
        subjectRef: "account",
        dimension: "renewal_date",
        left: { ...side("old", "2026-09-01T00:00:00Z"), validTo: "2026-06-30T23:59:59Z" },
        right: side("new", "2026-10-01T00:00:00Z", "source_fact", "2026-07-01T00:00:00Z"),
        openedAt: "2026-07-31T12:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("blocks automatic commitment closure when required sources are stale", () => {
    const stale = evaluateCommitmentRecovery({
      commitment,
      evidence: [
        {
          evidenceRef: "email-1",
          source: "gmail",
          fresh: true,
          kind: "likely_fulfilled",
          occurredAt: "2026-08-02T10:00:00.000Z",
        },
      ],
      requiredSources: ["gmail", "slack"],
      recoveryWindow: "2026-08-02",
      evaluatedAt: "2026-08-02T12:00:00.000Z",
    });
    expect(stale).toMatchObject({
      classification: "unknown_stale_sources",
      requiresReview: true,
      staleSources: ["slack"],
    });

    const fulfilled = evaluateCommitmentRecovery({
      commitment,
      evidence: [
        {
          evidenceRef: "email-2",
          source: "gmail",
          fresh: true,
          kind: "explicit_fulfilled",
          occurredAt: "2026-08-02T10:00:00.000Z",
        },
      ],
      requiredSources: ["gmail"],
      recoveryWindow: "2026-08-02",
      evaluatedAt: "2026-08-02T12:00:00.000Z",
    });
    expect(fulfilled).toMatchObject({ classification: "fulfilled", requiresReview: false });
  });

  it("emits sparse source-linked local cues with cooldown and an off switch", () => {
    const signals = detectLiveCoachingSignals({
      meetingId: "meeting-1",
      segments: [{ startMs: 10, endMs: 20, text: "We will send it, but I am concerned." }],
    });
    expect(signals.map((signal) => signal.kind)).toEqual([
      "unresolved_objection",
      "promise_missing_date",
    ]);
    expect(signals.every((signal) => signal.evidenceRef === "live:meeting-1:10-20")).toBe(true);
    const args = {
      meetingId: "meeting-1",
      signals: [
        {
          kind: "unresolved_objection" as const,
          evidenceRef: "evidence-1",
          exactQuote: "Security is still a concern.",
          confidence: 0.9,
        },
      ],
      preferences: { frequency: "standard" as const },
      now: "2026-07-31T12:00:00.000Z",
    };
    const cues = generateLiveCoachingCues(args);
    expect(cues[0]).toMatchObject({
      privacyRoute: "deterministic",
      sourceRefs: ["evidence-1"],
    });
    expect(cues[0].suggestedQuestion).toContain("concern");
    expect(generateLiveCoachingCues({ ...args, priorCues: cues })).toEqual([]);
    expect(generateLiveCoachingCues({ ...args, preferences: { frequency: "off" } })).toEqual([]);
  });

  it("creates plans only from accepted evidence and invalidates prior share revisions", () => {
    const plan = createMutualActionPlan({
      relationshipId: "relationship-1",
      internalOwnerRef: "owner",
      counterpartyRef: "customer",
      commitments: [commitment],
      createdAt: "2026-07-31T12:00:00.000Z",
      createdBy: "owner",
    });
    const approved: MutualActionPlan = { ...plan, status: "internally_approved" };
    const grant = createPlanShareGrant({
      plan: approved,
      rawToken: "one-use-random-token",
      expiresAt: "2099-08-07T12:00:00.000Z",
    });
    expect(grant).not.toHaveProperty("rawToken");
    expect(grant.revisionHash).toBe(plan.currentRevision.revisionHash);

    const revised = reviseMutualActionPlan({
      plan: { ...approved, status: "shared", tokenState: "active" },
      items: [{ ...plan.currentRevision.items[0], status: "blocked" }],
      createdAt: "2026-08-01T12:00:00.000Z",
      createdBy: "owner",
    });
    expect(revised).toMatchObject({ status: "revised", tokenState: "revoked" });
    expect(revised.currentRevision.version).toBe(2);
  });

  it("keeps ranking bounded and fully explained with cold-start fallback", () => {
    const result = rankRecommendation({
      recommendationId: "recommendation-1",
      baselineScore: 60,
      context: {
        commitmentDueState: "overdue",
        sourceCompleteness: 1,
        recencyHours: 4,
        preferredChannel: true,
        userSamples: 3,
        workspaceSamples: 10,
      },
      evaluatedAt: "2026-07-31T12:00:00.000Z",
    });
    expect(result.sampleScope).toBe("cold_start");
    expect(result.finalScore).toBe(
      result.baselineScore + result.factors.reduce((sum, factor) => sum + factor.contribution, 0),
    );
    expect(result.factors.every((factor) => Math.abs(factor.contribution) <= 20)).toBe(true);
  });

  it("resolves stricter privacy layers, fails closed, redacts, and verifies deletion", () => {
    const layers: ConversationPolicyLayer[] = [
      {
        layerId: "org",
        scope: "organization",
        enforced: true,
        capture: "require_consent",
        modelRoute: "hosted_allowed",
        publishEvidence: true,
        externalShare: true,
        retentionDays: 90,
        redactionClasses: ["credentials"],
        legalHold: false,
      },
      {
        layerId: "user",
        scope: "user",
        enforced: false,
        capture: "allow",
        modelRoute: "local_only",
        publishEvidence: false,
        externalShare: false,
        retentionDays: 30,
        redactionClasses: ["personal_identifier"],
        legalHold: false,
      },
    ];
    const policy = resolveConversationPolicy(layers, "2026-07-31T12:00:00.000Z");
    expect(policy).toMatchObject({
      capture: "require_consent",
      modelRoute: "local_only",
      publishEvidence: false,
      retentionDays: 30,
    });
    expect(
      evaluateConversationPolicy({
        policy,
        checkpoint: "capture",
        participantConsent: "unknown",
        decidedAt: "2026-07-31T12:01:00.000Z",
      }),
    ).toMatchObject({ allowed: false, route: "none" });
    expect(
      evaluateConversationPolicy({
        policy,
        checkpoint: "semantic_enrichment",
        participantConsent: "confirmed",
        requestedRoute: "cloud",
        decidedAt: "2026-07-31T12:01:00.000Z",
      }),
    ).toMatchObject({ allowed: false, route: "none" });
    expect(
      redactConversationText("api key: abc123 for person@example.com", policy.redactionClasses),
    ).toMatchObject({ replacements: 2 });

    const receipt: ConversationDeletionReceipt = {
      receiptId: "delete-1",
      requestedAt: "2026-07-31T12:00:00.000Z",
      scopeRef: "meeting-1",
      legalHold: false,
      status: "pending",
      targets: [
        {
          target: "local_recording",
          status: "deleted",
          verificationHash: "hash-1",
          attempts: 1,
        },
        { target: "api_evidence", status: "not_found", attempts: 1 },
      ],
    };
    expect(finalizeDeletionReceipt(receipt, "2026-07-31T12:05:00.000Z").status).toBe("verified");
    expect(finalizeDeletionReceipt({ ...receipt, legalHold: true }, "").status).toBe("blocked");
  });
});
