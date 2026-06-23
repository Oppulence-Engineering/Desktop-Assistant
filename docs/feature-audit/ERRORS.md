# ERRORS — Phase 2 Testing Findings (Rowboat Desktop `apps/x`)

Defects found by tracing every user story in `FEATURE_AUDIT.csv` through renderer -> IPC -> core. Each finding carries `file:line` evidence so it is independently checkable. `Status` tracks Phase 3 fixes.

**Totals:** 62 issues — High 3, Medium 31, Low 28 · Logistical 32, UX 30 · Open 0, Deferred 6, Fixed 0, Verified 56.

> **Deferred** items are unreachable/unshipped feature surfaces or false-provenance toggles whose correct resolution (wire up the whole surface vs remove intentional WIP) is a product decision, not a contained bug fix. They are documented, not silently changed.

## High severity (3)

### E06 — Memory: Related notes sidebar · Logistical · _Verified_

- **Feature rows:** F119
- **Issue:** EditorToolbar references onOpenRelated (lines 415/417/420) but never destructures it from props; tsc -b fails (TS2304) so the renderer production build is broken, and the Related button is non-functional.
- **Evidence:** apps/x/apps/renderer/src/components/editor-toolbar.tsx:48,66-73,415-420; apps/x/apps/renderer/src/components/markdown-editor.tsx:1807
- **Proposed fix:** Add onOpenRelated to the destructured props in EditorToolbar.

### E40 — Composio: Migration qualification · Logistical · _Verified_

- **Feature rows:** F412
- **Issue:** The "already migrated" early-out checks the legacy literal mode==='rowboat', but native managed Google connects stamp mode='solomon'; a signed-in native-Google user who still has a Composio Gmail/Calendar account falls through and has it silently deleted plus a spurious reconnect modal.
- **Evidence:** apps/x/packages/core/src/migrations/composio-google-migration.ts:110; apps/x/apps/main/src/oauth-handler.ts:579
- **Proposed fix:** Replace the literal check with isManagedAuthMode(googleConnection.mode) so both solomon and legacy rowboat early-out.

### E55 — Voice Commands: Voice command mode flow · Logistical · _Deferred_

- **Feature rows:** F518
- **Issue:** The entire voice-command surface is dead code with no UI entry point: neither useVoiceCommandMode nor VoiceCommandConfirmation is imported in the renderer, and dictation routes the transcript straight to the composer, so voice:parseCommand/executeCommand are unreachable.
- **Evidence:** apps/x/apps/renderer/src/hooks/useVoiceCommandMode.ts:16; apps/x/apps/renderer/src/components/voice-command-confirmation.tsx:20; apps/x/apps/renderer/src/App.tsx:981-992,1108-1138
- **Proposed fix:** Wire useVoiceCommandMode + VoiceCommandConfirmation into a surface and supply real emailActions, or remove the dead feature.

## Medium severity (31)

### E01 — Chat: Ask-human request · Logistical · _Verified_

- **Feature rows:** F045
- **Issue:** In the docked copilot side pane, agent ask-human questions with predefined options render a free-text box instead of option buttons because options is not forwarded to AskHumanRequest.
- **Evidence:** apps/x/apps/renderer/src/components/chat-sidebar.tsx:719-726; apps/x/apps/renderer/src/components/ai-elements/ask-human-request.tsx:27
- **Proposed fix:** Pass options={request.options} to AskHumanRequest in chat-sidebar.tsx.

### E02 — Chat: Switch coding agent · UX · _Verified_

- **Feature rows:** F043
- **Issue:** The "Use Claude/Codex instead" swap-and-retry button never appears in the docked pane because onSwitchAgent is not wired (works only in full-screen chat).
- **Evidence:** apps/x/apps/renderer/src/components/chat-sidebar.tsx:700-709; apps/x/apps/renderer/src/components/ai-elements/permission-request.tsx:261-272
- **Proposed fix:** Thread an onSwitchAgent handler into ChatSidebar's PermissionRequest.

### E03 — Chat: App action card · UX · _Verified_

- **Feature rows:** F039
- **Issue:** app-navigation tool calls show a raw-JSON Tool card in the docked pane instead of the friendly AppActionCard used full-screen.
- **Evidence:** apps/x/apps/renderer/src/components/chat-sidebar.tsx:439-491; apps/x/apps/renderer/src/App.tsx:6139-6141
- **Proposed fix:** Add a getAppActionCardData branch rendering AppActionCard in chat-sidebar renderConversationItem.

