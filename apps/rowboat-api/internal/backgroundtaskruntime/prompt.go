package backgroundtaskruntime

import (
	"fmt"
	"strings"
)

// PromptVersion tags every runtime LLM-call event so prompt revisions can be
// correlated with quality/cost changes.
const PromptVersion = "cloud-runtime-v1"

// artifactSnapshotCap bounds the artifact context in the initial user turn.
const artifactSnapshotCap = 32 << 10 // 32 KiB

// buildSystemPrompt is the versioned RFC 004 skeleton. It is product behavior
// and cost control — change it only with a PromptVersion bump.
func buildSystemPrompt(in RunInput) string {
	var b strings.Builder
	b.WriteString("You are executing a Rowboat background task in the cloud.\n\n")
	fmt.Fprintf(&b, "Task:\n- slug: %s\n- name: %s\n- trigger: %s\n", in.Slug, in.TaskName, in.Trigger)
	if in.RequestedContext != "" {
		fmt.Fprintf(&b, "- requested context: %s\n", in.RequestedContext)
	}
	b.WriteString("\nInstructions:\n")
	b.WriteString(in.Instructions)
	b.WriteString("\n\nRules:\n")
	b.WriteString("- Use only the tools provided in this request.\n")
	b.WriteString("- Do not ask the user questions.\n")
	b.WriteString("- Produce one final artifact (via artifact.write) and finish with a short summary message.\n")
	b.WriteString("- Keep the artifact grounded in tool results and requested context.\n")
	b.WriteString("- Never claim to have accessed local desktop files.\n")
	b.WriteString("- If required data is unavailable, say what is missing and write the best safe artifact.\n")
	return b.String()
}

// buildInitialUserTurn seeds the loop with the current artifact snapshot.
// Recent run history is available on demand via the run_history.read tool
// rather than preloaded, keeping the first prompt small.
func buildInitialUserTurn(artifactBody string) string {
	var b strings.Builder
	b.WriteString("Execute the task now.\n")
	if strings.TrimSpace(artifactBody) == "" {
		b.WriteString("\nThe task artifact is currently empty.\n")
		return b.String()
	}
	snapshot := truncate(artifactBody, artifactSnapshotCap)
	b.WriteString("\nCurrent artifact (update it, do not lose still-relevant content):\n\n")
	b.WriteString("```markdown\n")
	b.WriteString(snapshot)
	b.WriteString("\n```\n")
	return b.String()
}

// summaryFrom derives the run summary from the model's final message: the
// first non-empty line, bounded.
func summaryFrom(finalContent, taskName, trigger string) string {
	for _, line := range strings.Split(finalContent, "\n") {
		line = strings.TrimSpace(strings.TrimLeft(line, "#- "))
		if line != "" {
			return truncate(line, 180)
		}
	}
	return fmt.Sprintf("API worker completed %s via %s trigger.", taskName, trigger)
}
