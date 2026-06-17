package auth_test

import (
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	"github.com/google/uuid"
)

func TestActorFromUserExtractsClaims(t *testing.T) {
	uid := uuid.New()
	u := &ent.User{ID: uid, WorkosUserID: "user_123", WorkosOrgID: "org_local"}
	claims := &oauthrs.Claims{
		Issuer:      "https://auth.solomon-ai.co",
		WorkOSOrgID: "org_token", // token org wins over stored
		Scopes:      []string{"a:read", "b:write"},
		Raw: map[string]any{
			"jti":         "tok_abc",
			"auth_time":   float64(1770249600),
			"amr":         []any{"pwd", "otp"},
			"permissions": []any{"billing:read", "billing:write"},
		},
	}

	a := auth.ActorFromUser(u, claims)
	if a.Kind != auth.KindUser {
		t.Errorf("kind = %q, want user", a.Kind)
	}
	if a.UserID != uid {
		t.Errorf("user id = %v", a.UserID)
	}
	if a.WorkOSUserID != "user_123" {
		t.Errorf("workos user id = %q", a.WorkOSUserID)
	}
	if a.WorkOSOrgID != "org_token" {
		t.Errorf("workos org id = %q, want token org", a.WorkOSOrgID)
	}
	if a.TokenID != "tok_abc" {
		t.Errorf("token id = %q", a.TokenID)
	}
	if a.AuthTime != 1770249600 {
		t.Errorf("auth time = %d", a.AuthTime)
	}
	if !a.HasScope("a:read") || a.HasScope("c:none") {
		t.Errorf("scopes = %v", a.Scopes)
	}
	if !a.HasPermission("billing:write") || a.HasPermission("admin") {
		t.Errorf("permissions = %v", a.Permissions)
	}
	if !a.HasMFA() {
		t.Error("expected MFA from amr=otp")
	}
}

func TestActorFromUserFallsBackToStoredOrg(t *testing.T) {
	u := &ent.User{ID: uuid.New(), WorkosUserID: "user_1", WorkosOrgID: "org_stored"}
	a := auth.ActorFromUser(u, &oauthrs.Claims{}) // no org in claims
	if a.WorkOSOrgID != "org_stored" {
		t.Errorf("org = %q, want stored fallback", a.WorkOSOrgID)
	}
	if a.HasMFA() {
		t.Error("no amr → no MFA")
	}
}

func TestActorHasMFA(t *testing.T) {
	if (&auth.Actor{AuthMethods: []string{"pwd"}}).HasMFA() {
		t.Error("pwd alone is not MFA")
	}
	if !(&auth.Actor{AuthMethods: []string{"pwd", "webauthn"}}).HasMFA() {
		t.Error("webauthn is MFA")
	}
}
