package cloudevents

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/cloudevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Config tunes the ingestion surface.
type Config struct {
	MaxPayloadBytes    int
	SlackSigningSecret string
	GoogleWebhookToken string
}

// Handler serves /v1/events, /v1/internal/events, and /v1/webhooks/*.
type Handler struct {
	client *ent.Client
	sealer *crypto.Sealer
	router RouteController // nil → routing disabled; events stored skipped
	cfg    Config
	log    *zap.Logger

	slackAgentDispatcher SlackAgentDispatcher
}

// SlackAgentDispatcher starts or continues an agent session for a verified
// Slack Events API payload owned by owner.
type SlackAgentDispatcher func(ctx context.Context, owner *ent.User, body []byte) error

// New builds the cloud events handler. router may be nil (routing disabled).
func New(client *ent.Client, sealer *crypto.Sealer, router RouteController, cfg Config, log *zap.Logger) *Handler {
	return &Handler{client: client, sealer: sealer, router: router, cfg: cfg, log: log}
}

// SetSlackAgentDispatcher lets /v1/webhooks/slack fan out app_mention events to
// the agent channel adapter after the CloudEvent row durably claims the event.
func (h *Handler) SetSlackAgentDispatcher(fn SlackAgentDispatcher) {
	h.slackAgentDispatcher = fn
}

// maxIngestBody bounds the whole ingest request body: the payload cap plus
// headroom for the envelope fields.
func (h *Handler) maxIngestBody() int64 {
	return int64(h.cfg.MaxPayloadBytes) + (64 << 10)
}

// Ingest handles POST /v1/events (JWT caller ingests as themselves).
func (h *Handler) Ingest(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	var req IngestRequest
	if !httpx.DecodeJSON(w, r, h.maxIngestBody(), &req) {
		return
	}
	h.respondIngest(w, r, u, req)
}

// IngestInternal handles POST /v1/internal/events (server-to-server; the
// caller names the event owner explicitly).
func (h *Handler) IngestInternal(w http.ResponseWriter, r *http.Request) {
	var req internalIngestRequest
	if !httpx.DecodeJSON(w, r, h.maxIngestBody(), &req) {
		return
	}
	u, err := h.resolveInternalUser(r.Context(), req.UserID)
	if err != nil {
		writeIngestError(w, err, h.log)
		return
	}
	h.respondIngest(w, r, u, req.IngestRequest)
}

func (h *Handler) respondIngest(w http.ResponseWriter, r *http.Request, u *ent.User, req IngestRequest) {
	ev, deduped, err := h.ingest(r.Context(), u, req)
	if err != nil {
		writeIngestError(w, err, h.log)
		return
	}
	resp := IngestResponse{
		EventID:          ev.ID.String(),
		RoutingStatus:    ev.RoutingStatus,
		Deduped:          deduped,
		MatchedTaskCount: ev.MatchedTaskCount,
	}
	status := http.StatusAccepted
	if deduped {
		status = http.StatusOK
	}
	httpx.WriteJSON(w, status, resp)
}

func writeIngestError(w http.ResponseWriter, err error, log *zap.Logger) {
	var verr *validationError
	var perr *payloadTooLargeError
	switch {
	case errors.As(err, &verr):
		httpx.Error(w, http.StatusBadRequest, verr.msg, "bad_request")
	case errors.As(err, &perr):
		httpx.Error(w, http.StatusRequestEntityTooLarge, perr.Error(), "payload_too_large")
	default:
		log.Error("cloud event ingest failed", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not ingest event", "internal_error")
	}
}

// eventView is the HTTP shape of one event. Payload and routing decisions are
// detail-only (list responses omit them).
type eventView struct {
	ID               string          `json:"id"`
	Source           string          `json:"source"`
	SourceEventID    string          `json:"sourceEventId,omitempty"`
	SourceAccountID  string          `json:"sourceAccountId,omitempty"`
	EventType        string          `json:"eventType,omitempty"`
	Subject          string          `json:"subject,omitempty"`
	Text             string          `json:"text,omitempty"`
	DedupeKey        string          `json:"dedupeKey"`
	RoutingStatus    string          `json:"routingStatus"`
	MatchedTaskCount int             `json:"matchedTaskCount"`
	OccurredAt       string          `json:"occurredAt,omitempty"`
	ReceivedAt       string          `json:"receivedAt"`
	RoutedAt         string          `json:"routedAt,omitempty"`
	Routing          json.RawMessage `json:"routing,omitempty"`
	Payload          json.RawMessage `json:"payload,omitempty"`
}

func viewEvent(ev *ent.CloudEvent) eventView {
	return eventView{
		ID:               ev.ID.String(),
		Source:           ev.Source,
		SourceEventID:    ev.SourceEventID,
		SourceAccountID:  ev.SourceAccountID,
		EventType:        ev.EventType,
		Subject:          ev.Subject,
		Text:             ev.Text,
		DedupeKey:        ev.DedupeKey,
		RoutingStatus:    ev.RoutingStatus,
		MatchedTaskCount: ev.MatchedTaskCount,
		OccurredAt:       formatOptionalTime(ev.OccurredAt),
		ReceivedAt:       ev.ReceivedAt.UTC().Format(time.RFC3339),
		RoutedAt:         formatOptionalTime(ev.RoutedAt),
	}
}

// List handles GET /v1/events. Filters: source, routingStatus, since, until,
// limit, cursor (keyset over received_at DESC, id DESC). Payload omitted.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := h.client.CloudEvent.Query()
	if source := r.URL.Query().Get("source"); source != "" {
		if _, ok := knownSources[source]; !ok {
			httpx.Error(w, http.StatusBadRequest, "invalid source", "bad_request")
			return
		}
		q = q.Where(cloudevent.SourceEQ(source))
	}
	if status := r.URL.Query().Get("routingStatus"); status != "" {
		switch status {
		case StatusPending, StatusRouted, StatusSkipped, StatusFailed:
			q = q.Where(cloudevent.RoutingStatusEQ(status))
		default:
			httpx.Error(w, http.StatusBadRequest, "invalid routingStatus", "bad_request")
			return
		}
	}
	if raw := r.URL.Query().Get("since"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid since", "bad_request")
			return
		}
		q = q.Where(cloudevent.ReceivedAtGTE(t))
	}
	if raw := r.URL.Query().Get("until"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid until", "bad_request")
			return
		}
		q = q.Where(cloudevent.ReceivedAtLTE(t))
	}
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		ct, cid, err := parseEventCursor(raw)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid cursor", "bad_request")
			return
		}
		// Composite (received_at, id) keyset matching the ORDER BY
		// (received_at DESC, id DESC): resume strictly after the cursor row.
		q = q.Where(cloudevent.Or(
			cloudevent.ReceivedAtLT(ct),
			cloudevent.And(cloudevent.ReceivedAtEQ(ct), cloudevent.IDLT(cid)),
		))
	}
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 || n > 500 {
			httpx.Error(w, http.StatusBadRequest, "limit must be between 1 and 500", "bad_request")
			return
		}
		limit = n
	}

	events, err := q.
		Order(ent.Desc(cloudevent.FieldReceivedAt), ent.Desc(cloudevent.FieldID)).
		Limit(limit).
		All(r.Context())
	if err != nil {
		h.log.Error("list cloud events", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not list events", "internal_error")
		return
	}
	views := make([]eventView, 0, len(events))
	for _, ev := range events {
		views = append(views, viewEvent(ev))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"events":     views,
		"nextCursor": nextEventCursor(events, limit),
	})
}

