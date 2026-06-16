// Package composio reverse-proxies /v1/composio/* to the Composio v3 API,
// swapping the user's bearer token for the server-held x-api-key. Request and
// response bodies keep Composio v3 shapes, with connected-account responses
// scoped to the authenticated Rowboat user.
package composio

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/composioaccount"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

const routePrefix = "/v1/composio"

var errConnectedAccountNotFound = errors.New("composio connected account not found for user")

type proxyRestPathKey struct{}

// Handler reverse-proxies the Composio API.
type Handler struct {
	client  *ent.Client
	secrets *secrets.Store
	log     *zap.Logger
	target  *url.URL
	proxy   *httputil.ReverseProxy
}

// New builds the Composio proxy. baseURL defaults to the Composio v3 API.
func New(client *ent.Client, sec *secrets.Store, log *zap.Logger) *Handler {
	if log == nil {
		log = zap.NewNop()
	}
	target, _ := url.Parse("https://backend.composio.dev/api/v3")
	h := &Handler{client: client, secrets: sec, log: log, target: target}
	h.proxy = &httputil.ReverseProxy{
		Rewrite:        h.rewrite,
		ModifyResponse: h.modifyResponse,
		ErrorHandler:   h.onError,
		FlushInterval:  -1, // stream responses immediately
		Transport: outbound.NewTransport(http.DefaultTransport, outbound.Policy{
			Name:                  "composio",
			Timeout:               60 * time.Second,
			ResponseHeaderTimeout: 60 * time.Second,
			MaxConcurrent:         64,
			MaxResponseBytes:      64 << 20,
		}),
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

// SetOutboundPolicy applies the shared outbound vendor policy.
func (h *Handler) SetOutboundPolicy(policy outbound.Policy) {
	policy.Name = "composio"
	h.proxy.Transport = outbound.NewTransport(http.DefaultTransport, policy)
}

// Proxy handles all /v1/composio/* methods.
func (h *Handler) Proxy(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	if h.secrets.Composio() == "" {
		httpx.Error(w, http.StatusBadGateway, "composio not configured", "provider_unconfigured")
		return
	}
	if h.client == nil {
		httpx.Error(w, http.StatusInternalServerError, "composio account mapping unavailable", "internal_error")
		return
	}
	rest := proxyRestPath(r.URL.Path)
	if !h.authorizeConnectedAccounts(w, r, u, rest) {
		return
	}
	r = r.WithContext(context.WithValue(r.Context(), proxyRestPathKey{}, rest))
	h.log.Info("composio proxy request",
		zap.String("userId", u.ID.String()),
		zap.String("method", r.Method),
		zap.String("path", rest))
	h.proxy.ServeHTTP(w, r)
}

// rewrite maps the inbound request onto the Composio v3 upstream and swaps auth.
func (h *Handler) rewrite(pr *httputil.ProxyRequest) {
	rest := proxyRestPath(pr.In.URL.Path) // e.g. /toolkits

	pr.Out.URL.Scheme = h.target.Scheme
	pr.Out.URL.Host = h.target.Host
	pr.Out.URL.Path = strings.TrimRight(h.target.Path, "/") + rest
	pr.Out.URL.RawQuery = pr.In.URL.RawQuery
	pr.Out.Host = h.target.Host

	// Auth swap: drop the user's bearer, attach the server vendor key.
	pr.Out.Header.Del("Authorization")
	pr.Out.Header.Set("x-api-key", h.secrets.Composio())

	// Tag the upstream request for Composio-side logs; local enforcement happens
	// before forwarding and again when connected-account lists return.
	if u, ok := auth.UserFromCtx(pr.In.Context()); ok {
		pr.Out.Header.Set("X-Solomon-User", u.ID.String())
	}
}

func (h *Handler) authorizeConnectedAccounts(w http.ResponseWriter, r *http.Request, u *ent.User, rest string) bool {
	accountIDs := map[string]struct{}{}
	if id := connectedAccountPathID(rest); id != "" {
		accountIDs[id] = struct{}{}
	}
	for key, values := range r.URL.Query() {
		if !isConnectedAccountReferenceKey(key) {
			continue
		}
		for _, value := range values {
			addAccountIDValue(accountIDs, value)
		}
	}
	if methodCanCarryBody(r.Method) && r.Body != nil && r.Body != http.NoBody {
		raw, ok := httpx.ReadBody(w, r, 0)
		if !ok {
			return false
		}
		restoreRequestBody(r, raw)
		if len(bytes.TrimSpace(raw)) > 0 {
			var body any
			if err := json.Unmarshal(raw, &body); err == nil {
				collectConnectedAccountRefs(accountIDs, body)
			}
		}
	}
	if len(accountIDs) == 0 {
		return true
	}
	if err := h.requireOwnedConnectedAccounts(r.Context(), u, accountIDs); err != nil {
		if errors.Is(err, errConnectedAccountNotFound) {
			httpx.Error(w, http.StatusNotFound, "connected account not found", "not_found")
			return false
		}
		h.log.Warn("composio connected-account authorization failed", zap.Error(err), zap.String("userId", u.ID.String()))
		httpx.Error(w, http.StatusBadGateway, "composio account authorization failed", "upstream_error")
		return false
	}
	return true
}

func (h *Handler) requireOwnedConnectedAccounts(ctx context.Context, u *ent.User, ids map[string]struct{}) error {
	if len(ids) == 0 {
		return nil
	}
	need := accountIDSlice(ids)
	rows, err := h.client.ComposioAccount.Query().
		Where(
			composioaccount.AccountIDIn(need...),
			composioaccount.HasUserWith(user.IDEQ(u.ID)),
		).
		All(ctx)
	if err != nil {
		return err
	}
	found := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		found[row.AccountID] = struct{}{}
	}
	for _, id := range need {
		if _, ok := found[id]; !ok {
			return errConnectedAccountNotFound
		}
	}
	return nil
}

func (h *Handler) modifyResponse(resp *http.Response) error {
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil
	}
	ctx := resp.Request.Context()
	u, ok := auth.UserFromCtx(ctx)
	if !ok {
		return nil
	}
	rest, _ := ctx.Value(proxyRestPathKey{}).(string)
	switch {
	case isConnectedAccountCreate(resp.Request.Method, rest):
		raw, err := readResponseBody(resp)
		if err != nil {
			return err
		}
		id, toolkit, ok, err := extractConnectedAccount(raw)
		if err != nil {
			return fmt.Errorf("decode composio connected account: %w", err)
		}
		if !ok {
			return errors.New("composio connected-account create response missing account id")
		}
		if err := h.mapConnectedAccount(ctx, u, id, toolkit); err != nil {
			return err
		}
		replaceResponseBody(resp, raw)
	case isConnectedAccountList(resp.Request.Method, rest):
		raw, err := readResponseBody(resp)
		if err != nil {
			return err
		}
		owned, err := h.ownedConnectedAccountIDs(ctx, u)
		if err != nil {
			return err
		}
		filtered, err := filterConnectedAccountList(raw, owned)
		if err != nil {
			return fmt.Errorf("filter composio connected accounts: %w", err)
		}
		replaceResponseBody(resp, filtered)
	case resp.Request.Method == http.MethodDelete:
		if id := connectedAccountPathID(rest); id != "" {
			if err := h.deleteConnectedAccountMapping(ctx, u, id); err != nil {
				return err
			}
		}
	}
	return nil
}

