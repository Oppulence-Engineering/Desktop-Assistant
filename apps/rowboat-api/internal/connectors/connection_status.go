package connectors

import (
	"net/http"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorauditevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/google/uuid"
)

// connectionStatusRequest is the complete immutable binding a product resource
// server extracted from one verified connector resource token. The broker does
// not accept a partial selector because doing so would let a stale or confused
// product validate a different live grant.
type connectionStatusRequest struct {
	TokenID              string `json:"jti"`
	ConnectionID         string `json:"connection_id"`
	WorkOSUserID         string `json:"workos_user_id"`
	OrganizationID       string `json:"organization_id"`
	Connector            string `json:"connector"`
	CredentialGeneration int64  `json:"credential_generation"`
	Audience             string `json:"audience"`
}

// ConnectionStatus is the authenticated, fail-closed online introspection
// endpoint used by product resource servers on every request. A syntactically
// valid but stale token receives active=false rather than learning which binding
// failed. Authentication, malformed input, storage failure, and entitlement
// verifier failure never produce active=true.
func (h *Handler) ConnectionStatus(w http.ResponseWriter, r *http.Request) {
	var req connectionStatusRequest
	if !httpx.DecodeJSON(w, r, 1<<16, &req) {
		return
	}
	req.TokenID = strings.TrimSpace(req.TokenID)
	req.ConnectionID = strings.TrimSpace(req.ConnectionID)
	req.WorkOSUserID = strings.TrimSpace(req.WorkOSUserID)
	req.OrganizationID = strings.TrimSpace(req.OrganizationID)
	req.Connector = strings.TrimSpace(req.Connector)
	req.Audience = strings.TrimSpace(req.Audience)
	connectionID, err := uuid.Parse(req.ConnectionID)
	if err != nil || req.TokenID == "" || req.WorkOSUserID == "" || req.OrganizationID == "" || req.Connector == "" || req.Audience == "" || req.CredentialGeneration <= 0 {
		httpx.Error(w, http.StatusBadRequest, "complete connector token binding is required", "bad_request")
		return
	}
	actor, ok := auth.ActorFromCtx(r.Context())
	if !ok || actor.Kind != auth.KindService || !actor.AllowsConnector(req.Connector) {
		httpx.Error(w, http.StatusForbidden, "product service principal is not authorized for connector status", "forbidden")
		return
	}
	connector, ok := h.registry.Get(req.Connector)
	if !ok {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"active": false})
		return
	}
	denied, guardErr := h.refreshFailures.denied(r.Context(), req.ConnectionID, req.CredentialGeneration)
	if guardErr != nil {
		h.log.Error("load connector refresh failure guard")
		httpx.Error(w, http.StatusServiceUnavailable, "connection status unavailable", "status_unavailable")
		return
	}
	if denied {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"active": false})
		return
	}

	ctx := auth.WithInternal(r.Context())
	connection, err := h.client.MCPConnection.Query().Where(
		mcpconnection.IDEQ(connectionID),
		mcpconnection.ConnectorEQ(req.Connector),
		mcpconnection.AudienceEQ(req.Audience),
		mcpconnection.OrganizationIDEQ(req.OrganizationID),
		mcpconnection.CredentialGenerationEQ(req.CredentialGeneration),
		mcpconnection.StatusEQ("active"),
		mcpconnection.HasUserWith(user.WorkosUserIDEQ(req.WorkOSUserID)),
	).WithUser().Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"active": false})
			return
		}
		h.log.Error("load live connector status")
		httpx.Error(w, http.StatusServiceUnavailable, "connection status unavailable", "status_unavailable")
		return
	}

	minted, err := h.client.ConnectorAuditEvent.Query().Where(
		connectorauditevent.EventTypeEQ("token_minted"),
		connectorauditevent.EventIDEQ(deterministicAuditEventID("token_minted", req.TokenID)),
		connectorauditevent.ConnectorEQ(req.Connector),
		connectorauditevent.ConnectionIDEQ(connectionID),
		connectorauditevent.OwnerWorkosUserIDEQ(req.WorkOSUserID),
		connectorauditevent.OrgIDEQ(req.OrganizationID),
		connectorauditevent.AudienceEQ(req.Audience),
	).Exist(ctx)
	if err != nil {
		h.log.Error("load connector token issuance status")
		httpx.Error(w, http.StatusServiceUnavailable, "connection status unavailable", "status_unavailable")
		return
	}
	if !minted {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"active": false})
		return
	}
	owner, err := connection.Edges.UserOrErr()
	if err != nil {
		httpx.Error(w, http.StatusServiceUnavailable, "connection status unavailable", "status_unavailable")
		return
	}
	if connectorOrganizationID(owner) != connection.OrganizationID {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"active": false})
		return
	}
	allowed, _ := NewEntitlementService(h.client, h.registry).Check(r.Context(), owner, connection.OrganizationID, connector, connection.Scopes)
	if !allowed {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"active": false})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"active": true})
}
