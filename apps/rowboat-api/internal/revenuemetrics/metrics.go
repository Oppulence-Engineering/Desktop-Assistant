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

	// DigestsSent counts proactive digest emails delivered.
	DigestsSent = promauto.NewCounter(prometheus.CounterOpts{
		Name: "revenue_digests_sent_total",
		Help: "Proactive revenue digest emails sent.",
	})

	// MailSyncThreads counts threads upserted by push-driven Layer-1 sync.
	MailSyncThreads = promauto.NewCounter(prometheus.CounterOpts{
		Name: "revenue_mail_sync_threads_total",
		Help: "Threads indexed by push-driven Gmail history sync.",
	})

	// MailSyncGaps counts history-cursor gaps (stale cursor → deferred to scan).
	MailSyncGaps = promauto.NewCounter(prometheus.CounterOpts{
		Name: "revenue_mail_sync_gaps_total",
		Help: "Gmail history cursor gaps requiring a full re-sync.",
	})

	// TrustEvents is the bounded activation/trust funnel. No tenant, record,
	// evidence, or free-form labels are permitted.
	TrustEvents = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "revenue_trust_events_total",
		Help: "Content-free activation and trust events by category and outcome.",
	}, []string{"event", "outcome", "reason"})

	// ProjectionJobs counts durable projector work by terminal or retry state.
	ProjectionJobs = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "relationship_projection_jobs_total",
		Help: "Relationship projection jobs by terminal or retry status.",
	}, []string{"status"})

	// ProjectionDuration measures the bounded transactional projection step.
	ProjectionDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "relationship_projection_duration_seconds",
		Help:    "Relationship projector transaction duration.",
		Buckets: prometheus.DefBuckets,
	})

	// RelationshipLoopSweeps is the heartbeat and outcome counter for the
	// deterministic relationship workers that run beside the HTTP server.
	// loop/result are closed taxonomies; tenant identifiers are never labels.
	RelationshipLoopSweeps = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "relationship_loop_sweeps_total",
		Help: "Relationship worker sweeps by loop and result.",
	}, []string{"loop", "result"})

	// RelationshipLoopDuration measures bounded sweep and per-job latency using
	// a closed loop-name taxonomy.
	RelationshipLoopDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "relationship_loop_duration_seconds",
		Help:    "Relationship worker sweep or job duration by loop.",
		Buckets: []float64{0.01, 0.1, 0.5, 1, 5, 15, 60, 300, 600},
	}, []string{"loop"})

	// RelationshipLoopItems counts bounded worker outcomes without tenant or
	// record identifiers.
	RelationshipLoopItems = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "relationship_loop_items_total",
		Help: "Bounded relationship work items processed by loop and outcome.",
	}, []string{"loop", "outcome"})

	// RelationshipLoopLastSuccess is the Unix heartbeat used by stale-loop
	// alerts and the workflow operations dashboard.
	RelationshipLoopLastSuccess = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "relationship_loop_last_success_timestamp_seconds",
		Help: "Unix timestamp of the last successful relationship loop sweep or job.",
	}, []string{"loop"})

	// RelationshipQueueDepth reports durable backlog size by bounded queue name.
	RelationshipQueueDepth = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "relationship_queue_depth",
		Help: "Current durable relationship queue depth by bounded queue name.",
	}, []string{"queue"})
)