### E04 — Chat: @ file mentions · Logistical · _Verified_

- **Feature rows:** F028
- **Issue:** When the caret follows an unmatched @token, the mention popover's capture-phase keydown listener intercepts Enter/Arrows (preventDefault) even when the filtered list is empty, blocking message submit with no feedback.
- **Evidence:** apps/x/apps/renderer/src/components/mention-popover.tsx:99-106,126-136; apps/x/apps/renderer/src/components/ai-elements/prompt-input.tsx:1027-1031
- **Proposed fix:** Gate the popover key handler on filtered list length > 0 so Enter falls through to submit when empty.

### E05 — Chat: Model selector · Logistical · _Verified_

- **Feature rows:** F023
- **Issue:** Before any pick the composer labels configuredModels[0] as selected, but a run created without an explicit pick uses cfg.model (config default) which the renderer never reads, so displayed model can differ from the one used.
- **Evidence:** apps/x/apps/renderer/src/components/chat-input-with-mentions.tsx:412-432,1165-1172; apps/x/packages/core/src/models/defaults.ts:22-29
- **Proposed fix:** Initialize the composer's selected model from the config active default so shown and used model agree.

### E07 — Editor: Strikethrough · Logistical · _Verified_

- **Feature rows:** F067
- **Issue:** The on-save serializer nodeToText emits bold/italic/code/link but drops the strike mark, so strikethrough applied via the toolbar is lost from disk on the next edit (round-trip data loss).
- **Evidence:** apps/x/apps/renderer/src/components/markdown-editor.tsx:90-97,885; apps/x/apps/renderer/src/components/editor-toolbar.tsx:172-181
- **Proposed fix:** Add a strike branch emitting ~~text~~ to nodeToText's mark loop.

### E08 — Editor: Export note · Logistical · _Verified_

- **Feature rows:** F078
- **Issue:** Export -> Markdown writes tabContent (editor body only); frontmatter is split off at open and not rejoined, so exported .md files lose all YAML frontmatter.
- **Evidence:** apps/x/apps/renderer/src/App.tsx:6886,6822-6826,1716-1718; apps/x/apps/main/src/ipc.ts:1183-1185
- **Proposed fix:** Rejoin frontmatter before exporting the md format.

### E12 — Live Notes: Active toggle in panel · UX · _Verified_

- **Feature rows:** F158
- **Issue:** Toggling the panel Active switch overwrites both live and draft with the server response, silently discarding unsaved objective/trigger edits.
- **Evidence:** apps/x/apps/renderer/src/components/live-note-sidebar.tsx:187-207,532-533
- **Proposed fix:** In handleToggleActive only update the active flag and merge it into the existing draft (preserve other draft fields).

### E13 — Live Notes: Scheduled auto-refresh · Logistical · _Verified_

- **Feature rows:** F169
- **Issue:** The disk backoff anchor lastAttemptAt is written after createRun/model-resolution and the failure try/catch starts after the bus publish; a setup throw escapes the failure branch (no lastRunError, no backoff), so window triggers re-fire every 15s on persistent setup failure.
- **Evidence:** apps/x/packages/core/src/knowledge/live-note/runner.ts:111-203; apps/x/packages/core/src/knowledge/live-note/scheduler.ts:51-66
- **Proposed fix:** Bump lastAttemptAt and wrap the whole run body so setup failures record lastRunError and the backoff anchor.

### E19 — Navigation: Back navigation · Logistical · _Verified_

- **Feature rows:** F229
- **Issue:** openEmailView/openMeetingsView/openBgTasksView mutate view flags directly and never push the prior view onto the back stack, so Back skips the view you came from.
- **Evidence:** apps/x/apps/renderer/src/App.tsx:4338-4401,4668-4684
- **Proposed fix:** Route these through navigateToView so the previous view is recorded in history.

### E20 — Navigation: Centralized view-state · Logistical · _Verified_

- **Feature rows:** F228
- **Issue:** currentViewState lists isBgTasksOpen as a dep but has no bg-tasks branch and ViewState has no bg-tasks variant, so while Background Tasks is open it resolves to chat — recording a phantom chat history entry and preventing Back to bg-tasks.
- **Evidence:** apps/x/apps/renderer/src/App.tsx:4157-4190,650-662
- **Proposed fix:** Add a bg-tasks ViewState variant plus currentViewState/applyViewState branches.

