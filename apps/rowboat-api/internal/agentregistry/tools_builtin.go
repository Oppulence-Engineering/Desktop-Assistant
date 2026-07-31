package agentregistry

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
)

// DefaultCatalog is the production capability set. It is intentionally small and
// safe: every tool here is either read-only or, for the approval-eligible demo
// capability, a no-op that moves nothing. Credential-bearing connector tools
// (RFC 012) and richer skills (RFC 021) register here as they land. Shell /
// model-generated-code execution is a Non-Goal (RFC 027 sandbox/*, deferred).
func DefaultCatalog() *Catalog {
	return NewCatalog(
		currentTimeCapability(),
		echoCapability(),
		demoPaymentCapability(),
		toolResultReadCapability(),
		SubagentDelegateCapability(),
		SlackReadThreadCapability(),
		SlackPostMessageCapability(),
		GmailReadCapability(),
		CalendarReadCapability(),
		DriveReadCapability(),
		GmailDraftCapability(),
		GmailSendCapability(),
		CalendarCreateCapability(),
		CalendarUpdateCapability(),
		DriveUpdateCapability(),
		HubSpotSearchCapability(),
		HubSpotNoteCapability(),
		HubSpotTaskCapability(),
		WebSearchCapability(),
		ConduitReadCapability(),
		EigenSimulateCapability(),
	)
}

// currentTimeCapability returns the current UTC time. Read-only, no deps.
func currentTimeCapability() Capability {
	return Capability{
		Name:        "current_time",
		Description: "Return the current date and time in UTC (RFC 3339).",
		Parameters:  json.RawMessage(`{"type":"object","properties":{}}`),
		TrustTier:   TierRead,
		Kind:        KindTool,
		Build:       func(ToolDeps) backgroundtaskruntime.Tool { return &currentTimeTool{} },
	}
}

type currentTimeTool struct{}

func (t *currentTimeTool) Name() string { return "current_time" }
func (t *currentTimeTool) Description() string {
	return "Return the current date and time in UTC (RFC 3339)."
}
func (t *currentTimeTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{}}`)
}
func (t *currentTimeTool) Invoke(_ context.Context, _ backgroundtaskruntime.ToolScope, _ json.RawMessage) (json.RawMessage, error) {
	return json.Marshal(map[string]any{"now": time.Now().UTC().Format(time.RFC3339)})
}

// echoCapability echoes its text argument. Read-only, deterministic, no deps —
// the minimal end-to-end tool for the P1 single-turn gate and tests.
func echoCapability() Capability {
	return Capability{
		Name:        "echo",
		Description: "Echo the provided text back. Useful for testing tool wiring.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}`),
		TrustTier:   TierRead,
		Kind:        KindTool,
		Build:       func(ToolDeps) backgroundtaskruntime.Tool { return &echoTool{} },
	}
}

type echoTool struct{}

func (t *echoTool) Name() string        { return "echo" }
func (t *echoTool) Description() string { return "Echo the provided text back." }
func (t *echoTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}`)
}
func (t *echoTool) Invoke(_ context.Context, _ backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Text string `json:"text"`
	}
	if len(args) > 0 {
		if err := json.Unmarshal(args, &in); err != nil {
			return nil, fmt.Errorf("invalid echo arguments: %w", err)
		}
	}
	return json.Marshal(map[string]any{"text": in.Text})
}

// demoPaymentCapability is a money-moving tool that MOVES NOTHING — it returns a
// simulated receipt. It exists so the HITL approval path (RFC 027 P3) can be
// exercised end-to-end by configuration alone (add it to an agent's allowlist),
// without shipping a tool that can actually move funds. Real money-moving
// connectors register here with the same tier once RFC 012 broker wiring lands.
func demoPaymentCapability() Capability {
	return Capability{
		Name:        "demo.payment",
		Description: "Simulate sending a payment (demo: moves no real funds). Requires human approval.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"amount":{"type":"number"},"currency":{"type":"string"},"recipient":{"type":"string"}},"required":["amount","recipient"]}`),
		TrustTier:   TierMoneyMoving,
		Kind:        KindTool,
		Build:       func(ToolDeps) backgroundtaskruntime.Tool { return &demoPaymentTool{} },
	}
}

type demoPaymentTool struct{}

func (t *demoPaymentTool) Name() string { return "demo.payment" }
func (t *demoPaymentTool) Description() string {
	return "Simulate sending a payment (demo: moves no real funds)."
}
func (t *demoPaymentTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"amount":{"type":"number"},"currency":{"type":"string"},"recipient":{"type":"string"}},"required":["amount","recipient"]}`)
}
func (t *demoPaymentTool) Invoke(_ context.Context, _ backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Amount    float64 `json:"amount"`
		Currency  string  `json:"currency"`
		Recipient string  `json:"recipient"`
	}
	if len(args) > 0 {
		if err := json.Unmarshal(args, &in); err != nil {
			return nil, fmt.Errorf("invalid payment arguments: %w", err)
		}
	}
	if in.Currency == "" {
		in.Currency = "USD"
	}
	return json.Marshal(map[string]any{
		"status":    "executed_demo",
		"moved":     false,
		"amount":    in.Amount,
		"currency":  in.Currency,
		"recipient": in.Recipient,
		"note":      "demo capability: no real funds were moved",
	})
}

// SubagentDelegateCapability is the pseudo-tool the model calls to delegate a
// subtask to a subagent (RFC 027 §subagents). It has no Build: the loop branches
// on Kind==KindSubagent and dispatches to a child workflow rather than a tool
// activity. Advertised to the model only when subagents are enabled and the
// agent declares subagent_refs.
func SubagentDelegateCapability() Capability {
	return Capability{
		Name:        "subagent.delegate",
		Description: "Delegate a self-contained subtask to a named subagent with an isolated context. Returns a compact summary.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"agent":{"type":"string","description":"slug of the subagent to delegate to"},"task":{"type":"string","description":"the self-contained instruction for the subagent"}},"required":["agent","task"]}`),
		TrustTier:   TierWrite,
		Kind:        KindSubagent,
	}
}
