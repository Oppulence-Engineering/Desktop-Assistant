package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func baseInput(llm LLMClient, store *fakeArtifactStore, sink *fakeEventSink, extra ...Tool) RunInput {
	return RunInput{
		UserID: "u1", TaskID: "t1", Slug: "daily-summary", RunID: "run-1",
		TaskName: "Daily Summary", Trigger: "cron",
		Instructions: "Summarize.",
		Model:        "anthropic/claude-sonnet-4-5",
		Artifacts:    store,
		Events:       sink,
		Tools:        NewRegistry(extra),
		LLM:          llm,
		Limits:       DefaultLimits(),
	}
}

func TestLoopToolCallThenFinal(t *testing.T) {
	store := &fakeArtifactStore{body: "old"}
	sink := &fakeEventSink{}
	hist := &fakeTool{name: "run_history.read", result: json.RawMessage(`{"runs":[]}`)}
	llm := newFakeLLM(
		toolCallTurn("c1", "run_history.read", `{}`),
		toolCallTurn("c2", "artifact.write", `{"body":"# New artifact"}`),
		assistantTurn("Updated the artifact with today's summary."),
	)

	out, err := NewDefault().Execute(context.Background(), baseInput(llm, store, sink, hist))
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if out.LLMCalls != 3 || out.ToolCalls != 2 {
		t.Fatalf("out = %+v, want 3 llm / 2 tool calls", out)
	}
	if out.Summary != "Updated the artifact with today's summary." {
		t.Fatalf("summary = %q", out.Summary)
	}
	// One durable write, at the end, with the staged body.
	if len(store.writes) != 1 || store.writes[0] != "# New artifact" {
		t.Fatalf("writes = %v", store.writes)
	}
	// The tool result flowed back into the transcript as a tool turn.
	last := llm.requests[len(llm.requests)-1]
	foundToolTurn := false
	for _, m := range last {
		if m.Role == "tool" && m.ToolCallID == "c1" && strings.Contains(m.Content, `"runs"`) {
			foundToolTurn = true
		}
	}
	if !foundToolTurn {
		t.Fatalf("transcript missing tool result turn: %+v", last)
	}
	// Event stream: llm_call started/completed per call, tool events, final pair.
	types := sink.types()
	for _, want := range []string{eventLLMCallStarted, eventLLMCallCompleted, eventToolCallStarted, eventToolCallCompleted, eventArtifactUpdated, eventFinalArtifactReady} {
		if !containsStr(types, want) {
			t.Fatalf("events missing %s: %v", want, types)
		}
	}
}

