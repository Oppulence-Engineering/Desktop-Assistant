package backgroundtaskruntime

import (
	"context"
	"encoding/json"
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
