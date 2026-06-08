// Command scheduler runs the API-owned background-task scheduler (RFC 001): it
// evaluates cron/window triggers for executionTarget=api tasks inside the
// Rowboat API deployment so scheduled cloud runs fire while the desktop is
// offline. It deliberately mirrors cmd/worker: own process, own crash domain,
// own /metrics + /healthz, and a signal-aware loop. Runs are created through
// the shared backgroundtaskruns.Starter, so scheduler- and HTTP-initiated runs
// are indistinguishable downstream.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundscheduler"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/telemetry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/version"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.temporal.io/sdk/client"
	"go.uber.org/zap"
)

func main() {
	cfg := appconfig.Load()
	cfg.ServiceName = "rowboat-api-scheduler"

	log, err := telemetry.NewLogger(cfg)
	if err != nil {
		panic(err)
	}

	if runErr := run(cfg, log); runErr != nil {
		log.Error("scheduler exited with error", zap.Error(runErr))
		_ = log.Sync()
		os.Exit(1)
	}
	_ = log.Sync()
}

func run(cfg appconfig.Config, log *zap.Logger) error {
	if err := cfg.Validate(); err != nil {
		return err
	}
	// Disabled is a clean no-op exit, mirroring the worker's
	// TEMPORAL_WORKER_ENABLED guard so the Deployment can ship dark.
	if !cfg.CloudSchedulerEnabled {
		log.Info("CLOUD_SCHEDULER_ENABLED is false; scheduler exiting cleanly")
		return nil
	}
	if !cfg.TemporalEnabled {
		return fmt.Errorf("TEMPORAL_ENABLED must be true for the scheduler")
	}
	location, err := cfg.SchedulerLocation()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	shutdownTracer, err := telemetry.InitTracer(ctx, cfg)
	if err != nil {
		return err
	}
	defer func() {
		shCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
		defer cancel()
		_ = shutdownTracer(shCtx)
	}()

	database, err := db.Open(ctx, cfg, log)
	if err != nil {
		return err
	}
	defer func() { _ = database.Close() }()

	// The scheduler emits its own metrics, so it serves /metrics (and health
	// endpoints) on the metrics port. ready flips true only once Temporal is
	// connected and the loop is running.
	var ready atomic.Bool
	stopMetrics := startMetricsServer(cfg, log, &ready)
	defer stopMetrics()

	return runScheduler(ctx, cfg, log, database, location, &ready)
}

// startMetricsServer serves Prometheus /metrics, a liveness /healthz (200 once
// the process is up), and a readiness /readyz that is 200 only after Temporal is
// connected. Splitting the two means a scheduler stuck dialing Temporal reports
// NotReady (so a rolling deploy won't retire the old pod and alerts fire)
// without crash-looping on liveness.
func startMetricsServer(cfg appconfig.Config, log *zap.Logger, ready *atomic.Bool) func() {
	srv := &http.Server{Addr: cfg.MetricsAddr, Handler: newHealthMux(ready)}
	go func() {
		log.Info("scheduler metrics listener starting", zap.String("addr", cfg.MetricsAddr))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("scheduler metrics listener failed", zap.Error(err))
		}
	}()
	return func() {
		shCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
		defer cancel()
		_ = srv.Shutdown(shCtx)
	}
}

// newHealthMux builds the /metrics, liveness /healthz, and readiness /readyz
// routes. /healthz is 200 once the process is up; /readyz is 200 only after
// `ready` is set on the initial Temporal connect. `ready` is a one-way boot
// gate (it does not flip back on a mid-life Temporal outage — the loop keeps
// running and surfaces failures via cloud_scheduler_errors_total{stage=start}).
func newHealthMux(ready *atomic.Bool) *http.ServeMux {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		if !ready.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"status":"not_ready"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	return mux
}

func runScheduler(ctx context.Context, cfg appconfig.Config, log *zap.Logger, database *db.DB, location *time.Location, ready *atomic.Bool) error {
	log.Info("starting rowboat-api scheduler",
		zap.String("build_info", version.String()),
		zap.Duration("interval", cfg.CloudSchedulerInterval),
		zap.Duration("lease_ttl", cfg.CloudSchedulerLeaseTTL),
		zap.String("owner", cfg.CloudSchedulerOwner),
		zap.String("timezone", location.String()),
	)

	// Dial Temporal with the same retry-until-available loop as the worker, so
	// the scheduler tolerates Temporal coming up after it does.
	temporalClient, err := dialTemporal(ctx, cfg, log)
	if err != nil {
		return err
	}
	if temporalClient == nil {
		return nil // context cancelled during backoff
	}
	defer temporalClient.Close()

	// Temporal is connected — the scheduler can now create runs, so report ready.
	ready.Store(true)

	starter := backgroundtaskruns.New(database.Client, backgroundtaskworkflow.NewStarter(temporalClient, cfg), log)

	// EntLeases (RFC 002) is the durable Postgres lease: the unique cycle index
	// gives cross-replica at-most-once firing, so the scheduler is safe with
	// multiple replicas.
	leases := backgroundscheduler.NewEntLeases(database.Client, log)
	scheduler := backgroundscheduler.New(database.Client, starter, leases, backgroundscheduler.Config{
		Interval: cfg.CloudSchedulerInterval,
		LeaseTTL: cfg.CloudSchedulerLeaseTTL,
		Owner:    cfg.CloudSchedulerOwner,
		Location: location,
	}, log)

	return scheduler.Run(ctx)
}

// dialTemporal retries until Temporal is reachable or the context is cancelled.
// A nil client with a nil error means the context was cancelled during backoff
// (clean shutdown before Temporal came up).
func dialTemporal(ctx context.Context, cfg appconfig.Config, log *zap.Logger) (client.Client, error) {
	const retryAfter = 5 * time.Second
	for {
		dialCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		c, err := backgroundtaskworkflow.Dial(dialCtx, cfg)
		cancel()
		if err == nil {
			return c, nil
		}
		if waitForRetry(ctx, log, "dial temporal", err, retryAfter) != nil {
			return nil, nil
		}
	}
}

func waitForRetry(ctx context.Context, log *zap.Logger, operation string, err error, delay time.Duration) error {
	log.Warn("scheduler dependency unavailable; retrying",
		zap.String("operation", operation),
		zap.Duration("retry_after", delay),
		zap.Error(err),
	)
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
