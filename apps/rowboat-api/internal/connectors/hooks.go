package connectors

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorauditevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorrevocationjob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthpending"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/predicate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/subscription"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectormetrics"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

var planRank = map[string]int{"free": 0, "starter": 1, "pro": 2, "intelligence": 3}

type preConsentRequest struct {
	Version           int      `json:"version"`
	Challenge         string   `json:"challenge"`
	WorkOSUserID      string   `json:"workos_user_id"`
	HydraClientID     string   `json:"hydra_client_id"`
	RequestedAudience []string `json:"requested_audience"`
	RequestedScopes   []string `json:"requested_scopes"`
}

type consentClientIdentity struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
}

type consentConnectorIdentity struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Audience    string `json:"audience"`
}

type consentScopeDefinition struct {
	Name           string `json:"name"`
	DisplayName    string `json:"display_name"`
	Description    string `json:"description"`
	Tier           string `json:"tier"`
	Required       bool   `json:"required"`
	RequiresStepUp bool   `json:"requires_step_up"`
}

type consentEntitlement struct {
	Allowed      bool   `json:"allowed"`
	Reason       string `json:"reason,omitempty"`
	RequiredPlan string `json:"required_plan,omitempty"`
	UpgradeURL   string `json:"upgrade_url,omitempty"`
	Message      string `json:"message,omitempty"`
}

type preConsentResponse struct {
	RequestID   string                   `json:"request_id"`
	Subject     string                   `json:"subject"`
	Client      consentClientIdentity    `json:"client"`
	Connector   consentConnectorIdentity `json:"connector"`
	Scopes      []consentScopeDefinition `json:"scopes"`
	Entitlement consentEntitlement       `json:"entitlement"`
}

func (h *Handler) localEntitlement(ctx context.Context, owner *ent.User, conn Connector, scopes []string) (bool, string) {
	if owner == nil {
		return false, "no_subscription"
	}
	if !h.registry.Enabled(conn.Name) {
		return false, "connector_disabled"
	}
	requiredPlan := h.requiredPlan(conn, scopes)
	if requiredPlan == "" {
		return true, ""
	}
	if _, known := planRank[requiredPlan]; !known {
		return false, "scope_not_in_plan"
	}
	sub, err := h.client.Subscription.Query().
		Where(subscription.HasUserWith(user.IDEQ(owner.ID))).
		Only(auth.WithInternal(ctx))
	if err != nil {
		return false, "no_subscription"
	}
	if sub.Status != "active" && sub.Status != "trialing" {
		return false, "no_subscription"
	}
	if planRank[sub.Plan] < planRank[requiredPlan] {
		return false, "scope_not_in_plan"
	}
	return true, ""
}

func (h *Handler) isEntitled(ctx context.Context, owner *ent.User, conn Connector, scopes []string) (bool, string) {
	if allowed, reason := h.localEntitlement(ctx, owner, conn, scopes); !allowed {
		return false, reason
	}
	if conn.EntitlementURL == "" {
		return true, ""
	}
	return h.productEntitlement(ctx, owner, conn, scopes)
}

func (h *Handler) requiredPlan(conn Connector, scopes []string) string {
	requiredPlan := conn.RequiredPlan
	for _, scope := range h.registry.definitionsForScopes(conn.Name, scopes) {
		if planRank[scope.RequiredPlan] > planRank[requiredPlan] {
			requiredPlan = scope.RequiredPlan
		}
	}
	return requiredPlan
}

