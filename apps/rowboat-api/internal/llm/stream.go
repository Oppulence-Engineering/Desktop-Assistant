package llm

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"go.uber.org/zap"
)

// chunk is the minimal slice of an OpenAI streaming/JSON response we read to
// account usage; the bytes are forwarded verbatim regardless.
type chunk struct {
	Usage   *usage `json:"usage"`
	Choices []struct {
		Delta json.RawMessage `json:"delta"`
	} `json:"choices"`
}

// streamThrough relays the upstream SSE stream to the client unchanged while
// sniffing token usage (OpenAI emits it in the final chunk when
// stream_options.include_usage is set). Falls back to a length-based estimate
// of output tokens if the upstream omits usage.
func (h *Handler) streamThrough(w http.ResponseWriter, resp *http.Response) (inTok, cachedTok, outTok int, relayErr error) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // disable proxy buffering of the stream
	w.WriteHeader(resp.StatusCode)

	flusher, _ := w.(http.Flusher)
	reader := bufio.NewReaderSize(resp.Body, 64<<10)

	var contentChars int
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			if _, werr := w.Write(line); werr != nil {
				// Client gone; stop relaying but keep what we counted.
				break
			}
			if flusher != nil {
				flusher.Flush()
			}
			if u, c, ok := parseSSELine(line); ok {
				if u != nil {
					inTok, outTok = u.PromptTokens, u.CompletionTokens
					cachedTok = cachedFrom(u)
				}
				contentChars += c
			}
		}
		if err != nil {
			switch {
			case errors.Is(err, outbound.ErrResponseTooLarge):
				h.log.Warn("llm upstream stream exceeded response cap")
				relayErr = err
			case errors.Is(err, io.EOF):
				// Clean end of stream — normal completion.
			default:
				// The upstream dropped/errored mid-stream (not a clean EOF). Surface
				// it as a relay failure so the caller refunds, instead of billing
				// the input estimate for a call that didn't complete. (A CLIENT
				// disconnect manifests as a write error above and is intentionally
				// still charged via the normal settle path.)
				h.log.Warn("llm upstream stream read error", zap.Error(err))
				relayErr = err
			}
			break
		}
	}
	if outTok == 0 {
		outTok = estimateTextTokensFromBytes(contentChars)
	}
	return inTok, cachedTok, outTok, relayErr
}

// parseSSELine extracts usage and content length from a `data: {...}` line.
func parseSSELine(line []byte) (*usage, int, bool) {
	trimmed := bytes.TrimSpace(line)
	if !bytes.HasPrefix(trimmed, []byte("data:")) {
		return nil, 0, false
	}
	payload := bytes.TrimSpace(bytes.TrimPrefix(trimmed, []byte("data:")))
	if len(payload) == 0 || bytes.Equal(payload, []byte("[DONE]")) {
		return nil, 0, false
	}
	var c chunk
	if json.Unmarshal(payload, &c) != nil {
		return nil, 0, false
	}
	chars := 0
	for _, ch := range c.Choices {
		var delta any
		if json.Unmarshal(ch.Delta, &delta) == nil {
			chars += jsonStringBytes(delta)
		}
	}
	return c.Usage, chars, true
}

// bufferThrough relays a non-streamed JSON response and reads usage from it.
func (h *Handler) bufferThrough(w http.ResponseWriter, resp *http.Response) (inTok, cachedTok, outTok int, relayErr error) {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		if errors.Is(err, outbound.ErrResponseTooLarge) {
			httpx.Error(w, http.StatusBadGateway, "upstream response too large", "upstream_response_too_large")
			return 0, 0, 0, err
		}
		httpx.Error(w, http.StatusBadGateway, "could not read upstream response", "upstream_error")
		return 0, 0, 0, err
	}

	var parsed struct {
		Usage   *usage `json:"usage"`
		Choices []struct {
			Message json.RawMessage `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(body, &parsed) == nil {
		if parsed.Usage != nil {
			inTok, outTok = parsed.Usage.PromptTokens, parsed.Usage.CompletionTokens
			cachedTok = cachedFrom(parsed.Usage)
		} else {
			// Upstream omitted usage: estimate output from the message content
			// length so output isn't billed as free (mirrors streamThrough's
			// contentChars/4 fallback). Input is recovered via the inputEst
			// fallback in proxy().
			chars := 0
			for _, ch := range parsed.Choices {
				var message any
				if json.Unmarshal(ch.Message, &message) == nil {
					chars += jsonStringBytes(message)
				}
			}
			outTok = estimateTextTokensFromBytes(chars)
		}
	} else {
		// A 200 whose body the minimal struct can't parse at all (non-JSON or an
		// unrecognized provider variant) would otherwise bill output as free.
		// Charge a conservative length-based estimate instead.
		outTok = estimateTextTokensFromBytes(len(body))
	}

	w.Header().Set("Content-Type", contentTypeOr(resp, "application/json"))
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
	return inTok, cachedTok, outTok, nil
}

func estimateOutputTokens(v any) int {
	raw, err := json.Marshal(v)
	if err != nil {
		return 0
	}
	var decoded any
	if json.Unmarshal(raw, &decoded) != nil {
		return estimateTextTokensFromBytes(len(raw))
	}
	return estimateTextTokensFromBytes(jsonStringBytes(decoded))
}

func estimateTextTokens(s string) int { return estimateTextTokensFromBytes(len(s)) }

func estimateTextTokensFromBytes(n int) int {
	if n <= 0 {
		return 0
	}
	return (n + 3) / 4
}

func jsonStringBytes(v any) int {
	switch value := v.(type) {
	case string:
		return len(value)
	case []any:
		total := 0
		for _, item := range value {
			total += jsonStringBytes(item)
		}
		return total
	case map[string]any:
		total := 0
		for _, item := range value {
			total += jsonStringBytes(item)
		}
		return total
	default:
		return 0
	}
}
