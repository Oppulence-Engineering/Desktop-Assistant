// Package server owns the HTTP lifecycle: the chi router + middleware chain,
// the public listener, the separate metrics listener, health probes, and
// graceful shutdown. Feature packages mount their routes on Router().
package server

import (
	"context"
	"crypto/subtle"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"
)

// ReadyCheck is a named readiness probe (e.g. a DB ping). It runs on /readyz.
type ReadyCheck struct {
	Name  string
	Check func(context.Context) error
}

// namedCloser is a cleanup function run during graceful shutdown.
type namedCloser struct {
	name  string
	close func() error
}

// Server wraps the chi router and its listeners (HTTP, gRPC, metrics).
type Server struct {
	cfg    appconfig.Config
	log    *zap.Logger
	router *chi.Mux
	grpc   *grpc.Server

	mu      sync.RWMutex
	checks  []ReadyCheck
	closers []namedCloser
}

// New builds the router with the baseline middleware chain
// (request-id → real-ip → recoverer → logger; otel wraps at the listener) and
// mounts the health probes.
func New(cfg appconfig.Config, log *zap.Logger) *Server {
	s := &Server{cfg: cfg, log: log, router: chi.NewRouter(), grpc: newGRPCServer(cfg, log)}

	// Server reflection (grpcurl) advertises the full service/method surface and
	// must stay off in production; the entproto UserService it exposes is not
	// tenant-scoped. Register it only in non-production environments.
	if !cfg.IsProduction() {
		reflection.Register(s.grpc) // enables grpcurl / server reflection (dev only)
	}

	// NOTE: chi's middleware.RealIP is intentionally NOT used — it trusts
	// X-Forwarded-For unconditionally and is spoofable. Pre-auth rate limits
	// (sign-in, OAuth front door) key on the client IP, so behind an ingress we
	// recover it from XFF only when the direct peer is a configured trusted
	// proxy. With no TRUSTED_PROXY_CIDRS configured this is a no-op.
	s.router.Use(RealIPFromTrustedProxies(cfg.TrustedProxyCIDRs))
	s.router.Use(middleware.RequestID)
	s.router.Use(RequestContext)
	s.router.Use(Recoverer(log))
	s.router.Use(RequestLogger(log))
	s.router.Use(SecurityHeaders(cfg))
	s.router.Use(CORS(cfg))
	s.router.Use(NoCache)
	s.router.Use(RequestTimeout(cfg.RequestTimeout))
	s.router.Use(MaxRequestBody(cfg.MaxRequestBody))
	s.router.Use(RequireJSONContentType)

	s.router.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		httpx.Error(w, http.StatusNotFound, "not found", "not_found")
	})
	s.router.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
		httpx.Error(w, http.StatusMethodNotAllowed, "method not allowed", "method_not_allowed")
	})

	s.router.Get("/healthz", s.handleHealthz)
	s.router.Get("/readyz", s.handleReadyz)

	return s
}

// Router exposes the chi router so feature packages can mount routes.
func (s *Server) Router() chi.Router { return s.router }

// GRPCServer exposes the gRPC server so feature packages can register services
// (e.g. the entproto-generated UserService). Listens on cfg.GRPCAddr.
func (s *Server) GRPCServer() *grpc.Server { return s.grpc }

// grpcAuthMetadataKey is the incoming-metadata key carrying the internal shared
// secret. gRPC normalises metadata keys to lower-case.
const grpcAuthMetadataKey = "authorization"