func TestLoopDispatchesSandboxRunToolResult(t *testing.T) {
	store := &fakeArtifactStore{}
	sink := &fakeEventSink{}
	exec := &fakeSandboxExecutor{result: SandboxResult{
		JobName: "rb-sandbox-sandbox-run-abc123", Status: "succeeded", Output: "sandbox-output\n", OutputTruncated: true,
	}}
	tool := NewSandboxRunTool(exec, SandboxToolConfig{
		Backend:        "argo-workflow",
		DefaultImage:   "python:3.12-slim",
		AllowedImages:  []string{"python:3.12-slim"},
		DefaultTimeout: time.Minute,
		MaxTimeout:     2 * time.Minute,
		MaxScriptBytes: 1024,
		MaxOutputBytes: 2048,
	})
	llm := newFakeLLM(
		toolCallTurn("sandbox-call-1", sandboxToolName, `{"script":"echo sandbox-output","timeoutSeconds":30}`),
		assistantTurn("saw sandbox output"),
	)

	in := baseInput(llm, store, sink, tool)
	in.Slug = "sandbox-task"
	in.RunID = "sandbox-run"
	out, err := NewDefault().Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if out.LLMCalls != 2 || out.ToolCalls != 1 {
		t.Fatalf("out = %+v, want 2 llm / 1 tool", out)
	}
	if len(exec.runs) != 1 {
		t.Fatalf("sandbox runs = %d, want 1", len(exec.runs))
	}
	run := exec.runs[0]
	if run.UserID != "u1" || run.TaskSlug != "sandbox-task" || run.RunID != "sandbox-run" ||
		run.ToolCallIndex != 1 || run.Image != "python:3.12-slim" || run.Timeout != 30*time.Second {
		t.Fatalf("sandbox run = %+v", run)
	}
	lastRequest := llm.requests[len(llm.requests)-1]
	foundToolResult := false
	for _, msg := range lastRequest {
		if msg.Role == "tool" && msg.ToolCallID == "sandbox-call-1" && strings.Contains(msg.Content, "sandbox-output") {
			foundToolResult = true
		}
	}
	if !foundToolResult {
		t.Fatalf("sandbox result missing from transcript: %+v", lastRequest)
	}
	if !containsStr(sink.types(), eventToolCallStarted) || !containsStr(sink.types(), eventToolCallCompleted) {
		t.Fatalf("missing sandbox tool events: %v", sink.types())
	}
	completed := lastEventPayload(sink.records, eventToolCallCompleted)
	if completed["tool"] != sandboxToolName ||
		completed["sandboxBackend"] != "argo-workflow" ||
		completed["sandboxJobName"] != "rb-sandbox-sandbox-run-abc123" ||
		completed["sandboxStatus"] != "succeeded" ||
		completed["sandboxOutput"] != "sandbox-output\n" ||
		completed["sandboxOutputBytes"] != len("sandbox-output\n") ||
		completed["sandboxOutputTruncated"] != true {
		t.Fatalf("sandbox completion payload = %+v", completed)
	}
}

func TestLoopReturnsRuntimeErrorWhenSandboxExecutorFails(t *testing.T) {
	store := &fakeArtifactStore{body: "old"}
	sink := &fakeEventSink{}
	exec := &fakeSandboxExecutor{err: fmt.Errorf("kubernetes unavailable")}
	tool := NewSandboxRunTool(exec, SandboxToolConfig{
		DefaultImage:   "python:3.12-slim",
		AllowedImages:  []string{"python:3.12-slim"},
		DefaultTimeout: time.Minute,
		MaxTimeout:     2 * time.Minute,
		MaxScriptBytes: 1024,
		MaxOutputBytes: 2048,
	})
	llm := newFakeLLM(
		toolCallTurn("sandbox-call-1", sandboxToolName, `{"script":"echo sandbox-output"}`),
	)

	out, err := NewDefault().Execute(context.Background(), baseInput(llm, store, sink, tool))
	re, ok := AsRuntimeError(err)
	if !ok || re.Code != CodeToolInvokeFailed || !strings.Contains(err.Error(), "kubernetes unavailable") {
		t.Fatalf("err = %v, want tool_invoke_failed with executor cause", err)
	}
	if out.LLMCalls != 1 || out.ToolCalls != 1 {
		t.Fatalf("out = %+v, want 1 llm / 1 tool", out)
	}
	if len(exec.runs) != 1 {
		t.Fatalf("sandbox runs = %d, want 1", len(exec.runs))
	}
	if len(store.writes) != 0 {
		t.Fatalf("failed sandbox run must not write artifact: %v", store.writes)
	}
	if !containsStr(sink.types(), eventToolCallStarted) {
		t.Fatalf("missing tool started event: %v", sink.types())
	}
}

