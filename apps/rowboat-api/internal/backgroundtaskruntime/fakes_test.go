package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"fmt"
)

// fakeArtifactStore records writes and serves a configurable current body.
type fakeArtifactStore struct {
	body        string
	contentType string
	revision    int
	writes      []string
	writeErr    error
}

func (f *fakeArtifactStore) Read(context.Context) (string, string, int, error) {
	ct := f.contentType
	if ct == "" {
		ct = "text/markdown"
	}
	return f.body, ct, f.revision, nil
}

func (f *fakeArtifactStore) Write(_ context.Context, body, contentType string) (int, error) {
	if f.writeErr != nil {
		return 0, f.writeErr
	}
	f.writes = append(f.writes, body)
	f.body = body
	f.contentType = contentType
	f.revision++
	return f.revision, nil
}

// sinkRecord is one EventSink interaction.
type sinkRecord struct {
	Kind      string // "progress" | "event"
	EventType string
	Percent   int
	Message   string
	Payload   map[string]any
}

// fakeEventSink records everything and can inject failures.
type fakeEventSink struct {
	records []sinkRecord
	failOn  string // event type that returns an error
}

func (f *fakeEventSink) Progress(ctx context.Context, percent int, message string) error {
	return f.ProgressEvent(ctx, eventProgress, percent, message, nil)
}

func (f *fakeEventSink) ProgressEvent(_ context.Context, eventType string, percent int, message string, extra map[string]any) error {
	if f.failOn == eventType {
		return fmt.Errorf("sink failure on %s", eventType)
	}
	f.records = append(f.records, sinkRecord{Kind: "progress", EventType: eventType, Percent: percent, Message: message, Payload: extra})
	return nil
}

func (f *fakeEventSink) Emit(_ context.Context, eventType string, payload map[string]any) error {
	if f.failOn == eventType {
		return fmt.Errorf("sink failure on %s", eventType)
	}
	f.records = append(f.records, sinkRecord{Kind: "event", EventType: eventType, Payload: payload})
	return nil
}

func (f *fakeEventSink) types() []string {
	out := make([]string, 0, len(f.records))
	for _, r := range f.records {
		out = append(out, r.EventType)
	}
	return out
}

// fakeTool returns a scripted result or error.
type fakeTool struct {
	name    string
	result  json.RawMessage
	err     error
	invokes []json.RawMessage
	scopes  []ToolScope
}

func (f *fakeTool) Name() string                { return f.name }
func (f *fakeTool) Description() string         { return "fake " + f.name }
func (f *fakeTool) JSONSchema() json.RawMessage { return json.RawMessage(`{"type":"object"}`) }
func (f *fakeTool) Invoke(_ context.Context, scope ToolScope, args json.RawMessage) (json.RawMessage, error) {
	f.invokes = append(f.invokes, args)
	f.scopes = append(f.scopes, scope)
	if f.err != nil {
		return nil, f.err
	}
	return f.result, nil
}

// fakeLLM plays back scripted turns in order.
type fakeLLM struct {
	turns    []Turn
	err      error
	errAt    int // call index at which err fires (-1 = never)
	requests [][]Message
}

func newFakeLLM(turns ...Turn) *fakeLLM { return &fakeLLM{turns: turns, errAt: -1} }

func (f *fakeLLM) Complete(_ context.Context, callIndex int, messages []Message, _ []ToolDef) (Turn, error) {
	f.requests = append(f.requests, messages)
	if f.err != nil && callIndex == f.errAt {
		return Turn{}, f.err
	}
	if len(f.turns) == 0 {
		return Turn{}, fmt.Errorf("fakeLLM: no scripted turns left")
	}
	t := f.turns[0]
	f.turns = f.turns[1:]
	return t, nil
}

// assistantTurn scripts a plain final answer.
func assistantTurn(content string) Turn {
	return Turn{Message: Message{Role: "assistant", Content: content}, Provider: "openrouter", Model: "m", InputTokens: 10, OutputTokens: 5}
}

// toolCallTurn scripts an assistant turn requesting one tool.
func toolCallTurn(id, name, args string) Turn {
	return Turn{Message: Message{
		Role:      "assistant",
		ToolCalls: []ToolCallRequest{{ID: id, Name: name, Arguments: json.RawMessage(args)}},
	}, Provider: "openrouter", Model: "m", InputTokens: 10, OutputTokens: 5}
}
