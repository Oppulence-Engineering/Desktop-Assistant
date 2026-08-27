package appconfig

import (
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func validProductionSecurityConfig() Config {
	return Config{
		Environment:                   "production",
		AppURL:                        "https://app.example.com",
		PublicBaseURL:                 "https://api.example.com",
		GoogleRedirectURI:             "https://api.example.com/oauth/google/callback",
		DatabaseURL:                   "postgres://db.example.com/rowboat",
		RedisURL:                      "redis://redis.example.com:6379",
		DBEncryptionKey:               strings.Repeat("e", 32),
		DBEncryptionPrimaryKeyID:      legacyDBEncryptionKeyID,
		TokenIssuer:                   "https://auth.example.com",
		WorkOSAPIKey:                  "sk_test",
		WorkOSClientID:                "client_test",
		HookHMACSecret:                strings.Repeat("h", 32),
		InternalAPISecret:             strings.Repeat("i", 32),
		CORSOrigins:                   []string{"https://app.example.com"},
		DailyCreditLimit:              100,
		MonthlyCreditLimit:            1000,
		OpenAIAPIKey:                  "openai",
		ElevenLabsAPIKey:              "eleven",
		ExaAPIKey:                     "exa",
		GoogleOAuthClientID:           "google-client",
		GoogleOAuthClientSecret:       "google-secret",
		AgentRequireMFAForMoneyMoving: true,
	}
}

func TestLoadDBEncryptionKeyringSeedsLegacyKey(t *testing.T) {
	legacyKey := strings.Repeat("l", 32)
	t.Setenv("DB_ENCRYPTION_KEY", legacyKey)
	t.Setenv("DB_ENCRYPTION_KEYRING_JSON", "")
	previousPrimary, hadPrimary := os.LookupEnv("DB_ENCRYPTION_PRIMARY_KEY_ID")
	if err := os.Unsetenv("DB_ENCRYPTION_PRIMARY_KEY_ID"); err != nil {
		t.Fatalf("unset DB_ENCRYPTION_PRIMARY_KEY_ID: %v", err)
	}
	t.Cleanup(func() {
		if hadPrimary {
			_ = os.Setenv("DB_ENCRYPTION_PRIMARY_KEY_ID", previousPrimary)
		} else {
			_ = os.Unsetenv("DB_ENCRYPTION_PRIMARY_KEY_ID")
		}
	})

	cfg := Load()
	primaryKeyID, keyring, err := cfg.DBEncryptionKeyring()
	if err != nil {
		t.Fatalf("resolve legacy keyring: %v", err)
	}
	if primaryKeyID != legacyDBEncryptionKeyID {
		t.Fatalf("primary key ID = %q, want %q", primaryKeyID, legacyDBEncryptionKeyID)
	}
	if len(keyring) != 1 || keyring[legacyDBEncryptionKeyID] != legacyKey {
		t.Fatalf("legacy keyring = %#v, want one stable legacy entry", keyring)
	}
}

func TestLoadConnectorOAuthLegacyStateWriteDefaultsSecureAndRequiresOptIn(t *testing.T) {
	t.Setenv("CONNECTOR_OAUTH_LEGACY_STATE_WRITE", "")
	if Load().ConnectorOAuthLegacyStateWrite {
		t.Fatal("legacy OAuth state write must default off")
	}
	t.Setenv("CONNECTOR_OAUTH_LEGACY_STATE_WRITE", "true")
	if !Load().ConnectorOAuthLegacyStateWrite {
		t.Fatal("legacy OAuth state write opt-in was not loaded")
	}
}

func TestDBEncryptionKeyringParsesExplicitRotationRing(t *testing.T) {
	cfg := Config{
		DBEncryptionPrimaryKeyID:   "2026-08",
		DBEncryptionKeyringJSON:    `{"legacy-db-encryption-key":"old-secret","2026-08":"new-secret"}`,
		DBEncryptionRetiringKeyIDs: []string{"legacy-db-encryption-key"},
	}

	primaryKeyID, keyring, err := cfg.DBEncryptionKeyring()
	if err != nil {
		t.Fatalf("resolve explicit keyring: %v", err)
	}
	if primaryKeyID != "2026-08" || keyring[legacyDBEncryptionKeyID] != "old-secret" || keyring["2026-08"] != "new-secret" {
		t.Fatalf("resolved primary/keyring = %q/%#v", primaryKeyID, keyring)
	}
}

func TestDBEncryptionKeyringRejectsUnsafeRetirementDeclaration(t *testing.T) {
	base := Config{
		DBEncryptionPrimaryKeyID: "new",
		DBEncryptionKeyringJSON:  `{"old":"old-secret","new":"new-secret"}`,
	}
	for _, tc := range []struct {
		name string
		ids  []string
		want string
	}{
		{name: "active primary", ids: []string{"new"}, want: "active primary"},
		{name: "already removed", ids: []string{"missing"}, want: "must remain"},
		{name: "duplicate", ids: []string{"old", "old"}, want: "duplicate"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := base
			cfg.DBEncryptionRetiringKeyIDs = tc.ids
			if _, _, err := cfg.DBEncryptionKeyring(); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("DBEncryptionKeyring error = %v, want containing %q", err, tc.want)
			}
		})
	}
}

