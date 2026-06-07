// Package httpx holds small HTTP response helpers shared by every handler:
// RFC 9457 problem details, JSON writers, bounded body readers, and
// idempotency-key helpers.
package httpx

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"go.opentelemetry.io/otel/trace"
)

const problemTypeBase = "https://api.rowboat.dev/problems/"

// Problem is the RFC 9457 problem-details envelope. code, requestId, and
// traceId are extension members used by clients and logs.
type Problem struct {
	Type      string `json:"type"`
	Title     string `json:"title"`
	Status    int    `json:"status"`
	Detail    string `json:"detail,omitempty"`
	Instance  string `json:"instance,omitempty"`
	Code      string `json:"code,omitempty"`
	RequestID string `json:"requestId,omitempty"`
	TraceID   string `json:"traceId,omitempty"`
}

// WriteJSON writes v as JSON with the given status.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// Error writes an RFC 9457 problem document. The request context is recovered
// from middleware-installed response writers when available; direct unit tests
// that call handlers without the middleware still receive a valid problem body.
func Error(w http.ResponseWriter, status int, msg, code string) {
	ErrorWith(w, status, msg, code, nil)
}

// ErrorWith writes a problem document plus extension fields (e.g.
// "reconnectRequired": true on the Google refresh path).
func ErrorWith(w http.ResponseWriter, status int, msg, code string, extra map[string]any) {
	if status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", "Bearer")
	}
	problem := problemFromContext(requestContext(w), status, msg, code)
	if len(extra) == 0 {
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(problem)
		return
	}
	body := map[string]any{
		"type":   problem.Type,
		"title":  problem.Title,
		"status": problem.Status,
	}
	if problem.Detail != "" {
		body["detail"] = problem.Detail
	}
	if problem.Instance != "" {
		body["instance"] = problem.Instance
	}
	if problem.Code != "" {
		body["code"] = problem.Code
	}
	if problem.RequestID != "" {
		body["requestId"] = problem.RequestID
	}
	if problem.TraceID != "" {
		body["traceId"] = problem.TraceID
	}
	for k, v := range extra {
		body[k] = v
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func problemFromContext(ctx context.Context, status int, msg, code string) Problem {
	if code == "" {
		code = http.StatusText(status)
	}
	p := Problem{
		Type:   problemTypeBase + code,
		Title:  http.StatusText(status),
		Status: status,
		Detail: msg,
		Code:   code,
	}
	if ctx == nil {
		return p
	}
	if reqID := middleware.GetReqID(ctx); reqID != "" {
		p.RequestID = reqID
	}
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		p.TraceID = sc.TraceID().String()
	}
	return p
}

type requestContextProvider interface {
	RequestContext() context.Context
}

func requestContext(w http.ResponseWriter) context.Context {
	if p, ok := w.(requestContextProvider); ok {
		return p.RequestContext()
	}
	return nil
}

type contextWriter struct {
	http.ResponseWriter
	ctx context.Context
}

// WithRequestContext wraps a response writer so helpers that only receive
// http.ResponseWriter can still annotate errors with request identifiers.
func WithRequestContext(w http.ResponseWriter, r *http.Request) http.ResponseWriter {
	return &contextWriter{ResponseWriter: w, ctx: r.Context()}
}

// RequestContext returns the active request context.
func (w *contextWriter) RequestContext() context.Context {
	return w.ctx
}

// Flush preserves http.Flusher for streaming handlers.
func (w *contextWriter) Flush() {
	_ = http.NewResponseController(w.ResponseWriter).Flush()
}

// Hijack preserves http.Hijacker for middleware/proxy compatibility.
func (w *contextWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return http.NewResponseController(w.ResponseWriter).Hijack()
}

// Push preserves http.Pusher for HTTP/2 response writers.
func (w *contextWriter) Push(target string, opts *http.PushOptions) error {
	if p, ok := w.ResponseWriter.(http.Pusher); ok {
		return p.Push(target, opts)
	}
	return http.ErrNotSupported
}

// ReadFrom preserves io.ReaderFrom fast paths used by net/http.
func (w *contextWriter) ReadFrom(r io.Reader) (int64, error) {
	if rf, ok := w.ResponseWriter.(io.ReaderFrom); ok {
		return rf.ReadFrom(r)
	}
	return io.Copy(w.ResponseWriter, r)
}

// ReadBody reads a request body through http.MaxBytesReader. It returns false
// after writing the appropriate problem response.
func ReadBody(w http.ResponseWriter, r *http.Request, maxBytes int64) ([]byte, bool) {
	if maxBytes > 0 {
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	}
	body, err := io.ReadAll(r.Body)
	if err == nil {
		return body, true
	}
	var maxErr *http.MaxBytesError
	if errors.As(err, &maxErr) {
		Error(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("request body exceeds %d bytes", maxErr.Limit), "request_body_too_large")
		return nil, false
	}
	Error(w, http.StatusBadRequest, "could not read request body", "bad_request")
	return nil, false
}

// DecodeJSON decodes exactly one JSON document from a MaxBytesReader-wrapped
// body. It rejects malformed JSON, trailing tokens, and over-limit bodies.
func DecodeJSON(w http.ResponseWriter, r *http.Request, maxBytes int64, dst any) bool {
	if maxBytes > 0 {
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	}
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			Error(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("request body exceeds %d bytes", maxErr.Limit), "request_body_too_large")
			return false
		}
		Error(w, http.StatusBadRequest, "invalid JSON body", "bad_request")
		return false
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		Error(w, http.StatusBadRequest, "request body must contain exactly one JSON document", "bad_request")
		return false
	}
	return true
}

// JSONContentType reports whether a Content-Type value is JSON.
func JSONContentType(value string) bool {
	mediaType, _, err := mime.ParseMediaType(value)
	if err != nil {
		return false
	}
	mediaType = strings.ToLower(mediaType)
	return mediaType == "application/json" || strings.HasSuffix(mediaType, "+json")
}

// IdempotencyKeyUUID returns a stable UUID for a metered POST when the caller
// supplies Idempotency-Key. Missing keys intentionally get a fresh UUID.
func IdempotencyKeyUUID(r *http.Request, subject string) uuid.UUID {
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" {
		return uuid.New()
	}
	if len(key) > 256 {
		key = key[:256]
	}
	name := subject + "\x00" + r.Method + "\x00" + r.URL.Path + "\x00" + key
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte(name))
}

// RequireIdempotencyKey enforces the Idempotency-Key header for metered writes.
func RequireIdempotencyKey(w http.ResponseWriter, r *http.Request) bool {
	if strings.TrimSpace(r.Header.Get("Idempotency-Key")) != "" {
		return true
	}
	Error(w, http.StatusPreconditionRequired, "Idempotency-Key header is required", "idempotency_key_required")
	return false
}
