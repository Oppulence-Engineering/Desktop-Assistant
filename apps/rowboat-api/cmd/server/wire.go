package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/proto/entpb"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/actions"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentchannels"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentgitops"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agents"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentsessions"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentstream"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtasks"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskschedule"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/billing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/cloudevents"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/config"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/docs"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/embeddings"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/feedback"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/google"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/gqlapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/hubspotapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/minutes"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/ratelimit"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenue"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/search"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/server"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slack"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slackclient"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slacktoken"
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
	// RFC 011: classify verified tokens by issuer for audit/metrics + actor kind,
	// and set the step-up recent-auth window. WorkOS is the human-identity issuer;
	// the service/broker issuers stay dark until those modes are promoted.
	authMW.SetIssuerPolicy(auth.IssuerPolicy{
		WorkOSIssuer:  cfg.TokenIssuer,
		ServiceIssuer: cfg.ServiceTokenIssuer,
		BrokerIssuer:  cfg.BrokerTokenIssuer,
	})
	authMW.SetStepUpWindow(cfg.StepUpRecentAuthWindow)
	// Optional readiness signal (RFC 010): report JWKS availability without
	// failing readiness — the service intentionally boots before the IdP is
	// reachable and serves 503 on authed routes until then.
	srv.AddOptionalReadyCheck("workos_jwks", func(context.Context) error {
		if verifier == nil {
			return fmt.Errorf("workos jwks not loaded")
		}
		return nil
	})

	// --- Handlers -----------------------------------------------------------
	configH := config.New(cfg)
	docsH := docs.New()
	billingH := billing.New(client, cfg.FreeTierCredits, cfg.DailyCreditLimit, database.Cached, log)
	billingH.ConfigureStripe(billing.StripeConfig{
		SecretKey:      cfg.StripeSecretKey,
		WebhookSecret:  cfg.StripeWebhookSecret,
		StarterPriceID: cfg.StripeStarterPriceID,
		ProPriceID:     cfg.StripeProPriceID,
		SuccessURL:     cfg.StripeSuccessURL,
		CancelURL:      cfg.StripeCancelURL,
		APIBaseURL:     cfg.StripeAPIBaseURL,
		StarterCredits: cfg.StripeStarterCredits,
		ProCredits:     cfg.StripeProCredits,
	})
	backgroundTasksH := backgroundtasks.New(client, log)
	backgroundTasksH.SetAdmission(backgroundtaskruns.AdmissionFromConfig(cfg, gate, prices))
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
		// Reconcile the six README product workflows for every tenant. The
		// definitions are versioned, user pausing is preserved, and unique task
		// slugs make this safe across all API replicas.
		go func() {
			if err := backgroundTasksH.RunFirstPartyProvisioner(ctx); err != nil && !errors.Is(err, context.Canceled) {
				log.Error("first-party workflow provisioner stopped", zap.Error(err))
			}
		}()
	}
	llmH := llm.New(prices, gate, sec, client, log)
	llmH.SetUpstream(cfg.OpenRouterBaseURL) // empty → provider defaults
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
	transcriptionH := transcription.New(minutes.New(client, log, meetingAllowance), client, cfg, sec, log)
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
			if cfg.IsProduction() {
				return fmt.Errorf("configure distributed refresh-token dedup: %w", rcErr)
			}
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
	slackTokens := slacktoken.New(client, sealer, sec, cfg.SlackTokenURL, vendorPolicy)
	slackAPI := slackclient.New(vendorPolicy)
	slackH.SetRuntimeClients(slackTokens, slackAPI)

	// Cloud event ingestion (RFC 003). The route controller is wired only when
	// routing is enabled (it needs Temporal); without it events are stored with
	// routing_status=skipped.
	var routeCtl cloudevents.RouteController
	if cfg.CloudEventsRoutingEnabled && temporalClient != nil {
		routeCtl = cloudevents.NewRouteStarter(temporalClient, cfg)
	}
	cloudEventsH := cloudevents.New(client, sealer, routeCtl, cloudevents.Config{
		MaxPayloadBytes:      cfg.CloudEventsMaxPayloadBytes,
		SlackSigningSecret:   cfg.SlackSigningSecret,
		GoogleWebhookToken:   cfg.GoogleWebhookToken,
		WebhookSigningSecret: cfg.WebhookSigningSecret,
	}, log)
	if strings.TrimSpace(cfg.GoogleWebhookOIDCAudience) != "" {
		googlePushVerifier, err := oauthrs.New(ctx, oauthrs.Config{
			IssuerURL:      "https://accounts.google.com",
			Audience:       cfg.GoogleWebhookOIDCAudience,
			JWKSURL:        "https://www.googleapis.com/oauth2/v3/certs",
			AcceptableSkew: time.Minute,
			ValidMethods:   []string{"RS256"},
		})
		if err != nil {
			return fmt.Errorf("configure Google Pub/Sub OIDC verifier: %w", err)
		}
		cloudEventsH.SetGooglePushVerifier(googlePushVerifier, cfg.GoogleWebhookOIDCEmail)
	}

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
	connectorsH.SetRefreshDedup(refreshCache, sealer)
	hubspotClient := hubspotapi.New(client, sealer, vendorPolicy)
	hubspotH := hubspotapi.NewHandler(hubspotClient)

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

	// Durable agent runtime (RFC 027). No master flag — it is active wherever
	// Temporal is wired (the durable backend it runs on); the full surface
	// mounts when temporalClient is available. Streaming uses the Redis bus when
	// configured, else a durable-only poll of the event projection.
	var agentsH *agents.Handler
	var agentChannelsH *agentchannels.Handler
	if temporalClient != nil {
		agentCatalog := agentregistry.DefaultCatalog()
		agentLoader, lerr := agentregistry.NewLoader(client, agentCatalog)
		if lerr != nil {
			return fmt.Errorf("load agent definitions: %w", lerr)
		}
		agentsH = agents.New(client, agentLoader, cfg, log)
		// One shared starter backs the HTTP handler, channel adapters, and (on the
		// worker) schedule fires — the single canonical creation path.
		agentStarter := agentsessions.New(client, agentLoader, agentworkflow.NewStarter(temporalClient, cfg), cfg, log)
		agentsH.SetStarter(agentStarter)
		agentsH.SetScheduler(agentworkflow.NewSessionScheduler(temporalClient, cfg))
		dispatcher := agentchannels.New(client, agentStarter, cfg.AgentDefaultChannelAgent, log)
		agentChannelsH = agentchannels.NewHandler(client, dispatcher, cfg.SlackSigningSecret, log)
		// HITL approvals surfaced as Slack buttons resolve back through the shared
		// starter; the Slack client updates the original message via response_url.
		agentChannelsH.SetApprovals(agentStarter, slackclient.New(outbound.Policy{
			Timeout: 15 * time.Second, MaxConcurrent: 64, MaxResponseBytes: 1 << 20,
		}))
		cloudEventsH.SetSlackAgentDispatcher(agentChannelsH.DispatchVerifiedSlack)
		var agentBus *agentstream.Bus
		if cfg.AgentStreamingEnabled && cfg.RedisURL != "" {
			if b, berr := agentstream.NewBus(ctx, cfg.RedisURL); berr == nil {
				agentBus = b
				go func() { <-ctx.Done(); _ = agentBus.Close() }()
			} else {
				log.Warn("agent event bus unavailable; streaming falls back to durable-only poll", zap.Error(berr))
			}
		}
		agentsH.SetStreamer(agentstream.NewStreamer(client, agentBus, log))
		if cfg.AgentGitOpsEnabled {
			agentsH.SetGitOps(agentgitops.New(client, agentLoader, agentsH.Policy(), log))
		}
	}

	// Revenue memory and outbound governance (RFC 030). Always mounted.
	// Without a facade base URL the fail-closed disabled facade is used:
	// observation and drafts work, preflight and sends don't.
	var facade revenue.FacadeClient
	if cfg.RevenueFacadeBaseURL != "" {
		facade = revenue.NewHTTPFacade(revenue.HTTPFacadeConfig{
			BaseURL:      cfg.RevenueFacadeBaseURL,
			ServiceToken: cfg.RevenueFacadeServiceToken,
			Timeout:      cfg.RevenueFacadeTimeout,
		})
	}
	// Approved action execution is routed to the assigned user's connected
	// provider. Email retains provider-native Gmail drafts; Slack, Calendar,
	// and HubSpot are send-mode only and remain approval + preflight gated.
	gmailExec := revenue.NewGmailExecutor(client, sealer, sec, googleapi.New(googleapi.Config{
		TokenURL:        cfg.GoogleTokenURL,
		GmailBaseURL:    cfg.GmailAPIBaseURL,
		CalendarBaseURL: cfg.CalendarAPIBaseURL,
		DriveBaseURL:    cfg.DriveAPIBaseURL,
	}))
	routedExec := revenue.NewRoutingExecutor(
		gmailExec,
		revenue.NewSlackExecutor(slackTokens, vendorPolicy),
		revenue.NewCalendarExecutor(gmailExec),
		revenue.NewHubSpotExecutor(client, sealer, vendorPolicy),
	)
	revenueSvc := revenue.NewService(client, facade, routedExec, log)
	revenueSvc.SetEvidenceSealer(sealer)
	// Provider write timeouts are reconciled continuously through read-only
	// SDK/API lookups. This loop is always on because it is part of exactly-once
	// execution safety, not an optional recommendation feature.
	go func() {
		_ = revenue.NewAmbiguousExecutionReconciler(revenueSvc, time.Minute, 200, log).Run(ctx)
	}()
	// Evidence and corrections commit before projection. This leased sweep is
	// the durable recovery path when the inline projector fails or a temporal
	// assertion boundary becomes due.
	go func() {
		_ = revenue.NewRelationshipProjectionRunner(revenueSvc, 15*time.Second, 200, "", log).Run(ctx)
	}()
	// Attention also changes as time passes (for example a commitment becoming
	// overdue), so event refreshes are backed by an always-on daily sweep.
	go func() {
		_ = revenue.NewRelationshipAttentionRunner(revenueSvc, 24*time.Hour, 200, log).Run(ctx)
	}()
	// The Gmail backend also feeds the leak scan (read-only sweep).
	revenueSvc.SetSweeper(gmailExec)
	// Source status rows are the durable backfill queue. Every replica runs the
	// compare-and-set worker; provider reads emit bounded idempotent observations,
	// and lifecycle progress advances only after those observations commit.
	go func() {
		_ = revenue.NewSourceBackfillRunner(revenueSvc, map[string]revenue.SourceBackfillProvider{
			"google":  revenue.NewGoogleSourceBackfiller(gmailExec),
			"slack":   revenue.NewSlackSourceBackfiller(slackTokens, slackAPI),
			"hubspot": revenue.NewHubSpotSourceBackfiller(hubspotClient),
		}, 5*time.Second, 50, log).Run(ctx)
	}()
	// Gate execution behind a paid plan: scan/queue/draft/ROI stay free,
	// approve+execute require an active subscription.
	revenueSvc.SetEntitlements(revenue.NewSubscriptionEntitlements(client))
	// Layer-3 (RFC 031): on-demand original-email retrieval, cached sealed with
	// the column key for a short TTL.
	revenueSvc.SetBodyFetcher(gmailExec, sealer, time.Duration(cfg.MailBodyCacheTTLHours)*time.Hour)
	// Layer-2 (RFC 031): semantic memory. Ships dark behind
	// REVENUE_SEMANTIC_MEMORY_ENABLED and needs an embeddings key.
	if cfg.RevenueSemanticMemoryEnabled {
		revenueSvc.SetEmbedder(embeddings.New(embeddings.Config{
			APIKey:  sec.OpenAI(),
			BaseURL: cfg.OpenAIBaseURL,
			Model:   cfg.EmbeddingsModel,
		}))
	}
	revenueH := revenue.NewHandler(revenueSvc, log)
	// RFC 031 Layer-1 push sync: keep the mail index live from Gmail pushes.
	// Ships dark behind REVENUE_MAIL_PUSH_SYNC_ENABLED.
	if cfg.RevenueMailPushSyncEnabled {
		revenueSvc.SetMailSyncer(gmailExec)
		cloudEventsH.SetGmailHistoryConsumer(func(ctx context.Context, owner *ent.User, historyID uint64) error {
			return revenueSvc.SyncMailFromPush(ctx, owner, historyID)
		})
	}
	// RFC 031: disconnecting Google purges the mail index (Layers 1-3);
	// Layer-4 evidence quotes survive as the user's own action history.
	googleH.SetOnDisconnect(func(ctx context.Context, u *ent.User) error {
		_, purgeErr := revenueSvc.PurgeMailIndex(ctx, u)
		_, statusErr := revenueSvc.MarkSourceDisconnected(ctx, u, "google", "default")
		return errors.Join(purgeErr, statusErr)
	})

	// Closed-loop action broker (RFC 023). Ships dark behind ACTIONS_ENABLED.
	// The propose→approve→execute→watch surface issues single-use, params-bound
	// approval tokens; no money-moving action executes without a valid one. The
	// product Act-seam executor is nil until a product MCP is wired, so execute
	// fails closed (approve/reject/audit still work).
	var actionsH *actions.Handler
	if cfg.ActionsEnabled {
		actionSigner, err := actions.NewSigner(cfg.AgentSigningSecret())
		if err != nil {
			return fmt.Errorf("wire actions broker: %w", err)
		}
		// The product Act-seam executor is wired only when configured; without
		// it execute fails closed (approve/reject/audit still work).
		var actExec actions.Executor
		if httpSeam := actions.NewHTTPActSeam(actions.HTTPActSeamConfig{
			BaseURL:      cfg.ActionActSeamBaseURL,
			ServiceToken: cfg.ActionActSeamToken,
			Timeout:      cfg.ActionActSeamTimeout,
		}); httpSeam != nil {
			actExec = httpSeam
		}
		actionBroker := actions.NewBroker(client, actionSigner, actExec, actions.Config{
			TokenTTL:                  cfg.ActionTokenTTL,
			WatchTimeout:              cfg.ActionWatchTimeout,
			RequireStepUpForFinancial: cfg.ActionRequireStepUpForFinancial,
		}, log)
		stepUp := func(r *http.Request) bool {
			a, ok := auth.ActorFromCtx(r.Context())
			return ok && authMW.SatisfiesStepUp(a, auth.StepUpRecentAuth)
		}
		actionsH = actions.NewHandler(actionBroker, stepUp, log)
	}

	r := srv.Router()

	// Public (no auth).
	r.Get("/docs", docsH.Scalar)
	r.Get("/docs/", docsH.Scalar)
	r.Get("/openapi.json", docsH.OpenAPI)
	r.Get("/docs/openapi.json", docsH.OpenAPI)
	r.Get("/v1/config", configH.Config)
	// Browser WebSockets cannot set Authorization directly, so the desktop
	// carries its normal JWT as the second subprotocol. Promote it before the
	// standard verifier, then proxy the authenticated stream to Deepgram.
	r.With(
		transcription.WebSocketBearer,
		authMW.RequireJWT,
		rl.PerUser(ratelimit.GroupVoice, 30),
		rl.PerUserWindow(ratelimit.GroupVoiceBurst, 6, 10*time.Second),
	).Get("/deepgram/v1/listen", transcriptionH.Listen)

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

	// Provider callbacks are browser-facing and carry state minted by the
	// authenticated /v1/*-oauth/start endpoints below.
	r.With(rl.PerUserWindow(ratelimit.GroupAuth, 30, time.Minute)).
		Get("/oauth/google/callback", googleH.Callback)

	// Slack workspace install front door (browser-facing, no bearer): the
	// callback parks the sealed bundle for /v1/slack-oauth/claim, which writes
	// the team_id→user mapping the Slack webhook resolves against.
	r.With(rl.PerUserWindow(ratelimit.GroupAuth, 30, time.Minute)).
		Get("/oauth/slack/callback", slackH.Callback)

	// Provider event webhooks (public: providers carry no bearer; each handler
	// verifies its own credential before ingesting). Pre-auth, so the rate
	// limit keys on the client IP recovered by RealIPFromTrustedProxies.
	r.With(rl.PerUserWindow(ratelimit.GroupWebhooks, 240, time.Minute)).
		Post("/v1/webhooks/google", cloudEventsH.GoogleWebhook)
	r.With(rl.PerUserWindow(ratelimit.GroupWebhooks, 240, time.Minute)).
		Post("/v1/webhooks/slack", cloudEventsH.SlackWebhook)
	r.With(rl.PerUserWindow(ratelimit.GroupWebhooks, 240, time.Minute)).
		Post("/v1/webhooks/events", cloudEventsH.GenericWebhook)
	r.With(rl.PerUserWindow(ratelimit.GroupWebhooks, 240, time.Minute)).
		Post("/v1/billing/stripe/webhook", billingH.StripeWebhook)

	// Agent channel inbound (RFC 027 P5). Slack Events API has a single request
	// URL, so /v1/webhooks/slack owns verification, durable event storage, and
	// app_mention fan-out to agentChannelsH. The generic internal ingest lets
	// any server-side channel gateway start/continue a session.
	if agentChannelsH != nil {
		// Slack interactive components (Approve/Deny buttons) for HITL approvals.
		r.With(rl.PerUserWindow(ratelimit.GroupWebhooks, 240, time.Minute)).
			Post("/v1/agent-channels/slack/interactivity", agentChannelsH.SlackInteractivity)
	}

	// Ory pre-consent webhook (shared-secret HMAC, not a user bearer).
	r.With(rl.PerUserWindow(ratelimit.GroupInternal, 120, time.Minute), auth.RequireHookHMAC(cfg.HookHMACSecret)).
		Post("/oauth-hooks/pre-consent", connectorsH.PreConsent)

	// Server-to-server internal API (static shared secret).
	r.With(rl.PerUserWindow(ratelimit.GroupInternal, 120, time.Minute), auth.RequireInternalSecret(cfg.InternalAPISecret)).
		Post("/v1/internal/connections/invalidate", connectorsH.Invalidate)
	r.With(rl.PerUserWindow(ratelimit.GroupInternal, 120, time.Minute), auth.RequireInternalSecret(cfg.InternalAPISecret)).
		Post("/v1/internal/events", cloudEventsH.IngestInternal)
	if agentChannelsH != nil {
		r.With(rl.PerUserWindow(ratelimit.GroupInternal, 120, time.Minute), auth.RequireInternalSecret(cfg.InternalAPISecret)).
			Post("/v1/internal/agent-channels/{channel}/inbound", agentChannelsH.InboundInternal)
	}
	if agentsH != nil && cfg.AgentGitOpsEnabled {
		// RFC 028 P4: a git-sync sidecar / CI posts a declared agent set here.
		r.With(rl.PerUserWindow(ratelimit.GroupInternal, 120, time.Minute), auth.RequireInternalSecret(cfg.InternalAPISecret)).
			Post("/v1/internal/agent-gitops/reconcile", agentsH.ReconcileGitOps)
	}

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
		r.Use(rl.PerUserWindow(ratelimit.GroupRevenue, 60, time.Minute))
		revenueH.MountPublic(r)
	})

	r.Group(func(r chi.Router) {
		r.Use(authMW.RequireJWT)
		r.Use(rl.PerUser(ratelimit.GroupDefault, 600)) // sanity bucket

		r.Get("/v1/me", billingH.Me)
		r.Post("/v1/billing/checkout-session", billingH.CheckoutSession)
		r.Post("/v1/billing/portal-session", billingH.PortalSession)
		r.Post("/v1/billing/sync", billingH.Sync)

		// Feedback relay to Plain. Tight per-user window: it's a human-driven form.
		r.With(rl.PerUserWindow(ratelimit.GroupFeedback, 5, time.Minute)).
			Post("/v1/feedback", feedbackH.Submit)

		r.Get("/v1/background-task-runs", backgroundTasksH.ListAllRuns)
		r.Route("/v1/background-task-templates", func(r chi.Router) {
			r.Use(rl.PerUserWindow(ratelimit.GroupTaskBurst, 120, 10*time.Second))
			r.Get("/", backgroundTasksH.ListTemplates)
			r.Get("/{templateSlug}", backgroundTasksH.GetTemplate)
			r.Post("/{templateSlug}/instantiate", backgroundTasksH.InstantiateTemplate)
		})
		// NOTE: do not register /v1/background-tasks directly here — the Route
		// block below registers the same paths WITH the burst limiter, and a
		// direct registration would (depending on chi's shadowing rules) bypass
		// it.
		r.Route("/v1/background-tasks", func(r chi.Router) {
			// Desktop task runs sync artifacts, run state, events, and UI refreshes
			// in a short burst; keep the guardrail high enough for normal runs.
			r.Use(rl.PerUserWindow(ratelimit.GroupTaskBurst, 120, 10*time.Second))
			r.Get("/", backgroundTasksH.List)
			r.Post("/", backgroundTasksH.Create)
			r.Post("/first-party/ensure", backgroundTasksH.EnsureFirstParty)
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
			r.Get("/{slug}/runs/{runId}/events/stream", backgroundTasksH.StreamRunEvents)
			r.Post("/{slug}/trigger", backgroundTasksH.Trigger)
			r.Get("/{slug}/schedule-state", backgroundTasksH.GetScheduleState)
		})

		// Durable agent runtime (RFC 027): AgentDefinition CRUD + agent-session
		// lifecycle. Mounted only when the master flag is on.
		if agentsH != nil {
			r.Route("/v1/agents", func(r chi.Router) {
				r.Use(rl.PerUserWindow(ratelimit.GroupAgent, 60, time.Minute))
				r.Get("/", agentsH.ListAgents)
				r.Post("/", agentsH.CreateAgent)
				// RFC 028: declarative YAML/JSON authoring (one shape, both formats).
				r.Post("/validate", agentsH.ValidateAgent) // dry-run (CLI/CI)
				r.Put("/{slug}", agentsH.PutAgent)         // apply (new revision)
				r.Get("/{slug}", agentsH.GetAgent)         // ?format=yaml round-trips
				r.Delete("/{slug}", agentsH.DeleteAgent)
				r.Get("/{slug}/revisions", agentsH.ListRevisions)
				r.Post("/{slug}/rollback", agentsH.RollbackAgent)
				// Recurring sessions via Temporal Schedules (P5).
				r.Post("/{slug}/schedule", agentsH.CreateSchedule)
				r.Delete("/{slug}/schedule", agentsH.DeleteSchedule)
			})
			r.Route("/v1/agent-sessions", func(r chi.Router) {
				r.Use(rl.PerUserWindow(ratelimit.GroupAgent, 120, time.Minute))
				r.Post("/", agentsH.CreateSession)
				r.Get("/{id}", agentsH.GetSession)
				r.Post("/{id}/turns", agentsH.SubmitTurn)
				r.Get("/{id}/stream", agentsH.Stream)
				r.Get("/{id}/events", agentsH.ListEvents)
				r.With(authMW.RequireStepUp(auth.StepUpRecentAuth)).
					Post("/{id}/approvals/{approvalId}/token", agentsH.MintApprovalToken)
				r.Post("/{id}/approvals/{approvalId}", agentsH.Approve)
				r.Post("/{id}/cancel", agentsH.Cancel)
			})
		}

		r.Route("/v1/llm", func(r chi.Router) {
			// Configurable and generous. The old hardcoded 60/min + 12/10s was
			// sized for chat-shaped traffic; the desktop is agentic, so one user
			// action ("label these 15 emails") is ~16 round trips and three of
			// those run concurrently alongside note tagging and graph builds.
			// Users hit the ceiling doing exactly what the product asks of them.
			//
			// This bounds burst and abuse, not spend: credits are reserved per
			// call and DAILY_CREDIT_LIMIT / MONTHLY_CREDIT_LIMIT cap cost
			// independently, and LLM_MAX_CONCURRENT bounds outbound concurrency.
			r.Use(rl.PerUser(ratelimit.GroupLLM, cfg.LLMRateLimitPerUserPerMin))
			r.Use(rl.PerUserWindow(ratelimit.GroupLLMBurst, cfg.LLMRateLimitPerUserBurst, 10*time.Second))
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
			r.Post("/start", googleH.Start)
			r.Post("/claim", googleH.Claim)
			r.Post("/refresh", googleH.Refresh)
			r.Delete("/", googleH.Disconnect)
		})

		r.Route("/v1/slack-oauth", func(r chi.Router) {
			r.Use(rl.PerUserWindow(ratelimit.GroupConnections, 30, time.Minute))
			r.Post("/start", slackH.Start)
			r.Post("/claim", slackH.Claim)
			r.Get("/workspaces", slackH.ListWorkspaces)
			r.Delete("/workspaces/{teamId}", slackH.DeleteWorkspace)
			r.Post("/thread/read", slackH.ReadThread)
			r.Post("/thread/post", slackH.PostThread)
		})

		// Cloud event ingestion + audit reads (RFC 003).
		r.Route("/v1/events", func(r chi.Router) {
			r.Use(rl.PerUserWindow(ratelimit.GroupEvents, 120, time.Minute))
			r.Post("/", cloudEventsH.Ingest)
			r.Get("/", cloudEventsH.List)
			r.Get("/{eventId}", cloudEventsH.Get)
			r.Get("/{eventId}/runs", cloudEventsH.Runs)
		})

		// RFC 030 revenue queue. The lifecycle enforces the state-machine
		// invariants server-side.
		r.Group(func(r chi.Router) {
			r.Use(rl.PerUserWindow(ratelimit.GroupRevenue, 120, time.Minute))
			revenueH.Mount(r)
		})

		// RFC 023 closed-loop action broker (ships dark behind ACTIONS_ENABLED).
		if actionsH != nil {
			r.Group(func(r chi.Router) {
				r.Use(rl.PerUserWindow(ratelimit.GroupActions, 120, time.Minute))
				actionsH.Mount(r)
			})
		}

		r.Get("/v1/connectors", connectorsH.List)
		r.With(rl.PerUserWindow(ratelimit.GroupConnections, 60, time.Minute)).
			Post("/v1/hubspot/search", hubspotH.Search)
		r.Route("/v1/connections", func(r chi.Router) {
			r.Use(rl.PerUser(ratelimit.GroupConnections, 30))
			r.Use(rl.PerUserWindow(ratelimit.GroupConnections+":burst", 8, 10*time.Second))
			r.Post("/{name}/start", connectorsH.Start)
			r.Post("/{name}/claim", connectorsH.Claim)
			r.Post("/{name}/api-key", connectorsH.SetAPIKey)
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
