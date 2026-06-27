// Package connectorcreds resolves a user's connector credential (the decrypted
// OAuth token) for durable-agent tools that act on the user's behalf (RFC 012).
// It is the one place that opens a sealed OAuthConnection credential for tool
// use; the token never leaves the activity that calls a connector API.
package connectorcreds

import (
	"context"
	"fmt"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/google/uuid"
)

// ErrNotConnected reports that the user has no connection for the provider — the
// tool surfaces this to the model as "connect <provider> first" rather than a
// hard failure.
var ErrNotConnected = fmt.Errorf("connectorcreds: provider not connected")

// Resolver opens sealed connector credentials scoped to a user. It satisfies
// agentregistry.CredResolver.
type Resolver struct {
	client *ent.Client
	sealer *crypto.Sealer
}

// New builds a Resolver. A nil sealer makes Resolve always error (credentials
// cannot be opened), which callers treat as "tool unavailable".
func New(client *ent.Client, sealer *crypto.Sealer) *Resolver {
	return &Resolver{client: client, sealer: sealer}
}

// Resolve returns the decrypted credential for (userID, provider). The unique
// (provider, user) index guarantees at most one connection per provider per
// user. Runs under the internal context so the lookup is not tenant-filtered
// away (the userID scope is applied explicitly).
func (r *Resolver) Resolve(ctx context.Context, userID, provider string) (string, error) {
	if r == nil || r.client == nil || r.sealer == nil {
		return "", fmt.Errorf("connectorcreds: resolver not configured")
	}
	uid, err := uuid.Parse(userID)
	if err != nil {
		return "", fmt.Errorf("connectorcreds: invalid user id: %w", err)
	}
	conn, err := r.client.OAuthConnection.Query().
		Where(
			oauthconnection.ProviderEQ(provider),
			oauthconnection.HasUserWith(user.IDEQ(uid)),
		).
		Only(auth.WithInternal(ctx))
	if err != nil {
		if ent.IsNotFound(err) {
			return "", ErrNotConnected
		}
		return "", fmt.Errorf("connectorcreds: load %s connection: %w", provider, err)
	}
	token, err := r.sealer.OpenString(conn.RefreshTokenEncrypted)
	if err != nil {
		return "", fmt.Errorf("connectorcreds: open %s credential: %w", provider, err)
	}
	return token, nil
}
