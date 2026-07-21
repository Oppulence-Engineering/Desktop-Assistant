package cloudevents

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// fakeCompleter scripts pass-1/pass-2 responses and records requests.
type fakeCompleter struct {
	pass1IDs []string
	pass1Err error
	pass2    map[string]string // task slug → raw JSON decision
	pass2Err map[string]error
	requests []llm.CompleteRequest
}

func (f *fakeCompleter) CompleteJSON(_ context.Context, req llm.CompleteRequest, out any) error {
	f.requests = append(f.requests, req)
	switch req.SubUseCase {
	case "pass1":
		if f.pass1Err != nil {
			return f.pass1Err
		}
		raw, _ := json.Marshal(map[string]any{"ids": f.pass1IDs})
		return json.Unmarshal(raw, out)
	case "pass2":
		// The pass-2 prompt names exactly one task; find which by slug marker.
		for slug, dec := range f.pass2 {
			if containsSlug(req.Prompt, slug) {
				if err := f.pass2Err[slug]; err != nil {
					return err
				}
				return json.Unmarshal([]byte(dec), out)
			}
		}
		return fmt.Errorf("fake: no scripted pass2 for prompt")
	}
	return fmt.Errorf("fake: unknown sub use case %q", req.SubUseCase)
}

func TestRouteAlreadyCompletedPass1FinishesWithoutPermanentRetry(t *testing.T) {
	client, u := setup(t)
	makeTask(t, client, u, "task-a", "api", true, "x")
	ev := makeEvent(t, client, u, "already-completed-pass1")

	r := &Router{
		Client: client, LLM: &fakeCompleter{pass1Err: llm.ErrAlreadyCompleted},
		Starter: &fakeStarter{}, Threshold: 0.7, Model: "m", Log: zap.NewNop(),
	}
	if err := r.Route(context.Background(), ev.ID); err != nil {
		t.Fatalf("already-completed pass-1 must terminate instead of retrying forever: %v", err)
	}
	got := client.CloudEvent.GetX(auth.WithInternal(context.Background()), ev.ID)
	if got.RoutingStatus != StatusRouted || got.MatchedTaskCount != 0 {
		t.Fatalf("event = %s/%d, want routed/0", got.RoutingStatus, got.MatchedTaskCount)
	}
}

func containsSlug(prompt, slug string) bool {
	// Pass-2 prompts embed the task name; we script with name == slug.
	return jsonContains(prompt, slug)
}

