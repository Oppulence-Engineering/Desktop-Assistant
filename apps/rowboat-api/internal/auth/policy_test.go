package auth_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"go.uber.org/zap"
)

func newPolicyMW() *auth.Middleware {
	return auth.NewMiddleware(nil, nil, nil, 0, zap.NewNop())
}

// runPolicy mounts the policy middleware over a 200 handler and returns the
// recorder. A non-nil actor is attached to the request context.
func runPolicy(mw func(http.Handler) http.Handler, actor *auth.Actor) *httptest.ResponseRecorder {
	final := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := mw(final)
	req := httptest.NewRequest(http.MethodGet, "/v1/llm/models", nil)
	if actor != nil {
		req = req.WithContext(auth.WithActor(req.Context(), actor))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRequireUser(t *testing.T) {
	mw := newPolicyMW().RequireUser()
	if got := runPolicy(mw, nil).Code; got != http.StatusUnauthorized {
		t.Errorf("no actor: got %d, want 401", got)
	}
	if got := runPolicy(mw, &auth.Actor{Kind: auth.KindService}).Code; got != http.StatusForbidden {
		t.Errorf("service actor: got %d, want 403", got)
	}
	if got := runPolicy(mw, &auth.Actor{Kind: auth.KindUser}).Code; got != http.StatusOK {
		t.Errorf("user actor: got %d, want 200", got)
	}
}

func TestRequireOrg(t *testing.T) {
	mw := newPolicyMW().RequireOrg()
	if got := runPolicy(mw, &auth.Actor{Kind: auth.KindUser}).Code; got != http.StatusForbidden {
		t.Errorf("no org: got %d, want 403", got)
	}
	if got := runPolicy(mw, &auth.Actor{Kind: auth.KindUser, WorkOSOrgID: "org_1"}).Code; got != http.StatusOK {
		t.Errorf("with org: got %d, want 200", got)
	}
}

func TestRequireServiceScope(t *testing.T) {
	mw := newPolicyMW().RequireServiceScope("background_task:start")
	if got := runPolicy(mw, &auth.Actor{Kind: auth.KindUser}).Code; got != http.StatusForbidden {
		t.Errorf("user actor: got %d, want 403", got)
	}
	if got := runPolicy(mw, &auth.Actor{Kind: auth.KindService}).Code; got != http.StatusForbidden {
		t.Errorf("service without scope: got %d, want 403", got)
	}
	ok := &auth.Actor{Kind: auth.KindService, Scopes: []string{"background_task:start"}}
	if got := runPolicy(mw, ok).Code; got != http.StatusOK {
		t.Errorf("service with scope: got %d, want 200", got)
	}
}

func TestRequireConnectorScope(t *testing.T) {
	mw := newPolicyMW().RequireConnectorScope("canvas.read")
	if got := runPolicy(mw, &auth.Actor{Kind: auth.KindUser}).Code; got != http.StatusForbidden {
		t.Errorf("user actor: got %d, want 403", got)
	}
	ok := &auth.Actor{Kind: auth.KindConnectorResource, Scopes: []string{"canvas.read"}}
	if got := runPolicy(mw, ok).Code; got != http.StatusOK {
		t.Errorf("connector with scope: got %d, want 200", got)
	}
}

func TestRequirePermission(t *testing.T) {
	mw := newPolicyMW().RequirePermission("audit:export")
	if got := runPolicy(mw, &auth.Actor{Kind: auth.KindUser}).Code; got != http.StatusForbidden {
		t.Errorf("missing perm: got %d, want 403", got)
	}
	ok := &auth.Actor{Kind: auth.KindUser, Permissions: []string{"audit:export"}}
	if got := runPolicy(mw, ok).Code; got != http.StatusOK {
		t.Errorf("with perm: got %d, want 200", got)
	}
}

func TestRequireEntitlement(t *testing.T) {
	user := &auth.Actor{Kind: auth.KindUser}

	// No checker configured → fail closed (503).
	if got := runPolicy(newPolicyMW().RequireEntitlement("llm"), user).Code; got != http.StatusServiceUnavailable {
		t.Errorf("no checker: got %d, want 503", got)
	}

	denied := newPolicyMW()
	denied.SetEntitlements(func(context.Context, *auth.Actor, string) (bool, error) { return false, nil })
	if got := runPolicy(denied.RequireEntitlement("llm"), user).Code; got != http.StatusForbidden {
		t.Errorf("denied: got %d, want 403", got)
	}

	errored := newPolicyMW()
	errored.SetEntitlements(func(context.Context, *auth.Actor, string) (bool, error) { return false, errors.New("db down") })
	if got := runPolicy(errored.RequireEntitlement("llm"), user).Code; got != http.StatusServiceUnavailable {
		t.Errorf("checker error: got %d, want 503", got)
	}

	allowed := newPolicyMW()
	allowed.SetEntitlements(func(_ context.Context, _ *auth.Actor, name string) (bool, error) { return name == "llm", nil })
	if got := runPolicy(allowed.RequireEntitlement("llm"), user).Code; got != http.StatusOK {
		t.Errorf("allowed: got %d, want 200", got)
	}
}

func TestRequireStepUpSession(t *testing.T) {
	mw := newPolicyMW().RequireStepUp(auth.StepUpSession)
	if got := runPolicy(mw, &auth.Actor{Kind: auth.KindUser}).Code; got != http.StatusOK {
		t.Errorf("user session: got %d, want 200", got)
	}
	if got := runPolicy(mw, &auth.Actor{Kind: auth.KindInternal}).Code; got != http.StatusForbidden {
		t.Errorf("internal actor: got %d, want 403", got)
	}
}

func TestRequireStepUpRecentAuth(t *testing.T) {
	m := newPolicyMW()
	m.SetStepUpWindow(15 * time.Minute)
	mw := m.RequireStepUp(auth.StepUpRecentAuth)

	recent := &auth.Actor{Kind: auth.KindUser, AuthTime: time.Now().Add(-2 * time.Minute).Unix()}
	if got := runPolicy(mw, recent).Code; got != http.StatusOK {
		t.Errorf("recent auth: got %d, want 200", got)
	}
	stale := &auth.Actor{Kind: auth.KindUser, AuthTime: time.Now().Add(-time.Hour).Unix()}
	rec := runPolicy(mw, stale)
	if rec.Code != http.StatusForbidden {
		t.Errorf("stale auth: got %d, want 403", rec.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["stepUpRequired"] != "recent_auth" {
		t.Errorf("stepUpRequired = %v, want recent_auth", body["stepUpRequired"])
	}
	noClaim := &auth.Actor{Kind: auth.KindUser} // auth_time unknown → fail closed
	if got := runPolicy(mw, noClaim).Code; got != http.StatusForbidden {
		t.Errorf("no auth_time: got %d, want 403", got)
	}
}

func TestRequireStepUpMFA(t *testing.T) {
	mw := newPolicyMW().RequireStepUp(auth.StepUpMFA)
	mfa := &auth.Actor{Kind: auth.KindUser, AuthMethods: []string{"pwd", "otp"}}
	if got := runPolicy(mw, mfa).Code; got != http.StatusOK {
		t.Errorf("mfa: got %d, want 200", got)
	}
	if got := runPolicy(mw, &auth.Actor{Kind: auth.KindUser, AuthMethods: []string{"pwd"}}).Code; got != http.StatusForbidden {
		t.Errorf("no mfa: got %d, want 403", got)
	}
}