func TestDBEncryptionKeyringRejectsInvalidOrUnboundedConfiguration(t *testing.T) {
	tooManyEntries := make([]string, 0, maxDBEncryptionKeyringEntries+1)
	for i := 0; i <= maxDBEncryptionKeyringEntries; i++ {
		tooManyEntries = append(tooManyEntries, `"key-`+strconv.Itoa(i)+`":"`+strings.Repeat("k", 32)+`"`)
	}

	for _, tc := range []struct {
		name string
		cfg  Config
		want string
	}{
		{
			name: "missing primary",
			cfg: Config{
				DBEncryptionKeyringJSON: `{"current":"secret"}`,
			},
			want: "must not be empty",
		},
		{
			name: "primary absent from ring",
			cfg: Config{
				DBEncryptionPrimaryKeyID: "current",
				DBEncryptionKeyringJSON:  `{"old":"secret"}`,
			},
			want: "is not present",
		},
		{
			name: "duplicate key id",
			cfg: Config{
				DBEncryptionPrimaryKeyID: "current",
				DBEncryptionKeyringJSON:  `{"current":"first","current":"second"}`,
			},
			want: "duplicate key ID",
		},
		{
			name: "non object",
			cfg: Config{
				DBEncryptionPrimaryKeyID: "current",
				DBEncryptionKeyringJSON:  `["secret"]`,
			},
			want: "must be a JSON object",
		},
		{
			name: "too many entries",
			cfg: Config{
				DBEncryptionPrimaryKeyID: "key-0",
				DBEncryptionKeyringJSON:  `{` + strings.Join(tooManyEntries, ",") + `}`,
			},
			want: "more than 32 keys",
		},
		{
			name: "oversized document",
			cfg: Config{
				DBEncryptionPrimaryKeyID: legacyDBEncryptionKeyID,
				DBEncryptionKeyringJSON:  strings.Repeat(" ", maxDBEncryptionKeyringBytes+1),
			},
			want: "exceeds 65536 bytes",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := tc.cfg.DBEncryptionKeyring(); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("DBEncryptionKeyring error = %v, want containing %q", err, tc.want)
			}
		})
	}
}

func TestValidateProductionAcceptsExplicitKeyringWithoutLegacyEnv(t *testing.T) {
	cfg := validProductionSecurityConfig()
	cfg.DBEncryptionKey = ""
	cfg.DBEncryptionPrimaryKeyID = "2026-08"
	cfg.DBEncryptionKeyringJSON = `{"legacy-db-encryption-key":"` + strings.Repeat("o", 32) + `","2026-08":"` + strings.Repeat("n", 32) + `"}`
	if err := cfg.validateProduction(); err != nil {
		t.Fatalf("valid explicit production keyring rejected: %v", err)
	}
}