// newGRPCServer builds the gRPC server, installing an auth interceptor that
// requires the internal shared secret (the same secret guarding the HTTP
// /v1/internal/* and /graphql endpoints). The entproto UserService it hosts is
// NOT tenant-scoped, so an unauthenticated gRPC port would let anyone List/Get
// every user.
//
// When the secret is empty, the server fails CLOSED (every call is rejected)
// in all environments except development: production config validation
// requires INTERNAL_API_SECRET, but staging and other deployed non-production
// environments do not, and a skipped interceptor there would expose the full
// user table. Only explicit development keeps the open-for-local-dev behavior.
func newGRPCServer(cfg appconfig.Config, log *zap.Logger) *grpc.Server {
	secret := cfg.InternalAPISecret
	if secret == "" {
		if cfg.IsDevelopment() {
			log.Warn("gRPC server is UNAUTHENTICATED: INTERNAL_API_SECRET is not set (acceptable for local dev only)")
			return grpc.NewServer()
		}
		log.Error("gRPC server REJECTING ALL CALLS: INTERNAL_API_SECRET is not set in a non-development environment")
		reject := func() error {
			return status.Error(codes.Unauthenticated, "INTERNAL_API_SECRET is not configured")
		}
		return grpc.NewServer(
			grpc.ChainUnaryInterceptor(func(context.Context, any, *grpc.UnaryServerInfo, grpc.UnaryHandler) (any, error) {
				return nil, reject()
			}),
			grpc.ChainStreamInterceptor(func(any, grpc.ServerStream, *grpc.StreamServerInfo, grpc.StreamHandler) error {
				return reject()
			}),
		)
	}
	return grpc.NewServer(
		grpc.ChainUnaryInterceptor(grpcInternalSecretUnaryInterceptor(secret)),
		grpc.ChainStreamInterceptor(grpcInternalSecretStreamInterceptor(secret)),
	)
}

// exemptStreamWriteDeadline clears the per-connection write deadline for
// long-lived streaming routes (the same set RequestTimeout exempts). The
// server-wide WriteTimeout is a hard deadline on the whole response, so
// without this any LLM SSE completion or events stream outliving it is
// severed mid-write. This wraps OUTSIDE otelhttp so it sees the raw
// ResponseWriter, where ResponseController can reach the connection.
func exemptStreamWriteDeadline(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if skipRequestTimeout(r.URL.Path) {
			_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
		}
		next.ServeHTTP(w, r)
	})
}

// grpcInternalSecretUnaryInterceptor rejects unary calls that do not present
// the internal shared secret in the authorization metadata.
func grpcInternalSecretUnaryInterceptor(secret string) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if err := checkGRPCInternalSecret(ctx, secret); err != nil {
			return nil, err
		}
		return handler(ctx, req)
	}
}

// grpcInternalSecretStreamInterceptor rejects streaming calls that do not
// present the internal shared secret in the authorization metadata.
func grpcInternalSecretStreamInterceptor(secret string) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, _ *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if err := checkGRPCInternalSecret(ss.Context(), secret); err != nil {
			return err
		}
		return handler(srv, ss)
	}
}

// checkGRPCInternalSecret authorises an incoming gRPC call by constant-time
// comparing the authorization metadata value to the internal shared secret.
func checkGRPCInternalSecret(ctx context.Context, secret string) error {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return status.Error(codes.Unauthenticated, "missing metadata")
	}
	vals := md.Get(grpcAuthMetadataKey)
	if len(vals) == 0 {
		return status.Error(codes.Unauthenticated, "missing internal secret")
	}
	if subtle.ConstantTimeCompare([]byte(vals[0]), []byte(secret)) != 1 {
		return status.Error(codes.Unauthenticated, "invalid internal secret")
	}
	return nil
}

// AddReadyCheck registers a readiness probe consulted by /readyz.
func (s *Server) AddReadyCheck(name string, check func(context.Context) error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checks = append(s.checks, ReadyCheck{Name: name, Check: check})
}

// AddCloser registers a cleanup function invoked during graceful shutdown,
// after the HTTP + gRPC listeners have drained. Closers run in LIFO order
// (mirroring defer semantics) so dependants close before their dependencies.
func (s *Server) AddCloser(name string, closeFn func() error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closers = append(s.closers, namedCloser{name: name, close: closeFn})
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

func (s *Server) handleReadyz(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	checks := append([]ReadyCheck(nil), s.checks...)
	s.mu.RUnlock()

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.ReadinessTimeout)
	defer cancel()

	for _, c := range checks {
		if err := c.Check(ctx); err != nil {
			s.log.Warn("readiness check failed", zap.String("check", c.Name), zap.Error(err))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"status":"not_ready","failed":"` + c.Name + `"}`))
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ready"}`))
}

