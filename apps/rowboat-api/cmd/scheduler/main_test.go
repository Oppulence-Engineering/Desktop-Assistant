package main

import (
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"go.uber.org/zap"
)

// TestRunExitsCleanWhenDisabled: the scheduler binary is a no-op exit when
// CLOUD_SCHEDULER_ENABLED is false, mirroring the worker's enable guard, so the
// Deployment can ship dark without touching the database or Temporal.
func TestRunExitsCleanWhenDisabled(t *testing.T) {
	cfg := appconfig.Load()
	cfg.CloudSchedulerEnabled = false
	if err := run(cfg, zap.NewNop()); err != nil {
		t.Fatalf("run with scheduler disabled should return nil, got %v", err)
	}
}

// TestRunRejectsEnabledWithoutTemporal: enabling the scheduler without Temporal
// fails fast at Validate, before any database or Temporal connection attempt.
func TestRunRejectsEnabledWithoutTemporal(t *testing.T) {
	cfg := appconfig.Load()
	cfg.CloudSchedulerEnabled = true
	cfg.TemporalEnabled = false
	if err := run(cfg, zap.NewNop()); err == nil {
		t.Fatalf("run with scheduler enabled but Temporal disabled should error")
	}
}
