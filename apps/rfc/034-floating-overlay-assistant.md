# RFC 034: Floating Overlay Assistant — a Hummingbird-Class Surface With an Approval Hook

|                  |                                                                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**          | 034                                                                                                                                                                                                             |
| **Status**       | Draft                                                                                                                                                                                                           |
| **Track**        | Desktop product - a global, always-available overlay over every app, without adopting screen recording                                                                                                          |
| **Owners**       | `apps/x/apps/main` (window + shortcut), `apps/x/apps/renderer` (overlay UI), `apps/x/packages/core` (context assembly)                                                                                          |
| **Created**      | 2026-07-23                                                                                                                                                                                                      |
| **Last updated** | 2026-07-23                                                                                                                                                                                                      |
| **Depends on**   | [RFC 021](./complete-021-semantic-memory-index.md) (recall), [email-010](./email-010-ai-mail-assistant-chat.md) (assistant tools), [RFC 035](./035-meeting-intelligence-commitment-ledger.md) (live transcript) |
| **Related**      | [RFC 029](./029-founder-operating-memory.md) (queue), [RFC 023](./023-closed-loop-actions.md) (approvals), [RFC 033](./033-integration-parity-surface.md), [RFC 025](./025-desktop-runtime-durability.md)       |
| **Supersedes**   | none                                                                                                                                                                                                            |

## Main point

Littlebird's **Hummingbird** — a floating chat window summoned by double-tapping Option, riding on top of any app, with access to memory and the live meeting transcript — is their best distribution feature: it makes the assistant _ambient_ instead of another window to visit. We build the same class of surface with two differences that are our identity: **context comes from consented sources, never from continuous screen capture**, and the overlay carries the one action Hummingbird cannot — **approving a revenue action from anywhere**. The overlay is how the queue meets the user mid-work instead of waiting for a dashboard visit.

## Littlebird reference (what we match and what we refuse)

| Hummingbird behavior                                     | Ours                                                                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Double-tap Option summon, configurable shortcut          | Same (double-tap modifier + configurable), registered via Electron `globalShortcut`                                                                                       |
| Floating panel over any app; Mac first, Windows beta     | Same order; frameless always-on-top panel window                                                                                                                          |
| Same chat as the main app, full memory context           | Same: assistant chat with mailbox/meetings/knowledge/queue context (email-010 tools, RFC 021 recall)                                                                      |
| Pulls the live meeting transcript mid-call               | Same, from RFC 035's local transcription session                                                                                                                          |
| "Can see what's on your screen" (continuous observation) | **Refused.** Explicit per-invocation context only: frontmost-app name + window title, and text the user selects or pastes. No screenshots, no OCR, no background capture. |

The refusal is not a weakness to hide — it is the law-firm posture (one-pager; RFC 031): an overlay a privilege-conscious firm can run is worth more than one that watches everything.

## Why this RFC exists

The desktop app currently opens one window (`apps/x/apps/main/src/main.ts:271 createWindow`) and registers no global shortcuts — every interaction requires switching to the app. Meanwhile the queue (RFC 029/030) will generate a handful of high-value approvals per week; if each one waits for an app visit, time-to-approve becomes the bottleneck of the whole loop. An ambient surface fixes both: zero-friction capture/ask, and sub-minute approvals.

## Design

**Window.** A second frameless `BrowserWindow` (macOS `panel`-type, `visibleOnAllWorkspaces`, `alwaysOnTop: 'floating'`), hidden at start, toggled by the shortcut; ESC or focus-loss dismisses. Renderer loads a dedicated `/overlay` route sharing the assistant components. Windows follows once the macOS panel behavior is stable.

**Summon.** Double-tap of a modifier (default: Option) detected in the main process, plus a configurable accelerator via `globalShortcut.register`. Settings live with the existing app settings surface.

**Context assembly (per invocation, consented).** On summon, the overlay receives: frontmost application name and window title (single AX/Win32 query — not a stream), current text selection if the user invokes "ask about selection," any clipboard content the user explicitly pastes, and the active meeting transcript if RFC 035 is recording. Each context element is visible as a removable chip before sending — the user always sees exactly what leaves the machine.

**Three verbs.**

1. **Ask** — assistant chat with full recall (RFC 021, email-010 tools).
2. **Capture** — one keystroke turns the current context into a note/commitment for the ledger (feeds RFC 035's commitment pipeline).
3. **Approve** — the queue's pending actions render as cards; approve/edit/snooze/reject inline with the same step-up rules as the dashboard (RFC 023 approval tokens; money actions still require step-up). This verb is the wedge hook and ships in the first release, not as a follow-up.

## Phases

1. **P1 — window + shortcut + Ask** (macOS): panel window, double-tap summon, chat with recall and per-invocation context chips.
2. **P2 — Approve**: queue cards in the overlay, RFC 023 token flow, action receipts inline.
3. **P3 — Capture + live-meeting context**: capture-to-ledger, RFC 035 transcript tap.
4. **P4 — Windows.**

## Decisions

1. **No continuous screen capture, ever, in this surface.** Screenshot-based context is out of scope even as an option; revisit only with a dedicated privacy RFC.
2. **Approve ships in the overlay before Capture.** The wedge outranks note-taking parity.
3. **One overlay window, not per-display panels**, until multi-display demand is real.
4. **The overlay reuses the renderer** (one React app, `/overlay` route) rather than a second UI stack.

## Test plan

- Main-process: shortcut registration/unregistration across sleep/wake and workspace switches; panel never steals focus from full-screen apps.
- Renderer: overlay route renders in <150 ms from summon (panel pre-created, hidden); context chips accurately reflect what is sent.
- Approval path: an approve from the overlay produces the identical audit/event trail as one from the dashboard (same RFC 023 token semantics) — asserted by integration test.
- Privacy: automated assertion that no IPC channel available to the overlay exposes screen-capture APIs.

## Non-goals

- Screen recording, OCR, or ambient observation.
- A separate mini-LLM/on-device answering stack for the overlay.
- Mobile companion surfaces (separate track).
