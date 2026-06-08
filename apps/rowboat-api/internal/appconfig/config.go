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
	RequestTimeout   time.Duration
	MaxRequestBody   int64
	CORSOrigins      []string

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

	// Outbound vendor-call policy.
	VendorTimeout               time.Duration
	VendorResponseHeaderTimeout time.Duration
	VendorMaxConcurrent         int
	LLMMaxConcurrent            int
	UpstreamResponseMaxBytes    int64
	ComposioResponseMaxBytes    int64

	// GoogleTokenURL overrides Google's OAuth token endpoint. Empty → the
	// real endpoint (oauth2.googleapis.com/token). Set in dev to a local mock.
	GoogleTokenURL string

	// GoogleAuthorizeURL overrides Google's consent endpoint (empty → the real
	// accounts.google.com endpoint; set to a dev mock for local testing).
	GoogleAuthorizeURL string
	// GoogleRedirectURI is the /oauth/google/callback URL registered in Google
	// Cloud. Empty → derived from AppURL. Must match Google exactly.
	GoogleRedirectURI string

	// Desktop deep-link scheme for connector callbacks (solomon-ai://...).
	DesktopDeepLinkScheme string

	// Free-tier credit grant minted on first sign-in.
	FreeTierCredits int

	// PricingJSON optionally overrides the default pricing table (raw JSON).
	PricingJSON string

	// Metered business-flow guardrails.
	DailyCreditLimit   int
	MonthlyCreditLimit int

	// LLM request policy.
	LLMAllowedModels       []string
	LLMMaxPromptBytes      int
	LLMMaxToolPayloadBytes int
	LLMMaxMessages         int

	// LLM upstream base URLs. Empty → provider defaults (api.openai.com /
	// openrouter.ai). Override to target a self-hosted gateway or a local mock.
	OpenAIBaseURL     string
	OpenRouterBaseURL string

	// Admin GraphQL guardrails.
	GraphQLIntrospection bool
	GraphQLMaxComplexity int
	GraphQLMaxDepth      int

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

	// Cloud scheduler (RFC 001). Evaluates cron/window triggers for
	// executionTarget=api tasks inside the deployment so scheduled cloud runs
	// fire while the desktop is offline. Disabled by default; the scheduler
	// binary exits cleanly when disabled. Enabling it requires Temporal, since
	// it only creates executor=api runs.
	CloudSchedulerEnabled  bool
	CloudSchedulerInterval time.Duration
	CloudSchedulerLeaseTTL time.Duration
	CloudSchedulerTimezone string // IANA name; v1 is "UTC"
	CloudSchedulerOwner    string // lease owner identity; defaults to hostname
}

