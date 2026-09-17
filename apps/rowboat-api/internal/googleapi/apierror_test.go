package googleapi

import (
	"errors"
	"fmt"
	"testing"
)

// A refresh that Google answers with invalid_grant carries no status code, and
// the scan used to miss it: every run failed with a generic message while the
// connection card stayed "Active". The sentinel is an auth error, wrapped or
// not.
func TestIsAuthErrorRecognizesADeadGrant(t *testing.T) {
	if !IsAuthError(ErrReconnectRequired) {
		t.Fatal("ErrReconnectRequired was not classified as an auth error")
	}
	wrapped := fmt.Errorf("revenue: could not refresh: %w", ErrReconnectRequired)
	if !IsAuthError(wrapped) {
		t.Fatal("a wrapped ErrReconnectRequired was not classified as an auth error")
	}
	if IsAuthError(errors.New("google token endpoint returned 503 ()")) {
		t.Fatal("an outage was classified as an auth error")
	}
}
