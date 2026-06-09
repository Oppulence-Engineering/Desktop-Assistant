package cloudevents

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Cardinality rule: label only by source / bucket / stage — never by user,
// event id, or task slug (mirrors internal/backgroundtaskmetrics).
var (
	metricIngested = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_events_ingested_total",
		Help: "Cloud events ingested (first insert), by source.",
	}, []string{"source"})

	metricDeduped = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_events_deduped_total",
		Help: "Duplicate cloud event posts absorbed by the dedupe key, by source.",
	}, []string{"source"})

	metricRouted = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_events_routed_total",
		Help: "Cloud events whose routing completed, by source.",
	}, []string{"source"})

	metricRouteMatches = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_event_route_matches_total",
		Help: "Pass-2 routing decisions, by bucket (match, low_conf, no_match).",
	}, []string{"bucket"})

	metricRouteFailures = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_event_route_failures_total",
		Help: "Routing failures, by stage (cap, pass1, pass2, start_run, quota, route_start).",
	}, []string{"stage"})

	metricTriggeredRuns = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_event_triggered_runs_total",
		Help: "Runs started by the cloud event router, by event source.",
	}, []string{"source"})

	metricUnresolved = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cloud_events_unresolved_total",
		Help: "Provider webhook events dropped because no Rowboat user could be resolved, by source.",
	}, []string{"source"})

	metricRouteLatency = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "cloud_event_route_latency_seconds",
		Help:    "Latency from event receipt to routing completion.",
		Buckets: prometheus.ExponentialBuckets(0.25, 2, 12), // 0.25s … ~17m
	})
)
