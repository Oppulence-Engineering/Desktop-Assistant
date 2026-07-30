# Meeting Capture — local dual-track recording and transcription

## Product overview

Click record and the app captures **your microphone and everything the Mac plays as two
separate tracks**, straight to disk, then transcribes both on-device and merges them
into one speaker-tagged meeting note. No bot joins the call, no audio leaves the
machine, and the recording survives closing the window.

Two tracks are the design, not an implementation detail:

- **Free two-party attribution.** mic = you, system = them. `me`/`them` with no
  speaker-identification model at all.
- **Better transcripts.** Speech models do measurably better on clean single-source
  audio than on a mix.
- **Cross-talk survives.** The previous in-app pipeline muted your microphone whenever
  system audio was playing, to stop echo — which deleted anything you said over the
  other party. Separate tracks keep both.
- **Re-transcribable.** The audio is a file, so a better model can be applied to a
  meeting that already happened.

### Why a native sidecar

Electron cannot capture macOS system audio reliably. `getDisplayMedia({audio:
"loopback"})` is gated behind a Chromium feature flag on macOS 15+, yields at best one
mixed stream, and runs in the renderer — so the recording dies with the window and no
audio is ever persisted. Core Audio process taps are only reachable from native code.

The in-app pipeline is still there and still needed: Windows, Linux, and macOS below
14.2 use it, and it is the fallback whenever the helper is missing.

## Architecture at a glance

```
tray (apps/main/src/tray.ts) ──┐        ┌── Meetings view (meetings-view.tsx
                               │        │      + meeting-capture-strip.tsx)
                               ▼        ▼
                    MeetingController (apps/main/src/meeting-controller.ts)
                      │  owns the live session; broadcasts every transition
                      │
       ┌──────────────┴───────────────┐
       ▼                              ▼
MeetingCaptureSidecar          MeetingQueue (core/src/meetings/queue.ts)
(apps/main/src/meeting-          │  filesystem is the queue; serial; resumes at launch
  capture.ts)                    │
       │ spawn + NDJSON/stdio     ├─▶ transcribe.ts ─▶ WhisperService (RFC 009)
       ▼                          ├─▶ transcript.json + transcript.md
oppulence-audiocap                ├─▶ note.ts ─▶ knowledge/Meetings/solomon/<date>/*.md
(vendor/audiocap, Swift)          └─▶ retention.ts ─▶ delete audio per keepAudio
       ├── MicRecorder      → mic.wav
       └── SystemTapRecorder → system.wav
                            → meta.json
```

**Two invariants worth keeping:**

1. **The filesystem is the state.** A session directory with `meta.json` and no
   `transcript.json` is pending work. There is no index, no in-memory job list, and
   nothing a crash can forget.
2. **One note formatter.** `formatMeetingNote` lives in `@x/shared/meetings` and both
   capture engines call it, because the note shape is a compatibility surface:
   `meeting:summarize` prepends above the fenced `transcript` block, the editor renders
   that block as a node, and note listing filters on `source: solomon`.

## Technical flows

### Recording

1. The renderer (or the tray) asks main to start. `resolveCaptureEngine` returns
   `native` only on macOS ≥ 14.2 with the helper present, else `renderer`.
2. `ensureMicrophoneAccess()` prompts. The native path never calls `getUserMedia`, so
   nothing else in the app would ever trigger this — without it the first sign of a
   denied microphone is a silent track after the meeting.
3. `createSessionDir` claims `<recordingsDir>/yyyy.MM.dd-HHmm` with `mkdir` (no
   recursive), which makes claiming the name atomic and suffixes on collision.
4. The sidecar starts both recorders. **Either may fail alone** — a denied system-audio
   grant still records your voice; a broken input device still records the meeting.
   Only losing both is fatal.
5. The note is written immediately with no transcript, so there is something to open
   during the call. Its path is remembered per session so the post-transcription write
   lands on the same file.
6. `level` events drive the meters ~5×/second.

