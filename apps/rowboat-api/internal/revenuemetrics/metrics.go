// Package revenuemetrics holds the Prometheus series for the revenue memory
// and outbound governance plane (RFC 030 Observability). It is a leaf package
// so the HTTP API and any future scan worker can emit these series without an
// import cycle through internal/revenue.
//
// Cardinality rule (hard, RFC 030): label only by bounded dimensions —
// action type, queue status, decision, detector, owner, channel, kind,
// operation, reason group. NEVER label by user, organization, workspace,
// lead, action, email, domain, or provider record IDs.
package revenuemetrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// Actions counts revenue actions entering the queue, by action type and
	// initial queue status.
	Actions = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "revenue_actions_total",
		Help: "Revenue actions created, by action type and queue status.",
	}, []string{"action_type", "queue_status"})

	// PreflightRequests counts facade evaluate calls by resulting decision
	// status ("unavailable" when the facade fails closed) and bounded reason
	// group.
	PreflightRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "revenue_preflight_requests_total",
		Help: "OutboundConsole preflight evaluations, by status and reason group.",
	}, []string{"status", "reason_group"})

	// PreflightDuration observes facade evaluate latency by decision status.
	PreflightDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "revenue_preflight_duration_seconds",
		Help:    "OutboundConsole preflight latency, by status.",
		Buckets: prometheus.DefBuckets,
	}, []string{"status"})

	// Decisions counts operator decisions on actions (approved, rejected,
	// snoozed, dismissed).
	Decisions = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "revenue_action_decisions_total",
		Help: "Operator decisions on revenue actions, by decision.",
	}, []string{"decision"})

	// Executions counts execution attempts by owner, terminal status, and
	// channel.
	Executions = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "revenue_action_executions_total",
		Help: "Revenue action executions, by owner, status, and channel.",
	}, []string{"owner", "status", "channel"})

	// Outcomes counts observed action outcomes by kind.
	Outcomes = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "revenue_action_outcomes_total",
		Help: "Observed revenue action outcomes, by kind.",
	}, []string{"kind"})

	// DuplicatesPrevented counts idempotency short-circuits (duplicate
	// evaluate/execute/outcome requests answered from stored state).
	DuplicatesPrevented = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "revenue_duplicate_operations_prevented_total",
		Help: "Duplicate revenue operations answered idempotently, by operation.",
	}, []string{"operation"})

	// Scans counts revenue leak scans by terminal status and workspace mode.
	Scans = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "revenue_leak_scans_total",
		Help: "Revenue leak scans, by status and mode.",
	}, []string{"status", "mode"})

	// ScanDuration observes scan wall-clock by workspace mode.
	ScanDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "revenue_leak_scan_duration_seconds",
		Help:    "Revenue leak scan duration, by mode.",
		Buckets: []float64{1, 5, 15, 30, 60, 120, 300},
	}, []string{"mode"})

	// DetectorCandidates counts detector evaluations by detector and result.
	DetectorCandidates = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "revenue_detector_candidates_total",
		Help: "Detector evaluations during scans, by detector and result.",
	}, []string{"detector", "result"})

	// AutoScansStarted counts scans kicked off by the background auto-scan
	// sweeper (no labels — bounded by design).
	AutoScansStarted = promauto.NewCounter(prometheus.CounterOpts{
		Name: "revenue_auto_scans_started_total",
		Help: "Revenue leak scans started by the background sweeper.",
	})
)
