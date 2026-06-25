package agentregistry

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agenttoolresultblob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/google/uuid"
)

// toolResultReadWindow bounds one claim-check read so a large blob cannot
// re-flood the transcript / Temporal history in a single call.
const toolResultReadWindow = 16 << 10 // 16 KiB

// toolResultReadCapability lets the model page through a large tool result that
// was claim-checked to the blob store (RFC 027): a truncated result carries a
// blobRef the model passes here to read more.
func toolResultReadCapability() Capability {
	return Capability{
		Name:        "tool_result.read",
		Description: "Read a window of a large tool result that was stored by reference. Pass the blobRef from a truncated result, plus an optional byte offset.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"blobRef":{"type":"string"},"offset":{"type":"integer"},"limit":{"type":"integer"}},"required":["blobRef"]}`),
		TrustTier:   TierRead,
		Kind:        KindTool,
		Build:       func(d ToolDeps) backgroundtaskruntime.Tool { return &toolResultReadTool{client: d.Client} },
	}
}

type toolResultReadTool struct{ client *ent.Client }

func (t *toolResultReadTool) Name() string { return "tool_result.read" }
func (t *toolResultReadTool) Description() string {
	return "Read a window of a large tool result stored by reference."
}
func (t *toolResultReadTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"blobRef":{"type":"string"},"offset":{"type":"integer"},"limit":{"type":"integer"}},"required":["blobRef"]}`)
}

func (t *toolResultReadTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t.client == nil {
		return nil, fmt.Errorf("tool_result.read is not available")
	}
	var in struct {
		BlobRef string `json:"blobRef"`
		Offset  int    `json:"offset"`
		Limit   int    `json:"limit"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	sid, turnSeq, callIndex, err := parseBlobRef(in.BlobRef)
	if err != nil {
		return nil, err
	}
	uid, err := uuid.Parse(scope.UserID)
	if err != nil {
		return nil, fmt.Errorf("invalid scope")
	}
	// Tenant-scoped explicitly: the activity runs under an internal context, so
	// the interceptor is bypassed — bind to the session owner here.
	blob, err := t.client.AgentToolResultBlob.Query().
		Where(
			agenttoolresultblob.SessionIDEQ(sid),
			agenttoolresultblob.TurnSeqEQ(turnSeq),
			agenttoolresultblob.CallIndexEQ(callIndex),
			agenttoolresultblob.HasUserWith(user.IDEQ(uid)),
		).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, fmt.Errorf("no stored result for %q", in.BlobRef)
		}
		return nil, fmt.Errorf("load tool result: %w", err)
	}

	limit := in.Limit
	if limit <= 0 || limit > toolResultReadWindow {
		limit = toolResultReadWindow
	}
	content := blob.Content
	offset := in.Offset
	if offset < 0 {
		offset = 0
	}
	if offset > len(content) {
		offset = len(content)
	}
	end := offset + limit
	if end > len(content) {
		end = len(content)
	}
	return json.Marshal(map[string]any{
		"content":    content[offset:end],
		"offset":     offset,
		"nextOffset": end,
		"totalBytes": blob.TotalBytes,
		"hasMore":    end < len(content),
	})
}

// parseBlobRef splits "sessionID/turnSeq/callIndex".
func parseBlobRef(ref string) (sid string, turnSeq, callIndex int, err error) {
	parts := strings.Split(ref, "/")
	if len(parts) != 3 {
		return "", 0, 0, fmt.Errorf("malformed blobRef %q", ref)
	}
	turnSeq, err = strconv.Atoi(parts[1])
	if err != nil {
		return "", 0, 0, fmt.Errorf("malformed blobRef %q", ref)
	}
	callIndex, err = strconv.Atoi(parts[2])
	if err != nil {
		return "", 0, 0, fmt.Errorf("malformed blobRef %q", ref)
	}
	return parts[0], turnSeq, callIndex, nil
}

// BlobRef is the deterministic claim-check reference for a tool result.
func BlobRef(sessionID string, turnSeq, callIndex int) string {
	return fmt.Sprintf("%s/%d/%d", sessionID, turnSeq, callIndex)
}
