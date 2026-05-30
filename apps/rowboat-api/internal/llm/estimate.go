package llm

import "encoding/json"

// estimateInputTokens is a cheap, conservative token estimate (~4 chars/token)
// over the request's messages. It is only used to size the pre-call credit
// reservation; the actual charge uses upstream usage when available.
func estimateInputTokens(body map[string]any) int {
	msgs, ok := body["messages"]
	if !ok {
		// /completions uses "prompt"; fall back to the whole body.
		if p, ok := body["prompt"]; ok {
			return charsTokens(p)
		}
		return charsTokens(body)
	}
	return charsTokens(msgs)
}

func charsTokens(v any) int {
	b, err := json.Marshal(v)
	if err != nil {
		return 0
	}
	return len(b) / 4
}

// requestedMaxOutput reads max_tokens (or max_completion_tokens) from the body.
func requestedMaxOutput(body map[string]any) int {
	for _, k := range []string{"max_tokens", "max_completion_tokens"} {
		if v, ok := body[k].(float64); ok {
			return int(v)
		}
	}
	return 0
}

func isStream(body map[string]any) bool {
	s, _ := body["stream"].(bool)
	return s
}
