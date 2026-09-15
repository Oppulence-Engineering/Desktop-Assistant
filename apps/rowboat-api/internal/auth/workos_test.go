package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

var _ Enricher = (*WorkOSEnricher)(nil)
var _ Enricher = NoopEnricher{}

func workosTestEnricher(t *testing.T, baseSuffix string, handler http.HandlerFunc) *WorkOSEnricher {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	e, ok := NewWorkOSEnricher("sk_test_workos", server.URL+baseSuffix).(*WorkOSEnricher)
	if !ok {
		t.Fatal("NewWorkOSEnricher with an API key did not return *WorkOSEnricher")
	}
	return e
}

func TestWorkOSDeleteUserSendsAnAuthenticatedDelete(t *testing.T) {
	var calls atomic.Int32
	e := workosTestEnricher(t, "", func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodDelete {
			t.Errorf("method = %s, want DELETE", r.Method)
		}
		if r.URL.Path != "/user_management/users/user_123" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer sk_test_workos" {
			t.Errorf("Authorization = %q", got)
		}
		w.WriteHeader(http.StatusNoContent)
	})
	if err := e.DeleteUser(context.Background(), "user_123"); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("WorkOS calls = %d, want 1", calls.Load())
	}
}

func TestWorkOSDeleteUserTreatsSuccessAndNotFoundAsDeleted(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusAccepted, http.StatusNoContent, http.StatusNotFound} {
		e := workosTestEnricher(t, "", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(status) })
		if err := e.DeleteUser(context.Background(), "user_gone"); err != nil {
			t.Errorf("status %d: DeleteUser = %v, want nil", status, err)
		}
	}
}

func TestWorkOSDeleteUserReportsFailuresWithoutTheResponseBody(t *testing.T) {
	statuses := []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusConflict,
		http.StatusUnprocessableEntity, http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusBadGateway}
	for _, status := range statuses {
		e := workosTestEnricher(t, "", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
			_, _ = fmt.Fprint(w, `{"message":"secret-workos-detail"}`)
		})
		err := e.DeleteUser(context.Background(), "user_fail")
		if err == nil {
			t.Errorf("status %d: DeleteUser = nil, want an error", status)
			continue
		}
		if !strings.Contains(err.Error(), fmt.Sprint(status)) {
			t.Errorf("status %d: error %q does not name the status", status, err)
		}
		if strings.Contains(err.Error(), "secret-workos-detail") {
			t.Errorf("status %d: error leaks the response body: %q", status, err)
		}
	}
}

func TestWorkOSDeleteUserEscapesTheUserID(t *testing.T) {
	var escaped atomic.Value
	e := workosTestEnricher(t, "", func(w http.ResponseWriter, r *http.Request) {
		escaped.Store(r.URL.EscapedPath())
		w.WriteHeader(http.StatusNoContent)
	})
	if err := e.DeleteUser(context.Background(), "user/../admin x"); err != nil {
		t.Fatal(err)
	}
	if got := escaped.Load(); got != "/user_management/users/user%2F..%2Fadmin%20x" {
		t.Fatalf("escaped path = %v; the id must stay one path segment", got)
	}
}

func TestWorkOSDeleteUserTrimsATrailingSlashFromTheBaseURL(t *testing.T) {
	var path atomic.Value
	e := workosTestEnricher(t, "/", func(w http.ResponseWriter, r *http.Request) {
		path.Store(r.URL.Path)
		w.WriteHeader(http.StatusNoContent)
	})
	if err := e.DeleteUser(context.Background(), "user_1"); err != nil {
		t.Fatal(err)
	}
	if got := path.Load(); got != "/user_management/users/user_1" {
		t.Fatalf("path = %v", got)
	}
}

func TestWorkOSDeleteUserFailsWhenWorkOSIsUnreachable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	base := server.URL
	server.Close()
	e := NewWorkOSEnricher("sk_test_workos", base).(*WorkOSEnricher)
	if err := e.DeleteUser(context.Background(), "user_1"); err == nil {
		t.Fatal("DeleteUser = nil against a closed server")
	}
}

func TestWorkOSDeleteUserStopsOnACancelledContext(t *testing.T) {
	var calls atomic.Int32
	e := workosTestEnricher(t, "", func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusNoContent)
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := e.DeleteUser(ctx, "user_1"); err == nil {
		t.Fatal("DeleteUser = nil with a cancelled context")
	}
	if calls.Load() != 0 {
		t.Fatalf("WorkOS calls = %d, want 0", calls.Load())
	}
}

func TestNewWorkOSEnricherDefaultsToTheWorkOSAPI(t *testing.T) {
	e, ok := NewWorkOSEnricher("sk_live_x", "").(*WorkOSEnricher)
	if !ok || e.baseURL != "https://api.workos.com" {
		t.Fatalf("NewWorkOSEnricher(key, \"\") = %#v", e)
	}
}

func TestNewWorkOSEnricherWithoutAKeyIsANoop(t *testing.T) {
	e := NewWorkOSEnricher("", "http://127.0.0.1:1")
	if _, ok := e.(NoopEnricher); !ok {
		t.Fatalf("NewWorkOSEnricher without a key = %T, want NoopEnricher", e)
	}
	if err := e.DeleteUser(context.Background(), "user_1"); err != nil {
		t.Fatalf("NoopEnricher.DeleteUser = %v", err)
	}
	if email, err := e.Email(context.Background(), "user_1"); email != "" || err != nil {
		t.Fatalf("NoopEnricher.Email = %q, %v", email, err)
	}
}

func TestWorkOSEmailUsesTheConfiguredBaseURL(t *testing.T) {
	e := workosTestEnricher(t, "", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/user_management/users/user_7" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"email": "seven@example.test"})
	})
	email, err := e.Email(context.Background(), "user_7")
	if err != nil || email != "seven@example.test" {
		t.Fatalf("Email = %q, %v", email, err)
	}
}

func TestWorkOSEmailReportsANonOKResponse(t *testing.T) {
	e := workosTestEnricher(t, "", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusForbidden) })
	if _, err := e.Email(context.Background(), "user_7"); err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("Email error = %v, want a 403 error", err)
	}
}
