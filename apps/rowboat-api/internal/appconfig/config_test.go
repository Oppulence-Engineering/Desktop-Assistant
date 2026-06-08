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
			name: "invalid timezone rejected",
			mutate: func(c *Config) {
				c.CloudSchedulerEnabled = true
				c.TemporalEnabled = true
				c.CloudSchedulerInterval = 15 * time.Second
				c.CloudSchedulerLeaseTTL = 90 * time.Second
				c.CloudSchedulerTimezone = "Not/AZone"
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

func TestSchedulerLocationDefaultsToUTC(t *testing.T) {
	c := baseConfig()
	c.CloudSchedulerTimezone = ""
	loc, err := c.SchedulerLocation()
	if err != nil || loc != time.UTC {
		t.Fatalf("empty timezone: got %v / %v, want UTC/nil", loc, err)
	}
}
