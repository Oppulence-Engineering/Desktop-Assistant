// Package server owns the HTTP lifecycle: the chi router + middleware chain,
// the public listener, the separate metrics listener, health probes, and
// graceful shutdown. Feature packages mount their routes on Router().
package server

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

// ReadyCheck is a named readiness probe (e.g. a DB ping). It runs on /readyz.
type ReadyCheck struct {
	Name  string
	Check func(context.Context) error
}

// Server wraps the chi router and its listeners (HTTP, gRPC, metrics).
type Server struct {
	cfg    appconfig.Config
	log    *zap.Logger
	router *chi.Mux
	grpc   *grpc.Server

	mu     sync.RWMutex
	checks []ReadyCheck
}

// New builds the router with the baseline middleware chain
// (request-id → real-ip → recoverer → logger; otel wraps at the listener) and
// mounts the health probes.
func New(cfg appconfig.Config, log *zap.Logger) *Server {
	s := &Server{cfg: cfg, log: log, router: chi.NewRouter(), grpc: grpc.NewServer()}
	reflection.Register(s.grpc) // enables grpcurl / server reflection

	// NOTE: middleware.RealIP is intentionally omitted — it trusts
	// X-Forwarded-For / X-Real-IP unconditionally and is spoofable. Rate limits
	// are keyed by authenticated user_id, not client IP, so we don't need it.
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

// AddReadyCheck registers a readiness probe consulted by /readyz.
func (s *Server) AddReadyCheck(name string, check func(context.Context) error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checks = append(s.checks, ReadyCheck{Name: name, Check: check})
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
	httpSrv := &http.Server{
		Addr:         s.cfg.HTTPAddr,
		Handler:      otelhttp.NewHandler(s.router, "rowboat-api"),
		ReadTimeout:  s.cfg.ReadTimeout,
		WriteTimeout: s.cfg.WriteTimeout,
		IdleTimeout:  s.cfg.IdleTimeout,
		BaseContext:  func(net.Listener) context.Context { return ctx },
	}

	metricsMux := http.NewServeMux()
	metricsMux.Handle("/metrics", promhttp.Handler())
	metricsSrv := &http.Server{
		Addr:         s.cfg.MetricsAddr,
		Handler:      metricsMux,
		ReadTimeout:  s.cfg.ReadTimeout,
		WriteTimeout: s.cfg.WriteTimeout,
		IdleTimeout:  s.cfg.IdleTimeout,
		BaseContext:  func(net.Listener) context.Context { return ctx },
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

	s.grpc.GracefulStop()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), s.cfg.ShutdownTimeout)
	defer cancel()
	_ = metricsSrv.Shutdown(shutdownCtx)
	return httpSrv.Shutdown(shutdownCtx)
}