func TestValidateProductionRejectsMissingOrWeakPrimaryKey(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*Config)
		want   string
	}{
		{
			name: "missing primary id",
			mutate: func(c *Config) {
				c.DBEncryptionPrimaryKeyID = ""
				c.DBEncryptionKeyringJSON = `{"current":"` + strings.Repeat("k", 32) + `"}`
			},
			want: "DB_ENCRYPTION_PRIMARY_KEY_ID must not be empty",
		},
		{
			name: "primary absent",
			mutate: func(c *Config) {
				c.DBEncryptionPrimaryKeyID = "current"
				c.DBEncryptionKeyringJSON = `{"old":"` + strings.Repeat("k", 32) + `"}`
			},
			want: "is not present",
		},
		{
			name: "weak primary material",
			mutate: func(c *Config) {
				c.DBEncryptionKey = ""
				c.DBEncryptionPrimaryKeyID = "current"
				c.DBEncryptionKeyringJSON = `{"current":"short"}`
			},
			want: "non-dev secret of at least 32 bytes",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := validProductionSecurityConfig()
			tc.mutate(&cfg)
			if err := cfg.validateProduction(); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("validateProduction error = %v, want containing %q", err, tc.want)
			}
		})
	}
}

func TestValidateProductionRejectsUnsafeSecurityConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*Config)
		want   string
	}{
		{name: "null CORS origin", mutate: func(c *Config) { c.CORSOrigins = []string{"null"} }, want: "invalid production origin"},
		{name: "HTTP CORS origin", mutate: func(c *Config) { c.CORSOrigins = []string{"http://app.example.com"} }, want: "invalid production origin"},
		{name: "CORS origin with path", mutate: func(c *Config) { c.CORSOrigins = []string{"https://app.example.com/path"} }, want: "invalid production origin"},
		{name: "CORS origin with userinfo", mutate: func(c *Config) { c.CORSOrigins = []string{"https://user@app.example.com"} }, want: "invalid production origin"},
		{name: "weak internal secret", mutate: func(c *Config) { c.InternalAPISecret = "short" }, want: "at least 32 bytes"},
		{name: "weak hook secret", mutate: func(c *Config) { c.HookHMACSecret = "short" }, want: "at least 32 bytes"},
		{name: "insecure public URL", mutate: func(c *Config) { c.PublicBaseURL = "http://api.example.com" }, want: "absolute HTTPS URL"},
		{name: "MFA disabled", mutate: func(c *Config) { c.AgentRequireMFAForMoneyMoving = false }, want: "must be true"},
		{name: "local entitlement override", mutate: func(c *Config) { c.ConnectorAllowLocalEntitlementDevelopment = true }, want: "must be false"},
		{name: "weak Google webhook token", mutate: func(c *Config) {
			c.GoogleWatchEnabled = true
			c.GoogleWebhookToken = "short"
		}, want: "GOOGLE_WEBHOOK_TOKEN must be at least 32 bytes"},
		{name: "Gmail push without OIDC identity", mutate: func(c *Config) {
			c.GoogleWatchEnabled = true
			c.GoogleWebhookToken = strings.Repeat("g", 32)
			c.GmailPubSubTopic = "projects/example/topics/gmail"
		}, want: "GOOGLE_WEBHOOK_OIDC_AUDIENCE"},
		{name: "mutable sandbox image", mutate: func(c *Config) {
			c.CloudRuntimeSandboxEnabled = true
			c.CloudRuntimeSandboxImage = "python:3.12-slim"
			c.CloudRuntimeSandboxAllowedImages = []string{"python:3.12-slim"}
		}, want: "pinned by sha256 digest"},
		{name: "wildcard sandbox allowlist", mutate: func(c *Config) {
			digest := strings.Repeat("a", 64)
			c.CloudRuntimeSandboxEnabled = true
			c.CloudRuntimeSandboxImage = "python@sha256:" + digest
			c.CloudRuntimeSandboxAllowedImages = []string{"python:*"}
		}, want: "exact sha256-digest-pinned"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := validProductionSecurityConfig()
			tc.mutate(&c)
			if err := c.validateProduction(); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("validateProduction error = %v, want containing %q", err, tc.want)
			}
		})
	}
	if err := validProductionSecurityConfig().validateProduction(); err != nil {
		t.Fatalf("valid production security config rejected: %v", err)
	}
}

