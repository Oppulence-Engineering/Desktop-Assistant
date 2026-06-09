package cloudevents

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/cloudevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"go.uber.org/zap"
)

// validationError maps to 400; payloadTooLargeError maps to 413.
type validationError struct{ msg string }

func (e *validationError) Error() string { return e.msg }

type payloadTooLargeError struct{ limit int }

func (e *payloadTooLargeError) Error() string {
	return fmt.Sprintf("payload exceeds %d bytes", e.limit)
}

// validate enforces the RFC 003 ingest contract. It mutates req in place to
// apply the gist truncation bounds.
func (h *Handler) validate(req *IngestRequest) error {
	if _, ok := knownSources[req.Source]; !ok {
		return &validationError{msg: "source must be one of gmail, google_calendar, slack, webhook, internal"}
	}
	if req.DedupeKey == "" {
		return &validationError{msg: "dedupeKey is required"}
	}
	if len(req.DedupeKey) > maxDedupeKeyLen {
		return &validationError{msg: fmt.Sprintf("dedupeKey must be at most %d bytes", maxDedupeKeyLen)}
	}
	if req.Subject == "" && req.Text == "" && len(req.Payload) == 0 {
		return &validationError{msg: "at least one of subject, text, or payload is required"}
	}
	if h.cfg.MaxPayloadBytes > 0 && len(req.Payload) > h.cfg.MaxPayloadBytes {
		return &payloadTooLargeError{limit: h.cfg.MaxPayloadBytes}
	}
	req.Subject = truncate(req.Subject, maxSubjectLen)
	req.Text = truncate(req.Text, maxTextLen)
	return nil
}

// ingest stores one normalized event idempotently and enqueues routing for the
// first insert. Returns the stored (or pre-existing) event and whether the
// post was a duplicate.
//
// The three durable boundaries (RFC 003) each have their own idempotency
// story: this function owns ingest/store — the unique (user, source,
// dedupe_key) index makes provider retries and duplicate posts converge on one
// row, and only the row's creator ever enqueues the route workflow.
func (h *Handler) ingest(ctx context.Context, u *ent.User, req IngestRequest) (*ent.CloudEvent, bool, error) {
	if err := h.validate(&req); err != nil {
		return nil, false, err
	}

	var sealed []byte
	if len(req.Payload) > 0 {
		var err error
		sealed, err = h.sealer.Seal(req.Payload)
		if err != nil {
			return nil, false, fmt.Errorf("seal payload: %w", err)
		}
	}

	// Events ingested while routing is disabled are stored terminal (skipped)
	// rather than accumulating an unbounded pending backlog that no router will
	// ever drain.
	status := StatusPending
	var rj string
	if h.router == nil {
		status = StatusSkipped
		rj = `{"reason":"routing_disabled"}`
	}

	create := h.client.CloudEvent.Create().
		SetUser(u).
		SetSource(req.Source).
		SetDedupeKey(req.DedupeKey).
		SetRoutingStatus(status)
	if rj != "" {
		create = create.SetRoutingJSON(rj)
	}
	if req.SourceEventID != "" {
		create = create.SetSourceEventID(req.SourceEventID)
	}
	if req.SourceAccountID != "" {
		create = create.SetSourceAccountID(req.SourceAccountID)
	}
	if req.EventType != "" {
		create = create.SetEventType(req.EventType)
	}
	if req.Subject != "" {
		create = create.SetSubject(req.Subject)
	}
	if req.Text != "" {
		create = create.SetText(req.Text)
	}
	if sealed != nil {
		create = create.SetPayloadCiphertext(sealed)
	}
	if req.OccurredAt != nil {
		create = create.SetOccurredAt(req.OccurredAt.UTC())
	}

	created, err := create.Save(ctx)
	if err != nil {
		if !ent.IsConstraintError(err) {
			return nil, false, err
		}
		// Duplicate (user, source, dedupe_key): idempotent replay. Return the
		// existing row and NEVER re-enqueue routing. The explicit user predicate
		// keeps this correct under internal (unscoped) contexts too.
		existing, qErr := h.client.CloudEvent.Query().
			Where(
				cloudevent.SourceEQ(req.Source),
				cloudevent.DedupeKeyEQ(req.DedupeKey),
				cloudevent.HasUserWith(user.IDEQ(u.ID)),
			).
			Only(ctx)
		if qErr != nil {
			return nil, false, qErr
		}
		metricDeduped.WithLabelValues(req.Source).Inc()
		return existing, true, nil
	}
	metricIngested.WithLabelValues(req.Source).Inc()

	if h.router != nil {
		if err := h.router.StartRoute(ctx, RouteInput{UserID: u.ID.String(), EventID: created.ID.String()}); err != nil {
			// The event is preserved; mark it failed so it is visible and
			// repairable (re-route is a post-v1 internal operation) instead of
			// stuck pending with no workflow behind it.
			metricRouteFailures.WithLabelValues("route_start").Inc()
			h.log.Error("cloud event route workflow start failed",
				zap.String("eventId", created.ID.String()), zap.Error(err))
			if uerr := created.Update().
				SetRoutingStatus(StatusFailed).
				SetRoutingJSON(`{"error":"route_start_failed"}`).
				Exec(ctx); uerr != nil {
				h.log.Error("mark cloud event route-start failure", zap.Error(uerr))
			} else {
				created.RoutingStatus = StatusFailed
			}
		}
	}
	return created, false, nil
}

// resolveInternalUser loads the explicit event owner for server-to-server
// ingestion. ctx must already be internal (RequireInternalSecret).
func (h *Handler) resolveInternalUser(ctx context.Context, userID string) (*ent.User, error) {
	if userID == "" {
		return nil, &validationError{msg: "userId is required"}
	}
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, &validationError{msg: "userId must be a UUID"}
	}
	u, err := h.client.User.Get(ctx, uid)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, &validationError{msg: "userId does not exist"}
		}
		return nil, err
	}
	return u, nil
}

// errEventNotFound distinguishes a missing event row for callers that map it
// to 404.
var errEventNotFound = errors.New("cloudevents: event not found")

// loadEvent fetches one event by id under the caller's (tenant-scoped) ctx.
func (h *Handler) loadEvent(ctx context.Context, id string) (*ent.CloudEvent, error) {
	eid, err := parseUUID(id)
	if err != nil {
		return nil, errEventNotFound
	}
	ev, err := h.client.CloudEvent.Get(ctx, eid)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, errEventNotFound
		}
		return nil, err
	}
	return ev, nil
}

// formatOptionalTime renders a nullable timestamp as RFC3339, or "".
func formatOptionalTime(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}
