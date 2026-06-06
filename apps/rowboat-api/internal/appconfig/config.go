// Package appconfig loads process configuration from the environment.
//
// Every value has a sane default so the service boots in local development
// with no configuration. Production values are injected via the Helm chart's
// secret + configmap (see charts/rowboat-api/).
package appconfig

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is the single configuration surface for rowboat-api. It is loaded
// once at boot and passed (by value) to the packages that need it.
type Config struct {
	// Service identity.
	ServiceName string
	Environment string // production | staging | development

	// Network listeners.
	HTTPAddr         string // public REST + SSE surface
	MetricsAddr      string // Prometheus /metrics (separate port)
	GRPCAddr         string // entproto-generated services (reserved)
	ReadTimeout      time.Duration
	WriteTimeout     time.Duration
	IdleTimeout      time.Duration
	ShutdownTimeout  time.Duration
	ReadinessTimeout time.Duration

	// Observability.
	LogLevel     string // debug | info | warn | error
	OTLPEndpoint string // OTEL_EXPORTER_OTLP_ENDPOINT; empty disables export

	// Persistence.
	DatabaseURL string // postgres DSN (pgx); empty → local sqlite for dev
	RedisURL    string // redis://... for rate-limit buckets + ent cache
	AutoMigrate bool   // run ent schema auto-migration on boot (dev/first-deploy)

	// Column encryption passphrase for pgcrypto-sealed columns.
	DBEncryptionKey string

	// Public values served by GET /v1/config (consumed by the desktop).
	AppURL          string
	OIDCIssuerURL   string // OIDC issuer the desktop signs into (WorkOS AuthKit by default)
	WebsocketAPIURL string

	// Token verification (rowboat-api is itself a resource server).
	TokenIssuer   string // expected iss claim (must equal the issuer that minted the token)
	TokenAudience string // expected aud claim; empty → audience check skipped
	JWKSURL       string // JWKS endpoint; empty → discovered from TokenIssuer's OIDC metadata

	// WorkOS (user-metadata enrichment on first sight + sign-in broker).
	WorkOSAPIKey   string
	WorkOSClientID string
	// WorkOSBaseURL overrides the WorkOS API base (https://api.workos.com) for
	// server-side calls. Empty → the real API. Set in dev to the devstack mock.
	WorkOSBaseURL string
	// WorkOSAuthorizeBaseURL is the base for the browser authorize URL handed to
	// the desktop. Empty → WorkOSBaseURL. Differs only when the browser-reachable
	// host differs from the server-reachable one (local docker devstack split).
	WorkOSAuthorizeBaseURL string

	// OAuthClientID is the desktop's pre-registered OIDC client id, served via
	// /v1/config so the desktop uses a static client instead of DCR. Defaults to
	// WorkOSClientID (WorkOS-direct needs no separate value); empty → the desktop
	// falls back to dynamic client registration.
	OAuthClientID string

	// Ory admin/public APIs (connector OAuth brokering).
	OryPublicURL string
	OryAdminURL  string

	// Confidential OAuth client rowboat-api uses to broker connector tokens
	// against Ory (authorization-code + refresh flows).
	OryBrokerClientID     string
	OryBrokerClientSecret string

	// Public base URL of this service (used to build OAuth redirect URIs).
	PublicBaseURL string

	// ConnectorsJSON optionally overrides the built-in connector registry.
	ConnectorsJSON string

	// Shared-secret HMAC for /oauth-hooks/* (called by Ory, not users).
	HookHMACSecret string

	// Shared secret for /v1/internal/* server-to-server calls.
	InternalAPISecret string

	// Infisical (vendor key pool). When disabled, vendor keys fall back to env.
	InfisicalEnabled     bool
	InfisicalSiteURL     string
	InfisicalToken       string
	InfisicalProjectID   string
	InfisicalEnvironment string

	// Vendor keys — env fallback for local dev (production pulls from Infisical).
	AnthropicAPIKey         string
	OpenAIAPIKey            string
	OpenRouterAPIKey        string
	GoogleAPIKey            string
	ElevenLabsAPIKey        string
	ExaAPIKey               string
	ComposioAPIKey          string
	GoogleOAuthClientID     string
	GoogleOAuthClientSecret string

	// GoogleTokenURL overrides Google's OAuth token endpoint. Empty → the
	// real endpoint (oauth2.googleapis.com/token). Set in dev to a local mock.
	GoogleTokenURL string

	// GoogleAuthorizeURL overrides Google's consent endpoint (empty → the real
	// accounts.google.com endpoint; set to a dev mock for local testing).
	GoogleAuthorizeURL string
	// GoogleRedirectURI is the /oauth/google/callback URL registered in Google
	// Cloud. Empty → derived from AppURL. Must match Google exactly.
	GoogleRedirectURI string

	// Desktop deep-link scheme for connector callbacks (rowboat://...).
	DesktopDeepLinkScheme string

	// Free-tier credit grant minted on first sign-in.
	FreeTierCredits int

	// PricingJSON optionally overrides the default pricing table (raw JSON).
	PricingJSON string

	// LLM upstream base URLs. Empty → provider defaults (api.openai.com /
	// openrouter.ai). Override to target a self-hosted gateway or a local mock.
	OpenAIBaseURL     string
	OpenRouterBaseURL string

	// Temporal durable orchestration for API-native background task runs.
	TemporalEnabled       bool
	TemporalAddress       string
	TemporalNamespace     string
	TemporalTaskQueue     string
	TemporalWorkerEnabled bool
	// Temporal Cloud connection. In local kind we talk to the bundled
	// auto-setup server with no auth; staging/production connect to Temporal
	// Cloud with an API key over TLS. TemporalAPIKey implies TLS.
	TemporalAPIKey     string
	TemporalTLSEnabled bool
}

