package agentworkflow

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsession"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsessionevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

func newDBActivities(t *testing.T) (*Activities, *ent.User, string) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	ctx := context.Background()
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	ctx = auth.WithUser(ctx, u)
	sessionID := "sess-evt"
	d.Client.AgentSession.Create().
		SetUser(u).SetSessionID(sessionID).SetAgentSlug("assistant").SetChannel("http").SetStatus("active").
		SaveX(ctx)
	return &Activities{Client: d.Client, Catalog: agentregistry.DefaultCatalog(), Log: zap.NewNop()}, u, sessionID
}

// TestAppendSessionEventIdempotent is the at-least-once event-projection gate:
// the workflow owns the seq, and the unique (session, seq) index makes a retry
// that re-appends the same seq a no-op (one row), while distinct seqs append.
func TestAppendSessionEventIdempotent(t *testing.T) {
	a, u, sessionID := newDBActivities(t)
	ctx := context.Background()

	in := AppendEventInput{UserID: u.ID.String(), SessionID: sessionID, Seq: 0, EventType: EventSessionStarted, EventJSON: `{"a":1}`}
	if err := a.AppendSessionEvent(ctx, in); err != nil {
		t.Fatalf("append seq0: %v", err)
	}
	// Re-append the SAME seq (simulating an activity retry): must be idempotent.
	if err := a.AppendSessionEvent(ctx, in); err != nil {
		t.Fatalf("re-append seq0: %v", err)
	}
	// A distinct seq appends a second row.
	if err := a.AppendSessionEvent(ctx, AppendEventInput{UserID: u.ID.String(), SessionID: sessionID, Seq: 1, EventType: EventTurnStarted, EventJSON: `{"b":2}`}); err != nil {
		t.Fatalf("append seq1: %v", err)
	}

	count := a.Client.AgentSessionEvent.Query().
		Where(agentsessionevent.HasSessionWith(agentsession.SessionIDEQ(sessionID))).
		CountX(auth.WithInternal(ctx))
	if count != 2 {
		t.Fatalf("expected 2 events after an idempotent retry, got %d", count)
	}
}

// TestToolInvokeClaimChecksOversizedResult is the claim-check gate: a tool
// result larger than the transcript cap is spilled to the blob store and only a
// reference + preview re-enters the transcript; tool_result.read then retrieves
// the full content by reference.
func TestToolInvokeClaimChecksOversizedResult(t *testing.T) {
	a, u, sessionID := newDBActivities(t)
	ctx := context.Background()

	// echo returns its input, so a huge input yields an oversized result.
	big := strings.Repeat("x", 20<<10) // 20 KiB > 16 KiB cap
	args, _ := json.Marshal(map[string]string{"text": big})
	res, err := a.ToolInvoke(ctx, ToolInvokeInput{
		UserID: u.ID.String(), SessionID: sessionID, TurnSeq: 0, CallIndex: 0,
		ToolName: "echo", Args: args, AllowedTools: []string{"echo"},
	})
	if err != nil {
		t.Fatalf("ToolInvoke: %v", err)
	}
	var env struct {
		Truncated bool   `json:"truncated"`
		BlobRef   string `json:"blobRef"`
		Total     int    `json:"totalBytes"`
	}
	if jerr := json.Unmarshal([]byte(res.ResultJSON), &env); jerr != nil || !env.Truncated || env.BlobRef == "" {
		t.Fatalf("expected a claim-check envelope, got %q", res.ResultJSON)
	}

	// The full result is retrievable via tool_result.read.
	capability, _ := a.Catalog.Get("tool_result.read")
	reader := capability.Build(agentregistry.ToolDeps{Client: a.Client})
	readArgs, _ := json.Marshal(map[string]any{"blobRef": env.BlobRef, "offset": 0, "limit": 64 << 10})
	out, err := reader.Invoke(auth.WithInternal(ctx), backgroundtaskruntime.ToolScope{UserID: u.ID.String(), RunID: sessionID}, readArgs)
	if err != nil {
		t.Fatalf("tool_result.read: %v", err)
	}
	var window struct {
		Content    string `json:"content"`
		TotalBytes int    `json:"totalBytes"`
	}
	if jerr := json.Unmarshal(out, &window); jerr != nil {
		t.Fatalf("bad read window: %v", jerr)
	}
	if window.TotalBytes != len(big)+len(`{"text":""}`) && !strings.Contains(window.Content, big[:1000]) {
		t.Fatalf("read window did not return the stored content (total=%d)", window.TotalBytes)
	}
}

// TestEnsureSessionIdempotent confirms the session upsert is safe to call more
// than once (root row pre-created by the starter, then re-ensured by the
// workflow at start).
func TestEnsureSessionIdempotent(t *testing.T) {
	a, u, sessionID := newDBActivities(t)
	ctx := context.Background()
	start := SessionStart{UserID: u.ID.String(), SessionID: sessionID, AgentSlug: "assistant", Channel: "http"}

	if err := a.EnsureSession(ctx, EnsureSessionInput{Start: start, TemporalWorkflowID: "wf-1", TemporalRunID: "run-1"}); err != nil {
		t.Fatalf("ensure 1: %v", err)
	}
	if err := a.EnsureSession(ctx, EnsureSessionInput{Start: start, TemporalWorkflowID: "wf-1", TemporalRunID: "run-2"}); err != nil {
		t.Fatalf("ensure 2: %v", err)
	}
	n := a.Client.AgentSession.Query().Where(agentsession.SessionIDEQ(sessionID)).CountX(auth.WithInternal(ctx))
	if n != 1 {
		t.Fatalf("expected exactly 1 session row, got %d", n)
	}
}
