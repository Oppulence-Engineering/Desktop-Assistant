package agentregistry

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/websearch"
)

// WebSearchCapability searches the web (read-only). It is backed by a configured
// provider (internal/websearch); when none is configured, Build returns a tool
// that reports the capability as unavailable.
func WebSearchCapability() Capability {
	return Capability{
		Name:        "web.search",
		Description: "Search the web and return a list of result titles, URLs, and snippets. Read-only.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"query":{"type":"string"},"max_results":{"type":"integer","description":"1-10 (default 5)"}},"required":["query"]}`),
		TrustTier:   TierRead,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			if d.Web == nil {
				return newUnavailableTool("web.search", "web search is not configured on this server")
			}
			return &webSearchTool{web: d.Web}
		},
	}
}

type webSearchTool struct{ web *websearch.Client }

func (t *webSearchTool) Name() string { return "web.search" }
func (t *webSearchTool) Description() string {
	return "Search the web and return result titles, URLs, and snippets."
}
func (t *webSearchTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"query":{"type":"string"},"max_results":{"type":"integer"}},"required":["query"]}`)
}
func (t *webSearchTool) Invoke(ctx context.Context, _ backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Query      string `json:"query"`
		MaxResults int    `json:"max_results"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid web.search arguments: %w", err)
	}
	if strings.TrimSpace(in.Query) == "" {
		b, _ := json.Marshal(map[string]string{"error": "query is required"})
		return b, nil
	}
	results, err := t.web.Search(ctx, in.Query, in.MaxResults)
	if err != nil {
		b, _ := json.Marshal(map[string]string{"error": err.Error()})
		return b, nil
	}
	return json.Marshal(map[string]any{"results": results})
}
