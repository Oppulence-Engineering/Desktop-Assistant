# RFC 035: Meeting Intelligence — Bot-Free Parity Plus the Commitment Ledger

|                  |                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RFC**          | 035                                                                                                                                                                                                                                                          |
| **Status**       | Draft                                                                                                                                                                                                                                                        |
| **Track**        | Desktop + product - the meeting-notes surface as both a parity feature and the ledger's spoken-commitment sensor                                                                                                                                             |
| **Owners**       | `apps/x/packages/core/src/voice` (capture, STT, diarization), `apps/x/apps/renderer` (notes UI), `rowboat-api` (commitment ledger writes)                                                                                                                    |
| **Created**      | 2026-07-23                                                                                                                                                                                                                                                   |
| **Last updated** | 2026-07-23                                                                                                                                                                                                                                                   |
| **Depends on**   | [RFC 009](./complete-009-local-on-device-transcription.md), [RFC 017](./complete-017-on-device-meeting-diarization.md), [RFC 030](./complete-030-revenue-memory-outbound-governance.md), [email-013](./email-013-meeting-briefs-and-relationship-context.md) |
| **Related**      | [RFC 032](./032-detection-sensor-integrations.md) (spoken-commitment signal; transcript import), [RFC 034](./034-floating-overlay-assistant.md) (live-transcript tap), [RFC 022](./022-unified-entity-graph.md) (attendee → entity)                          |
| **Supersedes**   | none; composes 009/017/email-013 into one product surface                                                                                                                                                                                                    |

## Main point

Littlebird's meeting notes are their strongest proof of value: **bot-free system-audio capture on every call** ("Zoom, Teams, Google Meet, or any other app — with no bots disrupting your meeting"), automatic summaries and action items, a "Prep for meeting" brief, and live-transcript answers through Hummingbird. We already own the harder half on-device — whisper.cpp transcription (RFC 009, `apps/x/apps/main/src/whisper-utility.ts`) and local diarization (RFC 017, `core/src/voice/diarization`) — which they do not have (their pages do not even mention speaker ID, and their audio goes to cloud). This RFC composes the shipped pieces into the parity surface, then goes past parity where notetakers stop: **every promise spoken in a meeting becomes a tracked commitment in the ledger, and untracked promises become chases.** Notetakers sell recall; we sell follow-through.

## Littlebird reference (parity line by line)

| Their claim                                             | Status on our side                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Bot-free capture from system audio, works on every call | Capture path exists (RFC 009 host process); needs the "every call, automatically" UX       |
| Automatic transcription                                 | Shipped, on-device (stronger: audio never leaves the machine)                              |
| Speaker identification                                  | Shipped on-device (RFC 017) — **they don't claim this at all**                             |
| Summary + action items, editable                        | Build in this RFC (notes pipeline over the transcript)                                     |
| "Prep for meeting" one-click brief                      | Specified in email-013 (calendar + attendees + mail history + relationship context); build |
| Ask the live transcript mid-call                        | Via RFC 034's overlay tapping this RFC's live session                                      |
| "What did X say about the timeline?" later              | RFC 021 semantic recall over stored transcripts                                            |

## Why this RFC exists

Three shipped capabilities (009, 017, 021) and one specified brief (email-013) do not make a product until something owns the surface: auto-detect that a meeting started, capture without being asked, produce the note artifact, and — the part no notetaker does — extract commitments with owners and due phrases, reconcile attendees to ledger entities (RFC 022), and register each commitment as a trackable object whose silence later becomes an RFC 030 detection. RFC 032 already names "spoken commitments" as a first-class slip signal; this RFC is the sensor that produces it from our own capture, complementing 032's import lane (Fathom/Fireflies/Granola) for users who keep their existing notetaker.

## Design

**Capture.** Meeting-start detection from two signals: a calendar event with a conferencing link entering its window, and/or meeting-app audio activity. On detection: a consent-first prompt (or per-calendar auto-capture rule), then system-audio + mic capture into the RFC 009 utility process. No bots join calls; nothing is recorded without an explicit rule or click. Raw audio is deleted after transcription by default.

**Notes pipeline.** Post-meeting (and incrementally during): diarized transcript → structured note (summary, decisions, action items, open questions) rendered as a note in the workspace, editable like any note. The live session exposes a read stream RFC 034 taps.

**Commitment extraction — the differentiator.** A dedicated extraction pass over the diarized transcript yields `(speaker, commitment text, counterparty, due phrase, confidence)`. High-confidence items are shown for one-tap confirmation in the note; confirmed commitments write to the ledger (RFC 030 `Commitment` records) with an evidence snapshot of the transcript span (RFC 031 rules: snapshot the evidence, not the meeting). From that point the standard machinery owns it: a commitment with no follow-through by its due phrase raises a queue item — _"you told Acme revised pricing by Friday; nothing was sent."_

**Prep brief.** email-013's brief (attendees, last threads, open commitments both directions, relationship state) becomes a one-click surface on the calendar event and an automatic pre-meeting notification. Open commitments **from the counterparty** appear too — the brief is also a collections instrument.

**Law-firm posture.** On-device STT + diarization, no bots, no cloud audio, raw-audio deletion, per-calendar consent rules, and per-meeting kill switch. This is the meeting-notes product a privilege-conscious firm can actually run — the direct counter to screen-observing and bot-joining competitors.

## Phases

1. **P1 — the loop closes manually:** manual start/stop capture → diarized transcript → structured note with summary/action items.
2. **P2 — automatic:** meeting-start detection + consent rules; "works on every call" parity reached.
3. **P3 — commitments:** extraction pass, confirmation UX, ledger writes with evidence spans, queue detection wiring.
4. **P4 — briefs + live tap:** email-013 prep brief surfaced; RFC 034 live-transcript integration.

## Decisions

1. **On-device transcription stays the default**; cloud STT remains the RFC 009 quota fallback, never required for the core loop.
2. **No meeting bots, ever.** System-audio capture only — parity with Littlebird's posture and a hard requirement of ours anyway.
3. **Import is a peer, not a rival:** 032's Fathom/Fireflies/Granola import feeds the same commitment pipeline; we do not force capture migration to get ledger value.
4. **Commitments require confirmation** before ledger write at launch; auto-commit graduates only after precision clears the email-016-style eval gate.

## Test plan

- Capture: meeting-start detection precision/recall against a fixture week of calendar + audio-activity traces; consent rules honored in every path (assert no capture without rule/click).
- Pipeline: golden transcripts → stable note structure; diarization-attribution errors never flip a commitment's speaker (eval set with adversarial cross-talk).
- Commitments: precision/recall on a labeled commitment corpus; evidence span in every ledger write resolves back to the exact transcript segment.
- End-to-end: fixture meeting with "we'll send X by Friday" → confirmed commitment → clock passes Friday with no send → queue item raised with transcript evidence.

## Non-goals

- Joining meetings as a bot participant.
- A standalone notetaker business ("the notetaker market is a distribution knife fight" — RFC 032); this surface exists to feed the ledger.
- Cloud storage of raw audio.
- Video capture of any kind.
