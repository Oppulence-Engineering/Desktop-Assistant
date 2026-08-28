// Package connectors implements the connector registry and the OAuth brokering
// endpoints (/v1/connectors, /v1/connections/*) plus the Ory pre-consent
// webhook and the internal force-disconnect endpoint. See
// apps/rfc/012-connector-suite-and-consent-broker.md for the full protocol.
package connectors

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
)

//go:embed default_connectors.json
var defaultConnectorsJSON []byte

// Connector is one entry in the registry the desktop reads from /v1/connectors.
type Connector struct {
	Name                             string                     `json:"name"`
	DisplayName                      string                     `json:"displayName"`
	Description                      string                     `json:"description"`
	MCPURL                           string                     `json:"mcpUrl"`
	MCPURLs                          map[string]string          `json:"mcpUrls,omitempty"`
	Transport                        string                     `json:"transport,omitempty"` // mcp (default) | native
	AuthType                         string                     `json:"authType"`            // "oauth" | "api_key"
	Audience                         string                     `json:"audience"`            // Ory token audience (e.g. canvas-api)
	Audiences                        map[string]string          `json:"audiences,omitempty"`
	Scopes                           []string                   `json:"-"` // derived canonical scope names
	ScopeCatalog                     []ScopeDefinition          `json:"scopes,omitempty"`
	IconURL                          string                     `json:"iconUrl,omitempty"`
	PolicyURL                        string                     `json:"policyUrl,omitempty"`
	EntitlementURL                   string                     `json:"entitlementUrl,omitempty"` // product-authoritative entitlement decision endpoint
	AuthoritativeEntitlementRequired bool                       `json:"authoritativeEntitlementRequired,omitempty"`
	RequiredPlan                     string                     `json:"requiredPlan,omitempty"`   // "" = available on all plans
	Status                           string                     `json:"status,omitempty"`         // enabled | maintenance | disabled
	Health                           string                     `json:"health,omitempty"`         // healthy | degraded | unavailable
	Environments                     []string                   `json:"environments,omitempty"`   // development | staging | production
	MCPTools                         []MCPToolPolicy            `json:"mcpTools,omitempty"`       // explicit upstream MCP allowlist
	NativeTools                      []MCPToolPolicy            `json:"nativeTools,omitempty"`    // server-side SDK capability allowlist
	TemplateBlocks                   []IntegrationTemplateBlock `json:"templateBlocks,omitempty"` // onboarding capability blocks
	ProductionApproval               *ProductionProductApproval `json:"productionApproval,omitempty"`
	entitlementKey                   []byte
	allowPrivateEntitlement          bool
}

// ProductionProductApproval is deployment evidence binding an explicit product
// approval to the exact production endpoint, audience, and high-impact policy.
// It is stripped from the public connector response after boot validation.
type ProductionProductApproval struct {
	Decision       string   `json:"decision"`
	EvidenceID     string   `json:"evidenceId"`
	Approver       string   `json:"approver"`
	ApprovedAt     string   `json:"approvedAt"`
	PolicyHash     string   `json:"policyHash"`
	ApprovedScopes []string `json:"approvedScopes"`
}

// ProductEntitlementOptions controls the sole permitted local fallback. It is
// intentionally explicit and accepted only in development.
type ProductEntitlementOptions struct {
	AllowLocalDevelopment bool
}

// ScopeDefinition is the canonical consent and minting policy for one scope.
// The same structured record is returned by the connector list and consent
// context endpoints so clients never invent risk or consent copy.
type ScopeDefinition struct {
	Name                  string   `json:"name"`
	DisplayName           string   `json:"displayName"`
	Description           string   `json:"description"`
	GrantTier             string   `json:"grantTier"` // required | optional
	Risk                  string   `json:"risk"`      // low | medium | high | money-moving
	Implies               []string `json:"implies,omitempty"`
	ConflictsWith         []string `json:"conflictsWith,omitempty"`
	StepUpRequired        bool     `json:"stepUpRequired,omitempty"`
	PerInvocationApproval bool     `json:"perInvocationApproval,omitempty"`
	RequiredPlan          string   `json:"requiredPlan,omitempty"`
	Environments          []string `json:"environments,omitempty"`
}

// ConfigureProductEntitlements applies deployment-owned product endpoints and
// product-scoped signing keys without putting secrets in the public connector
// catalog. Production and staging fail boot when an enabled connector is only
// partially configured.
func (r *Registry) ConfigureProductEntitlements(urls, keys map[string]string) error {
	return r.ConfigureProductEntitlementsWithOptions(urls, keys, ProductEntitlementOptions{})
}