### E21 — Workspace: Inline rename · Logistical · _Verified_

- **Feature rows:** F269
- **Issue:** WorkspaceView rename calls workspace:rename directly, skipping the migration knowledgeActions.rename performs (tab path update, cache migration, wiki-link rewrite), so renaming an open file leaves the tab on a stale path.
- **Evidence:** apps/x/apps/renderer/src/components/workspace-view.tsx:202-219; apps/x/apps/renderer/src/App.tsx:5534-5584
- **Proposed fix:** Route Workspace rename through the App-level knowledgeActions.rename.

### E22 — Workspace: Path-safety guard · Logistical · _Verified_

- **Feature rows:** F276
- **Issue:** resolveShellPath returns absolute/~ paths unchanged and shell:openPath/showItemInFolder/readFileBase64 accept any string, bypassing the workspace sandbox every workspace:\* channel enforces.
- **Evidence:** apps/x/apps/main/src/ipc.ts:210-220,1078-1094; apps/x/packages/shared/src/ipc.ts:696-707
- **Proposed fix:** Constrain resolveShellPath to the workspace root (or an explicit allowlist); do not pass through arbitrary absolute paths.

### E23 — Bases: Row context menu · UX · _Verified_

- **Feature rows:** F288
- **Issue:** BasesView rename swallows failures with empty catch and shows no toast; delete is fire-and-forget with no toast and an unhandled rejection on failure (inconsistent with Workspace).
- **Evidence:** apps/x/apps/renderer/src/components/bases-view.tsx:860-883,940-943
- **Proposed fix:** Await and toast on success/failure for Bases rename and delete to match Workspace.

### E24 — Workspace: Add files · Logistical · _Verified_

- **Feature rows:** F266
- **Issue:** Folder upload writes each file to currentPath/rel with no uniqueChildPath dedup, silently overwriting colliding workspace files (single-file upload dedups).
- **Evidence:** apps/x/apps/renderer/src/components/workspace-view.tsx:233-265,107-120
- **Proposed fix:** Apply dedup (or confirm-overwrite) on the preserve-structure path.

### E30 — Background Tasks: Live agent run status · Logistical · _Verified_

- **Feature rows:** F318
- **Issue:** On task complete the status store schedules an unconditional delete(key) after 5s; a new run for the same slug within that window gets its running state wiped (Stop button vanishes).
- **Evidence:** apps/x/apps/renderer/src/hooks/use-bg-task-agent-status.ts:34-45
- **Proposed fix:** Capture the completing runId and only delete if the stored entry still has that runId.

### E31 — Coding: Permission decision resolution · Logistical · _Verified_

- **Feature rows:** F339
- **Issue:** handleCodePermissionResponse clears pendingCodePermission before invoking codeRun:resolvePermission and swallows errors; if the invoke throws the coding turn blocks indefinitely with no card.
- **Evidence:** apps/x/apps/renderer/src/App.tsx:3138-3152; apps/x/packages/core/src/code-mode/acp/permission-registry.ts:18-32
- **Proposed fix:** Await the invoke first (re-show card / toast on failure) before clearing pendingCodePermission.

### E32 — Coding: Warm-connection reuse · Logistical · _Verified_

- **Feature rows:** F344
- **Issue:** manager.ensureRun reuses an existing ActiveRun on agent+cwd match with no check the adapter child is still alive; an adapter crash within the 60s grace makes every subsequent turn reject until idle dispose.
- **Evidence:** apps/x/packages/core/src/code-mode/acp/manager.ts:152-157,116-130; apps/x/packages/core/src/code-mode/acp/client.ts:118-120
- **Proposed fix:** Detect a dead/exited child and dispose+cold-start instead of reusing.

### E33 — Background Tasks: Create task · UX · _Verified_

- **Feature rows:** F303, F304
- **Issue:** After creating a task the dialog fires the first run as void invoke, ignoring {success,error}; a failed first run (API task while signed out) gives zero feedback.
- **Evidence:** apps/x/apps/renderer/src/components/bg-tasks-view.tsx:3249-3256
- **Proposed fix:** Await the first-run invoke and toast on failure, matching runNow.

