package auth

import (
	"context"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/authmetrics"
	"github.com/go-chi/chi/v5/middleware"
	"go.uber.org/zap"
)

// Audit emits the RFC 011 identity/authorization audit events. It writes
// structured zap logs (one event per call) AND bumps the bounded-cardinality
// authmetrics counters. It NEVER records a raw token, refresh token, auth code,
// PKCE verifier, or the full claims payload — only the bounded dimensions plus
// the identifiers an audit trail needs (request id, and for user/org events the
// resolved ids, which live in logs, never in metric labels).
//
// Level policy: token.accepted is high-volume (one per authenticated request)
// and is mirrored by the access log, so it logs at Debug; rejections are a
// security signal and log at Warn; user/org mutations log at Info. The metric
// counters are always emitted regardless of log level.
type Audit struct {
	log *zap.Logger
}

// NewAudit returns an Audit writing to the given logger. A nil logger is
// tolerated (events still bump metrics) so identity resolution outside a
// request (tests, system callers) does not panic.
func NewAudit(log *zap.Logger) *Audit {
	return &Audit{log: log}
}

func (a *Audit) logger() *zap.Logger {
	if a == nil || a.log == nil {
		return zap.NewNop()
	}
	return a.log
}

// reqID recovers the chi request id from context, or "" outside a request.
func reqID(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	return middleware.GetReqID(ctx)
}

// TokenAccepted records a token that passed validation.
func (a *Audit) TokenAccepted(ctx context.Context, issuerType, audience, routeGroup string) {
	authmetrics.TokenAccepted.WithLabelValues(issuerType, routeGroup).Inc()
	a.logger().Debug("auth.token.accepted",
		zap.String("event", "auth.token.accepted"),
		zap.String("request_id", reqID(ctx)),
		zap.String("issuer_type", issuerType),
		zap.String("audience", audience),
		zap.String("route_group", routeGroup),
		zap.Time("created_at", time.Now().UTC()),
	)
}

// TokenRejected records a token that failed validation, with the bounded
// rejection reason.
func (a *Audit) TokenRejected(ctx context.Context, issuerType, audience, routeGroup, reason string) {
	authmetrics.TokenRejected.WithLabelValues(issuerType, routeGroup, reason).Inc()
	a.logger().Warn("auth.token.rejected",
		zap.String("event", "auth.token.rejected"),
		zap.String("request_id", reqID(ctx)),
		zap.String("issuer_type", issuerType),
		zap.String("audience", audience),
		zap.String("reason", reason),
		zap.String("route_group", routeGroup),
		zap.Time("created_at", time.Now().UTC()),
	)
}

// UserUpserted records a local user-mirror create or refresh. operation is one
// of "created" or "refreshed".
func (a *Audit) UserUpserted(ctx context.Context, operation, userID, workosUserID string) {
	authmetrics.UserUpserted.WithLabelValues(operation).Inc()
	a.logger().Info("auth.user.upserted",
		zap.String("event", "auth.user.upserted"),
		zap.String("request_id", reqID(ctx)),
		zap.String("operation", operation),
		zap.String("user_id", userID),
		zap.String("workos_user_id", workosUserID),
		zap.Time("created_at", time.Now().UTC()),
	)
}

// OrgMapped records an organization claim mapped onto the local user
// projection. operation is one of "set" (first sight) or "switched".
func (a *Audit) OrgMapped(ctx context.Context, operation, userID, workosOrgID string) {
	authmetrics.OrgMapped.WithLabelValues(operation).Inc()
	a.logger().Info("auth.org.mapped",
		zap.String("event", "auth.org.mapped"),
		zap.String("request_id", reqID(ctx)),
		zap.String("operation", operation),
		zap.String("user_id", userID),
		zap.String("workos_org_id", workosOrgID),
		zap.Time("created_at", time.Now().UTC()),
	)
}

// AuthzDenied records an authorization (post-authentication) denial: the
// principal authenticated but a policy helper refused the action.
func (a *Audit) AuthzDenied(ctx context.Context, policy, routeGroup string) {
	authmetrics.AuthzDenied.WithLabelValues(policy, routeGroup).Inc()
	a.logger().Warn("auth.authz.denied",
		zap.String("event", "auth.authz.denied"),
		zap.String("request_id", reqID(ctx)),
		zap.String("policy", policy),
		zap.String("route_group", routeGroup),
		zap.Time("created_at", time.Now().UTC()),
	)
}
