// Package actionmetrics holds the Prometheus series for the closed-loop action
// broker (RFC 023 Observability). It is a leaf package so the broker and any
// future watch worker can emit these series without an import cycle through
// internal/actions.
//
// Cardinality rule (hard, RFC 023): label only by bounded dimensions — the
// action kind (a product catalog, never per-object), proposal status, a
// financial flag, and a small rejection-reason enum. NEVER label by user,
// proposal id, target resourceRef, or any provider record id.
package actionmetrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// Proposals counts action proposals reaching a status transition, by kind
	// and the status entered. Drives the propose→approve→execute funnel.
	Proposals = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "action_proposals_total",
		Help: "Closed-loop action proposals, by kind and status entered.",
	}, []string{"kind", "status"})

	// TokensIssued counts approval tokens minted, split by whether the action
	// was financial (money-touching).
	TokensIssued = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "approval_token_issued_total",
		Help: "Approval tokens issued, by financial flag.",
	}, []string{"financial"})

	// TokensRejected counts token verifications that failed at execute — a
	// security signal. reason is a bounded enum.
	TokensRejected = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "approval_token_rejected_total",
		Help: "Approval tokens rejected at execute, by reason.",
	}, []string{"reason"})

	// LoopClose observes the time from execution to the product's return
	// CloudEvent (the Watch leg closing the loop), by kind.
	LoopClose = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "action_loop_close_seconds",
		Help:    "Seconds from action execution to the correlated return event.",
		Buckets: []float64{1, 5, 30, 120, 600, 3600, 21600, 86400},
	}, []string{"kind"})
)
