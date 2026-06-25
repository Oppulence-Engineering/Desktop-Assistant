package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"go.uber.org/zap"
)

type readyzBody struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks"`
}

// An optional check failing degrades that dependency but keeps the service ready
// (RFC 010: optional deps degrade, required deps fail).
func TestReadyzOptionalFailureStaysReady(t *testing.T) {
	s := New(appconfig.Config{ReadinessTimeout: time.Second}, zap.NewNop())
	s.AddReadyCheck("database", func(context.Context) error { return nil })
	s.AddOptionalReadyCheck("workos_jwks", func(context.Context) error { return errors.New("jwks not loaded") })

	rec := httptest.NewRecorder()
	s.handleReadyz(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("optional failure must not fail readiness: got %d", rec.Code)
	}
	var body readyzBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Status != "ready" {
		t.Errorf("status = %q, want ready", body.Status)
	}
	if body.Checks["database"] != "ok" {
		t.Errorf("database = %q, want ok", body.Checks["database"])
	}
	if body.Checks["workos_jwks"] != "degraded" {
		t.Errorf("workos_jwks = %q, want degraded", body.Checks["workos_jwks"])
	}
}

// A required check failing fails readiness with 503 and reports every dependency.
func TestReadyzRequiredFailureIsNotReady(t *testing.T) {
	s := New(appconfig.Config{ReadinessTimeout: time.Second}, zap.NewNop())
	s.AddReadyCheck("database", func(context.Context) error { return errors.New("down") })
	s.AddOptionalReadyCheck("workos_jwks", func(context.Context) error { return nil })

	rec := httptest.NewRecorder()
	s.handleReadyz(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("required failure must be 503: got %d", rec.Code)
	}
	var body readyzBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Status != "not_ready" {
		t.Errorf("status = %q, want not_ready", body.Status)
	}
	if body.Checks["database"] != "fail" {
		t.Errorf("database = %q, want fail", body.Checks["database"])
	}
	if body.Checks["workos_jwks"] != "ok" {
		t.Errorf("workos_jwks = %q, want ok", body.Checks["workos_jwks"])
	}
}
