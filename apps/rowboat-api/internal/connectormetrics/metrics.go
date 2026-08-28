// Package connectormetrics contains bounded-cardinality broker metrics. Labels
// are catalog or small enum values only. User, org, connection, and state ids
// must never be added as labels.
package connectormetrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// Lifecycle counts bounded connector lifecycle transition outcomes.
	Lifecycle = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "connector_lifecycle_total",
		Help: "Connector broker lifecycle transitions by connector, transition, and outcome.",
	}, []string{"connector", "transition", "outcome"})

	// TokenMint counts bounded resource-token mint outcomes.
	TokenMint = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "connector_token_mint_total",
		Help: "Connector resource-token mint decisions by connector and outcome.",
	}, []string{"connector", "outcome"})

	// Revocation counts bounded connector revocation outcomes.
	Revocation = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "connector_revocation_total",
		Help: "Connector revocation attempts by connector and outcome.",
	}, []string{"connector", "outcome"})

	// Consent counts bounded consent decisions.
	Consent = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "connector_consent_total",
		Help: "Connector consent decisions by connector and bounded decision.",
	}, []string{"connector", "decision"})

	// CredentialCustodyInFlight reports credentials currently awaiting custody or revocation.
	CredentialCustodyInFlight = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "connector_credential_custody_in_flight",
		Help: "Provider credentials awaiting durable recovery custody or confirmed revocation in this process.",
	})
	// CredentialCustodyQueueDepth reports queued credential custody work.
	CredentialCustodyQueueDepth = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "connector_credential_custody_queue_depth",
		Help: "Provider credentials queued behind the bounded credential custody workers.",
	})
	// CredentialCustodySaturated reports whether custody admission is applying backpressure.
	CredentialCustodySaturated = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "connector_credential_custody_saturated",
		Help: "Whether the bounded credential custody supervisor is applying admission backpressure.",
	})
	// CredentialCustodyOutcomes counts bounded custody supervisor outcomes.
	CredentialCustodyOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "connector_credential_custody_total",
		Help: "Credential custody supervisor outcomes by bounded outcome.",
	}, []string{"outcome"})
)
