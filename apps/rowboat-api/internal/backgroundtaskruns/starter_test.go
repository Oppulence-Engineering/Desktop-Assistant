package backgroundtaskruns_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrunevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskmetrics"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"go.uber.org/zap"
)

// fakeController records StartBackgroundTaskRun calls and can be made to fail,
// standing in for the Temporal SDK without importing it.
type fakeController struct {
	starts   []backgroundtaskworkflow.StartInput
	startErr error
}

func (f *fakeController) StartBackgroundTaskRun(_ context.Context, in backgroundtaskworkflow.StartInput) (backgroundtaskworkflow.StartResult, error) {
	f.starts = append(f.starts, in)
	if f.startErr != nil {
		return backgroundtaskworkflow.StartResult{}, f.startErr
	}
	// Mirror the real Starter, which returns the deterministic workflow id it
	// was handed (run.GetID()), plus a Temporal-assigned run id.
	return backgroundtaskworkflow.StartResult{
		WorkflowID: backgroundtaskworkflow.WorkflowID(in.UserID, in.Slug, in.RunID),
		RunID:      "trun-" + in.RunID,
	}, nil
}

func (f *fakeController) CancelBackgroundTaskRun(context.Context, string, string) error { return nil }
func (f *fakeController) SignalBackgroundTaskRun(context.Context, string, string, string, map[string]any) error {
	return nil
}

func setup(t *testing.T) (*ent.Client, *ent.User, *ent.BackgroundTask) {
	t.Helper()
	dbName := strings.NewReplacer("/", "_", " ", "_").Replace(t.Name())
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + dbName + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	ctx := context.Background()
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	task := d.Client.BackgroundTask.Create().
		SetUser(u).SetSlug("api-task").SetName("API Task").
		SetInstructions("Run on the server.").SetExecutionTarget("api").
		SaveX(ctx)
	return d.Client, u, task
}

func createUserTask(t *testing.T, client *ent.Client, email, workosID, slug string) (*ent.User, *ent.BackgroundTask) {
	t.Helper()
	ctx := context.Background()
	u := client.User.Create().SetEmail(email).SetWorkosUserID(workosID).SaveX(ctx)
	task := client.BackgroundTask.Create().
		SetUser(u).SetSlug(slug).SetName("API Task").
		SetInstructions("Run on the server.").SetExecutionTarget("api").
		SaveX(ctx)
	return u, task
}

func assertDeadLetterRun(ctx context.Context, t *testing.T, client *ent.Client, run *ent.BackgroundTaskRun, wantCode string, wantRequestedBy backgroundtaskruns.Source, wantPriorityKey int, wantRetryAfterSeconds int) {
	t.Helper()
	if run == nil || run.Status != "failed" || run.TemporalStatus != "DeadLettered" || run.ErrorCode != wantCode {
		t.Fatalf("run = %+v, want failed/DeadLettered/%s", run, wantCode)
	}
	ev := client.BackgroundTaskRunEvent.Query().
		Where(
			backgroundtaskrunevent.EventTypeEQ(backgroundtaskworkflow.EventDeadLettered),
			backgroundtaskrunevent.HasRunWith(backgroundtaskrun.IDEQ(run.ID)),
		).
		OnlyX(ctx)
	var payload map[string]any
	if err := json.Unmarshal([]byte(ev.EventJSON), &payload); err != nil {
		t.Fatalf("dead-letter event json: %v", err)
	}
	if payload["requestedBy"] != string(wantRequestedBy) {
		t.Fatalf("dead-letter requestedBy = %v, want %s", payload["requestedBy"], wantRequestedBy)
	}
	if payload["errorCode"] != wantCode {
		t.Fatalf("dead-letter errorCode = %v, want %s", payload["errorCode"], wantCode)
	}
	gotPriority, ok := payload["priorityKey"].(float64)
	if !ok || int(gotPriority) != wantPriorityKey {
		t.Fatalf("dead-letter priorityKey = %v, want %d", payload["priorityKey"], wantPriorityKey)
	}
	gotRetryAfter, hasRetryAfter := payload["retryAfterSeconds"]
	if wantRetryAfterSeconds == 0 {
		if hasRetryAfter {
			t.Fatalf("dead-letter retryAfterSeconds = %v, want absent", gotRetryAfter)
		}
		return
	}
	got, ok := gotRetryAfter.(float64)
	if !ok || int(got) != wantRetryAfterSeconds {
		t.Fatalf("dead-letter retryAfterSeconds = %v, want %d", gotRetryAfter, wantRetryAfterSeconds)
	}
}