// Get handles GET /v1/events/{eventId}: the detail view including the
// decrypted payload and the routing decision summary. The tenant interceptor
// guarantees the caller owns the event.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	ev, err := h.loadEvent(r.Context(), chi.URLParam(r, "eventId"))
	if err != nil {
		writeLoadError(w, err, h.log)
		return
	}
	view := viewEvent(ev)
	if ev.RoutingJSON != "" {
		view.Routing = json.RawMessage(ev.RoutingJSON)
	}
	if len(ev.PayloadCiphertext) > 0 {
		plain, oerr := h.sealer.Open(ev.PayloadCiphertext)
		if oerr != nil {
			h.log.Error("open cloud event payload", zap.String("eventId", ev.ID.String()), zap.Error(oerr))
			httpx.Error(w, http.StatusInternalServerError, "could not decrypt payload", "internal_error")
			return
		}
		view.Payload = json.RawMessage(plain)
	}
	httpx.WriteJSON(w, http.StatusOK, view)
}

// eventRunView is the minimal run shape for GET /v1/events/{id}/runs (kept
// local; importing internal/backgroundtasks would invert the dependency).
type eventRunView struct {
	RunID       string `json:"runId"`
	Status      string `json:"status"`
	Trigger     string `json:"trigger"`
	Executor    string `json:"executor"`
	TaskSlug    string `json:"taskSlug,omitempty"`
	CreatedAt   string `json:"createdAt"`
	CompletedAt string `json:"completedAt,omitempty"`
}

// Runs handles GET /v1/events/{eventId}/runs: the audit link traversal.
func (h *Handler) Runs(w http.ResponseWriter, r *http.Request) {
	ev, err := h.loadEvent(r.Context(), chi.URLParam(r, "eventId"))
	if err != nil {
		writeLoadError(w, err, h.log)
		return
	}
	runs, err := ev.QueryRuns().WithTask().All(r.Context())
	if err != nil {
		h.log.Error("list cloud event runs", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not list runs", "internal_error")
		return
	}
	views := make([]eventRunView, 0, len(runs))
	for _, run := range runs {
		v := eventRunView{
			RunID:       run.RunID,
			Status:      run.Status,
			Trigger:     run.Trigger,
			Executor:    run.Executor,
			CreatedAt:   run.CreatedAt.UTC().Format(time.RFC3339),
			CompletedAt: formatOptionalTime(run.CompletedAt),
		}
		if run.Edges.Task != nil {
			v.TaskSlug = run.Edges.Task.Slug
		}
		views = append(views, v)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"runs": views})
}

func writeLoadError(w http.ResponseWriter, err error, log *zap.Logger) {
	if errors.Is(err, errEventNotFound) {
		httpx.Error(w, http.StatusNotFound, "event not found", "not_found")
		return
	}
	log.Error("load cloud event", zap.Error(err))
	httpx.Error(w, http.StatusInternalServerError, "could not load event", "internal_error")
}

// eventCursorSep separates the timestamp and id cursor components; neither
// RFC3339Nano timestamps nor UUIDs contain it.
const eventCursorSep = "|"

func nextEventCursor(events []*ent.CloudEvent, limit int) string {
	if limit <= 0 || len(events) < limit {
		return ""
	}
	last := events[len(events)-1]
	return last.ReceivedAt.UTC().Format(time.RFC3339Nano) + eventCursorSep + last.ID.String()
}

func parseEventCursor(raw string) (time.Time, uuid.UUID, error) {
	tsStr, idStr, hasID := strings.Cut(raw, eventCursorSep)
	t, err := time.Parse(time.RFC3339, tsStr)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	if !hasID {
		return time.Time{}, uuid.Nil, errors.New("cursor missing id component")
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	return t, id, nil
}

func parseUUID(s string) (uuid.UUID, error) { return uuid.Parse(s) }
