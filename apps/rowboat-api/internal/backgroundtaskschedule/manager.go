// Package backgroundtaskschedule owns the Temporal Schedule lifecycle for
// exact-cron api-target tasks (RFC 005). The HTTP handler
// (internal/backgroundtasks) and the scheduler binary's reconciler both drive
// schedules through the Manager interface; the persisted
// background_task.schedule_sync_state summary is written only here (Syncer)
// and by the reconciler, never by user patches.
package backgroundtaskschedule

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskmetrics"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	commonpb "go.temporal.io/api/common/v1"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.uber.org/zap"
)

// schedulePrefix namespaces every Rowboat task schedule in the Temporal
// namespace, so the reconciler's orphan sweep can list exactly ours.
const schedulePrefix = "background-task-schedule/"

// DesiredCronSchedule is the deterministic desired state for one task's cron
// schedule, built by Desired(). The reconciler and handler diff Temporal
// against this.
type DesiredCronSchedule struct {
	UserID, TaskID, Slug string
	CronExpr             string
	Timezone             string
	CatchupWindow        time.Duration
	TaskRevision         int
	Paused               bool
}

// ScheduleID returns the Temporal Schedule id for this desired state.
func (d DesiredCronSchedule) ScheduleID() string {
	return backgroundtaskworkflow.ScheduleID(d.UserID, d.Slug)
}

// Desired builds the desired schedule state for a task. cronExpr comes from
// the caller's trigger parse (the RFC 001 parser owns trigger semantics).
func Desired(userID string, task *ent.BackgroundTask, cronExpr string, cfg appconfig.Config, paused bool) DesiredCronSchedule {
	return DesiredCronSchedule{
		UserID:        userID,
		TaskID:        task.ID.String(),
		Slug:          task.Slug,
		CronExpr:      cronExpr,
		Timezone:      cfg.CloudSchedulerTimezone,
		CatchupWindow: cfg.TemporalScheduleCatchup,
		TaskRevision:  task.Revision,
		Paused:        paused,
	}
}

// MemoFields is the Rowboat metadata stored on every schedule. It is the
// authoritative diff source: Temporal normalizes CronExpressions into calendar
// specs server-side, so the original expression is only recoverable from here.
// Never include task names/instructions — memos may not carry user data.
type MemoFields struct {
	UserID       string `json:"rowboatUserId"`
	TaskID       string `json:"rowboatTaskId"`
	Slug         string `json:"rowboatTaskSlug"`
	TaskRevision int    `json:"rowboatTaskRevision"`
	CronExpr     string `json:"rowboatCronExpr"`
	Timezone     string `json:"rowboatTimezone"`
	Trigger      string `json:"rowboatTrigger"`
}

// SpecMatches reports whether an existing schedule's memo still matches the
// desired functional spec. TaskRevision is deliberately excluded: the sync
// state writes bump the task revision themselves, so exact-revision matching
// would see permanent drift and churn updates forever.
func SpecMatches(memo MemoFields, d DesiredCronSchedule) bool {
	return memo.UserID == d.UserID &&
		memo.TaskID == d.TaskID &&
		memo.Slug == d.Slug &&
		memo.CronExpr == d.CronExpr &&
		memo.Timezone == d.Timezone
}

// Description is the normalized Describe result.
type Description struct {
	Exists          bool
	Paused          bool
	Memo            MemoFields
	NextActionTimes []time.Time
}

// ListedSchedule is one entry from the reconciler's prefix-filtered list.
type ListedSchedule struct {
	ID     string
	Paused bool
	Memo   MemoFields
}

// Manager is the Temporal Schedule lifecycle surface. Implementations must be
// safe for concurrent use; a FakeManager backs handler/reconciler tests.
type Manager interface {
	// UpsertTaskCron converges the schedule to desired and reports what it did:
	// "create", "update", or "noop".
	UpsertTaskCron(ctx context.Context, d DesiredCronSchedule) (action string, err error)
	// PauseTaskCron pauses the schedule; missing schedules are a no-op.
	PauseTaskCron(ctx context.Context, userID, slug string) error
	// DeleteTaskCron deletes the schedule; missing schedules are a no-op.
	DeleteTaskCron(ctx context.Context, userID, slug string) error
	// DescribeTaskCron reports current state; Exists=false when missing.
	DescribeTaskCron(ctx context.Context, userID, slug string) (Description, error)
	// ListTaskSchedules lists every Rowboat task schedule in the namespace.
	ListTaskSchedules(ctx context.Context) ([]ListedSchedule, error)
}