// TestStartCreatesQueuedAPIRunWithInternalContext is the scheduler-shaped call:
// the context carries no user (only the internal flag), yet the run, its
// Temporal ids, and the queued event must all be created.
func TestStartCreatesQueuedAPIRunWithInternalContext(t *testing.T) {
	client, u, task := setup(t)
	ctrl := &fakeController{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())

	ctx := auth.WithInternal(context.Background()) // no user in context, like the scheduler
	run, err := starter.Start(ctx, backgroundtaskruns.Params{
		User:        u,
		Task:        task,
		Trigger:     "cron",
		RunIDPrefix: "sched-cron-",
		Source:      backgroundtaskruns.SourceScheduler,
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if run.Status != "queued" || run.Executor != "api" {
		t.Fatalf("run status=%q executor=%q, want queued/api", run.Status, run.Executor)
	}
	if run.Trigger != "cron" {
		t.Fatalf("run trigger=%q, want cron", run.Trigger)
	}
	if run.TemporalWorkflowID == "" || run.TemporalRunID == "" || run.TemporalStatus != "Started" {
		t.Fatalf("temporal ids not persisted: wf=%q run=%q status=%q", run.TemporalWorkflowID, run.TemporalRunID, run.TemporalStatus)
	}
	if len(ctrl.starts) != 1 || ctrl.starts[0].Trigger != "cron" {
		t.Fatalf("expected one cron start, got %+v", ctrl.starts)
	}

	// The queued event must exist and record the scheduler as the requester —
	// the proof that runs are distinguishable in the event log.
	ev := client.BackgroundTaskRunEvent.Query().
		Where(backgroundtaskrunevent.EventTypeEQ(backgroundtaskworkflow.EventQueued)).
		FirstX(ctx)
	var payload map[string]any
	if err := json.Unmarshal([]byte(ev.EventJSON), &payload); err != nil {
		t.Fatalf("event json: %v", err)
	}
	if payload["requestedBy"] != "scheduler" || payload["trigger"] != "cron" {
		t.Fatalf("queued event payload = %+v, want requestedBy=scheduler trigger=cron", payload)
	}
}

func TestStartPropagatesTemporalPriority(t *testing.T) {
	cases := []struct {
		name        string
		trigger     string
		source      backgroundtaskruns.Source
		prefix      string
		want        int
		configure   func(*backgroundtaskruns.Params)
		eventType   string
		eventRunKey string
	}{
		{name: "manual http high", trigger: "manual", source: backgroundtaskruns.SourceHTTP, prefix: "api-trigger-", want: backgroundtaskworkflow.PriorityHigh, eventType: backgroundtaskworkflow.EventQueued},
		{
			name: "retry http high", trigger: "retry", source: backgroundtaskruns.SourceHTTP, prefix: "retry-", want: backgroundtaskworkflow.PriorityHigh, eventType: backgroundtaskworkflow.EventRetryRequested,
			configure: func(p *backgroundtaskruns.Params) {
				attempt := 2
				p.PreviousRunID = "api-trigger-prev"
				p.RetryOfRunID = "api-trigger-prev"
				p.Attempt = &attempt
			},
		},
		{name: "event default", trigger: "event", source: backgroundtaskruns.SourceEvent, prefix: "event-", want: backgroundtaskworkflow.PriorityDefault, eventType: backgroundtaskworkflow.EventQueued},
		{name: "scheduler cron low", trigger: "cron", source: backgroundtaskruns.SourceScheduler, prefix: "sched-cron-", want: backgroundtaskworkflow.PriorityLow, eventType: backgroundtaskworkflow.EventQueued},
		{name: "scheduler window low", trigger: "window", source: backgroundtaskruns.SourceScheduler, prefix: "sched-window-", want: backgroundtaskworkflow.PriorityLow, eventType: backgroundtaskworkflow.EventQueued},
		{name: "temporal schedule cron low", trigger: "cron", source: backgroundtaskruns.SourceTemporalSchedule, prefix: "sched-temporal-", want: backgroundtaskworkflow.PriorityLow, eventType: backgroundtaskworkflow.EventQueued},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client, u, task := setup(t)
			ctrl := &fakeController{}
			starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())
			params := backgroundtaskruns.Params{
				User: u, Task: task, Trigger: tc.trigger, RunIDPrefix: tc.prefix, Source: tc.source,
			}
			if tc.configure != nil {
				tc.configure(&params)
			}
			if _, err := starter.Start(auth.WithInternal(context.Background()), params); err != nil {
				t.Fatalf("Start: %v", err)
			}
			if len(ctrl.starts) != 1 {
				t.Fatalf("starts = %+v", ctrl.starts)
			}
			if ctrl.starts[0].PriorityKey != tc.want {
				t.Fatalf("priority = %d, want %d", ctrl.starts[0].PriorityKey, tc.want)
			}

			ev := client.BackgroundTaskRunEvent.Query().
				Where(backgroundtaskrunevent.EventTypeEQ(tc.eventType)).
				OnlyX(auth.WithInternal(context.Background()))
			var payload map[string]any
			if err := json.Unmarshal([]byte(ev.EventJSON), &payload); err != nil {
				t.Fatalf("event json: %v", err)
			}
			gotPriority, ok := payload["priorityKey"].(float64)
			if !ok || int(gotPriority) != tc.want {
				t.Fatalf("event priorityKey = %v, want %d", payload["priorityKey"], tc.want)
			}
		})
	}
}

