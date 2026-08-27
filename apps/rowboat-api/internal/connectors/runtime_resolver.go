package connectors

import (
	"context"
	"fmt"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/subscription"
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
	issuer   ResourceTokenIssuer
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

// SetResourceTokenIssuer configures the same audience-bound product token
// issuer used by the public resource-token endpoint. Worker-side tools must not
// pass provider access tokens or API keys to product MCP servers.
func (r *MCPRuntimeResolver) SetResourceTokenIssuer(issuer ResourceTokenIssuer) {
	r.issuer = issuer
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
	owner, err := r.client.User.Get(auth.WithInternal(ctx), uid)
	if err != nil {
		return "", "", "", fmt.Errorf("load connector owner: %w", err)
	}
	mc, err := r.client.MCPConnection.Query().
		Where(
			mcpconnection.ConnectorEQ(connectorName),
			mcpconnection.StatusEQ("active"),
			mcpconnection.OrganizationIDEQ(connectorOrganizationID(owner)),
			mcpconnection.HasUserWith(user.IDEQ(uid)),
		).
		WithUser().
		Only(auth.WithInternal(ctx))
	if err != nil {
		if ent.IsNotFound(err) {
			return "", "", "", fmt.Errorf("connector %q is not connected", connectorName)
		}
		return "", "", "", fmt.Errorf("load connector %q: %w", connectorName, err)
	}
	if allowed, reason := r.isEntitled(ctx, owner, c, mc.Scopes); !allowed {
		return "", "", "", fmt.Errorf("connector %q entitlement denied: %s", connectorName, reason)
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
		persist := func(pctx context.Context, tok *oryToken) error {
			update := mc.Update().Where(
				mcpconnection.CredentialGenerationEQ(mc.CredentialGeneration),
				mcpconnection.StatusEQ("active"),
				mcpconnection.OrganizationIDEQ(mc.OrganizationID),
			).SetLastUsedAt(time.Now().UTC())
			if tok.RefreshToken != "" {
				sealed, sealErr := r.sealer.SealString(tok.RefreshToken)
				if sealErr != nil {
					return sealErr
				}
				update.SetRefreshTokenEncrypted(sealed).AddCredentialGeneration(1)
			}
			if _, saveErr := update.Save(auth.WithInternal(pctx)); saveErr != nil {
				if ent.IsNotFound(saveErr) {
					return errConnectorCredentialSuperseded
				}
				return saveErr
			}
			return nil
		}
		if _, err := r.refresh.refresh(auth.WithInternal(ctx), connectorName, r.ory, refresh, persist); err != nil {
			status := "error"
			if isOAuthErrorCode(err, "invalid_grant") {
				status = "reauth_required"
			}
			_ = mc.Update().SetStatus(status).Exec(auth.WithInternal(ctx))
			return "", "", "", fmt.Errorf("refresh connector %q token: %w", connectorName, err)
		}
	}
	token, _, err := r.issuer.Mint(ResourceTokenClaims{
		UserID: owner.WorkosUserID, OrganizationID: mc.OrganizationID,
		ConnectionID: mc.ID.String(), ConnectorID: c.Name, Audience: c.Audience,
		Scopes: mc.Scopes, TrustTier: trustTierForScopes(r.registry, c.Name, mc.Scopes),
	})
	if err != nil {
		return "", "", "", fmt.Errorf("mint connector %q resource token: %w", connectorName, err)
	}
	_ = mc.Update().SetLastUsedAt(time.Now()).Exec(auth.WithInternal(ctx))
	return c.MCPURL, "Bearer", token, nil
}

func (r *MCPRuntimeResolver) isEntitled(ctx context.Context, owner *ent.User, conn Connector, scopes []string) (bool, string) {
	if owner == nil || !r.registry.Enabled(conn.Name) {
		return false, "connector_disabled"
	}
	requiredPlan := conn.RequiredPlan
	for _, scope := range r.registry.definitionsForScopes(conn.Name, scopes) {
		if planRank[scope.RequiredPlan] > planRank[requiredPlan] {
			requiredPlan = scope.RequiredPlan
		}
	}
	if requiredPlan == "" {
		return true, ""
	}
	if _, known := planRank[requiredPlan]; !known {
		return false, "scope_not_in_plan"
	}
	sub, err := r.client.Subscription.Query().Where(subscription.HasUserWith(user.IDEQ(owner.ID))).Only(auth.WithInternal(ctx))
	if err != nil || (sub.Status != "active" && sub.Status != "trialing") {
		return false, "no_subscription"
	}
	if planRank[sub.Plan] < planRank[requiredPlan] {
		return false, "scope_not_in_plan"
	}
	return true, ""
}
