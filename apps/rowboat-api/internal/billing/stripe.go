package billing

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/cloudevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/subscription"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const stripeSignatureTolerance = 5 * time.Minute

var errStripeUnconfigured = errors.New("stripe billing is not configured")

// StripeConfig controls the Stripe-backed billing endpoints.
type StripeConfig struct {
	SecretKey      string
	WebhookSecret  string
	StarterPriceID string
	ProPriceID     string
	SuccessURL     string
	CancelURL      string
	APIBaseURL     string
	StarterCredits int
	ProCredits     int
}

// ConfigureStripe installs Stripe settings after the handler is constructed.
func (h *Handler) ConfigureStripe(cfg StripeConfig) {
	if cfg.APIBaseURL == "" {
		cfg.APIBaseURL = "https://api.stripe.com"
	}
	if cfg.StarterCredits <= 0 {
		cfg.StarterCredits = 200000
	}
	if cfg.ProCredits <= 0 {
		cfg.ProCredits = 2000000
	}
	h.stripe = cfg
	h.stripeHTTP = &http.Client{Timeout: 15 * time.Second}
}

type checkoutRequest struct {
	Plan string `json:"plan"`
}

// CheckoutSession handles POST /v1/billing/checkout-session.
func (h *Handler) CheckoutSession(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	var req checkoutRequest
	if !httpx.DecodeJSON(w, r, 1<<16, &req) {
		return
	}
	priceID, ok := h.priceForPlan(req.Plan)
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "plan must be starter or pro", "bad_request")
		return
	}
	if priceID == "" || h.stripe.SecretKey == "" {
		httpx.Error(w, http.StatusBadGateway, "Stripe checkout is not configured", "provider_unconfigured")
		return
	}
	customerID, err := h.ensureStripeCustomer(r.Context(), u)
	if err != nil {
		h.log.Error("ensure stripe customer", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "could not create Stripe customer", "provider_unavailable")
		return
	}
	values := url.Values{}
	values.Set("mode", "subscription")
	values.Set("customer", customerID)
	values.Set("success_url", h.stripe.SuccessURL)
	values.Set("cancel_url", h.stripe.CancelURL)
	values.Set("client_reference_id", u.ID.String())
	values.Set("line_items[0][price]", priceID)
	values.Set("line_items[0][quantity]", "1")
	values.Set("allow_promotion_codes", "true")
	values.Set("metadata[user_id]", u.ID.String())
	values.Set("metadata[plan]", req.Plan)
	values.Set("subscription_data[metadata][user_id]", u.ID.String())
	values.Set("subscription_data[metadata][plan]", req.Plan)
	var resp struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}
	if err := h.stripePost(r.Context(), "/v1/checkout/sessions", values, &resp); err != nil {
		h.log.Error("create stripe checkout session", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "could not create Stripe checkout session", "provider_unavailable")
		return
	}
	if resp.URL == "" {
		httpx.Error(w, http.StatusBadGateway, "Stripe checkout returned no URL", "provider_unavailable")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"url": resp.URL})
}

// PortalSession handles POST /v1/billing/portal-session.
func (h *Handler) PortalSession(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	if h.stripe.SecretKey == "" {
		httpx.Error(w, http.StatusBadGateway, "Stripe portal is not configured", "provider_unconfigured")
		return
	}
	sub, err := h.subscriptionFor(r.Context(), u)
	if err != nil {
		h.log.Error("load subscription for stripe portal", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load billing", "internal_error")
		return
	}
	if sub.StripeCustomerID == "" {
		httpx.Error(w, http.StatusConflict, "Stripe customer is not linked yet", "stripe_customer_missing")
		return
	}
	values := url.Values{}
	values.Set("customer", sub.StripeCustomerID)
	values.Set("return_url", h.stripe.SuccessURL)
	var resp struct {
		URL string `json:"url"`
	}
	if err := h.stripePost(r.Context(), "/v1/billing_portal/sessions", values, &resp); err != nil {
		h.log.Error("create stripe portal session", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "could not create Stripe portal session", "provider_unavailable")
		return
	}
	if resp.URL == "" {
		httpx.Error(w, http.StatusBadGateway, "Stripe portal returned no URL", "provider_unavailable")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"url": resp.URL})
}

