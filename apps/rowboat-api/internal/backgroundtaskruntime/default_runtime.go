package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskmetrics"
)

// toolResultCap bounds each tool result before it re-enters the transcript so
// one verbose tool can't blow up every subsequent prompt.
const toolResultCap = 16 << 10 // 16 KiB

// artifactResultCap is artifact.read's dedicated, larger budget: the model
// must be able to see (much) more of the artifact than the generic tool cap,
// or full-replacement writes silently drop content it never saw. Reads are
// explicit and billed, so the cost is bounded by the model's own choices.
const artifactResultCap = 256 << 10 // 256 KiB

var controlPollInterval = time.Second

// DefaultToolResultCap is the per-tool transcript budget (the generic cap),
// exported for reuse by the durable agent runtime (RFC 027), which truncates
// tool results before they re-enter the workflow transcript / Temporal history.
const DefaultToolResultCap = toolResultCap

const sandboxEventOutputCap = 16 << 10

// TruncateToolResult is the exported reuse of the transcript-truncation rule
// (RFC 027 reuses it for tool results entering workflow history). See
// truncateToolResult for the envelope semantics.
func TruncateToolResult(raw []byte, maxBytes int) string { return truncateToolResult(raw, maxBytes) }

// Truncate bounds a string to maxLen runes with an ellipsis (exported reuse).
func Truncate(s string, maxLen int) string { return truncate(s, maxLen) }

// resultCap returns the transcript budget for one tool's result.
func resultCap(toolName string) int {
	if toolName == "artifact.read" {
		return artifactResultCap
	}
	return toolResultCap
}

// truncateToolResult bounds a tool result for the transcript. Oversize
// results are wrapped in a JSON envelope with an explicit truncated marker —
// never a silent mid-document cut, which would hand the model syntactically
// broken JSON it can neither parse nor recognize as partial.
func truncateToolResult(raw []byte, maxBytes int) string {
	if len(raw) <= maxBytes {
		return string(raw)
	}
	envelope, err := json.Marshal(map[string]any{
		"truncated":  true,
		"totalBytes": len(raw),
		"note":       "result truncated; narrow the query/range instead of retrying the same call",
		"prefix":     truncate(string(raw), maxBytes),
	})
	if err != nil {
		return truncate(string(raw), maxBytes)
	}
	return string(envelope)
}

// DefaultRuntime is the production agent loop (RFC 004): bounded LLM calls,
// deny-by-default tools, staged artifact, classified terminal failures.
type DefaultRuntime struct{}

// NewDefault builds the LLM-backed runtime. Per-run dependencies arrive via
// RunInput; the runtime itself is stateless.
func NewDefault() *DefaultRuntime { return &DefaultRuntime{} }

