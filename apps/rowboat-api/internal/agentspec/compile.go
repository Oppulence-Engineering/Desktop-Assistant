package agentspec

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

// Compiled is the neutral canonical form a Document lowers to. It maps 1:1 onto
// the RFC 027 AgentDefinition fields; agentregistry turns it into the runtime
// Spec + ent row. Field order here defines the canonical JSON used for hashing.
type Compiled struct {
	Slug          string          `json:"slug"`
	Name          string          `json:"name"`
	Model         string          `json:"model,omitempty"`
	Provider      string          `json:"provider,omitempty"`
	Instructions  string          `json:"instructions,omitempty"`
	Tools         []ToolConfig    `json:"tools,omitempty"`
	EnabledTools  []string        `json:"enabledTools,omitempty"`
	Subagents     []string        `json:"subagents,omitempty"`
	ConnectorReqs []string        `json:"connectorReqs,omitempty"`
	Channels      []string        `json:"channels,omitempty"`
	Triggers      []TriggerConfig `json:"triggers,omitempty"`
	Limits        LimitsConfig    `json:"limits"`
}

// ToolConfig is the canonical per-tool config.
type ToolConfig struct {
	Name             string `json:"name"`
	Kind             string `json:"kind,omitempty"`
	ManifestRef      string `json:"manifestRef,omitempty"`
	RequiresApproval bool   `json:"requiresApproval,omitempty"`
}

// TriggerConfig is the canonical trigger.
type TriggerConfig struct {
	Schedule string `json:"schedule,omitempty"`
}

// LimitsConfig are the canonical per-agent limit overrides (0 = inherit).
type LimitsConfig struct {
	MaxTurns        int     `json:"maxTurns,omitempty"`
	MaxLLMCalls     int     `json:"maxLLMCalls,omitempty"`
	MaxToolCalls    int     `json:"maxToolCalls,omitempty"`
	SpendCeilingUsd float64 `json:"spendCeilingUsd,omitempty"`
}

// EnvelopeError reports a structural problem with the document envelope.
type EnvelopeError struct{ Message string }

func (e *EnvelopeError) Error() string { return e.Message }

// Compile lowers a decoded Document into the canonical Compiled form. The
// envelope (apiVersion/kind/slug) is checked here. resolvedInstructions is used
// when the document referenced an external instructionsFile (the caller — CLI
// or embedded loader — reads the file); inline spec.instructions wins when set.
func Compile(doc *Document, resolvedInstructions string) (Compiled, error) {
	if doc.APIVersion != APIVersion {
		return Compiled{}, &EnvelopeError{Message: fmt.Sprintf("unsupported apiVersion %q (want %q)", doc.APIVersion, APIVersion)}
	}
	if doc.Kind != Kind {
		return Compiled{}, &EnvelopeError{Message: fmt.Sprintf("unsupported kind %q (want %q)", doc.Kind, Kind)}
	}
	if strings.TrimSpace(doc.Metadata.Slug) == "" {
		return Compiled{}, &EnvelopeError{Message: "metadata.slug is required"}
	}
	if strings.TrimSpace(doc.Metadata.Name) == "" {
		return Compiled{}, &EnvelopeError{Message: "metadata.name is required"}
	}

	instructions := doc.Spec.Instructions
	if strings.TrimSpace(instructions) == "" {
		instructions = resolvedInstructions
	}

	out := Compiled{
		Slug:         doc.Metadata.Slug,
		Name:         doc.Metadata.Name,
		Model:        doc.Spec.Model,
		Provider:     doc.Spec.Provider,
		Instructions: strings.TrimSpace(instructions),
		Subagents:    append([]string(nil), doc.Spec.Subagents...),
		Channels:     append([]string(nil), doc.Spec.Channels...),
	}
	for _, t := range doc.Spec.Tools {
		out.Tools = append(out.Tools, ToolConfig(t))
		out.EnabledTools = append(out.EnabledTools, t.Name)
	}
	for _, c := range doc.Spec.Connections {
		out.ConnectorReqs = append(out.ConnectorReqs, c.Scope)
	}
	for _, tr := range doc.Spec.Triggers {
		out.Triggers = append(out.Triggers, TriggerConfig(tr))
	}
	if doc.Spec.Limits != nil {
		out.Limits = LimitsConfig{
			MaxTurns: doc.Spec.Limits.MaxTurns, MaxLLMCalls: doc.Spec.Limits.MaxLLMCalls,
			MaxToolCalls: doc.Spec.Limits.MaxToolCalls, SpendCeilingUsd: doc.Spec.Limits.SpendCeilingUsd,
		}
	}
	return out, nil
}

// CanonicalJSON renders the compiled spec deterministically (json.Marshal sorts
// map keys; struct field order is fixed), so the hash is stable across runs.
func CanonicalJSON(c Compiled) ([]byte, error) { return json.Marshal(c) }

// ContentHash is the sha256 of the canonical JSON — the idempotency key for
// apply (an unchanged hash is a no-op; a change bumps the revision).
func ContentHash(c Compiled) (string, error) {
	b, err := CanonicalJSON(c)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}