// ConfigureProductEntitlementsWithOptions applies deployment-owned product
// endpoints and enforces authoritative entitlement metadata.
func (r *Registry) ConfigureProductEntitlementsWithOptions(urls, keys map[string]string, options ProductEntitlementOptions) error {
	if options.AllowLocalDevelopment && r.environment != "development" {
		return fmt.Errorf("local entitlement override is development-only")
	}
	for name := range urls {
		if _, ok := r.byName[name]; !ok {
			return fmt.Errorf("entitlement URL configured for unknown connector %q", name)
		}
	}
	for name := range keys {
		if _, ok := r.byName[name]; !ok {
			return fmt.Errorf("entitlement signing key configured for unknown connector %q", name)
		}
	}
	for i := range r.ordered {
		c := r.ordered[i]
		rawURL := strings.TrimSpace(urls[c.Name])
		key := strings.TrimSpace(keys[c.Name])
		if rawURL == "" && key == "" {
			continue
		}
		if rawURL == "" || len(key) < 32 {
			return fmt.Errorf("connector %q entitlement configuration requires an URL and a signing key of at least 32 bytes", c.Name)
		}
		u, err := url.Parse(rawURL)
		if err != nil || u.Scheme == "" || u.Host == "" || u.User != nil || u.Fragment != "" || u.RawQuery != "" || (u.Scheme != "https" && (r.environment != "development" || u.Scheme != "http")) {
			return fmt.Errorf("connector %q entitlement URL must be an absolute HTTPS URL without credentials, query, or fragment (HTTP is development-only)", c.Name)
		}
		c.EntitlementURL = u.String()
		c.entitlementKey = []byte(key)
		c.allowPrivateEntitlement = r.environment == "development"
		r.ordered[i] = c
		r.byName[c.Name] = c
	}
	for _, c := range r.ordered {
		if !c.AuthoritativeEntitlementRequired || c.Status != "enabled" || !slices.Contains(c.Environments, r.environment) {
			continue
		}
		if _, disabled := r.disabled[c.Name]; disabled {
			continue
		}
		if c.EntitlementURL == "" || len(c.entitlementKey) < 32 {
			if r.environment == "development" && options.AllowLocalDevelopment {
				continue
			}
			return fmt.Errorf("connector %q requires authoritative product entitlement URL and signing key in %s", c.Name, r.environment)
		}
	}
	return nil
}

// ConfigureProductEntitlementsJSON strictly parses the non-secret URL map and
// secret signing-key map before applying them atomically to the registry.
func (r *Registry) ConfigureProductEntitlementsJSON(rawURLs, rawKeys string) error {
	return r.ConfigureProductEntitlementsJSONWithOptions(rawURLs, rawKeys, ProductEntitlementOptions{})
}

// ConfigureProductEntitlementsJSONWithOptions strictly parses configuration
// and applies the explicit development-only local fallback option.
func (r *Registry) ConfigureProductEntitlementsJSONWithOptions(rawURLs, rawKeys string, options ProductEntitlementOptions) error {
	decode := func(raw string) (map[string]string, error) {
		if strings.TrimSpace(raw) == "" {
			return nil, nil
		}
		var values map[string]string
		dec := json.NewDecoder(strings.NewReader(raw))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&values); err != nil {
			return nil, err
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			return nil, fmt.Errorf("must contain exactly one JSON object")
		}
		return values, nil
	}
	urls, err := decode(rawURLs)
	if err != nil {
		return fmt.Errorf("parse entitlement URLs: %w", err)
	}
	keys, err := decode(rawKeys)
	if err != nil {
		return fmt.Errorf("parse entitlement signing keys: %w", err)
	}
	return r.ConfigureProductEntitlementsWithOptions(urls, keys, options)
}

// MCPToolPolicy allowlists one upstream tool exposed by a connector MCP server.
type MCPToolPolicy struct {
	Name           string   `json:"name"`
	TrustTier      string   `json:"trustTier,omitempty"` // read | write | act | money-moving
	RequiredScopes []string `json:"requiredScopes,omitempty"`
}

// IntegrationTemplateBlock is the user-facing onboarding block shown for a
// connector before or during connection. It describes capabilities; it is not a
// workflow execution node.
type IntegrationTemplateBlock struct {
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	Description    string   `json:"description"`
	Category       string   `json:"category"`
	RequiredScopes []string `json:"requiredScopes,omitempty"`
	MCPTools       []string `json:"mcpTools,omitempty"`
	NativeTools    []string `json:"nativeTools,omitempty"`
	TrustTier      string   `json:"trustTier"`
	SamplePrompt   string   `json:"samplePrompt,omitempty"`
}

