package auth

import (
	"context"
	"fmt"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	"go.uber.org/zap"
)

// Enricher fetches user metadata (email, org) not present in the access token.
// The WorkOS implementation calls the WorkOS API; the noop is used in dev/test.
type Enricher interface {
	Email(ctx context.Context, workosUserID string) (string, error)
}

// NoopEnricher returns no enrichment.
type NoopEnricher struct{}

// Email implements Enricher.
func (NoopEnricher) Email(context.Context, string) (string, error) { return "", nil }

// ResolveUser upserts the local user mirror for a verified token: it returns
// the existing user (best-effort email refresh) or creates one on first sight,
// minting a free-tier subscription. User is not a tenant-scoped entity, so this
// runs without a viewer already in context.
func (m *Middleware) ResolveUser(ctx context.Context, claims *oauthrs.Claims) (*ent.User, error) {
	if claims.WorkOSUserID == "" {
		return nil, fmt.Errorf("token has no workos_user_id")
	}

	u, err := m.client.User.Query().
		Where(user.WorkosUserIDEQ(claims.WorkOSUserID)).
		Only(ctx)
	switch {
	case err == nil:
		// Refresh email if the token now carries one and it changed.
		if claims.Email != "" && u.Email != claims.Email {
			if updated, uErr := u.Update().SetEmail(claims.Email).Save(ctx); uErr == nil {
				u = updated
			} else {
				m.log.Warn("email refresh failed", zap.Error(uErr))
			}
		}
		return u, nil
	case ent.IsNotFound(err):
		return m.createUser(ctx, claims)
	default:
		return nil, err
	}
}

// createUser creates the user + free-tier subscription in one transaction.
// A concurrent first-sight insert loses the unique-index race and falls back
// to a re-query.
func (m *Middleware) createUser(ctx context.Context, claims *oauthrs.Claims) (*ent.User, error) {
	email := claims.Email
	if email == "" && m.enricher != nil {
		if e, eErr := m.enricher.Email(ctx, claims.WorkOSUserID); eErr == nil {
			email = e
		} else {
			m.log.Debug("workos enrichment failed", zap.Error(eErr))
		}
	}

	tx, err := m.client.Tx(ctx)
	if err != nil {
		return nil, err
	}

	create := tx.User.Create().SetWorkosUserID(claims.WorkOSUserID)
	if email != "" {
		create = create.SetEmail(email)
	}
	if claims.WorkOSOrgID != "" {
		create = create.SetWorkosOrgID(claims.WorkOSOrgID)
	}
	u, err := create.Save(ctx)
	if err != nil {
		_ = tx.Rollback()
		// Lost the first-sight race → the row exists; read it back.
		if ent.IsConstraintError(err) {
			return m.client.User.Query().Where(user.WorkosUserIDEQ(claims.WorkOSUserID)).Only(ctx)
		}
		return nil, err
	}

	if _, err := tx.Subscription.Create().
		SetUser(u).
		SetSanctionedCredits(m.freeTierCredits).
		Save(ctx); err != nil {
		_ = tx.Rollback()
		return nil, fmt.Errorf("mint free-tier subscription: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	m.log.Info("user provisioned",
		zap.String("workos_user_id", claims.WorkOSUserID),
		zap.String("user_id", u.ID.String()))
	return u, nil
}
