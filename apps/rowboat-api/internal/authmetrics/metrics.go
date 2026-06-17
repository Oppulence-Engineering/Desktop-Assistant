// Package authmetrics holds the Prometheus series for the identity and
// authorization plane (RFC 011). It is a leaf package so the HTTP API, the
// scheduler, and the worker can each emit and expose these series on their own
// /metrics endpoint without an import cycle through internal/auth.
//
// Cardinality rule (hard, RFC 011 Observability): label only by bounded
// dimensions — issuer type, route group, and rejection reason. NEVER label by
// user id, org id, token id, or the raw issuer string; those belong in logs and
// traces.
package authmetrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// TokenAccepted counts bearer tokens that passed validation, by issuer type
	// and the route group they were presented to.
	TokenAccepted = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "auth_token_accepted_total",
		Help: "Bearer tokens accepted after validation, by issuer type and route group.",
	}, []string{"issuer_type", "route_group"})

	// TokenRejected counts bearer tokens rejected during validation, by issuer
	// type, route group, and bounded rejection reason.
	TokenRejected = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "auth_token_rejected_total",
		Help: "Bearer tokens rejected during validation, by issuer type, route group, and reason.",
	}, []string{"issuer_type", "route_group", "reason"})

	// UserUpserted counts local user mirror upserts, by operation (created or
	// refreshed) triggered during identity resolution.
	UserUpserted = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "auth_user_upserted_total",
		Help: "Local user mirror upserts during identity resolution, by operation.",
	}, []string{"operation"})

	// OrgMapped counts organization-claim mappings applied to the local user
	// projection, by operation (set on first sight or switched).
	OrgMapped = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "auth_org_mapped_total",
		Help: "WorkOS organization claims mapped to the local user, by operation.",
	}, []string{"operation"})

	// AuthzDenied counts authorization (post-authentication) denials, by the
	// policy that denied and the route group. Authentication failures are
	// TokenRejected; this is the "who you are is fine, but you can't do this"
	// path (RFC 011 authorization middleware).
	AuthzDenied = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "auth_authz_denied_total",
		Help: "Authorization denials after successful authentication, by policy and route group.",
	}, []string{"policy", "route_group"})
)
