# Oppulence desktop usability audit

Date: 2026-08-02  
Mode: Combined UX and accessibility audit  
Method: Direct use of the running Electron app with mouse, keyboard, and the macOS accessibility tree. No product data was created, deleted, sent, or disconnected.

## Overall verdict

Oppulence already exposes a differentiated set of relationship intelligence, evidence, graph, transcription, and approval-gated action capabilities. The primary usability risk is not lack of capability; it is that the interface presents system structure, controls, and competing states before it gives the user one coherent next action. Trust is further weakened by contradictory source-health messaging.

The native 80% page scale creates a second systemic issue: 12–14px CSS text and compact controls render physically smaller, so important copy, targets, dialogs, and graph labels are difficult to scan even on a large display.

## Highest-impact defects

1. **Critical — source-health status contradicts itself.** The relationship header says Google, HubSpot, and Slack are stale and that three sources need attention. Opening “All caught up” says “All services up to date,” then shows repeated memory-index implementation events. Users cannot know whether the account intelligence is trustworthy.
2. **High — 80% page scaling makes the product materially harder to read and operate.** Dense 12px type becomes roughly 9.6 physical pixels; many controls appear close to 22–28 physical pixels tall. This is especially visible in settings, connection rows, graph labels, and dialogs.
3. **High — navigation vocabulary and destination behavior are inconsistent.** “Knowledge” opens a “Notes” page and “Notes” tab; “Workspaces” opens “Workspace.” Normal sections accumulate persistent tabs, while Relationships behaves like a special destination and does not appear in the same tab model.
4. **High — the Relationship Graph is feature-rich but visually unreadable at default density.** Labels overlap nodes and one another; the search field floats over the bottom of the canvas; a selected node improves emphasis but the overall cluster remains difficult to parse.
5. **High accessibility risk — graph nodes activate by keyboard but are not exposed as focused controls in the macOS accessibility tree.** Tabbing reaches unnamed/unreported objects and Enter updates the inspector. A screen-reader user may not know which node is focused before activating it.
6. **High — Mission Control buries accounts beneath an eight-row triage queue.** Source degradation, recommendations, and customer risks are mixed together with equal-weight Review/Snooze/Dismiss actions. The first account records sit below the initial viewport.
7. **High — “Why this rank?” exposes implementation scores rather than explaining the decision.** “Relationship +25 · Urgency +34 · Value +35 · State v1 · detector v1” is not meaningful evidence to an account owner.
8. **High — AI coworker suggestions are not contextual.** On a selected relationship evidence node, the panel still suggests generic email, background-task, and research prompts. Expanding the pane removes the relationship workspace entirely without retaining a visible context chip or breadcrumb.
9. **High — the example natural-language graph query produces an internally inconsistent result.** “Which renewals depend on overdue commitments?” reports zero matching relationships and zero evidence references while rendering Northstar Labs as the single matching node. “Showing 1 of 29 nodes · raise density for more” makes it unclear whether the answer is empty, truncated, or filtered incorrectly.
10. **Medium — several empty states preserve irrelevant controls and duplicate CTAs.** Email retains Search/Refresh while disconnected; Chat history retains Search despite having no chats; Background tasks and Workspaces each show both header and center creation actions.
11. **Medium — Connections does not distinguish connected from available.** “Connected accounts” contains Connect buttons for the full catalog, then “Available tools” repeats the catalog below. Provider brand marks are also replaced by generic symbols or initials.
12. **Medium — Meetings permits entry into a known-broken capture path.** “Take meeting notes” remains the strongest enabled action while the same screen reports no usable default input device.
13. **Medium — Transcription settings combine too many mental models.** Privacy, cloud/local voice input, model downloads, benchmarking, meeting capture, relationship evidence, automation, coaching, retention, and troubleshooting live in one long page. The selected cloud voice route and active local meeting route are accurate but difficult to reconcile.

## Confirmed strengths

- Relationship recommendations include a concise account-specific reason and visible health/freshness.
- Proposed follow-ups are separated from “Open complete record,” supporting approval-gated action.
- The graph includes Portfolio/Account modes, layouts, fit/reset/zoom, minimap, table fallback, historical view, saved views, sharing, and neighborhood focus.
- Calendar dates have full accessible labels, and the workspace dialog correctly moves focus into the Name field.
- Most icon-only controls expose an accessible name.
- Meeting and transcription copy is unusually transparent about local versus cloud processing and two-track recording.