// PreConsent implements the oauth-consent context hook. It binds the Hydra
// challenge and client identity to one unexpired OAuthPending row, returns only
// the exact structured identities/catalog/entitlement contract, and never
// exposes state, PKCE material, tokens, provider responses, or owner metadata.
func (h *Handler) PreConsent(w http.ResponseWriter, r *http.Request) {
	var req preConsentRequest
	if !decodeStrictHookJSON(w, r, &req) {
		return
	}
	if req.Version != 1 || !boundedValue(req.Challenge, 512) || !boundedValue(req.WorkOSUserID, 256) ||
		!boundedValue(req.HydraClientID, 256) || len(req.RequestedAudience) != 1 ||
		!boundedValue(req.RequestedAudience[0], 256) || len(req.RequestedScopes) == 0 || len(req.RequestedScopes) > 100 {
		httpx.Error(w, http.StatusBadRequest, "invalid consent context request", "bad_request")
		return
	}
	if h.cfg.OryBrokerClientID == "" || req.HydraClientID != h.cfg.OryBrokerClientID {
		httpx.Error(w, http.StatusForbidden, "consent client identity mismatch", "identity_mismatch")
		return
	}
	conn, ok := h.resolveConnector("", req.RequestedAudience[0])
	if !ok || conn.AuthType != "oauth" {
		httpx.Error(w, http.StatusBadRequest, "unknown connector audience", "unknown_audience")
		return
	}
	scopes, err := h.registry.validateRequestedScopes(conn.Name, req.RequestedScopes)
	if err != nil || !sameUniqueStringSet(scopes, req.RequestedScopes) {
		httpx.Error(w, http.StatusBadRequest, "unknown or invalid requested scope", "invalid_scope")
		return
	}
	pending, err := h.pendingForConsentContext(r.Context(), req, conn)
	if err != nil {
		httpx.Error(w, http.StatusConflict, "consent context is missing or ambiguous", "consent_context_unavailable")
		return
	}
	owner, err := h.client.User.Query().Where(user.WorkosUserIDEQ(req.WorkOSUserID)).Only(auth.WithInternal(r.Context()))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "consent owner not found", "not_found")
		return
	}
	requestID := pending.ContextRequestID
	if requestID == "" {
		requestID = consentContextRequestID(req.Challenge)
	}
	requestID, err = h.bindConsentPending(r.Context(), pending, req, requestID)
	if err != nil {
		httpx.Error(w, http.StatusConflict, "could not bind consent context", "consent_context_unavailable")
		return
	}

	allowed, reason := h.isEntitled(r.Context(), owner, conn, scopes)
	if pending.OwnerOrgID != "" && owner.WorkosOrgID != pending.OwnerOrgID {
		allowed, reason = false, "org_mismatch"
	}
	entitlement := consentEntitlement{Allowed: allowed, Reason: reason}
	if !allowed && (reason == "no_subscription" || reason == "scope_not_in_plan") {
		if requiredPlan := h.requiredPlan(conn, scopes); requiredPlan != "" {
			entitlement.RequiredPlan = requiredPlan
			entitlement.UpgradeURL = "rowboat://billing"
			entitlement.Message = "This connector requires the " + requiredPlan + " plan."
		}
	}
	definitions := h.registry.definitionsForScopes(conn.Name, scopes)
	responseScopes := make([]consentScopeDefinition, 0, len(definitions))
	for _, scope := range definitions {
		responseScopes = append(responseScopes, consentScopeDefinition{
			Name: scope.Name, DisplayName: scope.DisplayName, Description: scope.Description,
			Tier: scope.Risk, Required: scope.GrantTier == "required", RequiresStepUp: scope.StepUpRequired,
		})
	}
	if len(responseScopes) != len(scopes) {
		httpx.Error(w, http.StatusInternalServerError, "consent scope catalog incomplete", "internal_error")
		return
	}
	decision := "allowed"
	if !allowed {
		decision = reason
	}
	connectormetrics.Consent.WithLabelValues(conn.Name, decision).Inc()
	httpx.WriteJSON(w, http.StatusOK, preConsentResponse{
		RequestID:   requestID,
		Subject:     req.WorkOSUserID,
		Client:      consentClientIdentity{ID: req.HydraClientID, DisplayName: "Rowboat Desktop"},
		Connector:   consentConnectorIdentity{ID: conn.Name, DisplayName: conn.DisplayName, Audience: conn.Audience},
		Scopes:      responseScopes,
		Entitlement: entitlement,
	})
}

