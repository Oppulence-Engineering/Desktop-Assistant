package main

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/proto/entpb"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtasks"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskschedule"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/billing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/cloudevents"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/composio"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/config"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/docs"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/feedback"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/google"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/gqlapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/minutes"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/ratelimit"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/search"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/server"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slack"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/transcription"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/voice"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/workosauth"
	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	"github.com/go-chi/chi/v5"
	temporalsdk "go.temporal.io/sdk/client"
	"go.uber.org/zap"
)

// mountRoutes is the composition root: it constructs shared dependencies and
// mounts each feature router onto the server. Milestones extend this function.
func mountRoutes(ctx context.Context, srv *server.Server, cfg appconfig.Config, log *zap.Logger) error {
	// --- Database -----------------------------------------------------------
	database, err := db.Open(ctx, cfg, log)
	if err != nil {
		return err
	}
	srv.AddReadyCheck("database", database.Ping)
	// Close the connection pool on graceful shutdown (after listeners drain).
	srv.AddCloser("database", database.Close)
	client := database.Client

	// gRPC: entproto-generated UserService on cfg.GRPCAddr (:8081).
	entpb.RegisterUserServiceServer(srv.GRPCServer(), entpb.NewUserService(client))

	// --- Secrets (vendor keys) ---------------------------------------------
	sec := secrets.NewFromConfig(cfg)
	if err := sec.LoadInfisical(ctx, cfg); err != nil {
		// In production with Infisical enabled, a boot-time load failure leaves
		// the server with no vendor keys while still passing readiness. Fail the
		// boot instead of silently degrading. In dev (or when Infisical is
		// disabled) the env-var fallback is expected, so just warn.
		if cfg.InfisicalEnabled && cfg.IsProduction() {
			return fmt.Errorf("infisical secret load failed in production: %w", err)
		}
		log.Warn("infisical load failed; using env vendor keys", zap.Error(err))
	}
	sec.StartRefresh(ctx, cfg, 5*time.Minute, log)

	// --- Pricing ------------------------------------------------------------
	prices, err := pricing.LoadJSON([]byte(cfg.PricingJSON))
	if err != nil {
		return err
	}

	// --- Column encryption --------------------------------------------------
	sealer, err := crypto.NewSealer(cfg.DBEncryptionKey)
	if err != nil {
		return err
	}

	// --- Quota + rate limiting ---------------------------------------------
	gate := quota.New(client, log)
	rl, err := ratelimit.NewManager(ctx, cfg.RedisURL, cfg.IsProduction(), log)
	if err != nil {
		return err
	}

	// --- Auth ---------------------------------------------------------------
	// Build the JWT verifier tolerantly: if the JWKS can't be fetched at boot
	// (e.g. local dev with no IdP), the service still starts and authed routes
	// return 503 until the IdP is reachable.
	var verifier *oauthrs.Verifier
	// Pass the long-lived server ctx (NOT a soon-cancelled one): it drives the
	// background JWKS refresh goroutine, which must outlive boot so the verifier
	// can pick up the IdP's rotated signing keys. oauthrs.New bounds its own
	// boot-time HTTP fetches internally, so this won't hang startup.
	v, verr := oauthrs.New(ctx, oauthrs.Config{
		IssuerURL:      cfg.TokenIssuer,
		Audience:       cfg.TokenAudience,
		JWKSURL:        cfg.JWKSURL,
		AcceptableSkew: 60 * time.Second,
	})
	if verr != nil {
		log.Warn("auth verifier unavailable; authed routes will return 503 until JWKS is reachable", zap.Error(verr))
	} else {
		verifier = v
	}
	// The verifier only enforces iss/aud when configured; surface a disabled
	// check loudly so a deployment that accidentally blanks one doesn't silently
	// accept tokens minted for a different issuer/audience.
	if cfg.TokenIssuer == "" {
		log.Warn("TOKEN_ISSUER is empty: JWT issuer check is DISABLED")
	}
	if cfg.TokenAudience == "" {
		log.Warn("TOKEN_AUDIENCE is empty: JWT audience check is DISABLED (expected for WorkOS-direct tokens)")
	}
	enricher := auth.NewWorkOSEnricher(cfg.WorkOSAPIKey)
	authMW := auth.NewMiddleware(verifier, client, enricher, cfg.FreeTierCredits, log)

	// --- Handlers -----------------------------------------------------------
	configH := config.New(cfg)
	docsH := docs.New()
	billingH := billing.New(client, cfg.FreeTierCredits, cfg.DailyCreditLimit, database.Cached, log)
	backgroundTasksH := backgroundtasks.New(client, log)
	// temporalClient outlives this block: the cloud-events route starter below
	// reuses the same connection. Closed on shutdown by the goroutine.
	var temporalClient temporalsdk.Client
	if cfg.TemporalEnabled {
		temporalClient, err = dialTemporalWithRetry(ctx, cfg, log)
		if err != nil {
			return err
		}
		backgroundTasksH.SetTemporal(backgroundtaskworkflow.NewStarter(temporalClient, cfg))
		if cfg.TemporalSchedulesEnabled {
			// RFC 005: task create/patch/delete converge a Temporal Schedule
			// for exact-cron api-target tasks.
			backgroundTasksH.SetSchedules(&backgroundtaskschedule.Syncer{
				Client:  client,
				Manager: backgroundtaskschedule.NewTemporalManager(temporalClient, cfg, log),
				Cfg:     cfg,
				Log:     log,
			})
		}
		srv.AddReadyCheck("temporal", func(ctx context.Context) error {
			_, err := temporalClient.CheckHealth(ctx, nil)
			return err
		})
		go func() {
			<-ctx.Done()
			temporalClient.Close()
		}()
	}
	llmH := llm.New(prices, gate, sec, client, log)
	llmH.SetUpstreams(cfg.OpenAIBaseURL, cfg.OpenRouterBaseURL) // empty → provider defaults
	spendLimits := quota.SpendLimits{Daily: cfg.DailyCreditLimit, Monthly: cfg.MonthlyCreditLimit}
	vendorPolicy := outbound.Policy{
		Timeout:               cfg.VendorTimeout,
		ResponseHeaderTimeout: cfg.VendorResponseHeaderTimeout,
		MaxConcurrent:         cfg.VendorMaxConcurrent,
		MaxResponseBytes:      cfg.UpstreamResponseMaxBytes,
	}
	llmPolicy := vendorPolicy
	llmPolicy.MaxConcurrent = cfg.LLMMaxConcurrent
	llmH.SetOutboundPolicy(llmPolicy)
	llmH.SetPolicy(llm.Policy{
		AllowedModels:       cfg.LLMAllowedModels,
		MaxPromptBytes:      cfg.LLMMaxPromptBytes,
		MaxToolPayloadBytes: cfg.LLMMaxToolPayloadBytes,
		MaxMessages:         cfg.LLMMaxMessages,
		SpendLimits:         spendLimits,
	})
	voiceH := voice.New(prices, gate, sec, log)
	voiceH.SetOutboundPolicy(vendorPolicy)
	voiceH.SetSpendLimits(spendLimits)
	searchH := search.New(prices, gate, sec, log)
	searchH.SetOutboundPolicy(vendorPolicy)
	searchH.SetSpendLimits(spendLimits)

	// Free cloud meeting-minutes quota (RFC 009 §16). Paid plans are unlimited;
	// free is metered against FreeMeetingSecondsPerMonth, surfaced to the desktop.
	meetingAllowance := func(plan string) int {
		switch plan {
		case "starter", "pro":
			return -1 // unlimited cloud meeting minutes
		default:
			return cfg.FreeMeetingSecondsPerMonth
		}
	}
	transcriptionH := transcription.New(minutes.New(client, log, meetingAllowance), client, cfg, log)
	googleH := google.New(client, sealer, sec, log)
	googleH.SetOutboundPolicy(vendorPolicy)
	googleH.SetTokenURL(cfg.GoogleTokenURL) // empty → real Google endpoint
	googleRedirect := cfg.GoogleRedirectURI
	if googleRedirect == "" {
		googleRedirect = strings.TrimRight(cfg.AppURL, "/") + "/oauth/google/callback"
	}
	googleH.SetOAuthFlow(cfg.GoogleAuthorizeURL, googleRedirect, cfg.DesktopDeepLinkScheme, nil)
	workosH := workosauth.New(cfg.WorkOSClientID, cfg.WorkOSAPIKey, cfg.WorkOSBaseURL, cfg.WorkOSAuthorizeBaseURL, log)
	workosH.SetOutboundPolicy(vendorPolicy)
	// Idempotent refresh: WorkOS refresh tokens are rotating/single-use, so
	// duplicate or replayed refreshes must return the cached rotated bundle
	// instead of burning the session (see workosauth.SetRefreshDedup).
	refreshCache := workosauth.NewMemoryRefreshCache()
	if cfg.RedisURL != "" {
		if rc, rcErr := workosauth.NewRedisRefreshCache(ctx, cfg.RedisURL); rcErr == nil {
			refreshCache = rc
		} else {
			log.Warn("workos refresh dedup falling back to in-memory cache", zap.Error(rcErr))
		}
	}
	workosH.SetRefreshDedup(refreshCache, sealer)
	slackH := slack.New(client, sealer, sec, log)
	slackH.SetOutboundPolicy(vendorPolicy)
	slackRedirect := cfg.SlackRedirectURI
	if slackRedirect == "" {
		slackRedirect = strings.TrimRight(cfg.AppURL, "/") + "/oauth/slack/callback"
	}
	slackH.SetOAuthFlow(cfg.SlackAuthorizeURL, cfg.SlackTokenURL, slackRedirect, cfg.DesktopDeepLinkScheme, cfg.SlackOAuthScopes)
	composioH := composio.New(client, sec, log)
	composioPolicy := vendorPolicy
	composioPolicy.MaxResponseBytes = cfg.ComposioResponseMaxBytes
	composioH.SetOutboundPolicy(composioPolicy)

	// Cloud event ingestion (RFC 003). The route controller is wired only when
	// routing is enabled (it needs Temporal); without it events are stored with
	// routing_status=skipped.
	var routeCtl cloudevents.RouteController
	if cfg.CloudEventsRoutingEnabled && temporalClient != nil {
		routeCtl = cloudevents.NewRouteStarter(temporalClient, cfg)
	}
	cloudEventsH := cloudevents.New(client, sealer, routeCtl, cloudevents.Config{
		MaxPayloadBytes:    cfg.CloudEventsMaxPayloadBytes,
		SlackSigningSecret: cfg.SlackSigningSecret,
		GoogleWebhookToken: cfg.GoogleWebhookToken,
	}, log)

	registry, err := connectors.LoadRegistry([]byte(cfg.ConnectorsJSON))
	if err != nil {
		return err
	}
	connectorsH := connectors.New(client, sealer, registry, connectors.Config{
		OryPublicURL:          cfg.OryPublicURL,
		OryBrokerClientID:     cfg.OryBrokerClientID,
		OryBrokerClientSecret: cfg.OryBrokerClientSecret,
		PublicBaseURL:         cfg.PublicBaseURL,
		DeepLinkScheme:        cfg.DesktopDeepLinkScheme,
	}, log)
	connectorsH.SetOutboundPolicy(vendorPolicy)

	plainLabels, err := feedback.ParseLabelMap(cfg.PlainLabelTypeIDs)
	if err != nil {
		return err
	}
	feedbackH := feedback.New(sec, client, feedback.Config{
		BaseURL:      cfg.PlainAPIURL,
		LabelTypeIDs: plainLabels,
		TitlePrefix:  cfg.PlainTitlePrefix,
	}, log)
	feedbackH.SetOutboundPolicy(vendorPolicy)

	r := srv.Router()

	// Public (no auth).
	r.Get("/docs", docsH.Scalar)
	r.Get("/docs/", docsH.Scalar)
	r.Get("/openapi.json", docsH.OpenAPI)
	r.Get("/docs/openapi.json", docsH.OpenAPI)
	r.Get("/v1/config", configH.Config)

	// WorkOS sign-in broker (public: the caller has no bearer yet; the
	// credential is the WorkOS code/refresh token + the server-held API key).
	r.Route("/v1/auth/workos", func(r chi.Router) {
		r.Use(rl.PerUserWindow(ratelimit.GroupAuth, 30, time.Minute))
		r.Use(rl.PerUserWindow(ratelimit.GroupAuth+":burst", 5, 10*time.Second))
		r.Get("/login-url", workosH.LoginURL)
		r.Post("/exchange", workosH.Exchange)
		r.Post("/refresh", workosH.Refresh)
	})
	// OAuth callback is a browser redirect from Ory (no bearer); the user is
	// resolved from the sealed pending ticket inside the handler.
	r.Get("/v1/connections/{name}/callback", connectorsH.Callback)

	// Google OAuth front door (browser-facing, no bearer): the desktop opens
	// /oauth/google/start; the callback parks tokens for /v1/google-oauth/claim.
	r.With(rl.PerUserWindow(ratelimit.GroupAuth, 30, time.Minute)).
		Get("/oauth/google/start", googleH.Start)
	r.With(rl.PerUserWindow(ratelimit.GroupAuth, 30, time.Minute)).
		Get("/oauth/google/callback", googleH.Callback)

	// Slack workspace install front door (browser-facing, no bearer): the
	// callback parks the sealed bundle for /v1/slack-oauth/claim, which writes
	// the team_id→user mapping the Slack webhook resolves against.
	r.With(rl.PerUserWindow(ratelimit.GroupAuth, 30, time.Minute)).
		Get("/oauth/slack/start", slackH.Start)
	r.With(rl.PerUserWindow(ratelimit.GroupAuth, 30, time.Minute)).
		Get("/oauth/slack/callback", slackH.Callback)

	// Provider event webhooks (public: providers carry no bearer; each handler
	// verifies its own credential before ingesting). Pre-auth, so the rate
	// limit keys on the client IP recovered by RealIPFromTrustedProxies.
	r.With(rl.PerUserWindow(ratelimit.GroupWebhooks, 240, time.Minute)).
		Post("/v1/webhooks/google", cloudEventsH.GoogleWebhook)
	r.With(rl.PerUserWindow(ratelimit.GroupWebhooks, 240, time.Minute)).
		Post("/v1/webhooks/slack", cloudEventsH.SlackWebhook)

	// Ory pre-consent webhook (shared-secret HMAC, not a user bearer).
	r.With(rl.PerUserWindow(ratelimit.GroupInternal, 120, time.Minute), auth.RequireHookHMAC(cfg.HookHMACSecret)).
		Post("/oauth-hooks/pre-consent", connectorsH.PreConsent)

	// Server-to-server internal API (static shared secret).
	r.With(rl.PerUserWindow(ratelimit.GroupInternal, 120, time.Minute), auth.RequireInternalSecret(cfg.InternalAPISecret)).
		Post("/v1/internal/connections/invalidate", connectorsH.Invalidate)
	r.With(rl.PerUserWindow(ratelimit.GroupInternal, 120, time.Minute), auth.RequireInternalSecret(cfg.InternalAPISecret)).
		Post("/v1/internal/events", cloudEventsH.IngestInternal)

	// Admin GraphQL (entgql + gqlgen) over the full entity graph. Guarded by
	// the internal secret, which also marks the context internal so the
	// resolvers' ent queries bypass per-user tenant scoping.
	r.With(rl.PerUserWindow(ratelimit.GroupInternal, 60, time.Minute), auth.RequireInternalSecret(cfg.InternalAPISecret)).
		Handle("/graphql", gqlapi.NewHandler(client, gqlapi.HandlerOptions{
			Introspection: cfg.GraphQLIntrospection,
			MaxComplexity: cfg.GraphQLMaxComplexity,
			MaxDepth:      cfg.GraphQLMaxDepth,
		}))

	// Authenticated surface (Ory/WorkOS bearer required).
	r.Group(func(r chi.Router) {
		r.Use(authMW.RequireJWT)
		r.Use(rl.PerUser(ratelimit.GroupDefault, 600)) // sanity bucket

		r.Get("/v1/me", billingH.Me)

		// Feedback relay to Plain. Tight per-user window: it's a human-driven form.
		r.With(rl.PerUserWindow(ratelimit.GroupFeedback, 5, time.Minute)).
			Post("/v1/feedback", feedbackH.Submit)

		r.Get("/v1/background-task-runs", backgroundTasksH.ListAllRuns)
		// NOTE: do not register /v1/background-tasks directly here — the Route
		// block below registers the same paths WITH the burst limiter, and a
		// direct registration would (depending on chi's shadowing rules) bypass
		// it.
		r.Route("/v1/background-tasks", func(r chi.Router) {
			r.Use(rl.PerUserWindow(ratelimit.GroupTaskBurst, 30, 10*time.Second))
			r.Get("/", backgroundTasksH.List)
			r.Post("/", backgroundTasksH.Create)
			r.Get("/{slug}", backgroundTasksH.Get)
			r.Patch("/{slug}", backgroundTasksH.Patch)
			r.Delete("/{slug}", backgroundTasksH.Delete)
			r.Get("/{slug}/artifact", backgroundTasksH.GetArtifact)
			r.Put("/{slug}/artifact", backgroundTasksH.PutArtifact)
			r.Get("/{slug}/runs", backgroundTasksH.ListRuns)
			r.Post("/{slug}/runs", backgroundTasksH.CreateRun)
			r.Get("/{slug}/runs/{runId}", backgroundTasksH.GetRun)
			r.Patch("/{slug}/runs/{runId}", backgroundTasksH.PatchRun)
			r.Get("/{slug}/runs/{runId}/status", backgroundTasksH.RunStatus)
			r.Post("/{slug}/runs/{runId}/cancel", backgroundTasksH.CancelRun)
			r.Post("/{slug}/runs/{runId}/retry", backgroundTasksH.RetryRun)
			r.Post("/{slug}/runs/{runId}/signal", backgroundTasksH.SignalRun)
			r.Get("/{slug}/runs/{runId}/events", backgroundTasksH.ListRunEvents)
			r.Post("/{slug}/runs/{runId}/events", backgroundTasksH.AppendRunEvents)
			r.Post("/{slug}/trigger", backgroundTasksH.Trigger)
			r.Get("/{slug}/schedule-state", backgroundTasksH.GetScheduleState)
		})

		r.Route("/v1/llm", func(r chi.Router) {
			r.Use(rl.PerUser(ratelimit.GroupLLM, 60))
			r.Use(rl.PerUserWindow(ratelimit.GroupLLMBurst, 12, 10*time.Second))
			r.Post("/chat/completions", llmH.ChatCompletions)
			r.Post("/completions", llmH.Completions)
			r.Post("/embeddings", llmH.Embeddings)
			r.Get("/models", llmH.Models)
		})

		r.Route("/v1/voice", func(r chi.Router) {
			r.Use(rl.PerUser(ratelimit.GroupVoice, 30))
			r.Use(rl.PerUserWindow(ratelimit.GroupVoiceBurst, 6, 10*time.Second))
			r.Post("/text-to-speech/{voiceId}", voiceH.TextToSpeech)
		})

		// Per-user transcription quota + fleet defaults the desktop reads (RFC 009).
		r.Get("/v1/transcription/quota", transcriptionH.Quota)

		r.With(rl.PerUser(ratelimit.GroupSearch, 60), rl.PerUserWindow(ratelimit.GroupSearchBurst, 10, 10*time.Second)).
			Post("/v1/search/exa", searchH.Search)

		r.Route("/v1/google-oauth", func(r chi.Router) {
			r.Use(rl.PerUserWindow(ratelimit.GroupConnections, 30, time.Minute))
			r.Post("/claim", googleH.Claim)
			r.Post("/refresh", googleH.Refresh)
		})

		r.With(rl.PerUserWindow(ratelimit.GroupConnections, 30, time.Minute)).
			Post("/v1/slack-oauth/claim", slackH.Claim)

		r.With(rl.PerUser(ratelimit.GroupComposio, 120)).
			Handle("/v1/composio/*", http.HandlerFunc(composioH.Proxy))

		// Cloud event ingestion + audit reads (RFC 003).
		r.Route("/v1/events", func(r chi.Router) {
			r.Use(rl.PerUserWindow(ratelimit.GroupEvents, 120, time.Minute))
			r.Post("/", cloudEventsH.Ingest)
			r.Get("/", cloudEventsH.List)
			r.Get("/{eventId}", cloudEventsH.Get)
			r.Get("/{eventId}/runs", cloudEventsH.Runs)
		})

		r.Get("/v1/connectors", connectorsH.List)
		r.Route("/v1/connections", func(r chi.Router) {
			r.Use(rl.PerUser(ratelimit.GroupConnections, 30))
			r.Use(rl.PerUserWindow(ratelimit.GroupConnections+":burst", 8, 10*time.Second))
			r.Post("/{name}/start", connectorsH.Start)
			r.Post("/{name}/claim", connectorsH.Claim)
			r.Post("/{name}/mcp-token", connectorsH.MCPToken)
			r.Delete("/{name}", connectorsH.Delete)
		})
	})

	return nil
}

// dialTemporalWithRetry connects to Temporal, retrying for up to ~2 minutes.
// Temporal regularly comes up after the API in fresh or restarted clusters;
// exiting on the first failed dial turns that ordering race into a
// CrashLoopBackOff whose growing delay outlives Temporal's own startup.
func dialTemporalWithRetry(ctx context.Context, cfg appconfig.Config, log *zap.Logger) (temporalsdk.Client, error) {
	const (
		attemptTimeout = 10 * time.Second
		retryDelay     = 5 * time.Second
		maxAttempts    = 12
	)
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		tctx, cancel := context.WithTimeout(ctx, attemptTimeout)
		c, err := backgroundtaskworkflow.Dial(tctx, cfg)
		cancel()
		if err == nil {
			return c, nil
		}
		lastErr = err
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		log.Warn("temporal dial failed; retrying",
			zap.Int("attempt", attempt),
			zap.Int("max_attempts", maxAttempts),
			zap.String("address", cfg.TemporalAddress),
			zap.Error(err),
		)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(retryDelay):
		}
	}
	return nil, fmt.Errorf("temporal unreachable after %d attempts: %w", maxAttempts, lastErr)
}
