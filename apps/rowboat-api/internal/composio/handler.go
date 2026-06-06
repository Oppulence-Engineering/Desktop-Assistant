// Package composio reverse-proxies /v1/composio/* to the Composio v3 API,
// swapping the user's bearer token for the server-held x-api-key. Request and
// response bodies are passed through unchanged (Composio v3 shapes).
package composio

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

const routePrefix = "/v1/composio"

// Handler reverse-proxies the Composio API.
type Handler struct {
	secrets *secrets.Store
	log     *zap.Logger
	target  *url.URL
	proxy   *httputil.ReverseProxy
}

// New builds the Composio proxy. baseURL defaults to the Composio v3 API.
func New(sec *secrets.Store, log *zap.Logger) *Handler {
	target, _ := url.Parse("https://backend.composio.dev/api/v3")
	h := &Handler{secrets: sec, log: log, target: target}
	h.proxy = &httputil.ReverseProxy{
		Rewrite:       h.rewrite,
		ErrorHandler:  h.onError,
		FlushInterval: -1, // stream responses immediately
		Transport:     &http.Transport{ResponseHeaderTimeout: 60 * time.Second},
	}
	return h
}

// SetUpstream overrides the Composio base URL (tests).
func (h *Handler) SetUpstream(base string) {
	if base == "" {
		return
	}
	if u, err := url.Parse(base); err == nil {
		h.target = u
	}
}

// Proxy handles all /v1/composio/* methods.
func (h *Handler) Proxy(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserFromCtx(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	if h.secrets.Composio() == "" {
		httpx.Error(w, http.StatusBadGateway, "composio not configured", "provider_unconfigured")
		return
	}
	h.proxy.ServeHTTP(w, r)
}

// rewrite maps the inbound request onto the Composio v3 upstream and swaps auth.
func (h *Handler) rewrite(pr *httputil.ProxyRequest) {
	rest := strings.TrimPrefix(pr.In.URL.Path, routePrefix) // e.g. /toolkits

	pr.Out.URL.Scheme = h.target.Scheme
	pr.Out.URL.Host = h.target.Host
	pr.Out.URL.Path = strings.TrimRight(h.target.Path, "/") + rest
	pr.Out.URL.RawQuery = pr.In.URL.RawQuery
	pr.Out.Host = h.target.Host

	// Auth swap: drop the user's bearer, attach the server vendor key.
	pr.Out.Header.Del("Authorization")
	pr.Out.Header.Set("x-api-key", h.secrets.Composio())

	// Tag the request with our user id so Composio account/entity isolation can
	// be enforced per user. NOTE: full tenant isolation of connected_accounts /
	// auth_configs depends on the Composio tenancy model (plan Open Question §6);
	// this header is the hook for it once decided.
	if u, ok := auth.UserFromCtx(pr.In.Context()); ok {
		pr.Out.Header.Set("X-Solomon-User", u.ID.String())
	}
}

func (h *Handler) onError(w http.ResponseWriter, _ *http.Request, err error) {
	h.log.Warn("composio upstream error", zap.Error(err))
	httpx.Error(w, http.StatusBadGateway, "composio upstream failed", "upstream_error")
}
