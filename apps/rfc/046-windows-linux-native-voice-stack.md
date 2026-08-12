# RFC 046: Windows and Linux Native Voice Stack

|                    |                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------- |
| **RFC**            | 046                                                                                          |
| **Status**         | Draft                                                                                        |
| **Track**          | Platform reach — OpenWhispr parity                                                           |
| **Owners**         | `apps/x` desktop, native, release engineering                                                |
| **Created**        | 2026-08-12                                                                                   |
| **Depends on**     | [RFC 040](./040-dictation-core-ux.md)                                                        |
| **Related**        | [RFC 043](./043-gpu-whisper-and-parakeet-engines.md), [RFC 045](./045-audio-video-import.md) |
| **Reference impl** | OpenWhispr (MIT) — see §6                                                                    |

## 1. Decision

Make Windows and Linux real target platforms for the voice stack, not just build
targets. Today we produce Windows and Linux distributables that cannot dictate.

## 2. The evidence

We already build for all three platforms:
`.github/workflows/electron-build.yml` defines `build-macos`, `build-linux`, and
`build-windows` jobs, all publishing via electron-forge.

But `pasteClipboardText()` in `apps/x/apps/main/src/desktop-dictation.ts` reads:

```ts
if (process.platform !== "darwin") {
  return { success: false, error: "Desktop dictation is currently available on macOS." };
}
```

And our entire native layer, `apps/x/vendor/audiocap/`, is a Swift package:
audio capture, hotkey monitoring, desktop context, paste, and Parakeet are all
macOS-only. We ship installers to Windows and Linux users that cannot perform
the app's core action.

## 3. Scope

Per platform, five native capabilities are needed:

| Capability             | macOS (have)                | Windows (need)                | Linux (need)            |
| ---------------------- | --------------------------- | ----------------------------- | ----------------------- |
| Global key listener    | `HotkeyMonitor.swift`       | Win32 low-level keyboard hook | evdev / X11 / Wayland   |
| Paste at cursor        | `DesktopPaste.swift`        | `SendInput`                   | XTEST / ydotool         |
| Focused-window context | `DesktopContext.swift`      | UI Automation                 | X11 properties / AT-SPI |
| Mic capture            | `MicRecorder.swift`         | WASAPI                        | PulseAudio / PipeWire   |
| System audio capture   | `SystemAudioRecorder.swift` | WASAPI loopback               | PulseAudio monitor      |

**Wayland is the hard one.** There is no portable global-hotkey or synthetic-input
API. The realistic answer is `ydotool` (requires a uinput permission setup),
plus per-compositor shortcut registration for GNOME and Hyprland, plus an
XWayland fallback. Plan for a guided setup flow, not a silent failure.

## 4. Approach

### 4.1 Interface first

Extract the capability contracts that `audiocap` currently satisfies implicitly
into an explicit per-platform interface in `apps/main/src`, so each OS provides
an implementation and the TypeScript above is platform-agnostic. Our existing
stdout protocol (`vendor/audiocap/Sources/audiocap/Protocol.swift`) is a
reasonable wire format to keep across all three helpers.

### 4.2 Sequencing

1. Windows first: larger user base, one desktop environment, well-documented APIs.
2. Linux X11 next.
3. Linux Wayland last, with explicit setup guidance and honest degradation.

### 4.3 Honest capability reporting

Until a platform's stack lands, the app must say what is unavailable and why on
that platform, rather than presenting dictation UI that returns an error. This
is worth doing **immediately**, ahead of any native work.

## 5. Definition of done

- Dictation, paste-at-cursor, and global hotkeys work on Windows and Linux/X11.
- Wayland either works via a documented `ydotool` setup or clearly states the
  requirement with a link to setup steps.
- Meeting capture (mic plus system audio) works on Windows and Linux/X11.
- CI builds and smoke-tests native helpers for all three platforms.
- No platform ships UI for a capability it does not have.

## 6. OpenWhispr code references

They support all three platforms today, so this is the richest reference of the
whole set. Native sources live in `resources/`, build scripts in `scripts/`.

| Capability           | Windows                                   | Linux                                                     | macOS (for contrast)                   |
| -------------------- | ----------------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| Key listener         | `resources/windows-key-listener.c`        | `resources/linux-key-listener.c`                          | `resources/macos-globe-listener.swift` |
| Fast paste           | `resources/windows-fast-paste.c`          | `resources/linux-fast-paste.c`                            | `resources/macos-fast-paste.swift`     |
| Text/context monitor | `resources/windows-text-monitor.c`        | `resources/linux-text-monitor.c`, `linux-text-monitor.py` | `resources/macos-text-monitor.swift`   |
| Mic listener         | `resources/windows-mic-listener.c`        | —                                                         | `resources/macos-mic-listener.swift`   |
| System audio         | `resources/windows-system-audio-helper.c` | `resources/linux-system-audio-helper.c`                   | `resources/macos-audio-tap.swift`      |

Supporting JavaScript:

| Concern                | File                                                     | Lines | Notes                                                      |
| ---------------------- | -------------------------------------------------------- | ----- | ---------------------------------------------------------- |
| Windows key manager    | `src/helpers/windowsKeyManager.js`                       | 215   | Host side of the Win32 hook.                               |
| Windows loopback audio | `src/helpers/windowsLoopbackAudioManager.js`             | —     | WASAPI loopback host side.                                 |
| Wayland input          | `src/helpers/ensureYdotool.js`                           | —     | Detecting/provisioning `ydotool` and the permission story. |
| GNOME shortcuts        | `src/helpers/gnomeShortcut.js`                           | —     | Registering shortcuts via GNOME settings.                  |
| Hyprland shortcuts     | `src/helpers/hyprlandShortcut.js`                        | —     | Compositor-specific binding.                               |
| XWayland fallback      | `src/helpers/xwayland.js`                                | —     | Detection and fallback behavior.                           |
| Binary resolution      | `src/helpers/binaryResolver.js`                          | —     | Locating helpers across dev and packaged builds.           |
| Build scripts          | `scripts/build-windows-*.js`, `scripts/build-linux-*.js` | —     | Compiling C helpers in CI without a heavyweight toolchain. |

MIT-licensed; carry the notice on any adapted file. The C helpers are the most
directly reusable artifacts in the entire comparison.

## 7. Risks

- This is the largest effort in the set: three platforms times five capabilities,
  each with its own permission model. Sequence it and ship honest capability
  reporting first.
- Wayland may never be fully seamless. Decide deliberately whether a `ydotool`
  setup requirement is acceptable, and say so in the docs.
- Linux packaging variance (AppImage, deb, rpm) multiplies the native-helper
  distribution problem.
