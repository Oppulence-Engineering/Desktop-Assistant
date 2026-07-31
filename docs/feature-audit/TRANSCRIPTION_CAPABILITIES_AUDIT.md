# Desktop Transcription Capabilities Audit

**Audit date:** 2026-07-31

**Audit branch:** `audit/transcription-capabilities`

**Implementation branch:** `feat/transcription-routing-and-relationship-loop`

**Baseline:** `develop` at `fc203dd1`
**Surface:** Oppulence Desktop (`apps/x`)

> This document preserves the baseline findings. Findings 1–4 and 7 were addressed;
> findings 5 and 8 received the shared-commitment and native/renderer 1:1 evidence
> foundations, while overdue/outcome reconciliation and imported/group evidence remain.
> The shipped behavior, remaining limits, and verification evidence are recorded in
> [`TRANSCRIPTION_IMPLEMENTATION.md`](./TRANSCRIPTION_IMPLEMENTATION.md).

## Executive assessment

Oppulence Desktop has a notably strong transcription substrate:

- local push-to-talk dictation with a cloud alternative;
- bot-free meeting capture;
- native, crash-resilient, two-track recording on macOS 14.2+;
- a cross-platform renderer fallback;
- local Whisper and Parakeet transcription;
- timestamped transcript artifacts in an inspectable Markdown vault;
- live transcript Q&A;
- post-meeting summaries and human-confirmed commitment proposals;
- imports from Fireflies and Granola.

The native meeting pipeline is the strongest part of the product. Separate microphone
and system tracks improve quality, preserve cross-talk, provide honest `You` / `Other`
attribution, survive a closed renderer or process crash, and can be re-transcribed when
audio retention is enabled.

The main product gap is not speech-to-text quality. It is that transcription is not yet
consistently connected to the mission in the root README:

> Model the relationship directly. Treat every integration as an observer, link every
> material claim to evidence, and recommend the next action without hiding how the
> system reached its conclusion.

Today, a meeting usually becomes a local note, a local event, and sometimes a local
commitment record. It does not yet reliably become provenance-bearing relationship
observations and assertions shared with the web app. Confirmed commitments do not yet
drive the portfolio attention queue, follow-up detection, or an approval-gated action
loop. Several older transcription surfaces also bypass the newer provider, privacy, and
provenance architecture.

The recommended product sequence is:

1. Repair the trust and control inconsistencies identified below.
2. Project transcript evidence into shared relationship state.
3. Close the commitment and approval loop across email, Slack, calendar, tasks, and CRM.
4. Add live relationship intelligence after the evidence and correction model is sound.

## Audit method

This was a code-level behavioral audit. Renderer controls were traced through typed IPC,
main-process ownership, core processing, persistence, and downstream artifacts. RFCs
were used to explain intent, but a capability is classified as shipped only when a
user-reachable path exists in current code.

No microphone, system-audio, packaging, or model inference test was run during this
audit. The worktree did not have `apps/x/node_modules`, and OS permission behavior needs
the manual signal-verification runbook in `apps/x/MEETING_CAPTURE.md`. Findings below
therefore distinguish code-backed behavior from runtime verification.

## Mission rubric

The root README defines a useful standard for judging transcription:

| Mission requirement | What a transcription capability must do                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| Observe             | Preserve the meeting, speaker, timestamp, source, and capture health as evidence.    |
| Assert              | Extract material claims with provenance, confidence, and explicit inference status.  |
| Project             | Update canonical relationship state deterministically, not just write a summary.     |
| Explain             | Let a user trace a risk, commitment, decision, or recommendation to the exact words. |
| Recommend           | Turn the relationship change into a concrete, safe next action.                      |
| Approve and act     | Require review before external writes, then execute idempotently.                    |
| Learn               | Reconcile replies, edits, decisions, and outcomes back into relationship history.    |
| Correct             | Let user corrections outrank transcription or model inference everywhere downstream. |

The current desktop is strongest at **Observe** and local **Explain**. It is partial at
**Assert**, and weakly connected to **Project → Recommend → Approve → Act → Learn**.

## Current capability inventory

### Voice and dictation