// Registry is an ordered, name-indexed connector set.
type Registry struct {
	ordered     []Connector
	byName      map[string]Connector
	environment string
	disabled    map[string]struct{}
}

// DefaultRegistry returns the built-in connector set.
func DefaultRegistry() *Registry {
	list, err := parseRegistry(defaultConnectorsJSON, "development")
	if err != nil {
		panic(fmt.Sprintf("invalid embedded connector registry: %v", err))
	}
	return newRegistry(list, "development", nil)
}

// LoadRegistry overlays a JSON connector list, or returns the default if empty.
func LoadRegistry(data []byte) (*Registry, error) {
	return LoadRegistryForEnvironment(data, "development", nil)
}

// LoadRegistryForEnvironment validates the complete catalog, applies the
// selected environment, and records an operator emergency-disable allowlist.
// Unknown disable entries fail boot instead of silently leaving a connector on.
func LoadRegistryForEnvironment(data []byte, environment string, disabled []string) (*Registry, error) {
	environment = normalizeEnvironment(environment)
	if len(bytes.TrimSpace(data)) == 0 {
		data = defaultConnectorsJSON
	}
	list, err := parseRegistry(data, environment)
	if err != nil {
		return nil, err
	}
	disabledSet := make(map[string]struct{}, len(disabled))
	known := make(map[string]struct{}, len(list))
	for _, c := range list {
		known[c.Name] = struct{}{}
	}
	for _, raw := range disabled {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		if _, ok := known[name]; !ok {
			return nil, fmt.Errorf("emergency-disabled connector %q is not in the registry", name)
		}
		disabledSet[name] = struct{}{}
	}
	return newRegistry(list, environment, disabledSet), nil
}

func parseRegistry(data []byte, environment string) ([]Connector, error) {
	var list []Connector
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&list); err != nil {
		return nil, err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return nil, fmt.Errorf("connector registry must contain exactly one JSON value")
	}
	if len(list) == 0 {
		return nil, fmt.Errorf("connector registry must not be empty")
	}
	for i := range list {
		if strings.TrimSpace(list[i].Transport) == "" {
			list[i].Transport = "mcp"
		}
		if strings.TrimSpace(list[i].Status) == "" {
			list[i].Status = "enabled"
		}
		if strings.TrimSpace(list[i].Health) == "" {
			list[i].Health = "healthy"
		}
		if raw := strings.TrimSpace(list[i].EntitlementURL); raw != "" {
			u, err := url.Parse(raw)
			if err != nil || u.Scheme == "" || u.Host == "" || u.User != nil || u.Fragment != "" || (u.Scheme != "https" && (environment != "development" || u.Scheme != "http")) {
				return nil, fmt.Errorf("connector %q entitlementUrl must be an absolute HTTPS URL (HTTP is development-only)", list[i].Name)
			}
			list[i].EntitlementURL = u.String()
		}
		if len(list[i].Environments) == 0 {
			list[i].Environments = []string{"development", "staging", "production"}
		}
		for j := range list[i].ScopeCatalog {
			if len(list[i].ScopeCatalog[j].Environments) == 0 {
				list[i].ScopeCatalog[j].Environments = append([]string(nil), list[i].Environments...)
			}
		}
		if err := resolveEnvironmentBindings(&list[i], environment); err != nil {
			return nil, err
		}
	}
	if err := validateRegistry(list, environment); err != nil {
		return nil, err
	}
	for i := range list {
		list[i].Scopes = scopeNames(availableScopeDefinitions(list[i], environment))
		// Approval evidence is a deployment control, not public product metadata.
		list[i].ProductionApproval = nil
	}
	return list, nil
}

var connectorNamePattern = regexp.MustCompile(`^[a-z][a-z0-9_-]*$`)
var scopeNamePattern = regexp.MustCompile(`^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$`)

