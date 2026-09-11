package agentregistry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenue"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// SourceRetrySyncCapability queues a fresh read through an existing source connection.
func SourceRetrySyncCapability() Capability {
	tool := &sourceRetrySyncTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("source.retry_sync", "source sync retry is not configured on this server")
			}
			return &sourceRetrySyncTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

type sourceRetrySyncTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

func (t *sourceRetrySyncTool) Name() string { return "source.retry_sync" }

func (t *sourceRetrySyncTool) Description() string {
	return "Retry history sync for an existing Google, Slack, or HubSpot source connection without reconnecting or requesting OAuth consent."
}

func (t *sourceRetrySyncTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"source":{"type":"string","enum":["google","slack","hubspot"]},"sourceAccountId":{"type":"string","minLength":1,"description":"Exact account ID returned by relationship.read with view=sources."}},"required":["source","sourceAccountId"],"additionalProperties":false}`)
}

func (t *sourceRetrySyncTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "source.retry_sync"}
}

func (t *sourceRetrySyncTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("source sync retry is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("source sync retry scope does not match workflow owner")
	}
	var input struct {
		Source          string `json:"source"`
		SourceAccountID string `json:"sourceAccountId"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode source.retry_sync input: %w", err)
	}
	input.Source = strings.ToLower(strings.TrimSpace(input.Source))
	input.SourceAccountID = strings.TrimSpace(input.SourceAccountID)
	if input.Source != "google" && input.Source != "slack" && input.Source != "hubspot" {
		return nil, errors.New("source.retry_sync: source must be google, slack, or hubspot")
	}
	if input.SourceAccountID == "" {
		return nil, errors.New("source.retry_sync: sourceAccountId is required")
	}
	if input.Source == "google" {
		input.SourceAccountID = strings.ToLower(input.SourceAccountID)
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("source.retry_sync: resolve owner: %w", err)
	}
	userCtx := auth.WithUser(ctx, owner)
	statuses, err := t.service.RelationshipSourceStatuses(userCtx, owner)
	if err != nil {
		return nil, fmt.Errorf("source.retry_sync: list sources: %w", err)
	}
	var current *ent.RelationshipSourceStatus
	for _, status := range statuses {
		accountID := strings.TrimSpace(status.SourceAccountID)
		if input.Source == "google" {
			accountID = strings.ToLower(accountID)
		}
		if status.Source == input.Source && accountID == input.SourceAccountID {
			current = status
			break
		}
	}
	if current == nil {
		return nil, errors.New("source.retry_sync: source account was not found; read source health first")
	}
	if current.Status == "backfilling" || current.BackfillPhase == "queued" || current.BackfillPhase == "running" {
		return sourceRetrySyncResult(current, true)
	}
	queued, err := t.service.BeginSourceBackfill(userCtx, owner, input.Source, input.SourceAccountID)
	if err != nil {
		return nil, fmt.Errorf("source.retry_sync: %w", err)
	}
	return sourceRetrySyncResult(queued, false)
}

func sourceRetrySyncResult(status *ent.RelationshipSourceStatus, alreadyQueued bool) (json.RawMessage, error) {
	return json.Marshal(map[string]any{
		"source": status.Source, "sourceAccountId": status.SourceAccountID,
		"status": status.Status, "backfillPhase": status.BackfillPhase,
		"completeness": status.Completeness, "alreadyQueued": alreadyQueued,
		"note": "Source sync queued through the existing connection; no reconnect or OAuth consent was started.",
	})
}
