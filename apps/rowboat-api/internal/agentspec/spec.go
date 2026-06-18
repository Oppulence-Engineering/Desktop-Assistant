// Package agentspec is the versioned declarative authoring format for agents
// (RFC 028): the `apiVersion: agent.rowboat.dev/v1, kind: Agent` document, a
// strict YAML→JSON decoder, and the compile step that lowers a document into a
// neutral canonical form. It is a leaf package (no dependency on the runtime or
// the capability registry) so the same decode+compile runs in the server, the
// GitOps reconciler, and — via the published JSON Schema — the offline CLI.
//
// YAML is a SOURCE FORMAT only: it compiles into the same AgentDefinition the
// JSON API and embedded built-ins use (RFC 028 "one canonical shape, three
// front doors"). It never carries executable code.
package agentspec

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	ghodss "github.com/ghodss/yaml"
	yamlv3 "gopkg.in/yaml.v3"
)

// APIVersion / Kind identify a v1 agent document.
const (
	APIVersion = "agent.rowboat.dev/v1"
	Kind       = "Agent"
)

// Tool kinds. The empty kind is a code-backed tool (a Go activity in the
// Layer-1 registry); openapi/mcp are declarative tools (RFC 020), trust-gated.
const (
	ToolKindCode    = ""
	ToolKindOpenAPI = "openapi"
	ToolKindMCP     = "mcp"
)

// Document is a parsed agent YAML/JSON file.
type Document struct {
	APIVersion string   `json:"apiVersion"`
	Kind       string   `json:"kind"`
	Metadata   Metadata `json:"metadata"`
	Spec       Spec     `json:"spec"`
}

// Metadata carries identity.
type Metadata struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

// Spec is the agent composition (mirrors the canonical AgentDefinition fields).
type Spec struct {
	Model            string       `json:"model,omitempty"`
	Provider         string       `json:"provider,omitempty"`
	Instructions     string       `json:"instructions,omitempty"`
	InstructionsFile string       `json:"instructionsFile,omitempty"`
	Limits           *Limits      `json:"limits,omitempty"`
	Tools            []Tool       `json:"tools,omitempty"`
	Connections      []Connection `json:"connections,omitempty"`
	Subagents        []string     `json:"subagents,omitempty"`
	Channels         []string     `json:"channels,omitempty"`
	Triggers         []Trigger    `json:"triggers,omitempty"`
}

// Limits are per-agent budget overrides (clamped to tenant caps at validate).
type Limits struct {
	MaxTurns        int     `json:"maxTurns,omitempty"`
	MaxLLMCalls     int     `json:"maxLLMCalls,omitempty"`
	MaxToolCalls    int     `json:"maxToolCalls,omitempty"`
	SpendCeilingUsd float64 `json:"spendCeilingUsd,omitempty"`
}

// Tool is a tool reference. In YAML it may be a bare string (the tool name) or
// an object with per-tool config; UnmarshalJSON accepts both.
type Tool struct {
	Name             string `json:"name"`
	Kind             string `json:"kind,omitempty"`
	ManifestRef      string `json:"manifestRef,omitempty"`
	RequiresApproval bool   `json:"requiresApproval,omitempty"`
}

// UnmarshalJSON accepts either "tool.name" or {name, kind, manifestRef,
// requiresApproval}, rejecting unknown fields on the object form.
func (t *Tool) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		t.Name = s
		return nil
	}
	type alias Tool
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	var a alias
	if err := dec.Decode(&a); err != nil {
		return fmt.Errorf("tool: %w", err)
	}
	if a.Name == "" {
		return errors.New("tool object requires a 'name'")
	}
	*t = Tool(a)
	return nil
}

// Connection declares a capability the agent needs — a scope, never a credential.
type Connection struct {
	Scope string `json:"scope"`
}

// Trigger compiles to an RFC 005 Temporal Schedule.
type Trigger struct {
	Schedule string `json:"schedule,omitempty"`
}

// Decode parses an agent document from YAML or JSON with strict semantics:
// duplicate mapping keys are rejected (a YAML footgun), unknown fields are
// rejected, and exactly one document is required. The same function accepts the
// API's JSON body (JSON is valid YAML), so one path validates both formats.
func Decode(raw []byte) (*Document, error) {
	if err := checkNoDuplicateKeys(raw); err != nil {
		return nil, err
	}
	j, err := ghodss.YAMLToJSON(raw)
	if err != nil {
		return nil, fmt.Errorf("agentspec: parse: %w", err)
	}
	dec := json.NewDecoder(bytes.NewReader(j))
	dec.DisallowUnknownFields()
	var doc Document
	if err := dec.Decode(&doc); err != nil {
		return nil, fmt.Errorf("agentspec: decode: %w", err)
	}
	if dec.More() {
		return nil, errors.New("agentspec: expected a single document")
	}
	return &doc, nil
}

// checkNoDuplicateKeys rejects duplicate mapping keys (ghodss/yaml's yaml.v2
// path silently keeps the last). Decoding into interface{} triggers yaml.v3's
// duplicate-key detection ("mapping key already defined") at any nesting level.
func checkNoDuplicateKeys(raw []byte) error {
	dec := yamlv3.NewDecoder(bytes.NewReader(raw))
	for {
		var v interface{}
		err := dec.Decode(&v)
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("agentspec: %w", err)
		}
	}
}
