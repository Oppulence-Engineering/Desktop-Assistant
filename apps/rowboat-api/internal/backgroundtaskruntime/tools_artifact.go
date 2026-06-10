package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"fmt"
)

// stagedArtifact gives the loop read-your-writes semantics over the task
// artifact while deferring the single durable Write to successful loop end
// (preserve-on-failure, RFC §8): a failed run never partially overwrites the
// prior artifact.
type stagedArtifact struct {
	store       ArtifactStore
	staged      string
	contentType string
	hasStaged   bool
}

func newStagedArtifact(store ArtifactStore) *stagedArtifact {
	return &stagedArtifact{store: store, contentType: "text/markdown"}
}

// read returns the staged body when present, else the persisted one.
func (s *stagedArtifact) read(ctx context.Context) (body, contentType string, err error) {
	if s.hasStaged {
		return s.staged, s.contentType, nil
	}
	body, contentType, _, err = s.store.Read(ctx)
	return body, contentType, err
}

// stage records the next artifact body in memory.
func (s *stagedArtifact) stage(body, contentType string) {
	s.staged = body
	if contentType != "" {
		s.contentType = contentType
	}
	s.hasStaged = true
}

// flush performs the run's single durable write. Size is enforced here too
// (terminal) in case content bypassed the tool's stage-time check.
func (s *stagedArtifact) flush(ctx context.Context, maxBytes int) (bytes int, err error) {
	if !s.hasStaged {
		return 0, nil
	}
	if len(s.staged) > maxBytes {
		return 0, limitError(CodeRuntimeArtifactTooLarge, "artifact_bytes", len(s.staged), maxBytes)
	}
	if _, err := s.store.Write(ctx, s.staged, s.contentType); err != nil {
		return 0, err
	}
	return len(s.staged), nil
}

// artifactReadTool exposes the task's current artifact to the model.
type artifactReadTool struct{ staged *stagedArtifact }

func (t *artifactReadTool) Name() string { return "artifact.read" }
func (t *artifactReadTool) Description() string {
	return "Read the task's current artifact (index.md)."
}
func (t *artifactReadTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{}}`)
}

func (t *artifactReadTool) Invoke(ctx context.Context, _ ToolScope, _ json.RawMessage) (json.RawMessage, error) {
	body, contentType, err := t.staged.read(ctx)
	if err != nil {
		return nil, fmt.Errorf("read artifact: %w", err)
	}
	return json.Marshal(map[string]string{"body": body, "contentType": contentType})
}

// artifactWriteTool stages the next artifact body. The stage-time size check
// is a TOOL error (the model can shorten and retry); the terminal check
// happens at flush.
type artifactWriteTool struct {
	staged   *stagedArtifact
	maxBytes int
}

func (t *artifactWriteTool) Name() string { return "artifact.write" }
func (t *artifactWriteTool) Description() string {
	return "Replace the task's artifact (index.md). Provide the full new body; it is written once at the end of a successful run."
}

func (t *artifactWriteTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"body":{"type":"string","description":"Full artifact body (markdown)."},"contentType":{"type":"string","description":"Optional content type; defaults to text/markdown."}},"required":["body"]}`)
}

func (t *artifactWriteTool) Invoke(_ context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Body        string `json:"body"`
		ContentType string `json:"contentType"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if in.Body == "" {
		return nil, fmt.Errorf("body is required")
	}
	if len(in.Body) > t.maxBytes {
		return nil, fmt.Errorf("artifact body is %d bytes; the limit is %d — shorten it", len(in.Body), t.maxBytes)
	}
	t.staged.stage(in.Body, in.ContentType)
	return json.Marshal(map[string]any{"staged": true, "bytes": len(in.Body)})
}
