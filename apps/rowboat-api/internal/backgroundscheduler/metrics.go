package backgroundscheduler

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// metrics holds the Prometheus series for the cloud scheduler loop. It follows
// the same leaf-package registry pattern as internal/backgroundtaskmetrics: the
// scheduler process registers these on its default registry and exposes them on
// its own /metrics endpoint.
//
// Cardinality rule (same as backgroundtaskmetrics): only low-cardinality labels
// — `trigger` (cron|window) and `stage` (query|parse|user_edge|lease|start).
// Never label by taskSlug / userId / runId; those belong in logs and traces.
var metrics = struct {
	Ticks               prometheus.Counter
	TasksScanned        prometheus.Counter
	DueTasks            *prometheus.CounterVec
	RunsTriggered       *prometheus.CounterVec
	DuplicateSuppressed prometheus.Counter
	BackoffSuppressed   prometheus.Counter
	InFlightSuppressed  prometheus.Counter
	CronHandedOff       prometheus.Counter
	OrphansReaped       prometheus.Counter
	Errors              *prometheus.CounterVec
	TickDuration        prometheus.Histogram
}{
	Ticks: promauto.NewCounter(prometheus.CounterOpts{
		Name: "cloud_scheduler_ticks_total",
		Help: "Scheduler loop iterations.",
	}),
	TasksScanned: promauto.NewCounter(prometheus.CounterOpts{
		Name: "cloud_scheduler_tasks_scanned_total",
		Help: "API-target tasks scanned, summed across ticks.",
	}),
	DueTasks: promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_scheduler_due_tasks_total",
		Help: "Tasks whose cron/window cycle matched, by trigger.",
	}, []string{"trigger"}),
	RunsTriggered: promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_scheduler_runs_triggered_total",
		Help: "Runs the scheduler actually started, by trigger. Reconcile against cloud_runs_triggered_total.",
	}, []string{"trigger"}),
	DuplicateSuppressed: promauto.NewCounter(prometheus.CounterOpts{
		Name: "cloud_scheduler_duplicate_suppressed_total",
		Help: "Due cycles skipped because the schedule lease was not acquired (another replica won).",
	}),
	BackoffSuppressed: promauto.NewCounter(prometheus.CounterOpts{
		Name: "cloud_scheduler_backoff_suppressed_total",
		Help: "Due cycles skipped because the task is within its retry backoff window.",
	}),
	InFlightSuppressed: promauto.NewCounter(prometheus.CounterOpts{
		Name: "cloud_scheduler_inflight_suppressed_total",
		Help: "Tasks skipped because a prior attempt is still in flight (last_attempt_at newer than last_run_at within backoff).",
	}),
	CronHandedOff: promauto.NewCounter(prometheus.CounterOpts{
		Name: "cloud_scheduler_cron_handed_off_total",
		Help: "Cron sub-triggers skipped because their Temporal Schedule sync is current (RFC 005).",
	}),
	OrphansReaped: promauto.NewCounter(prometheus.CounterOpts{
		Name: "cloud_scheduler_orphans_reaped_total",
		Help: "Runs failed by the reaper after being abandoned in temporal_status=Starting.",
	}),
	Errors: promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_scheduler_errors_total",
		Help: "Scheduler errors by stage (query|parse|user_edge|lease|start|persist|stamp|reap).",
	}, []string{"stage"}),
	TickDuration: promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "cloud_scheduler_tick_duration_seconds",
		Help:    "Scheduler tick wall-clock latency; alert if p95 exceeds half the poll interval.",
		Buckets: prometheus.ExponentialBuckets(0.005, 2, 12), // 5ms .. ~10s
	}),
}

// leaseMetrics holds the durable-lease (RFC 002) series. Same leaf-package
// registry + low-cardinality-label discipline as above.
var leaseMetrics = struct {
	Acquired prometheus.Counter
	Skipped  *prometheus.CounterVec
	Stolen   prometheus.Counter
	Errors   *prometheus.CounterVec
	Pruned   prometheus.Counter
}{
	Acquired: promauto.NewCounter(prometheus.CounterOpts{
		Name: "cloud_scheduler_leases_acquired_total",
		Help: "Schedule-state cycle leases freshly acquired (won the INSERT).",
	}),
	Skipped: promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_scheduler_leases_skipped_total",
		Help: "Cycles skipped because a peer owns/fired the lease, by reason (fired|held|steal_lost).",
	}, []string{"reason"}),
	Stolen: promauto.NewCounter(prometheus.CounterOpts{
		Name: "cloud_scheduler_leases_stolen_total",
		Help: "Expired leases reclaimed (the prior owner crashed before firing).",
	}),
	Errors: promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_scheduler_lease_errors_total",
		Help: "Lease store errors by op (acquire|complete|release|prune).",
	}, []string{"op"}),
	Pruned: promauto.NewCounter(prometheus.CounterOpts{
		Name: "cloud_scheduler_schedule_states_pruned_total",
		Help: "Fired schedule-state rows deleted by retention pruning.",
	}),
}