func jsonContains(haystack, needle string) bool {
	return len(needle) > 0 && len(haystack) >= len(needle) && (func() bool {
		for i := 0; i+len(needle) <= len(haystack); i++ {
			if haystack[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	})()
}

// fakeStarter records starts and optionally fails specific slugs.
type fakeStarter struct {
	failSlugs map[string]bool
	started   []backgroundtaskruns.Params
}

func (f *fakeStarter) Start(_ context.Context, p backgroundtaskruns.Params) (*ent.BackgroundTaskRun, error) {
	if f.failSlugs[p.Task.Slug] {
		return nil, fmt.Errorf("temporal start failed")
	}
	f.started = append(f.started, p)
	return &ent.BackgroundTaskRun{RunID: "event-run-" + p.Task.Slug}, nil
}

func makeTask(t *testing.T, client *ent.Client, u *ent.User, slug, target string, active bool, criteria string) *ent.BackgroundTask {
	t.Helper()
	triggers := "{}"
	if criteria != "" {
		raw, _ := json.Marshal(map[string]string{"eventMatchCriteria": criteria})
		triggers = string(raw)
	}
	return client.BackgroundTask.Create().
		SetUser(u).
		SetSlug(slug).
		SetName(slug).
		SetInstructions("watch for " + slug).
		SetActive(active).
		SetExecutionTarget(target).
		SetTriggersJSON(triggers).
		SaveX(auth.WithUser(context.Background(), u))
}

func makeEvent(t *testing.T, client *ent.Client, u *ent.User, dedupe string) *ent.CloudEvent {
	t.Helper()
	return client.CloudEvent.Create().
		SetUser(u).
		SetSource(SourceInternal).
		SetDedupeKey(dedupe).
		SetSubject("Invoice #4821 dispute").
		SetText("Acme disputed invoice #4821.").
		SaveX(auth.WithUser(context.Background(), u))
}

func TestRouteThresholdGating(t *testing.T) {
	client, u := setup(t)
	makeTask(t, client, u, "acme-watch", "api", true, "disputed Acme invoices")
	makeTask(t, client, u, "weekly-digest", "api", true, "weekly summaries")
	ev := makeEvent(t, client, u, "e1")

	comp := &fakeCompleter{
		pass1IDs: []string{"acme-watch", "weekly-digest"},
		pass2: map[string]string{
			"acme-watch":    `{"match":true,"confidence":0.86,"explanation":"dispute matches"}`,
			"weekly-digest": `{"match":true,"confidence":0.42,"explanation":"weak"}`,
		},
	}
	starter := &fakeStarter{}
	r := &Router{Client: client, LLM: comp, Starter: starter, Threshold: 0.7, Model: "m", Log: zap.NewNop()}

	if err := r.Route(context.Background(), ev.ID); err != nil {
		t.Fatalf("route: %v", err)
	}
	if len(starter.started) != 1 || starter.started[0].Task.Slug != "acme-watch" {
		t.Fatalf("started = %+v, want exactly acme-watch (0.42 < threshold)", starter.started)
	}
	if got := starter.started[0]; got.Trigger != "event" || got.CloudEventID == nil || *got.CloudEventID != ev.ID {
		t.Fatalf("start params = %+v, want trigger=event linked to the event", got)
	}

	ev = client.CloudEvent.GetX(auth.WithInternal(context.Background()), ev.ID)
	if ev.RoutingStatus != StatusRouted || ev.MatchedTaskCount != 1 {
		t.Fatalf("event = %s/%d, want routed/1", ev.RoutingStatus, ev.MatchedTaskCount)
	}
	var summary routingJSON
	if err := json.Unmarshal([]byte(ev.RoutingJSON), &summary); err != nil {
		t.Fatalf("routing json: %v", err)
	}
	if len(summary.Decisions) != 2 {
		t.Fatalf("decisions = %d, want 2 (below-threshold decisions recorded too)", len(summary.Decisions))
	}
}

func TestRouteEligibilityFilter(t *testing.T) {
	client, u := setup(t)
	makeTask(t, client, u, "match-me", "api", true, "anything")
	makeTask(t, client, u, "inactive", "api", false, "anything")
	makeTask(t, client, u, "desktop-task", "desktop", true, "anything")
	makeTask(t, client, u, "no-criteria", "api", true, "")
	ev := makeEvent(t, client, u, "e1")

	comp := &fakeCompleter{pass1IDs: []string{"match-me", "inactive", "desktop-task", "no-criteria"},
		pass2: map[string]string{"match-me": `{"match":false,"confidence":0.1,"explanation":"no"}`}}
	r := &Router{Client: client, LLM: comp, Starter: &fakeStarter{}, Threshold: 0.7, Model: "m"}
	if err := r.Route(context.Background(), ev.ID); err != nil {
		t.Fatalf("route: %v", err)
	}
	// Pass-1 prompt must contain only the one eligible task.
	if len(comp.requests) == 0 {
		t.Fatal("no llm requests made")
	}
	p1 := comp.requests[0].Prompt
	for _, excluded := range []string{"inactive", "desktop-task", "no-criteria"} {
		if jsonContains(p1, excluded) {
			t.Fatalf("pass-1 prompt includes ineligible task %q", excluded)
		}
	}
	if !jsonContains(p1, "match-me") {
		t.Fatal("pass-1 prompt missing the eligible task")
	}
}

func TestRoutePerTaskStartFailureIsolation(t *testing.T) {
	client, u := setup(t)
	makeTask(t, client, u, "fails", "api", true, "x")
	makeTask(t, client, u, "works", "api", true, "x")
	ev := makeEvent(t, client, u, "e1")

	comp := &fakeCompleter{
		pass1IDs: []string{"fails", "works"},
		pass2: map[string]string{
			"fails": `{"match":true,"confidence":0.9,"explanation":"y"}`,
			"works": `{"match":true,"confidence":0.9,"explanation":"y"}`,
		},
	}
	starter := &fakeStarter{failSlugs: map[string]bool{"fails": true}}
	r := &Router{Client: client, LLM: comp, Starter: starter, Threshold: 0.7, Model: "m"}
	if err := r.Route(context.Background(), ev.ID); err != nil {
		t.Fatalf("route: %v", err)
	}
	if len(starter.started) != 1 || starter.started[0].Task.Slug != "works" {
		t.Fatalf("one task's start failure must not poison the other; started=%+v", starter.started)
	}
	ev = client.CloudEvent.GetX(auth.WithInternal(context.Background()), ev.ID)
	if ev.RoutingStatus != StatusRouted || ev.MatchedTaskCount != 1 {
		t.Fatalf("event = %s/%d, want routed/1", ev.RoutingStatus, ev.MatchedTaskCount)
	}
}

func TestRouteInsufficientCreditsIsTerminal(t *testing.T) {
	client, u := setup(t)
	makeTask(t, client, u, "task-a", "api", true, "x")
	ev := makeEvent(t, client, u, "e1")

	comp := &fakeCompleter{
		pass1IDs: []string{"task-a"},
		pass2:    map[string]string{"task-a": `{}`},
		pass2Err: map[string]error{"task-a": quota.ErrInsufficientCredits},
	}
	r := &Router{Client: client, LLM: comp, Starter: &fakeStarter{}, Threshold: 0.7, Model: "m"}
	err := r.Route(context.Background(), ev.ID)
	if err == nil || !IsTerminalRouteError(err) {
		t.Fatalf("err = %v, want terminal route error on quota exhaustion", err)
	}
	ev = client.CloudEvent.GetX(auth.WithInternal(context.Background()), ev.ID)
	if ev.RoutingStatus != StatusFailed {
		t.Fatalf("routingStatus = %s, want failed", ev.RoutingStatus)
	}
}

func TestRouteAlreadyTerminalIsNoOp(t *testing.T) {
	client, u := setup(t)
	ev := makeEvent(t, client, u, "e1")
	client.CloudEvent.UpdateOneID(ev.ID).SetRoutingStatus(StatusRouted).ExecX(auth.WithInternal(context.Background()))

	comp := &fakeCompleter{}
	r := &Router{Client: client, LLM: comp, Starter: &fakeStarter{}, Threshold: 0.7, Model: "m"}
	if err := r.Route(context.Background(), ev.ID); err != nil {
		t.Fatalf("route: %v", err)
	}
	if len(comp.requests) != 0 {
		t.Fatalf("terminal event must not re-run LLM calls; got %d", len(comp.requests))
	}
}

func TestRouteRequestIDsAreDeterministic(t *testing.T) {
	client, u := setup(t)
	makeTask(t, client, u, "task-a", "api", true, "x")
	ev := makeEvent(t, client, u, "e1")

	comp := &fakeCompleter{
		pass1IDs: []string{"task-a"},
		pass2:    map[string]string{"task-a": `{"match":false,"confidence":0.1,"explanation":"no"}`},
	}
	r := &Router{Client: client, LLM: comp, Starter: &fakeStarter{}, Threshold: 0.7, Model: "m"}
	if err := r.Route(context.Background(), ev.ID); err != nil {
		t.Fatalf("route: %v", err)
	}
	if len(comp.requests) != 2 {
		t.Fatalf("requests = %d, want pass1+pass2", len(comp.requests))
	}
	if comp.requests[0].RequestID != routeRequestID(ev.ID, "pass1/0") {
		t.Fatal("pass-1 request id must be deterministic per (event, batch)")
	}
	if comp.requests[1].RequestID != routeRequestID(ev.ID, "pass2/task-a") {
		t.Fatal("pass-2 request id must be deterministic per (event, slug)")
	}
	if comp.requests[0].RequestID == uuid.Nil {
		t.Fatal("request id must not be nil")
	}
}

func TestEventSummaryOmitsPayload(t *testing.T) {
	client, u := setup(t)
	ev := client.CloudEvent.Create().
		SetUser(u).
		SetSource(SourceGmail).
		SetEventType("email.received").
		SetDedupeKey("e1").
		SetSubject("Invoice").
		SetText("gist here").
		SetPayloadCiphertext([]byte("SEALED-SECRET-BYTES")).
		SaveX(auth.WithInternal(context.Background()))
	s := eventSummary(ev)
	if jsonContains(s, "SEALED") {
		t.Fatal("requested_context must never contain payload bytes")
	}
	if !jsonContains(s, "gmail") || !jsonContains(s, "gist here") {
		t.Fatalf("summary = %q, want source + gist", s)
	}
}
