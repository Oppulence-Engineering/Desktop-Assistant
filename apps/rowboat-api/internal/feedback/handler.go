// Package feedback serves POST /v1/feedback: it relays a signed-in user's
// message into Plain (plain.com) as a support thread (upsertCustomer +
// createThread). One-way in v1 — replies happen over email from Plain's
// inbox. The Plain API key is server-held; the customer email comes from the
// authenticated user, never from the client.
package feedback

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

// Submission limits. The message cap matches the renderer's textarea limit.
const (
	maxMessageRunes  = 5000
	maxMetadataRunes = 64
)

// categoryTitles maps the wire category to the human thread-title fragment.
var categoryTitles = map[string]string{
	"bug":      "Bug report",
	"feature":  "Feature request",
	"question": "Question",
	"other":    "Feedback",
}

// Config carries the non-secret Plain settings.
type Config struct {
	// BaseURL is Plain's GraphQL endpoint.
	BaseURL string
	// LabelTypeIDs maps category -> Plain label type id (lt_…). Categories
	// without a mapping are submitted unlabelled — label types are workspace
	// data created in Plain, so the map may legitimately be empty.
	LabelTypeIDs map[string]string
	// TitlePrefix is prepended to thread titles (e.g. "[staging] ").
	TitlePrefix string
}

// ParseLabelMap parses the PLAIN_LABEL_TYPE_IDS JSON ("" → empty map).
func ParseLabelMap(raw string) (map[string]string, error) {
	if strings.TrimSpace(raw) == "" {
		return map[string]string{}, nil
	}
	var m map[string]string
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return nil, fmt.Errorf("PLAIN_LABEL_TYPE_IDS: %w", err)
	}
	return m, nil
}

// Handler serves POST /v1/feedback.
type Handler struct {
	sec    *secrets.Store
	client *ent.Client
	cfg    Config
	plain  *plainClient
	log    *zap.Logger
}

// New builds the feedback handler.
func New(sec *secrets.Store, client *ent.Client, cfg Config, log *zap.Logger) *Handler {
	return &Handler{
		sec:    sec,
		client: client,
		cfg:    cfg,
		plain: &plainClient{
			baseURL: strings.TrimRight(cfg.BaseURL, "/"),
			http: outbound.NewClient(outbound.Policy{
				Name:                  "plain",
				Timeout:               15 * time.Second,
				ResponseHeaderTimeout: 10 * time.Second,
				MaxConcurrent:         16,
				MaxResponseBytes:      1 << 20,
			}),
		},
		log: log,
	}
}

// SetOutboundPolicy applies the shared outbound vendor policy.
func (h *Handler) SetOutboundPolicy(policy outbound.Policy) {
	policy.Name = "plain"
	h.plain.http = outbound.NewClient(policy)
}

// Submit handles POST /v1/feedback. Requires the auth middleware (user in
// context); the rate limiter on the route keeps this human-paced.
func (h *Handler) Submit(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}

	var req struct {
		Category   string `json:"category"`
		Message    string `json:"message"`
		AppVersion string `json:"appVersion"`
		Platform   string `json:"platform"`
	}
	if !httpx.DecodeJSON(w, r, 1<<16, &req) {
		return
	}
	titleKind, ok := categoryTitles[req.Category]
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "invalid category", "bad_request")
		return
	}
	message := strings.TrimSpace(req.Message)
	if message == "" || utf8.RuneCountInString(message) > maxMessageRunes {
		httpx.Error(w, http.StatusBadRequest,
			fmt.Sprintf("message must be 1-%d characters", maxMessageRunes), "bad_request")
		return
	}
	if h.sec.Plain() == "" {
		httpx.Error(w, http.StatusBadGateway, "feedback not configured", "provider_unconfigured")
		return
	}

	ctx := r.Context()

	// Plan is best-effort thread metadata; never block feedback on it.
	plan := "unknown"
	if sub, err := h.client.Subscription.Query().Only(ctx); err == nil {
		plan = sub.Plan
	}
	metadata := fmt.Sprintf("App %s · %s · plan: %s · user: %s",
		clamp(req.AppVersion, "unknown"), clamp(req.Platform, "unknown"), plan, u.ID.String())

	apiKey := h.sec.Plain()
	customerID, err := h.plain.upsertCustomer(ctx, apiKey, u.Email)
	if err != nil {
		h.log.Warn("plain upsertCustomer failed", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "could not send feedback", "upstream_error")
		return
	}
	title := h.cfg.TitlePrefix + titleKind + " from " + u.Email
	threadID, err := h.plain.createThread(ctx, apiKey, customerID, title, message, metadata,
		h.cfg.LabelTypeIDs[req.Category])
	if err != nil {
		h.log.Warn("plain createThread failed", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "could not send feedback", "upstream_error")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "threadId": threadID})
}

// clamp trims a client-supplied metadata string to a sane length, falling
// back when empty (the strings end up in the Plain thread, not the DB).
func clamp(s, fallback string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return fallback
	}
	if utf8.RuneCountInString(s) > maxMetadataRunes {
		return string([]rune(s)[:maxMetadataRunes])
	}
	return s
}
