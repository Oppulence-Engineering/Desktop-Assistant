// Package billing serves GET /v1/me, returning the user's plan, status and
// credit usage in the shape the desktop expects.
package billing

import (
	"context"
	"net/http"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/credits"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"go.uber.org/zap"
)

// CacheFunc opts a context into the shared query cache for a TTL (see
// db.DB.Cached). A nil CacheFunc disables caching (passthrough).
type CacheFunc func(context.Context, time.Duration) context.Context

// Handler serves GET /v1/me.
type Handler struct {
	client          *ent.Client
	freeTierCredits int
	cache           CacheFunc
	log             *zap.Logger
}

// New builds the billing handler. cache may be nil (no caching).
func New(client *ent.Client, freeTierCredits int, cache CacheFunc, log *zap.Logger) *Handler {
	if cache == nil {
		cache = func(ctx context.Context, _ time.Duration) context.Context { return ctx }
	}
	return &Handler{client: client, freeTierCredits: freeTierCredits, cache: cache, log: log}
}

// meResponse mirrors the shape parsed by the desktop in
// apps/x/packages/core/src/billing/billing.ts.
type meResponse struct {
	User struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	} `json:"user"`
	Billing struct {
		Plan           *string `json:"plan"`
		Status         *string `json:"status"`
		TrialExpiresAt *string `json:"trialExpiresAt"`
		Usage          struct {
			SanctionedCredits int `json:"sanctionedCredits"`
			AvailableCredits  int `json:"availableCredits"`
		} `json:"usage"`
	} `json:"billing"`
}

// Me handles GET /v1/me. Requires the auth middleware (user in context).
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	ctx := r.Context()

	// The plan/status rarely change → cache the subscription read for 5 min.
	sub, err := h.subscriptionFor(h.cache(ctx, 5*time.Minute), u)
	if err != nil {
		h.log.Error("load subscription", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load billing", "internal_error")
		return
	}
	// Credits must be fresh (no cache) — they change on every metered call.
	available, err := credits.Available(ctx, h.client, sub.SanctionedCredits)
	if err != nil {
		h.log.Error("compute available credits", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load billing", "internal_error")
		return
	}

	var resp meResponse
	resp.User.ID = u.ID.String()
	resp.User.Email = u.Email
	plan, status := string(sub.Plan), string(sub.Status)
	resp.Billing.Plan = &plan
	resp.Billing.Status = &status
	if sub.TrialExpiresAt != nil {
		s := sub.TrialExpiresAt.UTC().Format("2006-01-02T15:04:05.000Z07:00")
		resp.Billing.TrialExpiresAt = &s
	}
	resp.Billing.Usage.SanctionedCredits = sub.SanctionedCredits
	resp.Billing.Usage.AvailableCredits = available

	httpx.WriteJSON(w, http.StatusOK, resp)
}

// subscriptionFor returns the viewer's subscription, defensively minting a
// free-tier one if somehow absent (auth normally mints it on first sight).
func (h *Handler) subscriptionFor(ctx context.Context, u *ent.User) (*ent.Subscription, error) {
	sub, err := h.client.Subscription.Query().Only(ctx)
	if err == nil {
		return sub, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	return h.client.Subscription.Create().
		SetUser(u).
		SetSanctionedCredits(h.freeTierCredits).
		Save(ctx)
}
