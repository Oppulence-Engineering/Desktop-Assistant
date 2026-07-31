# Transcription Routing and Relationship Loop — Implementation Record

**Date:** 2026-07-31

**Branch:** `feat/transcription-routing-and-relationship-loop`
**Baseline:** `develop` at `fc203dd1`

## Outcome

The desktop now has one effective data-routing receipt for dictation, voice memos,
meeting transcription, transcript enrichment, and optional relationship-evidence sync.
Cloud processing is allowed when the user selects the corresponding cloud option;
local-only remains a hard override for speech audio.

Finished native and renderer-fallback 1:1 transcripts can also become immutable shared
relationship observations after the user explicitly enables **Sync meeting evidence**.
A human-confirmed meeting commitment remains durable in the local ledger first, then
enters the same retryable outbox. The backend promotes it into a shared commitment and,
when the promise belongs to the user, a provenance-backed `next_action` plus an
idempotent, approval-pending email follow-up draft.

## Implemented behavior

### One routing model

- Main resolves configured and effective providers, local-only overrides, native versus
  renderer capture, Whisper versus Parakeet, language-model enrichment location, and
  relationship-sync location.
- Transcription and Privacy settings render that shared result rather than independent
  static claims.
- Selected cloud speech routes say that microphone/system audio is sent to Deepgram.
- Native two-track capture shows its actual on-device engine and treats the saved cloud
  selection only as a renderer-fallback preference.
- Transcript-text enrichment and shared relationship evidence are disclosed separately
  from speech-audio routing.
- OpenAI-compatible endpoints are described as on-device only for loopback hosts;
  malformed endpoints remain unknown.

### Unified voice memos

- Voice memos use the same provider resolver and capture/transcription hook as
  push-to-talk.
- They support selected Oppulence/Deepgram cloud routes and local Whisper.
- Local-only can force the effective route to Whisper or make the feature unavailable
  when no local engine exists.
- The legacy direct Nova-2 upload and direct-key-only gate were removed.
- Raw voice-memo audio is no longer written to disk.
- Notes record provider, processing location, audio-upload status, and raw-audio
  retention.

### Honest meeting attribution

- The unreachable local-diarization toggle was removed from the user-facing settings.
- Renderer-local provenance now records diarization as off.
- Local/native speaker labels are described as channel attribution (`You` / `Other`),
  not voice diarization.
- Cloud renderer meetings continue to disclose Deepgram provider labels.

### Relationship evidence and commitments

- **Sync meeting evidence** is off by default and is the explicit transcript-text cloud
  consent surface.
- Native and renderer-fallback 1:1 transcripts receive stable source identities and are
  compiled into bounded, source-linked `meeting_transcribed` observations.
- The payload includes transcript segments, stable session identity, provider/model,
  track health, and truncation status. Local files remain the complete source artifact;
  device-only filesystem paths are not included in shared evidence.
- Publication first enters a local JSON outbox. Network/auth failures retain the item
  with attempt metadata; later launch/config refresh retries it.
- The outbox deduplicates stable evidence identities and drains in API-sized batches.
- Only a confidently resolved 1:1 counterparty is auto-bound. Group meetings and missing
  calendar identity decline rather than create a guessed relationship.
- A confirmed commitment becomes a `commitment_confirmed` observation containing the
  exact quote, transcript span, session, note, direction, and confirmation fact.
- The backend creates the shared commitment exactly once under observation replay.
- A promise by the user emits a `source_fact` assertion for `next_action`; a promise by
  the counterparty is tracked without pretending it is the user's task.
- When the relationship has a recipient email, a promise by the user also creates one
  `meeting_follow_up` action in the governed queue. It cites the immutable meeting
  observation, starts with approval and execution pending, and cannot send until the
  existing review/policy path approves it.
- Existing relationship timelines, relationship details, and state diffs immediately
  render the shared observation, commitment, projected next action, and reviewable
  follow-up instead of a desktop-only shadow model.

### Audit hardening

- A malformed relationship-evidence outbox is now treated as corruption instead of an
  empty queue. Enqueue refuses to overwrite the unread data, and newly written outboxes
  are restricted to the current user.
- Outbox retries re-read durable consent on every drain and also initialize on
  renderer-only launches, so a restart cannot strand consented evidence behind stale
  in-memory state.
- Local meeting automation and shared relationship publication are isolated observers;
  either may fail without suppressing the other.
- Confirmed commitments and generated follow-up actions now link to a bounded
  `RevenueEvidence` record backed by the immutable relationship observation.
