# Rowboat Desktop as the Cross-Portfolio Cockpit

**How the desktop app ships on top of the data already held by Canvas, Corinthian, and Cadence — federating three financial systems-of-record with the user's lived context, on hardware the user owns.**

> Status: architecture proposal. Companion to `one-pager-product.md`, `one-pager-investor.md`, and `roadmap-2026-2046.md`. Implements the technical layer of the **Model B** portfolio strategy (shared runtime, separate brands): the three SaaS keep their own buyers; the desktop app is the one surface where the end-user feels the whole portfolio as a single coworker they own.

---

## 1. The thesis in one paragraph

Oppulence runs three SaaS products, and each is a **system of record for one slice of financial truth** — Canvas owns the revenue/AR graph, Cadence owns the AP/vendor/spend graph, Corinthian owns the AR *communication and behavioral* memory. By design, none of them can see into the others, and none of them can see the user's email, calendar, or meetings. Rowboat Desktop already owns the fourth slice — the **relationship context** — as a local Markdown vault, and it is an **MCP client**. Two of the three SaaS already expose **MCP servers**. So "shipping the desktop app on top of their data" is not a rebuild: it is mounting those servers, mirroring their entities into the user-owned vault, and letting one agent reason and act across all four planes under a single review surface. The product that results — a note that fuses AR aging, AP exposure, the email thread, and last week's call into one file the user owns — is something **no single product in the portfolio can produce**, because each is structurally blind to the others.

---

## 2. Why the architecture already fits

| Capability | Where it lives | Evidence |
|---|---|---|
| Rowboat consumes **remote HTTP MCP servers with bearer auth** | desktop | Fireflies is mounted exactly this way: `apps/x/packages/core/src/knowledge/fireflies-client-factory.ts:11` (`https://api.fireflies.ai/mcp`), bearer at `:197` |
| MCP server registry, `http` + `stdio` transports | desktop | `apps/x/packages/core/src/mcp/repo.ts:10` reads `~/.rowboat/config/mcp.json`; client lifecycle + `StreamableHTTPClientTransport` in `mcp.ts:22` |
| Agent calls any MCP tool as `mcp:server:tool` | desktop | `apps/x/packages/core/src/application/lib/exec-tool.ts:19` |
| Canvas **already exposes an MCP server** (`oppulence`, 11 tool domains) | Canvas | `oppulence-canvas/packages/api/src/mcp/` + `rest/routers/mcp.ts`, `@hono/mcp` StreamableHTTP at `/mcp` |
| Corinthian **already exposes an MCP server** (141 tools, 10 prompts, governance) | Corinthian | `oppulence-canvas/corinthian/corinthian-mcp/src/server.ts:385` (`createCorinthianMcpServer`) |
| Cadence has MCP *consumer* infra but **no server yet** | Cadence | `oppulence-billflowap/packages/db/schema.ts:2257` (`mcpServers`, `workflowMcpServer`); exposes REST + a Claude "Copilot API" (`apps/copilot-api`, port 8080) instead |

The net: **Canvas and Corinthian need nothing new** to be read by the desktop. Cadence is the only integration gap, and it has two clean paths (a thin MCP shim over its REST routes, or a `sync_cadence.ts` connector against `/api/workspaces/:id/...`).

---

## 3. The four data planes

Each plane is a system of record. Each is blind to the other three. That blindness is the opportunity.

```
RELATIONSHIP PLANE  (Rowboat already owns — local vault)
  Gmail threads · Google Calendar · Fireflies transcripts
  → sync_gmail.ts · sync_calendar.ts · sync_fireflies.ts

REVENUE / AR PLANE  (Canvas)
  invoices · customers · transactions · bank_accounts · dunning_* ·
  collection_cases · promises_to_pay · ar_aging_snapshots · forecasts · tracker_*
  → oppulence-canvas/packages/db/src/schema.ts (118+ tables, Postgres + Drizzle)

AR EXECUTION / MEMORY PLANE  (Corinthian)
  inboxThreads · inboxTimelineEntries · clients · disputes · payments ·
  recurring · insights  +  outcome-labeled reminder/promise history
  → oppulence-canvas/corinthian/corinthian-db/src/schema/ (Postgres + Drizzle)

AP / SPEND PLANE  (Cadence)
  vendor (deduped master) · invoice (extracted line-items + GL codes) ·
  approval_rule / invoice_approval · payment_matches · bank_transaction ·
  ap_reconciliation_* (3-way recon, confidence-scored)
  → oppulence-billflowap/packages/db/schema.ts (Postgres 17 + pgvector + Drizzle)
```