func (h *Handler) pendingForConsentContext(ctx context.Context, req preConsentRequest, conn Connector) (*ent.OAuthPending, error) {
	candidates, err := h.client.OAuthPending.Query().Where(
		oauthpending.OwnerWorkosUserIDEQ(req.WorkOSUserID),
		oauthpending.ProviderEQ(conn.Name),
		oauthpending.ExpiresAtGT(time.Now()),
	).All(auth.WithInternal(ctx))
	if err != nil {
		return nil, err
	}
	bound := make([]*ent.OAuthPending, 0, 1)
	unbound := make([]*ent.OAuthPending, 0, 1)
	for _, pending := range candidates {
		if pending.LifecycleStatus != "" && pending.LifecycleStatus != "started" {
			continue
		}
		if pending.HydraClientID != "" && pending.HydraClientID != req.HydraClientID {
			continue
		}
		if !sameUniqueStringSet(pending.RequestedScopes, req.RequestedScopes) {
			continue
		}
		switch pending.ConsentChallenge {
		case req.Challenge:
			bound = append(bound, pending)
		case "":
			unbound = append(unbound, pending)
		}
	}
	if len(bound) == 1 {
		return bound[0], nil
	}
	if len(bound) == 0 && len(unbound) == 1 {
		return unbound[0], nil
	}
	return nil, fmt.Errorf("expected one pending consent context, got %d bound and %d unbound", len(bound), len(unbound))
}

func consentContextRequestID(challenge string) string {
	sum := sha256.Sum256([]byte(challenge))
	return "ctx_" + base64.RawURLEncoding.EncodeToString(sum[:18])
}

func (h *Handler) bindConsentPending(ctx context.Context, pending *ent.OAuthPending, req preConsentRequest, requestID string) (string, error) {
	internal := auth.WithInternal(ctx)
	if pending.ConsentChallenge == "" {
		updated, err := h.client.OAuthPending.Update().Where(
			oauthpending.IDEQ(pending.ID),
			oauthpending.Or(oauthpending.ConsentChallengeIsNil(), oauthpending.ConsentChallengeEQ("")),
		).SetConsentChallenge(req.Challenge).
			SetContextRequestID(requestID).
			SetHydraClientID(req.HydraClientID).
			Save(internal)
		if err == nil && updated == 1 {
			return requestID, nil
		}
		current, loadErr := h.client.OAuthPending.Get(internal, pending.ID)
		if loadErr != nil || current.ConsentChallenge != req.Challenge || current.HydraClientID != req.HydraClientID || current.ContextRequestID == "" {
			return "", fmt.Errorf("pending challenge binding conflict")
		}
		return current.ContextRequestID, nil
	}
	if pending.ConsentChallenge != req.Challenge || (pending.HydraClientID != "" && pending.HydraClientID != req.HydraClientID) {
		return "", fmt.Errorf("pending challenge identity mismatch")
	}
	update := pending.Update()
	changed := false
	if pending.ContextRequestID == "" {
		update.SetContextRequestID(requestID)
		changed = true
	}
	if pending.HydraClientID == "" {
		update.SetHydraClientID(req.HydraClientID)
		changed = true
	}
	if changed {
		if err := update.Exec(internal); err != nil {
			return "", err
		}
	}
	return requestID, nil
}

type consentContextRequest struct {
	State string `json:"state"`
}

// ConsentContext returns the exact structured catalog and owner metadata bound
// to a pending broker state. It is HMAC-only and never returns PKCE or tokens.
func (h *Handler) ConsentContext(w http.ResponseWriter, r *http.Request) {
	var req consentContextRequest
	if !httpx.DecodeJSON(w, r, 1<<16, &req) {
		return
	}
	if strings.TrimSpace(req.State) == "" {
		httpx.Error(w, http.StatusBadRequest, "state is required", "bad_request")
		return
	}
	pending, err := h.client.OAuthPending.Query().Where(oauthpending.StateHashEQ(hashState(req.State))).Only(r.Context())
	if err != nil || time.Now().After(pending.ExpiresAt) {
		httpx.Error(w, http.StatusNotFound, "consent context not found", "not_found")
		return
	}
	conn, ok := h.registry.Get(pending.Provider)
	if !ok || !h.registry.Enabled(conn.Name) {
		httpx.Error(w, http.StatusServiceUnavailable, "connector is disabled", "connector_disabled")
		return
	}
	owner, err := h.client.User.Query().Where(user.WorkosUserIDEQ(pending.OwnerWorkosUserID)).Only(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "consent owner not found", "not_found")
		return
	}
	allowed, reason := h.isEntitled(r.Context(), owner, conn, pending.RequestedScopes)
	h.appendAudit(r.Context(), owner, auditRecord{EventType: "consent_context_read", Connector: conn.Name, Audience: conn.Audience, Requested: pending.RequestedScopes, Reason: reason})
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"connector": conn.Name, "displayName": conn.DisplayName, "audience": conn.Audience,
		"ownerWorkOSUserID": owner.WorkosUserID, "orgID": owner.WorkosOrgID,
		"status": pending.LifecycleStatus, "expiresAt": pending.ExpiresAt.UTC().Format(time.RFC3339),
		"requestedScopes": h.registry.definitionsForScopes(conn.Name, pending.RequestedScopes),
		"entitlement":     map[string]any{"allow": allowed, "reason": reason},
	})
}