// Run starts the public + metrics listeners and blocks until ctx is cancelled,
// then drains in-flight requests within ShutdownTimeout.
func (s *Server) Run(ctx context.Context) error {
	// BaseContext must NOT be the signal-cancelled ctx: every request context
	// derives from it, so a SIGTERM would instantly cancel all in-flight
	// requests (500s / truncated streams on every deploy) before Shutdown gets
	// a chance to drain them. Detach cancellation but keep ctx's values.
	baseCtx := context.WithoutCancel(ctx)
	httpSrv := &http.Server{
		Addr:         s.cfg.HTTPAddr,
		Handler:      exemptStreamWriteDeadline(otelhttp.NewHandler(s.router, "rowboat-api")),
		ReadTimeout:  s.cfg.ReadTimeout,
		WriteTimeout: s.cfg.WriteTimeout,
		IdleTimeout:  s.cfg.IdleTimeout,
		BaseContext:  func(net.Listener) context.Context { return baseCtx },
	}

	metricsMux := http.NewServeMux()
	metricsMux.Handle("/metrics", promhttp.Handler())
	metricsSrv := &http.Server{
		Addr:         s.cfg.MetricsAddr,
		Handler:      metricsMux,
		ReadTimeout:  s.cfg.ReadTimeout,
		WriteTimeout: s.cfg.WriteTimeout,
		IdleTimeout:  s.cfg.IdleTimeout,
		BaseContext:  func(net.Listener) context.Context { return baseCtx },
	}

	errCh := make(chan error, 3)
	go func() {
		s.log.Info("http listener starting", zap.String("addr", s.cfg.HTTPAddr))
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()
	go func() {
		s.log.Info("metrics listener starting", zap.String("addr", s.cfg.MetricsAddr))
		if err := metricsSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()
	if s.cfg.GRPCAddr != "" {
		go func() {
			lis, err := net.Listen("tcp", s.cfg.GRPCAddr)
			if err != nil {
				errCh <- err
				return
			}
			s.log.Info("grpc listener starting", zap.String("addr", s.cfg.GRPCAddr))
			if err := s.grpc.Serve(lis); err != nil && !errors.Is(err, grpc.ErrServerStopped) {
				errCh <- err
			}
		}()
	}

	select {
	case <-ctx.Done():
		s.log.Info("shutdown signal received, draining")
	case err := <-errCh:
		return err
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), s.cfg.ShutdownTimeout)
	defer cancel()

	// GracefulStop has no deadline of its own: a stuck gRPC call would stall
	// shutdown past the pod's termination grace and get the process SIGKILLed
	// with HTTP requests still in flight. Bound it by ShutdownTimeout and fall
	// back to a hard Stop, draining HTTP concurrently.
	grpcDone := make(chan struct{})
	go func() {
		s.grpc.GracefulStop()
		close(grpcDone)
	}()

	_ = metricsSrv.Shutdown(shutdownCtx)
	httpErr := httpSrv.Shutdown(shutdownCtx)

	select {
	case <-grpcDone:
	case <-shutdownCtx.Done():
		s.log.Warn("grpc graceful stop timed out; forcing stop")
		s.grpc.Stop()
		<-grpcDone
	}

	// Release registered resources (DB pool, etc.) now that the listeners have
	// drained, in LIFO order so dependants close before their dependencies.
	s.mu.RLock()
	closers := append([]namedCloser(nil), s.closers...)
	s.mu.RUnlock()
	for i := len(closers) - 1; i >= 0; i-- {
		if err := closers[i].close(); err != nil {
			s.log.Warn("closer failed during shutdown", zap.String("closer", closers[i].name), zap.Error(err))
		}
	}
	return httpErr
}
