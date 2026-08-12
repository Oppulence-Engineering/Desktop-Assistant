# RFC 040: Dictation as a Core Surface — Hotkey, Paste-at-Cursor, and Native Key Listeners

|                    |                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**            | 040                                                                                                                                                                   |
| **Status**         | Draft                                                                                                                                                                 |
| **Track**          | Desktop voice surface — OpenWhispr parity                                                                                                                             |
| **Owners**         | `apps/x` desktop, native (Swift/C), product                                                                                                                           |
| **Created**        | 2026-08-12                                                                                                                                                            |
| **Depends on**     | [RFC 009](./complete-009-local-on-device-transcription.md), [RFC 025](./025-desktop-runtime-durability.md)                                                            |
| **Related**        | [RFC 041](./041-dictation-translation.md), [RFC 042](./042-voice-agent-screen-context-and-selection-editing.md), [RFC 046](./046-windows-linux-native-voice-stack.md) |
| **Reference impl** | OpenWhispr (MIT), `github.com/OpenWhispr/openwhispr` — see §6                                                                                                         |

## 1. Decision

Dictation becomes a first-class, always-available desktop surface rather than a
feature reachable only from inside our app window. Press a hotkey anywhere in
the OS, speak, and the text lands at the cursor in whatever app has focus.

We already have most of the machinery. This RFC closes the gap between "we have
dictation plumbing" and "dictation is the fastest way to get text into any app".

## 2. What we have today

Our desktop dictation is real and non-trivial:

- `apps/x/apps/main/src/desktop-dictation.ts` (1141 lines) — recording lifecycle,
  `globalShortcut` registration, transform shortcuts, cancel, paste-last recovery.
- `apps/x/apps/main/src/desktop-context.ts` (135 lines) — captures the focused
  app, selection, and a `sensitive` flag before the model runs.
- `apps/x/vendor/audiocap/Sources/audiocap/DesktopPaste.swift` and
  `HotkeyMonitor.swift` — the macOS native helper we already ship.
- `apps/x/apps/main/src/dictation-transforms.ts`, `dictation-polish.ts`,
  `dictation-history.ts`, `dictation-recovery.ts`, `dictation-audio-recovery.ts`.

## 3. The actual gaps

1. **macOS-only paste.** `pasteClipboardText()` in `desktop-dictation.ts`
   hard-returns an error on non-darwin:
   `"Desktop dictation is currently available on macOS."` Windows and Linux have
   no paste path at all. (Owned by [RFC 046](./046-windows-linux-native-voice-stack.md).)
2. **Electron `globalShortcut` only.** We cannot bind the macOS Globe/Fn key, and
   we cannot do press-and-hold (push-to-talk) reliably, because Electron only
   reports accelerator activation, not key down/up.
3. **No hotkey conflict validation.** Users can bind a combination another app
   already owns and get silent failure.
4. **Paste is clipboard-swap only.** We write the clipboard, invoke the helper,
   sleep 350ms, restore. That races with clipboard managers and drops rich
   clipboard content on slow machines.

## 4. Proposed design

### 4.1 Push-to-talk and Globe key

Extend `audiocap`'s `HotkeyMonitor.swift` to emit discrete `keydown`/`keyup`
events over the existing stdout protocol (`Protocol.swift`), so the main process
can implement:

- **Toggle mode** — press once to start, once to stop (today's behavior).
- **Push-to-talk** — hold to record, release to transcribe and paste.

OpenWhispr proves the Globe/Fn approach with a separate always-on Swift sidecar;
we should fold it into `audiocap` rather than adding a second process.

### 4.2 Hotkey registry and validation

Introduce a single hotkey registry in `apps/main/src` that owns every
accelerator (dictation, cancel, paste-last, transforms, translation from RFC
041, agent from RFC 042). It must expose reserved-combination detection and
per-binding conflict reporting to the settings UI.

### 4.3 Paste hardening

Replace the fixed 350ms restore with a completion signal from the native helper,
and preserve the full clipboard payload (text, HTML, RTF, image) already captured
by `captureClipboard()`.

## 5. Definition of done

- Push-to-talk and toggle both work on macOS, bound to any key including Globe.
- Every hotkey is registered through one registry, with conflicts surfaced in
  settings before the user saves.
- Clipboard contents survive a dictation round-trip, verified by a test that
  puts an image plus HTML on the clipboard and asserts byte equality after paste.
- Paste restore is driven by helper acknowledgement, not a sleep.

## 6. OpenWhispr code references

Local checkout: `/Users/dyomba/go/src/github.com/Oppulence-Engineering/openwhispr`.
License is MIT, so code may be adapted into this Apache-2.0 repo **provided the
MIT copyright notice travels with any copied file**. Prefer adapting the logic
into our TypeScript/Swift layout over verbatim copying.

| Concern              | OpenWhispr file                                                                                      | Lines | Why it is worth reading                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Hotkey orchestration | `src/helpers/hotkeyManager.js`                                                                       | 1336  | Full registration/rebinding lifecycle, push-to-talk vs toggle, per-platform fallbacks. The single most valuable file for this RFC. |
| Globe/Fn key capture | `src/helpers/globeKeyManager.js` + `resources/macos-globe-listener.swift`                            | 337   | How to observe the Fn key, which Electron cannot bind.                                                                             |
| Clipboard and paste  | `src/helpers/clipboard.js`                                                                           | 2247  | Clipboard save/restore, format preservation, and the race conditions they hit in production.                                       |
| Native fast paste    | `resources/macos-fast-paste.swift`, `resources/windows-fast-paste.c`, `resources/linux-fast-paste.c` | —     | Three platform paste implementations; the C ones matter for RFC 046.                                                               |
| Build wiring         | `scripts/build-macos-fast-paste.js`                                                                  | —     | Cross-compilation pattern (`--arch`, `TARGET_ARCH`) worth copying for universal builds.                                            |
| Hotkey validation    | `src/utils/hotkeyValidation.ts`, `src/utils/hotkeyValidator.ts`, `src/utils/hotkeys.ts`              | —     | Reserved-combination lists and conflict messages, directly reusable.                                                               |
| Smart spacing        | `src/helpers/smartSpacing.js`                                                                        | —     | Inserts correct leading/trailing spaces based on surrounding text. Small, high polish-per-line.                                    |

## 7. Risks

- Fn/Globe interception on macOS is entitlement-sensitive and can break across
  OS releases. Keep a standard-accelerator fallback and never let hotkey
  registration failure block dictation from the app window.
- Push-to-talk raises the cost of a stuck key. The capture guardian in
  `packages/core/src/meetings/capture-guardian.ts` is the model for a watchdog.