// Execute runs the bounded loop. Every returned error is either a classified
// *RuntimeError (terminal, non-retryable) or an adapter failure from the
// EventSink/ArtifactStore (which the workflow maps to its transient codes).
func (r *DefaultRuntime) Execute(ctx context.Context, in RunInput) (RunOutput, error) {
	if in.LLM == nil {
		return RunOutput{}, &RuntimeError{Code: CodeLLMCallFailed, Message: "runtime constructed without an LLM client"}
	}

	// The runtime's own deadline must fire before Temporal's activity timeout
	// so the failure carries runtime_deadline_exceeded, not activity_timeout.
	runCtx, cancel := context.WithTimeout(ctx, in.Limits.MaxDuration)
	defer cancel()

	staged := newStagedArtifact(in.Artifacts)
	registry := r.buildRegistry(staged, in)

	currentBody, _, err := staged.read(runCtx)
	if err != nil {
		return RunOutput{}, fmt.Errorf("read artifact for context: %w", err)
	}
	transcript := []Message{
		{Role: "system", Content: buildSystemPrompt(in)},
		{Role: "user", Content: buildInitialUserTurn(currentBody)},
	}
	toolDefs := defsOf(registry.List())

	out := RunOutput{}
	toolCalls := 0
	for call := 0; call < in.Limits.MaxLLMCalls; call++ {
		if err := r.checkDeadline(ctx, runCtx, in); err != nil {
			return out, err
		}

		// One progress tick per iteration: drives the run row + heartbeat.
		percent := 10 + (70*call)/in.Limits.MaxLLMCalls
		if err := r.applyControls(runCtx, in, &transcript, percent); err != nil {
			return out, r.classify(ctx, runCtx, in, err)
		}
		if err := in.Events.Progress(runCtx, percent, fmt.Sprintf("Agent step %d.", call+1)); err != nil {
			return out, r.classify(ctx, runCtx, in, err)
		}

		if err := r.emit(runCtx, in, eventLLMCallStarted, map[string]any{
			"model": in.Model, "callIndex": call,
			"prompt_version": PromptVersion,
		}); err != nil {
			return out, r.classify(ctx, runCtx, in, err)
		}
		turn, err := in.LLM.Complete(runCtx, call, transcript, toolDefs)
		if err != nil {
			// classify upgrades a call that died on OUR deadline.
			return out, r.classify(ctx, runCtx, in, err)
		}
		out.LLMCalls++
		if err := r.emit(runCtx, in, eventLLMCallCompleted, map[string]any{
			"provider": turn.Provider, "model": turn.Model, "callIndex": call,
			"latencyMs": turn.LatencyMs, "inputTokens": turn.InputTokens, "outputTokens": turn.OutputTokens,
			"prompt_version": PromptVersion,
		}); err != nil {
			return out, r.classify(ctx, runCtx, in, err)
		}

		transcript = append(transcript, turn.Message)

		// No tool calls → the model is done; finalize.
		if len(turn.Message.ToolCalls) == 0 {
			fout, ferr := r.finalize(runCtx, in, staged, out, turn.Message.Content)
			if ferr != nil {
				ferr = r.classify(ctx, runCtx, in, ferr)
			}
			return fout, ferr
		}

		for _, callReq := range turn.Message.ToolCalls {
			if toolCalls >= in.Limits.MaxToolCalls {
				return out, r.limitBreached(runCtx, in, CodeRuntimeToolBudgetExceeded, "tool_calls", toolCalls+1, in.Limits.MaxToolCalls)
			}
			toolCalls++
			out.ToolCalls++

			tool, lerr := registry.Lookup(callReq.Name)
			if lerr != nil {
				// Hallucinated/denied tool: tell the model and continue.
				if err := r.emit(runCtx, in, eventToolDenied, map[string]any{
					"tool": callReq.Name, "reason": "not on the allowlist for this run",
				}); err != nil {
					return out, r.classify(ctx, runCtx, in, err)
				}
				transcript = appendToolResult(transcript, callReq.ID, fmt.Sprintf(`{"error":"tool %q is not available"}`, callReq.Name))
				continue
			}

			audit := auditInfo(tool, callReq.Arguments)
			if err := r.emit(runCtx, in, eventToolCallStarted, toolEventPayload(tool.Name(), toolCalls, audit, "", map[string]any{})); err != nil {
				return out, r.classify(ctx, runCtx, in, err)
			}
			approvalID := ""
			if RequiresApproval(audit.TrustTier) {
				decision, err := r.awaitToolApproval(runCtx, in, tool.Name(), toolCalls, audit, callReq.Arguments)
				if err != nil {
					return out, r.classify(ctx, runCtx, in, err)
				}
				approvalID = decision.ApprovalID
				if !decision.Approved {
					if err := r.emit(runCtx, in, eventToolCallCompleted, toolEventPayload(tool.Name(), toolCalls, audit, approvalID, map[string]any{
						"error": "tool call denied by human approval gate",
					})); err != nil {
						return out, r.classify(ctx, runCtx, in, err)
					}
					transcript = appendToolResult(transcript, callReq.ID, `{"error":"tool call denied by human approval gate"}`)
					continue
				}
			}
			started := time.Now()
			result, ierr := tool.Invoke(runCtx, r.scope(in, toolCalls, approvalID), callReq.Arguments)
			latencyMs := time.Since(started).Milliseconds()
			if ierr != nil {
				backgroundtaskmetrics.RuntimeToolFailures.WithLabelValues(tool.Name()).Inc()
				// A tool that died on OUR deadline is a deadline breach, not a
				// tool failure; classified failures (connector_unavailable, …)
				// are terminal; plain errors are surfaced to the model.
				if derr := r.checkDeadline(ctx, runCtx, in); derr != nil {
					return out, derr
				}
				var re *RuntimeError
				if errors.As(ierr, &re) {
					return out, re
				}
				if err := r.emit(runCtx, in, eventToolCallCompleted, toolEventPayload(tool.Name(), toolCalls, audit, approvalID, map[string]any{
					"latencyMs": latencyMs,
					"error":     truncate(ierr.Error(), 300),
				})); err != nil {
					return out, r.classify(ctx, runCtx, in, err)
				}
				transcript = appendToolResult(transcript, callReq.ID, fmt.Sprintf(`{"error":%q}`, truncate(ierr.Error(), 300)))
				continue
			}
			backgroundtaskmetrics.RuntimeToolCalls.WithLabelValues(tool.Name()).Inc()
			completedExtra := map[string]any{
				"latencyMs":   latencyMs,
				"resultBytes": len(result),
			}
			if tool.Name() == sandboxToolName {
				for k, v := range sandboxResultEventFields(result) {
					completedExtra[k] = v
				}
			}
			if err := r.emit(runCtx, in, eventToolCallCompleted, toolEventPayload(tool.Name(), toolCalls, audit, approvalID, completedExtra)); err != nil {
				return out, r.classify(ctx, runCtx, in, err)
			}
			transcript = appendToolResult(transcript, callReq.ID, truncateToolResult(result, resultCap(tool.Name())))
		}
	}

	return out, r.limitBreached(runCtx, in, CodeRuntimeLLMBudgetExceeded, "llm_calls", in.Limits.MaxLLMCalls, in.Limits.MaxLLMCalls)
}

