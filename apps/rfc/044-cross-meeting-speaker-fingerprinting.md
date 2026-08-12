# RFC 044: Cross-Meeting Speaker Fingerprinting

|                    |                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**            | 044                                                                                                                                                 |
| **Status**         | Draft                                                                                                                                               |
| **Track**          | Meeting intelligence — OpenWhispr parity                                                                                                            |
| **Owners**         | `apps/x` core voice, meetings, relationship graph                                                                                                   |
| **Created**        | 2026-08-12                                                                                                                                          |
| **Depends on**     | [RFC 017](./complete-017-on-device-meeting-diarization.md)                                                                                          |
| **Related**        | [RFC 035](./035-meeting-intelligence-commitment-ledger.md), [RFC 036](./036-relationship-state-engine.md), [RFC 022](./022-unified-entity-graph.md) |
| **Reference impl** | OpenWhispr (MIT) — see §6                                                                                                                           |

## 1. Decision

Promote speaker identity from a per-meeting label to a **persistent voice
fingerprint**. Once a user confirms "Speaker 2 is Dana", every future meeting
recognizes Dana's voice automatically and binds her to the same person in the
entity graph.

## 2. Why this matters more for us than for them

For a dictation product this is a nice transcript-readability feature. For us it
is a **relationship-graph input**. RFC 036 asks "what is the state of this
relationship?" and RFC 035 attributes spoken commitments to people. Both are
materially stronger when speaker turns resolve to a real person identity rather
than to an anonymous per-meeting index.

A confirmed voice fingerprint is also unusually high-quality evidence: it is
first-party, on-device, and does not depend on a calendar invite being accurate.

## 3. What we have

`packages/core/src/voice/diarization/` is well built and already anticipates
this work:

- `embedder.ts` (137) — `SpeakerEmbedder` interface, injected native inference,
  with `EnergyProfileEmbedder` as a deterministic fallback. Its own docstring is
  explicit that the energy-profile embedder is **not a learned speaker model**
  and "must not graduate diarization out of beta on its own".
- `clustering.ts` (219), `alignment.ts`, `metrics.ts`, `provenance.ts`, `diarizer.ts` (257).
- `packages/core/src/meetings/attendees.ts` for roster binding.

So the interface exists. What is missing is a real embedding model plus
persistence across meetings.

## 4. Design

### 4.1 Real embedding model

Install a pyannote-family ONNX speaker encoder through the existing model
manager and wire it as the injected `EmbedInfer`. The energy-profile embedder
stays as the fixture/fallback path.

### 4.2 Voice profile store

A new store keyed by person id holding one or more centroid embeddings per
person, plus enrollment metadata (sample count, last updated, confirmation
source). Multiple centroids per person matter: the same voice over a phone, a
headset, and a conference mic clusters differently.

### 4.3 Re-identification at ingest

During diarization, each cluster centroid is matched against the profile store
by cosine distance with two thresholds:

- Above the high threshold: auto-assign the person.
- Between thresholds: propose the assignment and require confirmation.
- Below: leave anonymous.

Never auto-assign on a single weak match. A misattributed commitment is worse
than an unattributed one, because it enters the relationship graph as a false
claim.

### 4.4 Enrollment and correction

Confirmation comes from the user renaming a speaker in the meeting UI. That
action enrolls the embedding. Corrections must be able to un-enroll and to split
a profile that absorbed two people.

### 4.5 Consent and deletion

Voice fingerprints are biometric data. They stay **on-device**, are never
uploaded, and must be individually deletable. Meeting retention
(`packages/core/src/meetings/retention.ts`) must cover profiles, and deleting a
person deletes their fingerprint.

## 5. Definition of done

- A real ONNX speaker embedder is installed and used, with the energy-profile
  embedder demoted to fallback.
- Confirming a speaker once causes automatic recognition in later meetings.
- Auto-assignment only occurs above the high-confidence threshold; the middle
  band asks.
- Diarization error rate is measured before and after on our fixture set
  (`diarization/fixtures.ts`, `metrics.ts`), and improves.
- Fingerprints never leave the device, are listed in privacy settings, and are
  deletable individually and in bulk.
- Provenance records whether a speaker label came from a fingerprint, a roster
  binding, or a human.

## 6. OpenWhispr code references

| Concern              | File                                     | Lines | Notes                                                                     |
| -------------------- | ---------------------------------------- | ----- | ------------------------------------------------------------------------- |
| Embedding extraction | `src/helpers/speakerEmbeddings.js`       | 160   | Segment selection and embedding computation. Directly relevant to §4.1.   |
| Profile merging      | `src/helpers/speakerMerge.js`            | 110   | Merging clusters into a persistent identity — the heart of §4.2.          |
| Assignment policy    | `src/helpers/speakerAssignmentPolicy.js` | 76    | Threshold policy for auto-assign vs propose. Small and directly portable. |
| Diarization pipeline | `src/helpers/diarization.js`             | 603   | End-to-end orchestration.                                                 |
| Diarization gating   | `src/helpers/diarizationPolicy.js`       | 63    | When diarization is worth running at all.                                 |
| Speaker count        | `src/helpers/speakerCount.js`            | 12    | Cluster-count estimation.                                                 |
| ONNX runtime host    | `src/helpers/onnxWorkerClient.js`        | 248   | Running ONNX off the main thread.                                         |
| Vector storage       | `src/helpers/vectorIndex.js`             | 226   | Local vector search for profile matching.                                 |
| Model download       | `scripts/download-diarization-models.js` | 143   | Fetching and verifying encoder weights.                                   |
| Completion UX        | `src/utils/diarizationCompletion.ts`     | 41    | Progress reporting.                                                       |

MIT-licensed; carry the notice on any adapted file.

## 7. Risks

- **Biometric data raises the compliance stakes.** On-device only, explicit
  consent, and real deletion are hard requirements, not follow-ups.
- Family members and colleagues with similar voices will collide. The
  propose-band and split-profile flows are what keep that recoverable.
- ONNX Runtime has no macOS x86_64 binaries after 1.24, so Intel Macs will not
  get this. State that in the UI rather than failing silently.
