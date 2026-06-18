package agentworkflow

import (
	"context"
	"fmt"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
	"go.uber.org/zap"
)

// RFC 027 P5: Temporal Schedules start agent sessions on cron, reusing the
// RFC 005 action pattern. A Schedule cannot start the session workflow directly
// (a session needs its AgentSession projection row created first), so the
// Schedule action starts this thin scheduler workflow, whose single activity
// routes through the canonical session starter (row first, workflow second).
const (
	// ScheduledSessionWorkflowName is the Schedule action target.
	ScheduledSessionWorkflowName = "rowboat.agent.scheduled_session.v1"
	// ActivityCreateScheduledSession creates+starts a session via the starter.
	ActivityCreateScheduledSession = "rowboat.agent.create_scheduled_session.v1"
)

// ScheduledSessionInput is the Schedule action argument delivered on every fire.
type ScheduledSessionInput struct {
	UserID    string `json:"userId"`
	AgentSlug string `json:"agentSlug"`
	Input     string `json:"input"`
	Channel   string `json:"channel"`
}

// ScheduledSessionStarter starts a session for a schedule fire. Implemented by
// *agentsessions.Starter (that package imports this one, so it is expressed here
// as a narrow interface to avoid an import cycle).
type ScheduledSessionStarter interface {
	StartScheduledSession(ctx context.Context, in ScheduledSessionInput) (sessionID string, err error)
}

// ScheduleActivities hosts the scheduled-session activity.
type ScheduleActivities struct {
	Starter ScheduledSessionStarter
	Enabled bool // mirrors the agent-runtime gate; disabled fires skip
	Log     *zap.Logger
}

// CreateScheduledSession creates the session row and starts its workflow through
// the canonical starter. Errors propagate so Temporal's retry policy applies.
func (a *ScheduleActivities) CreateScheduledSession(ctx context.Context, in ScheduledSessionInput) (string, error) {
	if !a.Enabled || a.Starter == nil {
		if a.Log != nil {
			a.Log.Info("scheduled session fire skipped: agent runtime disabled", zap.String("agent", in.AgentSlug), zap.String("userId", in.UserID))
		}
		return "", nil
	}
	sid, err := a.Starter.StartScheduledSession(ctx, in)
	if err != nil && a.Log != nil {
		a.Log.Warn("scheduled session start failed", zap.String("agent", in.AgentSlug), zap.String("userId", in.UserID), zap.Error(err))
	}
	return sid, err
}

// ScheduledSessionWorkflow is the thin Schedule action: one activity, no children.
func ScheduledSessionWorkflow(ctx workflow.Context, in ScheduledSessionInput) error {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval: 15 * time.Second, BackoffCoefficient: 2, MaximumInterval: 2 * time.Minute, MaximumAttempts: 5,
		},
	})
	var sid string
	return workflow.ExecuteActivity(ctx, ActivityCreateScheduledSession, in).Get(ctx, &sid)
}

// RegisterScheduler installs the scheduled-session workflow + activity. Mirrors
// Register; tests re-register by these names.
func RegisterScheduler(w worker.Worker, a *ScheduleActivities) {
	w.RegisterWorkflowWithOptions(ScheduledSessionWorkflow, workflow.RegisterOptions{Name: ScheduledSessionWorkflowName})
	w.RegisterActivityWithOptions(a.CreateScheduledSession, activity.RegisterOptions{Name: ActivityCreateScheduledSession})
}

// SessionScheduleID is the Temporal Schedule id for an agent's recurring session.
func SessionScheduleID(userID, slug string) string {
	return fmt.Sprintf("agent-session-schedule/%s/%s", userID, slug)
}

// ScheduleSessionWorkflowID is the base id for scheduler-workflow executions
// (Temporal appends a per-fire suffix).
func ScheduleSessionWorkflowID(userID, slug string) string {
	return fmt.Sprintf("agent-session-scheduler/%s/%s", userID, slug)
}

// ScheduleSpec describes a recurring agent session.
type ScheduleSpec struct {
	UserID    string
	AgentSlug string
	Input     string
	Channel   string
	Cron      string
	Timezone  string // IANA; empty → UTC
}

// SessionScheduler creates/removes the Temporal Schedules that start sessions.
type SessionScheduler struct {
	schedules client.ScheduleClient
	taskQueue string
}

// NewSessionScheduler builds the scheduler from a Temporal client.
func NewSessionScheduler(c client.Client, cfg appconfig.Config) *SessionScheduler {
	return &SessionScheduler{schedules: c.ScheduleClient(), taskQueue: cfg.TemporalTaskQueue}
}

// CreateSchedule creates (or no-ops onto) the recurring-session schedule. Each
// fire starts an independent session, so overlap is allowed.
func (s *SessionScheduler) CreateSchedule(ctx context.Context, spec ScheduleSpec) error {
	tz := spec.Timezone
	if tz == "" {
		tz = "UTC"
	}
	channel := spec.Channel
	if channel == "" {
		channel = "schedule"
	}
	_, err := s.schedules.Create(ctx, client.ScheduleOptions{
		ID: SessionScheduleID(spec.UserID, spec.AgentSlug),
		Spec: client.ScheduleSpec{
			CronExpressions: []string{spec.Cron},
			TimeZoneName:    tz,
		},
		Action: &client.ScheduleWorkflowAction{
			ID:        ScheduleSessionWorkflowID(spec.UserID, spec.AgentSlug),
			Workflow:  ScheduledSessionWorkflowName,
			TaskQueue: s.taskQueue,
			Args: []any{ScheduledSessionInput{
				UserID: spec.UserID, AgentSlug: spec.AgentSlug, Input: spec.Input, Channel: channel,
			}},
		},
		Overlap: enums.SCHEDULE_OVERLAP_POLICY_ALLOW_ALL,
	})
	if err != nil && err == temporal.ErrScheduleAlreadyRunning {
		return nil
	}
	return err
}

// DeleteSchedule removes a recurring-session schedule (idempotent).
func (s *SessionScheduler) DeleteSchedule(ctx context.Context, userID, slug string) error {
	return s.schedules.GetHandle(ctx, SessionScheduleID(userID, slug)).Delete(ctx)
}
