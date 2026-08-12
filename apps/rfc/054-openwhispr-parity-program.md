# RFC 054: OpenWhispr Parity Program — Index, Sequencing, and Provenance

|                    |                                                                          |
| ------------------ | ------------------------------------------------------------------------ |
| **RFC**            | 054                                                                      |
| **Status**         | Draft — index for RFCs 040-053                                           |
| **Track**          | Program coordination                                                     |
| **Owners**         | product, `apps/x` desktop, core voice                                    |
| **Created**        | 2026-08-12                                                               |
| **Related**        | RFCs [040](./040-dictation-core-ux.md)-[053](./053-local-llm-runtime.md) |
| **Reference impl** | OpenWhispr (MIT), `github.com/OpenWhispr/openwhispr` v1.8.2              |

## 1. Purpose

RFCs 040 through 053 came from a feature comparison against OpenWhispr, an
open-source dictation and meeting product. This RFC is the index: what each one
is, what order they should happen in, and the rules for reusing their code.

**This is not a plan to become OpenWhispr.** They are a dictation-first product;
we are a relationship-intelligence product with a desktop client. Several items
here are worth doing because they make _our_ thesis stronger, some are worth
doing because they are cheap, and at least one is worth explicitly declining.

## 2. The RFCs

| RFC                                                              | Title                                            | Size   | Why                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------ | ------ | -------------------------------------------------------------------------------- |
| [040](./040-dictation-core-ux.md)                                | Dictation as a core surface                      | M      | Push-to-talk, hotkey registry, paste hardening. We have the foundation.          |
| [041](./041-dictation-translation.md)                            | Dictation translation                            | **S**  | Speak one language, paste another. Highest value per line in the set.            |
| [042](./042-voice-agent-screen-context-and-selection-editing.md) | Voice agent screen context and selection editing | M      | Edit highlighted text by voice; optional screenshot context. Security-sensitive. |
| [043](./043-gpu-whisper-and-parakeet-engines.md)                 | GPU whisper and Parakeet engines                 | L      | CUDA/Vulkan local whisper. Note: we already have Parakeet on macOS.              |
| [044](./044-cross-meeting-speaker-fingerprinting.md)             | Cross-meeting speaker fingerprinting             | M      | Voice identity as a relationship-graph input. Strategically ours, not theirs.    |
| [045](./045-audio-video-import.md)                               | Audio and video import                           | M      | Transcribe the user's backlog. Fastest way to populate the graph.                |
| [046](./046-windows-linux-native-voice-stack.md)                 | Windows and Linux native voice stack             | **XL** | We ship installers that cannot dictate. Largest item in the set.                 |
| [047](./047-snippets-dictionary-correction-learner.md)           | Snippets, dictionary, correction learner         | **S**  | Config already exists; mostly surfacing what we built.                           |
| [048](./048-public-api-mcp-server-cli.md)                        | Public API, MCP server, CLI                      | L      | Be an MCP _server_, not just a client. Distribution for the graph.               |
| [049](./049-i18n-and-localization.md)                            | i18n and localization                            | M      | Cheaper now than after 040-047 add UI.                                           |
| [050](./050-enterprise-controls.md)                              | Enterprise controls                              | L      | Closest to done thanks to RFC 015 and WorkOS.                                    |
| [051](./051-note-sharing-and-team-spaces.md)                     | Note sharing and team spaces                     | L      | Keeps the artifact and the evidence inside the system.                           |
| [052](./052-transcription-provider-breadth.md)                   | Transcription provider breadth                   | M      | Failover and procurement, not novelty.                                           |
| [053](./053-local-llm-runtime.md)                                | Local LLM runtime and vector index               | L      | Completes an honest local-only mode.                                             |

## 3. Corrections to the initial comparison

Two claims from the first pass were wrong and are corrected in the RFCs:

1. **We already have Parakeet.** `apps/x/vendor/audiocap/Sources/audiocap/ParakeetEngine.swift`
   runs it via FluidAudio's Core ML port. The real gap is that it is Apple-silicon
   only, and that local Whisper has no GPU path. See RFC 043 §2.
2. **Our dictation is more complete than a feature list suggests.**
   `desktop-dictation.ts` is 1141 lines with command mode, target-change
   protection, sensitive-app refusal, and recovery. RFC 040 is a gap-closing RFC,
   not a build-from-scratch one.

## 4. Suggested sequencing

**Wave 1 — cheap wins that compound (weeks, not quarters).**
RFC 041 (translation), RFC 047 (dictionary/snippets). Both are small, both are
mostly surfacing existing plumbing, both immediately improve daily use.

**Wave 2 — strategic to our thesis.**
RFC 044 (speaker fingerprinting) and RFC 045 (import). These feed the
relationship graph, which is our actual product. RFC 044 in particular is worth
more to us than to the product we copied it from.

**Wave 3 — reach.**
RFC 049 (i18n) before the UI surface grows further, then RFC 046 (Windows/Linux).
RFC 046 should begin immediately with its §4.3 honest capability reporting, which
is a small change that stops us shipping broken-looking installers today.

**Wave 4 — platform and commercial.**
RFC 048 (API/MCP), RFC 051 (sharing), RFC 050 (enterprise), RFC 052 (providers),
RFC 053 (local LLM), RFC 043 (GPU).

**Candidate to decline:** the long tail of RFC 052. Corti and Tinfoil should not
be built without a named customer. Breadth for its own sake is permanent
maintenance cost.

## 5. Licensing and code reuse

OpenWhispr is **MIT**; this repository is **Apache-2.0**. MIT code may be
incorporated into an Apache-2.0 project, subject to these rules:

1. **Attribution travels with the code.** Any file substantially derived from
   theirs keeps the MIT copyright notice and states its origin in a header
   comment.
2. **Prefer adaptation over copying.** Our layout is TypeScript monorepo
   packages; theirs is CommonJS helpers in a flat directory. Porting the _logic_
   with our types and tests produces better code than transplanting files. The
   exceptions are the C native helpers (RFC 046) and small pure-logic modules
   (`translationChain.js`, `speakerAssignmentPolicy.js`, `selectionEditing.js`),
   where near-verbatim reuse is reasonable.
3. **Record provenance in the PR**, naming the upstream file and commit.
4. **Do not copy branding, model prompts tied to their product identity, or
   anything under a different license inside their tree** (bundled binaries and
   models have their own terms).
5. When in doubt, read their file for the _reasoning_ — especially the comments
   explaining empirical constants, which are the most valuable thing in that
   codebase — and write our own implementation.

Local reference checkout used for these RFCs:
`/Users/dyomba/go/src/github.com/Oppulence-Engineering/openwhispr` (v1.8.2).

## 6. What we should not copy

Their architecture has properties we should not inherit:

- A 1844-line `main.js` and ~180 flat helper modules in one directory.
- Mixed CommonJS/ESM/TypeScript within a single layer.
- Business logic in Electron main-process helpers rather than a testable core
  package.

Our `packages/core` boundary is a genuine advantage. Ported logic belongs in
core with tests, not in `apps/main/src` as another helper.
