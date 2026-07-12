package agentstream

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

// TestStreamBackfillFromAfterSeq is the SSE-reconnect gate: a client that
// reconnects with ?afterSeq=N receives a gap-free, duplicate-free tail of the
// durable projection starting after N, and the stream ends on the terminal
// event. (Bus-less, so this is the pure durable-poll path.)
func TestStreamBackfillFromAfterSeq(t *testing.T) {
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	defer func() { _ = d.Close() }()
	ctx := context.Background()
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	ctx = auth.WithUser(ctx, u)
	sess := d.Client.AgentSession.Create().
		SetUser(u).SetSessionID("sess-stream").SetAgentSlug("assistant").SetChannel("http").SetStatus("active").
		SaveX(ctx)

	mk := func(seq int, typ, body string) {
		d.Client.AgentSessionEvent.Create().SetUser(u).SetSession(sess).SetSeq(seq).SetEventType(typ).SetEventJSON(body).ExecX(ctx)
	}
	mk(0, agentworkflow.EventSessionStarted, `{"a":0}`)
	mk(1, agentworkflow.EventTurnStarted, `{"a":1}`)
	mk(2, agentworkflow.EventTurnCompleted, `{"a":2}`)
	mk(3, agentworkflow.EventSessionCompleted, `{"status":"completed"}`)

	s := NewStreamer(d.Client, nil, zap.NewNop())
	rec := httptest.NewRecorder()
	// Reconnect after seq 1: expect seq 2 and 3 only, ending on the terminal event.
	req := httptest.NewRequest("GET", "/v1/agent-sessions/sess-stream/stream?afterSeq=1", nil).
		WithContext(auth.WithUser(context.Background(), u))

	s.Stream(rec, req, sess)

	if ct := rec.Header().Get("Content-Type"); ct != "application/x-ndjson" {
		t.Fatalf("content-type = %q, want application/x-ndjson", ct)
	}
	var seqs []int
	sc := bufio.NewScanner(strings.NewReader(rec.Body.String()))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var ev agentworkflow.StreamEvent
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			t.Fatalf("bad NDJSON line %q: %v", line, err)
		}
		seqs = append(seqs, ev.Seq)
	}
	if len(seqs) != 2 || seqs[0] != 2 || seqs[1] != 3 {
		t.Fatalf("expected seqs [2 3] after afterSeq=1, got %v", seqs)
	}
}
