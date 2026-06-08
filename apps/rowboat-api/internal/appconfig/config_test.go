package appconfig

import (
	"testing"
	"time"
)

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
				c.CloudSchedulerLeaseTTL = 90 * time.Second
				c.CloudSchedulerTimezone = "UTC"
			},
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
				c.CloudSchedulerLeaseTTL = 90 * time.Second
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
				c.CloudSchedulerLeaseTTL = 90 * time.Second
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
		c.CloudSchedulerLeaseTTL = 90 * time.Second
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
	if c.CloudSchedulerLeaseTTL != 90*time.Second {
		t.Fatalf("default lease ttl = %v, want 90s", c.CloudSchedulerLeaseTTL)
	}
	if c.CloudSchedulerTimezone != "UTC" {
		t.Fatalf("default timezone = %q, want UTC", c.CloudSchedulerTimezone)
	}
	if c.CloudSchedulerOwner == "" {
		t.Fatalf("default owner should be the hostname, got empty")
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

func TestDefaultHostname(t *testing.T) {
	if defaultHostname() == "" {
		t.Fatalf("defaultHostname should never be empty")
	}
}