// buildRegistry merges the runtime-owned artifact tools (which share the
// staged view) with the adapter-scoped tools (history/event/connectors).
func (r *DefaultRuntime) buildRegistry(staged *stagedArtifact, in RunInput) ToolRegistry {
	tools := []Tool{
		&artifactReadTool{staged: staged},
		&artifactWriteTool{staged: staged, maxBytes: in.Limits.MaxArtifactBytes},
	}
	if in.Tools != nil {
		tools = append(tools, in.Tools.List()...)
	}
	return NewRegistry(tools)
}

func (r *DefaultRuntime) scope(in RunInput, toolCallIndex int, approvalID string) ToolScope {
	return ToolScope{UserID: in.UserID, TaskSlug: in.Slug, RunID: in.RunID, ToolCallIndex: toolCallIndex, ApprovalID: approvalID}
}

// finalize flushes the staged artifact (or promotes the final content into
// it) and emits the artifact-updated pairing the desktop expects.
func (r *DefaultRuntime) finalize(ctx context.Context, in RunInput, staged *stagedArtifact, out RunOutput, finalContent string) (RunOutput, error) {
	if !staged.hasStaged {
		if strings.TrimSpace(finalContent) == "" {
			// The model produced neither an artifact.write nor final content.
			// Never overwrite the prior artifact with emptiness — finish with
			// the artifact untouched (artifactWriteTool's non-empty rule only
			// guards the tool path; this promotion path needs its own).
			out.Summary = summaryFrom(finalContent, in.TaskName, in.Trigger)
			if err := in.Events.Progress(ctx, 90, "Run completed without artifact changes."); err != nil {
				return out, err
			}
			return out, nil
		}
		// The model never called artifact.write: its final message IS the
		// artifact (still bounded by the flush-time size check).
		staged.stage(finalContent, "text/markdown")
	}
	bytes, err := staged.flush(ctx, in.Limits.MaxArtifactBytes)
	if err != nil {
		var re *RuntimeError
		if errors.As(err, &re) {
			// Report the real staged size, not flush's zero return.
			return out, r.limitBreached(ctx, in, re.Code, "artifact_bytes", len(staged.staged), in.Limits.MaxArtifactBytes)
		}
		return out, err
	}
	out.ArtifactBytes = bytes
	out.Summary = summaryFrom(finalContent, in.TaskName, in.Trigger)
	backgroundtaskmetrics.RuntimeArtifactBytes.Observe(float64(bytes))

	if err := in.Events.ProgressEvent(ctx, eventArtifactUpdated, 90, "Artifact updated.", nil); err != nil {
		return out, err
	}
	if err := r.emit(ctx, in, eventFinalArtifactReady, map[string]any{
		"artifactBytes": bytes, "contentType": staged.contentType,
	}); err != nil {
		return out, err
	}
	return out, nil
}