func TestLoopFeedsSandboxValidationErrorBackToModel(t *testing.T) {
	store := &fakeArtifactStore{}
	sink := &fakeEventSink{}
	exec := &fakeSandboxExecutor{result: SandboxResult{Status: "succeeded", Output: "should-not-run\n"}}
	tool := NewSandboxRunTool(exec, SandboxToolConfig{
		DefaultImage:   "python:3.12-slim",
		AllowedImages:  []string{"python:3.12-slim"},
		DefaultTimeout: time.Minute,
		MaxTimeout:     2 * time.Minute,
		MaxScriptBytes: 1024,
		MaxOutputBytes: 2048,
	})
	llm := newFakeLLM(
		toolCallTurn("sandbox-call-1", sandboxToolName, `{"script":"echo nope","image":"alpine:latest"}`),
		assistantTurn("I will use the configured sandbox image next time."),
	)

	out, err := NewDefault().Execute(context.Background(), baseInput(llm, store, sink, tool))
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if out.LLMCalls != 2 || out.ToolCalls != 1 {
		t.Fatalf("out = %+v, want 2 llm / 1 tool", out)
	}
	if len(exec.runs) != 0 {
		t.Fatalf("sandbox executor should not run invalid request: %+v", exec.runs)
	}
	lastRequest := llm.requests[len(llm.requests)-1]
	foundToolError := false
	for _, msg := range lastRequest {
		if msg.Role == "tool" && msg.ToolCallID == "sandbox-call-1" && strings.Contains(msg.Content, `image \"alpine:latest\" is not allowed`) {
			foundToolError = true
		}
	}
	if !foundToolError {
		t.Fatalf("sandbox validation error missing from transcript: %+v", lastRequest)
	}
	if !containsStr(sink.types(), eventToolCallCompleted) {
		t.Fatalf("missing tool completed event for validation error: %v", sink.types())
	}
}

func TestSandboxResultEventFieldsCapsOutputPreview(t *testing.T) {
	raw, err := json.Marshal(SandboxResult{
		JobName: "wf", Status: "succeeded", Output: strings.Repeat("x", sandboxEventOutputCap+64),
	})
	if err != nil {
		t.Fatalf("marshal sandbox result: %v", err)
	}
	fields := sandboxResultEventFields(raw)
	output, _ := fields["sandboxOutput"].(string)
	if fields["sandboxOutputBytes"] != sandboxEventOutputCap+64 ||
		fields["sandboxOutputEventTruncated"] != true ||
		len(output) > sandboxEventOutputCap+3 {
		t.Fatalf("fields = %+v outputLen=%d", fields, len(output))
	}
}

func TestLoopFinalWithoutArtifactWritePromotesContent(t *testing.T) {
	store := &fakeArtifactStore{}
	llm := newFakeLLM(assistantTurn("# Report\n\nEverything is fine."))
	out, err := NewDefault().Execute(context.Background(), baseInput(llm, store, &fakeEventSink{}))
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if len(store.writes) != 1 || store.writes[0] != "# Report\n\nEverything is fine." {
		t.Fatalf("writes = %v, want final content promoted to artifact", store.writes)
	}
	if out.Summary != "Report" {
		t.Fatalf("summary = %q (first non-empty line, markdown-stripped)", out.Summary)
	}
}

func TestLoopAppliesContextUpdatesBeforeNextLLMCall(t *testing.T) {
	store := &fakeArtifactStore{}
	sink := &fakeEventSink{}
	llm := newFakeLLM(assistantTurn("updated"))
	in := baseInput(llm, store, sink)
	in.Controls = &fakeControlSource{states: []ControlState{{
		ContextUpdates: []string{"Use the corrected customer name."},
	}}}

	if _, err := NewDefault().Execute(context.Background(), in); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if len(llm.requests) == 0 {
		t.Fatal("LLM was not called")
	}
	found := false
	for _, msg := range llm.requests[0] {
		if msg.Role == "user" && strings.Contains(msg.Content, "Use the corrected customer name.") {
			found = true
		}
	}
	if !found {
		t.Fatalf("context update missing from first LLM request: %+v", llm.requests[0])
	}
	if !hasProgressMessage(sink.records, "Context updated.") {
		t.Fatalf("missing context progress event: %+v", sink.records)
	}
}