// Load reads configuration from the environment, applying defaults.
func Load() Config {
	environment := getenv("ENVIRONMENT", "development")
	production := strings.EqualFold(environment, "production")
	corsDefault := "http://localhost:3000,http://localhost:5173,https://app.solomon-ai.co"
	if production {
		corsDefault = "https://app.solomon-ai.co"
	}
	return Config{
		ServiceName: getenv("SERVICE_NAME", "rowboat-api"),
		Environment: environment,

		HTTPAddr:         getenv("HTTP_ADDR", ":8080"),
		MetricsAddr:      getenv("METRICS_ADDR", ":9090"),
		GRPCAddr:         getenv("GRPC_ADDR", ":8081"),
		ReadTimeout:      getdur("READ_TIMEOUT", 30*time.Second),
		WriteTimeout:     getdur("WRITE_TIMEOUT", 5*time.Minute),
		IdleTimeout:      getdur("IDLE_TIMEOUT", 120*time.Second),
		ShutdownTimeout:  getdur("SHUTDOWN_TIMEOUT", 25*time.Second),
		ReadinessTimeout: getdur("READINESS_TIMEOUT", 3*time.Second),
		RequestTimeout:   getdur("REQUEST_TIMEOUT", 2*time.Minute),
		MaxRequestBody:   getint64("MAX_REQUEST_BODY_BYTES", 32<<20),
		CORSOrigins:      getcsv("CORS_ALLOWED_ORIGINS", corsDefault),

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

		AnthropicAPIKey:             getenv("ANTHROPIC_API_KEY", ""),
		OpenAIAPIKey:                getenv("OPENAI_API_KEY", ""),
		OpenRouterAPIKey:            getenv("OPENROUTER_API_KEY", ""),
		GoogleAPIKey:                getenv("GOOGLE_API_KEY", ""),
		ElevenLabsAPIKey:            getenv("ELEVENLABS_API_KEY", ""),
		ExaAPIKey:                   getenv("EXA_API_KEY", ""),
		ComposioAPIKey:              getenv("COMPOSIO_API_KEY", ""),
		GoogleOAuthClientID:         getenv("GOOGLE_OAUTH_CLIENT_ID", ""),
		GoogleOAuthClientSecret:     getenv("GOOGLE_OAUTH_CLIENT_SECRET", ""),
		VendorTimeout:               getdur("VENDOR_TIMEOUT", 30*time.Second),
		VendorResponseHeaderTimeout: getdur("VENDOR_RESPONSE_HEADER_TIMEOUT", 15*time.Second),
		VendorMaxConcurrent:         getint("VENDOR_MAX_CONCURRENT", 64),
		LLMMaxConcurrent:            getint("LLM_MAX_CONCURRENT", 32),
		UpstreamResponseMaxBytes:    getint64("UPSTREAM_RESPONSE_MAX_BYTES", 64<<20),
		ComposioResponseMaxBytes:    getint64("COMPOSIO_RESPONSE_MAX_BYTES", 64<<20),
		GoogleTokenURL:              getenv("GOOGLE_TOKEN_URL", ""),
		GoogleAuthorizeURL:          getenv("GOOGLE_AUTHORIZE_URL", ""),
		GoogleRedirectURI:           getenv("GOOGLE_REDIRECT_URI", ""),

		DesktopDeepLinkScheme:  getenv("DESKTOP_DEEPLINK_SCHEME", "solomon-ai"),
		FreeTierCredits:        getint("FREE_TIER_CREDITS", 10000),
		PricingJSON:            getenv("PRICING_JSON", ""),
		DailyCreditLimit:       getint("DAILY_CREDIT_LIMIT", 100000),
		MonthlyCreditLimit:     getint("MONTHLY_CREDIT_LIMIT", 2000000),
		LLMAllowedModels:       getcsv("LLM_ALLOWED_MODELS", ""),
		LLMMaxPromptBytes:      getint("LLM_MAX_PROMPT_BYTES", 2<<20),
		LLMMaxToolPayloadBytes: getint("LLM_MAX_TOOL_PAYLOAD_BYTES", 1<<20),
		LLMMaxMessages:         getint("LLM_MAX_MESSAGES", 128),
		OpenAIBaseURL:          getenv("OPENAI_BASE_URL", ""),
		OpenRouterBaseURL:      getenv("OPENROUTER_BASE_URL", ""),
		GraphQLIntrospection:   getbool("GRAPHQL_INTROSPECTION_ENABLED", !production),
		GraphQLMaxComplexity:   getint("GRAPHQL_MAX_COMPLEXITY", 250),
		GraphQLMaxDepth:        getint("GRAPHQL_MAX_DEPTH", 12),

		TemporalEnabled:       getbool("TEMPORAL_ENABLED", false),
		TemporalAddress:       getenv("TEMPORAL_ADDRESS", "localhost:7233"),
		TemporalNamespace:     getenv("TEMPORAL_NAMESPACE", "default"),
		TemporalTaskQueue:     getenv("TEMPORAL_TASK_QUEUE", "rowboat-api-background-tasks"),
		TemporalWorkerEnabled: getbool("TEMPORAL_WORKER_ENABLED", false),
		TemporalAPIKey:        getenv("TEMPORAL_API_KEY", ""),
		TemporalTLSEnabled:    getbool("TEMPORAL_TLS_ENABLED", false),

		CloudSchedulerEnabled:  getbool("CLOUD_SCHEDULER_ENABLED", false),
		CloudSchedulerInterval: getdur("CLOUD_SCHEDULER_INTERVAL", 15*time.Second),
		CloudSchedulerLeaseTTL: getdur("CLOUD_SCHEDULER_LEASE_TTL", 90*time.Second),
		CloudSchedulerTimezone: getenv("CLOUD_SCHEDULER_TIMEZONE", "UTC"),
		CloudSchedulerOwner:    getenv("CLOUD_SCHEDULER_OWNER", defaultHostname()),
	}
}

// defaultHostname returns the process hostname for the scheduler's lease owner
// identity, falling back to a stable name when the OS cannot report one.
func defaultHostname() string {
	if h, err := os.Hostname(); err == nil && h != "" {
		return h
	}
	return "rowboat-api-scheduler"
}

