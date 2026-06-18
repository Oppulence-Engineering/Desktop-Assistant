package agentstream

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsession"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsessionevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentworkflow"
	"go.uber.org/zap"
)

// terminalEventTypes end the stream once delivered.
var terminalEventTypes = map[string]struct{}{
	agentworkflow.EventSessionCompleted: {},
	agentworkflow.EventSessionFailed:    {},
	agentworkflow.EventSessionCanceled:  {},
}

// backfillPage bounds one projection read.
const backfillPage = 500

// Streamer serves the NDJSON live stream by tailing the AgentSessionEvent
// projection (the source of truth) and using the Redis bus only as a low-latency
// wake-up. This makes the stream gap-free and duplicate-free by construction:
// every line comes from the durable, seq-ordered projection, and the bus merely
// shortens the time-to-deliver between polls.
type Streamer struct {
	client *ent.Client
	bus    *Bus // nil → pure poll fallback
	log    *zap.Logger
}

// NewStreamer builds the stream handler. bus may be nil (durable-only poll).
func NewStreamer(client *ent.Client, bus *Bus, log *zap.Logger) *Streamer {
	if log == nil {
		log = zap.NewNop()
	}
	return &Streamer{client: client, bus: bus, log: log}
}

// Stream writes the session's events as NDJSON, backfilling from ?afterSeq and
// then following until a terminal event or client disconnect. sess must already
// be tenant-resolved by the caller (the request ctx carries the viewer, so the
// event query is tenant-scoped too).
func (s *Streamer) Stream(w http.ResponseWriter, r *http.Request, sess *ent.AgentSession) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	ctx := r.Context()
	afterSeq := -1
	if raw := r.URL.Query().Get("afterSeq"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
			afterSeq = n
		}
	}

	// Subscribe BEFORE the initial backfill so no event published during backfill
	// is missed (the next poll catches it regardless; the bus just speeds it up).
	// The bus is used only as a coalesced wake-up signal — the DB is the truth.
	var pubsubCh <-chan struct{}
	if s.bus != nil {
		sub := s.bus.Subscribe(ctx, sess.SessionID)
		defer func() { _ = sub.Close() }()
		raw := sub.Channel()
		conv := make(chan struct{}, 1)
		go func() {
			for range raw {
				select {
				case conv <- struct{}{}:
				default:
				}
			}
		}()
		pubsubCh = conv
	}

	lastSeq, terminal := s.flush(ctx, w, flusher, sess, afterSeq)
	if terminal {
		return
	}

	// Poll cadence: tight when there is no bus to wake us; relaxed (heartbeat +
	// safety poll) when the bus delivers wake-ups.
	interval := time.Second
	if s.bus != nil {
		interval = 15 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-pubsubCh:
			lastSeq, terminal = s.flush(ctx, w, flusher, sess, lastSeq)
			if terminal {
				return
			}
		case <-ticker.C:
			lastSeq, terminal = s.flush(ctx, w, flusher, sess, lastSeq)
			if terminal {
				return
			}
		}
	}
}

// flush writes all events with seq > afterSeq, paging until drained, and reports
// the new high-water seq plus whether a terminal event was delivered.
func (s *Streamer) flush(ctx context.Context, w http.ResponseWriter, flusher http.Flusher, sess *ent.AgentSession, afterSeq int) (int, bool) {
	enc := json.NewEncoder(w)
	last := afterSeq
	for {
		events, err := s.client.AgentSessionEvent.Query().
			Where(
				agentsessionevent.HasSessionWith(agentsession.IDEQ(sess.ID)),
				agentsessionevent.SeqGT(last),
			).
			Order(agentsessionevent.BySeq(entsql.OrderAsc())).
			Limit(backfillPage).
			All(ctx)
		if err != nil {
			s.log.Warn("agent stream backfill", zap.String("sessionId", sess.SessionID), zap.Error(err))
			return last, false
		}
		if len(events) == 0 {
			return last, false
		}
		for _, ev := range events {
			line := agentworkflow.StreamEvent{Seq: ev.Seq, Type: ev.EventType, TurnSeq: ev.TurnSeq, Data: json.RawMessage(ev.EventJSON)}
			if err := enc.Encode(line); err != nil {
				return last, true // client gone
			}
			last = ev.Seq
			if _, ok := terminalEventTypes[ev.EventType]; ok {
				flusher.Flush()
				return last, true
			}
		}
		flusher.Flush()
		if len(events) < backfillPage {
			return last, false
		}
	}
}
