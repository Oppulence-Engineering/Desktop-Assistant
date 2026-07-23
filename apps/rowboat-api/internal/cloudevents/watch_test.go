package cloudevents

import (
	"context"
	"testing"

	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

// fakeWatcher scripts an ActionWatchResult for a product return event.
type fakeWatcher struct {
	result ActionWatchResult
	calls  int
}

func (f *fakeWatcher) IsProductSource(source string) bool { return source == "conduit" }

func (f *fakeWatcher) CorrelateReturn(_ context.Context, _ *ent.User, _ *ent.CloudEvent) (ActionWatchResult, error) {
	f.calls++
	return f.result, nil
}

// productReturnEvent creates a pending conduit return event with a correlation.
func productReturnEvent(t *testing.T, client *ent.Client, u *ent.User, correlation string) *ent.CloudEvent {
	t.Helper()
	return client.CloudEvent.Create().
		SetUser(u).
		SetSource("conduit").
		SetDedupeKey("ret-" + correlation).
		SetCorrelationID(correlation).
		SetEventType("conduit.invoice.paid").
		SaveX(auth.WithUser(context.Background(), u))
}

// makeRun creates a background_task_run for a task so the Watch leg can resolve
// the originating task from a run id.
func makeRun(t *testing.T, client *ent.Client, u *ent.User, task *ent.BackgroundTask, runID string) {
	t.Helper()
	client.BackgroundTaskRun.Create().
		SetUser(u).
		SetTask(task).
		SetRunID(runID).
		SetStatus("succeeded").
		SetTrigger("event").
		SaveX(auth.WithUser(context.Background(), u))
}

// A matched product return event re-triggers the originating task's run.
func TestWatchReTriggersOriginTask(t *testing.T) {
	client, u := setup(t)
	task := makeTask(t, client, u, "acme-dunning", "api", true, "Acme dunning")
	makeRun(t, client, u, task, "origin-run-1")
	ev := productReturnEvent(t, client, u, "corr-abc")

	starter := &fakeStarter{}
	watcher := &fakeWatcher{result: ActionWatchResult{
		Matched: true, OriginRunID: "origin-run-1",
		Kind: "conduit.dunning.advance", Target: "conduit:invoice:inv_1", ResultRef: "conduit:step:s2",
	}}
	r := &Router{Client: client, Starter: starter, Watcher: watcher, Log: zap.NewNop()}

	if err := r.Route(auth.WithInternal(context.Background()), ev.ID); err != nil {
		t.Fatalf("route: %v", err)
	}
	if watcher.calls != 1 {
		t.Fatalf("watcher calls = %d, want 1", watcher.calls)
	}
	if len(starter.started) != 1 {
		t.Fatalf("re-trigger started %d runs, want 1", len(starter.started))
	}
	got := starter.started[0]
	if got.Trigger != "action-return" || got.Task.Slug != "acme-dunning" || got.CloudEventID == nil {
		t.Fatalf("re-trigger params wrong: %+v", got)
	}
	// The event is now terminal (routed) — no LLM matching ran.
	reloaded := client.CloudEvent.GetX(auth.WithInternal(context.Background()), ev.ID)
	if reloaded.RoutingStatus != StatusRouted {
		t.Fatalf("routing status = %q, want routed", reloaded.RoutingStatus)
	}
}

// A duplicate return event closes no loop and starts no run.
func TestWatchDuplicateIsNoop(t *testing.T) {
	client, u := setup(t)
	ev := productReturnEvent(t, client, u, "corr-dup")
	starter := &fakeStarter{}
	watcher := &fakeWatcher{result: ActionWatchResult{Matched: true, AlreadyClosed: true}}
	r := &Router{Client: client, Starter: starter, Watcher: watcher, Log: zap.NewNop()}

	if err := r.Route(auth.WithInternal(context.Background()), ev.ID); err != nil {
		t.Fatalf("route: %v", err)
	}
	if len(starter.started) != 0 {
		t.Fatal("duplicate return must not start a run")
	}
	if client.CloudEvent.GetX(auth.WithInternal(context.Background()), ev.ID).RoutingStatus != StatusRouted {
		t.Fatal("duplicate return event should still be marked routed")
	}
}

// An unmatched product return event is routed (not an error) and starts nothing.
func TestWatchUnmatchedIsRouted(t *testing.T) {
	client, u := setup(t)
	ev := productReturnEvent(t, client, u, "corr-none")
	starter := &fakeStarter{}
	watcher := &fakeWatcher{result: ActionWatchResult{Matched: false}}
	r := &Router{Client: client, Starter: starter, Watcher: watcher, Log: zap.NewNop()}

	if err := r.Route(auth.WithInternal(context.Background()), ev.ID); err != nil {
		t.Fatalf("route: %v", err)
	}
	if len(starter.started) != 0 {
		t.Fatal("unmatched return must not start a run")
	}
}

// With no watcher configured, a product-source event routes normally (the Watch
// branch is inert). Here there are no eligible tasks, so it just finishes.
func TestWatchDisabledFallsThrough(t *testing.T) {
	client, u := setup(t)
	ev := productReturnEvent(t, client, u, "corr-x")
	r := &Router{Client: client, LLM: &fakeCompleter{}, Starter: &fakeStarter{}, Threshold: 0.7, Log: zap.NewNop()}
	if err := r.Route(auth.WithInternal(context.Background()), ev.ID); err != nil {
		t.Fatalf("route: %v", err)
	}
	if client.CloudEvent.GetX(auth.WithInternal(context.Background()), ev.ID).RoutingStatus != StatusRouted {
		t.Fatal("event should be routed")
	}
}
