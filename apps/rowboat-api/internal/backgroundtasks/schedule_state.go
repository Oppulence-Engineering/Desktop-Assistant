package backgroundtasks

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskschedulestate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundscheduler"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/adhocore/gronx"
	"go.uber.org/zap"
)

// scheduleStateView is the RFC 006 normalized schedule summary the desktop
// renders: which mechanism owns each trigger source, its health, and the next
// expected fire. It composes the task's triggers, the RFC 002 schedule-state
// rows (loop evaluation/fire timestamps), and — for Temporal-owned crons —
// the RFC 005 sync state plus a live Describe for the next action time.
type scheduleStateView struct {
	Target            string                        `json:"target"`
	TriggerSources    []string                      `json:"triggerSources"`
	Health            string                        `json:"health"`
	Mechanism         string                        `json:"mechanism"`
	NextDueAt         *string                       `json:"nextDueAt"`
	LastEvaluatedAt   *string                       `json:"lastEvaluatedAt"`
	LastTriggeredAt   *string                       `json:"lastTriggeredAt"`
	ScheduleSyncState string                        `json:"scheduleSyncState,omitempty"`
	Sources           map[string]scheduleSourceView `json:"sources,omitempty"`
}

type scheduleSourceView struct {
	Mechanism       string  `json:"mechanism"`
	Health          string  `json:"health"`
	NextDueAt       *string `json:"nextDueAt"`
	LastEvaluatedAt *string `json:"lastEvaluatedAt"`
	LastTriggeredAt *string `json:"lastTriggeredAt"`
}

// GetScheduleState handles GET /v1/background-tasks/{slug}/schedule-state.
// It is a read-only composition — no Temporal mutations — and is meant for
// on-demand/detail-view cadence, not per-row polling (the list view uses the
// persisted scheduleSyncState already on the task).
func (h *Handler) GetScheduleState(w http.ResponseWriter, r *http.Request) {
	task, ok := h.lookupTask(w, r)
	if !ok {
		return
	}
	if _, uok := auth.UserFromCtx(r.Context()); !uok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, h.composeScheduleState(r.Context(), task))
}

func (h *Handler) composeScheduleState(ctx context.Context, task *ent.BackgroundTask) scheduleStateView {
	now := time.Now().UTC()
	tr, _ := backgroundscheduler.ParseTriggers(task.TriggersJSON)
	hasCron := tr.HasCron()
	hasWindows := len(tr.Windows) > 0
	hasEvent := triggersHaveEventCriteria(task.TriggersJSON)

	view := scheduleStateView{
		Target:         task.ExecutionTarget,
		TriggerSources: []string{},
		Health:         "current",
		Mechanism:      "none",
		Sources:        map[string]scheduleSourceView{},
	}
	if hasCron {
		view.TriggerSources = append(view.TriggerSources, "cron")
	}
	if hasWindows {
		view.TriggerSources = append(view.TriggerSources, "window")
	}
	if hasEvent {
		view.TriggerSources = append(view.TriggerSources, "event")
	}

	// Desktop-target tasks: the desktop's own loop owns timed evaluation; the
	// server has no schedule state to report beyond the labeling.
	if task.ExecutionTarget != "api" {
		if hasCron || hasWindows {
			view.Mechanism = "desktop_loop"
			if !task.Active {
				view.Health = "paused"
			}
		}
		if len(view.Sources) == 0 {
			view.Sources = nil
		}
		return view
	}

	// Loop bookkeeping (RFC 002): newest evaluation/fire timestamps per
	// trigger type for this task.
	lastEval, lastTrig := h.scheduleStateTimes(ctx, task)
	view.LastEvaluatedAt = newestTime(lastEval["cron"], lastEval["window"])
	view.LastTriggeredAt = newestTime(lastTrig["cron"], lastTrig["window"])

	if hasCron {
		view.Sources["cron"] = h.cronSourceView(ctx, task, tr, now, lastEval["cron"], lastTrig["cron"])
		view.ScheduleSyncState = task.ScheduleSyncState
	}
	if hasWindows {
		health := "current"
		if !task.Active {
			health = "paused"
		}
		view.Sources["window"] = scheduleSourceView{
			Mechanism:       "rowboat_loop",
			Health:          health,
			NextDueAt:       formatTimePtr(backgroundscheduler.NextWindowStart(tr, task.LastRunAt, now)),
			LastEvaluatedAt: formatTimePtr(lastEval["window"]),
			LastTriggeredAt: formatTimePtr(lastTrig["window"]),
		}
	}
	if hasEvent {
		health := "current"
		if !task.Active {
			health = "paused"
		}
		// Events are routed, not scheduled — no mechanism and no next-due.
		view.Sources["event"] = scheduleSourceView{Mechanism: "none", Health: health, NextDueAt: nil}
	}

	// Aggregate: worst health wins; the cron mechanism (if any) names the
	// task's primary mechanism; next due is the soonest across sources.
	view.Health = aggregateHealth(view.Sources, task.Active)
	view.Mechanism = aggregateMechanism(view.Sources, hasCron, hasWindows)
	view.NextDueAt = soonest(view.Sources)
	if len(view.Sources) == 0 {
		view.Sources = nil
	}
	return view
}