func TestLoopPausesUntilResumeSignal(t *testing.T) {
	oldInterval := controlPollInterval
	controlPollInterval = time.Millisecond
	t.Cleanup(func() { controlPollInterval = oldInterval })

	store := &fakeArtifactStore{}
	sink := &fakeEventSink{}
	llm := newFakeLLM(assistantTurn("resumed"))
	in := baseInput(llm, store, sink)
	in.Controls = &fakeControlSource{states: []ControlState{
		{Paused: true},
		{Paused: false},
	}}

	if _, err := NewDefault().Execute(context.Background(), in); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if !hasProgressMessage(sink.records, "Run paused.") || !hasProgressMessage(sink.records, "Run resumed.") {
		t.Fatalf("pause/resume progress missing: %+v", sink.records)
	}
}

func TestLoopDeniedToolContinues(t *testing.T) {
	store := &fakeArtifactStore{}
	sink := &fakeEventSink{}
	llm := newFakeLLM(
		toolCallTurn("c1", "shell", `{"cmd":"rm -rf /"}`),
		assistantTurn("Could not run shell; wrote what I could."),
	)
	out, err := NewDefault().Execute(context.Background(), baseInput(llm, store, sink))
	if err != nil {
		t.Fatalf("denied tool must not abort the loop: %v", err)
	}
	if !containsStr(sink.types(), eventToolDenied) {
		t.Fatalf("missing tool_denied event: %v", sink.types())
	}
	// The denial was surfaced to the model as a tool result.
	last := llm.requests[len(llm.requests)-1]
	found := false
	for _, m := range last {
		if m.Role == "tool" && strings.Contains(m.Content, "not available") {
			found = true
		}
	}
	if !found {
		t.Fatalf("denial not in transcript: %+v", last)
	}
	_ = out
}

func TestLoopLLMBudgetExceeded(t *testing.T) {
	store := &fakeArtifactStore{}
	sink := &fakeEventSink{}
	hist := &fakeTool{name: "run_history.read", result: json.RawMessage(`{}`)}
	// Model asks for a tool every turn, never finishes.
	turns := make([]Turn, 0, 12)
	for i := 0; i < 12; i++ {
		turns = append(turns, toolCallTurn("c", "run_history.read", `{}`))
	}
	in := baseInput(newFakeLLM(turns...), store, sink, hist)
	_, err := NewDefault().Execute(context.Background(), in)
	re, ok := AsRuntimeError(err)
	if !ok || re.Code != CodeRuntimeLLMBudgetExceeded {
		t.Fatalf("err = %v, want %s", err, CodeRuntimeLLMBudgetExceeded)
	}
	if !containsStr(sink.types(), eventLimitExceeded) {
		t.Fatal("missing limit_exceeded event")
	}
	if len(store.writes) != 0 {
		t.Fatal("failed run must not write the artifact")
	}
}

func TestLoopToolBudgetExceeded(t *testing.T) {
	hist := &fakeTool{name: "run_history.read", result: json.RawMessage(`{}`)}
	// One turn with many tool calls blows the tool budget quickly.
	calls := make([]ToolCallRequest, 25)
	for i := range calls {
		calls[i] = ToolCallRequest{ID: "c", Name: "run_history.read", Arguments: json.RawMessage(`{}`)}
	}
	llm := newFakeLLM(Turn{Message: Message{Role: "assistant", ToolCalls: calls}})
	in := baseInput(llm, &fakeArtifactStore{}, &fakeEventSink{}, hist)
	_, err := NewDefault().Execute(context.Background(), in)
	re, ok := AsRuntimeError(err)
	if !ok || re.Code != CodeRuntimeToolBudgetExceeded {
		t.Fatalf("err = %v, want %s", err, CodeRuntimeToolBudgetExceeded)
	}
}

func TestLoopArtifactTooLargeOnPromotedFinal(t *testing.T) {
	in := baseInput(newFakeLLM(assistantTurn(strings.Repeat("x", 2048))), &fakeArtifactStore{}, &fakeEventSink{})
	in.Limits.MaxArtifactBytes = 1024
	_, err := NewDefault().Execute(context.Background(), in)
	re, ok := AsRuntimeError(err)
	if !ok || re.Code != CodeRuntimeArtifactTooLarge {
		t.Fatalf("err = %v, want %s", err, CodeRuntimeArtifactTooLarge)
	}
}

