package googleapi

import (
	"errors"
	"fmt"
	"net/http"
)

// APIError is a non-2xx response from a Google API.
//
// It carries the status code because callers have to act differently on an
// expired grant than on a rate limit or an outage: the first needs the user to
// reconnect, the others need a retry. Before this type the status lived only
// inside a formatted string, so the one caller that cared — the revenue scan —
// could not tell "your Gmail token died" from "Google is busy", and reported
// neither.
type APIError struct {
	Path       string
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("google api %s returned %d: %s", e.Path, e.StatusCode, e.Message)
	}
	return fmt.Sprintf("google api %s returned %d", e.Path, e.StatusCode)
}

// IsAuthError reports whether err came back as 401 or 403 — the grant is gone,
// was revoked, or never carried the scope. No amount of retrying fixes any of
// those; only the user reconnecting does.
func IsAuthError(err error) bool {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	return apiErr.StatusCode == http.StatusUnauthorized || apiErr.StatusCode == http.StatusForbidden
}