func resolveEnvironmentBindings(c *Connector, environment string) error {
	hasExplicitBindings := len(c.MCPURLs) > 0 || len(c.Audiences) > 0
	if !hasExplicitBindings {
		if environment != "development" {
			return fmt.Errorf("connector %q requires explicit environment-specific audiences and mcpUrls outside development", c.Name)
		}
		return nil
	}
	if strings.TrimSpace(c.MCPURL) != "" || strings.TrimSpace(c.Audience) != "" {
		return fmt.Errorf("connector %q cannot mix legacy mcpUrl/audience fields with environment-specific bindings", c.Name)
	}
	if err := validateEnvironmentBindingKeys(c.Name, "audiences", c.Audiences); err != nil {
		return err
	}
	if err := validateEnvironmentBindingKeys(c.Name, "mcpUrls", c.MCPURLs); err != nil {
		return err
	}

	transport := strings.TrimSpace(c.Transport)
	for _, env := range c.Environments {
		if strings.TrimSpace(c.Audiences[env]) == "" {
			return fmt.Errorf("connector %q audiences.%s is required", c.Name, env)
		}
		if transport == "native" {
			if strings.TrimSpace(c.MCPURLs[env]) != "" {
				return fmt.Errorf("connector %q native transport cannot declare mcpUrls.%s", c.Name, env)
			}
			continue
		}
		if len(c.MCPTools) == 0 && len(c.TemplateBlocks) == 0 && strings.TrimSpace(c.MCPURLs[env]) == "" {
			continue
		}
		normalized, err := validateEnvironmentMCPURL(c.Name, env, c.MCPURLs[env])
		if err != nil {
			return err
		}
		c.MCPURLs[env] = normalized
	}

	productionAudience, hasProductionAudience := c.Audiences["production"]
	stagingAudience, hasStagingAudience := c.Audiences["staging"]
	if hasProductionAudience && hasStagingAudience && strings.TrimSpace(productionAudience) == strings.TrimSpace(stagingAudience) {
		return fmt.Errorf("connector %q production and staging audiences must be distinct", c.Name)
	}
	productionURL, hasProductionURL := c.MCPURLs["production"]
	stagingURL, hasStagingURL := c.MCPURLs["staging"]
	if transport == "mcp" && hasProductionURL && hasStagingURL && strings.TrimSpace(productionURL) != "" && strings.TrimSpace(stagingURL) != "" {
		production, _ := url.Parse(productionURL)
		staging, _ := url.Parse(stagingURL)
		if strings.EqualFold(production.Hostname(), staging.Hostname()) {
			return fmt.Errorf("connector %q production and staging mcpUrl hosts must be distinct", c.Name)
		}
	}

	c.Audience = strings.TrimSpace(c.Audiences[environment])
	c.MCPURL = strings.TrimSpace(c.MCPURLs[environment])
	if c.Audience == "" {
		return fmt.Errorf("connector %q has no audience binding for environment %q", c.Name, environment)
	}
	c.Audiences = nil
	c.MCPURLs = nil
	return nil
}

func validateEnvironmentBindingKeys(connector, field string, bindings map[string]string) error {
	for environment := range bindings {
		if !slices.Contains([]string{"development", "staging", "production"}, environment) {
			return fmt.Errorf("connector %q %s has invalid environment %q", connector, field, environment)
		}
	}
	return nil
}

func validateEnvironmentMCPURL(connector, environment, raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return "", fmt.Errorf("connector %q mcpUrls.%s must be an absolute HTTPS URL without userinfo or fragment", connector, environment)
	}
	stagingQualified := isStagingQualifiedHost(u.Hostname())
	if environment == "staging" && !stagingQualified {
		return "", fmt.Errorf("connector %q staging mcpUrl host %q must be staging-qualified", connector, u.Hostname())
	}
	if environment == "production" && stagingQualified {
		return "", fmt.Errorf("connector %q production mcpUrl host %q must not be staging-qualified", connector, u.Hostname())
	}
	return u.String(), nil
}

func isStagingQualifiedHost(host string) bool {
	for _, label := range strings.Split(strings.ToLower(strings.TrimSuffix(host, ".")), ".") {
		if label == "staging" {
			return true
		}
	}
	return false
}