func TestLoopEventTooLarge(t *testing.T) {
	hist := &fakeTool{name: "run_history.read", result: json.RawMessage(`{"big":"` + strings.Repeat("y", 4096) + `"}`)}
	llm := newFakeLLM(toolCallTurn("c1", "run_history.read", `{}`), assistantTurn("done"))
	in := baseInput(llm, &fakeArtifactStore{}, &fakeEventSink{}, hist)
	in.Limits.MaxEventBytes = 64 // tiny: the llm_call_started payload alone exceeds it
	_, err := NewDefault().Execute(context.Background(), in)
	re, ok := AsRuntimeError(err)
	if !ok || re.Code != CodeRuntimeEventTooLarge {
		t.Fatalf("err = %v, want %s", err, CodeRuntimeEventTooLarge)
	}
}

func TestLoopDeadlineExceeded(t *testing.T) {
	slow := &slowLLM{delay: 200 * time.Millisecond}
	in := baseInput(slow, &fakeArtifactStore{}, &fakeEventSink{})
	in.Limits.MaxDuration = 50 * time.Millisecond
	_, err := NewDefault().Execute(context.Background(), in)
	re, ok := AsRuntimeError(err)
	if !ok || re.Code != CodeRuntimeDeadlineExceeded {
		t.Fatalf("err = %v, want %s", err, CodeRuntimeDeadlineExceeded)
	}
}

func TestLoopClassifiedToolErrorIsTerminal(t *testing.T) {
	broken := &fakeTool{name: "connector.read.gmail", err: &RuntimeError{Code: CodeConnectorUnavailable, Message: "no token"}}
	llm := newFakeLLM(toolCallTurn("c1", "connector.read.gmail", `{"query":"x"}`), assistantTurn("unreached"))
	in := baseInput(llm, &fakeArtifactStore{}, &fakeEventSink{}, broken)
	_, err := NewDefault().Execute(context.Background(), in)
	re, ok := AsRuntimeError(err)
	if !ok || re.Code != CodeConnectorUnavailable {
		t.Fatalf("err = %v, want %s", err, CodeConnectorUnavailable)
	}
}

func TestLoopPlainToolErrorContinues(t *testing.T) {
	flaky := &fakeTool{name: "run_history.read", err: errPlain("boom")}
	llm := newFakeLLM(toolCallTurn("c1", "run_history.read", `{}`), assistantTurn("worked around it"))
	in := baseInput(llm, &fakeArtifactStore{}, &fakeEventSink{}, flaky)
	out, err := NewDefault().Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("plain tool error must continue: %v", err)
	}
	if out.Summary != "worked around it" {
		t.Fatalf("summary = %q", out.Summary)
	}
}

