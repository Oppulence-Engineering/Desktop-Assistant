package connectors

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorcredentialcleanupjob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/subscription"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// EntitlementService applies the registry kill switch and the product-owned
// entitlement decision used immediately before worker resource-token minting.
// Authoritative connectors use the exact signed HTTP transport shared with the
// public broker. The subscription fallback exists only for registries that do
// not require a product-authoritative endpoint.
type EntitlementService struct {
	client   *ent.Client
	registry *Registry
}

// NewEntitlementService builds the shared connector entitlement checker.
func NewEntitlementService(client *ent.Client, registry *Registry) *EntitlementService {
	return &EntitlementService{client: client, registry: registry}
}

// Check returns the authoritative allow/deny decision and normalized reason.
func (s *EntitlementService) Check(ctx context.Context, owner *ent.User, organizationID string, conn Connector, scopes []string) (bool, string) {
	if s == nil || s.client == nil || s.registry == nil || owner == nil || !s.registry.Enabled(conn.Name) {
		return false, "connector_disabled"
	}
	if organizationID == "" || connectorOrganizationID(owner) != organizationID {
		return false, "org_mismatch"
	}
	if conn.EntitlementURL != "" {
		return authoritativeProductEntitlement(ctx, owner, organizationID, conn, scopes)
	}
	requiredPlan := conn.RequiredPlan
	for _, scope := range s.registry.definitionsForScopes(conn.Name, scopes) {
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
	sub, err := s.client.Subscription.Query().Where(subscription.HasUserWith(user.IDEQ(owner.ID))).Only(auth.WithInternal(ctx))
	if err != nil || (sub.Status != "active" && sub.Status != "trialing") {
		return false, "no_subscription"
	}
	if planRank[sub.Plan] < planRank[requiredPlan] {
		return false, "scope_not_in_plan"
	}
	return true, ""
}

// LifecycleService owns worker-side credential fencing, terminal refresh
// transitions, final mint revalidation, and durable broker-equivalent audits.
type LifecycleService struct {
	client       *ent.Client
	sealer       *crypto.Sealer
	registry     *Registry
	entitlements *EntitlementService
	issuer       ResourceTokenIssuer
	ory          *oryClient
	log          *zap.Logger
}

// NewLifecycleService builds worker-side lifecycle enforcement with the same
// persistence and provider clients as the HTTP broker.
func NewLifecycleService(client *ent.Client, sealer *crypto.Sealer, registry *Registry, ory *oryClient) *LifecycleService {
	return &LifecycleService{
		client: client, sealer: sealer, registry: registry, ory: ory,
		entitlements: NewEntitlementService(client, registry),
	}
}

// SetIssuer installs the deployment's connector resource-token signer.
func (s *LifecycleService) SetIssuer(issuer ResourceTokenIssuer) { s.issuer = issuer }

// SetLogger installs the worker logger used by shared broker lifecycle paths.
func (s *LifecycleService) SetLogger(log *zap.Logger) { s.log = log }

// CheckEntitlement evaluates the current registry and product entitlement.
func (s *LifecycleService) CheckEntitlement(ctx context.Context, owner *ent.User, organizationID string, conn Connector, scopes []string) (bool, string) {
	return s.entitlements.Check(ctx, owner, organizationID, conn, scopes)
}

// PersistRefresh commits a rotated credential only while the exact generation,
// active status, immutable organization, and owner still match. The refresh and
// its durable lifecycle audit share one transaction.
func (s *LifecycleService) PersistRefresh(ctx context.Context, owner *ent.User, previous *ent.MCPConnection, tok *oryToken, cleanupID uuid.UUID) (*ent.MCPConnection, error) {
	if s == nil || s.client == nil || s.sealer == nil || owner == nil || previous == nil || tok == nil {
		return nil, errors.New("connector lifecycle refresh is not configured")
	}
	tx, err := s.client.Tx(auth.WithUser(ctx, owner))
	if err != nil {
		return nil, fmt.Errorf("begin connector refresh transaction: %w", err)
	}
	rollback := true
	defer func() {
		if rollback {
			_ = tx.Rollback()
		}
	}()

	update := tx.MCPConnection.UpdateOneID(previous.ID).Where(
		mcpconnection.CredentialGenerationEQ(previous.CredentialGeneration),
		mcpconnection.StatusEQ("active"),
		mcpconnection.OrganizationIDEQ(previous.OrganizationID),
		mcpconnection.HasUserWith(user.IDEQ(owner.ID)),
	).SetLastUsedAt(time.Now().UTC())
	newGeneration := previous.CredentialGeneration
	if tok.RefreshToken != "" {
		sealed, sealErr := s.sealer.SealString(tok.RefreshToken)
		if sealErr != nil {
			return nil, fmt.Errorf("seal rotated connector refresh token: %w", sealErr)
		}
		update.SetRefreshTokenEncrypted(sealed).AddCredentialGeneration(1)
		newGeneration++
	}
	updated, err := update.Save(auth.WithUser(ctx, owner))
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, errConnectorCredentialSuperseded
		}
		return nil, fmt.Errorf("persist rotated connector refresh token: %w", err)
	}
	if cleanupID != uuid.Nil {
		deleted, err := tx.ConnectorCredentialCleanupJob.Delete().Where(
			connectorcredentialcleanupjob.IDEQ(cleanupID),
			connectorcredentialcleanupjob.StatusEQ("pending"),
		).Exec(auth.WithInternal(ctx))
		if err != nil {
			return nil, fmt.Errorf("adopt rotated connector credential: %w", err)
		}
		if deleted != 1 {
			return nil, errConnectorCredentialSuperseded
		}
	}
	if err := persistAuditTransitionWithClient(ctx, tx.Client(), owner, auditRecord{
		EventType: "token_refresh_committed",
		EventID: deterministicAuditEventID("token_refresh_committed", previous.ID.String(),
			fmt.Sprint(previous.CredentialGeneration), fmt.Sprint(newGeneration), hashState(tok.AccessToken)),
		Connector: previous.Connector, ConnectionID: previous.ID, OrganizationID: previous.OrganizationID,
		Audience: previous.Audience, Granted: previous.Scopes,
	}); err != nil {
		return nil, fmt.Errorf("persist connector refresh audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit connector refresh: %w", err)
	}
	rollback = false
	return updated, nil
}