// baseConfig returns a config with development defaults that passes Validate,
// so each test can toggle only the scheduler fields under test.
func baseConfig() Config {
	c := Load() // ENVIRONMENT defaults to development → production checks skipped
	c.CloudSchedulerEnabled = false
	return c
}

func TestValidateCloudScheduler(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(*Config)
		wantErr bool
	}{
		{
			name:   "disabled needs nothing",
			mutate: func(c *Config) { c.CloudSchedulerEnabled = false; c.TemporalEnabled = false },
		},
		{
			name:    "enabled requires temporal",
			mutate:  func(c *Config) { c.CloudSchedulerEnabled = true; c.TemporalEnabled = false },
			wantErr: true,
		},
		{
			name: "enabled with temporal and sane defaults",
			mutate: func(c *Config) {
				c.CloudSchedulerEnabled = true
				c.TemporalEnabled = true
				c.CloudSchedulerInterval = 15 * time.Second
				c.CloudSchedulerLeaseTTL = 150 * time.Second
				c.CloudSchedulerTimezone = "UTC"
			},
		},
		{
			// 90s exceeds the interval but not the 2m cron grace window — a
			// crashed owner's occurrence would still be due when the lease
			// expires, so a peer could steal it and double-fire.
			name: "lease ttl must exceed cron grace",
			mutate: func(c *Config) {
				c.CloudSchedulerEnabled = true
				c.TemporalEnabled = true
				c.CloudSchedulerInterval = 15 * time.Second
				c.CloudSchedulerLeaseTTL = 90 * time.Second
				c.CloudSchedulerTimezone = "UTC"
			},
			wantErr: true,
		},
		{
			name: "lease ttl must exceed interval",
			mutate: func(c *Config) {
				c.CloudSchedulerEnabled = true
				c.TemporalEnabled = true
				c.CloudSchedulerInterval = 15 * time.Second
				c.CloudSchedulerLeaseTTL = 10 * time.Second
			},
			wantErr: true,
		},
		{
			name: "garbage timezone rejected",
			mutate: func(c *Config) {
				c.CloudSchedulerEnabled = true
				c.TemporalEnabled = true
				c.CloudSchedulerInterval = 15 * time.Second
				c.CloudSchedulerLeaseTTL = 150 * time.Second
				c.CloudSchedulerTimezone = "Not/AZone"
			},
			wantErr: true,
		},
		{
			name: "non-UTC timezone rejected in v1",
			mutate: func(c *Config) {
				c.CloudSchedulerEnabled = true
				c.TemporalEnabled = true
				c.CloudSchedulerInterval = 15 * time.Second
				c.CloudSchedulerLeaseTTL = 150 * time.Second
				c.CloudSchedulerTimezone = "America/New_York"
			},
			wantErr: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := baseConfig()
			tc.mutate(&c)
			err := c.Validate()
			if tc.wantErr && err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

// TestValidateDisabledSchedulerIgnoresTemporal: with the scheduler off, the
// scheduler invariants do not apply even if Temporal is off.
func TestValidateDisabledSchedulerIgnoresTemporal(t *testing.T) {
	c := baseConfig()
	c.CloudSchedulerEnabled = false
	c.TemporalEnabled = false
	c.CloudSchedulerLeaseTTL = time.Second // would be invalid if checked
	c.CloudSchedulerInterval = time.Hour
	if err := c.Validate(); err != nil {
		t.Fatalf("disabled scheduler should not trigger scheduler validation: %v", err)
	}
}

func TestSchedulerLocationDefaultsToUTC(t *testing.T) {
	c := baseConfig()
	c.CloudSchedulerTimezone = ""
	loc, err := c.SchedulerLocation()
	if err != nil || loc != time.UTC {
		t.Fatalf("empty timezone: got %v / %v, want UTC/nil", loc, err)
	}
}

// TestSchedulerLocationConsistentWithValidate: every timezone string Validate
// accepts must also load in SchedulerLocation, so a validated config never
// crash-loops the scheduler at boot (case/whitespace variants of UTC).
func TestSchedulerLocationConsistentWithValidate(t *testing.T) {
	for _, tz := range []string{"UTC", "utc", "Utc", "UTC ", " utc ", "", "  "} {
		c := baseConfig()
		c.CloudSchedulerEnabled = true
		c.TemporalEnabled = true
		c.CloudSchedulerInterval = 15 * time.Second
		c.CloudSchedulerLeaseTTL = 150 * time.Second
		c.CloudSchedulerTimezone = tz
		if err := c.Validate(); err != nil {
			t.Fatalf("tz %q should pass Validate: %v", tz, err)
		}
		loc, err := c.SchedulerLocation()
		if err != nil || loc != time.UTC {
			t.Fatalf("tz %q SchedulerLocation = %v / %v, want UTC/nil", tz, loc, err)
		}
	}
}

// TestLoadCloudSchedulerDefaults checks the documented defaults when nothing is
// set in the environment.
func TestLoadCloudSchedulerDefaults(t *testing.T) {
	for _, k := range []string{"CLOUD_SCHEDULER_ENABLED", "CLOUD_SCHEDULER_INTERVAL", "CLOUD_SCHEDULER_LEASE_TTL", "CLOUD_SCHEDULER_TIMEZONE", "CLOUD_SCHEDULER_OWNER"} {
		t.Setenv(k, "")
	}
	c := Load()
	if c.CloudSchedulerEnabled {
		t.Fatalf("default enabled should be false")
	}
	if c.CloudSchedulerInterval != 15*time.Second {
		t.Fatalf("default interval = %v, want 15s", c.CloudSchedulerInterval)
	}
	if c.CloudSchedulerLeaseTTL != 150*time.Second {
		t.Fatalf("default lease ttl = %v, want 150s (must exceed the 2m cron grace)", c.CloudSchedulerLeaseTTL)
	}
	if c.CloudSchedulerTimezone != "UTC" {
		t.Fatalf("default timezone = %q, want UTC", c.CloudSchedulerTimezone)
	}
	if c.CloudSchedulerOwner == "" {
		t.Fatalf("default owner should be the hostname, got empty")
	}
}

func TestLoadProviderWebhookSecrets(t *testing.T) {
	t.Setenv("SLACK_SIGNING_SECRET", "slack-secret")
	t.Setenv("GOOGLE_WEBHOOK_TOKEN", "google-token")
	t.Setenv("GOOGLE_WEBHOOK_OIDC_AUDIENCE", "https://api.example.com/v1/webhooks/google")
	t.Setenv("GOOGLE_WEBHOOK_OIDC_SERVICE_ACCOUNT", "pubsub@example.iam.gserviceaccount.com")
	t.Setenv("WEBHOOK_SIGNING_SECRET", "webhook-secret")

	c := Load()
	if c.SlackSigningSecret != "slack-secret" {
		t.Fatalf("SlackSigningSecret = %q", c.SlackSigningSecret)
	}
	if c.GoogleWebhookToken != "google-token" {
		t.Fatalf("GoogleWebhookToken = %q", c.GoogleWebhookToken)
	}
	if c.GoogleWebhookOIDCAudience != "https://api.example.com/v1/webhooks/google" || c.GoogleWebhookOIDCEmail != "pubsub@example.iam.gserviceaccount.com" {
		t.Fatalf("Google webhook OIDC config = %q / %q", c.GoogleWebhookOIDCAudience, c.GoogleWebhookOIDCEmail)
	}
	if c.WebhookSigningSecret != "webhook-secret" {
		t.Fatalf("WebhookSigningSecret = %q", c.WebhookSigningSecret)
	}
}

// TestLoadCloudSchedulerOverrides checks env overrides flow through Load.
func TestLoadCloudSchedulerOverrides(t *testing.T) {
	t.Setenv("CLOUD_SCHEDULER_ENABLED", "true")
	t.Setenv("CLOUD_SCHEDULER_INTERVAL", "30s")
	t.Setenv("CLOUD_SCHEDULER_LEASE_TTL", "2m")
	t.Setenv("CLOUD_SCHEDULER_TIMEZONE", "America/New_York")
	t.Setenv("CLOUD_SCHEDULER_OWNER", "scheduler-pod-7")
	c := Load()
	if !c.CloudSchedulerEnabled {
		t.Fatalf("enabled override not applied")
	}
	if c.CloudSchedulerInterval != 30*time.Second {
		t.Fatalf("interval = %v, want 30s", c.CloudSchedulerInterval)
	}
	if c.CloudSchedulerLeaseTTL != 2*time.Minute {
		t.Fatalf("lease ttl = %v, want 2m", c.CloudSchedulerLeaseTTL)
	}
	if c.CloudSchedulerOwner != "scheduler-pod-7" {
		t.Fatalf("owner = %q", c.CloudSchedulerOwner)
	}
	loc, err := c.SchedulerLocation()
	if err != nil || loc.String() != "America/New_York" {
		t.Fatalf("SchedulerLocation = %v / %v, want America/New_York", loc, err)
	}
}

func TestValidateTemporalSchedules(t *testing.T) {
	enable := func(c *Config) {
		c.TemporalSchedulesEnabled = true
		c.TemporalEnabled = true
		c.CloudSchedulerEnabled = true
		c.CloudSchedulerInterval = 15 * time.Second
		c.CloudSchedulerLeaseTTL = 150 * time.Second
		c.CloudSchedulerTimezone = "UTC"
	}
	cases := []struct {
		name    string
		mutate  func(*Config)
		wantErr bool
	}{
		{
			name:   "disabled needs nothing",
			mutate: func(c *Config) { c.TemporalSchedulesEnabled = false },
		},
		{
			name:   "enabled with temporal and loop",
			mutate: enable,
		},
		{
			// Default-on flag must be inert (not fatal) without Temporal:
			// requiring TEMPORAL_ENABLED here would crash-loop every
			// Temporal-less deployment under the new default.
			name:   "enabled without temporal boots (inert)",
			mutate: func(c *Config) { enable(c); c.TemporalEnabled = false; c.CloudSchedulerEnabled = false },
		},
		{
			// CLOUD_SCHEDULER_ENABLED is a per-pod flag (only the scheduler
			// Deployment sets it), while TEMPORAL_SCHEDULES_ENABLED lives in
			// the shared configmap for the server's syncer — so the server and
			// worker must boot WITHOUT the loop flag. The loop-as-fallback
			// requirement is a deployment-level invariant, not Validate's.
			name:   "enabled without loop flag boots (per-pod split)",
			mutate: func(c *Config) { enable(c); c.CloudSchedulerEnabled = false },
		},
		{
			name:    "catchup must be positive",
			mutate:  func(c *Config) { enable(c); c.TemporalScheduleCatchup = 0 },
			wantErr: true,
		},
		{
			name:    "reconcile interval must be positive",
			mutate:  func(c *Config) { enable(c); c.TemporalScheduleReconcileInterval = -time.Second },
			wantErr: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := baseConfig()
			tc.mutate(&c)
			err := c.Validate()
			if tc.wantErr && err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestLoadTemporalScheduleDefaults(t *testing.T) {
	for _, k := range []string{"TEMPORAL_SCHEDULES_ENABLED", "TEMPORAL_SCHEDULE_CATCHUP", "TEMPORAL_SCHEDULE_RECONCILE_INTERVAL"} {
		t.Setenv(k, "")
	}
	c := Load()
	if !c.TemporalSchedulesEnabled {
		t.Fatalf("schedules must default ON (TEMPORAL_SCHEDULES_ENABLED=false is the rollback)")
	}
	if c.TemporalScheduleCatchup != time.Minute {
		t.Fatalf("default catchup = %v, want 1m", c.TemporalScheduleCatchup)
	}
	if c.TemporalScheduleReconcileInterval != 5*time.Minute {
		t.Fatalf("default reconcile interval = %v, want 5m", c.TemporalScheduleReconcileInterval)
	}
}

func TestDefaultHostname(t *testing.T) {
	if defaultHostname() == "" {
		t.Fatalf("defaultHostname should never be empty")
	}
}

// TestCloudRuntimeDefaults locks the RFC 004 runtime knobs: enabled by
// default (user decision overriding the RFC's ship-dark stance), with the
// duration ceiling strictly under the execute activity timeout.
func TestCloudRuntimeDefaults(t *testing.T) {
	for _, k := range []string{"CLOUD_RUNTIME_ENABLED", "CLOUD_RUNTIME_MODEL", "CLOUD_RUNTIME_MAX_DURATION", "CLOUD_RUNTIME_MAX_LLM_CALLS", "CLOUD_RUNTIME_SANDBOX_ENABLED", "CLOUD_RUNTIME_SANDBOX_BACKEND", "CLOUD_RUNTIME_SANDBOX_IMAGE", "CLOUD_RUNTIME_SANDBOX_ALLOWED_IMAGES"} {
		t.Setenv(k, "")
	}
	c := Load()
	if !c.CloudRuntimeEnabled {
		t.Fatal("cloud runtime must default to enabled")
	}
	if c.CloudRuntimeModel == "" || c.CloudRuntimeMaxDuration != 4*time.Minute ||
		c.CloudRuntimeMaxLLMCalls != 12 || c.CloudRuntimeMaxToolCalls != 24 ||
		c.CloudRuntimeMaxArtifactBytes != 1<<20 || c.CloudRuntimeMaxEventBytes != 64<<10 {
		t.Fatalf("unexpected runtime defaults: %+v", c)
	}
	if c.CloudRuntimeSandboxEnabled {
		t.Fatal("sandbox runtime must default to disabled")
	}
	if c.CloudRuntimeSandboxBackend != "kubernetes-job" {
		t.Fatalf("sandbox backend = %q, want kubernetes-job", c.CloudRuntimeSandboxBackend)
	}
	if !imageAllowedByList("mcr.microsoft.com/playwright:v1", c.CloudRuntimeSandboxAllowedImages) {
		t.Fatalf("sandbox defaults must allow browser-capable images: %v", c.CloudRuntimeSandboxAllowedImages)
	}
	if err := c.Validate(); err != nil {
		t.Fatalf("default config must validate: %v", err)
	}
}

// TestCloudRuntimeDurationCoupling rejects a runtime deadline at or above the
// execute activity StartToCloseTimeout (it would mask runtime_deadline_exceeded as
// activity_timeout).
func TestCloudRuntimeDurationCoupling(t *testing.T) {
	c := baseConfig()
	c.CloudRuntimeMaxDuration = 30 * time.Minute
	if err := c.Validate(); err == nil {
		t.Fatal("30m runtime duration must be rejected (execute activity timeout is 30m)")
	}
	c.CloudRuntimeMaxDuration = 29 * time.Minute
	if err := c.Validate(); err != nil {
		t.Fatalf("29m must validate: %v", err)
	}
}

func TestValidateCloudRuntimeSandbox(t *testing.T) {
	c := baseConfig()
	c.CloudRuntimeSandboxEnabled = true
	c.CloudRuntimeMaxDuration = 20 * time.Minute
	c.CloudRuntimeSandboxImage = "python:3.12-slim"
	c.CloudRuntimeSandboxAllowedImages = []string{"python:3.12-slim", "mcr.microsoft.com/playwright:*"}
	c.CloudRuntimeSandboxMaxDuration = 10 * time.Minute
	c.CloudRuntimeSandboxPollInterval = 5 * time.Second
	c.CloudRuntimeSandboxMaxScriptBytes = 32 << 10
	c.CloudRuntimeSandboxMaxOutputBytes = 64 << 10
	c.CloudRuntimeSandboxTTLSeconds = 600
	if err := c.Validate(); err != nil {
		t.Fatalf("valid sandbox config rejected: %v", err)
	}

	c.CloudRuntimeSandboxMaxDuration = 21 * time.Minute
	if err := c.Validate(); err == nil {
		t.Fatal("sandbox max duration above runtime max must be rejected")
	}
}

func TestValidateCloudRuntimeSandboxBackend(t *testing.T) {
	c := baseConfig()
	c.CloudRuntimeSandboxEnabled = true
	c.CloudRuntimeMaxDuration = 20 * time.Minute
	c.CloudRuntimeSandboxBackend = "argo-workflow"
	c.CloudRuntimeSandboxImage = "python:3.12-slim"
	c.CloudRuntimeSandboxAllowedImages = []string{"python:3.12-slim"}
	c.CloudRuntimeSandboxServiceAccount = "rowboat-sandbox"
	c.CloudRuntimeSandboxMaxDuration = 10 * time.Minute
	c.CloudRuntimeSandboxPollInterval = 5 * time.Second
	c.CloudRuntimeSandboxMaxScriptBytes = 32 << 10
	c.CloudRuntimeSandboxMaxOutputBytes = 64 << 10
	c.CloudRuntimeSandboxTTLSeconds = 600
	if err := c.Validate(); err != nil {
		t.Fatalf("argo sandbox config rejected: %v", err)
	}

	c.CloudRuntimeSandboxServiceAccount = ""
	if err := c.Validate(); err == nil {
		t.Fatal("argo sandbox backend must require a service account")
	}
	c.CloudRuntimeSandboxBackend = "not-real"
	if err := c.Validate(); err == nil {
		t.Fatal("unknown sandbox backend must be rejected")
	}
}

// The LLM gateway limits must be generous enough for agentic traffic. The
// desktop turns one user action ("label these 15 emails") into ~16 round trips
// and runs several such actions at once, so the old 60/min ceiling was hit by
// users doing exactly what the product asks of them.
//
// These bound burst and abuse, not spend: credits are reserved per call and
// DAILY_CREDIT_LIMIT / MONTHLY_CREDIT_LIMIT cap cost independently.
func TestLLMRateLimitsFitAgenticTraffic(t *testing.T) {
	t.Setenv("INFISICAL_ENABLED", "false")
	t.Setenv("OPENROUTER_API_KEY", "test")
	cfg := Load()

	// One labeling batch is ~16 calls; three run concurrently. A ceiling below
	// that means a single ordinary run cannot finish without being throttled.
	const oneBatch = 16
	const concurrentBatches = 3
	if cfg.LLMRateLimitPerUserBurst < oneBatch*concurrentBatches {
		t.Errorf("burst limit %d cannot absorb %d concurrent labeling batches (%d calls)",
			cfg.LLMRateLimitPerUserBurst, concurrentBatches, oneBatch*concurrentBatches)
	}
	if cfg.LLMRateLimitPerUserPerMin < cfg.LLMRateLimitPerUserBurst {
		t.Errorf("per-minute limit %d is below the 10s burst allowance %d, so the burst can never be spent",
			cfg.LLMRateLimitPerUserPerMin, cfg.LLMRateLimitPerUserBurst)
	}
}

func TestLLMRateLimitsAreOverridable(t *testing.T) {
	t.Setenv("INFISICAL_ENABLED", "false")
	t.Setenv("OPENROUTER_API_KEY", "test")
	t.Setenv("LLM_RATE_LIMIT_PER_USER_PER_MINUTE", "999")
	t.Setenv("LLM_RATE_LIMIT_PER_USER_BURST_PER_10S", "77")
	cfg := Load()
	if cfg.LLMRateLimitPerUserPerMin != 999 || cfg.LLMRateLimitPerUserBurst != 77 {
		t.Errorf("env overrides ignored: got %d/min, %d burst",
			cfg.LLMRateLimitPerUserPerMin, cfg.LLMRateLimitPerUserBurst)
	}
}