### Stopping and transcribing

1. `stop` goes down stdin (`SIGTERM` also works, and stdin EOF means the host died).
   The sidecar patches its WAV headers and writes `meta.json` last, atomically.
2. `finishSession` patches host-owned fields into `meta.json` (calendar event, app
   version) and enqueues.
3. Per track, in 10-minute windows: read PCM → skip windows below the silence
   threshold → transcribe the chunk → shift segments by **chunk position + the track's
   `offset_ms`** → tag `me`/`them`.
4. Merge by time, write `transcript.json` (atomically — its existence is the "done"
   predicate) then `transcript.md`, then the note, then apply retention.

### Crash safety

The sidecar writes a canonical 44-byte WAV header up front with **zero sizes** and
appends samples as they arrive, patching the two size fields only on clean stop. So:

- `kill -9` at any point leaves every sample it wrote on disk.
- `readWavInfo` derives the true length from the file when the header says zero.
- `recoverWavHeader` repairs the file in place before transcription, so retained audio
  is playable in the app's audio viewer afterwards.
- `meta.json` is written last, so a hard kill leaves track files and no meta — which
  would make the session invisible to both the pending predicate and the sessions
  list. `recoverOrphanedSessions` (run first by `resumePending`) rebuilds the meta from
  the files. The only thing genuinely unrecoverable is the per-track start offsets,
  which exist solely as each track's first-buffer wall clock; they default to 0 and the
  session carries a warning, because a few hundred milliseconds of speaker skew beats
  losing the meeting.
- The session is then picked up by `resumePending()` as ordinary pending work.

### Non-speech output

Given near-silence whisper does not return nothing — it returns its guess at the noise
(`[Music]`, `[BLANK_AUDIO]`, `♪`). Harmless in a dictation box, corrosive in a meeting
note, where it reads as a participant saying it. With two tracks one is nearly always
the quiet one, so this is the common case. `isNonSpeech`
(`voice/whisper/non-speech.ts`) drops a segment when _all_ of it is annotation or
punctuation — structural rather than a word list, so it catches unseen annotations
while keeping "so [inaudible] by Friday". A transcript that ends up with no segments
gets `no_speech_detected: true` in the note, so a silent meeting is distinguishable
from one still waiting on its transcript.

### Transcription engines

| engine              | speed (measured)           | 1-hour meeting, 2 tracks | notes                               |
| ------------------- | -------------------------- | ------------------------ | ----------------------------------- |
| `whisper` (default) | 18x realtime               | ~6.6 min                 | already shipped, no download        |
| `parakeet`          | 0.52 s/call + 70x realtime | ~1.8 min                 | Core ML, ~600 MB once, 25 languages |

Parakeet is **not** trusted on its own. It can return zero tokens for audio that plainly
contains speech — deterministically, on the same file, while whisper transcribes it
correctly — and scaling the input changes the outcome unpredictably. Observed on a real
capture: the system track, clearly audible at peak 1.0, came back empty. For a meeting
that is not a worse transcript, it is losing one side of the conversation with nothing to
notice, so `withTranscriberFallback` retries any _empty result on a window that had
signal_ on whisper. Silence is still expected to be empty and costs nothing.

The practical effect is a fast path with a correctness floor: most windows come back in
milliseconds, and the ones Parakeet drops cost a whisper pass instead of a hole in the
transcript.

### Retained audio

`keepAudio: always` compresses to AAC after transcription — measured **7.7x smaller**
(15 MB per hour per track instead of 115) for **0.76 % WER** on the round-trip. The
sidecar decodes it back transparently when re-transcribing, since nothing else in the
repo can read AAC.

## IPC surface