func validateRegistry(list []Connector, environment string) error {
	seen := map[string]struct{}{}
	audiences := map[string]string{}
	for i, c := range list {
		name := strings.TrimSpace(c.Name)
		if name == "" {
			return fmt.Errorf("connector[%d].name is required", i)
		}
		if _, ok := seen[name]; ok {
			return fmt.Errorf("connector %q is duplicated", name)
		}
		seen[name] = struct{}{}
		if !connectorNamePattern.MatchString(name) {
			return fmt.Errorf("connector %q name must match %s", name, connectorNamePattern)
		}
		if strings.TrimSpace(c.DisplayName) == "" {
			return fmt.Errorf("connector %q displayName is required", name)
		}
		audience := strings.TrimSpace(c.Audience)
		if audience == "" {
			return fmt.Errorf("connector %q audience is required", name)
		}
		if previous, ok := audiences[audience]; ok {
			return fmt.Errorf("connector %q duplicates audience %q from connector %q", name, audience, previous)
		}
		audiences[audience] = name
		if !validConnectorStatus(c.Status) {
			return fmt.Errorf("connector %q has invalid status %q", name, c.Status)
		}
		if !validConnectorHealth(c.Health) {
			return fmt.Errorf("connector %q has invalid health %q", name, c.Health)
		}
		if err := validateEnvironments("connector "+name, c.Environments); err != nil {
			return err
		}
		if err := validateScopeCatalog(c); err != nil {
			return err
		}
		if err := validateProductionApproval(c, environment); err != nil {
			return err
		}
		authType := strings.TrimSpace(c.AuthType)
		if authType != "oauth" && authType != "api_key" {
			return fmt.Errorf("connector %q authType must be oauth or api_key", name)
		}
		transport := strings.TrimSpace(c.Transport)
		if transport != "mcp" && transport != "native" {
			return fmt.Errorf("connector %q transport must be mcp or native", name)
		}
		if transport == "native" {
			if strings.TrimSpace(c.MCPURL) != "" || len(c.MCPTools) > 0 {
				return fmt.Errorf("connector %q native transport cannot declare mcpUrl or mcpTools", name)
			}
			if len(c.NativeTools) == 0 {
				return fmt.Errorf("connector %q native transport requires nativeTools", name)
			}
			if err := validateToolPolicies(c, "native", c.NativeTools); err != nil {
				return err
			}
			if err := validateTemplateBlocks(c, c.NativeTools); err != nil {
				return err
			}
			continue
		}
		if len(c.NativeTools) > 0 {
			return fmt.Errorf("connector %q mcp transport cannot declare nativeTools", name)
		}
		if strings.TrimSpace(c.MCPURL) == "" {
			if len(c.MCPTools) > 0 {
				return fmt.Errorf("connector %q declares mcpTools without mcpUrl", name)
			}
			if len(c.TemplateBlocks) > 0 {
				return fmt.Errorf("connector %q declares templateBlocks without mcpUrl", name)
			}
			continue
		}
		u, err := url.Parse(strings.TrimSpace(c.MCPURL))
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
			return fmt.Errorf("connector %q mcpUrl must be an absolute HTTPS URL without userinfo or fragment", name)
		}
		if len(c.MCPTools) == 0 {
			return fmt.Errorf("connector %q has mcpUrl but no mcpTools allowlist", name)
		}
		if err := validateToolPolicies(c, "MCP", c.MCPTools); err != nil {
			return err
		}
		if err := validateTemplateBlocks(c, c.MCPTools); err != nil {
			return err
		}
	}
	return nil
}

type productionApprovalScope struct {
	Name                  string `json:"name"`
	Risk                  string `json:"risk"`
	GrantTier             string `json:"grantTier"`
	StepUpRequired        bool   `json:"stepUpRequired"`
	PerInvocationApproval bool   `json:"perInvocationApproval"`
}

type productionApprovalTool struct {
	Name           string   `json:"name"`
	TrustTier      string   `json:"trustTier"`
	RequiredScopes []string `json:"requiredScopes"`
}

type productionApprovalPolicy struct {
	Version   int                       `json:"version"`
	Connector string                    `json:"connector"`
	Transport string                    `json:"transport"`
	Audience  string                    `json:"audience"`
	MCPURL    string                    `json:"mcpUrl"`
	Scopes    []productionApprovalScope `json:"scopes"`
	Tools     []productionApprovalTool  `json:"tools"`
}

