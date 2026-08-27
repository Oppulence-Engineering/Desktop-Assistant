// Package appconfig loads process configuration from the environment.
//
// Every value has a sane default so the service boots in local development
// with no configuration. Production values are injected via the Helm chart's
// secret + configmap (see charts/rowboat-api/).
package appconfig

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	// legacyDBEncryptionKeyID is deliberately stable: the first keyring-aware
	// deployment writes this ID into envelopes while retaining the exact legacy
	// DB_ENCRYPTION_KEY derivation for pre-envelope ciphertext.
	legacyDBEncryptionKeyID       = "legacy-db-encryption-key"
	maxDBEncryptionKeyringBytes   = 64 << 10
	maxDBEncryptionKeyringEntries = 32
	maxDBEncryptionKeyIDBytes     = 128
	maxDBEncryptionKeyBytes       = 4 << 10
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
	// Database/sql pool sizing. Postgres defaults are deliberately bounded so
	// sidecar processes (API, worker, scheduler) cannot exhaust server slots.
	DBMaxOpenConns    int
	DBMaxIdleConns    int
	DBConnMaxLifetime time.Duration
	DBConnMaxIdleTime time.Duration

	// Column encryption. DB_ENCRYPTION_PRIMARY_KEY_ID defaults to the stable
	// "legacy-db-encryption-key" ID. DB_ENCRYPTION_KEYRING_JSON, when set, is a
	// bounded JSON object mapping stable IDs to high-entropy passphrases, for
	// example {"legacy-db-encryption-key":"...","2026-08":"..."}. When it is
	// unset, DB_ENCRYPTION_KEY is seeded under the stable legacy ID so old
	// nonce||ciphertext rows remain readable while new writes use envelopes.
	DBEncryptionKey          string
	DBEncryptionPrimaryKeyID string
	DBEncryptionKeyringJSON  string

	// Public values served by GET /v1/config (consumed by the desktop).
	AppURL          string
	OIDCIssuerURL   string // OIDC issuer the desktop signs into (WorkOS AuthKit by default)
	WebsocketAPIURL string

	// Token verification (rowboat-api is itself a resource server).
	TokenIssuer   string // expected iss claim (must equal the issuer that minted the token)
	TokenAudience string // expected aud claim; empty → audience check skipped
	JWKSURL       string // JWKS endpoint; empty → discovered from TokenIssuer's OIDC metadata

	// Identity & authorization plane (RFC 011). These classify a verified
	// token's issuer into a bounded type/actor kind for audit + metrics and
	// power step-up. ServiceTokenIssuer/BrokerTokenIssuer are dark until the
	// deferred service-token / broker modes are promoted.
	ServiceTokenIssuer     string        // iss of first-party signed service tokens
	BrokerTokenIssuer      string        // iss of broker-minted connector resource tokens
	BrokerTokenPrivateKey  string        // RSA private key PEM used only to mint connector resource tokens
	BrokerTokenKeyID       string        // stable JWKS kid for the active broker signing key
	BrokerTokenKeyringJSON string        // JSON kid->RSA public PEM verification/JWKS keyring
	BrokerTokenTTL         time.Duration // short product-token lifetime; RFC 012 caps this at 15m
	StepUpRecentAuthWindow time.Duration // recent-auth window for RequireStepUp

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
	ConnectorsJSON             string
	ConnectorEmergencyDisabled []string
	ConnectorRedirectAllowlist []string

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
	DeepgramAPIKey          string
	ElevenLabsAPIKey        string
	ExaAPIKey               string
	GoogleOAuthClientID     string
	GoogleOAuthClientSecret string
	// PlainAPIKey is optional: when unset, POST /v1/feedback returns
	// provider_unconfigured instead of relaying to Plain.
	PlainAPIKey string
	// ParallelAPIKey is optional and off by default (RFC 039). When unset the
	// cloud research surface reports itself unconfigured; it is NOT in the
	// required-key list below, because a deployment that never sells the
	// Intelligence tier should not be forced to hold a research vendor key.
	ParallelAPIKey string

	// ParallelBaseURL points the research client at the vendor (or at a stub in
	// staging).
	ParallelBaseURL string

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

	// Stripe billing. When StripeSecretKey is empty, checkout/portal endpoints
	// return provider_unconfigured while /v1/me and free-tier metering keep
	// working for local development.
	StripeSecretKey      string
	StripeWebhookSecret  string
	StripeStarterPriceID string
	StripeProPriceID     string
	// STRIPE_INTELLIGENCE_PRICE_ID is the cloud-research tier (RFC 039).
	StripeIntelligencePriceID string
	StripeSuccessURL          string
	StripeCancelURL           string
	StripeAPIBaseURL          string
	StripeStarterCredits      int
	StripeProCredits          int
	StripeIntelligenceCredits int

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
	// Cloud research (RFC 039) draws on its own ring-fenced budget as well as the
	// shared one above. Without it, a busy day of model traffic consumes the
	// shared cap and the nightly account sweep silently stops — the user is
	// asleep for both halves of that. Sized against the promise: 250 accounts at
	// 50 credits, polled daily, is 375,000 credits a month.
	ResearchDailyCreditLimit   int
	ResearchMonthlyCreditLimit int

	// LLM request policy.
	LLMAllowedModels       []string
	LLMMaxPromptBytes      int
	LLMMaxToolPayloadBytes int
	LLMMaxMessages         int
	LLMDefaultMaxOutput    int

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

	// Temporal Schedules for exact-cron api-target tasks (RFC 005). Enabled
	// by default; TEMPORAL_SCHEDULES_ENABLED=false is the instant rollback
	// (the RFC 001 loop resumes every cron). Inert unless TEMPORAL_ENABLED is
	// also true — every consumer (server syncer, worker fires, scheduler
	// reconciler + loop gate) sits behind a Temporal gate.
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

	// Cloud run admission guardrails. These run before Temporal workflow start
	// so scheduled runs are either admitted with priority metadata or
	// dead-lettered with a stable reason instead of failing late in the worker.
	CloudRunAdmissionEnabled       bool
	CloudRunMaxInflightGlobal      int
	CloudRunMaxInflightPerUser     int
	CloudRunRateLimitGlobalPerMin  int
	CloudRunRateLimitPerUserPerMin int

	// Per-user LLM gateway limits. Deliberately generous: the desktop is an
	// agentic client whose tool loops make many small calls for one user action
	// (labeling 15 emails is ~16 round trips), and spend is capped separately by
	// DAILY_CREDIT_LIMIT / MONTHLY_CREDIT_LIMIT plus per-call credit reservation.
	// These bound burst and abuse, not cost.
	LLMRateLimitPerUserPerMin      int
	LLMRateLimitPerUserBurst       int
	CloudRunCreditPreflightEnabled bool

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
	GoogleWebhookOIDCAudience  string  // expected aud on authenticated Gmail Pub/Sub pushes
	GoogleWebhookOIDCEmail     string  // expected service-account email on Gmail Pub/Sub pushes
	WebhookSigningSecret       string  // verifies /v1/webhooks/events HMACs

	// Web search backs the durable-agent web.search tool (Tavily-shaped API).
	// Empty WebSearchAPIKey disables the tool (it reports itself unavailable).
	WebSearchAPIURL string
	WebSearchAPIKey string

	// Portfolio faculties (RFC 008): Conduit (evidence) and Eigen (foresight),
	// reached as runtime tools. Empty base URL disables that faculty's tool; calls
	// use the shared service-token issuer and agent signing secret.
	ConduitBaseURL string
	EigenBaseURL   string

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
	// GmailAPIBaseURL / CalendarAPIBaseURL / DriveAPIBaseURL override Google's API hosts (dev mocks).
	GmailAPIBaseURL    string
	CalendarAPIBaseURL string
	DriveAPIBaseURL    string

	// Cloud agent runtime (RFC 004): the LLM-backed, tool-scoped agent loop
	// that the Temporal worker's ExecuteAPITask delegates to. Enabled by
	// default; CLOUD_RUNTIME_ENABLED=false is the rollback kill-switch
	// selecting the deterministic NoopRuntime artifact path.
	CloudRuntimeEnabled          bool
	CloudRuntimeModel            string        // model used when the task carries none
	CloudRuntimeMaxDuration      time.Duration // wall clock per run; MUST stay < the execute activity timeout
	CloudRuntimeMaxLLMCalls      int
	CloudRuntimeMaxToolCalls     int
	CloudRuntimeMaxArtifactBytes int
	CloudRuntimeMaxEventBytes    int
	// Optional sandbox.run tool for API tasks. It runs code/browser/dependency-
	// heavy work in a Kubernetes Job instead of the worker process.
	CloudRuntimeSandboxEnabled        bool
	CloudRuntimeSandboxBackend        string
	CloudRuntimeSandboxImage          string
	CloudRuntimeSandboxAllowedImages  []string
	CloudRuntimeSandboxNamespace      string
	CloudRuntimeSandboxServiceAccount string
	CloudRuntimeSandboxMaxDuration    time.Duration
	CloudRuntimeSandboxPollInterval   time.Duration
	CloudRuntimeSandboxMaxScriptBytes int
	CloudRuntimeSandboxMaxOutputBytes int
	CloudRuntimeSandboxCPURequest     string
	CloudRuntimeSandboxMemoryRequest  string
	CloudRuntimeSandboxCPULimit       string
	CloudRuntimeSandboxMemoryLimit    string
	CloudRuntimeSandboxWorkspaceSize  string
	CloudRuntimeSandboxTTLSeconds     int

	// Durable agent runtime (RFC 027): the per-step durable, multi-turn agent
	// framework whose reason→act loop runs in Temporal workflow code (each
	// LLM/tool call its own checkpointed activity). It has no master flag — it is
	// active wherever Temporal is enabled (the same gating as the cloud runtime
	// and event router; it cannot run without durable workflows). The sub-flags
	// are capability toggles, on by default.
	AgentStreamingEnabled bool // P2: NDJSON SSE + Redis fan-out (falls back to poll without Redis)
	AgentHITLEnabled      bool // P3: approval-required tools pause on workflow.Await
	AgentSubagentsEnabled bool // P4: subagent.delegate → child workflows
	AgentRuntimeModel     string

	// Per-turn budgets. AgentMaxWallclockPerTurn MUST stay < the 5m activity
	// StartToCloseTimeout (same coupling invariant as CLOUD_RUNTIME_MAX_DURATION).
	AgentMaxLLMCallsPerTurn  int
	AgentMaxToolCallsPerTurn int
	AgentMaxWallclockPerTurn time.Duration

	// Per-session governors carried through ContinueAsNew. The cost ceiling is
	// an additional governor layered on the per-call quota.Gate SpendLimits.
	AgentMaxTurnsPerSession      int
	AgentMaxLLMCallsPerSession   int
	AgentMaxCostUnitsPerSession  int
	AgentSessionIdleTimeout      time.Duration // idle-between-turns close timer (zero-cost while idle)
	AgentContinueAsNewEveryTurns int           // bound Temporal history every N turns

	// Subagent caps (RFC 018) bound recursive credit burn.
	AgentMaxSubagentDepth  int
	AgentMaxSubagentFanout int

	// Agent runtime signing secret (RFC 012/027): the HMAC key for money-moving
	// approval tokens and session continuation tokens. Required in production
	// when HITL is enabled; AgentSigningSecret() derives a dev fallback when
	// empty. RequireMFAForMoneyMoving gates money-moving grants on an MFA
	// step-up (the WorkOS amr/acr claim); ApprovalTokenTTL bounds token life.
	AgentRuntimeSigningSecret     string
	AgentRequireMFAForMoneyMoving bool
	AgentApprovalTokenTTL         time.Duration

	// AgentDefaultChannelAgent is the agent slug a channel adapter uses when no
	// agent is explicitly named and none is bound to the channel (P5).
	AgentDefaultChannelAgent string

	// RFC 028 declarative authoring. YAML authoring (PUT/validate/format/
	// revisions/rollback) is always on wherever the runtime is. These two gate
	// the conditional pieces: declarative OpenAPI/MCP tools need RFC 020's
	// generic executor (not yet built), and GitOps makes a repo authoritative.
	AgentDeclarativeToolsEnabled bool
	AgentGitOpsEnabled           bool

	// RFC 030 revenue memory and outbound governance. Always mounted. With
	// no facade base URL the workspace runs in local mode — observation and
	// draft-only execution work; preflight and sends fail closed.
	RevenueFacadeBaseURL      string
	RevenueFacadeServiceToken string
	RevenueFacadeTimeout      time.Duration

	// Background auto-scan sweeper (RFC 030 WP3, self-running). Ships dark:
	// the scheduler only starts it when RevenueAutoScanEnabled is true. It
	// runs an incremental leak scan for every Google-connected user no more
	// often than RevenueAutoScanMinInterval.
	RevenueAutoScanEnabled       bool
	RevenueAutoScanInterval      time.Duration
	RevenueAutoScanMinInterval   time.Duration
	RevenueAutoScanMaxPerCycle   int
	RevenueAutoScanLookbackDays  int
	RevenueMailRetentionMonths   int
	MailBodyCacheTTLHours        int
	RevenueSemanticMemoryEnabled bool
	RevenueMailPushSyncEnabled   bool
	EmbeddingsModel              string

	// Proactive digest (RFC 030). Ships dark behind RevenueDigestEnabled and
	// requires a configured email provider. Emails each user with open
	// actions a summary no more often than RevenueDigestMinInterval.
	RevenueDigestEnabled     bool
	RevenueDigestInterval    time.Duration
	RevenueDigestMinInterval time.Duration
	RevenueDigestMaxPerCycle int

	// Transactional email provider (Resend). An empty ResendAPIKey disables
	// all outbound email (the sender becomes a fail-closed no-op).
	ResendAPIKey string
	EmailFrom    string

	// Closed-loop action broker (RFC 023). Ships dark: the propose→approve→
	// execute→watch surface mounts only when ActionsEnabled is true. The
	// approval token is HMAC-signed with AgentSigningSecret().
	ActionsEnabled                  bool
	ActionTokenTTL                  time.Duration
	ActionWatchTimeout              time.Duration
	ActionRequireStepUpForFinancial bool
	// Product Act-seam endpoint approved actions execute against (RFC 023 WP3).
	// Empty ⇒ no executor is wired and execute fails closed.
	ActionActSeamBaseURL string
	ActionActSeamToken   string
	ActionActSeamTimeout time.Duration
}