func (h *Handler) mapConnectedAccount(_ context.Context, u *ent.User, accountID, toolkit string) error {
	ctx, cancel := context.WithTimeout(auth.WithUser(context.Background(), u), 5*time.Second)
	defer cancel()
	create := h.client.ComposioAccount.Create().
		SetUserID(u.ID).
		SetAccountID(accountID)
	if toolkit != "" {
		create.SetToolkit(toolkit)
	}
	if _, err := create.Save(ctx); err != nil {
		if !ent.IsConstraintError(err) {
			return err
		}
		existing, qerr := h.client.ComposioAccount.Query().
			Where(
				composioaccount.AccountIDEQ(accountID),
				composioaccount.HasUserWith(user.IDEQ(u.ID)),
			).
			Only(ctx)
		if qerr != nil {
			if ent.IsNotFound(qerr) {
				return fmt.Errorf("composio connected account %q is already mapped to another user", accountID)
			}
			return qerr
		}
		if toolkit != "" && existing.Toolkit != toolkit {
			_, qerr = h.client.ComposioAccount.UpdateOne(existing).SetToolkit(toolkit).Save(ctx)
		}
		return qerr
	}
	return nil
}

func (h *Handler) ownedConnectedAccountIDs(ctx context.Context, u *ent.User) (map[string]struct{}, error) {
	rows, err := h.client.ComposioAccount.Query().
		Where(composioaccount.HasUserWith(user.IDEQ(u.ID))).
		All(ctx)
	if err != nil {
		return nil, err
	}
	owned := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		owned[row.AccountID] = struct{}{}
	}
	return owned, nil
}

