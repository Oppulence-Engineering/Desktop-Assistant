// Command worker runs the Temporal worker for API-native background tasks.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/cloudevents"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/telemetry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/version"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	temporalsdk "go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.uber.org/zap"
)

func main() {
	cfg := appconfig.Load()
	cfg.ServiceName = "rowboat-api-worker"

	log, err := telemetry.NewLogger(cfg)
	if err != nil {
		panic(err)
	}

	if runErr := run(cfg, log); runErr != nil {
		log.Error("worker exited with error", zap.Error(runErr))
		_ = log.Sync()
		os.Exit(1)
	}
	_ = log.Sync()
}

func run(cfg appconfig.Config, log *zap.Logger) error {
	if err := cfg.Validate(); err != nil {
		return err
	}
	if !cfg.TemporalEnabled {
		return fmt.Errorf("TEMPORAL_ENABLED must be true for the worker")
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

	// Run lifecycle metrics are emitted from activities in this process, so the
	// worker must expose its own /metrics endpoint to be scrapeable.
	stopMetrics := startMetricsServer(cfg, log)
	defer stopMetrics()

	return runTemporalWorker(ctx, cfg, log, database.Client)
}

// startMetricsServer serves Prometheus /metrics (and a /healthz) on the worker's
// metrics port and returns a graceful-shutdown func.
func startMetricsServer(cfg appconfig.Config, log *zap.Logger) func() {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	srv := &http.Server{Addr: cfg.MetricsAddr, Handler: mux}
	go func() {
		log.Info("worker metrics listener starting", zap.String("addr", cfg.MetricsAddr))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("worker metrics listener failed", zap.Error(err))
		}
	}()
	return func() {
		shCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
		defer cancel()
		_ = srv.Shutdown(shCtx)
	}
}

func runTemporalWorker(ctx context.Context, cfg appconfig.Config, log *zap.Logger, client *ent.Client) error {
	log.Info("starting rowboat-api temporal worker",
		zap.String("build_info", version.String()),
		zap.String("temporal_address", cfg.TemporalAddress),
		zap.String("temporal_namespace", cfg.TemporalNamespace),
		zap.String("temporal_task_queue", cfg.TemporalTaskQueue),
	)

	retryAfter := 5 * time.Second
	for {
		dialCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		temporalClient, err := backgroundtaskworkflow.Dial(dialCtx, cfg)
		cancel()
		if err != nil {
			if waitForRetry(ctx, log, "dial temporal", err, retryAfter) != nil {
				return nil
			}
			continue
		}

		w := worker.New(temporalClient, cfg.TemporalTaskQueue, worker.Options{})
		backgroundtaskworkflow.Register(w, &backgroundtaskworkflow.Activities{
			Client:  client,
			Log:     log,
			Runtime: backgroundtaskruntime.NewNoop(), // full wiring lands with the deps builder
		})
		if cfg.CloudEventsRoutingEnabled {
			router, err := buildEventRouter(ctx, cfg, log, client, temporalClient)
			if err != nil {
				temporalClient.Close()
				return err
			}
			cloudevents.Register(w, &cloudevents.Activities{Router: router, Log: log})
			log.Info("cloud event route workflow registered",
				zap.String("model", cfg.CloudEventsRouterModel),
				zap.Float64("threshold", cfg.CloudEventsMatchThreshold))
		}

		if err := w.Start(); err != nil {
			temporalClient.Close()
			if waitForRetry(ctx, log, "start temporal worker", err, retryAfter) != nil {
				return nil
			}
			continue
		}

		log.Info("rowboat-api temporal worker started")
		<-ctx.Done()
		log.Info("shutdown signal received, stopping worker")
		w.Stop()
		temporalClient.Close()
		return nil
	}
}

// buildEventRouter assembles the RFC 003 routing activity's dependencies: the
// in-process LLM gateway (vendor secrets + pricing + the owner-billing quota
// gate) and the shared run Starter. This is the worker's first vendor-key
// surface — wire.go makes the same construction calls for the API process.
func buildEventRouter(ctx context.Context, cfg appconfig.Config, log *zap.Logger, client *ent.Client, temporalClient temporalsdk.Client) (*cloudevents.Router, error) {
	sec := secrets.NewFromConfig(cfg)
	if err := sec.LoadInfisical(ctx, cfg); err != nil {
		if cfg.InfisicalEnabled && cfg.IsProduction() {
			return nil, fmt.Errorf("infisical secret load failed in production: %w", err)
		}
		log.Warn("infisical load failed; using env vendor keys", zap.Error(err))
	}
	sec.StartRefresh(ctx, cfg, 5*time.Minute, log)

	prices, err := pricing.LoadJSON([]byte(cfg.PricingJSON))
	if err != nil {
		return nil, err
	}

	gate := quota.New(client, log)
	llmH := llm.New(prices, gate, sec, client, log)
	llmH.SetUpstreams(cfg.OpenAIBaseURL, cfg.OpenRouterBaseURL)
	llmPolicy := outbound.Policy{
		Timeout:               cfg.VendorTimeout,
		ResponseHeaderTimeout: cfg.VendorResponseHeaderTimeout,
		MaxConcurrent:         cfg.LLMMaxConcurrent,
		MaxResponseBytes:      cfg.UpstreamResponseMaxBytes,
	}
	llmH.SetOutboundPolicy(llmPolicy)
	llmH.SetPolicy(llm.Policy{
		SpendLimits: quota.SpendLimits{Daily: cfg.DailyCreditLimit, Monthly: cfg.MonthlyCreditLimit},
	})

	starter := backgroundtaskruns.New(client, backgroundtaskworkflow.NewStarter(temporalClient, cfg), log)
	return &cloudevents.Router{
		Client:    client,
		LLM:       llmH,
		Starter:   starter,
		Threshold: cfg.CloudEventsMatchThreshold,
		Model:     cfg.CloudEventsRouterModel,
		Log:       log,
	}, nil
}

func waitForRetry(ctx context.Context, log *zap.Logger, operation string, err error, delay time.Duration) error {
	log.Warn("temporal worker dependency unavailable; retrying",
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