// Sync handles POST /v1/billing/sync. It refreshes the local subscription from
// Stripe for the signed-in user when a subscription id is already linked.
func (h *Handler) Sync(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	if h.stripe.SecretKey == "" {
		httpx.Error(w, http.StatusBadGateway, "Stripe sync is not configured", "provider_unconfigured")
		return
	}
	sub, err := h.subscriptionFor(r.Context(), u)
	if err != nil {
		h.log.Error("load subscription for stripe sync", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load billing", "internal_error")
		return
	}
	if sub.StripeSubscriptionID == "" {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"synced": false, "reason": "stripe_subscription_missing"})
		return
	}
	ss, err := h.retrieveStripeSubscription(r.Context(), sub.StripeSubscriptionID)
	if err != nil {
		h.log.Error("retrieve stripe subscription", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "could not refresh Stripe subscription", "provider_unavailable")
		return
	}
	if err := h.applyStripeSubscription(r.Context(), u, ss, "billing.sync"); err != nil {
		h.log.Error("sync stripe subscription", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not sync billing", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"synced": true})
}

// StripeWebhook handles POST /v1/billing/stripe/webhook.
func (h *Handler) StripeWebhook(w http.ResponseWriter, r *http.Request) {
	if h.stripe.WebhookSecret == "" {
		httpx.Error(w, http.StatusBadGateway, "Stripe webhooks are not configured", "provider_unconfigured")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "could not read webhook body", "bad_request")
		return
	}
	if !validStripeSignature(raw, r.Header.Get("Stripe-Signature"), h.stripe.WebhookSecret, time.Now()) {
		httpx.Error(w, http.StatusBadRequest, "invalid Stripe signature", "invalid_signature")
		return
	}
	var event stripeEvent
	if err := json.Unmarshal(raw, &event); err != nil || event.ID == "" || event.Type == "" {
		httpx.Error(w, http.StatusBadRequest, "invalid Stripe event", "bad_request")
		return
	}
	result, err := h.processStripeEvent(r.Context(), event)
	if err != nil {
		h.log.Error("process stripe webhook", zap.String("event", event.ID), zap.String("type", event.Type), zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not process Stripe webhook", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}

type stripeEvent struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Created int64  `json:"created"`
	Data    struct {
		Object json.RawMessage `json:"object"`
	} `json:"data"`
}

type stripeCheckoutSession struct {
	ID                string            `json:"id"`
	Customer          stripeObjectID    `json:"customer"`
	Subscription      stripeObjectID    `json:"subscription"`
	ClientReferenceID string            `json:"client_reference_id"`
	Metadata          map[string]string `json:"metadata"`
}

type stripeSubscription struct {
	ID                string            `json:"id"`
	Customer          stripeObjectID    `json:"customer"`
	Status            string            `json:"status"`
	TrialEnd          int64             `json:"trial_end"`
	CancelAtPeriodEnd bool              `json:"cancel_at_period_end"`
	Metadata          map[string]string `json:"metadata"`
	Items             struct {
		Data []struct {
			Price struct {
				ID string `json:"id"`
			} `json:"price"`
		} `json:"data"`
	} `json:"items"`
}

type stripeInvoice struct {
	ID           string            `json:"id"`
	Customer     stripeObjectID    `json:"customer"`
	Subscription stripeObjectID    `json:"subscription"`
	Metadata     map[string]string `json:"metadata"`
}

type stripeCustomer struct {
	ID string `json:"id"`
}

type stripeObjectID string

func (s *stripeObjectID) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	if bytes.Equal(b, []byte("null")) || len(b) == 0 {
		*s = ""
		return nil
	}
	var id string
	if len(b) > 0 && b[0] == '"' {
		if err := json.Unmarshal(b, &id); err != nil {
			return err
		}
		*s = stripeObjectID(id)
		return nil
	}
	var obj struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(b, &obj); err != nil {
		return err
	}
	*s = stripeObjectID(obj.ID)
	return nil
}

func (s stripeObjectID) String() string { return string(s) }

func (h *Handler) processStripeEvent(ctx context.Context, event stripeEvent) (map[string]any, error) {
	switch event.Type {
	case "checkout.session.completed":
		var session stripeCheckoutSession
		if err := json.Unmarshal(event.Data.Object, &session); err != nil {
			return nil, err
		}
		u, err := h.userFromStripeMetadata(ctx, session.Metadata, session.ClientReferenceID)
		if err != nil {
			return nil, err
		}
		duplicate, err := h.recordStripeEvent(ctx, u, event)
		if err != nil || duplicate {
			return map[string]any{"received": true, "duplicate": duplicate}, err
		}
		stale, err := h.isStaleStripeEvent(ctx, u, event)
		if err != nil || stale {
			return map[string]any{"received": true, "stale": stale}, err
		}
		if session.Customer.String() != "" {
			if err := h.setStripeCustomer(ctx, u, session.Customer.String()); err != nil {
				return nil, err
			}
		}
		if session.Subscription.String() == "" {
			return map[string]any{"received": true, "synced": false}, nil
		}
		ss, err := h.retrieveStripeSubscription(ctx, session.Subscription.String())
		if err != nil {
			return nil, err
		}
		if len(ss.Metadata) == 0 {
			ss.Metadata = session.Metadata
		}
		if ss.Customer.String() == "" {
			ss.Customer = session.Customer
		}
		if err := h.applyStripeSubscription(ctx, u, ss, event.Type); err != nil {
			return nil, err
		}
		return map[string]any{"received": true, "synced": true}, nil
	case "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted":
		var ss stripeSubscription
		if err := json.Unmarshal(event.Data.Object, &ss); err != nil {
			return nil, err
		}
		if event.Type == "customer.subscription.deleted" {
			ss.Status = "canceled"
		}
		u, err := h.userForStripeSubscription(ctx, ss)
		if err != nil {
			if ent.IsNotFound(err) {
				return map[string]any{"received": true, "ignored": true, "reason": "unknown_subscription"}, nil
			}
			return nil, err
		}
		duplicate, err := h.recordStripeEvent(ctx, u, event)
		if err != nil || duplicate {
			return map[string]any{"received": true, "duplicate": duplicate}, err
		}
		stale, err := h.isStaleStripeEvent(ctx, u, event)
		if err != nil || stale {
			return map[string]any{"received": true, "stale": stale}, err
		}
		if err := h.applyStripeSubscription(ctx, u, ss, event.Type); err != nil {
			return nil, err
		}
		return map[string]any{"received": true, "synced": true}, nil
	case "invoice.payment_succeeded", "invoice.payment_failed":
		var invoice stripeInvoice
		if err := json.Unmarshal(event.Data.Object, &invoice); err != nil {
			return nil, err
		}
		u, err := h.userForStripeInvoice(ctx, invoice)
		if err != nil {
			if ent.IsNotFound(err) {
				return map[string]any{"received": true, "ignored": true, "reason": "unknown_invoice"}, nil
			}
			return nil, err
		}
		duplicate, err := h.recordStripeEvent(ctx, u, event)
		if err != nil || duplicate {
			return map[string]any{"received": true, "duplicate": duplicate}, err
		}
		stale, err := h.isStaleStripeEvent(ctx, u, event)
		if err != nil || stale {
			return map[string]any{"received": true, "stale": stale}, err
		}
		if invoice.Subscription.String() != "" && h.stripe.SecretKey != "" {
			ss, err := h.retrieveStripeSubscription(ctx, invoice.Subscription.String())
			if err != nil {
				return nil, err
			}
			if event.Type == "invoice.payment_failed" && ss.Status == "active" {
				ss.Status = "past_due"
			}
			if err := h.applyStripeSubscription(ctx, u, ss, event.Type); err != nil {
				return nil, err
			}
			return map[string]any{"received": true, "synced": true}, nil
		}
		if event.Type == "invoice.payment_failed" {
			if err := h.updateSubscriptionStatus(ctx, u, "past_due"); err != nil {
				return nil, err
			}
		}
		return map[string]any{"received": true, "synced": event.Type == "invoice.payment_failed"}, nil
	default:
		return map[string]any{"received": true, "ignored": true}, nil
	}
}

func (h *Handler) ensureStripeCustomer(ctx context.Context, u *ent.User) (string, error) {
	sub, err := h.subscriptionFor(ctx, u)
	if err != nil {
		return "", err
	}
	if sub.StripeCustomerID != "" {
		return sub.StripeCustomerID, nil
	}
	values := url.Values{}
	values.Set("email", u.Email)
	values.Set("metadata[user_id]", u.ID.String())
	var customer stripeCustomer
	if err := h.stripePost(ctx, "/v1/customers", values, &customer); err != nil {
		return "", err
	}
	if customer.ID == "" {
		return "", fmt.Errorf("stripe customer response missing id")
	}
	if err := h.setStripeCustomer(ctx, u, customer.ID); err != nil {
		return "", err
	}
	return customer.ID, nil
}

func (h *Handler) setStripeCustomer(ctx context.Context, u *ent.User, customerID string) error {
	if customerID == "" {
		return nil
	}
	sub, err := h.subscriptionFor(auth.WithUser(ctx, u), u)
	if err != nil {
		return err
	}
	return h.client.Subscription.UpdateOne(sub).
		SetStripeCustomerID(customerID).
		Exec(auth.WithUser(ctx, u))
}

func (h *Handler) applyStripeSubscription(ctx context.Context, u *ent.User, ss stripeSubscription, source string) error {
	if ss.ID == "" {
		return fmt.Errorf("stripe subscription missing id")
	}
	plan := h.planForStripeSubscription(ss)
	status := normalizeStripeStatus(ss.Status)
	credits := h.creditsForPlan(plan)
	sub, err := h.subscriptionFor(auth.WithUser(ctx, u), u)
	if err != nil {
		return err
	}
	update := h.client.Subscription.UpdateOne(sub).
		SetPlan(plan).
		SetStatus(status).
		SetSanctionedCredits(credits).
		SetStripeSubscriptionID(ss.ID)
	if ss.Customer.String() != "" {
		update = update.SetStripeCustomerID(ss.Customer.String())
	}
	if ss.TrialEnd > 0 {
		trialEnd := time.Unix(ss.TrialEnd, 0).UTC()
		update = update.SetTrialExpiresAt(trialEnd)
	} else {
		update = update.ClearTrialExpiresAt()
	}
	if err := update.Exec(auth.WithUser(ctx, u)); err != nil {
		return err
	}
	h.log.Info("stripe subscription applied",
		zap.String("userId", u.ID.String()),
		zap.String("subscriptionId", ss.ID),
		zap.String("plan", plan),
		zap.String("status", status),
		zap.String("source", source))
	return nil
}

func (h *Handler) updateSubscriptionStatus(ctx context.Context, u *ent.User, status string) error {
	sub, err := h.subscriptionFor(auth.WithUser(ctx, u), u)
	if err != nil {
		return err
	}
	return h.client.Subscription.UpdateOne(sub).
		SetStatus(normalizeStripeStatus(status)).
		Exec(auth.WithUser(ctx, u))
}

func (h *Handler) userForStripeSubscription(ctx context.Context, ss stripeSubscription) (*ent.User, error) {
	if u, err := h.userFromStripeMetadata(ctx, ss.Metadata, ""); err == nil {
		return u, nil
	}
	internal := auth.WithInternal(ctx)
	q := h.client.Subscription.Query()
	switch {
	case ss.ID != "":
		q = q.Where(subscription.StripeSubscriptionIDEQ(ss.ID))
	case ss.Customer.String() != "":
		q = q.Where(subscription.StripeCustomerIDEQ(ss.Customer.String()))
	default:
		return nil, &ent.NotFoundError{}
	}
	sub, err := q.Only(internal)
	if err != nil {
		return nil, err
	}
	return sub.QueryUser().Only(internal)
}

func (h *Handler) userForStripeInvoice(ctx context.Context, invoice stripeInvoice) (*ent.User, error) {
	if u, err := h.userFromStripeMetadata(ctx, invoice.Metadata, ""); err == nil {
		return u, nil
	}
	internal := auth.WithInternal(ctx)
	q := h.client.Subscription.Query()
	switch {
	case invoice.Subscription.String() != "":
		q = q.Where(subscription.StripeSubscriptionIDEQ(invoice.Subscription.String()))
	case invoice.Customer.String() != "":
		q = q.Where(subscription.StripeCustomerIDEQ(invoice.Customer.String()))
	default:
		return nil, &ent.NotFoundError{}
	}
	sub, err := q.Only(internal)
	if err != nil {
		return nil, err
	}
	return sub.QueryUser().Only(internal)
}

func (h *Handler) userFromStripeMetadata(ctx context.Context, metadata map[string]string, fallback string) (*ent.User, error) {
	id := fallback
	if metadata != nil {
		if metadata["user_id"] != "" {
			id = metadata["user_id"]
		}
	}
	if id == "" {
		return nil, &ent.NotFoundError{}
	}
	uid, err := uuid.Parse(id)
	if err != nil {
		return nil, err
	}
	return h.client.User.Query().Where(user.IDEQ(uid)).Only(auth.WithInternal(ctx))
}

func (h *Handler) recordStripeEvent(ctx context.Context, u *ent.User, event stripeEvent) (bool, error) {
	create := h.client.CloudEvent.Create().
		SetUser(u).
		SetSource("stripe").
		SetDedupeKey(event.ID).
		SetSourceEventID(event.ID).
		SetEventType(event.Type).
		SetSubject("Stripe " + event.Type).
		SetRoutingStatus("skipped").
		SetRoutingJSON(`{"reason":"billing_webhook"}`)
	if event.Created > 0 {
		create = create.SetOccurredAt(time.Unix(event.Created, 0).UTC())
	}
	_, err := create.Save(auth.WithUser(ctx, u))
	if err == nil {
		return false, nil
	}
	if !ent.IsConstraintError(err) {
		return false, err
	}
	_, err = h.client.CloudEvent.Query().
		Where(
			cloudevent.SourceEQ("stripe"),
			cloudevent.DedupeKeyEQ(event.ID),
			cloudevent.HasUserWith(user.IDEQ(u.ID)),
		).
		Only(auth.WithUser(ctx, u))
	if err != nil {
		return false, err
	}
	return true, nil
}

func (h *Handler) isStaleStripeEvent(ctx context.Context, u *ent.User, event stripeEvent) (bool, error) {
	if event.Created <= 0 {
		return false, nil
	}
	eventTime := time.Unix(event.Created, 0).UTC()
	n, err := h.client.CloudEvent.Query().
		Where(
			cloudevent.SourceEQ("stripe"),
			cloudevent.OccurredAtGT(eventTime),
			cloudevent.HasUserWith(user.IDEQ(u.ID)),
		).
		Count(auth.WithUser(ctx, u))
	return n > 0, err
}

func (h *Handler) retrieveStripeSubscription(ctx context.Context, id string) (stripeSubscription, error) {
	if h.stripe.SecretKey == "" {
		return stripeSubscription{}, errStripeUnconfigured
	}
	var ss stripeSubscription
	if err := h.stripeGet(ctx, "/v1/subscriptions/"+url.PathEscape(id), &ss); err != nil {
		return stripeSubscription{}, err
	}
	return ss, nil
}

func (h *Handler) stripePost(ctx context.Context, path string, values url.Values, out any) error {
	if h.stripe.SecretKey == "" {
		return errStripeUnconfigured
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(h.stripe.APIBaseURL, "/")+path, strings.NewReader(values.Encode()))
	if err != nil {
		return err
	}
	req.SetBasicAuth(h.stripe.SecretKey, "")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return h.doStripe(req, out)
}

func (h *Handler) stripeGet(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(h.stripe.APIBaseURL, "/")+path, nil)
	if err != nil {
		return err
	}
	req.SetBasicAuth(h.stripe.SecretKey, "")
	return h.doStripe(req, out)
}

