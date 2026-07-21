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
		return m.refreshUser(ctx, u, claims), nil
	case ent.IsNotFound(err):
		return m.createUser(ctx, claims)
	default:
		return nil, err
	}
}

// refreshUser keeps the local mirror in step with the token: it refreshes the
// email when it changes and maps the organization claim when the token's org
// differs from the stored one (RFC 011 org mapping: "known org" / "user
// switched org"). Mirror updates are best-effort — a write failure logs and
// returns the existing row rather than failing the request.
func (m *Middleware) refreshUser(ctx context.Context, u *ent.User, claims *oauthrs.Claims) *ent.User {
	emailChanged := claims.Email != "" && u.Email != claims.Email
	orgOp := ""
	if claims.WorkOSOrgID != "" && u.WorkosOrgID != claims.WorkOSOrgID {
		if u.WorkosOrgID == "" {
			orgOp = "set"
		} else {
			orgOp = "switched"
		}
	}
	if !emailChanged && orgOp == "" {
		return u
	}

	upd := u.Update()
	if emailChanged {
		upd = upd.SetEmail(claims.Email)
	}
	if orgOp != "" {
		upd = upd.SetWorkosOrgID(claims.WorkOSOrgID)
	}
	updated, uErr := upd.Save(ctx)
	if uErr != nil {
		m.log.Warn("user mirror refresh failed", zap.Error(uErr))
		return u
	}
	if orgOp != "" {
		m.audit.OrgMapped(ctx, orgOp, updated.ID.String(), claims.WorkOSOrgID)
	}
	return updated
}

// createUser creates the user + free-tier subscription in one transaction.
// A concurrent first-sight insert loses the unique-index race and falls back
// to a re-query.
func (m *Middleware) createUser(ctx context.Context, claims *oauthrs.Claims) (*ent.User, error) {
	// First-sight provisioning happens before a user can exist in context. Mark
	// the transaction as an authenticated internal identity operation so the
	// ORM's tenant-mutation guard permits creation of the new user's subscription.
	provisionCtx := WithInternal(ctx)
	email := claims.Email
	if email == "" && m.enricher != nil {
		if e, eErr := m.enricher.Email(ctx, claims.WorkOSUserID); eErr == nil {
			email = e
		} else {
			m.log.Debug("workos enrichment failed", zap.Error(eErr))
		}
	}

	tx, err := m.client.Tx(provisionCtx)
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
	u, err := create.Save(provisionCtx)
	if err != nil {
		_ = tx.Rollback()
		// Lost the first-sight race → the row exists; read it back.
		if ent.IsConstraintError(err) {
			return m.client.User.Query().Where(user.WorkosUserIDEQ(claims.WorkOSUserID)).Only(provisionCtx)
		}
		return nil, err
	}

	if _, err := tx.Subscription.Create().
		SetUser(u).
		SetSanctionedCredits(m.freeTierCredits).
		Save(provisionCtx); err != nil {
		_ = tx.Rollback()
		return nil, fmt.Errorf("mint free-tier subscription: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	m.log.Info("user provisioned",
		zap.String("workos_user_id", claims.WorkOSUserID),
		zap.String("user_id", u.ID.String()))
	m.audit.UserUpserted(ctx, "created", u.ID.String(), claims.WorkOSUserID)
	if claims.WorkOSOrgID != "" {
		m.audit.OrgMapped(ctx, "set", u.ID.String(), claims.WorkOSOrgID)
	}
	return u, nil
}