What only the SaaS know (and email/calendar/meetings never will): the **counterparty payment graph** (who pays whom, how fast — Canvas), **outcome-labeled collections memory** (which tone/step converts — Corinthian), and the **vendor master + 3-way reconciliation state** (what we owe, on which rail, matched to which bank clearing — Cadence).

---

## 4. The four integration seams

Each seam already has a landing point in the desktop codebase. We lead with ① and ②.

### ① Read — mount each SaaS as an MCP server *(Phase 1)*
Add HTTP MCP entries to `~/.rowboat/config/mcp.json`. The agent immediately gains Corinthian's high-level tools — `collections_prioritize`, `customer_account_review`, `reports_ar_aging`, `draft_customer_followup`, `collections_next_best_action` — and Canvas's transaction/forecast/search tools. **No new ingestion code**; this is the Fireflies pattern (`fireflies-client-factory.ts`).

### ② Mirror — sync entities into the vault as backlinked notes *(Phase 1)*
Write `sync_canvas.ts` (and later `sync_cadence.ts`) following the existing factory + loop + `createEvent` shape (`sync_gmail.ts:143`, `sync_calendar.ts:115`, `sync_fireflies.ts:423`). Each customer/vendor/deal becomes a Markdown note under `~/.rowboat/knowledge/`. **This is the step that makes the data user-owned and joinable** — not just queryable. Register the connector in `apps/x/apps/main/src/main.ts` alongside the existing syncs.

### ③ Watch — turn SaaS events into live-note triggers *(Phase 2)*
Canvas emits real-time job/workflow events (ElectricSQL shape subscriptions); Cadence and Corinthian fire webhooks. Land them as `RowboatEvent` JSON in `~/.rowboat/events/pending/` (schema in `apps/x/packages/shared/src/events.ts`; consumer at `live-note/event-consumer.ts:31`). A `live:` note then refreshes on a *real AR/AP event* — a broken promise-to-pay, a payment cleared, a new overdue invoice — not just a cron tick.

### ④ Act — closed-loop actions under dual review *(Phase 3)*
The agent calls write-tools (`reminders_send`, `payments_record`, Cadence `batch-approve`). Trust is enforced **twice**: Rowboat's "every action is reviewable before it lands" *plus* Corinthian's server-side approval tokens for money-moving actions (`corinthian-mcp/src/lib/approvals.ts`) and policy gates (`policy.ts`: read-only mode, deny-destructive, batch caps; `tool-packs.ts`: `--tool-pack ar`). Defense in depth: neither side trusts the other blindly.

---

## 5. The signature artifact

The whole proposition reduces to one file the user owns, that no single product could write:

```markdown
---
title: Acme Corp
live:
  objective: >
    Keep Acme's full commercial picture current — AR position from Canvas/Corinthian,
    what we owe their subcontractors from Cadence, and the live email/meeting context.
  triggers:
    eventMatchCriteria: "Any email from *@acme.com OR any Corinthian payment/promise event for Acme"
    cronExpr: "0 8 * * 1"   # Monday 8am refresh regardless
---

## Money
- **They owe us** $48k — AR aging 54-day DSO, 2 broken promises-to-pay      ← Corinthian
- **We owe their subcontractor** $12k — NET-30, clears Friday               ← Cadence
- Last dunning step ignored; empathetic tone historically converts here     ← Corinthian outcome data

## Relationship
- Renewal-pricing thread open 3 days, unanswered                            ← Gmail
- QBR last Tue: champion flagged a Q3 budget freeze                         ← Fireflies
- Next call: Thursday 2pm                                                   ← Calendar
```

Canvas can't write the budget-freeze line. Granola can't write the AR line. Cadence can't see the relationship. The desktop app writes all of them — locally, in a file the user can open in Obsidian.

---

## 6. Build sequence

**Phase 1 — Read + Mirror (the chosen first surface).** Mount Canvas + Corinthian MCP via `mcp.json`; ship `sync_canvas.ts` to mirror customers/AR into the vault and join them to existing People/Company notes. Outcome: the Acme note above, minus live triggers. Lowest risk (read-only), fastest (the servers already exist).

**Phase 2 — Watch.** Wire Canvas/Corinthian/Cadence events into `events/pending/`; ship live financial notes ("cash position this week", "vendors due Friday", "accounts at risk").