func TestPriorityForCoversFallbackSources(t *testing.T) {
	cases := []struct {
		name    string
		trigger string
		source  backgroundtaskruns.Source
		want    int
	}{
		{name: "unknown http defaults", trigger: "custom", source: backgroundtaskruns.SourceHTTP, want: backgroundtaskworkflow.PriorityDefault},
		{name: "unknown scheduler stays low", trigger: "custom", source: backgroundtaskruns.SourceScheduler, want: backgroundtaskworkflow.PriorityLow},
		{name: "unknown temporal schedule stays low", trigger: "custom", source: backgroundtaskruns.SourceTemporalSchedule, want: backgroundtaskworkflow.PriorityLow},
		{name: "empty source defaults", trigger: "custom", source: "", want: backgroundtaskworkflow.PriorityDefault},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := backgroundtaskruns.PriorityFor(tc.trigger, tc.source); got != tc.want {
				t.Fatalf("PriorityFor(%q, %q) = %d, want %d", tc.trigger, tc.source, got, tc.want)
			}
		})
	}
}

func TestStartAdmissionBackpressureDeadLettersBeforeTemporal(t *testing.T) {
	cases := []struct {
		name      string
		admission backgroundtaskruns.AdmissionConfig
		seed      func(t *testing.T, client *ent.Client, u *ent.User, task *ent.BackgroundTask)
		wantMsg   string
	}{
		{
			name:      "per user",
			admission: backgroundtaskruns.AdmissionConfig{Enabled: true, MaxInflightPerUser: 1},
			seed: func(t *testing.T, client *ent.Client, u *ent.User, task *ent.BackgroundTask) {
				t.Helper()
				client.BackgroundTaskRun.Create().
					SetUser(u).SetTask(task).SetRunID("existing-user").
					SetTrigger("manual").SetStatus("queued").SetExecutor("api").
					SaveX(auth.WithInternal(context.Background()))
			},
			wantMsg: "per-user capacity",
		},
		{
			name:      "global",
			admission: backgroundtaskruns.AdmissionConfig{Enabled: true, MaxInflightGlobal: 1},
			seed: func(t *testing.T, client *ent.Client, _ *ent.User, _ *ent.BackgroundTask) {
				t.Helper()
				other, otherTask := createUserTask(t, client, "b@x.co", "user_2", "other-api-task")
				client.BackgroundTaskRun.Create().
					SetUser(other).SetTask(otherTask).SetRunID("existing-global").
					SetTrigger("manual").SetStatus("running").SetExecutor("api").
					SaveX(auth.WithInternal(context.Background()))
			},
			wantMsg: "global capacity",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client, u, task := setup(t)
			ctx := auth.WithInternal(context.Background())
			tc.seed(t, client, u, task)
			ctrl := &fakeController{}
			starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())
			starter.SetAdmission(tc.admission)

			run, err := starter.Start(ctx, backgroundtaskruns.Params{
				User: u, Task: task, Trigger: "manual", RunIDPrefix: "api-trigger-", Source: backgroundtaskruns.SourceHTTP,
			})
			var rejected *backgroundtaskruns.AdmissionRejectedError
			if !errors.As(err, &rejected) {
				t.Fatalf("want AdmissionRejectedError, got %v", err)
			}
			if rejected.Code != backgroundtaskworkflow.ErrCodeAdmissionBackpressure || !strings.Contains(rejected.Message, tc.wantMsg) {
				t.Fatalf("rejection = code %q message %q", rejected.Code, rejected.Message)
			}
			assertDeadLetterRun(ctx, t, client, run, backgroundtaskworkflow.ErrCodeAdmissionBackpressure, backgroundtaskruns.SourceHTTP, backgroundtaskworkflow.PriorityHigh, 0)
			if len(ctrl.starts) != 0 {
				t.Fatalf("backpressure must not start Temporal, got %+v", ctrl.starts)
			}
		})
	}
}

