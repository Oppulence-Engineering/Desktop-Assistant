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

	// Cloud agent runtime series (RFC 004). The `tool` label is bounded by the
	// fixed allowlist (artifact.*, run_history.read, event.read,
	// connector.read.*) and `limit`/`provider` by small enums — all satisfy
	// the cardinality rule above.

	// RuntimeLLMCalls counts gateway LLM calls made by the agent loop.
	RuntimeLLMCalls = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_runtime_llm_calls_total",
		Help: "LLM calls made by the cloud agent runtime, by provider.",
	}, []string{"provider"})

	// RuntimeToolCalls counts tool invocations, by allowlisted tool name.
	RuntimeToolCalls = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_runtime_tool_calls_total",
		Help: "Tool invocations made by the cloud agent runtime, by tool.",
	}, []string{"tool"})

	// RuntimeToolFailures counts failed tool invocations.
	RuntimeToolFailures = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_runtime_tool_failures_total",
		Help: "Failed tool invocations in the cloud agent runtime, by tool.",
	}, []string{"tool"})

	// RuntimeLimitExceeded counts runs failed by a runtime budget/size limit.
	RuntimeLimitExceeded = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_runtime_limit_exceeded_total",
		Help: "Cloud runtime runs that breached a limit, by limit name.",
	}, []string{"limit"})

	// RuntimeArtifactBytes observes final artifact sizes.
	RuntimeArtifactBytes = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "cloud_runtime_artifact_bytes",
		Help:    "Final artifact size written by the cloud agent runtime.",
		Buckets: prometheus.ExponentialBuckets(256, 4, 8), // 256B .. ~4MiB
	})

	// RuntimeLLMLatency observes per-call LLM latency.
	RuntimeLLMLatency = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "cloud_runtime_llm_latency_seconds",
		Help:    "Latency of cloud runtime LLM calls, by provider.",
		Buckets: prometheus.ExponentialBuckets(0.25, 2, 10), // 0.25s .. ~2m
	}, []string{"provider"})

	// Temporal Schedule series (RFC 005). Labels are small fixed enums
	// (action/op/kind) — never schedule ids or task slugs.

	// ScheduleUpserts counts Temporal Schedule creates/updates.
	ScheduleUpserts = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "temporal_schedules_upserted_total",
		Help: "Temporal Schedules upserted for cron tasks, by action (create|update).",
	}, []string{"action"})

	// ScheduleDeletes counts Temporal Schedule deletions.
	ScheduleDeletes = promauto.NewCounter(prometheus.CounterOpts{
		Name: "temporal_schedules_deleted_total",
		Help: "Temporal Schedules deleted for cron tasks.",
	})

	// ScheduleSyncFailures counts failed schedule operations, by operation.
	ScheduleSyncFailures = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "temporal_schedule_sync_failures_total",
		Help: "Failed Temporal Schedule operations, by op (upsert|pause|delete|describe|list|state_write).",
	}, []string{"op"})

	// ScheduleDrift counts reconciler corrections, by drift kind.
	ScheduleDrift = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "temporal_schedule_drift_total",
		Help: "Temporal Schedule drift corrections by the reconciler, by kind (missing|stale|orphan|pause).",
	}, []string{"kind"})

	// ScheduleFires counts scheduler-workflow fires (CreateScheduledRun starts).
	ScheduleFires = promauto.NewCounter(prometheus.CounterOpts{
		Name: "temporal_schedule_fires_total",
		Help: "Temporal Schedule fires handled by the scheduler workflow.",
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