- Follow-up recipients prefer the resolved meeting attendee over a stale
  relationship-level primary email.
- Shared meeting evidence omits local Markdown paths, which can expose a username or
  workspace structure without adding web-resolvable provenance.
- The native helper requests its own microphone permission for standalone and packaged
  execution. It validates the physical input format before requesting permission or
  installing a tap, so a Mac with no input device neither waits on an irrelevant prompt
  nor raises an uncaught Core Audio format exception; it degrades to system-only
  capture.

## Effective data-flow contract

| Stage                        | Default / control                                        | What may leave the device                                                  |
| ---------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| Dictation and voice memo STT | Effective voice provider; local-only overrides cloud     | Audio only when a cloud speech provider is selected                        |
| Renderer meeting STT         | Effective meeting provider; local-only overrides cloud   | Mic/system audio only when cloud meeting transcription is selected         |
| Native meeting STT           | On-device Whisper or Parakeet                            | No meeting audio                                                           |
| Summary/commitment/Q&A model | Configured meeting-notes model                           | Transcript text when that model endpoint is remote                         |
| Relationship evidence        | **Sync meeting evidence**, off by default                | Bounded 1:1 transcript text and confirmed-commitment evidence when enabled |
| External actions             | Existing relationship recommendation and approval policy | Nothing is sent or written externally without the existing approval path   |

## Deliberate limits

- Automatic relationship binding is limited to resolved 1:1 calendar meetings.
- Renderer fallback has text evidence but no retained timed audio; its shared segments
  therefore do not claim playable timestamps.
- Group-call diarization, language policy, evidence-clip retention, imported-transcript
  normalization, re-transcription-safe user blocks, commitment due-date resolution, and
  cross-channel outcome reconciliation remain follow-on work.
- Automatic overdue detection is not added here. The immediate action pack is deliberately
  narrow: one deterministic email draft for a confirmed promise by the user. Slack,
  calendar, CRM-field, task-provider, and multi-action packs remain follow-on work.
- The implementation publishes the transcript as immutable evidence and projects only
  the explicit confirmed-commitment assertion. It does not yet auto-project arbitrary
  model-inferred risks, sentiment, lifecycle, or stakeholder changes.
- OS-level microphone/system-audio capture and packaged sidecar behavior require the
  hardware signal-verification runbook in `apps/x/MEETING_CAPTURE.md`; automated tests
  cannot substitute for level assertions on both tracks.

## Verification

Completed on this branch:

- `cd apps/x && pnpm install --frozen-lockfile`
- `cd apps/x && pnpm run check:types`
  - shared, core, preload, renderer production build, and bundled main process passed.
- `cd apps/x && pnpm lint`
- `cd apps/x && pnpm security:electron`
  - Electron security configuration check passed.
- `cd apps/x/packages/core && pnpm test`
  - 89 test files passed, 4 skipped.
  - 697 tests passed, 4 skipped.
- `cd apps/x/vendor/audiocap && ./build.sh && swift test`
  - The release helper built for arm64.
  - 16 tests passed.
- `./out/oppulence-audiocap doctor --json`
  - Microphone permission is granted.
  - The test Mac reports no usable default input device, matching System Settings'
    **No audio input devices found** result; microphone signal cannot be asserted on
    this hardware.
- Packaged-identity system-audio signal and crash recovery
  - The exact release helper was placed in a temporary signed app wrapper containing
    the shipped `NSAudioCaptureUsageDescription`, then granted **System Audio Recording
    Only** access.
  - Spoken system output produced a peak of 28,780 with 247,107 nonzero PCM samples.
  - Hard termination left 691,530 bytes of PCM behind with an intentionally unfinished
    WAV header. Core's `recoverWavHeader` repaired it to a playable 21.61-second file.
  - macOS TCC logs confirmed the wrapper's bundle identity was the responsible client.
    A direct terminal launch was correctly treated as inconclusive after TCC attributed
    it to Warp and returned timed zero samples.
- `cd apps/rowboat-api && go test ./internal/revenue`
  - relationship ingestion, projection, shared commitments, and idempotent replay passed.
- `git diff --check`

Focused additions cover:

- explicit cloud versus local routing;
- local-only overrides;
- native capture overriding an unused cloud meeting preference;
- transcript enrichment versus relationship-sync text egress;
- loopback endpoint classification;
- outbox deduplication, retry, and batching;
- corrupt-outbox preservation;
- meeting-evidence provenance and identity;
- confirmed commitment direction and next-action projection;
- backend commitment, source evidence, attendee recipient selection, and
  approval-pending follow-up creation exactly once under replay.
