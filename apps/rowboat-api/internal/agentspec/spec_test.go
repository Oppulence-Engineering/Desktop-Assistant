package agentspec

import (
	"strings"
	"testing"
)

const validYAML = `
apiVersion: agent.rowboat.dev/v1
kind: Agent
metadata:
  slug: collections
  name: Collections Agent
spec:
  model: anthropic/claude-sonnet-4-6
  instructions: |
    Be helpful.
  limits:
    maxTurns: 20
    maxLLMCalls: 60
  tools:
    - conduit.read
    - name: gmail.send
      requiresApproval: true
    - name: vendor_portal
      kind: openapi
      manifestRef: manifests/acme.yaml
  connections:
    - scope: "conduit:invoices.read"
  subagents:
    - draft_dunning
  channels: [http, slack]
`

func TestDecodeAndCompile(t *testing.T) {
	doc, err := Decode([]byte(validYAML))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if doc.APIVersion != APIVersion || doc.Kind != Kind || doc.Metadata.Slug != "collections" {
		t.Fatalf("envelope wrong: %+v", doc.Metadata)
	}
	if len(doc.Spec.Tools) != 3 {
		t.Fatalf("want 3 tools, got %d", len(doc.Spec.Tools))
	}
	// string form
	if doc.Spec.Tools[0].Name != "conduit.read" || doc.Spec.Tools[0].Kind != ToolKindCode {
		t.Fatalf("string tool form wrong: %+v", doc.Spec.Tools[0])
	}
	// object form with requiresApproval
	if doc.Spec.Tools[1].Name != "gmail.send" || !doc.Spec.Tools[1].RequiresApproval {
		t.Fatalf("object tool form wrong: %+v", doc.Spec.Tools[1])
	}
	// declarative form
	if doc.Spec.Tools[2].Kind != ToolKindOpenAPI || doc.Spec.Tools[2].ManifestRef == "" {
		t.Fatalf("declarative tool form wrong: %+v", doc.Spec.Tools[2])
	}

	comp, err := Compile(doc, "")
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if comp.Slug != "collections" || comp.Model != "anthropic/claude-sonnet-4-6" {
		t.Fatalf("compiled wrong: %+v", comp)
	}
	if got := comp.EnabledTools; len(got) != 3 || got[0] != "conduit.read" {
		t.Fatalf("enabled tools derived wrong: %v", got)
	}
	if comp.Limits.MaxTurns != 20 || comp.Limits.MaxLLMCalls != 60 {
		t.Fatalf("limits wrong: %+v", comp.Limits)
	}
	if len(comp.ConnectorReqs) != 1 || comp.ConnectorReqs[0] != "conduit:invoices.read" {
		t.Fatalf("connector reqs wrong: %v", comp.ConnectorReqs)
	}
}

func TestContentHashStableAndSensitive(t *testing.T) {
	doc, _ := Decode([]byte(validYAML))
	comp, _ := Compile(doc, "")
	h1, err := ContentHash(comp)
	if err != nil {
		t.Fatal(err)
	}
	// Re-decode + compile the same source → same hash (idempotency anchor).
	doc2, _ := Decode([]byte(validYAML))
	comp2, _ := Compile(doc2, "")
	h2, _ := ContentHash(comp2)
	if h1 != h2 {
		t.Fatal("content hash must be stable for identical input")
	}
	// A change bumps the hash.
	comp2.Model = "anthropic/claude-haiku-4-5"
	h3, _ := ContentHash(comp2)
	if h1 == h3 {
		t.Fatal("content hash must change when the spec changes")
	}
}

func TestStrictDecodeRejectsUnknownField(t *testing.T) {
	bad := strings.Replace(validYAML, "  model:", "  bogusField: nope\n  model:", 1)
	if _, err := Decode([]byte(bad)); err == nil {
		t.Fatal("unknown field must be rejected by strict decode")
	}
}

func TestRejectsDuplicateKeys(t *testing.T) {
	dup := validYAML + "\nspec:\n  model: x\n" // a second spec key
	if _, err := Decode([]byte(dup)); err == nil {
		t.Fatal("duplicate mapping key must be rejected")
	}
}

func TestInlineInstructionsWinOverResolved(t *testing.T) {
	doc, _ := Decode([]byte(validYAML))
	comp, _ := Compile(doc, "FROM FILE")
	if !strings.Contains(comp.Instructions, "Be helpful") {
		t.Fatalf("inline instructions should win, got %q", comp.Instructions)
	}
}

func TestResolvedInstructionsUsedWhenNoInline(t *testing.T) {
	noInline := `
apiVersion: agent.rowboat.dev/v1
kind: Agent
metadata:
  slug: a
  name: A
spec:
  instructionsFile: ./instructions.md
  tools: [echo]
`
	doc, err := Decode([]byte(noInline))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	comp, _ := Compile(doc, "RESOLVED FROM FILE")
	if comp.Instructions != "RESOLVED FROM FILE" {
		t.Fatalf("resolved instructions not used: %q", comp.Instructions)
	}
}

func TestCompileRejectsBadEnvelope(t *testing.T) {
	for _, tc := range []string{
		"apiVersion: wrong/v1\nkind: Agent\nmetadata: {slug: a, name: A}\nspec: {}",
		"apiVersion: agent.rowboat.dev/v1\nkind: NotAgent\nmetadata: {slug: a, name: A}\nspec: {}",
		"apiVersion: agent.rowboat.dev/v1\nkind: Agent\nmetadata: {name: A}\nspec: {}", // no slug
	} {
		doc, err := Decode([]byte(tc))
		if err != nil {
			continue // decode-level rejection is also acceptable
		}
		if _, err := Compile(doc, ""); err == nil {
			t.Fatalf("expected envelope rejection for %q", tc)
		}
	}
}
