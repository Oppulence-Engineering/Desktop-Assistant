// Package appconfig loads process configuration from the environment.
//
// Every value has a sane default so the service boots in local development
// with no configuration. Production values are injected via the Helm chart's
// secret + configmap (see charts/rowboat-api/).
package appconfig

import (
	"fmt"
	"log"
	"net/url"
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
	// TrustedProxyCIDRs lists proxies (ingress) whose X-Forwarded-For may be
	// trusted to recover the real client IP for pre-auth rate limiting. Empty →
	// X-Forwarded-For is ignored and RemoteAddr is used as-is.
	TrustedProxyCIDRs []string

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
	// PlainAPIKey is optional: when unset, POST /v1/feedback returns
	// provider_unconfigured instead of relaying to Plain.
	PlainAPIKey string

	// Plain (plain.com) feedback relay. Label type ids are workspace data and
	// differ per environment; the raw JSON maps category -> lt_… id.
	PlainAPIURL       string
	PlainLabelTypeIDs string
	PlainTitlePrefix  string

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

	// Free cloud meeting-transcription seconds per UTC month for non-paid plans
	// (RFC 009 §16). Exhausted → the desktop falls back to on-device transcription.
	FreeMeetingSecondsPerMonth int

	// Remote, A/B-able transcription defaults the desktop reads (RFC 009 §25). The
	// voice default doubles as the local kill switch (flip back to a cloud value).
	TranscriptionVoiceDefault   string
	TranscriptionMeetingDefault string

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

	// Temporal Schedules for exact-cron api-target tasks (RFC 005). When
	// disabled, cron stays on the RFC 001 scheduler loop; the loop remains the
	// fallback for any task whose schedule sync is not "current" even when
	// enabled.
	TemporalSchedulesEnabled          bool
	TemporalScheduleCatchup           time.Duration // Schedule CatchupWindow
	TemporalScheduleReconcileInterval time.Duration // reconciler cadence

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

	// Cloud event ingestion + routing (RFC 003). Ingestion (/v1/events and
	// provider webhooks) is always mounted; ROUTING — the Temporal workflow that
	// matches events to tasks via LLM and fires trigger=event runs — is gated.
	// Routing requires Temporal, exactly like the run path.
	CloudEventsRoutingEnabled  bool
	CloudEventsMatchThreshold  float64 // pass-2 confidence gate; fixed in v1
	CloudEventsRouterModel     string  // model for pass-1/pass-2 routing calls
	CloudEventsMaxPayloadBytes int     // reject larger payloads before sealing
	SlackSigningSecret         string  // verifies /v1/webhooks/slack signatures
	GoogleWebhookToken         string  // shared token for /v1/webhooks/google

	// Slack workspace connect flow (OAuth v2). The connection maps team_id →
	// user, which is what /v1/webhooks/slack resolves events against.
	SlackClientID     string
	SlackClientSecret string
	// SlackOAuthScopes are the bot scopes requested at install; they bound
	// which Events API deliveries the workspace can produce.
	SlackOAuthScopes string
	// SlackRedirectURI is the /oauth/slack/callback URL registered on the
	// Slack app. Empty → derived from AppURL. Must match Slack exactly.
	SlackRedirectURI string
	// SlackAuthorizeURL / SlackTokenURL override Slack's endpoints (dev mocks).
	SlackAuthorizeURL string
	SlackTokenURL     string

	// Google watch manager (RFC 003): registers and renews the Gmail
	// users.watch + Calendar events channel per connected Google account so
	// Google actually delivers pushes to /v1/webhooks/google. Runs in the
	// scheduler process.
	GoogleWatchEnabled     bool
	GmailPubSubTopic       string        // projects/{p}/topics/{t}; empty → Gmail watches skipped
	GoogleWatchInterval    time.Duration // renewal scan cadence
	GoogleWatchRenewMargin time.Duration // renew registrations expiring within this window
	// GmailAPIBaseURL / CalendarAPIBaseURL override Google's API hosts (dev mocks).
	GmailAPIBaseURL    string
	CalendarAPIBaseURL string

	// Cloud agent runtime (RFC 004): the LLM-backed, tool-scoped agent loop
	// that the Temporal worker's ExecuteAPITask delegates to. Enabled by
	// default; CLOUD_RUNTIME_ENABLED=false is the rollback kill-switch
	// selecting the deterministic NoopRuntime artifact path.
	CloudRuntimeEnabled          bool
	CloudRuntimeModel            string        // model used when the task carries none
	CloudRuntimeMaxDuration      time.Duration // wall clock per run; MUST stay < the 5m activity timeout
	CloudRuntimeMaxLLMCalls      int
	CloudRuntimeMaxToolCalls     int
	CloudRuntimeMaxArtifactBytes int
	CloudRuntimeMaxEventBytes    int
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

		HTTPAddr:    getenv("HTTP_ADDR", ":8080"),
		MetricsAddr: getenv("METRICS_ADDR", ":9090"),
		// allowEmpty: GRPC_ADDR="" deliberately disables the gRPC listener
		// (Server.Run skips it when blank); plain getenv would coalesce the
		// explicit empty back to the default and make it impossible to turn off.
		GRPCAddr:         getenvAllowEmpty("GRPC_ADDR", ":8081"),
		ReadTimeout:      getdur("READ_TIMEOUT", 30*time.Second),
		WriteTimeout:     getdur("WRITE_TIMEOUT", 5*time.Minute),
		IdleTimeout:      getdur("IDLE_TIMEOUT", 120*time.Second),
		ShutdownTimeout:  getdur("SHUTDOWN_TIMEOUT", 25*time.Second),
		ReadinessTimeout: getdur("READINESS_TIMEOUT", 3*time.Second),
		RequestTimeout:   getdur("REQUEST_TIMEOUT", 2*time.Minute),
		MaxRequestBody:   getint64("MAX_REQUEST_BODY_BYTES", 32<<20),
		CORSOrigins:      getcsv("CORS_ALLOWED_ORIGINS", corsDefault),
		// Default to the RFC1918 + loopback ranges: in the k8s deployment the
		// direct peer is always the cluster-internal ingress, and these ranges
		// are not internet-routable, so a direct external client can never match
		// them and spoof X-Forwarded-For. Operators terminating TLS elsewhere
		// can narrow or blank this.
		TrustedProxyCIDRs: getcsv("TRUSTED_PROXY_CIDRS", "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8,::1/128"),

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
		PlainAPIKey:                 getenv("PLAIN_API_KEY", ""),
		PlainAPIURL:                 getenv("PLAIN_API_URL", "https://core-api.uk.plain.com/graphql/v1"),
		PlainLabelTypeIDs:           getenv("PLAIN_LABEL_TYPE_IDS", ""),
		PlainTitlePrefix:            getenv("PLAIN_TITLE_PREFIX", ""),
		VendorTimeout:               getdur("VENDOR_TIMEOUT", 30*time.Second),
		VendorResponseHeaderTimeout: getdur("VENDOR_RESPONSE_HEADER_TIMEOUT", 15*time.Second),
		VendorMaxConcurrent:         getint("VENDOR_MAX_CONCURRENT", 64),
		LLMMaxConcurrent:            getint("LLM_MAX_CONCURRENT", 32),
		UpstreamResponseMaxBytes:    getint64("UPSTREAM_RESPONSE_MAX_BYTES", 64<<20),
		ComposioResponseMaxBytes:    getint64("COMPOSIO_RESPONSE_MAX_BYTES", 64<<20),
		GoogleTokenURL:              getenv("GOOGLE_TOKEN_URL", ""),
		GoogleAuthorizeURL:          getenv("GOOGLE_AUTHORIZE_URL", ""),
		GoogleRedirectURI:           getenv("GOOGLE_REDIRECT_URI", ""),

		DesktopDeepLinkScheme: getenv("DESKTOP_DEEPLINK_SCHEME", "solomon-ai"),
		FreeTierCredits:       getint("FREE_TIER_CREDITS", 10000),

		FreeMeetingSecondsPerMonth:  getint("FREE_MEETING_SECONDS_PER_MONTH", 10800), // 180 min
		TranscriptionVoiceDefault:   getenv("TRANSCRIPTION_VOICE_DEFAULT", "whisper-local"),
		TranscriptionMeetingDefault: getenv("TRANSCRIPTION_MEETING_DEFAULT", "deepgram"),

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

		TemporalSchedulesEnabled:          getbool("TEMPORAL_SCHEDULES_ENABLED", false),
		TemporalScheduleCatchup:           getdur("TEMPORAL_SCHEDULE_CATCHUP", time.Minute),
		TemporalScheduleReconcileInterval: getdur("TEMPORAL_SCHEDULE_RECONCILE_INTERVAL", 5*time.Minute),

		CloudSchedulerEnabled:  getbool("CLOUD_SCHEDULER_ENABLED", false),
		CloudSchedulerInterval: getdur("CLOUD_SCHEDULER_INTERVAL", 15*time.Second),
		// MUST exceed the scheduler's cron grace window (2m, due.go cronGrace):
		// a lease that expires while a crashed owner's occurrence is still inside
		// grace lets another replica steal it and double-fire. Validate enforces
		// this; the 150s default matches backgroundscheduler.defaultLeaseTTL.
		CloudSchedulerLeaseTTL: getdur("CLOUD_SCHEDULER_LEASE_TTL", 150*time.Second),
		CloudSchedulerTimezone: getenv("CLOUD_SCHEDULER_TIMEZONE", "UTC"),
		CloudSchedulerOwner:    getenv("CLOUD_SCHEDULER_OWNER", defaultHostname()),

		CloudEventsRoutingEnabled: getbool("CLOUD_EVENTS_ROUTING_ENABLED", false),
		CloudEventsMatchThreshold: getfloat("CLOUD_EVENTS_MATCH_THRESHOLD", 0.7),
		// Routing is two cheap bounded calls per event; default to the cheapest
		// priced model (see internal/pricing DefaultTable).
		CloudEventsRouterModel:     getenv("CLOUD_EVENTS_ROUTER_MODEL", "anthropic/claude-haiku-4-5"),
		CloudEventsMaxPayloadBytes: getint("CLOUD_EVENTS_MAX_PAYLOAD_BYTES", 256<<10),
		SlackSigningSecret:         getenv("SLACK_SIGNING_SECRET", ""),
		GoogleWebhookToken:         getenv("GOOGLE_WEBHOOK_TOKEN", ""),

		SlackClientID:     getenv("SLACK_CLIENT_ID", ""),
		SlackClientSecret: getenv("SLACK_CLIENT_SECRET", ""),
		SlackOAuthScopes:  getenv("SLACK_OAUTH_SCOPES", "channels:history,channels:read,users:read"),
		SlackRedirectURI:  getenv("SLACK_REDIRECT_URI", ""),
		SlackAuthorizeURL: getenv("SLACK_AUTHORIZE_URL", ""),
		SlackTokenURL:     getenv("SLACK_TOKEN_URL", ""),

		GoogleWatchEnabled:     getbool("GOOGLE_WATCH_ENABLED", false),
		GmailPubSubTopic:       getenv("GMAIL_PUBSUB_TOPIC", ""),
		GoogleWatchInterval:    getdur("GOOGLE_WATCH_INTERVAL", 15*time.Minute),
		GoogleWatchRenewMargin: getdur("GOOGLE_WATCH_RENEW_MARGIN", 24*time.Hour),
		GmailAPIBaseURL:        getenv("GMAIL_API_BASE_URL", ""),
		CalendarAPIBaseURL:     getenv("CALENDAR_API_BASE_URL", ""),

		CloudRuntimeEnabled:          getbool("CLOUD_RUNTIME_ENABLED", true),
		CloudRuntimeModel:            getenv("CLOUD_RUNTIME_MODEL", "anthropic/claude-sonnet-4-5"),
		CloudRuntimeMaxDuration:      getdur("CLOUD_RUNTIME_MAX_DURATION", 4*time.Minute),
		CloudRuntimeMaxLLMCalls:      getint("CLOUD_RUNTIME_MAX_LLM_CALLS", 12),
		CloudRuntimeMaxToolCalls:     getint("CLOUD_RUNTIME_MAX_TOOL_CALLS", 24),
		CloudRuntimeMaxArtifactBytes: getint("CLOUD_RUNTIME_MAX_ARTIFACT_BYTES", 1<<20),
		CloudRuntimeMaxEventBytes:    getint("CLOUD_RUNTIME_MAX_EVENT_BYTES", 64<<10),
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

// SchedulerLocation resolves the cloud scheduler timezone (v1: UTC). It accepts
// the same trimmed, case-insensitive "UTC" (and empty) that Validate accepts, so
// a value that passes validation never fails to load here; any other value is
// loaded as an IANA name (but Validate rejects non-UTC in v1).
func (c Config) SchedulerLocation() (*time.Location, error) {
	tz := strings.TrimSpace(c.CloudSchedulerTimezone)
	if tz == "" || strings.EqualFold(tz, "UTC") {
		return time.UTC, nil
	}
	return time.LoadLocation(tz)
}

// IsProduction reports whether the service runs in a production-like env.
func (c Config) IsProduction() bool {
	return strings.EqualFold(c.Environment, "production")
}

// IsDevelopment reports whether the service runs in local development. Used to
// gate convenience behaviors (e.g. an unauthenticated gRPC port) that must
// fail closed in every deployed environment, including staging.
func (c Config) IsDevelopment() bool {
	return strings.EqualFold(c.Environment, "development")
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
		// The lease must also exceed the cron grace window (2m, due.go cronGrace):
		// if an owner crashes between starting a run and completing the cycle, the
		// lease must not expire while the occurrence is still due, or another
		// replica steals it and fires a duplicate run for the same occurrence.
		if c.CloudSchedulerLeaseTTL <= 2*time.Minute {
			return fmt.Errorf("CLOUD_SCHEDULER_LEASE_TTL must exceed the 2m cron grace window (got %s); use >= 150s", c.CloudSchedulerLeaseTTL)
		}
		// v1 evaluates in UTC only. The window/cron math runs in the configured
		// location, and a DST zone would mishandle the spring-forward gap and the
		// fall-back ambiguous hour; per-task timezone is the committed
		// fast-follow. Reject anything but UTC rather than silently mis-evaluate.
		if tz := strings.TrimSpace(c.CloudSchedulerTimezone); tz != "" && !strings.EqualFold(tz, "UTC") {
			return fmt.Errorf("CLOUD_SCHEDULER_TIMEZONE must be UTC in v1 (per-task timezone is a committed fast-follow); got %q", c.CloudSchedulerTimezone)
		}
	}
	if c.TemporalSchedulesEnabled {
		if !c.TemporalEnabled {
			return fmt.Errorf("TEMPORAL_ENABLED must be true when TEMPORAL_SCHEDULES_ENABLED=true")
		}
		// The RFC 001 loop is the mandated fallback for any cron whose schedule
		// sync is not "current", and the scheduler binary hosts the reconciler.
		// Schedules without the loop would leave failed syncs silently unfired.
		if !c.CloudSchedulerEnabled {
			return fmt.Errorf("CLOUD_SCHEDULER_ENABLED must be true when TEMPORAL_SCHEDULES_ENABLED=true (the loop is the fallback and hosts the reconciler)")
		}
		if c.TemporalScheduleCatchup <= 0 {
			return fmt.Errorf("TEMPORAL_SCHEDULE_CATCHUP must be > 0")
		}
		if c.TemporalScheduleReconcileInterval <= 0 {
			return fmt.Errorf("TEMPORAL_SCHEDULE_RECONCILE_INTERVAL must be > 0")
		}
	}
	if c.CloudEventsRoutingEnabled {
		// The router runs as a Temporal workflow; without Temporal events would
		// pile up pending forever. Fail fast at boot.
		if !c.TemporalEnabled {
			return fmt.Errorf("TEMPORAL_ENABLED must be true when CLOUD_EVENTS_ROUTING_ENABLED=true")
		}
	}
	if c.GoogleWatchEnabled {
		// Calendar channels are registered with PUBLIC_BASE_URL as the push
		// address and GOOGLE_WEBHOOK_TOKEN as the channel token; without them
		// the registrations would either point nowhere or be unverifiable.
		if strings.TrimSpace(c.PublicBaseURL) == "" {
			return fmt.Errorf("PUBLIC_BASE_URL is required when GOOGLE_WATCH_ENABLED=true")
		}
		if strings.TrimSpace(c.GoogleWebhookToken) == "" {
			return fmt.Errorf("GOOGLE_WEBHOOK_TOKEN is required when GOOGLE_WATCH_ENABLED=true")
		}
		if c.GoogleWatchInterval <= 0 || c.GoogleWatchRenewMargin <= 0 {
			return fmt.Errorf("GOOGLE_WATCH_INTERVAL and GOOGLE_WATCH_RENEW_MARGIN must be > 0")
		}
	}
	// The runtime's own deadline must fire BEFORE Temporal's activity
	// StartToCloseTimeout (5m, backgroundtaskworkflow activity options), or
	// runs would fail as activity_timeout and hide the real
	// runtime_deadline_exceeded cause. Raising this ceiling requires raising
	// the activity timeout in the same change (RFC 004 duration coupling).
	if c.CloudRuntimeMaxDuration <= 0 || c.CloudRuntimeMaxDuration >= 5*time.Minute {
		return fmt.Errorf("CLOUD_RUNTIME_MAX_DURATION must be in (0, 5m); got %s", c.CloudRuntimeMaxDuration)
	}
	if c.CloudRuntimeMaxLLMCalls <= 0 || c.CloudRuntimeMaxToolCalls <= 0 {
		return fmt.Errorf("CLOUD_RUNTIME_MAX_LLM_CALLS and CLOUD_RUNTIME_MAX_TOOL_CALLS must be > 0")
	}
	if c.CloudRuntimeMaxArtifactBytes <= 0 || c.CloudRuntimeMaxEventBytes <= 0 {
		return fmt.Errorf("cloud runtime byte limits must be > 0")
	}
	if c.CloudEventsMatchThreshold <= 0 || c.CloudEventsMatchThreshold > 1 {
		return fmt.Errorf("CLOUD_EVENTS_MATCH_THRESHOLD must be in (0, 1]; got %v", c.CloudEventsMatchThreshold)
	}
	if c.CloudEventsMaxPayloadBytes <= 0 {
		return fmt.Errorf("CLOUD_EVENTS_MAX_PAYLOAD_BYTES must be > 0")
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
		if origin == "*" {
			return fmt.Errorf("CORS_ALLOWED_ORIGINS contains non-production origin %q", origin)
		}
		// Match on the parsed HOST, not a substring: a legitimate production
		// origin like https://localhost-tools.example.com contains "localhost"
		// but is not a dev origin and must not be rejected.
		if u, perr := url.Parse(origin); perr == nil {
			switch u.Hostname() {
			case "localhost", "127.0.0.1", "::1":
				return fmt.Errorf("CORS_ALLOWED_ORIGINS contains non-production origin %q", origin)
			}
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

// Load runs before the structured logger exists, so the get* helpers below
// surface malformed env values via the standard library log package. A
// non-empty value that fails to parse logs a warning and falls back to the
// default (rather than silently swallowing the typo); unset/empty values fall
// back to the default silently.

func getint(key string, def int) int {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		n, err := strconv.Atoi(v)
		if err == nil {
			return n
		}
		log.Printf("appconfig: invalid %s=%q (%v); using default %d", key, v, err, def)
	}
	return def
}

func getint64(key string, def int64) int64 {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err == nil {
			return n
		}
		log.Printf("appconfig: invalid %s=%q (%v); using default %d", key, v, err, def)
	}
	return def
}

func getfloat(key string, def float64) float64 {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		f, err := strconv.ParseFloat(v, 64)
		if err == nil {
			return f
		}
		log.Printf("appconfig: invalid %s=%q (%v); using default %v", key, v, err, def)
	}
	return def
}

func getbool(key string, def bool) bool {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		b, err := strconv.ParseBool(v)
		if err == nil {
			return b
		}
		log.Printf("appconfig: invalid %s=%q (%v); using default %t", key, v, err, def)
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
		d, err := time.ParseDuration(v)
		if err == nil {
			return d
		}
		log.Printf("appconfig: invalid %s=%q (%v); using default %s", key, v, err, def)
	}
	return def
}
