package connectors

import (
	"context"
	"fmt"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// MCPRuntimeResolver resolves connector MCP credentials for worker-side tool
// execution. It is explicit-user scoped: callers pass the run owner's user id,
// and the DB query applies that id directly under an internal context.
type MCPRuntimeResolver struct {
	client   *ent.Client
	sealer   *crypto.Sealer
	registry *Registry
	ory      *oryClient
	refresh  refreshDeduper
}

// SetRefreshDedup enables the same rotation-safe refresh path used by the HTTP
// connector token endpoint.
func (r *MCPRuntimeResolver) SetRefreshDedup(cache RefreshCache, sealer *crypto.Sealer, log *zap.Logger) {
	r.refresh.configure(cache, sealer, log)
}

// NewMCPRuntimeResolver builds a worker-side resolver for connector MCP access.
func NewMCPRuntimeResolver(client *ent.Client, sealer *crypto.Sealer, registry *Registry, cfg Config) *MCPRuntimeResolver {
	return &MCPRuntimeResolver{
		client:   client,
		sealer:   sealer,
		registry: registry,
		ory:      newOryClient(cfg.OryPublicURL, cfg.OryBrokerClientID, cfg.OryBrokerClientSecret),
	}
}

// SetOutboundPolicy applies the shared outbound vendor policy to Ory calls.
func (r *MCPRuntimeResolver) SetOutboundPolicy(policy outbound.Policy) {
	if r == nil || r.ory == nil {
		return
	}
	r.ory.setOutboundPolicy(policy)
}

// ResolveMCP returns the MCP endpoint, token type, and bearer/API token for a
// connected user's connector. The token is intended for immediate server-side
// use only; cloud task tools must not surface it to the model.
func (r *MCPRuntimeResolver) ResolveMCP(ctx context.Context, userID, connectorName string) (mcpURL, tokenType, accessToken string, err error) {
	if r == nil || r.client == nil || r.sealer == nil || r.registry == nil {
		return "", "", "", fmt.Errorf("connector resolver not configured")
	}
	uid, err := uuid.Parse(userID)
	if err != nil {
		return "", "", "", fmt.Errorf("invalid user id: %w", err)
	}
	c, ok := r.registry.Get(connectorName)
	if !ok {
		return "", "", "", fmt.Errorf("unknown connector %q", connectorName)
	}
	mc, err := r.client.MCPConnection.Query().
		Where(
			mcpconnection.ConnectorEQ(connectorName),
			mcpconnection.HasUserWith(user.IDEQ(uid)),
		).
		Only(auth.WithInternal(ctx))
	if err != nil {
		if ent.IsNotFound(err) {
			return "", "", "", fmt.Errorf("connector %q is not connected", connectorName)
		}
		return "", "", "", fmt.Errorf("load connector %q: %w", connectorName, err)
	}
	if c.AuthType == "api_key" {
		key, err := r.sealer.OpenString(mc.APIKeyEncrypted)
		if err != nil {
			return "", "", "", fmt.Errorf("open connector %q api key: %w", connectorName, err)
		}
		_ = mc.Update().SetLastUsedAt(time.Now()).Exec(auth.WithInternal(ctx))
		return c.MCPURL, "Bearer", key, nil
	}

	refresh, err := r.sealer.OpenString(mc.RefreshTokenEncrypted)
	if err != nil {
		return "", "", "", fmt.Errorf("open connector %q refresh token: %w", connectorName, err)
	}
	tok, err := r.refresh.refresh(auth.WithInternal(ctx), connectorName, mc, r.ory, refresh)
	if err != nil {
		return "", "", "", fmt.Errorf("refresh connector %q token: %w", connectorName, err)
	}
	return c.MCPURL, defaultStr(tok.TokenType, "Bearer"), tok.AccessToken, nil
}