## Audited journey

1. **Relationship graph table — Needs work.** The table is a valuable accessible fallback, but the long unfiltered inventory and compact typography create a scanning burden. Evidence: [01-relationship-graph-table.png](01-relationship-graph-table.png).
2. **Home dashboard — Needs work.** Key cards are understandable, but the page is sparse, the hierarchy is weak at 80%, and integrations use initials instead of recognizable provider marks. Evidence: [02-home-dashboard.png](02-home-dashboard.png).
3. **Disconnected email — Poor.** The correct recovery CTA exists, but irrelevant Search/Refresh controls remain and the main action is visually tiny in a mostly empty canvas. Evidence: [03-email-disconnected.png](03-email-disconnected.png).
4. **Meetings and preflight — Blocked but informative.** The screen correctly detects the missing input, but still promotes “Take meeting notes” as if recording can succeed. Evidence: [04-meetings-device-blocker.png](04-meetings-device-blocker.png).
5. **Knowledge/Notes — Needs work.** Basic folder actions are discoverable, but navigation, tab, and page names disagree. Evidence: [05-knowledge-notes-mismatch.png](05-knowledge-notes-mismatch.png).
6. **Mission Control queue — Needs major simplification.** The queue explains what changed, but dominates the experience and mixes customer work with connector maintenance. Evidence: [06-relationship-mission-control.png](06-relationship-mission-control.png), [07-recommendation-ranking-explanation.png](07-recommendation-ranking-explanation.png).
7. **Graph exploration — Promising but difficult to read.** Controls and inspector are strong; default label collision and overlay placement impair sense-making. Evidence: [08-relationship-graph-canvas.png](08-relationship-graph-canvas.png), [09-graph-historical-calendar.png](09-graph-historical-calendar.png), [15-graph-keyboard-node-inspector.png](15-graph-keyboard-node-inspector.png).
8. **Settings and transcription — Capable but overwhelming.** The settings map is comprehensive, but duplicates its navigation as cards and has no obvious search. Transcription is too long for one surface. Evidence: [10-settings-overview.png](10-settings-overview.png), [11-transcription-settings.png](11-transcription-settings.png).
9. **Chat discovery/history — Poor empty-state guidance.** History first opens a one-item menu, then a large empty table while the always-open coworker panel duplicates New chat. Evidence: [12-chat-history-empty-menu.png](12-chat-history-empty-menu.png), [13-chat-history-view.png](13-chat-history-view.png).
10. **Connections — Confusing information architecture.** “Connected” and “available” catalogs are not visually or semantically separated. Evidence: [14-connections-duplicate-catalog.png](14-connections-duplicate-catalog.png).
11. **Navigation and AI pane modes — Needs work.** Collapsing the sidebar removes destination shortcuts rather than retaining an icon rail. Expanding chat erases visible work context and leaves excessive empty space. Evidence: [16-collapsed-navigation.png](16-collapsed-navigation.png), [17-expanded-ai-coworker.png](17-expanded-ai-coworker.png).
12. **System status — Critical trust defect.** “All services up to date” conflicts with the stale-source state and surfaces internal memory-index churn. Evidence: [18-sync-status-contradiction.png](18-sync-status-contradiction.png).
13. **Background tasks — Fair.** The empty state explains the capability and provides an action, though it duplicates the header CTA. Evidence: [19-background-tasks-empty.png](19-background-tasks-empty.png).
14. **Workspaces — Needs work.** “Workspace” versus “Workspaces” is inconsistent, Open in Finder is active with no workspace, and creation is duplicated. The dialog explains the implementation folder rather than the user benefit. Evidence: [20-workspaces-empty.png](20-workspaces-empty.png), [21-new-workspace-dialog.png](21-new-workspace-dialog.png).
15. **Natural-language graph query — Defective.** The exact example query returns a zero-match answer while leaving one matching account node visible and no evidence-linked explanation. Evidence: [22-natural-language-graph-query.png](22-natural-language-graph-query.png).

## Recommended sequence

### Now

- Establish one source-health model and use it in the sidebar, Mission Control, status popover, and connection settings.
- Keep native 100% visual scale and create density through layout tokens rather than page zoom; at minimum, preserve 12–14px physical text and 36–44px physical targets.
- Normalize labels and routing: Knowledge or Notes, Workspaces or Workspace, and one predictable tab rule.
- Gate meeting capture when preflight has a blocking input-device failure.
- Make AI suggestions context-aware and preserve a visible context chip when chat expands.

