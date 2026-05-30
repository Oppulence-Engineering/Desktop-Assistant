package connectors

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
)

// randomToken returns a URL-safe random string with nBytes of entropy.
func randomToken(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// codeChallengeS256 computes the PKCE S256 challenge for a verifier.
func codeChallengeS256(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