### E41 — MCP: MCP client connect · Logistical · _Verified_

- **Feature rows:** F417
- **Issue:** The StreamableHTTP->SSE fallback is unreachable: the try/catch wraps only the transport constructor, not client.connect, so a server that only speaks SSE never triggers the fallback and is marked permanently error.
- **Evidence:** apps/x/packages/core/src/mcp/mcp.ts:42-48,59
- **Proposed fix:** Move the HTTP->SSE fallback around client.connect (try StreamableHTTP, on connect failure construct+connect SSE).

### E42 — OAuth: Generic backend connector connect · Logistical · _Deferred_

- **Feature rows:** F396
- **Issue:** The connector broker flow (connectors:connect IPC, start/claim, completeConnectorConnect, connection-complete deep link) is fully implemented but no renderer code invokes connectors:connect, so it has no UI entry point (dead).
- **Evidence:** apps/x/apps/main/src/ipc.ts:926-931; apps/x/packages/core/src/connectors/connectors-backend.ts:49-70
- **Proposed fix:** Wire a renderer connect affordance to connectors:connect, or remove the dead channel if not shipping.

### E43 — Slack: Backend Slack workspace install · Logistical · _Deferred_

- **Feature rows:** F427
- **Issue:** slack:connectWorkspace (managed Slack OAuth via API) is implemented but never invoked by any renderer; the only Slack UI uses the local agent-slack CLI flow, leaving two divergent unreachable systems.
- **Evidence:** apps/x/apps/main/src/ipc.ts:932-936; apps/x/apps/main/src/oauth-handler.ts:651-687
- **Proposed fix:** Surface the managed Slack connect in the UI, or remove the dead channel/handler/deeplink branch.

### E44 — OAuth: Generic OAuth connect flow · UX · _Verified_

- **Feature rows:** F390
- **Issue:** On consent denial / provider error, the loopback callback renders an error page but does NOT call onCallback, so connectProvider only resolves via the 2-minute abandoned-flow timeout — user sees a spinner then an unhelpful "timed_out" toast.
- **Evidence:** apps/x/apps/main/src/auth-server.ts:38-61; apps/x/apps/main/src/oauth-handler.ts:529-534
- **Proposed fix:** In the error branch of auth-server invoke onCallback(url) so connectProvider emits a prompt specific failure.

### E45 — MCP: Edit-as-JSON · UX · _Verified_

- **Feature rows:** F416
- **Issue:** The raw-JSON editor renders rawJson which only refreshes on load/save (never from form edits); opening Edit-as-JSON after editing the form shows stale config, and saving from JSON view discards unsaved form edits.
- **Evidence:** apps/x/apps/renderer/src/components/settings/mcp-settings.tsx:117-152,289-304
- **Proposed fix:** Seed rawJson from the serialized form state when toggling JSON view open.

### E51 — Models: Signed-in (Solomon) model settings · Logistical · _Verified_

- **Feature rows:** F473
- **Issue:** When signed in the Settings sidebar filters out the models tab, yet the dialog only renders SolomonModelSettings when activeTab==="models" and no caller passes defaultTab="models", so signed-in users have no path to the model picker (dead UI).
- **Evidence:** apps/x/apps/renderer/src/components/settings-dialog.tsx:1446,1523,1563-1568; apps/x/apps/renderer/src/components/sidebar-content.tsx:1140-1152
- **Proposed fix:** Keep the Models tab visible when signed in (drop the filter) so SolomonModelSettings is reachable.

### E52 — Models: Default model/provider resolution · Logistical · _Verified_

- **Feature rows:** F474
- **Issue:** SolomonModelSettings.handleSave writes the chosen models to config, but for signed-in users getDefaultModelAndProvider/getKgModel return hardcoded curated constants and never read cfg.model, so a signed-in user's saved model choice has no effect (misleading success toast).
- **Evidence:** apps/x/apps/renderer/src/components/settings/model-settings.tsx:896-912; apps/x/packages/core/src/models/defaults.ts:11-15,22-29,67-71
- **Proposed fix:** For signed-in users honor saved config.model/knowledgeGraphModel, falling back to curated defaults only when unset.

### E56 — Transcription: Local diarization beta toggle · UX · _Deferred_