func validateProductionApproval(c Connector, environment string) error {
	if environment != "production" || c.Status == "disabled" {
		return nil
	}
	highImpact := highImpactScopeNames(c, environment)
	if len(highImpact) == 0 {
		if c.ProductionApproval != nil {
			return fmt.Errorf("connector %q productionApproval must be absent when no production high-impact scope is enabled", c.Name)
		}
		return nil
	}
	approval := c.ProductionApproval
	if approval == nil {
		return fmt.Errorf("connector %q production high-impact scopes %v require productionApproval evidence", c.Name, highImpact)
	}
	if approval.Decision != "approved" {
		return fmt.Errorf("connector %q productionApproval.decision must be approved", c.Name)
	}
	if strings.TrimSpace(approval.EvidenceID) == "" || len(approval.EvidenceID) > 256 {
		return fmt.Errorf("connector %q productionApproval.evidenceId is required and must be at most 256 characters", c.Name)
	}
	if strings.TrimSpace(approval.Approver) == "" || len(approval.Approver) > 256 {
		return fmt.Errorf("connector %q productionApproval.approver is required and must be at most 256 characters", c.Name)
	}
	if _, err := time.Parse(time.RFC3339, approval.ApprovedAt); err != nil {
		return fmt.Errorf("connector %q productionApproval.approvedAt must be RFC3339: %w", c.Name, err)
	}
	approvedScopes := append([]string(nil), approval.ApprovedScopes...)
	slices.Sort(approvedScopes)
	if !slices.Equal(approvedScopes, highImpact) {
		return fmt.Errorf("connector %q productionApproval.approvedScopes %v must exactly match enabled high-impact scopes %v", c.Name, approvedScopes, highImpact)
	}
	wantHash, err := productionApprovalPolicyHash(c)
	if err != nil {
		return fmt.Errorf("connector %q production approval policy: %w", c.Name, err)
	}
	if approval.PolicyHash != wantHash {
		return fmt.Errorf("connector %q productionApproval.policyHash %q does not match current production policy %q", c.Name, approval.PolicyHash, wantHash)
	}
	return nil
}

func highImpactScopeNames(c Connector, environment string) []string {
	var names []string
	for _, scope := range availableScopeDefinitions(c, environment) {
		if scope.Risk == "high" || scope.Risk == "money-moving" {
			names = append(names, scope.Name)
		}
	}
	slices.Sort(names)
	return names
}