type consentAuditRequest struct {
	Version          int             `json:"version"`
	EventID          string          `json:"event_id"`
	Event            string          `json:"event"`
	OccurredAt       string          `json:"occurred_at"`
	ConsentSessionID string          `json:"consent_session_id"`
	ContextRequestID string          `json:"context_request_id"`
	WorkOSUserID     string          `json:"workos_user_id"`
	ClientID         string          `json:"client_id"`
	ConnectorID      string          `json:"connector_id"`
	Audience         string          `json:"audience"`
	Scopes           []string        `json:"scopes"`
	Result           json.RawMessage `json:"result,omitempty"`
}

// AppendConsentAudit durably acknowledges exactly the three oauth-consent
// events. event_id is globally unique and exact replays are idempotent. A replay
// that changes any signed semantic field fails closed.
func (h *Handler) AppendConsentAudit(w http.ResponseWriter, r *http.Request) {
	var req consentAuditRequest
	if !decodeStrictHookJSON(w, r, &req) {
		return
	}
	result, resultOK := auditResult(req.Result)
	allowedEvents := map[string]bool{"consent.shown": true, "consent.granted": true, "consent.denied": true}
	if req.Version != 1 || !allowedEvents[req.Event] || !boundedValue(req.EventID, 256) ||
		!boundedValue(req.ConsentSessionID, 256) || !boundedValue(req.ContextRequestID, 256) ||
		!boundedValue(req.WorkOSUserID, 256) || !boundedValue(req.ClientID, 256) ||
		!boundedValue(req.ConnectorID, 128) || !boundedValue(req.Audience, 256) ||
		len(req.Scopes) == 0 || len(req.Scopes) > 100 || !uniqueBoundedValues(req.Scopes, 256) ||
		!resultOK {
		httpx.Error(w, http.StatusBadRequest, "invalid consent audit event", "bad_request")
		return
	}
	occurredAt, err := time.Parse(time.RFC3339Nano, req.OccurredAt)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid consent audit timestamp", "bad_request")
		return
	}
	if existing, found, err := h.findConsentAudit(r.Context(), req.EventID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not verify consent audit", "internal_error")
		return
	} else if found {
		if !consentAuditMatches(existing, req, occurredAt) {
			httpx.Error(w, http.StatusConflict, "event_id was already used for a different audit event", "event_id_conflict")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"accepted": true})
		return
	}

	pending, err := h.client.OAuthPending.Query().Where(oauthpending.ContextRequestIDEQ(req.ContextRequestID)).Only(auth.WithInternal(r.Context()))
	if err != nil || time.Now().After(pending.ExpiresAt) || pending.ConsentChallenge == "" || pending.HydraClientID == "" {
		httpx.Error(w, http.StatusNotFound, "consent context not found", "not_found")
		return
	}
	conn, ok := h.registry.Get(pending.Provider)
	if !ok || req.WorkOSUserID != pending.OwnerWorkosUserID || req.ClientID != pending.HydraClientID ||
		req.ConnectorID != pending.Provider || req.Audience != conn.Audience {
		httpx.Error(w, http.StatusForbidden, "consent audit identity mismatch", "identity_mismatch")
		return
	}
	if req.Event == "consent.granted" {
		validated, scopeErr := h.registry.validateRequestedScopes(conn.Name, req.Scopes)
		if scopeErr != nil || !sameUniqueStringSet(validated, req.Scopes) || !isSubset(req.Scopes, pending.RequestedScopes) {
			httpx.Error(w, http.StatusBadRequest, "granted scopes exceed the consent request", "scope_escalation")
			return
		}
	} else if !sameUniqueStringSet(req.Scopes, pending.RequestedScopes) {
		httpx.Error(w, http.StatusBadRequest, "audit scopes do not match the consent request", "scope_mismatch")
		return
	}
	owner, err := h.client.User.Query().Where(user.WorkosUserIDEQ(pending.OwnerWorkosUserID)).Only(auth.WithInternal(r.Context()))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "consent owner not found", "not_found")
		return
	}
	record := auditRecord{
		EventType: req.Event, EventID: req.EventID, Connector: req.ConnectorID,
		Audience: req.Audience, Requested: pending.RequestedScopes,
		ConsentSession: req.ConsentSessionID, ContextRequest: req.ContextRequestID,
		Challenge: pending.ConsentChallenge, ClientID: req.ClientID, Result: result, OccurredAt: occurredAt,
	}
	if req.Event == "consent.granted" {
		record.Granted = req.Scopes
	}
	if err := h.persistAudit(r.Context(), owner, record); err != nil {
		if ent.IsConstraintError(err) {
			existing, found, lookupErr := h.findConsentAudit(r.Context(), req.EventID)
			if lookupErr == nil && found && consentAuditMatches(existing, req, occurredAt) {
				httpx.WriteJSON(w, http.StatusOK, map[string]bool{"accepted": true})
				return
			}
			if lookupErr == nil && found {
				httpx.Error(w, http.StatusConflict, "event_id was already used for a different audit event", "event_id_conflict")
				return
			}
		}
		httpx.Error(w, http.StatusInternalServerError, "could not persist consent audit", "internal_error")
		return
	}
	connectormetrics.Consent.WithLabelValues(pending.Provider, req.Event).Inc()
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"accepted": true})
}

