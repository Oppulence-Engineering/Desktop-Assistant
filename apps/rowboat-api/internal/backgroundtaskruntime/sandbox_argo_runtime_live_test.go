package backgroundtaskruntime

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestDefaultRuntimeDispatchesSandboxRunToArgoLive(t *testing.T) {
	exec, image := newLiveArgoSandboxExecutor(t, 300)

	runID := "runtime-argo-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	script := "sleep 5; echo rowboat-runtime-argo-dispatch"
	workflowName := exec.kube.jobName(SandboxRun{
		UserID: "u1", TaskSlug: "argo-runtime", RunID: runID, ToolCallIndex: 1,
		Image: image, Script: script,
	})
	t.Logf("expected Argo workflow: %s", workflowName)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = exec.deleteWorkflow(ctx, workflowName)
	})

	args := fmt.Sprintf(`{"script":%q,"image":%q,"timeoutSeconds":180}`, script, image)
	llm := newFakeLLM(
		toolCallTurn("sandbox-call-1", sandboxToolName, args),
		assistantTurn("sandbox result observed"),
	)
	tool := NewSandboxRunTool(exec, SandboxToolConfig{
		DefaultImage:   image,
		AllowedImages:  []string{image},
		DefaultTimeout: 3 * time.Minute,
		MaxTimeout:     4 * time.Minute,
		MaxScriptBytes: 4096,
		MaxOutputBytes: 4096,
	})
	in := baseInput(llm, &fakeArtifactStore{}, &fakeEventSink{}, tool)
	in.Slug = "argo-runtime"
	in.RunID = runID
	in.Limits.MaxDuration = 4 * time.Minute

	out, err := NewDefault().Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("runtime execute: %v", err)
	}
	if out.ToolCalls != 1 || out.LLMCalls != 2 {
		t.Fatalf("runtime output = %+v, want one sandbox tool call and two llm calls", out)
	}

	status, err := exec.getWorkflowStatus(context.Background(), workflowName)
	if err != nil {
		t.Fatalf("read dispatched workflow %s: %v", workflowName, err)
	}
	if status.Phase != "complete" {
		t.Fatalf("workflow status = %+v, want complete", status)
	}
	lastRequest := llm.requests[len(llm.requests)-1]
	foundToolResult := false
	for _, msg := range lastRequest {
		if msg.Role == "tool" && strings.Contains(msg.Content, "rowboat-runtime-argo-dispatch") {
			foundToolResult = true
		}
	}
	if !foundToolResult {
		t.Fatalf("sandbox result did not return through runtime transcript: %+v", lastRequest)
	}
}