func TestLoopApprovalTierToolWaitsForApproval(t *testing.T) {
	oldInterval := controlPollInterval
	controlPollInterval = time.Millisecond
	t.Cleanup(func() { controlPollInterval = oldInterval })

	tool := &fakeTool{
		name:   "connector.write.gmail_draft",
		result: json.RawMessage(`{"draftId":"draft-1"}`),
		audit:  ToolAudit{TrustTier: TierAct, Connector: "google", Operation: "gmail.draft.create", RequiredScopes: []string{ScopeGmailCompose}},
	}
	sink := &fakeEventSink{}
	llm := newFakeLLM(
		toolCallTurn("c1", "connector.write.gmail_draft", `{"to":"a@example.com","body":"hello"}`),
		assistantTurn("draft created"),
	)
	in := baseInput(llm, &fakeArtifactStore{}, sink, tool)
	in.Controls = &fakeControlSource{states: []ControlState{
		{},
		{ToolApprovals: map[string]ToolApprovalDecision{
			"run-1/tool/1": {Approved: true, ResolvedBy: "tester"},
		}},
	}}

	if _, err := NewDefault().Execute(context.Background(), in); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if len(tool.invokes) != 1 || len(tool.scopes) != 1 || tool.scopes[0].ApprovalID != "run-1/tool/1" {
		t.Fatalf("invokes/scopes = %d/%+v", len(tool.invokes), tool.scopes)
	}
	if !containsStr(sink.types(), eventToolApprovalRequested) || !containsStr(sink.types(), eventToolApprovalResolved) {
		t.Fatalf("missing approval events: %v", sink.types())
	}
	requested := lastEventPayload(sink.records, eventToolApprovalRequested)
	if !hasScopeValue(requested["requiredScopes"], ScopeGmailCompose) {
		t.Fatalf("approval request missing required scope %q: %+v", ScopeGmailCompose, requested)
	}
	completed := lastEventPayload(sink.records, eventToolCallCompleted)
	if completed["connector"] != "google" || completed["operation"] != "gmail.draft.create" ||
		completed["trustTier"] != TierAct || completed["approvalId"] != "run-1/tool/1" {
		t.Fatalf("completed payload = %+v", completed)
	}
	if !hasScopeValue(completed["requiredScopes"], ScopeGmailCompose) {
		t.Fatalf("completed payload missing required scope %q: %+v", ScopeGmailCompose, completed)
	}
	if _, ok := completed["latencyMs"]; !ok {
		t.Fatalf("completed payload missing latencyMs: %+v", completed)
	}
}

func TestLoopMoneyMovingToolWaitsForApproval(t *testing.T) {
	oldInterval := controlPollInterval
	controlPollInterval = time.Millisecond
	t.Cleanup(func() { controlPollInterval = oldInterval })

	tool := &fakeTool{
		name:   "connector.mcp.call_tool",
		result: json.RawMessage(`{"result":{"refund":"re_1"}}`),
		audit:  ToolAudit{TrustTier: TierMoneyMoving, Connector: "stripe", Operation: "mcp.tool.refund.create"},
	}
	sink := &fakeEventSink{}
	llm := newFakeLLM(
		toolCallTurn("c1", "connector.mcp.call_tool", `{"connector":"stripe","tool":"refund.create","arguments":{"charge":"ch_1"}}`),
		assistantTurn("refund queued"),
	)
	in := baseInput(llm, &fakeArtifactStore{}, sink, tool)
	in.Controls = &fakeControlSource{states: []ControlState{{
		ToolApprovals: map[string]ToolApprovalDecision{
			"run-1/tool/1": {Approved: true, ResolvedBy: "finance-owner"},
		},
	}}}

	if _, err := NewDefault().Execute(context.Background(), in); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if len(tool.invokes) != 1 || len(tool.scopes) != 1 || tool.scopes[0].ApprovalID != "run-1/tool/1" {
		t.Fatalf("invokes/scopes = %d/%+v", len(tool.invokes), tool.scopes)
	}
	completed := lastEventPayload(sink.records, eventToolCallCompleted)
	if completed["connector"] != "stripe" || completed["operation"] != "mcp.tool.refund.create" ||
		completed["trustTier"] != TierMoneyMoving || completed["approvalId"] != "run-1/tool/1" {
		t.Fatalf("completed payload = %+v", completed)
	}
}

