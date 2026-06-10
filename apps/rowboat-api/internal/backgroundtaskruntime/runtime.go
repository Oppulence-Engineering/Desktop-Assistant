// Package backgroundtaskruntime is the cloud-safe agent runtime for API
// background tasks (RFC 004): an LLM-backed, tool-scoped, limit-bounded
// execution loop that the Temporal worker's ExecuteAPITask activity delegates
// to. The activity owns the durable boundary (claim, terminal states,
// retries); this package owns the loop. Everything here is plain Go with no
// Temporal imports, so the loop is unit-testable with fakes.
package backgroundtaskruntime

import (
	"context"
	"encoding/json"
)

// RunInput binds one run's identity, instructions, and capabilities.
type RunInput struct {
	UserID, TaskID, Slug, RunID string
	TaskName                    string
	Trigger, RequestedContext   string
	Instructions                string
	Model, Provider             string // optional per-task override; empty → runtime default

	Artifacts ArtifactStore
	Events    EventSink
	Tools     ToolRegistry
	LLM       LLMClient
	Limits    Limits
}

// RunOutput summarizes a successful run.
type RunOutput struct {
	Summary       string
	ArtifactBytes int
	LLMCalls      int
	ToolCalls     int
}

// Runtime executes the bounded agent loop. Implementations must be safe to
// call from a Temporal activity (no global mutable state) and must emit
// progress via Events so the activity heartbeats during long LLM calls.
type Runtime interface {
	Execute(ctx context.Context, in RunInput) (RunOutput, error)
}

// ArtifactStore is the task's single index.md artifact. Write is atomic and
// called at most once per successful run (preserve-on-failure: a failed run
// leaves the prior artifact untouched).
type ArtifactStore interface {
	Read(ctx context.Context) (body, contentType string, revision int, err error)
	Write(ctx context.Context, body, contentType string) (revision int, err error)
}

// EventSink appends run events and drives run-row progress + activity
// heartbeats.
//
// ProgressEvent exists alongside Progress (a deviation from the RFC's
// two-method sketch) so the deterministic path can reproduce today's exact
// sequence: the progress-90 update is paired with a temporal.artifact_updated
// event, not a temporal.progress one.
type EventSink interface {
	// Progress ≡ ProgressEvent(EventProgress, percent, message, nil).
	Progress(ctx context.Context, percent int, message string) error
	// ProgressEvent updates the run row (heartbeat, percent, message) and
	// appends one event of the given type carrying the same payload + extra.
	ProgressEvent(ctx context.Context, eventType string, percent int, message string, extra map[string]any) error
	// Emit appends an event without touching run-row progress.
	Emit(ctx context.Context, eventType string, payload map[string]any) error
}

// LLMClient is the gateway-backed completion surface (billing applies).
type LLMClient interface {
	// Complete advances the conversation one turn; callIndex anchors the
	// deterministic per-call idempotency key.
	Complete(ctx context.Context, callIndex int, messages []Message, tools []ToolDef) (Turn, error)
}

// Message is one conversation turn (gateway-shape agnostic to keep fakes
// trivial; the adapter maps to llm.ChatMessage).
type Message struct {
	Role       string
	Content    string
	ToolCalls  []ToolCallRequest
	ToolCallID string
}

// ToolCallRequest is one tool invocation the model asked for.
type ToolCallRequest struct {
	ID        string
	Name      string
	Arguments json.RawMessage
}

// ToolDef advertises one tool to the model.
type ToolDef struct {
	Name        string
	Description string
	Parameters  json.RawMessage
}

// Turn is the assistant's reply.
type Turn struct {
	Message      Message
	Provider     string
	Model        string
	InputTokens  int
	OutputTokens int
	LatencyMs    int64
}

// ToolScope is the immutable identity every tool invocation carries. Tools
// resolve credentials from it internally — never from model-provided text.
type ToolScope struct {
	UserID   string
	TaskSlug string
	RunID    string
	Allowed  []string // capability scopes, e.g. ["gmail.readonly"]
}

// Tool is one allowlisted capability.
type Tool interface {
	Name() string
	Description() string
	JSONSchema() json.RawMessage
	Invoke(ctx context.Context, scope ToolScope, args json.RawMessage) (json.RawMessage, error)
}

// ToolRegistry is the deny-by-default tool surface: Lookup resolves a tool
// only if it is allowlisted AND the run's scope permits it.
type ToolRegistry interface {
	Lookup(name string) (Tool, error)
	List() []Tool
}