func TestStartAdmissionRateLimitDeadLettersBeforeTemporal(t *testing.T) {
	cases := []struct {
		name      string
		admission backgroundtaskruns.AdmissionConfig
		seed      func(t *testing.T, client *ent.Client, u *ent.User, task *ent.BackgroundTask)
		wantMsg   string
	}{
		{
			name:      "per user",
			admission: backgroundtaskruns.AdmissionConfig{Enabled: true, MaxStartsPerWindowPerUser: 1, StartRateWindow: time.Minute},
			seed: func(t *testing.T, client *ent.Client, u *ent.User, task *ent.BackgroundTask) {
				t.Helper()
				client.BackgroundTaskRun.Create().
					SetUser(u).SetTask(task).SetRunID("recent-user").
					SetTrigger("manual").SetStatus("failed").SetExecutor("api").
					SaveX(auth.WithInternal(context.Background()))
			},
			wantMsg: "this user",
		},
		{
			name:      "global",
			admission: backgroundtaskruns.AdmissionConfig{Enabled: true, MaxStartsPerWindowGlobal: 1, StartRateWindow: time.Minute},
			seed: func(t *testing.T, client *ent.Client, _ *ent.User, _ *ent.BackgroundTask) {
				t.Helper()
				other, otherTask := createUserTask(t, client, "b@x.co", "user_2", "other-api-task")
				client.BackgroundTaskRun.Create().
					SetUser(other).SetTask(otherTask).SetRunID("recent-global").
					SetTrigger("manual").SetStatus("failed").SetExecutor("api").
					SaveX(auth.WithInternal(context.Background()))
			},
			wantMsg: "globally",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client, u, task := setup(t)
			ctx := auth.WithInternal(context.Background())
			tc.seed(t, client, u, task)
			ctrl := &fakeController{}
			starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())
			starter.SetAdmission(tc.admission)

			run, err := starter.Start(ctx, backgroundtaskruns.Params{
				User: u, Task: task, Trigger: "manual", RunIDPrefix: "api-trigger-", Source: backgroundtaskruns.SourceHTTP,
			})
			var rejected *backgroundtaskruns.AdmissionRejectedError
			if !errors.As(err, &rejected) {
				t.Fatalf("want AdmissionRejectedError, got %v", err)
			}
			if rejected.Code != backgroundtaskworkflow.ErrCodeAdmissionRateLimited || !strings.Contains(rejected.Message, tc.wantMsg) {
				t.Fatalf("rejection = code %q message %q", rejected.Code, rejected.Message)
			}
			assertDeadLetterRun(ctx, t, client, run, backgroundtaskworkflow.ErrCodeAdmissionRateLimited, backgroundtaskruns.SourceHTTP, backgroundtaskworkflow.PriorityHigh, 60)
			if len(ctrl.starts) != 0 {
				t.Fatalf("rate-limited run must not start Temporal, got %+v", ctrl.starts)
			}
			if got := client.BackgroundTaskRun.Query().Where(backgroundtaskrun.StatusEQ("failed")).CountX(ctx); got != 2 {
				t.Fatalf("failed run count = %d, want existing+dead-letter", got)
			}
		})
	}
}

