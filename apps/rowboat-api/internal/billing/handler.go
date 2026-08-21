// Package billing serves GET /v1/me, returning the user's plan, status and
// credit usage in the shape the desktop expects.
package billing

import (
	"context"
	"net/http"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/creditledger"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/credits"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// CacheFunc opts a context into the shared query cache for a TTL (see
// db.DB.Cached). A nil CacheFunc disables caching (passthrough).
type CacheFunc func(context.Context, time.Duration) context.Context

// Handler serves GET /v1/me.
type Handler struct {
	client           *ent.Client
	freeTierCredits  int
	dailyCreditLimit int // 0 → no daily spend cap modeled
	cache            CacheFunc
	log              *zap.Logger
	stripe           StripeConfig
	stripeHTTP       *http.Client
}

// New builds the billing handler. cache may be nil (no caching). dailyCreditLimit
// mirrors the cap the quota gate enforces (0 disables it) so the reported
// "available today" figure agrees with what can actually be spent.
func New(client *ent.Client, freeTierCredits, dailyCreditLimit int, cache CacheFunc, log *zap.Logger) *Handler {
	if cache == nil {
		cache = func(ctx context.Context, _ time.Duration) context.Context { return ctx }
	}
	return &Handler{client: client, freeTierCredits: freeTierCredits, dailyCreditLimit: dailyCreditLimit, cache: cache, log: log}
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
			UsedCredits       int `json:"usedCredits"`
			AvailableCredits  int `json:"availableCredits"`
			Monthly           struct {
				SanctionedCredits int `json:"sanctionedCredits"`
				UsedCredits       int `json:"usedCredits"`
				AvailableCredits  int `json:"availableCredits"`
			} `json:"monthly"`
			Daily struct {
				SanctionedCredits int    `json:"sanctionedCredits"`
				UsedCredits       int    `json:"usedCredits"`
				AvailableCredits  int    `json:"availableCredits"`
				UsageDay          string `json:"usageDay"`
			} `json:"daily"`
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

	// Plan/status can change from Stripe webhooks while the desktop is open, so
	// this read stays fresh. Credit usage is also uncached below.
	sub, err := h.subscriptionFor(ctx, u)
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
	used := sub.SanctionedCredits - available
	if used < 0 {
		used = 0
	}
	now := time.Now().UTC()
	usageDay := now.Format("2006-01-02")
	dailyUsed, err := h.usedSince(ctx, time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC))
	if err != nil {
		h.log.Error("compute daily credits", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load billing", "internal_error")
		return
	}
	// Month-to-date usage = credits consumed since the start of the current UTC
	// month. Previously the "monthly" figures surfaced the all-time ledger total.
	monthlyUsed, err := h.usedSince(ctx, time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		h.log.Error("compute monthly credits", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load billing", "internal_error")
		return
	}
	// dailyAvailable = how much can still be spent today. Base it on the actual
	// remaining balance: the old `sanctioned - dailyUsed` subtracted only today's
	// usage from the full grant, ignoring prior-day consumption and overstating
	// remaining credits. When a daily cap is configured, also clamp to the unused
	// portion of today's cap (matching the quota gate).
	dailyAvailable := available
	if h.dailyCreditLimit > 0 {
		if remainingToday := h.dailyCreditLimit - dailyUsed; remainingToday < dailyAvailable {
			dailyAvailable = remainingToday
		}
	}
	if dailyAvailable < 0 {
		dailyAvailable = 0
	}

	var resp meResponse
	resp.User.ID = u.ID.String()
	resp.User.Email = u.Email
	plan, status := sub.Plan, sub.Status
	resp.Billing.Plan = &plan
	resp.Billing.Status = &status
	if sub.TrialExpiresAt != nil {
		s := sub.TrialExpiresAt.UTC().Format("2006-01-02T15:04:05.000Z07:00")
		resp.Billing.TrialExpiresAt = &s
	}
	resp.Billing.Usage.SanctionedCredits = sub.SanctionedCredits
	resp.Billing.Usage.UsedCredits = used
	resp.Billing.Usage.AvailableCredits = available
	resp.Billing.Usage.Monthly.SanctionedCredits = sub.SanctionedCredits
	resp.Billing.Usage.Monthly.UsedCredits = monthlyUsed
	// AvailableCredits mirrors the overall available balance: the data model has
	// a single sanctioned_credits balance with no monthly grant/reset, so monthly
	// grants are not yet modeled. Revisit once a per-month allotment exists.
	resp.Billing.Usage.Monthly.AvailableCredits = available
	resp.Billing.Usage.Daily.SanctionedCredits = sub.SanctionedCredits
	resp.Billing.Usage.Daily.UsedCredits = dailyUsed
	resp.Billing.Usage.Daily.AvailableCredits = dailyAvailable
	resp.Billing.Usage.Daily.UsageDay = usageDay

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
	sub, err = h.client.Subscription.Create().
		SetUser(u).
		SetSanctionedCredits(h.freeTierCredits).
		Save(ctx)
	if err != nil {
		// Lost the concurrent first-sight race against the one-subscription-per-
		// user index → the row now exists; re-query it instead of surfacing the
		// unique-index violation as a 500. Mirrors createUser in auth/identity.go.
		if ent.IsConstraintError(err) {
			return h.client.Subscription.Query().Only(ctx)
		}
		return nil, err
	}
	return sub, nil
}

func (h *Handler) usedSince(ctx context.Context, since time.Time) (int, error) {
	// Attribute each charge to the period of its RESERVE row, not the individual
	// timestamps of its rows. A charge spans a reserve and a terminal row written
	// at different times; summing rows by their own ts skews usage across the
	// period boundary (see quota.consumedSince). Find the request_ids reserved in
	// the window, then sum the NET delta over all their phases.
	const reserveReasonSuffix = ".reserve"
	var idRows []struct {
		RequestID uuid.UUID `json:"request_id"`
	}
	if err := h.client.CreditLedger.Query().
		Where(
			creditledger.ReasonHasSuffix(reserveReasonSuffix),
			creditledger.TsGTE(since),
		).
		Select(creditledger.FieldRequestID).
		Scan(ctx, &idRows); err != nil {
		return 0, err
	}
	if len(idRows) == 0 {
		return 0, nil
	}
	ids := make([]uuid.UUID, len(idRows))
	for i, row := range idRows {
		ids[i] = row.RequestID
	}
	var rows []struct {
		Total *int `json:"total"`
	}
	if err := h.client.CreditLedger.Query().
		Where(creditledger.RequestIDIn(ids...)).
		Aggregate(ent.As(ent.Sum(creditledger.FieldDelta), "total")).
		Scan(ctx, &rows); err != nil {
		return 0, err
	}
	if len(rows) == 0 || rows[0].Total == nil || *rows[0].Total >= 0 {
		return 0, nil
	}
	return -*rows[0].Total, nil
}