// emit appends an event, enforcing the event-size limit terminally.
func (r *DefaultRuntime) emit(ctx context.Context, in RunInput, eventType string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if len(raw) > in.Limits.MaxEventBytes {
		backgroundtaskmetrics.RuntimeLimitExceeded.WithLabelValues("event_bytes").Inc()
		return limitError(CodeRuntimeEventTooLarge, "event_bytes", len(raw), in.Limits.MaxEventBytes)
	}
	return in.Events.Emit(ctx, eventType, payload)
}

func (r *DefaultRuntime) applyControls(ctx context.Context, in RunInput, transcript *[]Message, percent int) error {
	if in.Controls == nil {
		return nil
	}
	paused := false
	for {
		state, err := in.Controls.Checkpoint(ctx)
		if err != nil {
			return err
		}
		for _, update := range state.ContextUpdates {
			text := strings.TrimSpace(update)
			if text == "" {
				continue
			}
			*transcript = append(*transcript, Message{
				Role:    "user",
				Content: "Operator update_context: " + text,
			})
			if err := in.Events.Progress(ctx, percent, "Context updated."); err != nil {
				return err
			}
		}
		if !state.Paused {
			if paused {
				return in.Events.Progress(ctx, percent, "Run resumed.")
			}
			return nil
		}
		if !paused {
			paused = true
			if err := in.Events.Progress(ctx, percent, "Run paused."); err != nil {
				return err
			}
		}
		if err := sleepContext(ctx, controlPollInterval); err != nil {
			return err
		}
	}
}

type runtimeApprovalDecision struct {
	ApprovalID string
	Approved   bool
}

func (r *DefaultRuntime) awaitToolApproval(ctx context.Context, in RunInput, toolName string, callIndex int, audit ToolAudit, _ json.RawMessage) (runtimeApprovalDecision, error) {
	approvalID := toolApprovalID(in.RunID, callIndex)
	requestPayload := toolEventPayload(toolName, callIndex, audit, approvalID, map[string]any{
		"approvalRequired": true,
	})
	if err := r.emit(ctx, in, eventToolApprovalRequested, requestPayload); err != nil {
		return runtimeApprovalDecision{}, err
	}
	if err := in.Events.Progress(ctx, 80, "Waiting for human approval."); err != nil {
		return runtimeApprovalDecision{}, err
	}
	if in.Controls == nil {
		if err := r.emit(ctx, in, eventToolApprovalResolved, toolEventPayload(toolName, callIndex, audit, approvalID, map[string]any{
			"decision": "denied",
			"reason":   "approval control source is not configured",
		})); err != nil {
			return runtimeApprovalDecision{}, err
		}
		return runtimeApprovalDecision{ApprovalID: approvalID, Approved: false}, nil
	}
	for {
		state, err := in.Controls.Checkpoint(ctx)
		if err != nil {
			return runtimeApprovalDecision{}, err
		}
		if decision, ok := state.ToolApprovals[approvalID]; ok {
			out := toolEventPayload(toolName, callIndex, audit, approvalID, map[string]any{
				"decision": "denied",
			})
			if decision.Approved {
				out["decision"] = "approved"
			}
			if decision.ResolvedBy != "" {
				out["resolvedBy"] = decision.ResolvedBy
			}
			if decision.Reason != "" {
				out["reason"] = decision.Reason
			}
			if err := r.emit(ctx, in, eventToolApprovalResolved, out); err != nil {
				return runtimeApprovalDecision{}, err
			}
			return runtimeApprovalDecision{ApprovalID: approvalID, Approved: decision.Approved}, nil
		}
		if err := sleepContext(ctx, controlPollInterval); err != nil {
			return runtimeApprovalDecision{}, err
		}
	}
}

