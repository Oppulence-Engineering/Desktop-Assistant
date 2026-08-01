// Package secrets is the vendor-key store. Keys are seeded from the
// environment (local dev) and, when Infisical is enabled, overlaid from the
// Infisical project and periodically refreshed. The rest of the service reads
// vendor keys exclusively through this store so the source can change without
// touching call sites.
package secrets

import (
	"sync"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
)

// Logical key names. These match Infisical secret keys and env var names.
const (
	KeyAnthropic               = "ANTHROPIC_API_KEY"
	KeyOpenAI                  = "OPENAI_API_KEY"
	KeyOpenRouter              = "OPENROUTER_API_KEY"
	KeyGoogle                  = "GOOGLE_API_KEY"
	KeyDeepgram                = "DEEPGRAM_API_KEY"
	KeyElevenLabs              = "ELEVENLABS_API_KEY"
	KeyExa                     = "EXA_API_KEY"
	KeyGoogleOAuthClientID     = "GOOGLE_OAUTH_CLIENT_ID"
	KeyGoogleOAuthClientSecret = "GOOGLE_OAUTH_CLIENT_SECRET"
	KeySlackClientID           = "SLACK_CLIENT_ID"
	KeySlackClientSecret       = "SLACK_CLIENT_SECRET"
	KeyPlain                   = "PLAIN_API_KEY"
)

// Store holds vendor secrets behind a read-write lock so background refresh is
// safe against concurrent reads.
type Store struct {
	mu   sync.RWMutex
	vals map[string]string
}

// NewFromConfig seeds the store from the env-backed config values.
func NewFromConfig(cfg appconfig.Config) *Store {
	return &Store{vals: map[string]string{
		KeyAnthropic:               cfg.AnthropicAPIKey,
		KeyOpenAI:                  cfg.OpenAIAPIKey,
		KeyOpenRouter:              cfg.OpenRouterAPIKey,
		KeyGoogle:                  cfg.GoogleAPIKey,
		KeyDeepgram:                cfg.DeepgramAPIKey,
		KeyElevenLabs:              cfg.ElevenLabsAPIKey,
		KeyExa:                     cfg.ExaAPIKey,
		KeyGoogleOAuthClientID:     cfg.GoogleOAuthClientID,
		KeyGoogleOAuthClientSecret: cfg.GoogleOAuthClientSecret,
		KeySlackClientID:           cfg.SlackClientID,
		KeySlackClientSecret:       cfg.SlackClientSecret,
		KeyPlain:                   cfg.PlainAPIKey,
	}}
}

// Get returns the value for a logical key ("" if unset).
func (s *Store) Get(key string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.vals[key]
}

// set overlays a value (used by the Infisical loader).
func (s *Store) set(key, val string) {
	if val == "" {
		return
	}
	s.mu.Lock()
	s.vals[key] = val
	s.mu.Unlock()
}

// Anthropic returns the Anthropic API key.
func (s *Store) Anthropic() string { return s.Get(KeyAnthropic) }

// OpenAI returns the OpenAI API key.
func (s *Store) OpenAI() string { return s.Get(KeyOpenAI) }

// OpenRouter returns the OpenRouter API key.
func (s *Store) OpenRouter() string { return s.Get(KeyOpenRouter) }

// Google returns the Google (Gemini) API key.
func (s *Store) Google() string { return s.Get(KeyGoogle) }

// Deepgram returns the Deepgram speech-to-text API key.
func (s *Store) Deepgram() string { return s.Get(KeyDeepgram) }

// ElevenLabs returns the ElevenLabs API key.
func (s *Store) ElevenLabs() string { return s.Get(KeyElevenLabs) }

// Exa returns the Exa Search API key.
func (s *Store) Exa() string { return s.Get(KeyExa) }

// GoogleOAuthClientID returns the Google OAuth client id.
func (s *Store) GoogleOAuthClientID() string { return s.Get(KeyGoogleOAuthClientID) }

// GoogleOAuthClientSecret returns the Google OAuth client secret.
func (s *Store) GoogleOAuthClientSecret() string { return s.Get(KeyGoogleOAuthClientSecret) }

// SlackClientID returns the Slack app's OAuth client id.
func (s *Store) SlackClientID() string { return s.Get(KeySlackClientID) }

// SlackClientSecret returns the Slack app's OAuth client secret.
func (s *Store) SlackClientSecret() string { return s.Get(KeySlackClientSecret) }

// Plain returns the Plain (plain.com) API key.
func (s *Store) Plain() string { return s.Get(KeyPlain) }