func (h *Handler) findConsentAudit(ctx context.Context, eventID string) (*ent.ConnectorAuditEvent, bool, error) {
	event, err := h.client.ConnectorAuditEvent.Query().Where(connectorauditevent.EventIDEQ(eventID)).Only(auth.WithInternal(ctx))
	if ent.IsNotFound(err) {
		return nil, false, nil
	}
	return event, err == nil, err
}

func consentAuditMatches(existing *ent.ConnectorAuditEvent, req consentAuditRequest, occurredAt time.Time) bool {
	if existing == nil || existing.EventID != req.EventID || existing.EventType != req.Event ||
		existing.ConsentSessionID != req.ConsentSessionID || existing.ContextRequestID != req.ContextRequestID ||
		existing.OwnerWorkosUserID != req.WorkOSUserID || existing.ClientID != req.ClientID ||
		existing.Connector != req.ConnectorID || existing.Audience != req.Audience || !existing.OccurredAt.Equal(occurredAt) {
		return false
	}
	result, ok := auditResult(req.Result)
	if !ok {
		return false
	}
	if existing.Result != result {
		return false
	}
	if req.Event == "consent.granted" {
		return sameUniqueStringSet(existing.GrantedScopes, req.Scopes)
	}
	return sameUniqueStringSet(existing.RequestedScopes, req.Scopes)
}

func auditResult(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 {
		return "", true
	}
	var result string
	if err := json.Unmarshal(raw, &result); err != nil || !boundedValue(result, 256) {
		return "", false
	}
	return result, true
}

func decodeStrictHookJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<16)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid hook JSON body", "bad_request")
		return false
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		httpx.Error(w, http.StatusBadRequest, "hook body must contain exactly one JSON document", "bad_request")
		return false
	}
	return true
}

func boundedValue(value string, maxLen int) bool {
	return value != "" && len(value) <= maxLen && value == strings.TrimSpace(value)
}

func uniqueBoundedValues(values []string, maxLen int) bool {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if !boundedValue(value, maxLen) {
			return false
		}
		if _, duplicate := seen[value]; duplicate {
			return false
		}
		seen[value] = struct{}{}
	}
	return true
}