// AgentSigningSecret resolves the HMAC signing key for agent-runtime tokens:
// the dedicated secret, else the internal API secret, else a clearly-marked dev
// fallback (production rejects the empty case in Validate when HITL is on).
func (c Config) AgentSigningSecret() string {
	if s := strings.TrimSpace(c.AgentRuntimeSigningSecret); s != "" {
		return s
	}
	if s := strings.TrimSpace(c.InternalAPISecret); s != "" {
		return s
	}
	return "dev-agent-signing-secret-do-not-use-in-prod"
}

// DBEncryptionKeyring resolves the rotation configuration consumed by
// crypto.NewKeyringSealer. If no explicit ring is configured, the legacy
// DB_ENCRYPTION_KEY is placed under legacyDBEncryptionKeyID. This preserves the
// old SHA-256-derived AES key for unversioned ciphertext while giving all new
// ciphertext a stable, self-describing key ID.
func (c Config) DBEncryptionKeyring() (string, map[string]string, error) {
	primaryKeyID := strings.TrimSpace(c.DBEncryptionPrimaryKeyID)
	if err := validateDBEncryptionKeyID(primaryKeyID); err != nil {
		return "", nil, fmt.Errorf("DB_ENCRYPTION_PRIMARY_KEY_ID %w", err)
	}

	if len(c.DBEncryptionKeyringJSON) > maxDBEncryptionKeyringBytes {
		return "", nil, fmt.Errorf("DB_ENCRYPTION_KEYRING_JSON exceeds %d bytes", maxDBEncryptionKeyringBytes)
	}
	raw := strings.TrimSpace(c.DBEncryptionKeyringJSON)
	if raw == "" {
		if strings.TrimSpace(c.DBEncryptionKey) == "" {
			return "", nil, fmt.Errorf("DB_ENCRYPTION_KEY is required when DB_ENCRYPTION_KEYRING_JSON is unset")
		}
		keyring := map[string]string{legacyDBEncryptionKeyID: c.DBEncryptionKey}
		if primaryKeyID != legacyDBEncryptionKeyID {
			return "", nil, fmt.Errorf("DB_ENCRYPTION_PRIMARY_KEY_ID %q is not present in the legacy fallback keyring; use %q or configure DB_ENCRYPTION_KEYRING_JSON", primaryKeyID, legacyDBEncryptionKeyID)
		}
		return primaryKeyID, keyring, nil
	}
	keyring, err := decodeDBEncryptionKeyring(raw)
	if err != nil {
		return "", nil, fmt.Errorf("DB_ENCRYPTION_KEYRING_JSON: %w", err)
	}
	if len(keyring) == 0 {
		return "", nil, fmt.Errorf("DB_ENCRYPTION_KEYRING_JSON must contain at least one key")
	}
	if len(keyring) > maxDBEncryptionKeyringEntries {
		return "", nil, fmt.Errorf("DB_ENCRYPTION_KEYRING_JSON contains %d keys; maximum is %d", len(keyring), maxDBEncryptionKeyringEntries)
	}
	for keyID, passphrase := range keyring {
		if err := validateDBEncryptionKeyID(keyID); err != nil {
			return "", nil, fmt.Errorf("DB_ENCRYPTION_KEYRING_JSON key ID %q %w", keyID, err)
		}
		if strings.TrimSpace(passphrase) == "" {
			return "", nil, fmt.Errorf("DB_ENCRYPTION_KEYRING_JSON key %q has an empty passphrase", keyID)
		}
		if len(passphrase) > maxDBEncryptionKeyBytes {
			return "", nil, fmt.Errorf("DB_ENCRYPTION_KEYRING_JSON key %q exceeds %d bytes", keyID, maxDBEncryptionKeyBytes)
		}
	}
	if _, ok := keyring[primaryKeyID]; !ok {
		return "", nil, fmt.Errorf("DB_ENCRYPTION_PRIMARY_KEY_ID %q is not present in DB_ENCRYPTION_KEYRING_JSON", primaryKeyID)
	}
	return primaryKeyID, keyring, nil
}

