package main

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
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

// TestReadyzReflectsTemporalReadiness: /healthz is always 200, but /readyz is
// 503 until ready flips true — so a scheduler stuck dialing Temporal reports
// NotReady rather than masquerading as healthy.
func TestReadyzReflectsTemporalReadiness(t *testing.T) {
	var ready atomic.Bool
	mux := newHealthMux(&ready)

	get := func(path string) int {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec.Code
	}

	if code := get("/healthz"); code != http.StatusOK {
		t.Fatalf("healthz before ready = %d, want 200", code)
	}
	if code := get("/readyz"); code != http.StatusServiceUnavailable {
		t.Fatalf("readyz before ready = %d, want 503", code)
	}
	ready.Store(true)
	if code := get("/readyz"); code != http.StatusOK {
		t.Fatalf("readyz after ready = %d, want 200", code)
	}
}