// HandleRefreshFailure changes only the generation that attempted the refresh.
// A stale replica therefore cannot poison a reconnect or a concurrently rotated
// credential. Refresh-family invalidation clears the entire local family and
// emits the same connection_invalidated semantic projections as the HTTP broker.
func (s *LifecycleService) HandleRefreshFailure(ctx context.Context, owner *ent.User, previous *ent.MCPConnection, refreshErr error) error {
	if s == nil || s.client == nil || owner == nil || previous == nil {
		return errors.New("connector lifecycle failure handling is not configured")
	}
	status := "error"
	eventType := "connection_refresh_failed"
	reason := "upstream_error"
	terminal := false
	switch {
	case isRefreshFamilyInvalidation(refreshErr):
		status = "invalidated"
		eventType = "connection_invalidated"
		reason = "refresh_token_reuse"
		terminal = true
	case isOAuthErrorCode(refreshErr, "invalid_grant"):
		status = "reauth_required"
		eventType = "connection_reauth_required"
		reason = "invalid_grant"
	}

	tx, err := s.client.Tx(auth.WithUser(ctx, owner))
	if err != nil {
		return fmt.Errorf("begin connector refresh failure transaction: %w", err)
	}
	rollback := true
	defer func() {
		if rollback {
			_ = tx.Rollback()
		}
	}()
	update := tx.MCPConnection.UpdateOneID(previous.ID).Where(
		mcpconnection.CredentialGenerationEQ(previous.CredentialGeneration),
		mcpconnection.StatusEQ("active"),
		mcpconnection.OrganizationIDEQ(previous.OrganizationID),
		mcpconnection.HasUserWith(user.IDEQ(owner.ID)),
	).SetStatus(status)
	newGeneration := previous.CredentialGeneration
	if terminal {
		now := time.Now().UTC()
		update.AddCredentialGeneration(1).SetRevokedAt(now).SetRevokedReason(reason).SetRevokedBy("provider").
			SetRevocationAttemptedAt(now).SetRevocationSucceeded(true).ClearRefreshTokenEncrypted().ClearAPIKeyEncrypted()
		newGeneration++
	} else if status == "reauth_required" {
		update.ClearRefreshTokenEncrypted()
	}
	updated, err := update.Save(auth.WithUser(ctx, owner))
	if err != nil {
		if ent.IsNotFound(err) {
			return errConnectorCredentialSuperseded
		}
		return fmt.Errorf("persist connector refresh failure: %w", err)
	}
	if err := persistAuditTransitionWithClient(ctx, tx.Client(), owner, auditRecord{
		EventType: eventType,
		EventID:   deterministicAuditEventID(eventType, previous.ID.String(), fmt.Sprint(previous.CredentialGeneration), fmt.Sprint(newGeneration), reason),
		Connector: previous.Connector, ConnectionID: previous.ID, OrganizationID: previous.OrganizationID,
		Audience: previous.Audience, Granted: previous.Scopes, Reason: reason,
		Result: map[bool]string{true: "credential_family_invalidated", false: ""}[terminal],
	}); err != nil {
		return fmt.Errorf("persist connector refresh failure audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit connector refresh failure: %w", err)
	}
	rollback = false
	_ = updated
	return nil
}

