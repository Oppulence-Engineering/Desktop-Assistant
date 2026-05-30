package main

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/proto/entpb"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/billing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/composio"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/config"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/google"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/gqlapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/ratelimit"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/search"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/server"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/voice"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/workosauth"
	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	"github.com/go-chi/chi/v5"
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
	client := database.Client

	// gRPC: entproto-generated UserService on cfg.GRPCAddr (:8081).
	entpb.RegisterUserServiceServer(srv.GRPCServer(), entpb.NewUserService(client))

	// --- Secrets (vendor keys) ---------------------------------------------
	sec := secrets.NewFromConfig(cfg)
	if err := sec.LoadInfisical(ctx, cfg); err != nil {
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
	rl := ratelimit.NewManager(ctx, cfg.RedisURL, log)

	// --- Auth ---------------------------------------------------------------
	// Build the JWT verifier tolerantly: if the JWKS can't be fetched at boot
	// (e.g. local dev with no IdP), the service still starts and authed routes
	// return 503 until the IdP is reachable.
	var verifier *oauthrs.Verifier
	vctx, vcancel := context.WithTimeout(ctx, 10*time.Second)
	v, verr := oauthrs.New(vctx, oauthrs.Config{
		IssuerURL:      cfg.TokenIssuer,
		Audience:       cfg.TokenAudience,
		JWKSURL:        cfg.JWKSURL,
		AcceptableSkew: 60 * time.Second,
	})
	vcancel()
	if verr != nil {
		log.Warn("auth verifier unavailable; authed routes will return 503 until JWKS is reachable", zap.Error(verr))
	} else {
		verifier = v
	}
	enricher := auth.NewWorkOSEnricher(cfg.WorkOSAPIKey)
	authMW := auth.NewMiddleware(verifier, client, enricher, cfg.FreeTierCredits, log)

	// --- Handlers -----------------------------------------------------------
	configH := config.New(cfg)
	billingH := billing.New(client, cfg.FreeTierCredits, database.Cached, log)
	llmH := llm.New(prices, gate, sec, client, log)
	llmH.SetUpstreams(cfg.OpenAIBaseURL, cfg.OpenRouterBaseURL) // empty → provider defaults
	voiceH := voice.New(prices, gate, sec, log)
	searchH := search.New(prices, gate, sec, log)
	googleH := google.New(client, sealer, sec, log)
	googleH.SetTokenURL(cfg.GoogleTokenURL) // empty → real Google endpoint
	googleRedirect := cfg.GoogleRedirectURI
	if googleRedirect == "" {
		googleRedirect = strings.TrimRight(cfg.AppURL, "/") + "/oauth/google/callback"
	}
	googleH.SetOAuthFlow(cfg.GoogleAuthorizeURL, googleRedirect, cfg.DesktopDeepLinkScheme, nil)
	workosH := workosauth.New(cfg.WorkOSClientID, cfg.WorkOSAPIKey, cfg.WorkOSBaseURL, cfg.WorkOSAuthorizeBaseURL, log)
	composioH := composio.New(sec, log)

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

	r := srv.Router()

	// Public (no auth).
	r.Get("/v1/config", configH.Config)

	// WorkOS sign-in broker (public: the caller has no bearer yet; the
	// credential is the WorkOS code/refresh token + the server-held API key).
	r.Route("/v1/auth/workos", func(r chi.Router) {
		r.Get("/login-url", workosH.LoginURL)
		r.Post("/exchange", workosH.Exchange)
		r.Post("/refresh", workosH.Refresh)
	})
	// OAuth callback is a browser redirect from Ory (no bearer); the user is
	// resolved from the sealed pending ticket inside the handler.
	r.Get("/v1/connections/{name}/callback", connectorsH.Callback)

	// Google OAuth front door (browser-facing, no bearer): the desktop opens
	// /oauth/google/start; the callback parks tokens for /v1/google-oauth/claim.
	r.Get("/oauth/google/start", googleH.Start)
	r.Get("/oauth/google/callback", googleH.Callback)

	// Ory pre-consent webhook (shared-secret HMAC, not a user bearer).
	r.With(auth.RequireHookHMAC(cfg.HookHMACSecret)).
		Post("/oauth-hooks/pre-consent", connectorsH.PreConsent)

	// Server-to-server internal API (static shared secret).
	r.With(auth.RequireInternalSecret(cfg.InternalAPISecret)).
		Post("/v1/internal/connections/invalidate", connectorsH.Invalidate)

	// Admin GraphQL (entgql + gqlgen) over the full entity graph. Guarded by
	// the internal secret, which also marks the context internal so the
	// resolvers' ent queries bypass per-user tenant scoping.
	r.With(auth.RequireInternalSecret(cfg.InternalAPISecret)).
		Handle("/graphql", gqlapi.NewHandler(client))

	// Authenticated surface (Ory/WorkOS bearer required).
	r.Group(func(r chi.Router) {
		r.Use(authMW.RequireJWT)
		r.Use(rl.PerUser(ratelimit.GroupDefault, 600)) // sanity bucket

		r.Get("/v1/me", billingH.Me)

		r.Route("/v1/llm", func(r chi.Router) {
			r.Use(rl.PerUser(ratelimit.GroupLLM, 60))
			r.Post("/chat/completions", llmH.ChatCompletions)
			r.Post("/completions", llmH.Completions)
			r.Post("/embeddings", llmH.Embeddings)
			r.Get("/models", llmH.Models)
		})

		r.Route("/v1/voice", func(r chi.Router) {
			r.Use(rl.PerUser(ratelimit.GroupVoice, 30))
			r.Post("/text-to-speech/{voiceId}", voiceH.TextToSpeech)
		})

		r.With(rl.PerUser(ratelimit.GroupSearch, 60)).
			Post("/v1/search/exa", searchH.Search)

		r.Route("/v1/google-oauth", func(r chi.Router) {
			r.Post("/claim", googleH.Claim)
			r.Post("/refresh", googleH.Refresh)
		})

		r.With(rl.PerUser(ratelimit.GroupComposio, 120)).
			Handle("/v1/composio/*", http.HandlerFunc(composioH.Proxy))

		r.Get("/v1/connectors", connectorsH.List)
		r.Route("/v1/connections", func(r chi.Router) {
			r.Use(rl.PerUser(ratelimit.GroupConnections, 30))
			r.Post("/{name}/start", connectorsH.Start)
			r.Post("/{name}/mcp-token", connectorsH.MCPToken)
			r.Delete("/{name}", connectorsH.Delete)
		})
	})

	return nil
}
