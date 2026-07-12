package agentworkflow

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
)

// seedTranscript builds a turn's starting transcript deterministically: the
// system prompt, a bounded window of compacted prior-turn summaries (history
// bounding — never the full raw transcript), then the current user input.
func seedTranscript(start SessionStart, summaries []TurnSummary, input string) []backgroundtaskruntime.Message {
	msgs := []backgroundtaskruntime.Message{{Role: "system", Content: buildAgentSystemPrompt(start)}}
	for _, s := range summaries {
		if strings.TrimSpace(s.Input) != "" {
			msgs = append(msgs, backgroundtaskruntime.Message{Role: "user", Content: s.Input})
		}
		if strings.TrimSpace(s.Summary) != "" {
			msgs = append(msgs, backgroundtaskruntime.Message{Role: "assistant", Content: s.Summary})
		}
	}
	msgs = append(msgs, backgroundtaskruntime.Message{Role: "user", Content: input})
	return msgs
}

// buildAgentSystemPrompt renders the agent's always-on instructions plus the
// runtime guardrails. Pure string building — deterministic, safe in workflow code.
func buildAgentSystemPrompt(start SessionStart) string {
	var b strings.Builder
	b.WriteString("You are a durable Rowboat agent running in the cloud.\n\n")
	if strings.TrimSpace(start.Instructions) != "" {
		b.WriteString("Instructions:\n")
		b.WriteString(start.Instructions)
		b.WriteString("\n\n")
	}
	b.WriteString("Rules:\n")
	b.WriteString("- Use only the tools provided in this request.\n")
	b.WriteString("- Resolve credentials inside tools; never put secrets in your messages.\n")
	b.WriteString("- For any action that requires approval, explain it before requesting it.\n")
	b.WriteString("- Finish each turn with a short, plain-language summary.\n")
	return b.String()
}

// appendToolResult appends a tool observation message for a tool-call id.
func appendToolResult(transcript []backgroundtaskruntime.Message, toolCallID, content string) []backgroundtaskruntime.Message {
	return append(transcript, backgroundtaskruntime.Message{Role: "tool", ToolCallID: toolCallID, Content: content})
}

// toolNames extracts the advertised/allowlisted tool names from ToolMeta.
func toolNames(metas []ToolMeta) []string {
	out := make([]string, 0, len(metas))
	for _, m := range metas {
		out = append(out, m.Name)
	}
	return out
}

// filterToolMetas drops subagent pseudo-tools when subagents are disabled.
func filterToolMetas(metas []ToolMeta, subagentsEnabled bool) []ToolMeta {
	if subagentsEnabled {
		return metas
	}
	out := make([]ToolMeta, 0, len(metas))
	for _, m := range metas {
		if m.Kind == "subagent" {
			continue
		}
		out = append(out, m)
	}
	return out
}

// firstLine returns the first non-empty, de-marked line of content, bounded —
// the turn summary (mirrors backgroundtaskruntime.summaryFrom).
func firstLine(content string, maxLen int) string {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(strings.TrimLeft(line, "#- "))
		if line != "" {
			return backgroundtaskruntime.Truncate(line, maxLen)
		}
	}
	return backgroundtaskruntime.Truncate(strings.TrimSpace(content), maxLen)
}

// redactKeys are argument keys whose values are stripped from audit rows and
// approval prompts (prompt-injection / credential-leak guard, RFC 027 Risks).
var redactKeys = map[string]struct{}{
	"token": {}, "password": {}, "secret": {}, "api_key": {}, "apikey": {},
	"authorization": {}, "auth": {}, "key": {}, "credential": {}, "credentials": {},
}

// redactedMap returns a redacted view of tool arguments for events/audit: known
// sensitive keys are replaced with "[redacted]"; everything else is preserved so
// a human approver still sees the action detail (amount, recipient, …).
func redactedMap(raw json.RawMessage) map[string]any {
	out := map[string]any{}
	if len(raw) == 0 {
		return out
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return map[string]any{"_raw": backgroundtaskruntime.Truncate(string(raw), 200)}
	}
	for k, v := range parsed {
		if _, secret := redactKeys[strings.ToLower(k)]; secret {
			out[k] = "[redacted]"
			continue
		}
		out[k] = v
	}
	return out
}

// redactArgsJSON is redactedMap rendered to a JSON string (for audit rows).
func redactArgsJSON(raw json.RawMessage) string {
	b, err := json.Marshal(redactedMap(raw))
	if err != nil {
		return "{}"
	}
	return string(b)
}

// approvalTokenRef derives a non-secret reference to the approval token for the
// audit row (never store the token itself).
func approvalTokenRef(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(token))
	return "sha256:" + hex.EncodeToString(sum[:8])
}

// closeStatus maps a close reason to the terminal session status + event.
func closeStatus(reason string) (status, event string) {
	switch reason {
	case "canceled":
		return "canceled", EventSessionCanceled
	default:
		return "completed", EventSessionCompleted
	}
}

// jsonMarshal/jsonUnmarshal: json.Marshal sorts map keys, so map marshaling is
// deterministic and safe in workflow code.
func jsonMarshal(v any) ([]byte, error) { return json.Marshal(v) }
func jsonUnmarshal(data json.RawMessage, v any) error {
	if len(data) == 0 {
		return fmt.Errorf("empty arguments")
	}
	return json.Unmarshal(data, v)
}