func decodeDBEncryptionKeyring(raw string) (map[string]string, error) {
	decoder := json.NewDecoder(strings.NewReader(raw))
	start, err := decoder.Token()
	if err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	if delim, ok := start.(json.Delim); !ok || delim != '{' {
		return nil, fmt.Errorf("must be a JSON object mapping key IDs to passphrases")
	}

	keyring := make(map[string]string)
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return nil, fmt.Errorf("invalid key ID: %w", err)
		}
		keyID, ok := keyToken.(string)
		if !ok {
			return nil, fmt.Errorf("key IDs must be strings")
		}
		if _, duplicate := keyring[keyID]; duplicate {
			return nil, fmt.Errorf("duplicate key ID %q", keyID)
		}
		var passphrase string
		if err := decoder.Decode(&passphrase); err != nil {
			return nil, fmt.Errorf("key %q passphrase must be a string: %w", keyID, err)
		}
		keyring[keyID] = passphrase
		if len(keyring) > maxDBEncryptionKeyringEntries {
			return nil, fmt.Errorf("contains more than %d keys", maxDBEncryptionKeyringEntries)
		}
	}
	if _, err := decoder.Token(); err != nil {
		return nil, fmt.Errorf("invalid JSON object: %w", err)
	}
	if _, err := decoder.Token(); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("contains trailing JSON data")
		}
		return nil, fmt.Errorf("invalid trailing JSON data: %w", err)
	}
	return keyring, nil
}

