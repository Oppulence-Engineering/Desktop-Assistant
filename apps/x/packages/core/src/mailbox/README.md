# Mailbox module

Provider-neutral email foundation for the desktop app: a normalized mailbox data
model, a Gmail adapter over the existing sync, a local automation engine, and a
reply-tracking workflow. Product code (IPC, the assistant, background sync) talks
to `MailboxService` and the shared types — never to a provider SDK directly.

## Flow direction

```
provider adapter → store → service → policy/action engine → UI / assistant / IPC
```

Nothing above the provider layer sees a Gmail/Outlook shape, and every mutation
passes the action policy gate before touching a provider.

## Files

| Area              | Files                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| Model & identity  | `types.ts`, `ids.ts`, `capabilities.ts`, `errors.ts`                                                     |
| Provider contract | `provider.ts`, `provider-registry.ts`                                                                    |
| Gmail adapter     | `provider-gmail.ts` (pure mapping), `provider-gmail-bridge.ts` (wires the existing sync), `normalize.ts` |
| Local store       | `store.ts` (interface + in-memory), `store-fs.ts` (JSON snapshot under `WorkDir/mailbox/`)               |
| Sync reliability  | `sync-jobs.ts` (backoff), `sync-controller.ts`                                                           |
| Rules engine      | `rules/{types,conditions,policy,audit,scheduler,actions,engine,preview}.ts`                              |
| Reply Zero        | `reply/{types,state-machine,tracker,drafts,memory}.ts`                                                   |
| Privacy           | `privacy/{redaction,prompt-injection,payload-policy}.ts`                                                 |
| Evaluation        | `evals/{fixtures,runner}.ts`                                                                             |
| Model-backed AI   | `ai.ts` (matcher, reply classifier, draft generator)                                                     |
| Facade            | `service.ts`, public barrel `mailbox.ts`                                                                 |

## Design invariants

- **Deterministic ids.** Every object carries a stable Rowboat id (hash of
  provider + account + native id) so rule runs, action runs, and dedupe keys
  converge instead of duplicating across sync ticks or desktop/cloud workers.
- **Policy-gated mutations.** Send, forward, spam, trash, and external payloads
  with a body are denied or approval-gated by default; low-risk reversible
  actions run automatically. Assistant and rule sources share one gate.
- **Local-first drafts.** Reply drafts live in Rowboat and are deduped by a
  thread-message-set fingerprint; a provider draft is only created on opt-in, and
  a user-edited draft is never overwritten.
- **Fail-safe automation.** A provider 429/5xx backs the account off with jitter
  and respects Retry-After; a model failure in a matcher/classifier resolves to
  the conservative outcome (no match / no nudge) rather than throwing into sync.
- **Untrusted email content.** Every model call wraps the thread with a
  prompt-injection guard and a length-capped, prompt-safe view; logs redact
  addresses.

## Wiring

- Desktop IPC: provider-neutral `mailbox:*` channels
  (`apps/main/src/ipc/mailbox.ts`), spread alongside the existing `gmail:*`
  handlers. Schemas live in `@x/shared` (`blocks.ts`, `ipc.ts`).
- Singleton: `getMailboxService()`; inject dependencies with
  `createDefaultMailboxService(overrides)` for tests.