- **Feature rows:** F503
- **Issue:** The on-device meeting beta toggle is non-functional and writes false provenance: the diarization module is never imported in production (local path labels by audio channel only) yet enabling it makes the note claim diarization_provider:local, mode:beta.
- **Evidence:** apps/x/packages/core/src/voice/whisper/streaming.ts:169,280; apps/x/apps/main/src/ipc.ts:1362-1374; apps/x/apps/renderer/src/hooks/useMeetingTranscription.ts:309-317
- **Proposed fix:** Either invoke the Diarizer in the local pipeline, or stop writing local-diarization provenance + remove the beta claim until wired.

### E57 — Schedule: Scheduled run timeout handling · Logistical · _Verified_

- **Feature rows:** F522
- **Issue:** The 30-minute timeout is cosmetic: runAgent passes no AbortController so checkForTimeouts only flips state while the run keeps executing; when the orphaned run completes it re-updates state and double-increments runCount (and can allow a duplicate window run).
- **Evidence:** apps/x/packages/core/src/agent-schedule/runner.ts:147-224,229-259
- **Proposed fix:** Track an AbortController per running agent, abort on timeout, and guard state writes from a timed-out run.

### E58 — Schedule: Immediate apply on schedule change · Logistical · _Verified_

- **Feature rows:** F526
- **Issue:** Editing an agent's schedule does not recompute persisted nextRunAt; updateAgent only upserts config then wakes the runner, so shouldRunNow evaluates the stale nextRunAt and the next fire uses the old schedule (re-enabling with a past nextRunAt runs immediately).
- **Evidence:** apps/x/apps/main/src/ipc.ts:1063-1068; apps/x/packages/core/src/agent-schedule/runner.ts:134-141,193-201
- **Proposed fix:** On upsert recompute and persist nextRunAt from the new schedule (or clear it so the runner re-initializes).

### E59 — Transcription: Model download · UX · _Verified_

- **Feature rows:** F493
- **Issue:** A failed Whisper model download gives no feedback: whisper:ensureModel returns {success:false} (never throws) but download() only handles success and just deletes the progress entry, so the bar vanishes silently.
- **Evidence:** apps/x/apps/renderer/src/components/settings/transcription-settings.tsx:244-266; apps/x/apps/main/src/ipc.ts:1303-1309
- **Proposed fix:** Surface res.code/message on failure (toast or inline error like benchmark).

### E61 — Transcription: Voice-input provider selection · UX · _Verified_

- **Feature rows:** F489
- **Issue:** On-device provider options are always selectable even where local transcription is unsupported and the choice is silently downgraded to cloud/none; the UI shows the persisted choice, not the resolved provider.
- **Evidence:** apps/x/apps/renderer/src/components/settings/transcription-settings.tsx:377-391,611-621; apps/x/packages/core/src/voice/voice.ts:264-309
- **Proposed fix:** Disable the on-device option (or show a "will fall back to cloud" notice) when capability.supported is false and reflect the resolved provider.

## Low severity (28)

### E09 — Graph: Empty/error states · UX · _Verified_

- **Feature rows:** F136
- **Issue:** GraphView declares an isLoading prop but never uses it and the parent hardcodes isLoading=false, so while the graph builds the view shows "No notes found." instead of a loading state.
- **Evidence:** apps/x/apps/renderer/src/components/graph-view.tsx:23,53-58,522-526; apps/x/apps/renderer/src/App.tsx:6791,5943
- **Proposed fix:** Destructure isLoading, gate the empty state on it, and pass graphStatus==="loading" from App.

### E10 — Search: Scope filter · UX · _Verified_

- **Feature rows:** F138
- **Issue:** The Knowledge/Chats filter chips render as independent toggles but toggleType always sets exactly one type, so they behave as mutually-exclusive radios and the active chip cannot be deselected.
- **Evidence:** apps/x/apps/renderer/src/components/search-dialog.tsx:103-106,126-128,199-211
- **Proposed fix:** Make toggleType add/remove from the set (multi-select) or render the chips as a single segmented radio.

### E11 — Memory: Related notes sidebar · UX · _Verified_

- **Feature rows:** F119
- **Issue:** When semantic memory is disabled, relatedNotes returns [] so the sidebar always shows "index builds in the background" — misleading, since indexing is off not pending.
- **Evidence:** apps/x/apps/renderer/src/components/related-notes-sidebar.tsx:86-90; apps/x/packages/core/src/memory/index.ts:281-287
- **Proposed fix:** Surface a disabled signal and show a distinct "Semantic memory is off" message.