func validateDBEncryptionKeyID(keyID string) error {
	if keyID == "" {
		return fmt.Errorf("must not be empty")
	}
	if len(keyID) > maxDBEncryptionKeyIDBytes {
		return fmt.Errorf("exceeds %d bytes", maxDBEncryptionKeyIDBytes)
	}
	for _, r := range keyID {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			continue
		}
		return fmt.Errorf("must contain only ASCII letters, digits, '.', '_', or '-'")
	}
	return nil
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

		DatabaseURL:    getenv("DATABASE_URL", ""),
		RedisURL:       getenv("REDIS_URL", ""),
		AutoMigrate:    getbool("AUTO_MIGRATE", true),
		DBMaxOpenConns: getint("DB_MAX_OPEN_CONNS", 20),
		DBMaxIdleConns: getint("DB_MAX_IDLE_CONNS", 10),
		DBConnMaxLifetime: getdur("DB_CONN_MAX_LIFETIME",
			30*time.Minute),
		DBConnMaxIdleTime: getdur("DB_CONN_MAX_IDLE_TIME",
			5*time.Minute),
		DBEncryptionKey:          getenvAllowEmpty("DB_ENCRYPTION_KEY", "dev-insecure-encryption-key-change-me"),
		DBEncryptionPrimaryKeyID: getenvAllowEmpty("DB_ENCRYPTION_PRIMARY_KEY_ID", legacyDBEncryptionKeyID),
		DBEncryptionKeyringJSON:  getenvAllowEmpty("DB_ENCRYPTION_KEYRING_JSON", ""),

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

		// RFC 011 issuer classification + step-up. The service/broker issuers
		// default to stable internal names (matching the RFC claim contracts) so
		// classification works the moment those token modes are enabled.
		ServiceTokenIssuer:     getenv("SERVICE_TOKEN_ISSUER", "rowboat-internal"),
		BrokerTokenIssuer:      getenv("BROKER_TOKEN_ISSUER", "rowboat-broker"),
		BrokerTokenPrivateKey:  getenvAllowEmpty("BROKER_TOKEN_PRIVATE_KEY_PEM", ""),
		BrokerTokenKeyID:       getenv("BROKER_TOKEN_KEY_ID", "rowboat-broker-1"),
		BrokerTokenKeyringJSON: getenvAllowEmpty("BROKER_TOKEN_KEYRING_JSON", ""),
		BrokerTokenTTL:         getdur("BROKER_TOKEN_TTL", 5*time.Minute),
		StepUpRecentAuthWindow: getdur("STEPUP_RECENT_AUTH_WINDOW", 15*time.Minute),

		WorkOSAPIKey:           getenv("WORKOS_API_KEY", ""),
		WorkOSClientID:         getenv("WORKOS_CLIENT_ID", ""),
		WorkOSBaseURL:          getenv("WORKOS_BASE_URL", ""),
		WorkOSAuthorizeBaseURL: getenv("WORKOS_AUTHORIZE_BASE_URL", ""),
		// Default to the WorkOS client id so WorkOS-direct needs only WORKOS_CLIENT_ID.
		OAuthClientID: getenv("OAUTH_CLIENT_ID", getenv("WORKOS_CLIENT_ID", "")),

		OryPublicURL:               getenv("ORY_PUBLIC_URL", "https://oauth.solomon-ai.co"),
		OryAdminURL:                getenv("ORY_ADMIN_URL", ""),
		OryBrokerClientID:          getenv("ORY_BROKER_CLIENT_ID", ""),
		OryBrokerClientSecret:      getenv("ORY_BROKER_CLIENT_SECRET", ""),
		PublicBaseURL:              getenv("PUBLIC_BASE_URL", "https://api.x.solomon-ai.co"),
		ConnectorsJSON:             getenv("CONNECTORS_JSON", ""),
		ConnectorEmergencyDisabled: getcsv("CONNECTOR_EMERGENCY_DISABLED", ""),
		ConnectorRedirectAllowlist: getcsv("CONNECTOR_REDIRECT_ALLOWLIST", ""),

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
		DeepgramAPIKey:              getenv("DEEPGRAM_API_KEY", ""),
		ElevenLabsAPIKey:            getenv("ELEVENLABS_API_KEY", ""),
		ExaAPIKey:                   getenv("EXA_API_KEY", ""),
		GoogleOAuthClientID:         getenv("GOOGLE_OAUTH_CLIENT_ID", ""),
		GoogleOAuthClientSecret:     getenv("GOOGLE_OAUTH_CLIENT_SECRET", ""),
		PlainAPIKey:                 getenv("PLAIN_API_KEY", ""),
		ParallelAPIKey:              getenv("PARALLEL_API_KEY", ""),
		ParallelBaseURL:             getenv("PARALLEL_BASE_URL", "https://api.parallel.ai"),
		PlainAPIURL:                 getenv("PLAIN_API_URL", "https://core-api.uk.plain.com/graphql/v1"),
		PlainLabelTypeIDs:           getenv("PLAIN_LABEL_TYPE_IDS", ""),
		PlainTitlePrefix:            getenv("PLAIN_TITLE_PREFIX", ""),
		VendorTimeout:               getdur("VENDOR_TIMEOUT", 30*time.Second),
		VendorResponseHeaderTimeout: getdur("VENDOR_RESPONSE_HEADER_TIMEOUT", 15*time.Second),
		VendorMaxConcurrent:         getint("VENDOR_MAX_CONCURRENT", 64),
		LLMMaxConcurrent:            getint("LLM_MAX_CONCURRENT", 32),
		UpstreamResponseMaxBytes:    getint64("UPSTREAM_RESPONSE_MAX_BYTES", 64<<20),
		GoogleTokenURL:              getenv("GOOGLE_TOKEN_URL", ""),
		GoogleAuthorizeURL:          getenv("GOOGLE_AUTHORIZE_URL", ""),
		GoogleRedirectURI:           getenv("GOOGLE_REDIRECT_URI", ""),

		DesktopDeepLinkScheme:     getenv("DESKTOP_DEEPLINK_SCHEME", "solomon-ai"),
		FreeTierCredits:           getint("FREE_TIER_CREDITS", 10000),
		StripeSecretKey:           getenv("STRIPE_SECRET_KEY", ""),
		StripeWebhookSecret:       getenv("STRIPE_WEBHOOK_SECRET", ""),
		StripeStarterPriceID:      getenv("STRIPE_STARTER_PRICE_ID", ""),
		StripeProPriceID:          getenv("STRIPE_PRO_PRICE_ID", ""),
		StripeIntelligencePriceID: getenv("STRIPE_INTELLIGENCE_PRICE_ID", ""),
		StripeSuccessURL:          getenv("STRIPE_SUCCESS_URL", getenv("APP_URL", "https://app.solomon-ai.co")+"/billing/success"),
		StripeCancelURL:           getenv("STRIPE_CANCEL_URL", getenv("APP_URL", "https://app.solomon-ai.co")+"/billing/cancel"),
		StripeAPIBaseURL:          getenv("STRIPE_API_BASE_URL", "https://api.stripe.com"),
		StripeStarterCredits:      getint("STRIPE_STARTER_CREDITS", 200000),
		StripeProCredits:          getint("STRIPE_PRO_CREDITS", 2000000),
		// Matches the shared monthly cap. A larger grant would be dead config: the
		// 2,000,000-credit MONTHLY_CREDIT_LIMIT binds first, so headroom above it
		// can never be spent. Research is governed by its own budget, not by this.
		StripeIntelligenceCredits: getint("STRIPE_INTELLIGENCE_CREDITS", 2000000),

		FreeMeetingSecondsPerMonth:  getint("FREE_MEETING_SECONDS_PER_MONTH", 10800), // 180 min
		TranscriptionVoiceDefault:   getenv("TRANSCRIPTION_VOICE_DEFAULT", "whisper-local"),
		TranscriptionMeetingDefault: getenv("TRANSCRIPTION_MEETING_DEFAULT", "deepgram"),

		PricingJSON:                getenv("PRICING_JSON", ""),
		DailyCreditLimit:           getint("DAILY_CREDIT_LIMIT", 100000),
		MonthlyCreditLimit:         getint("MONTHLY_CREDIT_LIMIT", 2000000),
		ResearchDailyCreditLimit:   getint("RESEARCH_DAILY_CREDIT_LIMIT", 50000),
		ResearchMonthlyCreditLimit: getint("RESEARCH_MONTHLY_CREDIT_LIMIT", 500000),
		LLMAllowedModels:           getcsv("LLM_ALLOWED_MODELS", ""),
		LLMMaxPromptBytes:          getint("LLM_MAX_PROMPT_BYTES", 2<<20),
		LLMMaxToolPayloadBytes:     getint("LLM_MAX_TOOL_PAYLOAD_BYTES", 1<<20),
		LLMMaxMessages:             getint("LLM_MAX_MESSAGES", 128),
		LLMDefaultMaxOutput:        getint("LLM_DEFAULT_MAX_OUTPUT_TOKENS", 0),
		OpenAIBaseURL:              getenv("OPENAI_BASE_URL", ""),
		OpenRouterBaseURL:          getenv("OPENROUTER_BASE_URL", ""),
		GraphQLIntrospection:       getbool("GRAPHQL_INTROSPECTION_ENABLED", !production),
		GraphQLMaxComplexity:       getint("GRAPHQL_MAX_COMPLEXITY", 250),
		GraphQLMaxDepth:            getint("GRAPHQL_MAX_DEPTH", 12),

		TemporalEnabled:       getbool("TEMPORAL_ENABLED", false),
		TemporalAddress:       getenv("TEMPORAL_ADDRESS", "localhost:7233"),
		TemporalNamespace:     getenv("TEMPORAL_NAMESPACE", "default"),
		TemporalTaskQueue:     getenv("TEMPORAL_TASK_QUEUE", "rowboat-api-background-tasks"),
		TemporalWorkerEnabled: getbool("TEMPORAL_WORKER_ENABLED", false),
		TemporalAPIKey:        getenv("TEMPORAL_API_KEY", ""),
		TemporalTLSEnabled:    getbool("TEMPORAL_TLS_ENABLED", false),

		TemporalSchedulesEnabled:          getbool("TEMPORAL_SCHEDULES_ENABLED", true),
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

		CloudRunAdmissionEnabled:       getbool("CLOUD_RUN_ADMISSION_ENABLED", true),
		CloudRunMaxInflightGlobal:      getint("CLOUD_RUN_MAX_INFLIGHT_GLOBAL", 5000),
		CloudRunMaxInflightPerUser:     getint("CLOUD_RUN_MAX_INFLIGHT_PER_USER", 50),
		CloudRunRateLimitGlobalPerMin:  getint("CLOUD_RUN_RATE_LIMIT_GLOBAL_PER_MINUTE", 2000),
		CloudRunRateLimitPerUserPerMin: getint("CLOUD_RUN_RATE_LIMIT_PER_USER_PER_MINUTE", 60),
		LLMRateLimitPerUserPerMin:      getint("LLM_RATE_LIMIT_PER_USER_PER_MINUTE", 600),
		LLMRateLimitPerUserBurst:       getint("LLM_RATE_LIMIT_PER_USER_BURST_PER_10S", 100),
		CloudRunCreditPreflightEnabled: getbool("CLOUD_RUN_CREDIT_PREFLIGHT_ENABLED", true),

		CloudEventsRoutingEnabled: getbool("CLOUD_EVENTS_ROUTING_ENABLED", false),
		CloudEventsMatchThreshold: getfloat("CLOUD_EVENTS_MATCH_THRESHOLD", 0.7),
		// Routing is two cheap bounded calls per event; default to the cheapest
		// priced model (see internal/pricing DefaultTable).
		CloudEventsRouterModel:     getenv("CLOUD_EVENTS_ROUTER_MODEL", "anthropic/claude-haiku-4-5"),
		CloudEventsMaxPayloadBytes: getint("CLOUD_EVENTS_MAX_PAYLOAD_BYTES", 256<<10),
		SlackSigningSecret:         getenv("SLACK_SIGNING_SECRET", ""),
		GoogleWebhookToken:         getenv("GOOGLE_WEBHOOK_TOKEN", ""),
		GoogleWebhookOIDCAudience:  getenv("GOOGLE_WEBHOOK_OIDC_AUDIENCE", ""),
		GoogleWebhookOIDCEmail:     getenv("GOOGLE_WEBHOOK_OIDC_SERVICE_ACCOUNT", ""),
		WebhookSigningSecret:       getenv("WEBHOOK_SIGNING_SECRET", ""),

		WebSearchAPIURL: getenv("WEB_SEARCH_API_URL", "https://api.tavily.com/search"),
		WebSearchAPIKey: getenv("WEB_SEARCH_API_KEY", ""),

		ConduitBaseURL: getenv("CONDUIT_BASE_URL", ""),
		EigenBaseURL:   getenv("EIGEN_BASE_URL", ""),

		SlackClientID:     getenv("SLACK_CLIENT_ID", ""),
		SlackClientSecret: getenv("SLACK_CLIENT_SECRET", ""),
		SlackOAuthScopes:  getenv("SLACK_OAUTH_SCOPES", "app_mentions:read,channels:history,channels:read,chat:write,users:read"),
		SlackRedirectURI:  getenv("SLACK_REDIRECT_URI", ""),
		SlackAuthorizeURL: getenv("SLACK_AUTHORIZE_URL", ""),
		SlackTokenURL:     getenv("SLACK_TOKEN_URL", ""),

		GoogleWatchEnabled:     getbool("GOOGLE_WATCH_ENABLED", false),
		GmailPubSubTopic:       getenv("GMAIL_PUBSUB_TOPIC", ""),
		GoogleWatchInterval:    getdur("GOOGLE_WATCH_INTERVAL", 15*time.Minute),
		GoogleWatchRenewMargin: getdur("GOOGLE_WATCH_RENEW_MARGIN", 24*time.Hour),
		GmailAPIBaseURL:        getenv("GMAIL_API_BASE_URL", ""),
		CalendarAPIBaseURL:     getenv("CALENDAR_API_BASE_URL", ""),
		DriveAPIBaseURL:        getenv("DRIVE_API_BASE_URL", ""),

		CloudRuntimeEnabled:               getbool("CLOUD_RUNTIME_ENABLED", true),
		CloudRuntimeModel:                 getenv("CLOUD_RUNTIME_MODEL", "anthropic/claude-sonnet-4-5"),
		CloudRuntimeMaxDuration:           getdur("CLOUD_RUNTIME_MAX_DURATION", 4*time.Minute),
		CloudRuntimeMaxLLMCalls:           getint("CLOUD_RUNTIME_MAX_LLM_CALLS", 12),
		CloudRuntimeMaxToolCalls:          getint("CLOUD_RUNTIME_MAX_TOOL_CALLS", 24),
		CloudRuntimeMaxArtifactBytes:      getint("CLOUD_RUNTIME_MAX_ARTIFACT_BYTES", 1<<20),
		CloudRuntimeMaxEventBytes:         getint("CLOUD_RUNTIME_MAX_EVENT_BYTES", 64<<10),
		CloudRuntimeSandboxEnabled:        getbool("CLOUD_RUNTIME_SANDBOX_ENABLED", false),
		CloudRuntimeSandboxBackend:        getenv("CLOUD_RUNTIME_SANDBOX_BACKEND", "kubernetes-job"),
		CloudRuntimeSandboxImage:          getenv("CLOUD_RUNTIME_SANDBOX_IMAGE", "python:3.12-slim"),
		CloudRuntimeSandboxAllowedImages:  getcsv("CLOUD_RUNTIME_SANDBOX_ALLOWED_IMAGES", "python:3.12-slim,mcr.microsoft.com/playwright:*"),
		CloudRuntimeSandboxNamespace:      getenv("CLOUD_RUNTIME_SANDBOX_NAMESPACE", ""),
		CloudRuntimeSandboxServiceAccount: getenv("CLOUD_RUNTIME_SANDBOX_SERVICE_ACCOUNT", ""),
		CloudRuntimeSandboxMaxDuration:    getdur("CLOUD_RUNTIME_SANDBOX_MAX_DURATION", 4*time.Minute),
		CloudRuntimeSandboxPollInterval:   getdur("CLOUD_RUNTIME_SANDBOX_POLL_INTERVAL", 5*time.Second),
		CloudRuntimeSandboxMaxScriptBytes: getint("CLOUD_RUNTIME_SANDBOX_MAX_SCRIPT_BYTES", 32<<10),
		CloudRuntimeSandboxMaxOutputBytes: getint("CLOUD_RUNTIME_SANDBOX_MAX_OUTPUT_BYTES", 64<<10),
		CloudRuntimeSandboxCPURequest:     getenv("CLOUD_RUNTIME_SANDBOX_CPU_REQUEST", "100m"),
		CloudRuntimeSandboxMemoryRequest:  getenv("CLOUD_RUNTIME_SANDBOX_MEMORY_REQUEST", "128Mi"),
		CloudRuntimeSandboxCPULimit:       getenv("CLOUD_RUNTIME_SANDBOX_CPU_LIMIT", "1"),
		CloudRuntimeSandboxMemoryLimit:    getenv("CLOUD_RUNTIME_SANDBOX_MEMORY_LIMIT", "1Gi"),
		CloudRuntimeSandboxWorkspaceSize:  getenv("CLOUD_RUNTIME_SANDBOX_WORKSPACE_SIZE", "1Gi"),
		CloudRuntimeSandboxTTLSeconds:     getint("CLOUD_RUNTIME_SANDBOX_TTL_SECONDS", 600),

		AgentStreamingEnabled: getbool("AGENT_STREAMING_ENABLED", true),
		AgentHITLEnabled:      getbool("AGENT_HITL_ENABLED", true),
		AgentSubagentsEnabled: getbool("AGENT_SUBAGENTS_ENABLED", true),
		AgentRuntimeModel:     getenv("AGENT_RUNTIME_MODEL", "anthropic/claude-sonnet-4-5"),

		AgentMaxLLMCallsPerTurn:  getint("AGENT_MAX_LLM_CALLS_PER_TURN", 12),
		AgentMaxToolCallsPerTurn: getint("AGENT_MAX_TOOL_CALLS_PER_TURN", 24),
		AgentMaxWallclockPerTurn: getdur("AGENT_MAX_WALLCLOCK_PER_TURN", 4*time.Minute),

		AgentMaxTurnsPerSession:      getint("AGENT_MAX_TURNS_PER_SESSION", 100),
		AgentMaxLLMCallsPerSession:   getint("AGENT_MAX_LLM_CALLS_PER_SESSION", 500),
		AgentMaxCostUnitsPerSession:  getint("AGENT_MAX_COST_UNITS_PER_SESSION", 1000000),
		AgentSessionIdleTimeout:      getdur("AGENT_SESSION_IDLE_TIMEOUT", 24*time.Hour),
		AgentContinueAsNewEveryTurns: getint("AGENT_CONTINUE_AS_NEW_EVERY_TURNS", 20),

		AgentMaxSubagentDepth:  getint("AGENT_MAX_SUBAGENT_DEPTH", 3),
		AgentMaxSubagentFanout: getint("AGENT_MAX_SUBAGENT_FANOUT", 8),

		AgentRuntimeSigningSecret:     getenv("AGENT_RUNTIME_SIGNING_SECRET", ""),
		AgentRequireMFAForMoneyMoving: getbool("AGENT_REQUIRE_MFA_FOR_MONEY_MOVING", true),
		AgentApprovalTokenTTL:         getdur("AGENT_APPROVAL_TOKEN_TTL", 10*time.Minute),
		AgentDefaultChannelAgent:      getenv("AGENT_DEFAULT_CHANNEL_AGENT", "assistant"),

		AgentDeclarativeToolsEnabled: getbool("AGENT_DECLARATIVE_TOOLS_ENABLED", false),
		AgentGitOpsEnabled:           getbool("AGENT_GITOPS_ENABLED", false),

		RevenueAutoScanEnabled:       getbool("REVENUE_AUTO_SCAN_ENABLED", false),
		RevenueAutoScanInterval:      getdur("REVENUE_AUTO_SCAN_INTERVAL", time.Hour),
		RevenueAutoScanMinInterval:   getdur("REVENUE_AUTO_SCAN_MIN_INTERVAL", 24*time.Hour),
		RevenueAutoScanMaxPerCycle:   getint("REVENUE_AUTO_SCAN_MAX_PER_CYCLE", 200),
		RevenueAutoScanLookbackDays:  getint("REVENUE_AUTO_SCAN_LOOKBACK_DAYS", 90),
		RevenueMailRetentionMonths:   getint("REVENUE_MAIL_RETENTION_MONTHS", 18),
		MailBodyCacheTTLHours:        getint("MAIL_BODY_CACHE_TTL_HOURS", 72),
		RevenueSemanticMemoryEnabled: getbool("REVENUE_SEMANTIC_MEMORY_ENABLED", false),
		RevenueMailPushSyncEnabled:   getbool("REVENUE_MAIL_PUSH_SYNC_ENABLED", false),
		EmbeddingsModel:              getenv("EMBEDDINGS_MODEL", "text-embedding-3-small"),
		RevenueDigestEnabled:         getbool("REVENUE_DIGEST_ENABLED", false),
		RevenueDigestInterval:        getdur("REVENUE_DIGEST_INTERVAL", time.Hour),
		RevenueDigestMinInterval:     getdur("REVENUE_DIGEST_MIN_INTERVAL", 7*24*time.Hour),
		RevenueDigestMaxPerCycle:     getint("REVENUE_DIGEST_MAX_PER_CYCLE", 200),
		ResendAPIKey:                 getenv("RESEND_API_KEY", ""),
		EmailFrom:                    getenv("EMAIL_FROM", "Oppulence <digest@oppulence.io>"),
		RevenueFacadeBaseURL:         getenv("REVENUE_FACADE_BASE_URL", ""),
		RevenueFacadeServiceToken:    getenv("REVENUE_FACADE_SERVICE_TOKEN", ""),
		RevenueFacadeTimeout:         getdur("REVENUE_FACADE_TIMEOUT", 15*time.Second),

		ActionsEnabled:                  getbool("ACTIONS_ENABLED", false),
		ActionTokenTTL:                  getdur("ACTION_TOKEN_TTL", 5*time.Minute),
		ActionWatchTimeout:              getdur("ACTION_WATCH_TIMEOUT", 24*time.Hour),
		ActionRequireStepUpForFinancial: getbool("ACTION_REQUIRE_STEP_UP_FOR_FINANCIAL", true),
		ActionActSeamBaseURL:            getenv("ACTION_ACT_SEAM_BASE_URL", ""),
		ActionActSeamToken:              getenv("ACTION_ACT_SEAM_TOKEN", ""),
		ActionActSeamTimeout:            getdur("ACTION_ACT_SEAM_TIMEOUT", 30*time.Second),
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
	if _, _, err := c.DBEncryptionKeyring(); err != nil {
		return err
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
	if c.UpstreamResponseMaxBytes <= 0 {
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
	if c.CloudRunMaxInflightGlobal < 0 || c.CloudRunMaxInflightPerUser < 0 ||
		c.CloudRunRateLimitGlobalPerMin < 0 || c.CloudRunRateLimitPerUserPerMin < 0 ||
		c.LLMRateLimitPerUserPerMin <= 0 || c.LLMRateLimitPerUserBurst <= 0 {
		return fmt.Errorf("cloud run admission limits must be >= 0")
	}
	if c.TemporalSchedulesEnabled {
		// No TEMPORAL_ENABLED requirement: schedules default ON, but every
		// consumer is gated behind Temporal wiring, so the flag is simply
		// inert in Temporal-less deployments. The RFC 001 loop
		// (CLOUD_SCHEDULER_ENABLED) being the fallback/reconciler host is a
		// DEPLOYMENT-level invariant (per-pod env), enforced operationally.
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
		// Calendar and Drive channels are registered with PUBLIC_BASE_URL as the
		// push address and GOOGLE_WEBHOOK_TOKEN as the channel token; without
		// them the registrations would either point nowhere or be unverifiable.
		if strings.TrimSpace(c.PublicBaseURL) == "" {
			return fmt.Errorf("PUBLIC_BASE_URL is required when GOOGLE_WATCH_ENABLED=true")
		}
		if strings.TrimSpace(c.GoogleWebhookToken) == "" {
			return fmt.Errorf("GOOGLE_WEBHOOK_TOKEN is required when GOOGLE_WATCH_ENABLED=true")
		}
		if c.IsProduction() && strings.TrimSpace(c.GmailPubSubTopic) != "" {
			if strings.TrimSpace(c.GoogleWebhookOIDCAudience) == "" || strings.TrimSpace(c.GoogleWebhookOIDCEmail) == "" {
				return fmt.Errorf("GOOGLE_WEBHOOK_OIDC_AUDIENCE and GOOGLE_WEBHOOK_OIDC_SERVICE_ACCOUNT are required for Gmail Pub/Sub pushes in production")
			}
			if err := validateProductionHTTPSURL("GOOGLE_WEBHOOK_OIDC_AUDIENCE", c.GoogleWebhookOIDCAudience); err != nil {
				return err
			}
			if !strings.Contains(c.GoogleWebhookOIDCEmail, "@") {
				return fmt.Errorf("GOOGLE_WEBHOOK_OIDC_SERVICE_ACCOUNT must be a service-account email")
			}
		}
		if c.GoogleWatchInterval <= 0 || c.GoogleWatchRenewMargin <= 0 {
			return fmt.Errorf("GOOGLE_WATCH_INTERVAL and GOOGLE_WATCH_RENEW_MARGIN must be > 0")
		}
	}
	// The runtime's own deadline must fire BEFORE Temporal's execute activity
	// StartToCloseTimeout (30m, backgroundtaskworkflow activity options), or
	// runs would fail as activity_timeout and hide the real
	// runtime_deadline_exceeded cause. Raising this ceiling requires raising
	// the activity timeout in the same change (RFC 004 duration coupling).
	if c.CloudRuntimeMaxDuration <= 0 || c.CloudRuntimeMaxDuration >= 30*time.Minute {
		return fmt.Errorf("CLOUD_RUNTIME_MAX_DURATION must be in (0, 30m); got %s", c.CloudRuntimeMaxDuration)
	}
	if c.CloudRuntimeMaxLLMCalls <= 0 || c.CloudRuntimeMaxToolCalls <= 0 {
		return fmt.Errorf("CLOUD_RUNTIME_MAX_LLM_CALLS and CLOUD_RUNTIME_MAX_TOOL_CALLS must be > 0")
	}
	if c.CloudRuntimeMaxArtifactBytes <= 0 || c.CloudRuntimeMaxEventBytes <= 0 {
		return fmt.Errorf("cloud runtime byte limits must be > 0")
	}
	if c.CloudRuntimeSandboxEnabled {
		backend := strings.TrimSpace(c.CloudRuntimeSandboxBackend)
		switch backend {
		case "kubernetes-job", "argo-workflow":
		default:
			return fmt.Errorf("CLOUD_RUNTIME_SANDBOX_BACKEND must be kubernetes-job or argo-workflow")
		}
		if strings.TrimSpace(c.CloudRuntimeSandboxImage) == "" {
			return fmt.Errorf("CLOUD_RUNTIME_SANDBOX_IMAGE is required when CLOUD_RUNTIME_SANDBOX_ENABLED=true")
		}
		if backend == "argo-workflow" && strings.TrimSpace(c.CloudRuntimeSandboxServiceAccount) == "" {
			return fmt.Errorf("CLOUD_RUNTIME_SANDBOX_SERVICE_ACCOUNT is required when CLOUD_RUNTIME_SANDBOX_BACKEND=argo-workflow")
		}
		if len(c.CloudRuntimeSandboxAllowedImages) == 0 {
			return fmt.Errorf("CLOUD_RUNTIME_SANDBOX_ALLOWED_IMAGES is required when CLOUD_RUNTIME_SANDBOX_ENABLED=true")
		}
		if !imageAllowedByList(c.CloudRuntimeSandboxImage, c.CloudRuntimeSandboxAllowedImages) {
			return fmt.Errorf("CLOUD_RUNTIME_SANDBOX_IMAGE must match CLOUD_RUNTIME_SANDBOX_ALLOWED_IMAGES")
		}
		if c.CloudRuntimeSandboxMaxDuration <= 0 || c.CloudRuntimeSandboxMaxDuration > c.CloudRuntimeMaxDuration {
			return fmt.Errorf("CLOUD_RUNTIME_SANDBOX_MAX_DURATION must be in (0, CLOUD_RUNTIME_MAX_DURATION]; got %s", c.CloudRuntimeSandboxMaxDuration)
		}
		if c.CloudRuntimeSandboxPollInterval <= 0 {
			return fmt.Errorf("CLOUD_RUNTIME_SANDBOX_POLL_INTERVAL must be > 0")
		}
		if c.CloudRuntimeSandboxMaxScriptBytes <= 0 || c.CloudRuntimeSandboxMaxOutputBytes <= 0 {
			return fmt.Errorf("sandbox script/output byte limits must be > 0")
		}
		if c.CloudRuntimeSandboxTTLSeconds <= 0 {
			return fmt.Errorf("CLOUD_RUNTIME_SANDBOX_TTL_SECONDS must be > 0")
		}
	}
	if c.CloudEventsMatchThreshold <= 0 || c.CloudEventsMatchThreshold > 1 {
		return fmt.Errorf("CLOUD_EVENTS_MATCH_THRESHOLD must be in (0, 1]; got %v", c.CloudEventsMatchThreshold)
	}
	if c.CloudEventsMaxPayloadBytes <= 0 {
		return fmt.Errorf("CLOUD_EVENTS_MAX_PAYLOAD_BYTES must be > 0")
	}
	if c.TemporalEnabled {
		// The durable agent runtime (RFC 027) is active wherever Temporal is — it
		// has no master flag. Its budgets are validated here so a Temporal-enabled
		// deployment fails fast on a bad agent config.
		//
		// The per-turn wall clock must fire before the per-call activity's 5m
		// StartToCloseTimeout, or a turn that hangs surfaces as activity_timeout
		// and hides the real per-turn budget breach (the RFC 004 duration
		// coupling, re-applied per turn).
		if c.AgentMaxWallclockPerTurn <= 0 || c.AgentMaxWallclockPerTurn >= 5*time.Minute {
			return fmt.Errorf("AGENT_MAX_WALLCLOCK_PER_TURN must be in (0, 5m); got %s", c.AgentMaxWallclockPerTurn)
		}
		if c.AgentMaxLLMCallsPerTurn <= 0 || c.AgentMaxToolCallsPerTurn <= 0 {
			return fmt.Errorf("AGENT_MAX_LLM_CALLS_PER_TURN and AGENT_MAX_TOOL_CALLS_PER_TURN must be > 0")
		}
		if c.AgentMaxTurnsPerSession <= 0 || c.AgentMaxLLMCallsPerSession <= 0 {
			return fmt.Errorf("AGENT_MAX_TURNS_PER_SESSION and AGENT_MAX_LLM_CALLS_PER_SESSION must be > 0")
		}
		if c.AgentMaxCostUnitsPerSession <= 0 {
			return fmt.Errorf("AGENT_MAX_COST_UNITS_PER_SESSION must be > 0")
		}
		if c.AgentContinueAsNewEveryTurns <= 0 {
			return fmt.Errorf("AGENT_CONTINUE_AS_NEW_EVERY_TURNS must be > 0")
		}
		if c.AgentSessionIdleTimeout <= 0 {
			return fmt.Errorf("AGENT_SESSION_IDLE_TIMEOUT must be > 0")
		}
		if c.AgentSubagentsEnabled && (c.AgentMaxSubagentDepth <= 0 || c.AgentMaxSubagentFanout <= 0) {
			return fmt.Errorf("AGENT_MAX_SUBAGENT_DEPTH and AGENT_MAX_SUBAGENT_FANOUT must be > 0 when AGENT_SUBAGENTS_ENABLED=true")
		}
		if c.AgentApprovalTokenTTL <= 0 {
			return fmt.Errorf("AGENT_APPROVAL_TOKEN_TTL must be > 0")
		}
		// HITL money-moving tokens are HMAC-signed; a real secret is mandatory in
		// production (no signing on the dev fallback key).
		if c.AgentHITLEnabled && c.IsProduction() &&
			strings.TrimSpace(c.AgentRuntimeSigningSecret) == "" && strings.TrimSpace(c.InternalAPISecret) == "" {
			return fmt.Errorf("AGENT_RUNTIME_SIGNING_SECRET is required when AGENT_HITL_ENABLED=true in production")
		}
	}
	if c.IsProduction() {
		return c.validateProduction()
	}
	return nil
}

func imageAllowedByList(image string, allowed []string) bool {
	image = strings.TrimSpace(image)
	if image == "" {
		return false
	}
	for _, entry := range allowed {
		entry = strings.TrimSpace(entry)
		if entry == image {
			return true
		}
		if strings.HasSuffix(entry, "*") && strings.HasPrefix(image, strings.TrimSuffix(entry, "*")) {
			return true
		}
	}
	return false
}

func (c Config) validateProduction() error {
	required := map[string]string{
		"DATABASE_URL":        c.DatabaseURL,
		"REDIS_URL":           c.RedisURL,
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
	primaryKeyID, keyring, err := c.DBEncryptionKeyring()
	if err != nil {
		return err
	}
	for keyID, passphrase := range keyring {
		if strings.Contains(passphrase, "dev-insecure") || len(passphrase) < 32 {
			return fmt.Errorf("database encryption key %q must be a non-dev secret of at least 32 bytes in production", keyID)
		}
	}
	if strings.TrimSpace(keyring[primaryKeyID]) == "" {
		// DBEncryptionKeyring already verifies membership. Keep this explicit
		// production guard next to the strength checks so future parsing changes
		// cannot accidentally permit a write key with no key material.
		return fmt.Errorf("DB_ENCRYPTION_PRIMARY_KEY_ID %q has no key material in production", primaryKeyID)
	}
	for key, value := range map[string]string{
		"HOOK_HMAC_SECRET":    c.HookHMACSecret,
		"INTERNAL_API_SECRET": c.InternalAPISecret,
	} {
		if len(value) < 32 {
			return fmt.Errorf("%s must be at least 32 bytes in production", key)
		}
	}
	if c.AgentRuntimeSigningSecret != "" && len(c.AgentRuntimeSigningSecret) < 32 {
		return fmt.Errorf("AGENT_RUNTIME_SIGNING_SECRET must be at least 32 bytes in production")
	}
	if !c.AgentRequireMFAForMoneyMoving {
		return fmt.Errorf("AGENT_REQUIRE_MFA_FOR_MONEY_MOVING must be true in production")
	}
	if c.GoogleWatchEnabled {
		if len(c.GoogleWebhookToken) < 32 {
			return fmt.Errorf("GOOGLE_WEBHOOK_TOKEN must be at least 32 bytes in production")
		}
		if strings.TrimSpace(c.GmailPubSubTopic) != "" {
			if strings.TrimSpace(c.GoogleWebhookOIDCAudience) == "" || strings.TrimSpace(c.GoogleWebhookOIDCEmail) == "" {
				return fmt.Errorf("GOOGLE_WEBHOOK_OIDC_AUDIENCE and GOOGLE_WEBHOOK_OIDC_SERVICE_ACCOUNT are required for Gmail Pub/Sub pushes in production")
			}
			if err := validateProductionHTTPSURL("GOOGLE_WEBHOOK_OIDC_AUDIENCE", c.GoogleWebhookOIDCAudience); err != nil {
				return err
			}
			if !strings.Contains(c.GoogleWebhookOIDCEmail, "@") {
				return fmt.Errorf("GOOGLE_WEBHOOK_OIDC_SERVICE_ACCOUNT must be a service-account email")
			}
		}
	}
	if c.CloudRuntimeSandboxEnabled {
		if !digestPinnedImage(c.CloudRuntimeSandboxImage) {
			return fmt.Errorf("CLOUD_RUNTIME_SANDBOX_IMAGE must be pinned by sha256 digest in production")
		}
		for _, image := range c.CloudRuntimeSandboxAllowedImages {
			if !digestPinnedImage(image) {
				return fmt.Errorf("CLOUD_RUNTIME_SANDBOX_ALLOWED_IMAGES entries must be exact sha256-digest-pinned images in production")
			}
		}
	}
	for key, value := range map[string]string{
		"APP_URL":             c.AppURL,
		"PUBLIC_BASE_URL":     c.PublicBaseURL,
		"TOKEN_ISSUER":        c.TokenIssuer,
		"GOOGLE_REDIRECT_URI": c.GoogleRedirectURI,
	} {
		if err := validateProductionHTTPSURL(key, value); err != nil {
			return err
		}
	}
	if c.AutoMigrate {
		return fmt.Errorf("AUTO_MIGRATE must be false in production")
	}
	if len(c.CORSOrigins) == 0 {
		return fmt.Errorf("CORS_ALLOWED_ORIGINS is required in production")
	}
	for _, origin := range c.CORSOrigins {
		u, err := url.Parse(origin)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil ||
			u.Path != "" || u.RawQuery != "" || u.Fragment != "" || origin == "null" {
			return fmt.Errorf("CORS_ALLOWED_ORIGINS contains invalid production origin %q", origin)
		}
		switch u.Hostname() {
		case "localhost", "127.0.0.1", "::1":
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
		"GOOGLE_OAUTH_CLIENT_ID":     c.GoogleOAuthClientID,
		"GOOGLE_OAUTH_CLIENT_SECRET": c.GoogleOAuthClientSecret,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s is required when INFISICAL_ENABLED=false", key)
		}
	}
	return nil
}

func validateProductionHTTPSURL(key, value string) error {
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return fmt.Errorf("%s must be an absolute HTTPS URL without userinfo or fragment in production", key)
	}
	return nil
}

func digestPinnedImage(image string) bool {
	name, digest, ok := strings.Cut(strings.TrimSpace(image), "@sha256:")
	if !ok || strings.TrimSpace(name) == "" || len(digest) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(digest)
	return err == nil
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
