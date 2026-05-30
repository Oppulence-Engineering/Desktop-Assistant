package connectors

import (
	"net/http"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"go.uber.org/zap"
)

// planRank orders plans for entitlement comparison.
var planRank = map[string]int{"free": 0, "starter": 1, "pro": 2}

type preConsentRequest struct {
	WorkOSUserID string `json:"workos_user_id"`
	Subject      string `json:"subject"`
	Connector    string `json:"connector"`
	Audience     string `json:"requested_audience"`
}

type upsell struct {
	RequiredPlan string `json:"requiredPlan"`
	Message      string `json:"message"`
}

// PreConsent handles POST /oauth-hooks/pre-consent. Mounted behind the HMAC
// middleware (which marks the request internal). It decides whether the user is
// entitled to connect the requested product, returning allow/upsell. The exact
// payload is mapped from Ory's consent hook in ops (CONNECTOR_SUITE.md §12).
func (h *Handler) PreConsent(w http.ResponseWriter, r *http.Request) {
	var req preConsentRequest
	if err := limitedJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid body", "bad_request")
		return
	}
	workosID := req.WorkOSUserID
	if workosID == "" {
		workosID = req.Subject
	}

	conn, ok := h.resolveConnector(req.Connector, req.Audience)
	if !ok {
		// Unknown connector → nothing to gate; allow.
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"allow": true})
		return
	}
	if conn.RequiredPlan == "" {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"allow": true})
		return
	}

	ctx := r.Context() // internal caller (set by HMAC middleware)
	u, err := h.client.User.Query().Where(user.WorkosUserIDEQ(workosID)).Only(ctx)
	if err != nil {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"allow":  false,
			"upsell": upsell{RequiredPlan: conn.RequiredPlan, Message: "Sign in required"},
		})
		return
	}
	sub, err := h.client.Subscription.Query().Only(auth.WithUser(ctx, u))
	plan := "free"
	if err == nil {
		plan = string(sub.Plan)
	}
	if planRank[plan] >= planRank[conn.RequiredPlan] {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"allow": true})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"allow": false,
		"upsell": upsell{
			RequiredPlan: conn.RequiredPlan,
			Message:      "Upgrade to " + conn.RequiredPlan + " to connect " + conn.DisplayName,
		},
	})
}

type invalidateRequest struct {
	WorkOSUserID string `json:"workos_user_id"`
	Connector    string `json:"connector"`
}

// Invalidate handles POST /v1/internal/connections/invalidate. Mounted behind
// the internal-secret middleware; products call it to force-disconnect a user.
func (h *Handler) Invalidate(w http.ResponseWriter, r *http.Request) {
	var req invalidateRequest
	if err := limitedJSON(r, &req); err != nil || req.WorkOSUserID == "" || req.Connector == "" {
		httpx.Error(w, http.StatusBadRequest, "missing workos_user_id or connector", "bad_request")
		return
	}
	ctx := r.Context()
	u, err := h.client.User.Query().Where(user.WorkosUserIDEQ(req.WorkOSUserID)).Only(ctx)
	if err != nil {
		// Unknown user → nothing to do; treat as success (idempotent).
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"invalidated": true})
		return
	}
	n, err := h.client.MCPConnection.Delete().
		Where(mcpconnection.ConnectorEQ(req.Connector), mcpconnection.HasUserWith(user.IDEQ(u.ID))).
		Exec(auth.WithUser(ctx, u))
	if err != nil {
		h.log.Error("invalidate connection", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not invalidate", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"invalidated": true, "deleted": n})
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
