// Command worker runs the Temporal worker for API-native background tasks.
package main

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/actions"
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
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectorcreds"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/faculties"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/hubspotapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slackclient"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slacktoken"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/telemetry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/version"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/websearch"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/workosauth"
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
	var ready atomic.Bool
	stopMetrics := startMetricsServer(cfg, log, &ready)
	defer stopMetrics()

	return runTemporalWorker(ctx, cfg, log, database.Client, &ready)
}

// startMetricsServer serves Prometheus /metrics (and a /healthz) on the worker's
// metrics port and returns a graceful-shutdown func.
func startMetricsServer(cfg appconfig.Config, log *zap.Logger, ready *atomic.Bool) func() {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		if ready == nil || !ready.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"status":"not_ready"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	srv := &http.Server{Addr: cfg.MetricsAddr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
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

func runTemporalWorker(ctx context.Context, cfg appconfig.Config, log *zap.Logger, client *ent.Client, ready *atomic.Bool) error {
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
	defer func() {
		if deps == nil || deps.MCPResolver == nil {
			return
		}
		deps.MCPResolver.BeginCredentialCustodyShutdown()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
		defer cancel()
		if err := deps.MCPResolver.CloseCredentialCustody(shutdownCtx); err != nil {
			log.Error("worker connector credential custody did not drain", zap.Error(err))
		}
	}()

	var sandboxExec backgroundtaskruntime.SandboxExecutor
	if cfg.CloudRuntimeEnabled && cfg.CloudRuntimeSandboxEnabled {
		ttlSeconds := cfg.CloudRuntimeSandboxTTLSeconds
		if ttlSeconds > math.MaxInt32 {
			return fmt.Errorf("CLOUD_RUNTIME_SANDBOX_TTL_SECONDS must be <= %d; got %d", math.MaxInt32, ttlSeconds)
		}
		sandboxCfg := backgroundtaskruntime.KubernetesSandboxConfig{
			Namespace:          cfg.CloudRuntimeSandboxNamespace,
			ServiceAccountName: cfg.CloudRuntimeSandboxServiceAccount,
			PollInterval:       cfg.CloudRuntimeSandboxPollInterval,
			TTLSeconds:         int32(ttlSeconds), //nolint:gosec // Explicit MaxInt32 bound above.
			CPURequest:         cfg.CloudRuntimeSandboxCPURequest,
			MemoryRequest:      cfg.CloudRuntimeSandboxMemoryRequest,
			CPULimit:           cfg.CloudRuntimeSandboxCPULimit,
			MemoryLimit:        cfg.CloudRuntimeSandboxMemoryLimit,
			WorkspaceSizeLimit: cfg.CloudRuntimeSandboxWorkspaceSize,
		}
		var err error
		backend := strings.TrimSpace(cfg.CloudRuntimeSandboxBackend)
		switch backend {
		case "kubernetes-job":
			sandboxExec, err = backgroundtaskruntime.NewKubernetesSandboxExecutor(sandboxCfg)
		case "argo-workflow":
			sandboxExec, err = backgroundtaskruntime.NewArgoSandboxExecutor(sandboxCfg)
		default:
			return fmt.Errorf("unsupported sandbox backend %q", cfg.CloudRuntimeSandboxBackend)
		}
		if err != nil {
			return fmt.Errorf("configure %s sandbox executor: %w", backend, err)
		}
		log.Info("cloud runtime sandbox enabled",
			zap.String("backend", backend),
			zap.String("image", cfg.CloudRuntimeSandboxImage),
			zap.Strings("allowed_images", cfg.CloudRuntimeSandboxAllowedImages),
			zap.Duration("max_duration", cfg.CloudRuntimeSandboxMaxDuration),
			zap.Int("max_output_bytes", cfg.CloudRuntimeSandboxMaxOutputBytes))
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
			return fmt.Errorf("configure agent token signer: %w", serr)
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

		// RFC 023 broker, shared by the propose-only runtime tool and the
		// cloud-event Watch leg. Nil when actions are disabled. No executor is
		// wired in the worker: it only proposes and closes loops; brokered
		// execution happens in the API server.
		var actionBroker *actions.Broker
		if cfg.ActionsEnabled {
			if signer, serr := actions.NewSigner(cfg.AgentSigningSecret()); serr != nil {
				log.Warn("actions enabled but signer unavailable; RFC 023 worker features disabled", zap.Error(serr))
			} else {
				actionBroker = actions.NewBroker(client, signer, nil, actions.Config{
					TokenTTL:                  cfg.ActionTokenTTL,
					WatchTimeout:              cfg.ActionWatchTimeout,
					RequireStepUpForFinancial: cfg.ActionRequireStepUpForFinancial,
				}, log)
			}
		}

		activities := &backgroundtaskworkflow.Activities{Client: client, Log: log}
		if cfg.CloudRuntimeEnabled && deps != nil {
			activities.Runtime = backgroundtaskruntime.NewDefault()
			activities.RuntimeLimits = backgroundtaskruntime.LimitsFromConfig(cfg)
			activities.LLM = deps.LLM
			activities.Sealer = deps.Sealer
			activities.Secrets = deps.Secrets
			activities.Google = deps.Google
			activities.HubSpot = hubspotapi.New(client, deps.Sealer, outbound.Policy{
				Timeout:          15 * time.Second,
				MaxConcurrent:    64,
				MaxResponseBytes: 4 << 20,
			})
			activities.Slack = slackclient.New(outbound.Policy{
				Timeout:          15 * time.Second,
				MaxConcurrent:    64,
				MaxResponseBytes: 1 << 20,
			})
			activities.SlackTokens = slacktoken.New(client, deps.Sealer, deps.Secrets, cfg.SlackTokenURL, outbound.Policy{
				Timeout:          15 * time.Second,
				MaxConcurrent:    64,
				MaxResponseBytes: 1 << 20,
			})
			activities.MCPResolver = deps.MCPResolver
			activities.MCP = deps.MCP
			activities.MCPConnectors = deps.MCPConnectors
			activities.MCPPolicies = deps.MCPPolicies
			activities.Web = websearch.New(cfg.WebSearchAPIURL, cfg.WebSearchAPIKey, outbound.Policy{Timeout: 20 * time.Second, MaxConcurrent: 32, MaxResponseBytes: 4 << 20})
			activities.Conduit = faculties.New("conduit", cfg.ConduitBaseURL, cfg.ServiceTokenIssuer, cfg.AgentSigningSecret(), outbound.Policy{Timeout: 30 * time.Second, MaxConcurrent: 16, MaxResponseBytes: 4 << 20})
			activities.Eigen = faculties.New("eigen", cfg.EigenBaseURL, cfg.ServiceTokenIssuer, cfg.AgentSigningSecret(), outbound.Policy{Timeout: 30 * time.Second, MaxConcurrent: 16, MaxResponseBytes: 4 << 20})
			activities.DefaultModel = cfg.CloudRuntimeModel
			activities.Sandbox = sandboxExec
			activities.SandboxTool = backgroundtaskruntime.SandboxToolConfig{
				Backend:        cfg.CloudRuntimeSandboxBackend,
				DefaultImage:   cfg.CloudRuntimeSandboxImage,
				AllowedImages:  cfg.CloudRuntimeSandboxAllowedImages,
				DefaultTimeout: cfg.CloudRuntimeSandboxMaxDuration,
				MaxTimeout:     cfg.CloudRuntimeSandboxMaxDuration,
				MaxScriptBytes: cfg.CloudRuntimeSandboxMaxScriptBytes,
				MaxOutputBytes: cfg.CloudRuntimeSandboxMaxOutputBytes,
			}
			// RFC 023: expose the propose-only action tool when actions are
			// enabled. The model can only propose; approval + brokered execution
			// happen in the API server.
			if actionBroker != nil {
				activities.ActionProposer = backgroundtaskworkflow.NewActionProposer(actionBroker, client)
				log.Info("closed-loop action proposing enabled (RFC 023)")
			}
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
		if deps != nil {
			starter.SetAdmission(backgroundtaskruns.AdmissionFromConfig(cfg, deps.Gate, deps.Prices))
		}

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
			router := &cloudevents.Router{
				Client:    client,
				LLM:       deps.LLM,
				Starter:   starter,
				Threshold: cfg.CloudEventsMatchThreshold,
				Model:     cfg.CloudEventsRouterModel,
				Log:       log,
			}
			// RFC 023 Watch leg: close the loop on product Act-seam return events.
			if actionBroker != nil {
				router.Watcher = actionWatcherAdapter{broker: actionBroker}
				log.Info("closed-loop action watch enabled (RFC 023)")
			}
			cloudevents.Register(w, &cloudevents.Activities{Router: router, Log: log})
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
				// RFC 027 channels round-trip + Slack-native tools: the Slack client
				// posts replies back into the originating thread and reads thread
				// history; the Sealer opens the team bot token for delivery and Creds
				// resolves the session owner's connector tokens for tools.
				Sealer: deps.Sealer,
				Slack: slackclient.New(outbound.Policy{
					Timeout:          15 * time.Second,
					MaxConcurrent:    64,
					MaxResponseBytes: 1 << 20,
				}),
				Creds: connectorcreds.New(client, deps.Sealer),
				SlackTokens: slacktoken.New(client, deps.Sealer, deps.Secrets, cfg.SlackTokenURL, outbound.Policy{
					Timeout:          15 * time.Second,
					MaxConcurrent:    64,
					MaxResponseBytes: 1 << 20,
				}),
				Secrets: deps.Secrets,
				Google:  deps.Google,
				HubSpot: hubspotapi.New(client, deps.Sealer, outbound.Policy{
					Timeout:          15 * time.Second,
					MaxConcurrent:    64,
					MaxResponseBytes: 4 << 20,
				}),
				Web:     websearch.New(cfg.WebSearchAPIURL, cfg.WebSearchAPIKey, outbound.Policy{Timeout: 20 * time.Second, MaxConcurrent: 32, MaxResponseBytes: 4 << 20}),
				Conduit: faculties.New("conduit", cfg.ConduitBaseURL, cfg.ServiceTokenIssuer, cfg.AgentSigningSecret(), outbound.Policy{Timeout: 30 * time.Second, MaxConcurrent: 16, MaxResponseBytes: 4 << 20}),
				Eigen:   faculties.New("eigen", cfg.EigenBaseURL, cfg.ServiceTokenIssuer, cfg.AgentSigningSecret(), outbound.Policy{Timeout: 30 * time.Second, MaxConcurrent: 16, MaxResponseBytes: 4 << 20}),
				Log:     log,
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
			ready.Store(false)
			temporalClient.Close()
			if waitForRetry(ctx, log, "start temporal worker", err, retryAfter) != nil {
				return nil
			}
			continue
		}

		ready.Store(true)
		log.Info("rowboat-api temporal worker started")
		<-ctx.Done()
		ready.Store(false)
		if deps != nil && deps.MCPResolver != nil {
			deps.MCPResolver.BeginCredentialCustodyShutdown()
		}
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
	Secrets       *secrets.Store
	LLM           *llm.Handler
	Sealer        *crypto.Sealer
	Google        *googleapi.Client
	MCPResolver   *connectors.MCPRuntimeResolver
	MCP           *backgroundtaskruntime.MCPHTTPClient
	MCPConnectors []string
	MCPPolicies   []backgroundtaskruntime.MCPConnectorPolicy
	Prices        *pricing.Table
	Gate          *quota.Gate
}

func buildWorkerDeps(ctx context.Context, cfg appconfig.Config, log *zap.Logger, client *ent.Client) (*workerDeps, error) {
	// Static config first: failures here can't be retried away.
	prices, err := pricing.LoadJSON([]byte(cfg.PricingJSON))
	if err != nil {
		return nil, err
	}
	sealer, err := workerColumnSealer(cfg)
	if err != nil {
		return nil, err
	}
	connectorRegistry, err := loadWorkerConnectorRegistry(cfg)
	if err != nil {
		return nil, err
	}
	mcpResolver := connectors.NewMCPRuntimeResolver(client, sealer, connectorRegistry, connectors.Config{
		OryPublicURL:          cfg.OryPublicURL,
		OryBrokerClientID:     cfg.OryBrokerClientID,
		OryBrokerClientSecret: cfg.OryBrokerClientSecret,
	})
	if strings.TrimSpace(cfg.BrokerTokenPrivateKey) != "" {
		resourceTokenIssuer, issuerErr := connectors.NewRSAResourceTokenIssuer(
			[]byte(cfg.BrokerTokenPrivateKey), cfg.BrokerTokenKeyID, cfg.BrokerTokenIssuer, cfg.BrokerTokenTTL,
			[]byte(cfg.BrokerTokenKeyringJSON),
		)
		if issuerErr != nil {
			return nil, fmt.Errorf("configure connector resource-token issuer: %w", issuerErr)
		}
		mcpResolver.SetResourceTokenIssuer(resourceTokenIssuer)
	} else if cfg.IsProduction() {
		return nil, fmt.Errorf("BROKER_TOKEN_PRIVATE_KEY_PEM is required in production")
	}
	mcpResolver.SetOutboundPolicy(outbound.Policy{
		Timeout:          15 * time.Second,
		MaxConcurrent:    64,
		MaxResponseBytes: 1 << 20,
	})
	refreshCache := workosauth.NewMemoryRefreshCache()
	if cfg.RedisURL != "" {
		rc, rcErr := workosauth.NewRedisRefreshCache(ctx, cfg.RedisURL)
		if rcErr != nil {
			if cfg.IsProduction() {
				return nil, fmt.Errorf("configure distributed connector refresh-token dedup: %w", rcErr)
			}
			log.Warn("connector refresh dedup falling back to in-memory cache", zap.Error(rcErr))
		} else {
			refreshCache = rc
		}
	}
	mcpResolver.SetRefreshDedup(refreshCache, sealer, log)

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
	llmH.SetUpstream(cfg.OpenRouterBaseURL)
	llmPolicy := outbound.Policy{
		Timeout:               cfg.VendorTimeout,
		ResponseHeaderTimeout: cfg.VendorResponseHeaderTimeout,
		MaxConcurrent:         cfg.LLMMaxConcurrent,
		MaxResponseBytes:      cfg.UpstreamResponseMaxBytes,
	}
	llmH.SetOutboundPolicy(llmPolicy)
	llmH.SetPolicy(llm.Policy{
		AllowedModels:          cfg.LLMAllowedModels,
		MaxPromptBytes:         cfg.LLMMaxPromptBytes,
		MaxToolPayloadBytes:    cfg.LLMMaxToolPayloadBytes,
		MaxMessages:            cfg.LLMMaxMessages,
		DefaultMaxOutputTokens: cfg.LLMDefaultMaxOutput,
		SpendLimits:            quota.SpendLimits{Daily: cfg.DailyCreditLimit, Monthly: cfg.MonthlyCreditLimit},
	})

	return &workerDeps{
		Secrets: sec,
		LLM:     llmH,
		Sealer:  sealer,
		Prices:  prices,
		Gate:    gate,
		Google: googleapi.New(googleapi.Config{
			TokenURL:        cfg.GoogleTokenURL,
			GmailBaseURL:    cfg.GmailAPIBaseURL,
			CalendarBaseURL: cfg.CalendarAPIBaseURL,
			DriveBaseURL:    cfg.DriveAPIBaseURL,
		}),
		MCPResolver:   mcpResolver,
		MCP:           backgroundtaskruntime.NewMCPHTTPClient(outbound.Policy{Timeout: 30 * time.Second, MaxConcurrent: 32, MaxResponseBytes: 4 << 20}),
		MCPConnectors: connectorNames(connectorRegistry),
		MCPPolicies:   mcpPolicies(connectorRegistry),
	}, nil
}

func loadWorkerConnectorRegistry(cfg appconfig.Config) (*connectors.Registry, error) {
	registry, err := connectors.LoadRegistryForEnvironment(
		[]byte(cfg.ConnectorsJSON), cfg.Environment, cfg.ConnectorEmergencyDisabled,
	)
	if err != nil {
		return nil, fmt.Errorf("load connector registry: %w", err)
	}
	if err := registry.ConfigureProductEntitlementsJSONWithOptions(
		cfg.ConnectorEntitlementURLsJSON, cfg.ConnectorEntitlementHMACKeysJSON,
		connectors.ProductEntitlementOptions{AllowLocalDevelopment: cfg.ConnectorAllowLocalEntitlementDevelopment},
	); err != nil {
		return nil, fmt.Errorf("configure connector product entitlements: %w", err)
	}
	return registry, nil
}

func workerColumnSealer(cfg appconfig.Config) (*crypto.Sealer, error) {
	primaryKeyID, keyring, err := cfg.DBEncryptionKeyring()
	if err != nil {
		return nil, fmt.Errorf("column encryption configuration: %w", err)
	}
	sealer, err := crypto.NewKeyringSealer(primaryKeyID, keyring)
	if err != nil {
		return nil, fmt.Errorf("build column encryption keyring: %w", err)
	}
	return sealer, nil
}

func connectorNames(registry *connectors.Registry) []string {
	if registry == nil {
		return nil
	}
	out := make([]string, 0, len(registry.List()))
	for _, c := range registry.List() {
		// HubSpot is an SDK-native connector. Never route it through the legacy
		// placeholder MCP host advertised to older desktop builds.
		if c.Name == "" || c.Name == "hubspot" || c.MCPURL == "" {
			continue
		}
		out = append(out, c.Name)
	}
	return out
}

func mcpPolicies(registry *connectors.Registry) []backgroundtaskruntime.MCPConnectorPolicy {
	if registry == nil {
		return nil
	}
	out := make([]backgroundtaskruntime.MCPConnectorPolicy, 0, len(registry.List()))
	for _, c := range registry.List() {
		if c.Name == "" || c.Name == "hubspot" || c.MCPURL == "" || len(c.MCPTools) == 0 {
			continue
		}
		policy := backgroundtaskruntime.MCPConnectorPolicy{Name: c.Name, Tools: make([]backgroundtaskruntime.MCPToolPolicy, 0, len(c.MCPTools))}
		for _, tool := range c.MCPTools {
			if tool.Name == "" {
				continue
			}
			policy.Tools = append(policy.Tools, backgroundtaskruntime.MCPToolPolicy{Name: tool.Name, TrustTier: tool.TrustTier})
		}
		if len(policy.Tools) > 0 {
			out = append(out, policy)
		}
	}
	return out
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