func TestLoopApprovalTierToolDeniedDoesNotInvoke(t *testing.T) {
	oldInterval := controlPollInterval
	controlPollInterval = time.Millisecond
	t.Cleanup(func() { controlPollInterval = oldInterval })

	tool := &fakeTool{
		name:   "connector.write.slack_reply",
		result: json.RawMessage(`{"posted":true}`),
		audit:  ToolAudit{TrustTier: TierAct, Connector: "slack", Operation: "slack.thread.reply"},
	}
	sink := &fakeEventSink{}
	llm := newFakeLLM(
		toolCallTurn("c1", "connector.write.slack_reply", `{"text":"hello"}`),
		assistantTurn("reply was not posted"),
	)
	in := baseInput(llm, &fakeArtifactStore{}, sink, tool)
	in.Controls = &fakeControlSource{states: []ControlState{{
		ToolApprovals: map[string]ToolApprovalDecision{
			"run-1/tool/1": {Approved: false, ResolvedBy: "tester", Reason: "too risky"},
		},
	}}}

	if _, err := NewDefault().Execute(context.Background(), in); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if len(tool.invokes) != 0 {
		t.Fatalf("denied tool must not invoke, got %d invokes", len(tool.invokes))
	}
	last := llm.requests[len(llm.requests)-1]
	found := false
	for _, m := range last {
		if m.Role == "tool" && strings.Contains(m.Content, "denied by human approval gate") {
			found = true
		}
	}
	if !found {
		t.Fatalf("denial missing from transcript: %+v", last)
	}
}

// slowLLM blocks until ctx dies.
type slowLLM struct{ delay time.Duration }

func (s *slowLLM) Complete(ctx context.Context, _ int, _ []Message, _ []ToolDef) (Turn, error) {
	select {
	case <-ctx.Done():
		return Turn{}, ctx.Err()
	case <-time.After(s.delay):
		return assistantTurn("late"), nil
	}
}

type errPlain string

func (e errPlain) Error() string { return string(e) }

func containsStr(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}

func hasScopeValue(raw any, want string) bool {
	switch scopes := raw.(type) {
	case []string:
		for _, scope := range scopes {
			if scope == want {
				return true
			}
		}
	case []any:
		for _, scope := range scopes {
			if s, ok := scope.(string); ok && s == want {
				return true
			}
		}
	}
	return false
}

func hasProgressMessage(records []sinkRecord, message string) bool {
	for _, rec := range records {
		if rec.Kind == "progress" && rec.Message == message {
			return true
		}
	}
	return false
}

func lastEventPayload(records []sinkRecord, eventType string) map[string]any {
	for i := len(records) - 1; i >= 0; i-- {
		if records[i].Kind == "event" && records[i].EventType == eventType {
			return records[i].Payload
		}
	}
	return nil
}

// TestLoopEmptyFinalPreservesArtifact: a run that ends with no tool calls and
// empty content must NOT overwrite the prior artifact — and still succeeds.
func TestLoopEmptyFinalPreservesArtifact(t *testing.T) {
	store := &fakeArtifactStore{body: "# Prior artifact\n\nValuable content."}
	sink := &fakeEventSink{}
	llm := newFakeLLM(assistantTurn(""))
	out, err := NewDefault().Execute(context.Background(), baseInput(llm, store, sink))
	if err != nil {
		t.Fatalf("empty final must not fail the run: %v", err)
	}
	if len(store.writes) != 0 {
		t.Fatalf("writes = %v, want none (prior artifact preserved)", store.writes)
	}
	if store.body != "# Prior artifact\n\nValuable content." {
		t.Fatalf("prior artifact mutated: %q", store.body)
	}
	if out.Summary == "" {
		t.Fatal("summary fallback missing")
	}
	if containsStr(sink.types(), eventArtifactUpdated) {
		t.Fatal("must not emit artifact_updated when the artifact is untouched")
	}
}

// TestLoopDeadlineDuringToolClassified: a tool that dies on the runtime
// deadline must classify as runtime_deadline_exceeded, not surface as a
// tool/db error (whose retry would then die on request-id replay).
func TestLoopDeadlineDuringToolClassified(t *testing.T) {
	slowTool := &ctxBoundTool{name: "run_history.read"}
	llm := newFakeLLM(toolCallTurn("c1", "run_history.read", `{}`), assistantTurn("unreached"))
	in := baseInput(llm, &fakeArtifactStore{}, &fakeEventSink{}, slowTool)
	in.Limits.MaxDuration = 80 * time.Millisecond
	_, err := NewDefault().Execute(context.Background(), in)
	re, ok := AsRuntimeError(err)
	if !ok || re.Code != CodeRuntimeDeadlineExceeded {
		t.Fatalf("err = %v, want %s", err, CodeRuntimeDeadlineExceeded)
	}
}

