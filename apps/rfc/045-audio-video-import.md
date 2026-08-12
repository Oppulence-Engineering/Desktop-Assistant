# RFC 045: Audio and Video Import — Drag-Drop, Batch, and URL Transcription

|                    |                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **RFC**            | 045                                                                                                                  |
| **Status**         | Draft                                                                                                                |
| **Track**          | Meeting intelligence — OpenWhispr parity                                                                             |
| **Owners**         | `apps/x` core voice, meetings, renderer, security                                                                    |
| **Created**        | 2026-08-12                                                                                                           |
| **Depends on**     | [RFC 009](./complete-009-local-on-device-transcription.md)                                                           |
| **Related**        | [RFC 044](./044-cross-meeting-speaker-fingerprinting.md), [RFC 035](./035-meeting-intelligence-commitment-ledger.md) |
| **Reference impl** | OpenWhispr (MIT) — see §6                                                                                            |

## 1. Decision

Let users transcribe audio and video that our app did not record: drag files in,
queue a batch, or paste a URL. Imported media flows into the same meeting note,
summary, diarization, and commitment pipeline as a live capture.

## 2. Why

Every user has a backlog: recordings from before they installed us, a Zoom cloud
export, a podcast, a voice memo, a webinar. Import is the cheapest way to make
the product immediately useful on day one instead of only prospectively useful.
It is also the fastest path to populating the relationship graph with real
history.

## 3. What we have

- `packages/core/src/meetings/transcribe.ts` and `queue.ts` — the transcription
  pipeline and queue already exist and already handle retry and recovery.
- `packages/core/src/meetings/wav.ts`, `codec.ts` — audio handling.
- `apps/renderer/src/components/audio-file-viewer.tsx` — we can view audio files.

The pipeline is there. What is missing is an ingest path into it.

## 4. Design

### 4.1 Ingest sources

1. **Drag and drop** onto the meetings view.
2. **File picker** with multi-select.
3. **URL paste** — direct media URLs and YouTube-style pages via `yt-dlp`.

### 4.2 Normalization

Everything converts to our canonical mono 16kHz PCM/WAV via ffmpeg before
hitting `transcribe.ts`. Video is accepted by extracting the audio track. Format
sniffing must be content-based, not extension-based.

### 4.3 Batch queue

Reuse `meetings/queue.ts` rather than building a second queue. The UI needs
per-item progress, failure isolation (one bad file must not stall the batch),
cancel, and resume after restart.

### 4.4 Long-file handling

Imported media is routinely hours long, far beyond a typical live meeting.
Requirements: chunked processing with progress, a duration cap with an explicit
warning rather than a silent truncation, and a cost estimate before any cloud
transcription of a long file.

### 4.5 URL download security

This is the dangerous part. Fetching a user-supplied URL from the main process
is an SSRF vector. Required controls, all present in the reference
implementation:

- Resolve DNS first and **reject private, loopback, and link-local ranges**.
- Re-validate on every redirect hop (DNS rebinding).
- Cap download size and wall-clock time.
- Download into a scoped temp dir, never a shared one.
- Treat `yt-dlp` as untrusted: pass arguments as an array, never a shell string.

## 5. Definition of done

- Drag-drop, multi-select, and URL import all produce normal meeting notes.
- Video files transcribe by extracting audio.
- A batch survives one corrupt file and an app restart.
- Hour-plus files report progress and never silently truncate.
- SSRF controls are unit-tested, including the redirect-rebinding case.
- Imported notes are visibly marked as imported, with provenance recording the
  source (file or URL) per RFC 014.

## 6. OpenWhispr code references

| Concern                       | File                                         | Lines | Notes                                                                                                                                                                                  |
| ----------------------------- | -------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL download and SSRF defense | `src/helpers/urlAudioDownloader.js`          | 1561  | The single most valuable file here. DNS pre-resolution, private-range rejection, redirect re-validation, size/time caps, `yt-dlp` invocation. Read before writing any URL ingest code. |
| Import UI                     | `src/components/notes/UploadAudioView.tsx`   | 1995  | Drag-drop, multi-file, progress, error states. Large but the interaction model is worth studying.                                                                                      |
| Batch queue UI                | `src/components/notes/BatchQueueView.tsx`    | 163   | Compact per-item progress and failure isolation.                                                                                                                                       |
| Transcription service         | `src/services/fileTranscription.ts`          | 164   | File-to-transcript orchestration.                                                                                                                                                      |
| Media normalization           | `src/helpers/ffmpegUtils.js`                 | 468   | Format conversion and audio extraction from video.                                                                                                                                     |
| Import settings               | `src/components/settings/UploadSettings.tsx` | 143   | Defaults, speaker detection toggle.                                                                                                                                                    |
| Temp dir safety               | `src/helpers/safeTempDir.js`                 | —     | Scoped temp directories for untrusted downloads.                                                                                                                                       |
| yt-dlp provisioning           | `scripts/download-yt-dlp.js`                 | —     | Fetching and pinning the binary.                                                                                                                                                       |

MIT-licensed; carry the notice on any adapted file.

## 7. Risks

- **SSRF is the real risk**, not media handling. Treat §4.5 as the acceptance bar.
- Bundling `yt-dlp` carries update pressure (it breaks when sites change) and
  distribution questions. Consider fetching it on first use rather than shipping
  it, and make URL import degrade gracefully when it is absent.
- Long cloud transcriptions can produce a surprising bill. Estimate first.
