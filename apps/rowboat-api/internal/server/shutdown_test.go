package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"go.uber.org/zap"
)

func TestBeginShutdownFailsReadinessBeforeDependencyChecks(t *testing.T) {
	s := New(appconfig.Config{ReadinessTimeout: time.Second}, zap.NewNop())
	var checked atomic.Bool
	var hookCalled atomic.Bool
	s.AddReadyCheck("slow_dependency", func(context.Context) error {
		checked.Store(true)
		return nil
	})
	s.AddShutdownHook("custody", func() { hookCalled.Store(true) })

	s.beginShutdown()
	if !hookCalled.Load() {
		t.Fatal("shutdown hook was not called before readiness failed")
	}

	rec := httptest.NewRecorder()
	s.handleReadyz(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("shutdown readiness status = %d, want 503", rec.Code)
	}
	if checked.Load() {
		t.Fatal("shutdown readiness waited for dependency checks")
	}
	var body struct {
		Status string            `json:"status"`
		Checks map[string]string `json:"checks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode readiness response: %v", err)
	}
	if body.Status != "not_ready" || body.Checks["server_shutdown"] != "fail" {
		t.Fatalf("unexpected shutdown readiness body: %+v", body)
	}
}

func TestCloseResourcesBoundsContextIgnoringCloser(t *testing.T) {
	s := New(appconfig.Config{}, zap.NewNop())
	release := make(chan struct{})
	s.AddCloser("blocked", func() error {
		<-release
		return nil
	})

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	started := time.Now()
	err := s.closeResources(ctx)
	cancel()
	close(release)

	if time.Since(started) > 250*time.Millisecond {
		t.Fatalf("resource shutdown exceeded context bound: %s", time.Since(started))
	}
	if !errors.Is(err, context.DeadlineExceeded) || !strings.Contains(err.Error(), "close blocked exceeded shutdown deadline") {
		t.Fatalf("expected operator-visible bounded closer error, got %v", err)
	}
}