func productionApprovalPolicyHash(c Connector) (string, error) {
	highImpactNames := highImpactScopeNames(c, "production")
	highImpact := make(map[string]struct{}, len(highImpactNames))
	for _, name := range highImpactNames {
		highImpact[name] = struct{}{}
	}

	policy := productionApprovalPolicy{
		Version: 1, Connector: c.Name, Transport: c.Transport, Audience: c.Audience, MCPURL: c.MCPURL,
		Scopes: make([]productionApprovalScope, 0), Tools: make([]productionApprovalTool, 0),
	}
	for _, scope := range availableScopeDefinitions(c, "production") {
		if _, ok := highImpact[scope.Name]; !ok {
			continue
		}
		policy.Scopes = append(policy.Scopes, productionApprovalScope{
			Name: scope.Name, Risk: scope.Risk, GrantTier: scope.GrantTier,
			StepUpRequired: scope.StepUpRequired, PerInvocationApproval: scope.PerInvocationApproval,
		})
	}
	slices.SortFunc(policy.Scopes, func(a, b productionApprovalScope) int { return strings.Compare(a.Name, b.Name) })
	tools := c.MCPTools
	if c.Transport == "native" {
		tools = c.NativeTools
	}
	for _, tool := range tools {
		include := tool.TrustTier == "act" || tool.TrustTier == "money-moving"
		for _, scope := range tool.RequiredScopes {
			_, includeScope := highImpact[scope]
			include = include || includeScope
		}
		if !include {
			continue
		}
		requiredScopes := append([]string(nil), tool.RequiredScopes...)
		slices.Sort(requiredScopes)
		policy.Tools = append(policy.Tools, productionApprovalTool{Name: tool.Name, TrustTier: tool.TrustTier, RequiredScopes: requiredScopes})
	}
	slices.SortFunc(policy.Tools, func(a, b productionApprovalTool) int { return strings.Compare(a.Name, b.Name) })
	raw, err := json.Marshal(policy)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func validateScopeCatalog(c Connector) error {
	seen := make(map[string]ScopeDefinition, len(c.ScopeCatalog))
	for i, scope := range c.ScopeCatalog {
		name := strings.TrimSpace(scope.Name)
		if !scopeNamePattern.MatchString(name) || !strings.HasPrefix(name, c.Name+":") {
			return fmt.Errorf("connector %q scopes[%d].name %q must be namespaced as %s:resource.action", c.Name, i, name, c.Name)
		}
		if _, ok := seen[name]; ok {
			return fmt.Errorf("connector %q declares duplicate scope %q", c.Name, name)
		}
		if strings.TrimSpace(scope.DisplayName) == "" || strings.TrimSpace(scope.Description) == "" {
			return fmt.Errorf("connector %q scope %q displayName and description are required", c.Name, name)
		}
		if scope.GrantTier != "required" && scope.GrantTier != "optional" {
			return fmt.Errorf("connector %q scope %q grantTier must be required or optional", c.Name, name)
		}
		if !slices.Contains([]string{"low", "medium", "high", "money-moving"}, scope.Risk) {
			return fmt.Errorf("connector %q scope %q has invalid risk %q", c.Name, name, scope.Risk)
		}
		if scope.Risk == "money-moving" && (!scope.StepUpRequired || !scope.PerInvocationApproval) {
			return fmt.Errorf("connector %q money-moving scope %q requires stepUpRequired and perInvocationApproval", c.Name, name)
		}
		if scope.PerInvocationApproval && scope.Risk != "money-moving" {
			return fmt.Errorf("connector %q scope %q may require per-invocation approval only for money-moving risk", c.Name, name)
		}
		if err := validateEnvironments("connector "+c.Name+" scope "+name, scope.Environments); err != nil {
			return err
		}
		seen[name] = scope
	}
	for name, scope := range seen {
		for _, implied := range scope.Implies {
			if implied == name {
				return fmt.Errorf("connector %q scope %q cannot imply itself", c.Name, name)
			}
			if _, ok := seen[implied]; !ok {
				return fmt.Errorf("connector %q scope %q implies unknown scope %q", c.Name, name, implied)
			}
		}
		for _, conflict := range scope.ConflictsWith {
			other, ok := seen[conflict]
			if !ok || conflict == name {
				return fmt.Errorf("connector %q scope %q conflicts with invalid scope %q", c.Name, name, conflict)
			}
			if !slices.Contains(other.ConflictsWith, name) {
				return fmt.Errorf("connector %q scope conflict %q <-> %q must be symmetric", c.Name, name, conflict)
			}
			if scope.GrantTier == "required" && other.GrantTier == "required" {
				return fmt.Errorf("connector %q required scopes %q and %q conflict", c.Name, name, conflict)
			}
		}
	}
	return nil
}

func validateEnvironments(subject string, environments []string) error {
	if len(environments) == 0 {
		return fmt.Errorf("%s environments must not be empty", subject)
	}
	seen := map[string]struct{}{}
	for _, environment := range environments {
		if !slices.Contains([]string{"development", "staging", "production"}, environment) {
			return fmt.Errorf("%s has invalid environment %q", subject, environment)
		}
		if _, ok := seen[environment]; ok {
			return fmt.Errorf("%s duplicates environment %q", subject, environment)
		}
		seen[environment] = struct{}{}
	}
	return nil
}

func validConnectorStatus(status string) bool {
	return slices.Contains([]string{"enabled", "maintenance", "disabled"}, status)
}

func validConnectorHealth(health string) bool {
	return slices.Contains([]string{"healthy", "degraded", "unavailable"}, health)
}

func normalizeEnvironment(environment string) string {
	switch strings.ToLower(strings.TrimSpace(environment)) {
	case "prod", "production":
		return "production"
	case "stage", "staging":
		return "staging"
	default:
		return "development"
	}
}

func availableScopeDefinitions(c Connector, environment string) []ScopeDefinition {
	result := make([]ScopeDefinition, 0, len(c.ScopeCatalog))
	for _, scope := range c.ScopeCatalog {
		if slices.Contains(scope.Environments, environment) {
			result = append(result, scope)
		}
	}
	return result
}

func scopeNames(scopes []ScopeDefinition) []string {
	names := make([]string, 0, len(scopes))
	for _, scope := range scopes {
		names = append(names, scope.Name)
	}
	return names
}

func validateToolPolicies(connector Connector, transport string, tools []MCPToolPolicy) error {
	seen := map[string]struct{}{}
	scopes := make(map[string]ScopeDefinition, len(connector.ScopeCatalog))
	for _, scope := range connector.ScopeCatalog {
		scopes[scope.Name] = scope
	}
	for i, tool := range tools {
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			return fmt.Errorf("connector %q %sTools[%d].name is required", connector.Name, strings.ToLower(transport), i)
		}
		if _, ok := seen[name]; ok {
			return fmt.Errorf("connector %q declares duplicate %s tool %q", connector.Name, transport, name)
		}
		seen[name] = struct{}{}
		if !validMCPTrustTier(tool.TrustTier) {
			return fmt.Errorf("connector %q MCP tool %q has invalid trustTier %q", connector.Name, name, tool.TrustTier)
		}
		moneyScope := false
		for _, scopeName := range tool.RequiredScopes {
			scope, ok := scopes[scopeName]
			if !ok {
				return fmt.Errorf("connector %q MCP tool %q references unknown scope %q", connector.Name, name, scopeName)
			}
			moneyScope = moneyScope || scope.Risk == "money-moving"
		}
		if tool.TrustTier == "money-moving" && !moneyScope {
			return fmt.Errorf("connector %q money-moving MCP tool %q must map to an explicit money-moving scope", connector.Name, name)
		}
		if tool.TrustTier != "money-moving" && moneyScope {
			return fmt.Errorf("connector %q MCP tool %q maps to a money-moving scope but has trustTier %q", connector.Name, name, tool.TrustTier)
		}
	}
	return nil
}