// Load reads configuration from the environment, applying defaults.
func Load() Config {
	return Config{
		ServiceName: getenv("SERVICE_NAME", "rowboat-api"),
		Environment: getenv("ENVIRONMENT", "development"),

		HTTPAddr:         getenv("HTTP_ADDR", ":8080"),
		MetricsAddr:      getenv("METRICS_ADDR", ":9090"),
		GRPCAddr:         getenv("GRPC_ADDR", ":8081"),
		ReadTimeout:      getdur("READ_TIMEOUT", 30*time.Second),
		WriteTimeout:     getdur("WRITE_TIMEOUT", 0), // 0 = no timeout (SSE streams)
		IdleTimeout:      getdur("IDLE_TIMEOUT", 120*time.Second),
		ShutdownTimeout:  getdur("SHUTDOWN_TIMEOUT", 25*time.Second),
		ReadinessTimeout: getdur("READINESS_TIMEOUT", 3*time.Second),

		LogLevel:     getenv("LOG_LEVEL", "info"),
		OTLPEndpoint: getenv("OTEL_EXPORTER_OTLP_ENDPOINT", ""),

		DatabaseURL:     getenv("DATABASE_URL", ""),
		RedisURL:        getenv("REDIS_URL", ""),
		AutoMigrate:     getbool("AUTO_MIGRATE", true),
		DBEncryptionKey: getenv("DB_ENCRYPTION_KEY", "dev-insecure-encryption-key-change-me"),

		AppURL: getenv("APP_URL", "https://app.solomon-ai.co"),
		// WorkOS-direct: the desktop signs into WorkOS AuthKit directly (no Ory
		// Hydra / consent app in the sign-in path). To revert to Hydra-fronts-
		// WorkOS, set OIDC_ISSUER_URL + TOKEN_ISSUER to the Hydra issuer
		// (https://oauth.solomon-ai.co) and OAUTH_CLIENT_ID to the Hydra client.
		// See apps/rowboat-api/AUTH.md.
		OIDCIssuerURL:   getenv("OIDC_ISSUER_URL", "https://auth.solomon-ai.co"),
		WebsocketAPIURL: getenv("WEBSOCKET_API_URL", ""),

		TokenIssuer: getenv("TOKEN_ISSUER", "https://auth.solomon-ai.co"),
		// allowEmpty: an explicitly-set empty TOKEN_AUDIENCE disables the
		// audience check (WorkOS access tokens carry no `aud`).
		TokenAudience: getenvAllowEmpty("TOKEN_AUDIENCE", "rowboat-api"),
		JWKSURL:       getenv("JWKS_URL", ""), // empty → discovered from TokenIssuer

		WorkOSAPIKey:           getenv("WORKOS_API_KEY", ""),
		WorkOSClientID:         getenv("WORKOS_CLIENT_ID", ""),
		WorkOSBaseURL:          getenv("WORKOS_BASE_URL", ""),
		WorkOSAuthorizeBaseURL: getenv("WORKOS_AUTHORIZE_BASE_URL", ""),
		// Default to the WorkOS client id so WorkOS-direct needs only WORKOS_CLIENT_ID.
		OAuthClientID: getenv("OAUTH_CLIENT_ID", getenv("WORKOS_CLIENT_ID", "")),

		OryPublicURL:          getenv("ORY_PUBLIC_URL", "https://oauth.solomon-ai.co"),
		OryAdminURL:           getenv("ORY_ADMIN_URL", ""),
		OryBrokerClientID:     getenv("ORY_BROKER_CLIENT_ID", ""),
		OryBrokerClientSecret: getenv("ORY_BROKER_CLIENT_SECRET", ""),
		PublicBaseURL:         getenv("PUBLIC_BASE_URL", "https://api.x.solomon-ai.co"),
		ConnectorsJSON:        getenv("CONNECTORS_JSON", ""),

		HookHMACSecret:    getenv("HOOK_HMAC_SECRET", ""),
		InternalAPISecret: getenv("INTERNAL_API_SECRET", ""),

		InfisicalEnabled:     getbool("INFISICAL_ENABLED", false),
		InfisicalSiteURL:     getenv("INFISICAL_SITE_URL", "https://app.infisical.com"),
		InfisicalToken:       getenv("INFISICAL_TOKEN", ""),
		InfisicalProjectID:   getenv("INFISICAL_PROJECT_ID", ""),
		InfisicalEnvironment: getenv("INFISICAL_ENVIRONMENT", "dev"),

		AnthropicAPIKey:         getenv("ANTHROPIC_API_KEY", ""),
		OpenAIAPIKey:            getenv("OPENAI_API_KEY", ""),
		OpenRouterAPIKey:        getenv("OPENROUTER_API_KEY", ""),
		GoogleAPIKey:            getenv("GOOGLE_API_KEY", ""),
		ElevenLabsAPIKey:        getenv("ELEVENLABS_API_KEY", ""),
		ExaAPIKey:               getenv("EXA_API_KEY", ""),
		ComposioAPIKey:          getenv("COMPOSIO_API_KEY", ""),
		GoogleOAuthClientID:     getenv("GOOGLE_OAUTH_CLIENT_ID", ""),
		GoogleOAuthClientSecret: getenv("GOOGLE_OAUTH_CLIENT_SECRET", ""),
		GoogleTokenURL:          getenv("GOOGLE_TOKEN_URL", ""),
		GoogleAuthorizeURL:      getenv("GOOGLE_AUTHORIZE_URL", ""),
		GoogleRedirectURI:       getenv("GOOGLE_REDIRECT_URI", ""),

		DesktopDeepLinkScheme: getenv("DESKTOP_DEEPLINK_SCHEME", "rowboat"),
		FreeTierCredits:       getint("FREE_TIER_CREDITS", 10000),
		PricingJSON:           getenv("PRICING_JSON", ""),
		OpenAIBaseURL:         getenv("OPENAI_BASE_URL", ""),
		OpenRouterBaseURL:     getenv("OPENROUTER_BASE_URL", ""),

		TemporalEnabled:       getbool("TEMPORAL_ENABLED", false),
		TemporalAddress:       getenv("TEMPORAL_ADDRESS", "localhost:7233"),
		TemporalNamespace:     getenv("TEMPORAL_NAMESPACE", "default"),
		TemporalTaskQueue:     getenv("TEMPORAL_TASK_QUEUE", "rowboat-api-background-tasks"),
		TemporalWorkerEnabled: getbool("TEMPORAL_WORKER_ENABLED", false),
		TemporalAPIKey:        getenv("TEMPORAL_API_KEY", ""),
		TemporalTLSEnabled:    getbool("TEMPORAL_TLS_ENABLED", false),
	}
}

