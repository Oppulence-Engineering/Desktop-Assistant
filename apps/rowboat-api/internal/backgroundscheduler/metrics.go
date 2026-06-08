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
	Errors: promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_scheduler_errors_total",
		Help: "Scheduler errors by stage (query|parse|user_edge|lease|start).",
	}, []string{"stage"}),
	TickDuration: promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "cloud_scheduler_tick_duration_seconds",
		Help:    "Scheduler tick wall-clock latency; alert if p95 exceeds half the poll interval.",
		Buckets: prometheus.ExponentialBuckets(0.005, 2, 12), // 5ms .. ~10s
	}),
}