// SchedulerLocation resolves the cloud scheduler timezone (v1: UTC). An empty
// value means UTC; otherwise it must be a loadable IANA name.
func (c Config) SchedulerLocation() (*time.Location, error) {
	if strings.TrimSpace(c.CloudSchedulerTimezone) == "" {
		return time.UTC, nil
	}
	return time.LoadLocation(c.CloudSchedulerTimezone)
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
	if c.ReadTimeout <= 0 {
		return fmt.Errorf("READ_TIMEOUT must be > 0")
	}
	if c.WriteTimeout <= 0 {
		return fmt.Errorf("WRITE_TIMEOUT must be > 0")
	}
	if c.IdleTimeout <= 0 {
		return fmt.Errorf("IDLE_TIMEOUT must be > 0")
	}
	if c.RequestTimeout <= 0 {
		return fmt.Errorf("REQUEST_TIMEOUT must be > 0")
	}
	if c.MaxRequestBody <= 0 {
		return fmt.Errorf("MAX_REQUEST_BODY_BYTES must be > 0")
	}
	if c.VendorMaxConcurrent <= 0 || c.LLMMaxConcurrent <= 0 {
		return fmt.Errorf("vendor concurrency limits must be > 0")
	}
	if c.UpstreamResponseMaxBytes <= 0 || c.ComposioResponseMaxBytes <= 0 {
		return fmt.Errorf("upstream response byte limits must be > 0")
	}
	if c.GraphQLMaxComplexity <= 0 || c.GraphQLMaxDepth <= 0 {
		return fmt.Errorf("GraphQL complexity and depth limits must be > 0")
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
	if c.CloudSchedulerEnabled {
		// The scheduler only creates executor=api runs, which need Temporal to
		// launch the workflow. Fail fast at boot rather than silently scanning
		// tasks it cannot start.
		if !c.TemporalEnabled {
			return fmt.Errorf("TEMPORAL_ENABLED must be true when CLOUD_SCHEDULER_ENABLED=true")
		}
		if c.CloudSchedulerInterval <= 0 {
			return fmt.Errorf("CLOUD_SCHEDULER_INTERVAL must be > 0")
		}
		// The lease must outlive a tick (plus start latency + clock skew) or a
		// slow tick could let the lease expire mid-cycle and double-fire.
		if c.CloudSchedulerLeaseTTL <= c.CloudSchedulerInterval {
			return fmt.Errorf("CLOUD_SCHEDULER_LEASE_TTL must exceed CLOUD_SCHEDULER_INTERVAL")
		}
		if _, err := c.SchedulerLocation(); err != nil {
			return fmt.Errorf("CLOUD_SCHEDULER_TIMEZONE %q is not a valid IANA timezone: %w", c.CloudSchedulerTimezone, err)
		}
	}
	if c.IsProduction() {
		return c.validateProduction()
	}
	return nil
}

func (c Config) validateProduction() error {
	required := map[string]string{
		"DATABASE_URL":        c.DatabaseURL,
		"REDIS_URL":           c.RedisURL,
		"DB_ENCRYPTION_KEY":   c.DBEncryptionKey,
		"TOKEN_ISSUER":        c.TokenIssuer,
		"WORKOS_API_KEY":      c.WorkOSAPIKey,
		"WORKOS_CLIENT_ID":    c.WorkOSClientID,
		"HOOK_HMAC_SECRET":    c.HookHMACSecret,
		"INTERNAL_API_SECRET": c.InternalAPISecret,
		"PUBLIC_BASE_URL":     c.PublicBaseURL,
		"GOOGLE_REDIRECT_URI": c.GoogleRedirectURI,
	}
	for key, value := range required {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s is required in production", key)
		}
	}
	if strings.Contains(c.DBEncryptionKey, "dev-insecure") || len(c.DBEncryptionKey) < 32 {
		return fmt.Errorf("DB_ENCRYPTION_KEY must be a non-dev secret of at least 32 bytes in production")
	}
	if c.AutoMigrate {
		return fmt.Errorf("AUTO_MIGRATE must be false in production")
	}
	if len(c.CORSOrigins) == 0 {
		return fmt.Errorf("CORS_ALLOWED_ORIGINS is required in production")
	}
	for _, origin := range c.CORSOrigins {
		if origin == "*" || strings.Contains(origin, "localhost") || strings.Contains(origin, "127.0.0.1") {
			return fmt.Errorf("CORS_ALLOWED_ORIGINS contains non-production origin %q", origin)
		}
	}
	if c.GraphQLIntrospection {
		return fmt.Errorf("GRAPHQL_INTROSPECTION_ENABLED must be false in production")
	}
	if c.DailyCreditLimit <= 0 || c.MonthlyCreditLimit <= 0 {
		return fmt.Errorf("DAILY_CREDIT_LIMIT and MONTHLY_CREDIT_LIMIT must be > 0 in production")
	}
	if c.InfisicalEnabled {
		for key, value := range map[string]string{
			"INFISICAL_TOKEN":       c.InfisicalToken,
			"INFISICAL_PROJECT_ID":  c.InfisicalProjectID,
			"INFISICAL_ENVIRONMENT": c.InfisicalEnvironment,
		} {
			if strings.TrimSpace(value) == "" {
				return fmt.Errorf("%s is required when INFISICAL_ENABLED=true", key)
			}
		}
		return nil
	}
	if c.OpenAIAPIKey == "" && c.OpenRouterAPIKey == "" {
		return fmt.Errorf("OPENAI_API_KEY or OPENROUTER_API_KEY is required when INFISICAL_ENABLED=false")
	}
	for key, value := range map[string]string{
		"ELEVENLABS_API_KEY":         c.ElevenLabsAPIKey,
		"EXA_API_KEY":                c.ExaAPIKey,
		"COMPOSIO_API_KEY":           c.ComposioAPIKey,
		"GOOGLE_OAUTH_CLIENT_ID":     c.GoogleOAuthClientID,
		"GOOGLE_OAUTH_CLIENT_SECRET": c.GoogleOAuthClientSecret,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s is required when INFISICAL_ENABLED=false", key)
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

func getint64(key string, def int64) int64 {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
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

func getcsv(key string, def string) []string {
	raw := getenv(key, def)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func getdur(key string, def time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
