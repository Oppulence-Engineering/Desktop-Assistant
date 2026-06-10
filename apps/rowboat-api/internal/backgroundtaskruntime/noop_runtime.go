package backgroundtaskruntime

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// NoopRuntime reproduces the pre-RFC-004 deterministic artifact behavior
// byte-for-byte: no LLM, no tools — a static markdown document derived from
// the task's name/instructions/trigger. It is the instant rollback path
// (CLOUD_RUNTIME_ENABLED=false) and needs zero dependencies.
type NoopRuntime struct {
	now func() time.Time
}

// NewNoop builds the deterministic runtime.
func NewNoop() *NoopRuntime { return &NoopRuntime{now: time.Now} }

// SetClock overrides the artifact timestamp source (tests only).
func (r *NoopRuntime) SetClock(clock func() time.Time) {
	if clock != nil {
		r.now = clock
	}
}

// Execute mirrors the original ExecuteAPITask body exactly: progress 50 with
// a temporal.progress event, one artifact write, then progress 90 paired with
// a temporal.artifact_updated event.
func (r *NoopRuntime) Execute(ctx context.Context, in RunInput) (RunOutput, error) {
	if err := in.Events.ProgressEvent(ctx, eventProgress, 50, "Building API-native task artifact.", nil); err != nil {
		return RunOutput{}, err
	}

	summary := buildStaticSummary(in)
	artifact := buildStaticArtifact(in, summary, r.now().UTC())
	if _, err := in.Artifacts.Write(ctx, artifact, "text/markdown"); err != nil {
		return RunOutput{}, err
	}

	if err := in.Events.ProgressEvent(ctx, eventArtifactUpdated, 90, "Artifact updated.", nil); err != nil {
		return RunOutput{}, err
	}
	return RunOutput{Summary: summary, ArtifactBytes: len(artifact)}, nil
}

// buildStaticSummary/buildStaticArtifact/truncate are verbatim ports of the
// workflow package's buildSummary/buildArtifact/truncate (the originals are
// deleted when ExecuteAPITask delegates here).

func buildStaticSummary(in RunInput) string {
	base := fmt.Sprintf("API worker completed %s via %s trigger.", in.TaskName, in.Trigger)
	if in.RequestedContext != "" {
		return base + " Context: " + truncate(in.RequestedContext, 180)
	}
	return base
}

func buildStaticArtifact(in RunInput, summary string, ts time.Time) string {
	var b strings.Builder
	b.WriteString("# ")
	b.WriteString(in.TaskName)
	b.WriteString("\n\n")
	b.WriteString(summary)
	b.WriteString("\n\n")
	b.WriteString("## Execution\n\n")
	b.WriteString("- Executor: api\n")
	b.WriteString("- Trigger: ")
	b.WriteString(in.Trigger)
	b.WriteString("\n- Completed at: ")
	b.WriteString(ts.UTC().Format(time.RFC3339))
	b.WriteString("\n\n")
	b.WriteString("## Instructions\n\n")
	b.WriteString(in.Instructions)
	if in.RequestedContext != "" {
		b.WriteString("\n\n## Requested Context\n\n")
		b.WriteString(in.RequestedContext)
	}
	b.WriteString("\n")
	return b.String()
}

func truncate(s string, maxLen int) string {
	s = strings.TrimSpace(s)
	if len(s) <= maxLen {
		return s
	}
	// Back the cut up to the nearest rune boundary so we never split a multi-byte
	// UTF-8 sequence into invalid bytes (which JSON-encoding would mangle to U+FFFD).
	end := maxLen
	for end > 0 && !utf8.RuneStart(s[end]) {
		end--
	}
	return s[:end] + "..."
}
