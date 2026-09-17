package main

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"go.uber.org/zap"
)

// TestRunIgnoresLegacyDisableFlags verifies core scheduler responsibilities
// cannot be disabled through obsolete rollout switches.
func TestRunIgnoresLegacyDisableFlags(t *testing.T) {
	cfg := appconfig.Load()
	cfg.CloudSchedulerEnabled = false
	cfg.GoogleWatchEnabled = false
	cfg.RevenueMailPushSyncEnabled = false
	cfg.TemporalEnabled = false
	if err := run(cfg, zap.NewNop()); err == nil {
		t.Fatal("legacy disable flags bypassed required scheduler validation")
	}
}

// TestRunRejectsEnabledWithoutTemporal verifies Temporal remains mandatory.
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
