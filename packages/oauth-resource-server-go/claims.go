package oauthrs

import "time"

// Claims is the verified, normalized set of claims extracted from a token.
type Claims struct {
	Subject  string
	Issuer   string
	Audience []string
	Scopes   []string
	Expiry   time.Time

	// Identity enrichment commonly carried by WorkOS/Ory tokens.
	WorkOSUserID string
	WorkOSOrgID  string
	Email        string

	// Raw is the full claim set for handlers that need a non-standard claim.
	Raw map[string]any
}

// HasScope reports whether the token was granted the given scope.
func (c *Claims) HasScope(scope string) bool {
	for _, s := range c.Scopes {
		if s == scope {
			return true
		}
	}
	return false
}

// HasAllScopes reports whether every requested scope is present.
func (c *Claims) HasAllScopes(scopes ...string) bool {
	for _, want := range scopes {
		if !c.HasScope(want) {
			return false
		}
	}
	return true
}

// HasAnyScope reports whether at least one requested scope is present.
func (c *Claims) HasAnyScope(scopes ...string) bool {
	for _, want := range scopes {
		if c.HasScope(want) {
			return true
		}
	}
	return false
}
