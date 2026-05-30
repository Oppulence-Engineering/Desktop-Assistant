// Package connectors implements the connector registry and the OAuth brokering
// endpoints (/v1/connectors, /v1/connections/*) plus the Ory pre-consent
// webhook and the internal force-disconnect endpoint. See CONNECTOR_SUITE.md
// for the full protocol.
package connectors

import "encoding/json"

// Connector is one entry in the registry the desktop reads from /v1/connectors.
type Connector struct {
	Name         string   `json:"name"`
	DisplayName  string   `json:"displayName"`
	Description  string   `json:"description"`
	MCPURL       string   `json:"mcpUrl"`
	AuthType     string   `json:"authType"` // "oauth" | "api_key"
	Audience     string   `json:"audience"` // Ory token audience (e.g. canvas-api)
	Scopes       []string `json:"scopes,omitempty"`
	IconURL      string   `json:"iconUrl,omitempty"`
	PolicyURL    string   `json:"policyUrl,omitempty"`
	RequiredPlan string   `json:"requiredPlan,omitempty"` // "" = available on all plans
}

// Registry is an ordered, name-indexed connector set.
type Registry struct {
	ordered []Connector
	byName  map[string]Connector
}

// DefaultRegistry returns the built-in connector set.
func DefaultRegistry() *Registry {
	return newRegistry([]Connector{
		{
			Name:        "canvas",
			DisplayName: "Canvas",
			Description: "Banking, invoicing, dunning, transactions",
			MCPURL:      "https://api.canvas.solomon-ai.co/v1/mcp",
			AuthType:    "oauth",
			Audience:    "canvas-api",
			Scopes:      []string{"invoices:read", "customers:read", "transactions:read"},
		},
		{
			Name:        "corinthian",
			DisplayName: "Corinthian",
			Description: "Accounts receivable, collections, communications",
			MCPURL:      "https://mcp.corinthian.solomon-ai.co/mcp",
			AuthType:    "oauth",
			Audience:    "corinthian-api",
			Scopes:      []string{"ar:read", "collections:read"},
		},
		{
			Name:        "wispr",
			DisplayName: "Wispr Flow",
			Description: "AI dictation transcripts",
			MCPURL:      "https://mcp.wispr.solomon-ai.co/mcp",
			AuthType:    "api_key",
			Audience:    "wispr-api",
		},
	})
}

// LoadRegistry overlays a JSON connector list, or returns the default if empty.
func LoadRegistry(data []byte) (*Registry, error) {
	if len(data) == 0 {
		return DefaultRegistry(), nil
	}
	var list []Connector
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, err
	}
	return newRegistry(list), nil
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
