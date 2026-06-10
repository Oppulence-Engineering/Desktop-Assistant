package cloudevents

import (
	"context"
	"errors"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/google/uuid"
	"go.temporal.io/sdk/temporal"
	"go.uber.org/zap"
)

// TestRouteActivityErrorTranslation locks in the retry contract: quota
// exhaustion and vanished events become NON-RETRYABLE application errors with
// the types the workflow's RetryPolicy excludes; everything else stays
// retryable.
func TestRouteActivityErrorTranslation(t *testing.T) {
	client, u := setup(t)
	a := &Activities{Log: zap.NewNop()}

	// Invalid event id → non-retryable event_not_found.
	a.Router = &Router{Client: client, Threshold: 0.7, Model: "m"}
	err := a.RouteCloudEvent(context.Background(), RouteInput{UserID: u.ID.String(), EventID: "not-a-uuid"})
	assertNonRetryable(t, err, errTypeEventNotFound)

	// Vanished event → non-retryable event_not_found.
	err = a.RouteCloudEvent(context.Background(), RouteInput{UserID: u.ID.String(), EventID: uuid.NewString()})
	assertNonRetryable(t, err, errTypeEventNotFound)

	// Quota exhaustion mid-route → non-retryable insufficient_credits.
	makeTask(t, client, u, "task-a", "api", true, "x")
	ev := makeEvent(t, client, u, "wf-e1")
	a.Router = &Router{
		Client: client,
		LLM: &fakeCompleter{
			pass1IDs: []string{"task-a"},
			pass2:    map[string]string{"task-a": `{}`},
			pass2Err: map[string]error{"task-a": quota.ErrInsufficientCredits},
		},
		Starter: &fakeStarter{}, Threshold: 0.7, Model: "m",
	}
	err = a.RouteCloudEvent(context.Background(), RouteInput{UserID: u.ID.String(), EventID: ev.ID.String()})
	assertNonRetryable(t, err, errTypeInsufficientCredits)

	// A transient failure (all pass-1 batches down, not quota) stays retryable.
	ev2 := makeEvent(t, client, u, "wf-e2")
	a.Router = &Router{
		Client:  client,
		LLM:     &failingCompleter{},
		Starter: &fakeStarter{}, Threshold: 0.7, Model: "m",
	}
	err = a.RouteCloudEvent(context.Background(), RouteInput{UserID: u.ID.String(), EventID: ev2.ID.String()})
	if err == nil {
		t.Fatal("want retryable error when every pass-1 batch fails")
	}
	var appErr *temporal.ApplicationError
	if errors.As(err, &appErr) && appErr.NonRetryable() {
		t.Fatalf("transient LLM outage must stay retryable, got non-retryable %v", err)
	}
}

func assertNonRetryable(t *testing.T, err error, wantType string) {
	t.Helper()
	var appErr *temporal.ApplicationError
	if !errors.As(err, &appErr) {
		t.Fatalf("err = %v, want temporal ApplicationError", err)
	}
	if !appErr.NonRetryable() || appErr.Type() != wantType {
		t.Fatalf("err = %v (type=%s nonRetryable=%v), want non-retryable %s", err, appErr.Type(), appErr.NonRetryable(), wantType)
	}
}

type failingCompleter struct{}

func (f *failingCompleter) CompleteJSON(context.Context, llm.CompleteRequest, any) error {
	return errors.New("upstream 503")
}
