package agentregistry

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsession"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/google/uuid"
)

const slackOwnerScopedToolDenied = "owner-scoped connector tools are not available from Slack channel sessions until the Slack requester is linked to a Rowboat user"

type channelGuardedTool struct {
	deps  ToolDeps
	inner backgroundtaskruntime.Tool
}

func guardOwnerScopedToolInSlack(deps ToolDeps, inner backgroundtaskruntime.Tool) backgroundtaskruntime.Tool {
	return &channelGuardedTool{deps: deps, inner: inner}
}

func (t *channelGuardedTool) Name() string                { return t.inner.Name() }
func (t *channelGuardedTool) Description() string         { return t.inner.Description() }
func (t *channelGuardedTool) JSONSchema() json.RawMessage { return t.inner.JSONSchema() }

func (t *channelGuardedTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	blocked, err := isSlackSession(ctx, t.deps.Client, scope)
	if err != nil {
		return json.Marshal(map[string]string{"error": "could not verify the agent session channel"})
	}
	if blocked {
		return json.Marshal(map[string]string{"error": slackOwnerScopedToolDenied})
	}
	return t.inner.Invoke(ctx, scope, args)
}

func isSlackSession(ctx context.Context, client *ent.Client, scope backgroundtaskruntime.ToolScope) (bool, error) {
	if client == nil || scope.RunID == "" || scope.UserID == "" {
		return false, nil
	}
	uid, err := uuid.Parse(scope.UserID)
	if err != nil {
		return false, fmt.Errorf("invalid user id: %w", err)
	}
	sess, err := client.AgentSession.Query().
		Where(
			agentsession.SessionIDEQ(scope.RunID),
			agentsession.HasUserWith(user.IDEQ(uid)),
		).
		Only(auth.WithInternal(ctx))
	if err != nil {
		if ent.IsNotFound(err) {
			return false, nil
		}
		return false, err
	}
	return sess.Channel == "slack", nil
}
