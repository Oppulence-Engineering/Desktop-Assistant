package oauthrs

import (
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// claimsFromMap normalizes a raw claim map into Claims, handling the common
// shapes used by Ory (custom claims under `ext`, scopes under `scp`) and the
// standard OAuth `scope` string.
func claimsFromMap(m jwt.MapClaims) *Claims {
	c := &Claims{Raw: m}
	c.Subject, _ = m["sub"].(string)
	c.Issuer, _ = m["iss"].(string)
	c.Audience = toStringSlice(m["aud"])
	c.Scopes = extractScopes(m)
	if exp, err := m.GetExpirationTime(); err == nil && exp != nil {
		c.Expiry = exp.Time
	}

	// Ory carries custom claims under an `ext` object; fall back to top-level.
	ext, _ := m["ext"].(map[string]any)
	c.WorkOSUserID = firstString(get(ext, "workos_user_id"), m["workos_user_id"], m["sub"])
	c.WorkOSOrgID = firstString(get(ext, "workos_org_id"), m["workos_org_id"], m["org_id"])
	c.Email = firstString(get(ext, "email"), m["email"])
	return c
}

func get(m map[string]any, key string) any {
	if m == nil {
		return nil
	}
	return m[key]
}

// extractScopes reads scopes from either the OAuth `scope` (space-delimited
// string) or the `scp` (array) claim.
func extractScopes(m jwt.MapClaims) []string {
	if s, ok := m["scope"].(string); ok && s != "" {
		return strings.Fields(s)
	}
	if arr, ok := m["scp"].([]any); ok {
		return toStringSlice(arr)
	}
	if s, ok := m["scp"].(string); ok && s != "" {
		return strings.Fields(s)
	}
	return nil
}

// toStringSlice coerces a claim value (string or []any) into []string.
func toStringSlice(v any) []string {
	switch t := v.(type) {
	case string:
		if t == "" {
			return nil
		}
		return []string{t}
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, e := range t {
			if s, ok := e.(string); ok {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

// firstString returns the first value that is a non-empty string.
func firstString(vals ...any) string {
	for _, v := range vals {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	return ""
}
