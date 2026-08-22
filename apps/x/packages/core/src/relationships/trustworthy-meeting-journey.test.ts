import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  MeetingPreflightReport,
  type MeetingSessionMeta,
  type MeetingTranscript,
} from "@x/shared/meetings";
import {
  RelationshipSchema,
  type ConversationClaimCandidate,
  type RelationshipObservationIngestResult,
  type RelationshipObservationInput,
} from "@x/shared/relationships";
import type { LedgerCommitment } from "../meetings/meetings.js";
import { MeetingCaptureGuardian } from "../meetings/capture-guardian.js";
import { fakeTranscriber, sessionMeta, tone, trackMeta, writeWav } from "../meetings/factories.testkit.js";
import { MeetingQueue } from "../meetings/queue.js";
import { readMeta, writeJsonAtomic } from "../meetings/session.js";
import { DeterministicConversationExtractor } from "./conversation-extractor.js";
import {
  createConversationReviewBatch,
  decideConversationReviewItem,
} from "./conversation-review.js";
import { RelationshipEvidenceOutbox } from "./evidence-outbox.js";
import {
  confirmedCommitmentObservation,
  meetingTranscriptObservationWithExtraction,
} from "./meeting-evidence.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function settle(queue: { depth: number }): Promise<void> {
  for (let attempt = 0; attempt < 200 && queue.depth > 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(queue.depth).toBe(0);
}

