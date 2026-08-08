package llm

import "encoding/json"

// estimateInputTokens is a cheap, conservative token estimate (~4 chars/token)
// over the request's billed prompt content. It is only used to size the
// pre-call credit reservation; the actual charge uses upstream usage when
// available.
func estimateInputTokens(body map[string]any) int {
	var est int
	if msgs, ok := body["messages"]; ok {
		est = charsTokens(msgs)
	} else if p, ok := body["prompt"]; ok {
		// /completions uses "prompt".
		est = charsTokens(p)
	} else {
		// Embeddings etc: fall back to the whole body (which includes any
		// tool/function payloads, so don't add them again below).
		return charsTokens(body)
	}
	// Tool/function schemas are part of the billed prompt and can be up to
	// maxToolBytes (~250K tokens). Skipping them would let a tiny-messages +
	// huge-tools request reserve almost nothing and have Settle (which performs
	// no balance check) drive the ledger negative.
	for _, k := range []string{"tools", "functions"} {
		if v, ok := body[k]; ok {
			est += charsTokens(v)
		}
	}
	return est
}

func charsTokens(v any) int {
	b, err := json.Marshal(v)
	if err != nil {
		return 0
	}
	return len(b) / 4
}

// maxRequestedOutputTokens caps the user-supplied max_tokens used to size the
// pre-call reservation. No model emits more than this; capping keeps the
// estimate finite and bounds it well below any int-overflow threshold so a
// hostile max_tokens can't wrap the cost math (see pricing.maxBillableTokens).
const maxRequestedOutputTokens = 1_000_000

// requestedMaxOutput reads max_tokens (or max_completion_tokens) from the body,
// clamped to a sane ceiling. The body is decoded with UseNumber, so numbers
// arrive as json.Number; raw float64 is handled too for callers that don't.
func requestedMaxOutput(body map[string]any) int {
	for _, k := range []string{"max_tokens", "max_completion_tokens"} {
		var v float64
		switch n := body[k].(type) {
		case json.Number:
			f, err := n.Float64()
			if err != nil {
				continue
			}
			v = f
		case float64:
			v = n
		default:
			continue
		}
		// Clamp on the float before converting: int(v) is undefined when v
		// exceeds the int range, and could wrap to a negative/small value.
		if v <= 0 {
			return 0
		}
		if v > float64(maxRequestedOutputTokens) {
			return maxRequestedOutputTokens
		}
		return int(v)
	}
	return 0
}

// isCompletionPath reports whether an upstream path takes max_tokens.
// /embeddings goes through the same proxy and would reject the field.
func isCompletionPath(path string) bool {
	return path == "/chat/completions" || path == "/completions"
}

// effectiveMaxOutput is the largest completion this request can be billed for:
// the caller's own cap when it set one, the gateway's default when it did not
// (proxy() supplies that same default upstream), and zero on paths with no
// completion at all.
//
// The reservation has to be sized on this rather than on requestedMaxOutput,
// which is 0 for every caller that omits max_tokens. Holding input-only while
// the vendor was free to bill 16K of output meant Settle — which performs no
// balance check, by design, because the work is already done — debited past the
// end of the balance on essentially every completion. Observed 2026-08-07: a
// 10,000-credit account finished the day at -948.
//
// A caller that wants a small hold can still have one by sending its own
// max_tokens; only an uncapped request reserves for the full cap, which is the
// only honest quote for a request that may legitimately emit that much.
func effectiveMaxOutput(body map[string]any, path string, defaultMax int) int {
	if !isCompletionPath(path) {
		return 0
	}
	if n := requestedMaxOutput(body); n > 0 {
		return n
	}
	if defaultMax < 0 {
		return 0
	}
	return defaultMax
}

func isStream(body map[string]any) bool {
	s, _ := body["stream"].(bool)
	return s
}
