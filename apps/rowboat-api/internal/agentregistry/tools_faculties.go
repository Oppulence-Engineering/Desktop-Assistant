package agentregistry

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/faculties"
)

// Portfolio faculty capabilities (RFC 008). The cloud agent reaches each faculty
// as a runtime tool that forwards the model's request to the faculty's HTTP API
// on behalf of the session owner. Conduit (evidence) is read-only; Eigen
// simulates (read-only foresight — money-moving stays the separate Act seam).
// When a faculty is not configured, Build returns a tool reporting it unavailable.

// ConduitReadCapability queries the Conduit evidence plane (read-only).
func ConduitReadCapability() Capability {
	return Capability{
		Name:        "conduit.read",
		Description: "Query the Conduit evidence plane (read-only): correspondence threads, disputes, and follow-ups bound to invoices/records. Provide an operation and its params.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"operation":{"type":"string","description":"e.g. thread_for_invoice, disputes_open, followups_due"},"params":{"type":"object"}},"required":["operation"]}`),
		TrustTier:   TierRead,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			if d.Conduit == nil {
				return newUnavailableTool("conduit.read", "Conduit is not configured on this server")
			}
			return guardOwnerScopedToolInSlack(d, &facultyTool{
				name:        "conduit.read",
				description: "Query the Conduit evidence plane (read-only).",
				schema:      json.RawMessage(`{"type":"object","properties":{"operation":{"type":"string"},"params":{"type":"object"}},"required":["operation"]}`),
				client:      d.Conduit,
				path:        "/v1/query",
			})
		},
	}
}

// EigenSimulateCapability runs a forward simulation via Eigen (read-only).
func EigenSimulateCapability() Capability {
	return Capability{
		Name:        "eigen.simulate",
		Description: "Run a forward financial simulation via Eigen (read-only foresight): runway, liquidity, covenant, or AR/AP sensitivity. Provide a scenario and its params. Eigen simulates only — it never moves money.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"scenario":{"type":"string","description":"e.g. runway, liquidity, covenant, ar_sensitivity"},"params":{"type":"object"}},"required":["scenario"]}`),
		TrustTier:   TierRead,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			if d.Eigen == nil {
				return newUnavailableTool("eigen.simulate", "Eigen is not configured on this server")
			}
			return guardOwnerScopedToolInSlack(d, &facultyTool{
				name:        "eigen.simulate",
				description: "Run a forward financial simulation via Eigen (read-only).",
				schema:      json.RawMessage(`{"type":"object","properties":{"scenario":{"type":"string"},"params":{"type":"object"}},"required":["scenario"]}`),
				client:      d.Eigen,
				path:        "/v1/simulate",
			})
		},
	}
}

// facultyTool forwards the model's arguments to a faculty endpoint on behalf of
// the session owner and returns the faculty's JSON response.
type facultyTool struct {
	name        string
	description string
	schema      json.RawMessage
	client      *faculties.Client
	path        string
}

func (t *facultyTool) Name() string                { return t.name }
func (t *facultyTool) Description() string         { return t.description }
func (t *facultyTool) JSONSchema() json.RawMessage { return t.schema }
func (t *facultyTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	connector := t.name
	operation := t.path
	if before, after, ok := strings.Cut(t.name, "."); ok {
		connector = before
		operation = after
	}
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierRead, Connector: connector, Operation: operation}
}
func (t *facultyTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var body map[string]any
	if len(args) > 0 {
		if err := json.Unmarshal(args, &body); err != nil {
			return nil, fmt.Errorf("invalid %s arguments: %w", t.name, err)
		}
	}
	out, err := t.client.Call(ctx, scope.UserID, t.path, body)
	if err != nil {
		b, _ := json.Marshal(map[string]string{"error": err.Error()})
		return b, nil
	}
	return out, nil
}