// cronSourceView resolves who owns the cron and when it next fires. A
// Temporal-owned cron (sync state "current" with schedules wired) gets a live
// Describe for the authoritative next action time; every other state reports
// the loop's own gronx-derived next tick, since the loop is the fallback.
func (h *Handler) cronSourceView(ctx context.Context, task *ent.BackgroundTask, tr backgroundscheduler.Triggers, now time.Time, lastEval, lastTrig *time.Time) scheduleSourceView {
	src := scheduleSourceView{
		Mechanism:       "rowboat_loop",
		Health:          "current",
		LastEvaluatedAt: formatTimePtr(lastEval),
		LastTriggeredAt: formatTimePtr(lastTrig),
	}
	switch {
	case !task.Active:
		src.Health = "paused"
		return src
	case !tr.HasValidCron():
		src.Health = "failed"
		return src
	}

	if h.schedules != nil && task.ScheduleSyncState == "current" {
		src.Mechanism = "temporal_schedule"
		if u, ok := auth.UserFromCtx(ctx); ok {
			dctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			desc, err := h.schedules.Manager.DescribeTaskCron(dctx, u.ID.String(), task.Slug)
			cancel()
			switch {
			case err != nil:
				h.log.Warn("schedule-state describe failed",
					zap.String("taskSlug", task.Slug), zap.Error(err))
				src.Health = "unknown"
			case !desc.Exists || desc.Paused:
				// The reconciler will repair; report honestly meanwhile.
				src.Health = "unknown"
			case len(desc.NextActionTimes) > 0:
				src.NextDueAt = formatTimePtr(&desc.NextActionTimes[0])
			}
		}
		return src
	}

	switch task.ScheduleSyncState {
	case "failed":
		src.Health = "failed"
	case "syncing":
		src.Health = "syncing"
	}
	// Loop-owned (or fallback): predict the next minute-aligned tick.
	if next, err := nextLoopCronTick(tr.CronExpr, now); err == nil {
		src.NextDueAt = formatTimePtr(&next)
	}
	return src
}

func nextLoopCronTick(expr string, now time.Time) (time.Time, error) {
	ref := now.Truncate(time.Minute).Add(time.Minute)
	return gronx.NextTickAfter(expr, ref, true)
}

// scheduleStateTimes returns the newest last_evaluated_at / last_triggered_at
// per trigger type from the RFC 002 schedule-state rows.
func (h *Handler) scheduleStateTimes(ctx context.Context, task *ent.BackgroundTask) (lastEval, lastTrig map[string]*time.Time) {
	lastEval = map[string]*time.Time{}
	lastTrig = map[string]*time.Time{}
	rows, err := h.client.BackgroundTaskScheduleState.Query().
		Where(backgroundtaskschedulestate.HasTaskWith(backgroundtask.IDEQ(task.ID))).
		All(ctx)
	if err != nil {
		h.log.Warn("schedule-state rows query failed", zap.String("taskSlug", task.Slug), zap.Error(err))
		return lastEval, lastTrig
	}
	for _, row := range rows {
		if row.LastEvaluatedAt != nil {
			if cur := lastEval[row.TriggerType]; cur == nil || row.LastEvaluatedAt.After(*cur) {
				lastEval[row.TriggerType] = row.LastEvaluatedAt
			}
		}
		if row.LastTriggeredAt != nil {
			if cur := lastTrig[row.TriggerType]; cur == nil || row.LastTriggeredAt.After(*cur) {
				lastTrig[row.TriggerType] = row.LastTriggeredAt
			}
		}
	}
	return lastEval, lastTrig
}

// triggersHaveEventCriteria probes the raw triggers JSON for an
// eventMatchCriteria sub-trigger (the scheduler's Triggers parser only models
// the timed sub-triggers it owns).
func triggersHaveEventCriteria(triggersJSON string) bool {
	if triggersJSON == "" {
		return false
	}
	var t struct {
		EventMatchCriteria json.RawMessage `json:"eventMatchCriteria"`
	}
	if err := json.Unmarshal([]byte(triggersJSON), &t); err != nil {
		return false
	}
	return len(t.EventMatchCriteria) > 0 && string(t.EventMatchCriteria) != "null"
}

func aggregateHealth(sources map[string]scheduleSourceView, active bool) string {
	if len(sources) == 0 {
		return "current" // manual-only: nothing to be unhealthy about
	}
	rank := map[string]int{"failed": 4, "unknown": 3, "syncing": 2, "paused": 1, "current": 0}
	worst := "current"
	allPaused := true
	for _, s := range sources {
		if rank[s.Health] > rank[worst] && s.Health != "paused" {
			worst = s.Health
		}
		if s.Health != "paused" {
			allPaused = false
		}
	}
	if allPaused && !active {
		return "paused"
	}
	return worst
}

func aggregateMechanism(sources map[string]scheduleSourceView, hasCron, hasWindows bool) string {
	if cron, ok := sources["cron"]; ok && hasCron {
		return cron.Mechanism
	}
	if hasWindows {
		return "rowboat_loop"
	}
	return "none"
}

func soonest(sources map[string]scheduleSourceView) *string {
	var best *string
	for _, s := range sources {
		if s.NextDueAt == nil {
			continue
		}
		if best == nil || *s.NextDueAt < *best {
			best = s.NextDueAt
		}
	}
	return best
}

func newestTime(a, b *time.Time) *string {
	switch {
	case a == nil:
		return formatTimePtr(b)
	case b == nil || a.After(*b):
		return formatTimePtr(a)
	default:
		return formatTimePtr(b)
	}
}

func formatTimePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}