// TemporalManager implements Manager on a real Temporal client.
type TemporalManager struct {
	schedules client.ScheduleClient
	taskQueue string
	log       *zap.Logger
}

// NewTemporalManager builds the production Manager.
func NewTemporalManager(c client.Client, cfg appconfig.Config, log *zap.Logger) *TemporalManager {
	if log == nil {
		log = zap.NewNop()
	}
	return &TemporalManager{schedules: c.ScheduleClient(), taskQueue: cfg.TemporalTaskQueue, log: log}
}

func (m *TemporalManager) options(d DesiredCronSchedule) client.ScheduleOptions {
	return client.ScheduleOptions{
		ID: d.ScheduleID(),
		Spec: client.ScheduleSpec{
			CronExpressions: []string{d.CronExpr},
			TimeZoneName:    d.Timezone,
			Jitter:          0, // exact cron; no smear
		},
		Action: &client.ScheduleWorkflowAction{
			ID:        backgroundtaskworkflow.ScheduleWorkflowID(d.UserID, d.Slug),
			Workflow:  backgroundtaskworkflow.SchedulerWorkflowName,
			TaskQueue: m.taskQueue,
			Args: []any{backgroundtaskworkflow.ScheduleFireInput{
				UserID: d.UserID, TaskID: d.TaskID, Slug: d.Slug,
				Trigger: "cron", TaskRevision: d.TaskRevision,
			}},
		},
		// SKIP mirrors the desktop's in-flight guard: a new occurrence is
		// skipped while the prior run is still executing — no stacked runs.
		Overlap:       enums.SCHEDULE_OVERLAP_POLICY_SKIP,
		CatchupWindow: d.CatchupWindow,
		Paused:        d.Paused,
		Memo: map[string]any{
			"rowboatUserId":       d.UserID,
			"rowboatTaskId":       d.TaskID,
			"rowboatTaskSlug":     d.Slug,
			"rowboatTaskRevision": d.TaskRevision,
			"rowboatCronExpr":     d.CronExpr,
			"rowboatTimezone":     d.Timezone,
			"rowboatTrigger":      "cron",
		},
	}
}

// UpsertTaskCron converges the live schedule to the desired state. Spec
// changes delete+recreate: ScheduleHandle.Update cannot rewrite the memo, and
// a schedule with a stale memo would mis-diff forever. Rowboat schedules are
// stateless (run history lives in our DB), so recreation loses nothing.
func (m *TemporalManager) UpsertTaskCron(ctx context.Context, d DesiredCronSchedule) (string, error) {
	return m.upsertTaskCron(ctx, d, false)
}

func (m *TemporalManager) upsertTaskCron(ctx context.Context, d DesiredCronSchedule, retried bool) (string, error) {
	handle := m.schedules.GetHandle(ctx, d.ScheduleID())
	desc, err := handle.Describe(ctx)
	if isNotFound(err) {
		_, err := m.schedules.Create(ctx, m.options(d))
		if errors.Is(err, temporal.ErrScheduleAlreadyRunning) && !retried {
			// Lost a describe→create race (handler and reconciler converging
			// the same task concurrently). The schedule exists now — re-enter
			// once to diff against it instead of failing a healthy task,
			// which would mark it "failed" and hand the cron back to the loop
			// while the live schedule also fires it.
			return m.upsertTaskCron(ctx, d, true)
		}
		if err != nil {
			return "", m.fail("upsert", err)
		}
		backgroundtaskmetrics.ScheduleUpserts.WithLabelValues("create").Inc()
		return "create", nil
	}
	if err != nil {
		return "", m.fail("describe", err)
	}

	memo := decodeMemo(desc.Memo)
	paused := desc.Schedule.State != nil && desc.Schedule.State.Paused
	if SpecMatches(memo, d) {
		if paused == d.Paused {
			return "noop", nil
		}
		// Only the paused flag differs — flip it in place.
		if d.Paused {
			err = handle.Pause(ctx, client.SchedulePauseOptions{Note: "task inactive"})
		} else {
			err = handle.Unpause(ctx, client.ScheduleUnpauseOptions{Note: "task active"})
		}
		if err != nil {
			return "", m.fail("upsert", err)
		}
		backgroundtaskmetrics.ScheduleUpserts.WithLabelValues("update").Inc()
		return "update", nil
	}

	if err := handle.Delete(ctx); err != nil && !isNotFound(err) {
		return "", m.fail("upsert", err)
	}
	if _, err := m.schedules.Create(ctx, m.options(d)); err != nil {
		if errors.Is(err, temporal.ErrScheduleAlreadyRunning) && !retried {
			// A concurrent converger recreated it between our delete and
			// create — re-enter once to diff against the winner.
			return m.upsertTaskCron(ctx, d, true)
		}
		return "", m.fail("upsert", err)
	}
	backgroundtaskmetrics.ScheduleUpserts.WithLabelValues("update").Inc()
	return "update", nil
}

