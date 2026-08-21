# RFC 042: Consented Desktop Context for Relationship-Aware Commands

|                |                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| **RFC**        | 042                                                                                                                  |
| **Status**     | Draft — rescoped by RFC 055                                                                                          |
| **Track**      | Rowboat desktop assistant · consented context                                                                        |
| **Owners**     | `apps/x` desktop, core assistant, security                                                                           |
| **Created**    | 2026-08-12                                                                                                           |
| **Updated**    | 2026-08-21                                                                                                           |
| **Depends on** | [RFC 034](./034-floating-overlay-assistant.md), [RFC 055](./055-capture-product-boundary-and-rowboat-integration.md) |
| **Related**    | [RFC 014](./014-live-note-observability-cost-and-provenance.md), [RFC 036](./036-relationship-state-engine.md)       |
| **Supersedes** | The Rowboat-owned selection-editing scope in the original RFC 042                                                    |

## 1. Decision

Rowboat accepts explicitly consented desktop context for **relationship-aware
assistant commands**. Generic dictation, selection rewriting, and local text
transforms belong to the separate capture product under RFC 055.

Rowboat's remaining desktop-context capability is:

- the user invokes Rowboat explicitly;
- selected text and, optionally, a screenshot are captured for that invocation;
- the assistant uses that context together with authorized relationship data;
- context is treated as untrusted input, visibly disclosed, and recorded in
  provenance; and
- consequential external actions still use Rowboat's approval runtime.

## 2. Current state

`apps/x/apps/main/src/desktop-dictation.ts` already implements the hard parts of
safe local selection editing: target capture before model latency,
target-change protection, sensitive-application refusal, recovery, and undo.
`packages/core/src/voice/command-mode.ts` already treats selected content as
inert data through an injection-resistant prompt contract.

Those are existing compatibility surfaces. RFC 042 does not expand them into a
second capture-product roadmap.

The Rowboat-specific gap is an opt-in, provenance-aware context envelope for
the relationship assistant, especially screenshot context.

## 3. Context envelope

Each invocation carries a typed envelope:

```text
DesktopContextEnvelope
├── invocation_id
├── captured_at
├── focused_application classification
├── selected_text? and selected_text_hash?
├── screenshot? and screenshot_hash?
├── capture consent flags
├── retention policy
└── source/capture provenance
```

The envelope is invocation-scoped and expires after the run. It is not added to
the relationship graph unless the user deliberately saves an output or the
command produces an evidence-bearing artifact under RFC 036.

## 4. Security and privacy

- Selected text and screenshots are attacker-controlled input, never system
  instructions.
- Screenshot capture is off by default and visible per invocation.
- Sensitive applications and secure fields fail closed.
- A screenshot is downscaled before provider submission and discarded after
  the invocation unless the user explicitly saves it.
- Provider routing follows the same local/cloud disclosure used by the rest of
  Rowboat.
- Provenance records which context types were supplied without logging secret
  content into operational events.
- Any requested external side effect becomes a proposal; context possession
  does not confer action authority.

## 5. Capture-product boundary

The capture product owns hotkeys for dictation, translation, selection
rewriting, cursor paste, and local undo. Rowboat may receive a context envelope
through a versioned adapter, but it does not reach into capture-product state or
reuse its database.

If both products register global shortcuts, a shared protocol reports reserved
combinations and ownership; shortcut implementation remains product-local.

## 6. Definition of done

- Relationship-assistant context is explicit, typed, expiring, and observable.
- Selection content is inert data under adversarial prompt tests.
- Screenshot context is off by default and blocked for sensitive targets.
- The UI shows whether context will stay local or go to a configured provider.
- No captured context silently becomes durable graph evidence.
- External actions remain propose-only until approved.
- Generic selection editing has no new Rowboat roadmap work under this RFC.

## 7. Reference implementation provenance

OpenWhispr's `selectionEditing.js`, `selectionManager.js`,
`screenContextCapture.js`, and `textEditMonitor.js` remain useful MIT-licensed
references. Any adapted logic retains attribution and records the upstream
commit, but product ownership stays at the interface defined by RFC 055.