| Capability                  | Status                                               | Current behavior                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Push-to-talk chat dictation | Shipped                                              | Captures 16 kHz microphone PCM. Cloud Deepgram provides live partials; local Whisper transcribes after stop. Enter submits and Escape cancels.                                          |
| Provider choice             | Shipped                                              | Voice input can resolve to Solomon-proxied Deepgram, direct Deepgram BYOK, local Whisper, or unavailable.                                                                               |
| Local-only switch           | Shipped for the unified voice/meeting renderer paths | Provider resolution forbids cloud and closes an active cloud socket when local-only is enabled.                                                                                         |
| Model management            | Shipped                                              | Model list, download progress, integrity verification, repair, removal, device capability, benchmark, and a local microphone diagnostic.                                                |
| Voice memo notes            | Shipped, legacy path                                 | Records a compressed browser audio blob, saves the raw file, sends it directly to Deepgram Nova-2, and writes a Markdown note. Requires a direct Deepgram key.                          |
| Voice commands              | Dormant / partial                                    | Parsing and confirmation components exist, but no renderer uses the command-mode hook. Meeting/text/app intents are rejected by the executor and the email adapter deliberately throws. |

### Meeting discovery and control

| Capability                 | Status                           | Current behavior                                                                                                                                              |
| -------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upcoming calendar meetings | Shipped                          | Meetings view shows near-term Google Calendar events, details, join links, and `Join & Notes` / `Take notes only` controls.                                   |
| Manual start/stop          | Shipped                          | Available from the Meetings view and native tray/indicator surfaces.                                                                                          |
| Start notification         | Shipped for native-capable macOS | Default policy asks at meeting start; users can choose always start or do nothing. Automatic starts still notify.                                             |
| Pre-meeting health warning | Shipped for native-capable macOS | Checks known capture permission/device failures, disk space, and selected fast-model readiness shortly before a linked calendar meeting. Silent when healthy. |
| Standby pre-roll           | Shipped, opt-in, native macOS    | Holds up to five minutes of audio in memory before a calendar meeting and writes nothing until promoted to recording.                                         |
| Silence auto-stop          | Shipped                          | Native capture watches track levels; renderer capture watches transcript activity. Both stop after about two minutes of silence.                              |

### Capture, transcription, and recovery

| Capability                     | Status                                                                         | Current behavior                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Native two-track capture       | Shipped on macOS 14.2+ when the sidecar is packaged                            | A Swift sidecar records microphone and system audio to separate 16 kHz mono WAV files. Recording survives window closure.            |
| Renderer fallback              | Shipped on Windows, Linux, older macOS, and when native capture is unavailable | WebAudio captures microphone plus `getDisplayMedia` system audio. It is window-dependent and can degrade to microphone-only.         |
| Local Whisper                  | Shipped                                                                        | Bundled `whisper-cli`, downloadable verified models, VAD, batch dictation, and streaming meeting support.                            |
| Local Parakeet                 | Shipped for native meetings, opt-in                                            | Faster Core ML transcription with a one-time model download. Empty results on signaled audio fall back to Whisper.                   |
| Cloud Deepgram                 | Shipped on renderer meeting/dictation paths                                    | Solomon-authenticated or direct-BYOK WebSocket streaming with live partials and cloud diarization.                                   |
| Filesystem transcription queue | Shipped for native capture                                                     | A finished session with `meta.json` and no `transcript.json` is pending work; jobs serialize and resume at launch.                   |
| Crash recovery                 | Shipped for native capture                                                     | WAV headers are repaired, orphaned track directories get reconstructed metadata, and failed jobs retain audio.                       |
| Re-transcription               | Shipped when audio remains                                                     | Users can re-run transcription after changing models.                                                                                |
| Retention and deletion         | Shipped for native meetings                                                    | Default deletes audio after a transcript exists; optional retention compresses it to AAC. Per-session and delete-all controls exist. |

### Transcript artifacts and intelligence

