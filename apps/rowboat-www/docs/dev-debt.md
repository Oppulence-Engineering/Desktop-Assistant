# Dev debt burn-down (eslint legacy allowlists)

Each entry removed from `eslint.config.mjs` `legacy.*` arrays is a completed migration slice.

## `unvalidatedJson`

| File                                                                                  | Migration                          |
| ------------------------------------------------------------------------------------- | ---------------------------------- |
| `lib/revenue/revenue.ts`                                                              | Use Orval client + Zod parse       |
| `components/features/dashboard/app-shell/app-shell.tsx`                               | Generated clients for agents/tasks |
| `components/features/dashboard/product-dashboard-client/product-dashboard-client.tsx` | Shrink as routes extract           |

## `directFetch`

| File                      | Notes                                              |
| ------------------------- | -------------------------------------------------- |
| `lib/auth/proxy.ts`       | Server-side upstream; keep or wrap in typed helper |
| `lib/auth/rowboat-api.ts` | Server-only broker calls                           |

## `asyncIntervals`

Polling routes should use TanStack Query `refetchInterval` (report already does).

## Completion criterion

Delete the file path from the allowlist in the **same PR** that lands the fix.