func (h *Handler) doStripe(req *http.Request, out any) error {
	client := h.stripeHTTP
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Stripe error bodies may include customer, payment, or account details.
		// Keep them out of application errors because callers log those errors.
		return fmt.Errorf("stripe %s %s returned %d", req.Method, req.URL.Path, resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(body, out)
}

func (h *Handler) priceForPlan(plan string) (string, bool) {
	switch plan {
	case "starter":
		return h.stripe.StarterPriceID, true
	case "pro":
		return h.stripe.ProPriceID, true
	default:
		return "", false
	}
}

func (h *Handler) planForStripeSubscription(ss stripeSubscription) string {
	for _, item := range ss.Items.Data {
		switch item.Price.ID {
		case h.stripe.ProPriceID:
			return "pro"
		case h.stripe.StarterPriceID:
			return "starter"
		}
	}
	if ss.Metadata != nil {
		switch ss.Metadata["plan"] {
		case "starter", "pro":
			return ss.Metadata["plan"]
		}
	}
	return "free"
}

func (h *Handler) creditsForPlan(plan string) int {
	switch plan {
	case "pro":
		return h.stripe.ProCredits
	case "starter":
		return h.stripe.StarterCredits
	default:
		return h.freeTierCredits
	}
}

func normalizeStripeStatus(status string) string {
	switch status {
	case "active", "trialing", "past_due", "canceled":
		return status
	case "incomplete", "unpaid", "paused":
		return "past_due"
	case "incomplete_expired":
		return "canceled"
	default:
		return "past_due"
	}
}

func validStripeSignature(payload []byte, header, secret string, now time.Time) bool {
	var ts int64
	var signatures []string
	for _, part := range strings.Split(header, ",") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch key {
		case "t":
			parsed, err := strconv.ParseInt(value, 10, 64)
			if err != nil {
				return false
			}
			ts = parsed
		case "v1":
			signatures = append(signatures, value)
		}
	}
	if ts == 0 || len(signatures) == 0 {
		return false
	}
	signedAt := time.Unix(ts, 0)
	if now.Sub(signedAt) > stripeSignatureTolerance || signedAt.Sub(now) > stripeSignatureTolerance {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(strconv.FormatInt(ts, 10)))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	for _, got := range signatures {
		if subtle.ConstantTimeCompare([]byte(got), []byte(expected)) == 1 {
			return true
		}
	}
	return false
}
