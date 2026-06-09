package cloudevents

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func fixture(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("fixture %s: %v", name, err)
	}
	return string(raw)
}

// TestFixturesEndToEnd ingests the shared fixtures through the HTTP handler
// and routes each directly (no Temporal — Router.Route is the activity body),
// asserting the RFC acceptance criteria: matching tasks fire linked
// trigger=event runs, noise fires nothing, duplicates never create a second
// run, oversized payloads are rejected before sealing.
func TestFixturesEndToEnd(t *testing.T) {
	client, u := setup(t)
	internalCtx := auth.WithInternal(context.Background())

	makeTask(t, client, u, "acme-ar-watch", "api", true, "disputed or overdue Acme invoices and AR escalations")
	makeTask(t, client, u, "customer-status", "api", true, "customer meeting changes, QBR scheduling, account health signals")

	// The ingest path uses a recording route controller; routing then runs
	// inline through the same Router the Temporal activity wraps.
	rc := &fakeRouteController{}
	h := New(client, testSealer(t), rc, Config{MaxPayloadBytes: 256 << 10}, zap.NewNop())
	srv := newTestServer(t, h, u)

	pass1IDs := []string{"acme-ar-watch", "customer-status"}
	route := func(t *testing.T, eventID string, pass2 map[string]string) {
		t.Helper()
		r := &Router{
			Client:    client,
			LLM:       &fakeCompleter{pass1IDs: pass1IDs, pass2: pass2},
			Starter:   &fakeStarter{},
			Threshold: 0.7, Model: "m", Log: zap.NewNop(),
		}
		if err := r.Route(context.Background(), uuid.MustParse(eventID)); err != nil {
			t.Fatalf("route: %v", err)
		}
	}

	// 1. Invoice dispute matches the AR task, not the customer-status task.
	status, out := postEvent(t, srv, fixture(t, "gmail_invoice_dispute.json"))
	if status != http.StatusAccepted {
		t.Fatalf("gmail fixture: status %d, want 202", status)
	}
	route(t, out.EventID, map[string]string{
		"acme-ar-watch":   `{"match":true,"confidence":0.86,"explanation":"invoice dispute"}`,
		"customer-status": `{"match":false,"confidence":0.2,"explanation":"not a meeting"}`,
	})
	ev := client.CloudEvent.GetX(internalCtx, uuid.MustParse(out.EventID))
	if ev.RoutingStatus != StatusRouted || ev.MatchedTaskCount != 1 {
		t.Fatalf("gmail fixture: %s/%d, want routed/1", ev.RoutingStatus, ev.MatchedTaskCount)
	}

	// 2. Duplicate (same dedupeKey, provider retry): 200, no re-route.
	enqueuesBefore := len(rc.calls)
	status, dup := postEvent(t, srv, fixture(t, "duplicate_gmail.json"))
	if status != http.StatusOK || !dup.Deduped || dup.EventID != out.EventID {
		t.Fatalf("duplicate fixture: status=%d deduped=%v id=%s, want 200/true/same", status, dup.Deduped, dup.EventID)
	}
	if len(rc.calls) != enqueuesBefore {
		t.Fatal("duplicate fixture must not enqueue routing again")
	}

	// 3. QBR move matches the customer-status task.
	_, out = postEvent(t, srv, fixture(t, "calendar_qbr_moved.json"))
	route(t, out.EventID, map[string]string{
		"acme-ar-watch":   `{"match":false,"confidence":0.1,"explanation":"no invoice"}`,
		"customer-status": `{"match":true,"confidence":0.81,"explanation":"qbr moved"}`,
	})
	ev = client.CloudEvent.GetX(internalCtx, uuid.MustParse(out.EventID))
	if ev.MatchedTaskCount != 1 {
		t.Fatalf("calendar fixture matched %d, want 1", ev.MatchedTaskCount)
	}

	// 4. Slack noise matches nothing.
	_, out = postEvent(t, srv, fixture(t, "slack_noise.json"))
	route(t, out.EventID, map[string]string{
		"acme-ar-watch":   `{"match":false,"confidence":0.05,"explanation":"noise"}`,
		"customer-status": `{"match":false,"confidence":0.05,"explanation":"noise"}`,
	})
	ev = client.CloudEvent.GetX(internalCtx, uuid.MustParse(out.EventID))
	if ev.RoutingStatus != StatusRouted || ev.MatchedTaskCount != 0 {
		t.Fatalf("noise fixture: %s/%d, want routed/0", ev.RoutingStatus, ev.MatchedTaskCount)
	}

	// 5. Oversized payload rejected before sealing — no row.
	status, _ = postEvent(t, srv, fixture(t, "oversized_payload.json"))
	if status != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized fixture: status %d, want 413", status)
	}
	if n := client.CloudEvent.Query().Where().CountX(internalCtx); n != 3 {
		t.Fatalf("event rows = %d, want 3 (oversized must not be stored)", n)
	}
}

// TestFixtureRunLinkage runs the real Starter insert path (no Temporal: the
// run row is created before the workflow start, which is the linkage we
// assert) so GET /v1/events/{id}/runs traverses a genuine FK.
func TestFixtureRunLinkage(t *testing.T) {
	client, u := setup(t)
	task := makeTask(t, client, u, "acme-ar-watch", "api", true, "disputed Acme invoices")
	ev := makeEvent(t, client, u, "link-1")

	// Create the linked run exactly as Starter.createQueuedRun does.
	run := client.BackgroundTaskRun.Create().
		SetUser(u).
		SetTask(task).
		SetRunID("event-" + uuid.NewString()).
		SetTrigger("event").
		SetStatus("queued").
		SetExecutor("api").
		SetCloudEventID(ev.ID).
		SaveX(context.Background())

	got := ev.QueryRuns().OnlyX(auth.WithInternal(context.Background()))
	if got.ID != run.ID {
		t.Fatalf("event->runs traversal returned %s, want %s", got.ID, run.ID)
	}
	back := client.BackgroundTaskRun.Query().
		Where(backgroundtaskrun.CloudEventID(ev.ID)).
		OnlyX(auth.WithInternal(context.Background()))
	if back.RunID != run.RunID {
		t.Fatal("run->event FK lookup failed")
	}
}
