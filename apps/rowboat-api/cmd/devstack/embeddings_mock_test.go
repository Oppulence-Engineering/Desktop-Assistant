package main

import (
	"math"
	"testing"
)

// The old mock returned one constant vector, so every cosine similarity was
// 1.0 and the vector half of hybrid search was silently inert.
func TestDeterministicEmbeddingIsStableAndDiscriminative(t *testing.T) {
	a1 := deterministicEmbedding("relationship evidence", 1536)
	a2 := deterministicEmbedding("relationship evidence", 1536)
	b := deterministicEmbedding("quarterly revenue report", 1536)

	if len(a1) != 1536 || len(b) != 1536 {
		t.Fatalf("dims = %d/%d, want 1536", len(a1), len(b))
	}
	cos := func(x, y []float64) float64 {
		var d float64
		for i := range x {
			d += x[i] * y[i]
		}
		return d
	}
	if s := cos(a1, a2); math.Abs(s-1) > 1e-9 {
		t.Fatalf("same text must embed identically, cos=%v", s)
	}
	if s := cos(a1, b); math.Abs(s) > 0.5 {
		t.Fatalf("different text must not be near-identical, cos=%v", s)
	}
	var norm float64
	for _, v := range a1 {
		norm += v * v
	}
	if math.Abs(math.Sqrt(norm)-1) > 1e-9 {
		t.Fatalf("vector must be unit length, got %v", math.Sqrt(norm))
	}
}

func TestMockEmbeddingDimsMatchRealWidths(t *testing.T) {
	if got := mockEmbeddingDims("text-embedding-3-small"); got != 1536 {
		t.Fatalf("small = %d", got)
	}
	if got := mockEmbeddingDims("text-embedding-3-large"); got != 3072 {
		t.Fatalf("large = %d", got)
	}
}
