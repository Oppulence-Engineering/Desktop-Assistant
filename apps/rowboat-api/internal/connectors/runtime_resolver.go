package connectors

import (
	"context"
	"errors"
	"fmt"

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
	client    *ent.Client
	sealer    *crypto.Sealer
	registry  *Registry
	ory       *oryClient
	refresh   refreshDeduper
	issuer    ResourceTokenIssuer
	lifecycle *LifecycleService
}

// SetRefreshDedup enables the same rotation-safe refresh path used by the HTTP
// connector token endpoint.
func (r *MCPRuntimeResolver) SetRefreshDedup(cache RefreshCache, sealer *crypto.Sealer, log *zap.Logger) {
	if r == nil {
		return
	}
	r.refresh.configure(cache, sealer, r.client, log)
	if r.lifecycle != nil {
		r.lifecycle.SetLogger(log)
	}
}

// NewMCPRuntimeResolver builds a worker-side resolver for connector MCP access.
func NewMCPRuntimeResolver(client *ent.Client, sealer *crypto.Sealer, registry *Registry, cfg Config) *MCPRuntimeResolver {
	ory := newOryClient(cfg.OryPublicURL, cfg.OryBrokerClientID, cfg.OryBrokerClientSecret)
	r := &MCPRuntimeResolver{client: client, sealer: sealer, registry: registry, ory: ory}
	r.lifecycle = NewLifecycleService(client, sealer, registry, ory)
	return r
}

// SetOutboundPolicy applies the shared outbound vendor policy to Ory calls.
func (r *MCPRuntimeResolver) SetOutboundPolicy(policy outbound.Policy) {
	if r == nil || r.ory == nil {
		return
	}
	r.ory.setOutboundPolicy(policy)
}

// SetResourceTokenIssuer configures the same audience-bound product token
// issuer used by the public resource-token endpoint. Worker-side tools must not
// pass provider access tokens or API keys to product MCP servers.
func (r *MCPRuntimeResolver) SetResourceTokenIssuer(issuer ResourceTokenIssuer) {
	if r == nil {
		return
	}
	r.issuer = issuer
	if r.lifecycle != nil {
		r.lifecycle.SetIssuer(issuer)
	}
}

// ResolveMCP returns the MCP endpoint, token type, and bearer/API token for a
// connected user's connector. The token is intended for immediate server-side
// use only; cloud task tools must not surface it to the model.
func (r *MCPRuntimeResolver) ResolveMCP(ctx context.Context, userID, connectorName string) (mcpURL, tokenType, accessToken string, err error) {
	if r == nil || r.client == nil || r.sealer == nil || r.registry == nil || r.lifecycle == nil {
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
	if !r.registry.Enabled(connectorName) {
		return "", "", "", fmt.Errorf("connector %q entitlement denied: connector_disabled", connectorName)
	}
	owner, err := r.client.User.Get(auth.WithInternal(ctx), uid)
	if err != nil {
		return "", "", "", fmt.Errorf("load connector owner: %w", err)
	}
	mc, err := r.client.MCPConnection.Query().Where(
		mcpconnection.ConnectorEQ(connectorName),
		mcpconnection.StatusEQ("active"),
		mcpconnection.OrganizationIDEQ(connectorOrganizationID(owner)),
		mcpconnection.HasUserWith(user.IDEQ(uid)),
	).WithUser().Only(auth.WithInternal(ctx))
	if err != nil {
		if ent.IsNotFound(err) {
			return "", "", "", fmt.Errorf("connector %q is not connected", connectorName)
		}
		return "", "", "", fmt.Errorf("load connector %q: %w", connectorName, err)
	}
	if r.issuer == nil {
		return "", "", "", fmt.Errorf("connector resource token issuer not configured")
	}

	if c.AuthType == "api_key" {
		if _, err := r.sealer.OpenString(mc.APIKeyEncrypted); err != nil {
			return "", "", "", fmt.Errorf("open connector %q api key: %w", connectorName, err)
		}
	} else {
		refresh, err := r.sealer.OpenString(mc.RefreshTokenEncrypted)
		if err != nil {
			return "", "", "", fmt.Errorf("open connector %q refresh token: %w", connectorName, err)
		}
		bound := newConnectorRefreshContext(
			connectorName, mc.ID.String(), mc.OrganizationID, mc.CredentialGeneration, mc.Audience, mc.Scopes,
		)
		persist := func(pctx context.Context, tok *oryToken, cleanupID uuid.UUID) (int64, error) {
			updated, saveErr := r.lifecycle.PersistRefresh(pctx, owner, mc, tok, cleanupID)
			if saveErr == nil {
				mc = updated
				return updated.CredentialGeneration, nil
			}
			return 0, saveErr
		}
		result, refreshErr := r.refresh.refresh(auth.WithInternal(ctx), bound, r.ory, refresh, persist)
		if refreshErr != nil {
			if !errors.Is(refreshErr, errConnectorRefreshInProgress) && !errors.Is(refreshErr, errConnectorCredentialSuperseded) {
				transitionErr := r.lifecycle.HandleRefreshFailure(context.WithoutCancel(ctx), owner, mc, refreshErr)
				if transitionErr != nil && !errors.Is(transitionErr, errConnectorCredentialSuperseded) {
					return "", "", "", fmt.Errorf("record connector %q refresh failure: %w", connectorName, transitionErr)
				}
			}
			return "", "", "", fmt.Errorf("refresh connector %q token: %w", connectorName, refreshErr)
		}

		// Cached results from another replica do not invoke this resolver's
		// persistence callback. Reload the winning generation before minting.
		current, currentErr := r.client.MCPConnection.Query().Where(
			mcpconnection.IDEQ(mc.ID),
			mcpconnection.ConnectorEQ(connectorName),
			mcpconnection.OrganizationIDEQ(bound.OrganizationID),
			mcpconnection.StatusEQ("active"),
			mcpconnection.CredentialGenerationEQ(result.CurrentCredentialGeneration),
			mcpconnection.HasUserWith(user.IDEQ(owner.ID)),
		).Only(auth.WithInternal(ctx))
		if currentErr != nil {
			return "", "", "", fmt.Errorf("connector %q lifecycle changed during refresh: %w", connectorName, errConnectorCredentialSuperseded)
		}
		mc = current
		if result == nil || !providerGrantMatches(r.registry, connectorName, mc.Scopes, result.Token.Scope) {
			return "", "", "", fmt.Errorf("connector %q provider scope mismatch", connectorName)
		}
	}

	token, err := r.lifecycle.Mint(auth.WithInternal(ctx), owner, c, mc, mc.Scopes)
	if err != nil {
		return "", "", "", err
	}
	return c.MCPURL, "Bearer", token, nil
}
