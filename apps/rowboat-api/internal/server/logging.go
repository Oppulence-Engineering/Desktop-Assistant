package server

import (
	"net/http"
	"runtime/debug"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

// RequestLogger emits one structured JSON log line per request, enriched with
// the request id and (when present) the OTel trace id for correlation.
func RequestLogger(log *zap.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			start := time.Now()

			defer func() {
				fields := []zap.Field{
					zap.String("method", r.Method),
					zap.String("path", r.URL.Path),
					zap.Int("status", ww.Status()),
					zap.Int("bytes", ww.BytesWritten()),
					zap.Duration("duration", time.Since(start)),
					zap.String("request_id", middleware.GetReqID(r.Context())),
					zap.String("remote", r.RemoteAddr),
				}
				if sc := trace.SpanContextFromContext(r.Context()); sc.HasTraceID() {
					fields = append(fields, zap.String("trace_id", sc.TraceID().String()))
				}
				log.Info("http_request", fields...)
			}()

			next.ServeHTTP(ww, r)
		})
	}
}

// Recoverer converts panics into a 500 and logs the stack, keeping the process
// alive. It runs before the logger so the recovered request is still logged.
func Recoverer(log *zap.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil && rec != http.ErrAbortHandler {
					log.Error("panic recovered",
						zap.Any("panic", rec),
						zap.String("path", r.URL.Path),
						zap.ByteString("stack", debug.Stack()),
					)
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusInternalServerError)
					_, _ = w.Write([]byte(`{"error":"internal server error","code":"internal_error"}`))
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}
