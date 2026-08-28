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

	// EntitlementUnavailable counts fail-closed product entitlement transport
	// failures by a bounded, non-secret cause. The public authorization response
	// remains the normalized entitlement_unavailable denial.
	EntitlementUnavailable = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "connector_entitlement_unavailable_total",
		Help: "Fail-closed product entitlement failures by connector and bounded non-secret cause.",
	}, []string{"connector", "cause"})

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
	// CredentialCustodyShutdownUnresolved reports admitted work that remains
	// unresolved after shutdown has begun. It stays scrapeable while the public
	// listener drains so operators can page before Kubernetes reaches SIGKILL.
	CredentialCustodyShutdownUnresolved = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "connector_credential_custody_shutdown_unresolved",
		Help: "Admitted credential custody work still unresolved after process shutdown began.",
	})
	// CredentialCustodyOutcomes counts bounded custody supervisor outcomes.
	CredentialCustodyOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "connector_credential_custody_total",
		Help: "Credential custody supervisor outcomes by bounded outcome.",
	}, []string{"outcome"})

	// RefreshFailurePersistence counts detached transactional lifecycle results.
	RefreshFailurePersistence = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "connector_refresh_failure_persistence_total",
		Help: "Detached connector refresh-failure lifecycle persistence outcomes.",
	}, []string{"outcome"})
	// RefreshFailurePersistenceFailed latches when a terminal provider signal was
	// not transactionally acknowledged and the replica must remain unready.
	RefreshFailurePersistenceFailed = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "connector_refresh_failure_persistence_failed",
		Help: "Whether terminal connector refresh-failure persistence is unacknowledged on this replica.",
	})
)