| Channel                             | Direction | Purpose                                                  |
| ----------------------------------- | --------- | -------------------------------------------------------- |
| `meeting:captureEngine`             | invoke    | Which engine a start would actually use                  |
| `meeting:startCapture`              | invoke    | Start; returns tracks that opened + the note path        |
| `meeting:stopCapture`               | invoke    | Finalize files and enqueue; does not await transcription |
| `meeting:captureStatus`             | invoke    | State, elapsed, tracks, queue depth                      |
| `meeting:listSessions`              | invoke    | Sessions on disk, newest first                           |
| `meeting:retranscribe`              | invoke    | Re-run; refuses with a reason if audio was deleted       |
| `meeting:deleteSession`             | invoke    | Remove a session directory                               |
| `meeting:captureDoctor`             | invoke    | Permission/device preflight with remediation             |
| `meeting:transcriptionModels`       | invoke    | Whether the Parakeet models are downloaded               |
| `meeting:ensureTranscriptionModels` | invoke    | Download them (~600 MB)                                  |
| `meeting:modelProgress`             | event     | Model-download progress                                  |
| `meeting:captureState`              | event     | Every state transition — keeps tray and window agreed    |
| `meeting:captureLevel`              | event     | Per-track peaks while recording                          |
| `meeting:captureProgress`           | event     | Transcription queue progress                             |
| `meeting:captureEnded`              | event     | Capture stopped without being asked (crash, quit, tray)  |

Schemas: `packages/shared/src/ipc.ts` (`meeting:*` block). Payload types:
`packages/shared/src/meetings.ts`. Handlers: `apps/main/src/ipc/meetings.ts`, spread
into `registerIpcHandlers` in `apps/main/src/ipc.ts`.

## Session directory

```
<WorkDir>/recordings/2026.07.29-1430/
  mic.wav          your side — 16 kHz mono 16-bit PCM
  system.wav       everything the Mac played — same format
  meta.json        timings, per-track offset_ms, peak, silent flag, warnings
  transcript.json  canonical: engine, model, timed speaker-tagged segments
  transcript.md    the same transcript rendered for reading
  transcribe.log   per-session progress and failures
```

**16 kHz mono** because that is exactly what whisper.cpp consumes and there is no audio
decoder anywhere in the repo. A higher-fidelity archive would buy nothing for
re-transcription — whisper resamples to 16 kHz regardless — and would need a decode
pass on the way back out. The trade is that retained audio is speech-grade, not
archive-grade; adding a parallel AAC track later is contained to `TrackWriter.swift`.
Disk cost is ~115 MB per hour per track, which the default retention deletes.

## Settings

`<WorkDir>/config/transcription.json`, under `meetings`. Surfaced in Settings →
Transcription → **Meeting recording**.

| Key                  | Default                | Notes                                                    |
| -------------------- | ---------------------- | -------------------------------------------------------- |
| `captureEngine`      | `auto`                 | `auto` prefers native; `renderer` forces the in-app path |
| `recordingsDir`      | `<WorkDir>/recordings` |                                                          |
| `micVoiceProcessing` | `false`                | Echo cancellation. On with speakers, off with headphones |
| `keepAudio`          | `untilTranscribed`     | `always` \| `untilTranscribed` \| `never`                |
| `transcribeOnStop`   | `true`                 |                                                          |

`untilTranscribed` keeps the audio when transcription **failed**, so a retry is
possible — deleting it there would throw the meeting away with nothing to show for it.
`never` deletes when the session ends whether or not a transcript exists.

## Verification runbook

CI can assert staging and IPC shape but cannot grant microphone or system-audio TCC, so
signal has to be checked by hand.

```bash
# 1. Build the helper
cd apps/x/vendor/audiocap && ./build.sh
./out/oppulence-audiocap doctor --json | python3 -m json.tool

# 2. Record standalone, with a video playing AND you talking
./out/oppulence-audiocap record --out /tmp/s1     # ^C to stop

# 3. Assert LEVEL, not duration. The failure mode this guards against is a
#    correctly-timed file at -91 dB: right duration, no signal.
afinfo /tmp/s1/mic.wav /tmp/s1/system.wav | grep -E "duration|dur"
python3 - <<'PY'
import wave, audioop
for f in ("/tmp/s1/mic.wav", "/tmp/s1/system.wav"):
    w = wave.open(f); pcm = w.readframes(w.getnframes())
    print(f, "frames", w.getnframes(), "peak", audioop.max(pcm, 2))
PY

# 4. Crash safety
./out/oppulence-audiocap record --out /tmp/s2 &
sleep 5; kill -9 %1
# both files still decode; the header says 0 bytes and core repairs it
```

