// Package connectors implements the connector registry and the OAuth brokering
// endpoints (/v1/connectors, /v1/connections/*) plus the Ory pre-consent
// webhook and the internal force-disconnect endpoint. See
// apps/rfc/012-connector-suite-and-consent-broker.md for the full protocol.
package connectors

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed default_connectors.json
var defaultConnectorsJSON []byte

// Connector is one entry in the registry the desktop reads from /v1/connectors.
type Connector struct {
	Name         string          `json:"name"`
	DisplayName  string          `json:"displayName"`
	Description  string          `json:"description"`
	MCPURL       string          `json:"mcpUrl"`
	AuthType     string          `json:"authType"` // "oauth" | "api_key"
	Audience     string          `json:"audience"` // Ory token audience (e.g. canvas-api)
	Scopes       []string        `json:"scopes,omitempty"`
	IconURL      string          `json:"iconUrl,omitempty"`
	PolicyURL    string          `json:"policyUrl,omitempty"`
	RequiredPlan string          `json:"requiredPlan,omitempty"` // "" = available on all plans
	MCPTools     []MCPToolPolicy `json:"mcpTools,omitempty"`     // explicit upstream MCP allowlist
}

// MCPToolPolicy allowlists one upstream tool exposed by a connector MCP server.
type MCPToolPolicy struct {
	Name      string `json:"name"`
	TrustTier string `json:"trustTier,omitempty"` // read | write | act | money-moving
}

// Registry is an ordered, name-indexed connector set.
type Registry struct {
	ordered []Connector
	byName  map[string]Connector
}

// DefaultRegistry returns the built-in connector set.
func DefaultRegistry() *Registry {
	list, err := parseRegistry(defaultConnectorsJSON)
	if err != nil {
		panic(fmt.Sprintf("invalid embedded connector registry: %v", err))
	}
	return newRegistry(list)
}

// LoadRegistry overlays a JSON connector list, or returns the default if empty.
func LoadRegistry(data []byte) (*Registry, error) {
	if len(bytes.TrimSpace(data)) == 0 {
		return DefaultRegistry(), nil
	}
	list, err := parseRegistry(data)
	if err != nil {
		return nil, err
	}
	return newRegistry(list), nil
}

func parseRegistry(data []byte) ([]Connector, error) {
	var list []Connector
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, err
	}
	if err := validateRegistry(list); err != nil {
		return nil, err
	}
	return list, nil
}

func validateRegistry(list []Connector) error {
	seen := map[string]struct{}{}
	for i, c := range list {
		name := strings.TrimSpace(c.Name)
		if name == "" {
			return fmt.Errorf("connector[%d].name is required", i)
		}
		if _, ok := seen[name]; ok {
			return fmt.Errorf("connector %q is duplicated", name)
		}
		seen[name] = struct{}{}
		authType := strings.TrimSpace(c.AuthType)
		if authType != "oauth" && authType != "api_key" {
			return fmt.Errorf("connector %q authType must be oauth or api_key", name)
		}
		if strings.TrimSpace(c.MCPURL) == "" {
			if len(c.MCPTools) > 0 {
				return fmt.Errorf("connector %q declares mcpTools without mcpUrl", name)
			}
			continue
		}
		if len(c.MCPTools) == 0 {
			return fmt.Errorf("connector %q has mcpUrl but no mcpTools allowlist", name)
		}
		if err := validateMCPTools(name, c.MCPTools); err != nil {
			return err
		}
	}
	return nil
}

func validateMCPTools(connector string, tools []MCPToolPolicy) error {
	seen := map[string]struct{}{}
	for i, tool := range tools {
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			return fmt.Errorf("connector %q mcpTools[%d].name is required", connector, i)
		}
		if _, ok := seen[name]; ok {
			return fmt.Errorf("connector %q declares duplicate MCP tool %q", connector, name)
		}
		seen[name] = struct{}{}
		if !validMCPTrustTier(tool.TrustTier) {
			return fmt.Errorf("connector %q MCP tool %q has invalid trustTier %q", connector, name, tool.TrustTier)
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

func newRegistry(list []Connector) *Registry {
	r := &Registry{ordered: list, byName: make(map[string]Connector, len(list))}
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
