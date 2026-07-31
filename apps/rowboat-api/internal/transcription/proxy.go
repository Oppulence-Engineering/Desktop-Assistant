package transcription

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/minutes"
)

const maxDeepgramFrameBytes = 16 << 20

var deepgramQueryParams = map[string]struct{}{
	"model": {}, "version": {}, "language": {}, "detect_language": {},
	"encoding": {}, "sample_rate": {}, "channels": {}, "multichannel": {},
	"punctuate": {}, "profanity_filter": {}, "redact": {}, "diarize": {},
	"smart_format": {}, "numerals": {}, "search": {}, "replace": {},
	"keywords": {}, "keyterm": {}, "interim_results": {}, "endpointing": {},
	"utterance_end_ms": {}, "vad_events": {}, "filler_words": {},
	"mip_opt_out": {}, "tag": {},
}

// WebSocketBearer promotes the desktop's WebSocket subprotocol credential to
// the normal Authorization header consumed by auth.RequireJWT. Only the second
// protocol value is treated as a credential; the server negotiates the literal
// "bearer" protocol so the JWT is never echoed in the upgrade response.
func WebSocketBearer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			protocols := websocket.Subprotocols(r)
			if len(protocols) == 2 && strings.EqualFold(protocols[0], "bearer") && strings.TrimSpace(protocols[1]) != "" {
				r.Header.Set("Authorization", "Bearer "+strings.TrimSpace(protocols[1]))
			}
		}
		next.ServeHTTP(w, r)
	})
}

// SetDeepgramURL overrides the upstream listen endpoint for tests.
func (h *Handler) SetDeepgramURL(raw string) {
	if strings.TrimSpace(raw) != "" {
		h.deepgramURL = strings.TrimSpace(raw)
	}
}

// Listen authenticates a signed-in desktop, enforces its monthly cloud-minute
// allowance, and relays audio/results to Deepgram without exposing the fleet
// credential to the client.
func (h *Handler) Listen(w http.ResponseWriter, r *http.Request) {
	if h.secrets == nil || strings.TrimSpace(h.secrets.Deepgram()) == "" {
		httpx.Error(w, http.StatusServiceUnavailable, "cloud transcription is not configured", "provider_unconfigured")
		return
	}
	plan, err := h.planFor(r.Context())
	if err != nil {
		h.log.Warn("transcription proxy plan lookup", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not read transcription entitlement", "internal_error")
		return
	}

	remaining, err := h.gate.Remaining(r.Context(), plan)
	if err != nil {
		h.log.Warn("transcription proxy quota lookup", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not read transcription quota", "internal_error")
		return
	}
	unlimited := h.gate.IsUnlimited(plan)
	if !unlimited && remaining <= 0 {
		httpx.Error(w, http.StatusPaymentRequired, "cloud transcription allowance exhausted", "meeting_minutes_exhausted")
		return
	}
	charge, err := h.gate.Reserve(r.Context(), plan, remaining)
	if err != nil {
		if errors.Is(err, minutes.ErrMinutesExhausted) {
			httpx.Error(w, http.StatusPaymentRequired, "cloud transcription allowance exhausted", "meeting_minutes_exhausted")
			return
		}
		h.log.Warn("transcription proxy reserve", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not reserve transcription quota", "internal_error")
		return
	}

	upstreamURL, err := h.listenURL(r.URL.Query())
	if err != nil {
		_ = charge.Refund(r.Context())
		httpx.Error(w, http.StatusInternalServerError, "cloud transcription endpoint is invalid", "provider_unconfigured")
		return
	}
	header := http.Header{}
	header.Set("Authorization", "Token "+h.secrets.Deepgram())
	upstream, resp, err := (&websocket.Dialer{HandshakeTimeout: 10 * time.Second}).DialContext(r.Context(), upstreamURL, header)
	if err != nil {
		_ = charge.Refund(r.Context())
		if resp != nil && resp.Body != nil {
			_ = resp.Body.Close()
		}
		h.log.Warn("deepgram websocket connect", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "cloud transcription provider unavailable", "upstream_error")
		return
	}
	defer func() { _ = upstream.Close() }()

	upgrader := websocket.Upgrader{
		HandshakeTimeout: 10 * time.Second,
		Subprotocols:     []string{"bearer"},
		// This endpoint is JWT-authenticated and used by the Electron renderer,
		// whose file/app origin is not the public API host.
		CheckOrigin: func(*http.Request) bool { return true },
	}
	downstream, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		_ = charge.Refund(r.Context())
		return
	}
	defer func() { _ = downstream.Close() }()

	started := time.Now()
	defer func() {
		actual := int(time.Since(started).Round(time.Second) / time.Second)
		if actual < 1 {
			actual = 1
		}
		if !unlimited && actual > remaining {
			actual = remaining
		}
		// A normal WebSocket close cancels the request context before this defer
		// runs. Preserve its authenticated user value but detach cancellation so
		// the reservation is always converted into usage instead of remaining
		// stranded for the rest of the month.
		settleCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
		defer cancel()
		if err := charge.Settle(settleCtx, actual); err != nil {
			h.log.Warn("transcription proxy settle", zap.Error(err))
		}
	}()

	downstream.SetReadLimit(maxDeepgramFrameBytes)
	upstream.SetReadLimit(maxDeepgramFrameBytes)
	var quotaTimer *time.Timer
	if !unlimited {
		quotaTimer = time.AfterFunc(time.Duration(remaining)*time.Second, func() {
			_ = downstream.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "cloud transcription allowance exhausted"),
				time.Now().Add(time.Second))
		})
		defer quotaTimer.Stop()
	}

	errCh := make(chan error, 2)
	go relayWebSocket(r.Context(), upstream, downstream, errCh)
	go relayWebSocket(r.Context(), downstream, upstream, errCh)
	<-errCh
}

func (h *Handler) listenURL(in url.Values) (string, error) {
	u, err := url.Parse(h.deepgramURL)
	if err != nil || (u.Scheme != "wss" && u.Scheme != "ws") || u.Host == "" {
		return "", fmt.Errorf("invalid Deepgram URL")
	}
	q := u.Query()
	for key, values := range in {
		if _, ok := deepgramQueryParams[key]; !ok {
			continue
		}
		q.Del(key)
		for _, value := range values {
			q.Add(key, value)
		}
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func relayWebSocket(ctx context.Context, src, dst *websocket.Conn, result chan<- error) {
	for {
		messageType, payload, err := src.ReadMessage()
		if err != nil {
			result <- err
			return
		}
		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			continue
		}
		if err := dst.WriteMessage(messageType, payload); err != nil {
			result <- err
			return
		}
		select {
		case <-ctx.Done():
			result <- ctx.Err()
			return
		default:
		}
	}
}