/** RFC 038 section 10.2, kept as one named spine so its guarantees cannot drift apart. */
describe("trustworthy desktop conversation golden journey", () => {
  it("degrades honestly, reviews before authority, republishes after offline, and preserves deletion truth", async () => {
    // 1. Preflight may surface an optional-track warning without pretending capture is complete.
    const preflight = MeetingPreflightReport.parse({
      ok: false,
      problems: [
        {
          name: "system audio",
          status: "warn",
          detail: "the optional system track is temporarily unavailable",
          remediation: "continue with microphone capture or grant screen-recording permission",
        },
      ],
    });
    expect(preflight.problems).toEqual([
      expect.objectContaining({ name: "system audio", status: "warn" }),
    ]);

    // 2–4. A real two-track fixture experiences a system-track stall and recovers while
    // the healthy microphone keeps advancing. The degraded event remains in the timeline.
    const guardian = new MeetingCaptureGuardian();
    const capture = (nowMs: number, systemFrames = nowMs) => ({
      sessionId: "meeting-golden",
      nowMs,
      recordingStartedAtMs: 0,
      expectedTracks: ["mic" as const, "system" as const],
      tracks: [
        { id: "mic" as const, frames: nowMs, peak: 0.4, permission: "granted" as const },
        {
          id: "system" as const,
          frames: systemFrames,
          peak: systemFrames === nowMs ? 0.3 : 0,
          permission: "granted" as const,
        },
      ],
      sidecarHeartbeatAtMs: nowMs,
      sidecarRunning: true,
      availableDiskBytes: 10 * 1024 * 1024 * 1024,
      observedBytesPerSecond: 200_000,
      projectedRemainingSeconds: 3_600,
      modelReady: true,
      liveTranscriptionEnabled: false,
    });
    guardian.evaluate(capture(1_000));
    const degraded = guardian.evaluate(capture(16_001, 1_000));
    expect(degraded.activeEvents).toEqual([
      expect.objectContaining({ kind: "system_track_stalled", severity: "critical" }),
    ]);
    const recovered = guardian.evaluate(capture(17_000));
    expect(recovered.status).toBe("healthy");
    expect(recovered.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "system_track_stalled", severity: "recovered" }),
      ]),
    );

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tfa-desktop-golden-"));
    dirs.push(root);
    const meetingDir = path.join(root, "meeting-golden");
    await fs.mkdir(meetingDir, { recursive: true });
    await writeWav(path.join(meetingDir, "mic.wav"), tone(1));
    await writeWav(path.join(meetingDir, "system.wav"), tone(1, 0.4, 660));
    const initialMeta = sessionMeta({
      started: "2026-07-31T12:00:00.000Z",
      ended: "2026-07-31T12:00:02.000Z",
      duration_seconds: 2,
      tracks: [
        trackMeta({ id: "mic", speaker: "me", file: "mic.wav" }),
        trackMeta({ id: "system", speaker: "them", file: "system.wav" }),
      ],
      warnings: ["system audio stalled briefly and recovered"],
      calendar_event: JSON.stringify({ summary: "Acme renewal", attendees: [] }),
    });
    await writeJsonAtomic(path.join(meetingDir, "meta.json"), initialMeta);

    const transcriber = fakeTranscriber((call) => [
      call === 0
        ? { start: 0, end: 1, text: "I will send the proposal tomorrow." }
        : { start: 0, end: 1, text: "We are concerned about the budget." },
    ]);
    let publishedMeta: MeetingSessionMeta | undefined;
    let transcript: MeetingTranscript | undefined;
    let conversationEvidence: RelationshipObservationInput | undefined;
    const counterparty = {
      label: "Avery",
      relationshipId: "2875f11c-76cb-49b7-8e9d-8d865da1aa83",
      email: "avery@acme.example",
      organization: "Acme",
    };
    const queue = new MeetingQueue(root, {
      transcriber,
      engine: () => "whisper.cpp",
      model: () => "base.en",
      keepAudio: () => "untilTranscribed",
      onTranscribed: async (result) => {
        publishedMeta = result.meta;
        transcript = result.transcript;
        conversationEvidence = await meetingTranscriptObservationWithExtraction({
          sessionId: "meeting-golden",
          meta: result.meta,
          transcript: result.transcript,
          counterparty,
          settings: { keepAudio: "untilTranscribed", syncRelationshipEvidence: true },
          extractor: new DeterministicConversationExtractor(
            () => new Date("2026-07-31T12:02:00.000Z"),
          ),
        });
      },
    });
    queue.enqueue(meetingDir);
    await settle(queue);

    // 5–6. Exact-quote candidates are reviewable. One material claim is rejected and
    // the commitment is corrected; only the correction produces an authority effect.
    expect(transcript?.segments.map((segment) => segment.speaker)).toEqual(["me", "them"]);
    const candidates = conversationEvidence?.normalizedFacts
      .conversation_claim_candidates as ConversationClaimCandidate[];
    const risk = candidates.find((candidate) => candidate.kind === "risk");
    const commitment = candidates.find((candidate) => candidate.kind === "commitment");
    if (!risk || !commitment || commitment.normalizedValue.kind !== "commitment") {
      throw new Error("golden fixture did not produce its risk and commitment candidates");
    }
    let review = createConversationReviewBatch({
      relationshipId: counterparty.relationshipId,
      observationId: "observation-meeting-golden",
      baselineSnapshotId: "snapshot-7",
      baselineVersion: 7,
      baselineState: { risks: [], next_action: null },
      extractorVersion: "conversation-deterministic-v1",
      candidates: [risk, commitment],
      createdAt: "2026-07-31T12:03:00.000Z",
    });
    const rejected = decideConversationReviewItem({
      batch: review,
      itemId: review.items[0].itemId,
      kind: "reject",
      actorId: "user-1",
      reason: "Budget was discussed, but it is not an account risk.",
      currentVersion: 7,
      currentState: { risks: [], next_action: null },
      decidedAt: "2026-07-31T12:04:00.000Z",
    });
    expect(rejected.authorityEffect).toEqual({ type: "none" });
    review = rejected.batch;
    const correctedValue = {
      ...commitment.normalizedValue,
      action: "Send the corrected proposal tomorrow",
    };
    const corrected = decideConversationReviewItem({
      batch: review,
      itemId: review.items[1].itemId,
      kind: "correct",
      actorId: "user-1",
      replacementValue: correctedValue,
      currentVersion: 7,
      currentState: { risks: [], next_action: null },
      decidedAt: "2026-07-31T12:05:00.000Z",
    });
    expect(corrected.authorityEffect).toEqual({
      type: "commitment_event",
      value: correctedValue,
    });

    const approvedCommitment: LedgerCommitment = {
      id: "meeting-golden:0-1000",
      owner: "me",
      text: correctedValue.action,
      status: "open",
      confirmed_at: "2026-07-31T12:05:00.000Z",
      session_id: "meeting-golden",
      evidence: commitment.evidence[0].exactQuote,
      start_ms: commitment.evidence[0].startMs,
      end_ms: commitment.evidence[0].endMs,
      due_phrase: correctedValue.duePhrase,
    };
    const approvedEvidence = confirmedCommitmentObservation({
      commitment: approvedCommitment,
      counterparty,
    });
    expect(approvedEvidence.assertions).toEqual([
      expect.objectContaining({
        dimension: "next_action",
        value: "Send the corrected proposal tomorrow",
        sourceType: "source_fact",
      }),
    ]);

    // 7. The local outbox keeps both the source transcript and approved authority event
    // while offline, then returns the canonical state confirmation without replay loss.
    const outboxFile = path.join(root, "relationship-evidence-outbox.json");
    let online = false;
    const sharedSnapshots: RelationshipObservationInput[] = [];
    const outbox = new RelationshipEvidenceOutbox(outboxFile, async (items) => {
      if (!online) throw new Error("offline");
      sharedSnapshots.push(...structuredClone(items));
      return {
        results: items.map(
          (item, index): RelationshipObservationIngestResult => ({
            observation: {
              id: `observation-${index + 1}`,
              source: item.source,
              sourceAccountId: item.sourceAccountId,
              externalId: item.externalId,
              sourceVersion: item.sourceVersion,
              eventType: item.eventType,
              occurredAt: item.occurredAt,
              receivedAt: item.receivedAt || item.occurredAt,
              summary: item.summary,
              normalizedFacts: item.normalizedFacts,
              contentHash: `sha256:observation-${index + 1}`,
            },
            relationship: {
              id: counterparty.relationshipId,
              kind: "company",
              displayName: "Acme",
              status: "active",
              lifecycle: "renewal",
              engagement: "active",
              sentiment: "unknown",
              health: "unknown",
              nextAction: correctedValue.action,
              stateVersion: 8 + index,
              stateHash: `sha256:state-${8 + index}`,
              projectorVersion: 2,
              risks: [],
              milestones: [],
            },
            duplicate: false,
          }),
        ),
      };
    });
    await outbox.enqueue(conversationEvidence!);
    await outbox.enqueue(approvedEvidence);
    expect(await outbox.flush()).toMatchObject({ sent: 0, pending: 2, error: "offline" });
    online = true;
    const flush = await outbox.flush();
    expect(flush).toMatchObject({ sent: 2, pending: 0 });
    expect(flush.confirmations?.at(-1)).toMatchObject({
      relationshipId: counterparty.relationshipId,
      stateVersion: 9,
      stateHash: "sha256:state-9",
    });

    // 8. Both clients consume the same validated server projection, not locally
    // reinterpreted transcript state.
    const canonical = RelationshipSchema.parse({
      id: counterparty.relationshipId,
      kind: "company",
      displayName: "Acme",
      status: "active",
      lifecycle: "renewal",
      engagement: "active",
      sentiment: "unknown",
      health: "unknown",
      nextAction: correctedValue.action,
      stateVersion: 9,
      stateHash: "sha256:state-9",
      projectorVersion: 2,
      risks: [],
      milestones: [],
    });
    const webState = RelationshipSchema.parse(structuredClone(canonical));
    const desktopState = RelationshipSchema.parse(structuredClone(canonical));
    expect(desktopState).toEqual(webState);

    // 9. The local compiler may propose a recap, but the promoted extraction cannot
    // execute it. It crosses the server boundary as reviewed evidence so RFC 038's
    // governed action workflow owns policy, revision, approval, and execution.
    expect(conversationEvidence?.normalizedFacts.action_pack).toEqual([]);
    expect(conversationEvidence?.normalizedFacts.legacy_shadow_action_pack).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionType: "meeting_recap", channel: "email" }),
      ]),
    );

    // 10. Retention deleted both audio tracks before publication and the callback saw
    // that exact fact. Deleting the remaining local artifact does not erase the shared,
    // reviewed snapshot or turn its governance receipt back into a weaker claim.
    expect(publishedMeta?.audio_deleted_at).toBeTruthy();
    expect(await fs.stat(path.join(meetingDir, "mic.wav")).catch(() => null)).toBeNull();
    expect(await fs.stat(path.join(meetingDir, "system.wav")).catch(() => null)).toBeNull();
    expect(
      (conversationEvidence?.normalizedFacts.governance_receipt as { deletionOutcome: string })
        .deletionOutcome,
    ).toMatch(/^deleted:/);
    expect((await readMeta(meetingDir))?.audio_deleted_at).toBe(publishedMeta?.audio_deleted_at);
    await fs.rm(meetingDir, { recursive: true, force: true });
    expect(sharedSnapshots).toHaveLength(2);
    expect(
      (sharedSnapshots[0].normalizedFacts.governance_receipt as { deletionOutcome: string })
        .deletionOutcome,
    ).toMatch(/^deleted:/);
  });
});