| Capability               | Status                                      | Current behavior                                                                                                                                                      |
| ------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable local artifact   | Shipped                                     | Native sessions write `meta.json`, canonical timed `transcript.json`, readable `transcript.md`, a log, and an Obsidian-compatible meeting note.                       |
| Provenance frontmatter   | Shipped, with exceptions below              | Notes record transcription/capture provider, model, upload status, attribution method, session id, and capture completeness.                                          |
| Timed transcript block   | Shipped for native meeting notes            | The editor renders speaker turns and timestamps; retained audio can be played from a transcript line.                                                                 |
| 1:1 counterparty naming  | Shipped for native calendar-linked meetings | The calendar and local people index replace `Other` with a name only when there is exactly one credible counterparty. Group calls remain honestly unattributed.       |
| Summary                  | Shipped                                     | A configured language model produces notes above the preserved transcript block after transcription.                                                                  |
| Live transcript          | Shipped, opt-in, native meetings            | A second rough local pass reads appended WAV data every 20 seconds; the final artifact is re-transcribed cleanly.                                                     |
| Ask the live meeting     | Shipped when live transcript is enabled     | Questions are answered from the bounded live transcript using the configured meeting-notes model and an untrusted-content guard.                                      |
| Commitment proposals     | Shipped for native meetings                 | A model proposes commitments only after a keyword prefilter. Proposals require an exact transcript quote and user confirmation.                                       |
| Commitment ledger        | Partial                                     | Confirmation writes a local JSON ledger with evidence span. No shipped ledger UI, relationship-state sync, overdue detection, or follow-through workflow consumes it. |
| Meeting event automation | Shipped locally                             | `meeting.transcribed` enters the local event bus, enabling user-authored background tasks such as drafting a follow-up.                                               |
| Fireflies import         | Shipped                                     | Periodic OAuth/MCP transcript sync writes meeting notes to the vault.                                                                                                 |
| Granola import           | Shipped, opt-in                             | Periodic import of recent Granola documents writes Markdown notes to the vault.                                                                                       |

## Priority findings

### P0 — Trust and control

#### 1. The Privacy page makes unconditional local-only claims that are false for shipped paths

The page says meeting audio is “Never uploaded anywhere” and all transcription runs
on-device (`privacy-settings.tsx:50-70`). The renderer meeting path can stream both
microphone and system PCM to Solomon/Deepgram (`useMeetingTranscription.ts:333-368`,
`410-428`, `519-560`). The voice-memo path also posts the entire audio blob directly to
Deepgram (`sidebar-content.tsx:1209-1230`).

This is the highest-priority issue because Oppulence explicitly differentiates on
evidence, control, and ownership. Privacy copy must be derived from the resolved path,
not written as a platform-wide constant.

**Recommendation:** Show a route-specific data-flow receipt: capture engine,
transcription provider, whether audio leaves the device, whether transcript text is sent
to a model for summary/commitments/Q&A, retention, and deletion scope.

#### 2. The meeting provider control is split-brain on native-capable Macs

Settings present Cloud Deepgram and On-device as the provider for recorded meetings
(`transcription-settings.tsx:673-710`). At start, the native branch returns before
`meetingProvider` is read and always reports local transcription
(`useMeetingTranscription.ts:292-336`). The main-process native controller instead uses
the separate `meetings.transcriptionEngine` setting to choose Whisper or Parakeet
(`meeting-controller.ts:915-950`).

Users can therefore choose Cloud in the visible meeting-provider control while native
meetings continue locally. The outcome is privacy-positive, but the control is not
truthful and makes support, analytics, and provenance harder to reason about.

**Recommendation:** Resolve one effective meeting route and render that route. If native
capture intentionally mandates local STT, say so and hide/disable the cloud provider
choice while native capture is effective.

#### 3. Local diarization is represented as active without a production execution path

The reachable setting promises anonymous on-device speaker labels
(`transcription-settings.tsx:694-710`). The renderer writes frontmatter claiming local
beta diarization when the flag is enabled (`useMeetingTranscription.ts:353-369`), but
the production meeting path never constructs or calls `Diarizer`. Current uses of the
diarizer are confined to tests and the fixture runner. Local streaming still attributes
only by microphone/system channel.

That is more serious than an unfinished beta: it can create false provenance about how
speaker labels were produced.

**Recommendation:** Remove or hard-disable the toggle and local-diarization provenance
until the PCM → embedding → clustering → alignment → correction-patch path is wired and
runtime-verified.

### P1 — Mission loop gaps

#### 4. Voice memos bypass the unified transcription and privacy architecture

Voice memos are visible only with a direct Deepgram key, use Nova-2 rather than the
configured provider/model, ignore local-only mode, retain raw audio without the meeting
retention controls, and do not write the richer provenance used by meetings
(`sidebar-content.tsx:1209-1430`).

**Recommendation:** Treat dictation, voice memos, file transcription, and meetings as
modes of one capture/transcription service. The same resolved provider, local-only gate,
language, provenance, retention, diagnostics, and model manager should apply.

#### 5. Confirmed commitments stop before the relationship-intelligence product begins