// PauseTaskCron pauses without deleting, keeping the schedule for fast unpause.
func (m *TemporalManager) PauseTaskCron(ctx context.Context, userID, slug string) error {
	handle := m.schedules.GetHandle(ctx, backgroundtaskworkflow.ScheduleID(userID, slug))
	if err := handle.Pause(ctx, client.SchedulePauseOptions{Note: "task inactive"}); err != nil && !isNotFound(err) {
		return m.fail("pause", err)
	}
	return nil
}

// DeleteTaskCron removes the schedule entirely.
func (m *TemporalManager) DeleteTaskCron(ctx context.Context, userID, slug string) error {
	handle := m.schedules.GetHandle(ctx, backgroundtaskworkflow.ScheduleID(userID, slug))
	if err := handle.Delete(ctx); err != nil && !isNotFound(err) {
		return m.fail("delete", err)
	}
	backgroundtaskmetrics.ScheduleDeletes.Inc()
	return nil
}

// DescribeTaskCron reports the schedule's current state.
func (m *TemporalManager) DescribeTaskCron(ctx context.Context, userID, slug string) (Description, error) {
	handle := m.schedules.GetHandle(ctx, backgroundtaskworkflow.ScheduleID(userID, slug))
	desc, err := handle.Describe(ctx)
	if isNotFound(err) {
		return Description{}, nil
	}
	if err != nil {
		return Description{}, m.fail("describe", err)
	}
	return Description{
		Exists:          true,
		Paused:          desc.Schedule.State != nil && desc.Schedule.State.Paused,
		Memo:            decodeMemo(desc.Memo),
		NextActionTimes: desc.Info.NextActionTimes,
	}, nil
}

// ListTaskSchedules returns every schedule under the Rowboat prefix. The
// prefix filter is client-side: visibility queries are eventually consistent
// and not uniformly available across server versions.
func (m *TemporalManager) ListTaskSchedules(ctx context.Context) ([]ListedSchedule, error) {
	iter, err := m.schedules.List(ctx, client.ScheduleListOptions{})
	if err != nil {
		return nil, m.fail("list", err)
	}
	var out []ListedSchedule
	for iter.HasNext() {
		entry, err := iter.Next()
		if err != nil {
			return nil, m.fail("list", err)
		}
		if !strings.HasPrefix(entry.ID, schedulePrefix) {
			continue
		}
		out = append(out, ListedSchedule{ID: entry.ID, Paused: entry.Paused, Memo: decodeMemo(entry.Memo)})
	}
	return out, nil
}

func (m *TemporalManager) fail(op string, err error) error {
	backgroundtaskmetrics.ScheduleSyncFailures.WithLabelValues(op).Inc()
	return fmt.Errorf("temporal schedule %s: %w", op, err)
}

func isNotFound(err error) bool {
	var notFound *serviceerror.NotFound
	return errors.As(err, &notFound)
}

// decodeMemo extracts MemoFields from a Temporal memo. Missing or undecodable
// fields stay zero — a schedule with no Rowboat memo diffs as fully stale,
// which is exactly the repair we want.
func decodeMemo(memo *commonpb.Memo) MemoFields {
	var out MemoFields
	if memo == nil {
		return out
	}
	dc := converter.GetDefaultDataConverter()
	decode := func(key string, target any) {
		if p, ok := memo.GetFields()[key]; ok {
			_ = dc.FromPayload(p, target)
		}
	}
	decode("rowboatUserId", &out.UserID)
	decode("rowboatTaskId", &out.TaskID)
	decode("rowboatTaskSlug", &out.Slug)
	decode("rowboatTaskRevision", &out.TaskRevision)
	decode("rowboatCronExpr", &out.CronExpr)
	decode("rowboatTimezone", &out.Timezone)
	decode("rowboatTrigger", &out.Trigger)
	return out
}
