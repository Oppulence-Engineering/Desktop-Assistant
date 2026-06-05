// Package backgroundtaskmetrics holds Prometheus series for API-native
// background task (cloud) runs. It is a leaf package so both the HTTP API
// (internal/backgroundtasks) and the Temporal worker
// (internal/backgroundtaskworkflow) can emit to it without an import cycle. Each
// process registers these series on its own default registry and exposes them on
// its own /metrics endpoint.
//
// Cardinality rule: only low-cardinality labels (trigger, error_code from the
// bounded taxonomy). Never label by runId/userId/taskSlug — those belong in logs
// and traces.
package backgroundtaskmetrics

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// Triggered counts runs accepted for execution, by trigger type.
	Triggered = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_runs_triggered_total",
		Help: "API-native background task runs triggered, by trigger type.",
	}, []string{"trigger"})

	// Completed counts runs that reached terminal success.
	Completed = promauto.NewCounter(prometheus.CounterOpts{
		Name: "cloud_runs_completed_total",
		Help: "API-native background task runs that completed successfully.",
	})

	// Failed counts runs that reached terminal failure, by granular error code.
	Failed = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_runs_failed_total",
		Help: "API-native background task runs that failed, by error code.",
	}, []string{"error_code"})

	// Stopped counts runs cancelled to a stopped terminal state.
	Stopped = promauto.NewCounter(prometheus.CounterOpts{
		Name: "cloud_runs_stopped_total",
		Help: "API-native background task runs stopped via cancellation.",
	})

	// Retried counts retry runs created from a prior terminal run.
	Retried = promauto.NewCounter(prometheus.CounterOpts{
		Name: "cloud_run_retry_total",
		Help: "API-native background task retries created.",
	})

	// CancelRequested counts cancel requests accepted by the API.
	CancelRequested = promauto.NewCounter(prometheus.CounterOpts{
		Name: "cloud_run_cancel_requested_total",
		Help: "API-native background task cancellation requests accepted.",
	})

	// ArtifactSyncFailures counts failures persisting the run artifact.
	ArtifactSyncFailures = promauto.NewCounter(prometheus.CounterOpts{
		Name: "cloud_run_artifact_sync_failures_total",
		Help: "Failures while persisting an API-native task artifact.",
	})

	// Duration observes wall-clock execution time (started → terminal).
	Duration = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "cloud_run_duration_seconds",
		Help:    "API-native background task run duration in seconds (start to terminal).",
		Buckets: prometheus.ExponentialBuckets(0.5, 2, 12), // 0.5s .. ~17m
	})

	// QueueLatency observes time spent queued before a worker claimed the run.
	QueueLatency = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "cloud_run_queue_latency_seconds",
		Help:    "Time an API-native run waited in queue before execution started.",
		Buckets: prometheus.ExponentialBuckets(0.1, 2, 12), // 0.1s .. ~3.4m
	})
)

// ObserveDurationSince records a run duration if the start time is known and sane.
func ObserveDurationSince(start *time.Time, end time.Time) {
	if start == nil || start.IsZero() || end.Before(*start) {
		return
	}
	Duration.Observe(end.Sub(*start).Seconds())
}

// ObserveQueueLatency records queue wait if the created time is known and sane.
func ObserveQueueLatency(created, started time.Time) {
	if created.IsZero() || started.Before(created) {
		return
	}
	QueueLatency.Observe(started.Sub(created).Seconds())
}
