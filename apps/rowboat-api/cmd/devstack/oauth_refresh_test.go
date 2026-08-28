package main

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestTokenFromRefreshAtomicallyRotatesOneUseCredential(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	oldKey, oldIssuer, oldAudience := signKey, issuer, audience
	signKey, issuer, audience = key, "https://issuer.example", "api-a"
	t.Cleanup(func() { signKey, issuer, audience = oldKey, oldIssuer, oldAudience })
	clearRefreshFixtureState()
	oauthFaults = newOAuthFaultController()
	t.Cleanup(clearRefreshFixtureState)
	if err := oauthFaults.configure(oauthFaultConfig{RefreshPlans: []oauthRefreshFaultPlan{{
		ID: "one-use", ProviderRefreshSemantics: providerRefreshSemanticsOneUseNonIdempotent,
	}}}); err != nil {
		t.Fatal(err)
	}
	refreshDB.Store("old-refresh", session{sub: "user-a", email: "a@example.test", clientID: "client-a", audience: "api-a", scope: "read"})

	first := refreshRequest(t, "old-refresh")
	if first.Code != http.StatusOK {
		t.Fatalf("first refresh status = %d, body = %s", first.Code, first.Body.String())
	}
	var token struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &token); err != nil {
		t.Fatal(err)
	}
	if token.RefreshToken == "" || token.RefreshToken == "old-refresh" {
		t.Fatalf("refresh token was not distinctly rotated")
	}

	second := refreshRequest(t, "old-refresh")
	if second.Code != http.StatusBadRequest || !strings.Contains(second.Body.String(), "invalid_grant") {
		t.Fatalf("reused refresh status = %d, body = %s", second.Code, second.Body.String())
	}
	if _, ok := refreshDB.Load(token.RefreshToken); !ok {
		t.Fatal("rotated refresh token is not active")
	}
}

func TestCrashFaultPlanRequiresIrreducibleProviderClassification(t *testing.T) {
	controller := newOAuthFaultController()
	err := controller.configure(oauthFaultConfig{RefreshPlans: []oauthRefreshFaultPlan{{ID: "crash", SignalPID: 42}}})
	if err == nil {
		t.Fatal("unclassified process-kill fault plan was accepted")
	}
	err = controller.configure(oauthFaultConfig{RefreshPlans: []oauthRefreshFaultPlan{{
		ID: "crash", SignalPID: 42, ProviderRefreshSemantics: providerRefreshSemanticsOneUseNonIdempotent,
	}}})
	if err != nil {
		t.Fatalf("classified process-kill fault plan: %v", err)
	}
}

func TestTokenFromRefreshCanIssueIndependentlyRevocableMultiUseRotation(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	oldKey, oldIssuer, oldAudience := signKey, issuer, audience
	signKey, issuer, audience = key, "https://issuer.example", "api-a"
	t.Cleanup(func() { signKey, issuer, audience = oldKey, oldIssuer, oldAudience })
	clearRefreshFixtureState()
	oauthFaults = newOAuthFaultController()
	t.Cleanup(clearRefreshFixtureState)
	if err := oauthFaults.configure(oauthFaultConfig{RefreshPlans: []oauthRefreshFaultPlan{{
		ID: "multi-use", ProviderRefreshSemantics: providerRefreshSemanticsMultiUseRotating,
	}}}); err != nil {
		t.Fatal(err)
	}
	refreshDB.Store("source-refresh", session{sub: "user-a", email: "a@example.test", clientID: "client-a", audience: "api-a", scope: "read"})

	response := refreshRequest(t, "source-refresh")
	if response.Code != http.StatusOK {
		t.Fatalf("refresh status = %d, body = %s", response.Code, response.Body.String())
	}
	var token struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &token); err != nil {
		t.Fatal(err)
	}
	if token.RefreshToken == "" || token.RefreshToken == "source-refresh" {
		t.Fatal("multi-use provider did not issue a distinct refresh token")
	}
	refreshDB.Delete(token.RefreshToken)
	if retry := refreshRequest(t, "source-refresh"); retry.Code != http.StatusOK {
		t.Fatalf("source refresh was consumed by multi-use rotation: status = %d, body = %s", retry.Code, retry.Body.String())
	}
}

func refreshRequest(t *testing.T, token string) *httptest.ResponseRecorder {
	t.Helper()
	form := url.Values{"refresh_token": {token}}
	request := httptest.NewRequest(http.MethodPost, "/oauth2/token", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if err := request.ParseForm(); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	tokenFromRefresh(response, request)
	return response
}

func clearRefreshFixtureState() {
	refreshDB.Range(func(key, _ any) bool {
		refreshDB.Delete(key)
		return true
	})
}
