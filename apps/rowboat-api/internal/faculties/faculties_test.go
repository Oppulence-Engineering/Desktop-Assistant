package faculties

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

func TestNewNilWhenUnconfigured(t *testing.T) {
	if New("conduit", "", "rowboat-internal", "signing-secret", outbound.Policy{}) != nil {
		t.Fatal("New must be nil without a base URL")
	}
	if New("conduit", "https://x", "", "signing-secret", outbound.Policy{}) != nil {
		t.Fatal("New must be nil without an issuer")
	}
	if New("conduit", "https://x", "rowboat-internal", "", outbound.Policy{}) != nil {
		t.Fatal("New must be nil without a signing secret")
	}
}

func TestCall(t *testing.T) {
	var gotPath, gotAuth, gotUser, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotUser = r.Header.Get("X-Rowboat-User")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"threads":[{"id":"t1"}]}`))
	}))
	defer srv.Close()

	c := New("conduit", srv.URL, "rowboat-internal", "signing-secret", outbound.Policy{})
	out, err := c.Call(context.Background(), "user-9", "/v1/query", map[string]any{"operation": "disputes_open"})
	if err != nil {
		t.Fatalf("Call: %v", err)
	}
	if gotPath != "/v1/query" {
		t.Fatalf("path = %q", gotPath)
	}
	if !strings.HasPrefix(gotAuth, "Bearer rbd_") {
		t.Fatalf("auth = %q, want signed delegation bearer", gotAuth)
	}
	claims, err := VerifyDelegation(gotAuth, "signing-secret", []byte(gotBody), time.Now())
	if err != nil {
		t.Fatalf("verify delegation: %v", err)
	}
	if claims.Issuer != "rowboat-internal" || claims.Audience != "conduit" ||
		claims.Subject != "user-9" || claims.Method != http.MethodPost || claims.Path != "/v1/query" {
		t.Fatalf("claims = %+v", claims)
	}
	if _, err := VerifyDelegationFor(gotAuth, "signing-secret", DelegationExpectation{
		Issuer:   "rowboat-internal",
		Audience: "conduit",
		Method:   http.MethodPost,
		Path:     "/v1/query",
	}, []byte(gotBody), time.Now()); err != nil {
		t.Fatalf("verify delegation for endpoint: %v", err)
	}
	if gotUser != "user-9" {
		t.Fatalf("on-behalf-of header = %q", gotUser)
	}
	if !strings.Contains(gotBody, `"operation":"disputes_open"`) {
		t.Fatalf("body = %s", gotBody)
	}
	if !strings.Contains(string(out), `"threads"`) {
		t.Fatalf("response passthrough = %s", out)
	}
}

func TestCallNonJSONWrapped(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`plain text body`))
	}))
	defer srv.Close()
	c := New("eigen", srv.URL, "rowboat-internal", "signing-secret", outbound.Policy{})
	out, err := c.Call(context.Background(), "u", "/v1/simulate", map[string]any{"scenario": "runway"})
	if err != nil {
		t.Fatalf("Call: %v", err)
	}
	if !strings.Contains(string(out), `"raw":"plain text body"`) {
		t.Fatalf("non-JSON body should be wrapped, got %s", out)
	}
}

func TestCallErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()
	c := New("conduit", srv.URL, "rowboat-internal", "signing-secret", outbound.Policy{})
	if _, err := c.Call(context.Background(), "u", "/v1/query", nil); err == nil {
		t.Fatal("expected error on non-2xx status")
	}
}

func TestVerifyDelegationRejectsTamperedBody(t *testing.T) {
	var gotAuth, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	c := New("conduit", srv.URL, "rowboat-internal", "signing-secret", outbound.Policy{})
	if _, err := c.Call(context.Background(), "user-9", "/v1/query", map[string]any{"operation": "x"}); err != nil {
		t.Fatalf("Call: %v", err)
	}
	if _, err := VerifyDelegation(gotAuth, "signing-secret", []byte(gotBody+"tampered"), time.Now()); !errors.Is(err, ErrDelegationBody) {
		t.Fatalf("tampered body err = %v, want ErrDelegationBody", err)
	}
}

func TestVerifyDelegationForRejectsWrongEndpoint(t *testing.T) {
	var gotAuth, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	c := New("conduit", srv.URL, "rowboat-internal", "signing-secret", outbound.Policy{})
	if _, err := c.Call(context.Background(), "user-9", "/v1/query", map[string]any{"operation": "x"}); err != nil {
		t.Fatalf("Call: %v", err)
	}
	if _, err := VerifyDelegationFor(gotAuth, "signing-secret", DelegationExpectation{
		Issuer:   "rowboat-internal",
		Audience: "eigen",
		Method:   http.MethodPost,
		Path:     "/v1/query",
	}, []byte(gotBody), time.Now()); !errors.Is(err, ErrDelegationAudience) {
		t.Fatalf("wrong audience err = %v, want ErrDelegationAudience", err)
	}
	if _, err := VerifyDelegationFor(gotAuth, "signing-secret", DelegationExpectation{
		Issuer:   "rowboat-internal",
		Audience: "conduit",
		Method:   http.MethodPost,
		Path:     "/v1/other",
	}, []byte(gotBody), time.Now()); !errors.Is(err, ErrDelegationPath) {
		t.Fatalf("wrong path err = %v, want ErrDelegationPath", err)
	}
}