The ledger explicitly stays in local `commitments.json`; the code notes that no API
write path exists (`commitment-ledger.ts:8-28`). IPC can read and update the ledger, but
the renderer only displays pending proposals. A confirmed item disappears from that
surface. It does not update shared relationship state, appear in Account Mission
Control, become an attention signal when overdue, recommend a chase, or learn from an
email/Slack/CRM outcome.

**Recommendation:** Make confirmation emit a provenance-bearing shared assertion and
commitment record. Reconcile downstream evidence against it and route proposed external
actions through the existing approval model.

#### 6. Default retention removes the audio before the commitment review can use it

The commitment UI says playback makes confirmation auditable, but also acknowledges
audio has “usually” already been deleted (`meeting-commitments.tsx:5-16`, `89-100`).
The queue writes proposals and then immediately applies the default
`untilTranscribed` retention (`queue.ts:137-156`).

The quote remains textually verifiable, but “hear this” and the ledger comment’s promise
of getting back to the words are not normally available.

**Recommendation:** Keep only bounded evidence clips for pending/confirmed commitments,
with an explicit retention policy, or delay full-audio deletion until proposals are
reviewed. A small encrypted clip is a better evidence/cost trade than keeping the whole
meeting.

#### 7. Transcript text egress is only partially disclosed

The local audio path is honest about audio staying on-device, and the Privacy page says
summaries may use a cloud model. But native meetings automatically summarize and, by
default, attempt commitment extraction; live Q&A also sends bounded transcript text to
the configured model. The commitment setting explains confirmation semantics, not model
routing.

**Recommendation:** Separate and display three decisions: audio routing, transcript-text
routing, and external action routing. Local audio does not imply a local transcript
workflow once model-backed enrichment begins.

#### 8. Meeting evidence is local automation input, not yet canonical relationship evidence

The finished meeting publishes a bounded Markdown payload to the local event bus
(`events.ts:8-63`). That is useful for local background tasks, but it does not implement
the README’s Observe → Assert → Project contract in the shared relationship engine.
Fireflies and Granola similarly land as vault notes rather than normalized,
deduplicated relationship observations.

**Recommendation:** Give every native or imported transcript a stable source identity,
normalize it into immutable observations, and project only reviewed/deterministic claims
into canonical relationship state.

### P2 — Quality and product completeness

#### 9. Group-meeting speaker attribution remains a channel bucket

Native capture can name the other side only for a calendar-linked 1:1. Every remote
participant in a group call is `Other`. This is an honest limitation and better than a
wrong name, but it limits commitments, objections, and participant history—the exact
facts relationship intelligence needs.

**Recommendation:** Ship correction-first, meeting-scoped diarization before persistent
speaker identity. Let the user map `Speaker 1` to an attendee, store the correction as
evidence, and reuse it only under explicit policy.

#### 10. Language support is technically present but not coherently user-controlled

Whisper config contains `language`, but the settings UI exposes models rather than
language. The runner defaults to English when no language is passed
(`transcription.ts:183-196`, `runner.ts:86-104`), and the native meeting queue does not
supply a language resolver. Cloud dictation is also hard-coded to English. Parakeet v3
is described as multilingual, but there is no unified auto-detect or per-meeting
language policy.

**Recommendation:** Add Auto plus explicit language, record detected language and
confidence in provenance, and maintain the original transcript when translation is
requested.

#### 11. Re-transcription can replace user-authored content

The native queue rewrites the meeting note from the canonical transcript before it
summarizes it again (`meeting-controller.ts:833-865`). The summary merge then
reconstructs the body from the title, emitted notices, new summary, and transcript block
(`meetings.ts:539-588`). Any manual content between the title and transcript can
therefore be discarded when a retained recording is re-transcribed.

**Recommendation:** Store generated sections in a delimited/generated block and update
only that block. User-authored text must survive re-transcription.

#### 12. Voice commands are implementation inventory, not a product capability

The parser recognizes email, meeting, insertion, and app commands, but the command-mode
hook has no consumer. The executor rejects meeting/text/app intents, while the supplied
email adapter throws “wired in the … adapter task” errors (`executor.ts:18-44`,
`ipc.ts:689-704`).

**Recommendation:** Keep this out of product claims until one end-to-end surface is
shipped. When it is, reuse the same approval and evidence model as relationship actions.

## Ten differentiated transcription-adjacent capabilities

These ideas are ordered by mission leverage, not novelty alone.

### 1. Spoken Evidence Compiler