func sameUniqueStringSet(left, right []string) bool {
	if len(left) != len(right) || !uniqueBoundedValues(left, 256) || !uniqueBoundedValues(right, 256) {
		return false
	}
	rightSet := make(map[string]struct{}, len(right))
	for _, value := range right {
		rightSet[value] = struct{}{}
	}
	for _, value := range left {
		if _, ok := rightSet[value]; !ok {
			return false
		}
	}
	return true
}

type invalidateRequest struct {
	ConnectionID string `json:"connection_id"`
	WorkOSUserID string `json:"workos_user_id"`
	OrgID        string `json:"org_id"`
	Connector    string `json:"connector"`
	Reason       string `json:"reason"`
}

// Invalidate supports precise connection, user, org, connector, or combined
// targeting. Every match becomes an invalidated tombstone and retains semantic audit.
func (h *Handler) Invalidate(w http.ResponseWriter, r *http.Request) {
	var req invalidateRequest
	if !httpx.DecodeJSON(w, r, 1<<16, &req) {
		return
	}
	if req.ConnectionID == "" && req.WorkOSUserID == "" && req.OrgID == "" && req.Connector == "" {
		httpx.Error(w, http.StatusBadRequest, "at least one invalidation target is required", "bad_request")
		return
	}
	predicates := make([]predicate.MCPConnection, 0, 3)
	if req.ConnectionID != "" {
		id, err := uuid.Parse(req.ConnectionID)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid connection_id", "bad_request")
			return
		}
		predicates = append(predicates, mcpconnection.IDEQ(id))
	}
	if req.Connector != "" {
		if _, ok := h.registry.Get(req.Connector); !ok {
			httpx.Error(w, http.StatusBadRequest, "unknown connector", "bad_request")
			return
		}
		predicates = append(predicates, mcpconnection.ConnectorEQ(req.Connector))
	}
	userPredicates := make([]predicate.User, 0, 2)
	if req.WorkOSUserID != "" {
		userPredicates = append(userPredicates, user.WorkosUserIDEQ(req.WorkOSUserID))
	}
	if req.OrgID != "" {
		userPredicates = append(userPredicates, user.WorkosOrgIDEQ(req.OrgID))
	}
	if len(userPredicates) > 0 {
		predicates = append(predicates, mcpconnection.HasUserWith(userPredicates...))
	}
	connections, err := h.client.MCPConnection.Query().Where(predicates...).WithUser().All(r.Context())
	if err != nil {
		h.log.Error("load invalidation targets", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not invalidate", "internal_error")
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		reason = "forced_invalidation"
	}
	revoked := 0
	failures := 0
	for _, connection := range connections {
		owner, err := connection.Edges.UserOrErr()
		if err != nil {
			failures++
			continue
		}
		if err := h.revokeConnection(r.Context(), owner, connection, reason, "internal", "invalidated"); err != nil {
			failures++
			continue
		}
		revoked++
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"invalidated": true, "matched": len(connections), "revoked": revoked, "failures": failures})
}