func validMCPTrustTier(tier string) bool {
	switch strings.TrimSpace(tier) {
	case "read", "write", "act", "money-moving":
		return true
	default:
		return false
	}
}

func validateTemplateBlocks(c Connector, policies []MCPToolPolicy) error {
	seen := map[string]struct{}{}
	scopes := map[string]struct{}{}
	for _, scope := range c.ScopeCatalog {
		scopes[scope.Name] = struct{}{}
	}
	tools := map[string]struct{}{}
	for _, tool := range policies {
		tools[tool.Name] = struct{}{}
	}
	for i, block := range c.TemplateBlocks {
		id := strings.TrimSpace(block.ID)
		if id == "" {
			return fmt.Errorf("connector %q templateBlocks[%d].id is required", c.Name, i)
		}
		if _, ok := seen[id]; ok {
			return fmt.Errorf("connector %q declares duplicate template block %q", c.Name, id)
		}
		seen[id] = struct{}{}
		if strings.TrimSpace(block.Title) == "" {
			return fmt.Errorf("connector %q template block %q title is required", c.Name, id)
		}
		if strings.TrimSpace(block.Description) == "" {
			return fmt.Errorf("connector %q template block %q description is required", c.Name, id)
		}
		if strings.TrimSpace(block.Category) == "" {
			return fmt.Errorf("connector %q template block %q category is required", c.Name, id)
		}
		if !validMCPTrustTier(block.TrustTier) {
			return fmt.Errorf("connector %q template block %q has invalid trustTier %q", c.Name, id, block.TrustTier)
		}
		for _, scope := range block.RequiredScopes {
			if _, ok := scopes[scope]; !ok {
				return fmt.Errorf("connector %q template block %q references unknown scope %q", c.Name, id, scope)
			}
		}
		blockTools := block.MCPTools
		label := "MCP tool"
		if c.Transport == "native" {
			if len(block.MCPTools) > 0 {
				return fmt.Errorf("connector %q native template block %q cannot declare mcpTools", c.Name, id)
			}
			blockTools = block.NativeTools
			label = "native tool"
		} else if len(block.NativeTools) > 0 {
			return fmt.Errorf("connector %q MCP template block %q cannot declare nativeTools", c.Name, id)
		}
		for _, tool := range blockTools {
			if _, ok := tools[tool]; !ok {
				return fmt.Errorf("connector %q template block %q references unknown %s %q", c.Name, id, label, tool)
			}
		}
	}
	return nil
}

func newRegistry(list []Connector, environment string, disabled map[string]struct{}) *Registry {
	r := &Registry{ordered: list, byName: make(map[string]Connector, len(list)), environment: environment, disabled: disabled}
	for _, c := range list {
		r.byName[c.Name] = c
	}
	return r
}

// List returns the connectors in registry order.
func (r *Registry) List() []Connector { return r.ordered }

// Get returns a connector by name.
func (r *Registry) Get(name string) (Connector, bool) {
	c, ok := r.byName[name]
	return c, ok
}

// AvailableScopes returns the structured catalog available in this process environment.
func (r *Registry) AvailableScopes(name string) []ScopeDefinition {
	c, ok := r.Get(name)
	if !ok {
		return nil
	}
	return availableScopeDefinitions(c, r.environment)
}

// EffectiveStatus applies the emergency-disable switch without mutating the catalog.
func (r *Registry) EffectiveStatus(name string) string {
	c, ok := r.Get(name)
	if !ok {
		return "disabled"
	}
	if _, disabled := r.disabled[name]; disabled {
		return "disabled"
	}
	return c.Status
}

// Enabled reports whether new grants and token mints are permitted.
func (r *Registry) Enabled(name string) bool { return r.EffectiveStatus(name) == "enabled" }