Turn a finished transcript into immutable, source-linked observations and
provenance-bearing candidate assertions: decision, risk, objection, milestone,
sentiment change, lifecycle change, stakeholder change, and commitment. Every candidate
contains the exact quote, speaker/attendee resolution, timestamp, confidence, extraction
method, and capture-health caveats.

**Differentiation:** Most meeting tools stop at prose summaries. Oppulence would make
spoken evidence a first-class input to a durable relationship model.

### 2. Commitment Closure Loop

After a user confirms a spoken commitment, watch email, Slack, CRM, tasks, and later
meetings for fulfillment or renegotiation. Before the due phrase slips, recommend the
safest next action; after approval, send or write it idempotently. Record the response
and outcome against the original evidence.

**Differentiation:** Notetakers sell recall. Oppulence would sell provable follow-through.

### 3. Evidence-Backed Post-Meeting Action Pack

Generate a review queue containing a follow-up email, Slack recap, CRM field changes,
tasks, and calendar holds. Each proposed sentence or field change links to the transcript
span that supports it. Users can approve, edit, or reject each action independently.

**Differentiation:** This connects transcription to the README’s
Recommend → Approve → Act contract without hiding model reasoning.

### 4. Relationship Delta View

Show a before/after diff of the relationship model after every meeting:

- what changed;
- what stayed uncertain;
- which exact words support each change;
- which prior claim was contradicted;
- which user correction or higher-priority source won.

**Differentiation:** A meeting summary explains the call. A relationship delta explains
why the account now needs different action.

### 5. Account-Aware Live Cue Cards

During a meeting, surface only high-value, evidence-backed cues: an overdue promise,
an unresolved objection, a renewal date, a contradiction with the last call, a missing
next step, or a stakeholder who has gone quiet. A cue opens the prior source and never
acts externally.

**Differentiation:** The live assistant is grounded in the long-lived relationship, not
only the last 20 minutes of transcript.

### 6. Correction-First Transcript Review

Prioritize low-confidence words, uncertain speaker turns, possible account/person
mentions, and capture gaps. Let the user play the span, correct text/speaker/entity once,
and promote that correction above future inference. Re-project affected relationship
claims deterministically.

**Differentiation:** Corrections become durable model governance, not edits trapped in a
meeting note.

### 7. Participant Resolution and Meeting-Scoped Speaker Memory

Combine calendar attendees, CRM/contact identity, explicit user labels, and local
speaker clustering. Start with anonymous speakers, ask the user only where attribution
changes a material claim, and retain any voice representation only with explicit policy.

**Differentiation:** Oppulence can connect “who said it” to relationship roles while
declining to guess when evidence is insufficient.

### 8. Universal Transcript Evidence Inbox

Ingest Oppulence recordings, uploaded audio, Fireflies, Granola, Zoom, Teams, Fathom,
and CRM call recordings into one canonical envelope. Deduplicate by calendar event,
participants, time, and content fingerprint; preserve original sources; report stale or
failed connectors.

**Differentiation:** Users can keep existing notetakers while Oppulence owns the
relationship evidence layer rather than forcing a capture migration.

### 9. Consent and Governance Receipt

Apply workspace/account/region policies before capture: prompt requirements, excluded
calendars, retention, local/cloud routing, participant disclosure, and legal hold. Write
an auditable receipt beside the transcript recording which policy applied and what was
deleted when.

**Differentiation:** This makes bot-free local capture deployable for privilege- and
compliance-sensitive teams, not merely private by architecture.

### 10. Conversation-to-Outcome Learning

Connect transcript assertions and approved follow-ups to outcomes: reply, next meeting,
deal movement, onboarding completion, renewal, escalation, churn, or user correction.
Measure which evidence and recommendations were useful, while keeping the deterministic
relationship state distinct from learned ranking.

**Differentiation:** The system improves from relationship outcomes rather than merely
accumulating more summaries.

## Suggested product cut

The smallest coherent differentiated release is not another transcription model. It is:

1. truthful route-specific privacy/provenance;
2. one canonical transcription service for dictation, voice memos, files, and meetings;
3. Spoken Evidence Compiler into shared relationship observations;
4. user-confirmed commitments synchronized to the shared relationship model;
5. an evidence-backed post-meeting action review.

That cut would turn the current excellent capture engine into the product described by
the root README: a relationship system that can say what changed, show why, recommend
what to do, wait for approval, and learn what happened next.
