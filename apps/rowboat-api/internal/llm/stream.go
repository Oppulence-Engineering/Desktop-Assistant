package llm

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
)

// chunk is the minimal slice of an OpenAI streaming/JSON response we read to
// account usage; the bytes are forwarded verbatim regardless.
type chunk struct {
	Usage   *usage `json:"usage"`
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
}

// streamThrough relays the upstream SSE stream to the client unchanged while
// sniffing token usage (OpenAI emits it in the final chunk when
// stream_options.include_usage is set). Falls back to a length-based estimate
// of output tokens if the upstream omits usage.
func (h *Handler) streamThrough(w http.ResponseWriter, resp *http.Response) (inTok, outTok int) {
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
				}
				contentChars += c
			}
		}
		if err != nil {
			break
		}
	}
	if outTok == 0 {
		outTok = contentChars / 4
	}
	return inTok, outTok
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
		chars += len(ch.Delta.Content)
	}
	return c.Usage, chars, true
}

// bufferThrough relays a non-streamed JSON response and reads usage from it.
func (h *Handler) bufferThrough(w http.ResponseWriter, resp *http.Response) (inTok, outTok int) {
	body, _ := io.ReadAll(resp.Body)

	var parsed struct {
		Usage *usage `json:"usage"`
	}
	if json.Unmarshal(body, &parsed) == nil && parsed.Usage != nil {
		inTok, outTok = parsed.Usage.PromptTokens, parsed.Usage.CompletionTokens
	}

	w.Header().Set("Content-Type", contentTypeOr(resp, "application/json"))
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
	return inTok, outTok
}