In the app: `npm run dev`, start from the Meetings view, **talk over the other party
deliberately**, stop. Assert the note has interleaved `You`/`Other` turns with your
interruption present, that no screen-recording prompt appeared, and that closing every
window mid-recording does not stop the session (the tray keeps counting).

## File map

| Purpose                            | File                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Swift capture helper               | `apps/x/vendor/audiocap/Sources/audiocap/`                                                                    |
| Helper build + toolchain preflight | `apps/x/vendor/audiocap/build.sh`                                                                             |
| Sidecar spawn, NDJSON, permissions | `apps/main/src/meeting-capture.ts`                                                                            |
| Live session + queue ownership     | `apps/main/src/meeting-controller.ts`                                                                         |
| Menu-bar item                      | `apps/main/src/tray.ts`                                                                                       |
| IPC handlers                       | `apps/main/src/ipc/meetings.ts`                                                                               |
| Session dirs, meta, atomic writes  | `packages/core/src/meetings/session.ts`                                                                       |
| Transcription queue                | `packages/core/src/meetings/queue.ts`                                                                         |
| Chunked transcription + merge      | `packages/core/src/meetings/transcribe.ts`                                                                    |
| WAV reading + crash recovery       | `packages/core/src/meetings/wav.ts`                                                                           |
| Orphaned-session recovery          | `packages/core/src/meetings/recover.ts`                                                                       |
| Whisper non-speech filter          | `packages/core/src/voice/whisper/non-speech.ts`                                                               |
| Note writing + provenance          | `packages/core/src/meetings/note.ts`                                                                          |
| Engine fallback                    | `packages/core/src/meetings/fallback.ts`                                                                      |
| Parakeet + codec sidecar clients   | `apps/main/src/meeting-engines.ts`                                                                            |
| Audio retention + compression      | `packages/core/src/meetings/retention.ts`                                                                     |
| Types + note formatter (shared)    | `packages/shared/src/meetings.ts`                                                                             |
| Capture UI                         | `apps/renderer/src/components/meeting-capture-strip.tsx`                                                      |
| Engine switch                      | `apps/renderer/src/hooks/useMeetingTranscription.ts`                                                          |
| Settings                           | `apps/renderer/src/components/settings/transcription-settings.tsx`                                            |
| Packaging                          | `apps/main/forge.config.cjs`, `.github/workflows/audiocap-build.yml`, `.github/scripts/stage-audiocap-bin.sh` |

## Gotchas

- **The system tap is global.** Notification sounds and music land in `system.wav`.
  There is no per-process picker.
- **Echo cancellation is off by default.** On speakers, turn it on or the meeting audio
  is transcribed twice — once as them, once as you.
- **`VoiceProcessingIO` is a duplex unit, not an input effect.** Enabling it and then
  accepting `inputNode.outputFormat(forBus:)` as the client format yields digital
  silence on multichannel routes. `MicRecorder` completes the graph explicitly and
  still checks the first second for signal, restarting raw if it is flat. **When
  testing a mic change, assert level, not duration.**
- **A stale `module.modulemap`** in an older Command Line Tools install breaks every
  Objective-C module import with an error that points at the SDK. `build.sh` detects it
  and prints the fix.
- **`pcmStats.peak` is int16 (0…32767), not normalized.** A 0…1 threshold compared
  against it fires only on digital silence — which is how the silent-window skip
  quietly did nothing for a while.
- **Do not change `appBundleId`** — it would reset every installed user's microphone and
  screen-recording grants.