func sleepContext(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// limitBreached records the breach (event + metric) and returns the terminal
// classified error.
func (r *DefaultRuntime) limitBreached(ctx context.Context, in RunInput, code, limit string, value, maxVal int) error {
	backgroundtaskmetrics.RuntimeLimitExceeded.WithLabelValues(limit).Inc()
	_ = r.emit(ctx, in, eventLimitExceeded, map[string]any{"limit": limit, "value": value, "max": maxVal})
	return limitError(code, limit, value, maxVal)
}

// classify upgrades an error that occurred AFTER the runtime deadline expired
// to runtime_deadline_exceeded: the operation (LLM call, tool, event append)
// died because the run's budget ran out, not on its own merits — without this
// the breach surfaces as a retryable db_error or llm_call_failed and the real
// cause never reaches error_code or the limit metric.
func (r *DefaultRuntime) classify(parent, runCtx context.Context, in RunInput, err error) error {
	if derr := r.checkDeadline(parent, runCtx, in); derr != nil {
		return derr
	}
	return err
}

// checkDeadline distinguishes OUR deadline (runtime_deadline_exceeded) from a
// cancelled activity (propagated as-is so Temporal classifies cancellation).
// Breach reporting uses the PARENT ctx — runCtx is already expired here.
func (r *DefaultRuntime) checkDeadline(parent, runCtx context.Context, in RunInput) error {
	if parent.Err() != nil {
		return parent.Err()
	}
	if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
		secs := int(in.Limits.MaxDuration.Seconds())
		return r.limitBreached(parent, in, CodeRuntimeDeadlineExceeded, "duration", secs, secs)
	}
	return nil
}

func appendToolResult(transcript []Message, toolCallID, content string) []Message {
	return append(transcript, Message{Role: "tool", ToolCallID: toolCallID, Content: content})
}

func sandboxResultEventFields(raw json.RawMessage) map[string]any {
	var result SandboxResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil
	}
	fields := map[string]any{
		"sandboxStatus": result.Status,
	}
	if result.Backend != "" {
		fields["sandboxBackend"] = result.Backend
	}
	if result.JobName != "" {
		fields["sandboxJobName"] = result.JobName
	}
	if result.ExitCode != 0 {
		fields["sandboxExitCode"] = result.ExitCode
	}
	if result.Output != "" {
		fields["sandboxOutputBytes"] = len([]byte(result.Output))
		if len([]byte(result.Output)) > sandboxEventOutputCap {
			fields["sandboxOutput"] = truncate(result.Output, sandboxEventOutputCap)
			fields["sandboxOutputEventTruncated"] = true
		} else {
			fields["sandboxOutput"] = result.Output
		}
	}
	if result.OutputTruncated {
		fields["sandboxOutputTruncated"] = true
	}
	if result.TimedOut {
		fields["sandboxTimedOut"] = true
	}
	return fields
}

func defsOf(tools []Tool) []ToolDef {
	out := make([]ToolDef, 0, len(tools))
	for _, t := range tools {
		audit := auditInfo(t, nil)
		out = append(out, ToolDef{Name: t.Name(), Description: t.Description(), Parameters: t.JSONSchema(), TrustTier: audit.TrustTier})
	}
	return out
}

func auditInfo(tool Tool, args json.RawMessage) ToolAudit {
	audit := ToolAudit{TrustTier: TierRead}
	if provider, ok := tool.(ToolAuditProvider); ok {
		audit = provider.AuditInfo(args)
	}
	if audit.TrustTier == "" {
		audit.TrustTier = TierRead
	}
	return audit
}

func toolEventPayload(toolName string, callIndex int, audit ToolAudit, approvalID string, extra map[string]any) map[string]any {
	payload := map[string]any{
		"tool":      toolName,
		"callIndex": callIndex,
		"trustTier": audit.TrustTier,
	}
	if audit.Connector != "" {
		payload["connector"] = audit.Connector
	}
	if audit.Operation != "" {
		payload["operation"] = audit.Operation
	}
	if len(audit.RequiredScopes) > 0 {
		payload["requiredScopes"] = append([]string(nil), audit.RequiredScopes...)
	}
	if approvalID != "" {
		payload["approvalId"] = approvalID
	}
	for k, v := range extra {
		payload[k] = v
	}
	return payload
}

func toolApprovalID(runID string, callIndex int) string {
	return fmt.Sprintf("%s/tool/%d", runID, callIndex)
}