**Phase 3 — Act.** Enable write-tools through Corinthian's approval-token + policy rails, surfaced in Rowboat's existing review UI.

**Cadence onboarding** (parallel track): build the thin MCP shim over Cadence REST, or a `sync_cadence.ts` connector — so the AP plane joins the same pattern as Canvas/Corinthian.

---

## 7. Brand discipline (Model B) and the `corinthian-desktop` overlap

`corinthian-desktop` already exists — a **Tauri 2 shell** that wraps the Corinthian *web UI* for the single-product AR buyer (`corinthian/corinthian-desktop/`). It is **not** a cross-product corpus, and it is not in competition with this proposal:

- **`corinthian-desktop`** = in-brand native app for the Canvas/Corinthian buyer who lives in AR all day.
- **Rowboat Desktop** = the cross-brand sovereign cockpit for the operator who lives *across* AR, AP, and their inbox.

This is exactly the Model B line: separate brands and buyers, shared runtime. The one rule to hold: **don't ship two desktop icons to the same person.** A user who buys Corinthian gets `corinthian-desktop`; a user who wants the federated view gets Rowboat. The federation is opt-in and additive, never a second copy of the same product.

---

## 8. Open questions / risks

- **Auth UX.** Each SaaS mount needs a token (Canvas is an OAuth provider; Cadence mints `bfap_*` keys). The desktop needs a clean "connect Canvas / connect Cadence" flow rather than hand-edited `mcp.json`.
- **Mirror freshness vs. cost.** Decide per-entity whether to mirror-into-vault (joinable, owned, but must stay fresh) or query-on-demand over MCP (always fresh, but not a file the user owns). Likely: mirror the *durable identity* (the customer/vendor note) and query the *volatile numbers* (today's balance) on demand.
- **Tenant scoping.** Canvas/Corinthian/Cadence are all team/workspace-scoped with RLS. The desktop must pin the right tenant per mount and never blend tenants in one vault.
- **Cadence MCP shim ownership.** Whether the shim lives in `oppulence-billflowap` (Cadence team owns it, like Canvas does) or as a desktop-side connector. Prefer the former for parity.

---

## Appendix A — `~/.rowboat/config/mcp.json` (Phase 1)

```jsonc
{
  "servers": {
    "canvas": {
      "type": "http",
      "url": "https://app.canvas.<domain>/mcp",
      "headers": { "Authorization": "Bearer ${CANVAS_API_KEY}" }
    },
    "corinthian": {
      "type": "http",
      "url": "https://api.corinthian.<domain>/mcp",
      "headers": { "Authorization": "Bearer ${CORINTHIAN_API_KEY}" }
    }
    // cadence added in the parallel track, once its MCP shim ships
  }
}
```
Parsed by `apps/x/packages/core/src/mcp/repo.ts:10`; consumed by the agent as `mcp:canvas:reports_ar_aging`, `mcp:corinthian:collections_prioritize`, etc.

## Appendix B — `sync_canvas.ts` skeleton (Phase 1)

Mirrors the proven shape of `sync_gmail.ts` / `sync_fireflies.ts`:

```ts
// apps/x/packages/core/src/knowledge/sync_canvas.ts
const SYNC_DIR = path.join(WorkDir, 'knowledge/People');
const SYNC_INTERVAL_MS = 60_000;

async function syncCustomers() {
  // Read over the SAME MCP mount the agent uses — no second auth path.
  const customers = await executeTool('canvas', 'customers_list', {});
  for (const c of customers) {
    const md = renderCustomerNote(c);                 // backlinked Markdown
    upsertNote(path.join(SYNC_DIR, `${c.name}.md`), md); // preserves user edits + live: block
    await createEvent({ source: 'canvas', type: 'customer.synced', payload: digest(c) });
  }
}

export async function init() {
  while (true) {
    try { if (await canvasMounted()) await syncCustomers(); }
    catch (err) { console.error(err); }
    await interruptibleSleep(SYNC_INTERVAL_MS);
  }
}
```
Register in `apps/x/apps/main/src/main.ts` next to the existing `init()` calls. Note `upsertNote` must merge-preserve frontmatter the way `live-note/fileops.ts:patchLiveNote` does, so a synced note can *also* be a live note.

---

## One line

**Rowboat Desktop is the sovereign cockpit over your financial operating system — the one place AR, AP, and your inbox become a single coworker you own.**
