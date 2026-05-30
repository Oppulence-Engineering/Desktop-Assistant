package secrets_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
)

func TestEnvSeeding(t *testing.T) {
	s := secrets.NewFromConfig(appconfig.Config{
		AnthropicAPIKey: "sk-ant-env",
		ExaAPIKey:       "exa-env",
	})
	if s.Anthropic() != "sk-ant-env" {
		t.Errorf("anthropic = %q", s.Anthropic())
	}
	if s.Exa() != "exa-env" {
		t.Errorf("exa = %q", s.Exa())
	}
	if s.OpenAI() != "" {
		t.Errorf("unset key should be empty, got %q", s.OpenAI())
	}
}

func TestInfisicalOverlay(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok-123" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"secrets":[
			{"secretKey":"ANTHROPIC_API_KEY","secretValue":"sk-ant-infisical"},
			{"secretKey":"OPENAI_API_KEY","secretValue":"sk-openai-infisical"}
		]}`))
	}))
	defer srv.Close()

	// Anthropic present in env; Infisical should override. OpenAI only in Infisical.
	s := secrets.NewFromConfig(appconfig.Config{AnthropicAPIKey: "sk-ant-env"})
	cfg := appconfig.Config{
		InfisicalEnabled:     true,
		InfisicalSiteURL:     srv.URL,
		InfisicalToken:       "tok-123",
		InfisicalProjectID:   "proj_1",
		InfisicalEnvironment: "production",
	}
	if err := s.LoadInfisical(context.Background(), cfg); err != nil {
		t.Fatalf("load infisical: %v", err)
	}
	if s.Anthropic() != "sk-ant-infisical" {
		t.Errorf("anthropic should be overridden by infisical, got %q", s.Anthropic())
	}
	if s.OpenAI() != "sk-openai-infisical" {
		t.Errorf("openai from infisical, got %q", s.OpenAI())
	}
}

func TestInfisicalDisabledIsNoop(t *testing.T) {
	s := secrets.NewFromConfig(appconfig.Config{AnthropicAPIKey: "sk-env"})
	if err := s.LoadInfisical(context.Background(), appconfig.Config{InfisicalEnabled: false}); err != nil {
		t.Fatalf("disabled load should be no-op, got %v", err)
	}
	if s.Anthropic() != "sk-env" {
		t.Errorf("env value should remain, got %q", s.Anthropic())
	}
}