func TestStartAdmissionRateLimitIgnoresStartsOutsideWindow(t *testing.T) {
	client, u, task := setup(t)
	ctx := auth.WithInternal(context.Background())
	client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(task).SetRunID("old").
		SetTrigger("manual").SetStatus("failed").SetExecutor("api").
		SetCreatedAt(time.Now().UTC().Add(-2 * time.Hour)).
		SaveX(ctx)

	ctrl := &fakeController{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())
	starter.SetAdmission(backgroundtaskruns.AdmissionConfig{Enabled: true, MaxStartsPerWindowPerUser: 1, StartRateWindow: time.Minute})

	run, err := starter.Start(ctx, backgroundtaskruns.Params{
		User: u, Task: task, Trigger: "manual", RunIDPrefix: "api-trigger-", Source: backgroundtaskruns.SourceHTTP,
	})
	if err != nil {
		t.Fatalf("old start outside window must not rate-limit: %v", err)
	}
	if run.Status != "queued" || len(ctrl.starts) != 1 {
		t.Fatalf("run status=%q starts=%d, want admitted with one Temporal start", run.Status, len(ctrl.starts))
	}
}

// TestStartFailureMarksRunFailed mirrors the HTTP handler's start-failure path:
// the run is marked failed with the temporal_start_failed code and the task's
// cycle anchor (last_run_at) is left unset.
func TestStartFailureMarksRunFailed(t *testing.T) {
	client, u, task := setup(t)
	ctrl := &fakeController{startErr: errors.New("temporal unreachable")}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())

	run, err := starter.Start(context.Background(), backgroundtaskruns.Params{
		User: u, Task: task, Trigger: "manual", RunIDPrefix: "api-trigger-",
	})
	var startFailed *backgroundtaskruns.StartFailedError
	if !errors.As(err, &startFailed) {
		t.Fatalf("want *StartFailedError, got %v", err)
	}
	if run == nil || run.Status != "failed" || run.ErrorCode != backgroundtaskworkflow.ErrCodeTemporalStartFailed {
		t.Fatalf("run = %+v, want failed/%s", run, backgroundtaskworkflow.ErrCodeTemporalStartFailed)
	}

	reloaded := client.BackgroundTask.GetX(auth.WithInternal(context.Background()), task.ID)
	if reloaded.LastRunAt != nil {
		t.Fatalf("task last_run_at should stay nil after start failure, got %v", reloaded.LastRunAt)
	}
}

// TestStartRetryFailureUsesRetryMessage: a retry whose Temporal start fails
// records the retry-specific progress message, distinct from a first-attempt
// failure, so the two are distinguishable in viewRun.
func TestStartRetryFailureUsesRetryMessage(t *testing.T) {
	client, u, task := setup(t)
	ctrl := &fakeController{startErr: errors.New("temporal unreachable")}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())
	attempt := 2

	run, _ := starter.Start(auth.WithInternal(context.Background()), backgroundtaskruns.Params{
		User: u, Task: task, Trigger: "retry", RunIDPrefix: "retry-",
		QueuedMessage: "Queued retry for API worker.", RetryOfRunID: "prev", PreviousRunID: "prev", Attempt: &attempt,
	})
	if run == nil || run.ProgressMessage != "Temporal retry start failed." {
		t.Fatalf("retry start failure message = %q, want 'Temporal retry start failed.'", run.ProgressMessage)
	}
}