// Mint re-reads the authoritative row immediately before signing. It rejects
// stale organization, status, audience, generation, or scope snapshots, then
// repeats product entitlement against the current grant. A conditional touch is
// the lifecycle linearization point used by multi-replica invalidation races.
func (s *LifecycleService) Mint(ctx context.Context, owner *ent.User, conn Connector, expected *ent.MCPConnection, requestedScopes []string) (string, error) {
	result, err := s.MintResourceToken(ctx, owner, conn, expected, requestedScopes)
	if err != nil {
		return "", err
	}
	return result.Token, nil
}

// MintedResourceToken is the complete broker signing result. HTTP and worker
// callers share MintResourceToken so neither can bypass the post-entitlement
// lifecycle linearization fence.
type MintedResourceToken struct {
	Token     string
	ExpiresAt time.Time
	Scopes    []string
	Current   *ent.MCPConnection
}

// MintResourceToken performs the authoritative final lifecycle check and signs
// only after the conditional generation/status fence wins.
func (s *LifecycleService) MintResourceToken(ctx context.Context, owner *ent.User, conn Connector, expected *ent.MCPConnection, requestedScopes []string) (*MintedResourceToken, error) {
	if s == nil || s.client == nil || s.registry == nil || s.issuer == nil || owner == nil || expected == nil {
		return nil, errors.New("connector resource token issuer not configured")
	}
	orgID := connectorOrganizationID(owner)
	if orgID == "" || expected.OrganizationID != orgID {
		return nil, fmt.Errorf("connector %q organization mismatch", conn.Name)
	}
	current, err := s.client.MCPConnection.Query().Where(
		mcpconnection.IDEQ(expected.ID),
		mcpconnection.ConnectorEQ(conn.Name),
		mcpconnection.OrganizationIDEQ(orgID),
		mcpconnection.StatusEQ("active"),
		mcpconnection.CredentialGenerationEQ(expected.CredentialGeneration),
		mcpconnection.HasUserWith(user.IDEQ(owner.ID)),
	).Only(auth.WithInternal(ctx))
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, errConnectorCredentialSuperseded
		}
		return nil, fmt.Errorf("reload connector before mint: %w", err)
	}
	if current.Audience != conn.Audience || !slices.Equal(current.Scopes, expected.Scopes) {
		return nil, errConnectorCredentialSuperseded
	}
	validated, err := s.registry.validateRequestedScopes(conn.Name, requestedScopes)
	if err != nil || !isSubset(validated, current.Scopes) {
		return nil, fmt.Errorf("connector %q scopes changed before mint", conn.Name)
	}
	if allowed, reason := s.entitlements.Check(ctx, owner, current.OrganizationID, conn, validated); !allowed {
		if reason != "entitlement_unavailable" {
			_ = s.invalidateEntitlementDenied(context.WithoutCancel(ctx), owner, current, reason)
		} else {
			_ = persistAuditTransitionWithClient(context.WithoutCancel(ctx), s.client, owner, auditRecord{
				EventType: "token_mint_rejected",
				EventID:   deterministicAuditEventID("token_mint_rejected", current.ID.String(), fmt.Sprint(current.CredentialGeneration), reason),
				Connector: conn.Name, ConnectionID: current.ID, OrganizationID: current.OrganizationID,
				Audience: current.Audience, Requested: validated, Granted: current.Scopes, Reason: reason,
			})
		}
		return nil, fmt.Errorf("connector %q entitlement denied: %s", conn.Name, reason)
	}

	// Re-read after the outbound entitlement call so an organization, audience,
	// scope, status, or generation change that won while the product decided is
	// observed before signing.
	currentAfterEntitlement, err := s.client.MCPConnection.Query().Where(
		mcpconnection.IDEQ(current.ID),
		mcpconnection.ConnectorEQ(conn.Name),
		mcpconnection.OrganizationIDEQ(orgID),
		mcpconnection.StatusEQ("active"),
		mcpconnection.CredentialGenerationEQ(current.CredentialGeneration),
		mcpconnection.HasUserWith(user.IDEQ(owner.ID)),
	).Only(auth.WithInternal(ctx))
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, errConnectorCredentialSuperseded
		}
		return nil, fmt.Errorf("reload connector after entitlement: %w", err)
	}
	if currentAfterEntitlement.Audience != current.Audience || !slices.Equal(currentAfterEntitlement.Scopes, current.Scopes) {
		return nil, errConnectorCredentialSuperseded
	}
	current = currentAfterEntitlement

	// Fence once more after the re-read. Lifecycle writers advance credential
	// generation, so a revocation or replacement that wins now makes this update
	// miss before signing.
	if err := current.Update().Where(
		mcpconnection.CredentialGenerationEQ(current.CredentialGeneration),
		mcpconnection.StatusEQ("active"),
		mcpconnection.OrganizationIDEQ(orgID),
		mcpconnection.HasUserWith(user.IDEQ(owner.ID)),
	).SetLastUsedAt(time.Now().UTC()).Exec(auth.WithInternal(ctx)); err != nil {
		if ent.IsNotFound(err) {
			return nil, errConnectorCredentialSuperseded
		}
		return nil, fmt.Errorf("fence connector before mint: %w", err)
	}

	tokenID := uuid.NewString()
	token, expiresAt, err := s.issuer.Mint(ResourceTokenClaims{
		TokenID: tokenID, UserID: owner.WorkosUserID, OrganizationID: current.OrganizationID,
		ConnectionID: current.ID.String(), ConnectorID: conn.Name, CredentialGeneration: current.CredentialGeneration,
		Audience: current.Audience, Scopes: validated, TrustTier: trustTierForScopes(s.registry, conn.Name, validated),
	})
	if err != nil {
		return nil, fmt.Errorf("mint connector %q resource token: %w", conn.Name, err)
	}
	if err := persistAuditTransitionWithClient(ctx, s.client, owner, auditRecord{
		EventType: "token_minted", EventID: deterministicAuditEventID("token_minted", tokenID),
		Connector: conn.Name, ConnectionID: current.ID, OrganizationID: current.OrganizationID,
		Audience: current.Audience, Requested: validated, Granted: current.Scopes,
	}); err != nil {
		return nil, fmt.Errorf("persist connector token audit: %w", err)
	}
	return &MintedResourceToken{Token: token, ExpiresAt: expiresAt, Scopes: validated, Current: current}, nil
}

