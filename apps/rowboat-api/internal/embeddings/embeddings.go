// Package embeddings is a thin client for computing text embeddings against an
// OpenAI-compatible endpoint. When no API key is configured it is a fail-closed
// no-op, so callers can wire it unconditionally and ship dark.
package embeddings

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

// ErrDisabled means no embeddings provider is configured.
var ErrDisabled = errors.New("embeddings: no provider configured")

// DefaultModel is a small, cheap embedding model (1536 dims).
const DefaultModel = "text-embedding-3-small"

// Embedder computes a vector for one piece of text.
type Embedder interface {
	Embed(ctx context.Context, text string) ([]float32, error)
	Enabled() bool
	Model() string
}

type disabled struct{}

func (disabled) Embed(context.Context, string) ([]float32, error) { return nil, ErrDisabled }
func (disabled) Enabled() bool                                    { return false }
func (disabled) Model() string                                    { return "" }

// NewDisabled returns the fail-closed no-op embedder.
func NewDisabled() Embedder { return disabled{} }

// Config configures the OpenAI-compatible client.
type Config struct {
	APIKey  string
	BaseURL string // defaults to https://api.openai.com/v1
	Model   string // defaults to DefaultModel
}

type client struct {
	cfg  Config
	http *outbound.Client
}

// New builds the client, or the disabled embedder when the API key is missing.
func New(cfg Config) Embedder {
	if cfg.APIKey == "" {
		return disabled{}
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.openai.com/v1"
	}
	if cfg.Model == "" {
		cfg.Model = DefaultModel
	}
	return &client{
		cfg: cfg,
		http: outbound.NewClient(outbound.Policy{
			Name:                  "embeddings",
			Timeout:               20 * time.Second,
			ResponseHeaderTimeout: 20 * time.Second,
			MaxConcurrent:         8,
			MaxResponseBytes:      4 << 20,
			FailureThreshold:      5,
			Cooldown:              30 * time.Second,
		}),
	}
}

func (c *client) Enabled() bool { return true }
func (c *client) Model() string { return c.cfg.Model }

func (c *client) Embed(ctx context.Context, text string) ([]float32, error) {
	if text == "" {
		return nil, fmt.Errorf("embeddings: empty text")
	}
	body, err := json.Marshal(map[string]any{"model": c.cfg.Model, "input": text})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL+"/embeddings", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embeddings: request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("embeddings: provider returned %d", resp.StatusCode)
	}
	var out struct {
		Data []struct {
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if len(out.Data) == 0 || len(out.Data[0].Embedding) == 0 {
		return nil, fmt.Errorf("embeddings: empty vector")
	}
	return out.Data[0].Embedding, nil
}

// --- serialization + similarity (portable; no pgvector dependency) ----------

// Encode packs a vector into little-endian float32 bytes for storage.
func Encode(v []float32) []byte {
	buf := make([]byte, len(v)*4)
	for i, f := range v {
		binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(f))
	}
	return buf
}

// Decode reverses Encode.
func Decode(b []byte) []float32 {
	n := len(b) / 4
	v := make([]float32, n)
	for i := 0; i < n; i++ {
		v[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[i*4:]))
	}
	return v
}

// Cosine returns the cosine similarity of two equal-length vectors, or 0 for
// mismatched or zero vectors.
func Cosine(a, b []float32) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / (math.Sqrt(na) * math.Sqrt(nb))
}