// TestStartWithoutTemporalReturnsSentinel covers the 503 mapping precondition.
func TestStartWithoutTemporalReturnsSentinel(t *testing.T) {
	client, u, task := setup(t)
	starter := backgroundtaskruns.New(client, nil, zap.NewNop())
	if _, err := starter.Start(context.Background(), backgroundtaskruns.Params{User: u, Task: task, Trigger: "manual"}); !errors.Is(err, backgroundtaskruns.ErrTemporalNotConfigured) {
		t.Fatalf("want ErrTemporalNotConfigured, got %v", err)
	}
}

// TestStartRetryLineageAndEvent covers the retry path: lineage fields, attempt,
// the retry trigger, and the retry_requested event (not the queued event).
func TestStartRetryLineageAndEvent(t *testing.T) {
	client, u, task := setup(t)
	ctrl := &fakeController{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())
	ctx := auth.WithInternal(context.Background())

	attempt := 2
	run, err := starter.Start(ctx, backgroundtaskruns.Params{
		User:          u,
		Task:          task,
		Trigger:       "retry",
		RunIDPrefix:   "retry-",
		QueuedMessage: "Queued retry for API worker.",
		PreviousRunID: "api-trigger-prev",
		RetryOfRunID:  "api-trigger-prev",
		Attempt:       &attempt,
	})
	if err != nil {
		t.Fatalf("Start retry: %v", err)
	}
	if run.Trigger != "retry" || run.Attempt != 2 || run.RetryOfRunID != "api-trigger-prev" || run.PreviousRunID != "api-trigger-prev" {
		t.Fatalf("retry lineage wrong: trigger=%q attempt=%d retryOf=%q prev=%q", run.Trigger, run.Attempt, run.RetryOfRunID, run.PreviousRunID)
	}
	if !strings.HasPrefix(run.RunID, "retry-") {
		t.Fatalf("retry run id %q missing retry- prefix", run.RunID)
	}
	if run.ProgressMessage != "Queued retry for API worker." {
		t.Fatalf("retry progress message = %q", run.ProgressMessage)
	}

	ev := client.BackgroundTaskRunEvent.Query().
		Where(backgroundtaskrunevent.EventTypeEQ(backgroundtaskworkflow.EventRetryRequested)).
		OnlyX(ctx)
	var payload map[string]any
	if err := json.Unmarshal([]byte(ev.EventJSON), &payload); err != nil {
		t.Fatalf("event json: %v", err)
	}
	if payload["retryOfRunId"] != "api-trigger-prev" {
		t.Fatalf("retry event = %+v, want retryOfRunId set", payload)
	}
	if n := client.BackgroundTaskRunEvent.Query().Where(backgroundtaskrunevent.EventTypeEQ(backgroundtaskworkflow.EventQueued)).CountX(ctx); n != 0 {
		t.Fatalf("retry should not emit a queued event, found %d", n)
	}
}

// TestStartDefaults: empty Source defaults to http, empty QueuedMessage to the
// canonical string, empty Trigger to manual.
func TestStartDefaults(t *testing.T) {
	client, u, task := setup(t)
	starter := backgroundtaskruns.New(client, &fakeController{}, zap.NewNop())
	ctx := auth.WithInternal(context.Background())

	run, err := starter.Start(ctx, backgroundtaskruns.Params{User: u, Task: task, RunIDPrefix: "api-trigger-"})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if run.Trigger != "manual" {
		t.Fatalf("default trigger = %q, want manual", run.Trigger)
	}
	if run.ProgressMessage != "Queued for API worker." {
		t.Fatalf("default progress message = %q", run.ProgressMessage)
	}
	ev := client.BackgroundTaskRunEvent.Query().Where(backgroundtaskrunevent.EventTypeEQ(backgroundtaskworkflow.EventQueued)).OnlyX(ctx)
	var payload map[string]any
	_ = json.Unmarshal([]byte(ev.EventJSON), &payload)
	if payload["requestedBy"] != "http" {
		t.Fatalf("default requestedBy = %v, want http", payload["requestedBy"])
	}
}