### E14 — Email: Mark as read · UX · _Verified_

- **Feature rows:** F199
- **Issue:** markThreadReadAction mutates UI state optimistically and never rolls back; on failure it only console.warns (no toast/revert), unlike archive/trash.
- **Evidence:** apps/x/apps/renderer/src/components/email-view.tsx:1184-1196
- **Proposed fix:** Revert the optimistic unread flag and toast on failure, matching archive/trash.

### E15 — Live Notes: Run now (manual run) · UX · _Verified_

- **Feature rows:** F160
- **Issue:** handleRun awaits live-note:run but ignores the resolved {success,error}, so errors like "Already running" produce no feedback (every sibling handler checks res.success).
- **Evidence:** apps/x/apps/renderer/src/components/live-note-sidebar.tsx:209-217; apps/x/apps/main/src/ipc.ts:1413-1423
- **Proposed fix:** Check res.success/res.error in handleRun and setError on failure.

### E16 — Meetings: Silence auto-stop · Logistical · _Verified_

- **Feature rows:** F187
- **Issue:** The 2-minute silence auto-stop timer is only armed when the first transcript arrives, so a meeting that yields zero transcript records indefinitely.
- **Evidence:** apps/x/apps/renderer/src/hooks/useMeetingTranscription.ts:476-481,615
- **Proposed fix:** Arm the silence timer once at the start of recording so an all-silent session still auto-stops.

### E17 — Live Notes: Windows trigger editor · UX · _Verified_

- **Feature rows:** F155
- **Issue:** Window triggers only regex-validate HH:MM; there is no end>start check, so a reversed/overnight window is always out-of-band and silently never fires.
- **Evidence:** apps/x/packages/core/src/schedule/utils.ts:79-93; apps/x/packages/shared/src/live-note.ts:60-63
- **Proposed fix:** Validate end>start (or support wrap-around) and surface an inline error in the panel.

### E18 — Meetings: Join & take notes · UX · _Verified_

- **Feature rows:** F178
- **Issue:** calendar-block:join-meeting sets the pending event then toggles; if already recording the toggle STOPS it and the pending event is never consumed, so the next plain start attaches a stale calendar event.
- **Evidence:** apps/x/apps/renderer/src/components/meetings-view.tsx:195-209; apps/x/apps/renderer/src/App.tsx:5823-5844
- **Proposed fix:** Ignore/clear the pending event when already recording and clear pendingCalendarEventRef on stop.

### E25 — Workspace: Drag-and-drop upload · UX · _Verified_

- **Feature rows:** F267
- **Issue:** At the Workspace root grid dropEnabled is false so drag handlers no-op with no cue; dropped files fall through to the document-level copilot drop listener.
- **Evidence:** apps/x/apps/renderer/src/components/workspace-view.tsx:270-315,601-608
- **Proposed fix:** Show a "pick a workspace first" hint on root drop.

### E26 — File Viewer: PDF viewer · UX · _Verified_