func (h *Handler) revokeConnection(ctx context.Context, owner *ent.User, connection *ent.MCPConnection, reason, actor, finalStatus string) error {
	if connection.Status == "revoked" || connection.Status == "invalidated" {
		return nil
	}
	if finalStatus != "revoked" && finalStatus != "invalidated" {
		return fmt.Errorf("unsupported connector terminal status %q", finalStatus)
	}
	now := time.Now().UTC()
	if err := connection.Update().SetStatus("revoking").SetRevocationAttemptedAt(now).Exec(auth.WithUser(ctx, owner)); err != nil {
		return fmt.Errorf("mark connector revoking: %w", err)
	}
	providerRevoked := true
	var revocationCredential []byte
	if len(connection.RefreshTokenEncrypted) > 0 {
		revocationCredential = append([]byte(nil), connection.RefreshTokenEncrypted...)
		refresh, err := h.sealer.Open(connection.RefreshTokenEncrypted)
		if err != nil || h.ory.revoke(ctx, string(refresh)) != nil {
			providerRevoked = false
		}
	}
	if !providerRevoked && len(revocationCredential) > 0 {
		_, err := h.client.ConnectorRevocationJob.Create().
			SetConnectionID(connection.ID).
			SetOwnerID(owner.ID).
			SetConnector(connection.Connector).
			SetRefreshTokenEncrypted(revocationCredential).
			SetStatus("pending").
			SetNextAttemptAt(now).
			OnConflictColumns(connectorrevocationjob.FieldConnectionID).
			UpdateNewValues().
			ID(auth.WithInternal(ctx))
		if err != nil {
			return fmt.Errorf("enqueue connector revocation: %w", err)
		}
	}
	update := connection.Update().
		SetStatus(finalStatus).
		SetRevokedAt(now).
		SetRevokedReason(reason).
		SetRevokedBy(actor).
		SetRevocationAttemptedAt(now).
		SetRevocationSucceeded(providerRevoked).
		ClearRefreshTokenEncrypted().
		ClearAPIKeyEncrypted()
	if err := update.Exec(auth.WithUser(ctx, owner)); err != nil {
		return fmt.Errorf("persist connector tombstone: %w", err)
	}
	outcome := "success"
	if !providerRevoked {
		outcome = "provider_failed"
	}
	connectormetrics.Revocation.WithLabelValues(connection.Connector, outcome).Inc()
	h.appendAudit(ctx, owner, auditRecord{EventType: "connection_" + finalStatus, Connector: connection.Connector, ConnectionID: connection.ID, Audience: connection.Audience, Granted: connection.Scopes, Reason: reason, Metadata: map[string]any{"providerRevoked": providerRevoked, "actor": actor}})
	return nil
}

// ProcessRevocationJobs retries the MCPConnection-backed durable revocation
// outbox. Failed upstream attempts retain only the sealed credential while the
// connection remains locally disabled. Success erases it permanently.
func (h *Handler) ProcessRevocationJobs(ctx context.Context, limit int) (int, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	jobs, err := h.client.ConnectorRevocationJob.Query().Where(
		connectorrevocationjob.StatusEQ("pending"),
		connectorrevocationjob.NextAttemptAtLTE(time.Now().UTC()),
	).Order(ent.Asc(connectorrevocationjob.FieldNextAttemptAt)).Limit(limit).All(auth.WithInternal(ctx))
	if err != nil {
		return 0, err
	}
	completed := 0
	for _, job := range jobs {
		owner, ownerErr := h.client.User.Get(auth.WithInternal(ctx), job.OwnerID)
		if ownerErr != nil {
			continue
		}
		plain, openErr := h.sealer.Open(job.RefreshTokenEncrypted)
		if openErr != nil {
			continue
		}
		now := time.Now().UTC()
		if revokeErr := h.ory.revoke(ctx, string(plain)); revokeErr != nil {
			delay := time.Duration(min(job.Attempts+1, 8)) * time.Minute
			_ = job.Update().AddAttempts(1).SetLastError("provider_revoke_failed").SetNextAttemptAt(now.Add(delay)).Exec(auth.WithInternal(ctx))
			continue
		}
		if updateErr := h.client.ConnectorRevocationJob.DeleteOne(job).Exec(auth.WithInternal(ctx)); updateErr == nil {
			completed++
			_ = h.client.MCPConnection.UpdateOneID(job.ConnectionID).SetRevocationSucceeded(true).SetRevocationAttemptedAt(now).Exec(auth.WithUser(ctx, owner))
			h.appendAudit(ctx, owner, auditRecord{EventType: "connection_revocation_completed", Connector: job.Connector, ConnectionID: job.ConnectionID, Result: "retry_success"})
		}
	}
	return completed, nil
}

// RunRevocationWorker continuously drains the durable connection-backed outbox.
func (h *Handler) RunRevocationWorker(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		if _, err := h.ProcessRevocationJobs(ctx, 25); err != nil && ctx.Err() == nil {
			h.log.Warn("process connector revocation jobs", zap.Error(err))
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (h *Handler) resolveConnector(name, audience string) (Connector, bool) {
	if name != "" {
		if c, ok := h.registry.Get(name); ok {
			return c, true
		}
	}
	if audience != "" {
		for _, c := range h.registry.List() {
			if c.Audience == audience {
				return c, true
			}
		}
	}
	return Connector{}, false
}