### Next

- Split Mission Control into “Customer actions” and “Data/source maintenance,” collapse lower-priority rows, and make the top next action unmistakable.
- Replace ranking internals with a plain-language explanation and links to evidence.
- Add collision-aware graph labels, default relationship clustering, zoom-dependent label visibility, and a non-overlapping search/control rail.
- Expose each SVG node to assistive technology with a stable role, name, selected state, and visible focus; announce inspector changes.
- Make graph-query result counts, rendered nodes, and evidence references derive from one result object; explain partial/truncated results instead of suggesting density as a remedy.
- Make Connections a true stateful inventory: Connected first, Needs attention second, Available catalog last.

### Later

- Reduce settings to a searchable index and task-based groups; use progressive disclosure for transcription.
- Replace generic and duplicated empty states with one primary action plus a short preview of the value users will receive.
- Retain useful destination icons in collapsed navigation and provide a clear active-location indicator.

## First-round remediation verification

This verification applies to the first-round findings above. A deeper user-style walkthrough surfaced additional defects and recovery gaps; see [Round 2](ROUND-2.md).

Status: **all audited defects addressed and rechecked in the running development app on 2026-08-02.**

1. Source health now comes from one relationship-source model in Mission Control, the sidebar footer, the status popover, and Connections. The popover reports the same three stale sources and no longer exposes memory-index churn or an “all up to date” contradiction.
2. The native 80% page zoom was removed. The desktop renders at native scale with the shared Inter typography and control sizing.
3. Navigation now consistently uses **Knowledge** and **Workspaces**, and Relationships participates in the active tab model.
4. The default graph uses relationship clustering, zoom-dependent labels, a non-overlapping search rail, clearer selected edges, and a calmer dot-free canvas.
5. Every graph node has a stable keyboard-operable HTML control with an accessible name; inspector changes are announced. The synchronized table now has a node filter and result count.
6. Mission Control puts the account list first, shows only the three most urgent customer actions initially, and moves source issues into collapsed **Data maintenance**.
7. Ranking internals were replaced with plain-language **Why this matters** explanations and evidence-oriented actions.
8. The AI pane retains a visible **Working with** context in compact and expanded modes and offers relationship-, email-, meeting-, knowledge-, workspace-, and task-aware suggestions.
9. Natural-language graph results now derive their answer, rendered node set, and evidence count from one result object. The audit query correctly reports zero matches without rendering an unrelated account.
10. Disconnected Email, empty Chat history, Background tasks, and Workspaces each present one relevant primary action and hide irrelevant or duplicated controls.
11. Connections is now divided into **Connected**, **Needs attention**, and **Available**, uses recognizable provider marks, and times out a stalled status check instead of showing “Checking…” forever.
12. Meetings disables the primary capture action when microphone preflight has a blocking input-device failure and presents a direct route to Transcription settings.
13. Transcription now leads with Privacy and Voice input while progressively disclosing model management and meeting capture/evidence configuration.
14. Collapsed navigation retains named destination icons while hiding wrapping recents, billing, and footer labels. Connect Accounts, Settings, and source attention remain available as named icon controls.
15. The shared Shadcn date/time picker closes when focus moves to another workflow, preventing its portal from persisting over Settings.

Verification completed:

- Direct mouse/keyboard/accessibility-tree walkthrough of Mission Control, graph canvas and table, graph query, date picker, Connections, Transcription, Meetings, disconnected Email, Chat history, Background tasks, Workspaces, and expanded/collapsed navigation.
- Renderer TypeScript check and production Vite build passed.
- Relationship contract tests: 13 passed.
- Desktop graph-cache tests: 2 passed.
- Desktop core tests: 731 passed, 5 skipped.
- `git diff --check` passed.

## Evidence limits

- No microphone or system-audio recording was started because that would capture environmental audio and could trigger a permission flow.
- No connector OAuth flow, account disconnect, model download, AI prompt submission, background task, note, or workspace was created.
- Visual and macOS accessibility-tree evidence can identify likely WCAG risks, but this is not a full compliance claim. Automated contrast measurements, VoiceOver speech output, reduced-motion behavior, and alternate window sizes still require dedicated testing.