- **Feature rows:** F294
- **Issue:** PdfFileViewer relies solely on iframe onError (which does not fire for app:// 404s) with no workspace:stat precheck, so a missing/renamed PDF renders blank and the fallback never appears.
- **Evidence:** apps/x/apps/renderer/src/components/pdf-file-viewer.tsx:10-55; apps/x/apps/renderer/src/components/html-file-viewer.tsx:35-66
- **Proposed fix:** Add a workspace:stat precheck mirroring HtmlFileViewer.

### E27 — File Viewer: Persistent HTML/PDF mount cache · Logistical · _Verified_

- **Feature rows:** F298
- **Issue:** PersistentViewerCache keeps up to 3 iframes mounted but is never told when a tab is closed/renamed, so stale-path iframes stay mounted until evicted by the size cap.
- **Evidence:** apps/x/apps/renderer/src/components/persistent-viewer-cache.tsx:24-53; apps/x/apps/renderer/src/App.tsx:3609-3639
- **Proposed fix:** Pass the set of live tab paths and prune mountedPaths to it on close/rename.

### E28 — Home: Inbox card · UX · _Verified_

- **Feature rows:** F221
- **Issue:** The Inbox "N new" badge renders emails.length but emails is capped at 3 via slice(0,3), so with more than 3 unread it always shows "3 new".
- **Evidence:** apps/x/apps/renderer/src/components/home-view.tsx:300-318,513-517
- **Proposed fix:** Track the true unread count separately from the 3-item preview.

### E29 — Tabs: Special non-file tabs · Logistical · _Verified_

- **Feature rows:** F257
- **Issue:** The Cmd/Ctrl tab-shortcut effect reads isHomeOpen but omits it from the dependency array, capturing a stale value.
- **Evidence:** apps/x/apps/renderer/src/App.tsx:5147,5168,5244-5266
- **Proposed fix:** Add isHomeOpen to the dependency array.

### E34 — Background Tasks: Stop a running task · UX · _Verified_

- **Feature rows:** F312
- **Issue:** TaskDetail.stopRun desktop branch discards the result; a failed stop produces no feedback (inconsistent with list-view handleStop).
- **Evidence:** apps/x/apps/renderer/src/components/bg-tasks-view.tsx:2524; apps/x/apps/main/src/ipc.ts:1537-1547
- **Proposed fix:** Capture the result and toast result.error when not success.

### E35 — Background Tasks: Pause/resume in-flight cloud run · UX · _Verified_

- **Feature rows:** F324
- **Issue:** For any non-terminal cloud run both Pause and Resume are always enabled with no indication of paused state; pressing Pause on an already-paused run re-sends pause.
- **Evidence:** apps/x/apps/renderer/src/components/bg-tasks-view.tsx:1805-1853
- **Proposed fix:** Track paused state from status and show only the applicable button.

### E36 — Browser: Browser tabs · UX · _Verified_

- **Feature rows:** F359
- **Issue:** view.closeTab returns ok:false on the last tab but BrowserPane.handleCloseTab ignores it, so closing the last tab silently does nothing while the close affordance is still shown.
- **Evidence:** apps/x/apps/main/src/browser/view.ts:521-524; apps/x/apps/renderer/src/components/browser-pane/BrowserPane.tsx:290-292
- **Proposed fix:** Hide the close button on the last tab or open a fresh blank tab when the last is closed.

### E37 — Schedule: Enable/disable scheduled agent · UX · _Verified_

- **Feature rows:** F524
- **Issue:** handleToggleBackgroundTask catches agent-schedule:updateAgent failures with only console.error; the controlled Switch snaps back with no toast, so a failed toggle looks broken for no reason.
- **Evidence:** apps/x/apps/renderer/src/App.tsx:2162-2184; apps/x/apps/renderer/src/components/background-task-detail.tsx:124-127
- **Proposed fix:** Surface a toast on failure (and consider optimistic local state).

### E38 — Terminal: ANSI-styled terminal rendering · UX · _Verified_

- **Feature rows:** F354
- **Issue:** TerminalOutput re-parses the entire accumulated buffer on every change (O(n^2) per render), which can jank the chat while a command streams large output.
- **Evidence:** apps/x/apps/renderer/src/components/terminal-output.tsx:5; apps/x/apps/renderer/src/lib/terminal-output.ts:112-294
- **Proposed fix:** Cap/window the parsed buffer or incrementally parse appended chunks.

### E39 — Background Tasks: Artifact sync state · Logistical · _Verified_

- **Feature rows:** F326
- **Issue:** The TaskDetail success-poll path calls pullCloudArtifact unconditionally (overwriting local index.md), whereas the offline-return path gates the pull on remote_newer/not_pulled.
- **Evidence:** apps/x/apps/renderer/src/components/bg-tasks-view.tsx:2412-2419; apps/x/packages/core/src/background-tasks/cloud-runs-state.ts:116-128
- **Proposed fix:** Gate the auto-pull on getArtifactSyncState, mirroring checkOfflineReturn.

### E46 — MCP: Save MCP config · UX · _Verified_

- **Feature rows:** F415
- **Issue:** No required-field validation: toConfig emits command/url even when blank and the schema accepts "", so a server with empty command/url saves and only fails later at connect with a cryptic transport error.
- **Evidence:** apps/x/apps/renderer/src/components/settings/mcp-settings.tsx:80-88; apps/x/packages/shared/src/mcp.ts:3-14
- **Proposed fix:** Validate non-empty command (stdio)/url (http) before save with an inline error.

### E47 — Connectors: Legacy Composio Gmail/Calendar · Logistical · _Deferred_

- **Feature rows:** F388
- **Issue:** useComposioForGoogle/useComposioForGoogleCalendar are hardcoded false with no IPC to flip them, so the Gmail/Calendar rows, the ComposioApiKeyModal, and handleConnect/Disconnect Gmail/Calendar are permanently dead branches.
- **Evidence:** apps/x/apps/renderer/src/hooks/useConnectors.ts:42-57; apps/x/apps/renderer/src/components/connectors-popover.tsx:236-334
- **Proposed fix:** Prune the dead flags and Composio Gmail/Calendar UI branches (or re-enable per TODO).

### E48 — Composio: Composio API key entry modal · Logistical · _Deferred_

- **Feature rows:** F400
- **Issue:** Latent bug (masked by the dead path): handleComposioApiKeySubmit always calls startGmailConnect regardless of composioApiKeyTarget, and handleConnectGoogleCalendar sets target to gmail.
- **Evidence:** apps/x/apps/renderer/src/hooks/useConnectors.ts:264-272,293-303
- **Proposed fix:** Branch on composioApiKeyTarget after saving the key and set the correct target.

### E49 — OAuth: Google managed-credentials connect · UX · _Verified_

- **Feature rows:** F392
- **Issue:** Managed Google connect returns success immediately after opening the browser with no main-side timeout; if abandoned, the renderer isConnecting only clears via a deep-link or popover reopen, so the Connect button can spin indefinitely.
- **Evidence:** apps/x/apps/main/src/oauth-handler.ts:356-371; apps/x/apps/renderer/src/hooks/useConnectors.ts:306-330
- **Proposed fix:** Add a renderer-side connect timeout that resets isConnecting, or have main emit a timeout failure for browser flows.

### E50 — OAuth: Generic OAuth connect flow · UX · _Verified_

- **Feature rows:** F390
- **Issue:** onCallback is invoked without await and the success HTML is written unconditionally, so the browser tab always shows "Authorization Successful" even when the token exchange fails.
- **Evidence:** apps/x/apps/main/src/auth-server.ts:64-83; apps/x/apps/main/src/oauth-handler.ts:470-482
- **Proposed fix:** Render success/error HTML based on onCallback outcome, or keep the page neutral.

### E53 — Onboarding: Completion: summary · UX · _Verified_

- **Feature rows:** F440
- **Issue:** connectedProviders is derived from all provider keys including the product provider solomon, so after rowboat-path sign-in with no data sources hasConnections is true and the completion step shows a "Connected" card with an empty body.
- **Evidence:** apps/x/apps/renderer/src/components/onboarding/steps/completion-step.tsx:10-11,92-113; apps/x/packages/core/src/auth/providers.ts:129-131
- **Proposed fix:** Exclude the product provider from connectedProviders/hasConnections.

### E54 — Feedback: Send feedback · Logistical · _Verified_

- **Feature rows:** F479
- **Issue:** The feedback:submit handler classifies failures by substring (message.includes("Not signed into")) instead of AuthUnavailableError.reason, so reconnect_required/refresh_backoff get a generic error and the mapping breaks if the string changes.
- **Evidence:** apps/x/apps/main/src/ipc.ts:1699-1717; apps/x/packages/core/src/auth/refresh-errors.ts:40-56
- **Proposed fix:** Switch on AuthUnavailableError.reason when mapping errorCode.

### E60 — Transcription: Model repair · UX · _Verified_

- **Feature rows:** F495
- **Issue:** Repair failures are silently swallowed: whisper:repairModel can reject and the renderer wraps it in try/finally with no catch, clearing the spinner but showing no error and leaving stale health.
- **Evidence:** apps/x/apps/renderer/src/components/settings/transcription-settings.tsx:303-325; apps/x/apps/main/src/ipc.ts:1311-1313
- **Proposed fix:** Catch repair failures and display the error/health reason.

### E62 — TTS: TTS playback queue · Logistical · _Verified_

- **Feature rows:** F512
- **Issue:** cancel() pauses the audio and resets processingRef but the in-flight processQueue awaits playAudio whose promise only resolves on ended/error; pause fires neither, so the orphaned async loop leaks.
- **Evidence:** apps/x/apps/renderer/src/hooks/useVoiceTTS.ts:17-36,96-105
- **Proposed fix:** On cancel resolve/abort the pending playAudio promise so the loop unwinds.