func (h *Handler) deleteConnectedAccountMapping(_ context.Context, u *ent.User, accountID string) error {
	ctx, cancel := context.WithTimeout(auth.WithUser(context.Background(), u), 5*time.Second)
	defer cancel()
	_, err := h.client.ComposioAccount.Delete().
		Where(
			composioaccount.AccountIDEQ(accountID),
			composioaccount.HasUserWith(user.IDEQ(u.ID)),
		).
		Exec(ctx)
	return err
}

func (h *Handler) onError(w http.ResponseWriter, _ *http.Request, err error) {
	h.log.Warn("composio upstream error", zap.Error(err))
	httpx.Error(w, http.StatusBadGateway, "composio upstream failed", "upstream_error")
}

func proxyRestPath(path string) string {
	rest := strings.TrimPrefix(path, routePrefix)
	if rest == "" {
		return "/"
	}
	return rest
}

func connectedAccountPathID(rest string) string {
	segments := strings.Split(strings.Trim(rest, "/"), "/")
	if len(segments) < 2 || segments[0] != "connected_accounts" {
		return ""
	}
	id, err := url.PathUnescape(segments[1])
	if err != nil {
		return ""
	}
	return strings.TrimSpace(id)
}

func isConnectedAccountCreate(method, rest string) bool {
	return method == http.MethodPost && strings.Trim(rest, "/") == "connected_accounts"
}

func isConnectedAccountList(method, rest string) bool {
	return method == http.MethodGet && strings.Trim(rest, "/") == "connected_accounts"
}

func methodCanCarryBody(method string) bool {
	return method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch
}

func restoreRequestBody(r *http.Request, raw []byte) {
	r.Body = io.NopCloser(bytes.NewReader(raw))
	r.ContentLength = int64(len(raw))
	body := append([]byte(nil), raw...)
	r.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(body)), nil
	}
}

func readResponseBody(resp *http.Response) ([]byte, error) {
	if resp.Body == nil {
		return nil, nil
	}
	raw, err := io.ReadAll(resp.Body)
	closeErr := resp.Body.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	return raw, nil
}

func replaceResponseBody(resp *http.Response, raw []byte) {
	resp.Body = io.NopCloser(bytes.NewReader(raw))
	resp.ContentLength = int64(len(raw))
	resp.Header.Set("Content-Length", strconv.Itoa(len(raw)))
}

func accountIDSlice(ids map[string]struct{}) []string {
	out := make([]string, 0, len(ids))
	for id := range ids {
		out = append(out, id)
	}
	return out
}

func collectConnectedAccountRefs(ids map[string]struct{}, value any) {
	switch v := value.(type) {
	case map[string]any:
		for key, child := range v {
			if isConnectedAccountReferenceKey(key) {
				addAccountIDValue(ids, child)
			}
			collectConnectedAccountRefs(ids, child)
		}
	case []any:
		for _, child := range v {
			collectConnectedAccountRefs(ids, child)
		}
	}
}