// IsProduction reports whether the service runs in a production-like env.
func (c Config) IsProduction() bool {
	return strings.EqualFold(c.Environment, "production")
}

// TemporalUseTLS reports whether the Temporal client should dial over TLS.
// An API key always implies TLS (Temporal Cloud requires it); TLS can also be
// forced independently for self-managed TLS endpoints.
func (c Config) TemporalUseTLS() bool {
	return c.TemporalTLSEnabled || c.TemporalAPIKey != ""
}

// Validate returns an error if a hard-required value is missing. Only AppURL
// is strictly required for the service to be useful (the desktop bombs out
// without it); everything else degrades gracefully.
func (c Config) Validate() error {
	if c.AppURL == "" {
		return fmt.Errorf("APP_URL is required")
	}
	if c.TemporalEnabled {
		if c.TemporalAddress == "" {
			return fmt.Errorf("TEMPORAL_ADDRESS is required when TEMPORAL_ENABLED=true")
		}
		if c.TemporalNamespace == "" {
			return fmt.Errorf("TEMPORAL_NAMESPACE is required when TEMPORAL_ENABLED=true")
		}
		if c.TemporalTaskQueue == "" {
			return fmt.Errorf("TEMPORAL_TASK_QUEUE is required when TEMPORAL_ENABLED=true")
		}
	}
	return nil
}

func getenv(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

// getenvAllowEmpty returns the env value whenever the key is set — including an
// explicit empty string — falling back to def only when the key is unset. This
// lets an operator deliberately blank a value (e.g. TOKEN_AUDIENCE="" to skip
// the audience check), which plain getenv would coalesce back to the default.
func getenvAllowEmpty(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return def
}

func getint(key string, def int) int {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func getbool(key string, def bool) bool {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}

func getdur(key string, def time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