// ctxBoundTool blocks until the invocation ctx dies, then returns its error
// wrapped — like a real connector tool's HTTP call would.
type ctxBoundTool struct{ name string }

func (c *ctxBoundTool) Name() string                { return c.name }
func (c *ctxBoundTool) Description() string         { return "blocks until ctx death" }
func (c *ctxBoundTool) JSONSchema() json.RawMessage { return json.RawMessage(`{"type":"object"}`) }
func (c *ctxBoundTool) Invoke(ctx context.Context, _ ToolScope, _ json.RawMessage) (json.RawMessage, error) {
	<-ctx.Done()
	return nil, fmt.Errorf("gmail search: %w", ctx.Err())
}

// TestTruncateToolResultEnvelope: oversize results become a VALID JSON
// envelope with an explicit truncation marker, never a silent mid-JSON cut.
func TestTruncateToolResultEnvelope(t *testing.T) {
	small := []byte(`{"ok":true}`)
	if got := truncateToolResult(small, 100); got != `{"ok":true}` {
		t.Fatalf("small result altered: %s", got)
	}

	big := []byte(`{"messages":["` + strings.Repeat("x", 5000) + `"]}`)
	got := truncateToolResult(big, 1024)
	if !json.Valid([]byte(got)) {
		t.Fatalf("envelope is not valid JSON: %s", got[:120])
	}
	var env struct {
		Truncated  bool   `json:"truncated"`
		TotalBytes int    `json:"totalBytes"`
		Prefix     string `json:"prefix"`
	}
	if err := json.Unmarshal([]byte(got), &env); err != nil || !env.Truncated || env.TotalBytes != len(big) || env.Prefix == "" {
		t.Fatalf("envelope = %+v err = %v", env, err)
	}
}

// TestArtifactReadGetsLargerBudget: artifact.read results are capped at the
// dedicated artifact budget, not the generic 16 KiB tool cap.
func TestArtifactReadGetsLargerBudget(t *testing.T) {
	if resultCap("artifact.read") != artifactResultCap || resultCap("connector.read.gmail") != toolResultCap {
		t.Fatalf("resultCap mapping wrong: %d/%d", resultCap("artifact.read"), resultCap("connector.read.gmail"))
	}
	body := strings.Repeat("y", 100<<10)
	raw, _ := json.Marshal(map[string]string{"body": body, "contentType": "text/markdown"})
	if got := truncateToolResult(raw, resultCap("artifact.read")); got != string(raw) {
		t.Fatal("100KiB artifact.read result must not be truncated")
	}
}

// TestLoopArtifactTooLargeReportsRealSize: the limit_exceeded event carries
// the actual staged size, not flush()'s zero return.
func TestLoopArtifactTooLargeReportsRealSize(t *testing.T) {
	sink := &fakeEventSink{}
	in := baseInput(newFakeLLM(assistantTurn(strings.Repeat("x", 2048))), &fakeArtifactStore{}, sink)
	in.Limits.MaxArtifactBytes = 1024
	_, err := NewDefault().Execute(context.Background(), in)
	if re, ok := AsRuntimeError(err); !ok || re.Code != CodeRuntimeArtifactTooLarge {
		t.Fatalf("err = %v", err)
	}
	for _, rec := range sink.records {
		if rec.EventType == eventLimitExceeded {
			if v, ok := rec.Payload["value"].(int); !ok || v != 2048 {
				t.Fatalf("limit event value = %v, want 2048", rec.Payload["value"])
			}
			return
		}
	}
	t.Fatal("limit_exceeded event missing")
}