func addAccountIDValue(ids map[string]struct{}, value any) {
	switch v := value.(type) {
	case string:
		for _, part := range strings.Split(v, ",") {
			if id := strings.TrimSpace(part); id != "" {
				ids[id] = struct{}{}
			}
		}
	case []any:
		for _, child := range v {
			addAccountIDValue(ids, child)
		}
	case []string:
		for _, child := range v {
			addAccountIDValue(ids, child)
		}
	}
}

func isConnectedAccountReferenceKey(key string) bool {
	normalized := strings.NewReplacer("_", "", "-", "").Replace(strings.ToLower(key))
	switch normalized {
	case "connectedaccountid", "connectedaccountids":
		return true
	default:
		return false
	}
}

func extractConnectedAccount(raw []byte) (string, string, bool, error) {
	var body any
	if err := json.Unmarshal(raw, &body); err != nil {
		return "", "", false, err
	}
	id, toolkit, ok := connectedAccountFromValue(body)
	return id, toolkit, ok, nil
}

func connectedAccountFromValue(value any) (string, string, bool) {
	switch v := value.(type) {
	case map[string]any:
		if id, ok := firstStringField(v, "id", "account_id", "connected_account_id", "connectedAccountId", "connectedAccountID"); ok {
			toolkit, _ := firstStringField(v, "toolkit", "toolkit_slug", "toolkitSlug", "appName")
			return id, toolkit, true
		}
		for _, key := range []string{"data", "item", "connected_account", "connectedAccount"} {
			if child, ok := v[key]; ok {
				if id, toolkit, ok := connectedAccountFromValue(child); ok {
					return id, toolkit, true
				}
			}
		}
	case []any:
		for _, child := range v {
			if id, toolkit, ok := connectedAccountFromValue(child); ok {
				return id, toolkit, true
			}
		}
	}
	return "", "", false
}

func filterConnectedAccountList(raw []byte, owned map[string]struct{}) ([]byte, error) {
	var body any
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, err
	}
	filtered, _, _ := filterConnectedAccountCollections(body, owned)
	return json.Marshal(filtered)
}

func filterConnectedAccountCollections(value any, owned map[string]struct{}) (any, bool, int) {
	switch v := value.(type) {
	case []any:
		filtered := filterConnectedAccountArray(v, owned)
		return filtered, true, len(filtered)
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, child := range v {
			out[key] = child
		}
		var filtered bool
		count := -1
		for key, child := range v {
			if isConnectedAccountListKey(key) {
				if arr, ok := child.([]any); ok {
					next := filterConnectedAccountArray(arr, owned)
					out[key] = next
					filtered = true
					count = len(next)
					continue
				}
			}
			next, childFiltered, childCount := filterConnectedAccountCollections(child, owned)
			if childFiltered {
				out[key] = next
				filtered = true
				if count < 0 {
					count = childCount
				}
			}
		}
		if filtered && count >= 0 {
			for _, key := range []string{"total", "total_count", "totalCount", "count"} {
				if _, ok := out[key]; ok {
					out[key] = count
				}
			}
		}
		return out, filtered, count
	default:
		return value, false, -1
	}
}

func filterConnectedAccountArray(values []any, owned map[string]struct{}) []any {
	out := make([]any, 0, len(values))
	for _, value := range values {
		id, _, ok := connectedAccountFromValue(value)
		if !ok {
			continue
		}
		if _, allowed := owned[id]; allowed {
			out = append(out, value)
		}
	}
	return out
}

func isConnectedAccountListKey(key string) bool {
	switch key {
	case "items", "data", "results", "connected_accounts", "connectedAccounts":
		return true
	default:
		return false
	}
}

func firstStringField(values map[string]any, keys ...string) (string, bool) {
	for _, key := range keys {
		if value, ok := values[key]; ok {
			if s, ok := value.(string); ok {
				if trimmed := strings.TrimSpace(s); trimmed != "" {
					return trimmed, true
				}
			}
		}
	}
	return "", false
}
