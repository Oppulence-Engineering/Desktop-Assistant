// Package proxyutil holds small helpers shared by the vendor-proxy handlers
// (voice, search, composio).
package proxyutil

import "net/http"

// ContentTypeOr returns the upstream Content-Type, or def if absent.
func ContentTypeOr(resp *http.Response, def string) string {
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		return ct
	}
	return def
}

// CopyHeader copies a single header value from upstream to the client response
// if present.
func CopyHeader(dst http.ResponseWriter, src *http.Response, key string) {
	if v := src.Header.Get(key); v != "" {
		dst.Header().Set(key, v)
	}
}
