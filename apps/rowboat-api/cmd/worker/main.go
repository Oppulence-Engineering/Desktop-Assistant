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
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentsessions"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentstream"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agenttoken"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/cloudevents"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/telemetry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/version"
	"github.com/prometheus/client_golang/prometheus/promhttp"
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

	// Shared vendor-facing dependencies, built ONCE before the redial loop
	// (rebuilding per dial leaked one Infisical-refresh goroutine per failed
	// w.Start). Static config errors (pricing, sealer) stay fatal; a transient
	// Infisical outage retries instead of crash-looping the whole worker. The
	// worker only runs with Temporal enabled (run guards it), and the durable
	// agent runtime + cloud runtime + event router all need these deps, so they
	// are built unconditionally.
	var deps *workerDeps
	{
		var err error
		for {
			deps, err = buildWorkerDeps(ctx, cfg, log, client)
			if err == nil {
				break
			}
			if !errors.Is(err, errInfisicalUnavailable) {
				return err // static config error: crash-loop is the right signal
			}
			if waitForRetry(ctx, log, "load infisical secrets", err, retryAfter) != nil {
				return nil
			}
		}
	}

	// Durable agent runtime (RFC 027) worker-side deps, built once: the
	// compiled-in capability catalog, the agent-definition loader, the approval
	// token signer, and an optional Redis event bus for live streaming fan-out.
	// The runtime is always active on the worker (no master flag); bus failures
	// degrade to durable-only (the projection is the source of truth), never fatal.
	var agentCatalog *agentregistry.Catalog
	var agentLoader *agentregistry.Loader
	var agentBus *agentstream.Bus
	var agentSigner *agenttoken.Signer
	{
		agentCatalog = agentregistry.DefaultCatalog()
		var lerr error
		agentLoader, lerr = agentregistry.NewLoader(client, agentCatalog)
		if lerr != nil {
			return fmt.Errorf("load agent definitions: %w", lerr)
		}
		if s, serr := agenttoken.NewSigner(cfg.AgentSigningSecret()); serr == nil {
			agentSigner = s
		} else {
			log.Warn("agent token signer unavailable; approval-token verification falls back to structural", zap.Error(serr))
		}
		if cfg.AgentStreamingEnabled && cfg.RedisURL != "" {
			if b, berr := agentstream.NewBus(ctx, cfg.RedisURL); berr == nil {
				agentBus = b
				defer func() { _ = agentBus.Close() }()
			} else {
				log.Warn("agent event bus unavailable; streaming falls back to durable-only", zap.Error(berr))
			}
		}
	}

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

		activities := &backgroundtaskworkflow.Activities{Client: client, Log: log}
		if cfg.CloudRuntimeEnabled && deps != nil {
			activities.Runtime = backgroundtaskruntime.NewDefault()
			activities.RuntimeLimits = backgroundtaskruntime.LimitsFromConfig(cfg)
			activities.LLM = deps.LLM
			activities.Sealer = deps.Sealer
			activities.Secrets = deps.Secrets
			activities.Google = deps.Google
			activities.DefaultModel = cfg.CloudRuntimeModel
			log.Info("cloud agent runtime enabled",
				zap.String("model", cfg.CloudRuntimeModel),
				zap.Duration("max_duration", cfg.CloudRuntimeMaxDuration),
				zap.Int("max_llm_calls", cfg.CloudRuntimeMaxLLMCalls),
				zap.Int("max_tool_calls", cfg.CloudRuntimeMaxToolCalls))
		} else {
			// Rollback path: the deterministic artifact, byte-identical to
			// pre-RFC-004 behavior.
			activities.Runtime = backgroundtaskruntime.NewNoop()
			log.Info("cloud agent runtime disabled; using deterministic NoopRuntime")
		}
		backgroundtaskworkflow.Register(w, activities)

		// The Starter is the one temporalClient-bound dependency, so it is
		// built per successful dial rather than carried in deps.
		starter := backgroundtaskruns.New(client, backgroundtaskworkflow.NewStarter(temporalClient, cfg), log)

		// RFC 005: register the Temporal Schedule action workflow
		// unconditionally — registration is inert with zero schedules, and
		// during a TEMPORAL_SCHEDULES_ENABLED=false backout in-flight fires
		// from still-existing schedules must execute rather than time out.
		backgroundtaskworkflow.RegisterScheduler(w, &backgroundtaskworkflow.ScheduleActivities{
			Runs:    starter,
			Log:     log,
			Enabled: cfg.TemporalSchedulesEnabled,
		})

		if cfg.CloudEventsRoutingEnabled && deps != nil {
			cloudevents.Register(w, &cloudevents.Activities{Router: &cloudevents.Router{
				Client:    client,
				LLM:       deps.LLM,
				Starter:   starter,
				Threshold: cfg.CloudEventsMatchThreshold,
				Model:     cfg.CloudEventsRouterModel,
				Log:       log,
			}, Log: log})
			log.Info("cloud event route workflow registered",
				zap.String("model", cfg.CloudEventsRouterModel),
				zap.Float64("threshold", cfg.CloudEventsMatchThreshold))
		}

		// RFC 027: register the durable agent runtime (session + subagent
		// workflows and their activities) — always on (no master flag). The loop
		// body — every LLM and tool call — now lives in workflow code; these
		// activities are the IO boundary it drives.
		if deps != nil && agentLoader != nil {
			var publisher agentworkflow.EventPublisher
			if agentBus != nil {
				publisher = agentBus
			}
			agentworkflow.Register(w, &agentworkflow.Activities{
				Client:         client,
				LLM:            deps.LLM,
				Catalog:        agentCatalog,
				Loader:         agentLoader,
				Publisher:      publisher,
				ApprovalSigner: agentSigner,
				RequireMFA:     cfg.AgentRequireMFAForMoneyMoving,
				Log:            log,
			})
			// RFC 027 P5: the scheduled-session action runs on the worker and
			// starts sessions through the canonical starter (which needs the
			// Temporal client this dial produced).
			agentworkflow.RegisterScheduler(w, &agentworkflow.ScheduleActivities{
				Starter: agentsessions.New(client, agentLoader, agentworkflow.NewStarter(temporalClient, cfg), cfg, log),
				Enabled: true,
				Log:     log,
			})
			log.Info("durable agent runtime registered",
				zap.String("model", cfg.AgentRuntimeModel),
				zap.Bool("hitl", cfg.AgentHITLEnabled),
				zap.Bool("subagents", cfg.AgentSubagentsEnabled),
				zap.Bool("streaming", cfg.AgentStreamingEnabled))
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

// errInfisicalUnavailable marks a transient secret-load failure the caller
// should retry, as opposed to a static config error worth crash-looping on.
var errInfisicalUnavailable = errors.New("infisical unavailable")

// workerDeps are the vendor-facing dependencies shared by the RFC 003 event
// router and the RFC 004 cloud runtime: the in-process LLM gateway (vendor
// secrets + pricing + the owner-billing quota gate), the payload sealer, and
// the Google API client. Built once per process — StartRefresh spawns a
// process-lifetime goroutine, so this must NOT run inside the redial loop.
type workerDeps struct {
	Secrets *secrets.Store
	LLM     *llm.Handler
	Sealer  *crypto.Sealer
	Google  *googleapi.Client
}

func buildWorkerDeps(ctx context.Context, cfg appconfig.Config, log *zap.Logger, client *ent.Client) (*workerDeps, error) {
	// Static config first: failures here can't be retried away.
	prices, err := pricing.LoadJSON([]byte(cfg.PricingJSON))
	if err != nil {
		return nil, err
	}
	sealer, err := crypto.NewSealer(cfg.DBEncryptionKey)
	if err != nil {
		return nil, err
	}

	sec := secrets.NewFromConfig(cfg)
	if err := sec.LoadInfisical(ctx, cfg); err != nil {
		if cfg.InfisicalEnabled && cfg.IsProduction() {
			return nil, fmt.Errorf("%w: %w", errInfisicalUnavailable, err)
		}
		log.Warn("infisical load failed; using env vendor keys", zap.Error(err))
	}
	sec.StartRefresh(ctx, cfg, 5*time.Minute, log)

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

	return &workerDeps{
		Secrets: sec,
		LLM:     llmH,
		Sealer:  sealer,
		Google: googleapi.New(googleapi.Config{
			TokenURL:        cfg.GoogleTokenURL,
			GmailBaseURL:    cfg.GmailAPIBaseURL,
			CalendarBaseURL: cfg.CalendarAPIBaseURL,
		}),
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