// TestStartWorkflowIDShape asserts the precomputed workflow id matches the
// shared WorkflowID format so viewRun shows it immediately.
func TestStartWorkflowIDShape(t *testing.T) {
	client, u, task := setup(t)
	ctrl := &fakeController{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())

	run, err := starter.Start(auth.WithInternal(context.Background()), backgroundtaskruns.Params{
		User: u, Task: task, Trigger: "cron", RunIDPrefix: "sched-cron-", Source: backgroundtaskruns.SourceScheduler,
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	want := backgroundtaskworkflow.WorkflowID(u.ID.String(), task.Slug, run.RunID)
	if run.TemporalWorkflowID != want {
		t.Fatalf("workflow id = %q, want %q", run.TemporalWorkflowID, want)
	}
	if len(ctrl.starts) != 1 || ctrl.starts[0].RunID != run.RunID || ctrl.starts[0].Trigger != "cron" {
		t.Fatalf("start input = %+v", ctrl.starts)
	}
}

func TestStartInvalidTrigger(t *testing.T) {
	client, u, task := setup(t)
	starter := backgroundtaskruns.New(client, &fakeController{}, zap.NewNop())
	_, err := starter.Start(auth.WithInternal(context.Background()), backgroundtaskruns.Params{User: u, Task: task, Trigger: "bogus"})
	var invalid *backgroundtaskruns.InvalidParamsError
	if !errors.As(err, &invalid) {
		t.Fatalf("want InvalidParamsError, got %v", err)
	}
}

func TestStartInvalidAttempt(t *testing.T) {
	client, u, task := setup(t)
	starter := backgroundtaskruns.New(client, &fakeController{}, zap.NewNop())
	zero := 0
	_, err := starter.Start(auth.WithInternal(context.Background()), backgroundtaskruns.Params{
		User: u, Task: task, Trigger: "retry", RetryOfRunID: "x", Attempt: &zero,
	})
	var invalid *backgroundtaskruns.InvalidParamsError
	if !errors.As(err, &invalid) {
		t.Fatalf("want InvalidParamsError for attempt < 1, got %v", err)
	}
}

func TestStartMissingUserOrTask(t *testing.T) {
	client, u, task := setup(t)
	starter := backgroundtaskruns.New(client, &fakeController{}, zap.NewNop())
	if _, err := starter.Start(context.Background(), backgroundtaskruns.Params{Task: task}); err == nil {
		t.Fatalf("want error for missing user")
	}
	if _, err := starter.Start(context.Background(), backgroundtaskruns.Params{User: u}); err == nil {
		t.Fatalf("want error for missing task")
	}
}

// TestStartTriggeredMetricIncrements asserts the shared cloud_runs_triggered
// counter advances, the same series the scheduler reconciles against.
func TestStartTriggeredMetricIncrements(t *testing.T) {
	client, u, task := setup(t)
	starter := backgroundtaskruns.New(client, &fakeController{}, zap.NewNop())
	before := testutil.ToFloat64(backgroundtaskmetrics.Triggered.WithLabelValues("window"))
	if _, err := starter.Start(auth.WithInternal(context.Background()), backgroundtaskruns.Params{
		User: u, Task: task, Trigger: "window", RunIDPrefix: "sched-window-", Source: backgroundtaskruns.SourceScheduler,
	}); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if got := testutil.ToFloat64(backgroundtaskmetrics.Triggered.WithLabelValues("window")) - before; got != 1 {
		t.Fatalf("cloud_runs_triggered{window} delta = %v, want 1", got)
	}
}