func (s *LifecycleService) invalidateEntitlementDenied(ctx context.Context, owner *ent.User, current *ent.MCPConnection, reason string) error {
	if err := persistAuditTransitionWithClient(ctx, s.client, owner, auditRecord{
		EventType: "token_mint_rejected",
		EventID:   deterministicAuditEventID("token_mint_rejected", current.ID.String(), fmt.Sprint(current.CredentialGeneration), reason),
		Connector: current.Connector, ConnectionID: current.ID, OrganizationID: current.OrganizationID,
		Audience: current.Audience, Requested: current.Scopes, Granted: current.Scopes, Reason: reason,
	}); err != nil {
		return err
	}
	brokerLifecycle := &Handler{
		client: s.client, sealer: s.sealer, registry: s.registry,
		ory: s.ory, log: s.log,
	}
	return brokerLifecycle.revokeConnection(ctx, owner, current, reason, "entitlement", "invalidated")
}

func providerGrantMatches(registry *Registry, connector string, requested []string, raw string) bool {
	granted := strings.Fields(raw)
	// RFC 6749 permits omission when the granted scope is unchanged.
	if len(granted) == 0 {
		granted = append([]string(nil), requested...)
	}
	// The provider credential is never returned to the task or product server.
	// The worker mints only the currently persisted requested scopes, so an
	// upstream superset cannot widen the broker token. Every persisted scope must
	// still be present, including all required scopes.
	for _, scope := range requested {
		if !slices.Contains(granted, scope) {
			return false
		}
	}
	for _, def := range registry.definitionsForScopes(connector, requested) {
		if def.GrantTier == "required" && !slices.Contains(granted, def.Name) {
			return false
		}
	}
	return true
}
