package backgroundtaskruntime

import (
	"errors"
	"testing"
)

// TestRegistryDenyByDefault is the RFC's structural-safety assertion: tools
// not on the allowlist — shell, filesystem, arbitrary fetch, hallucinated
// names — cannot resolve, ever.
func TestRegistryDenyByDefault(t *testing.T) {
	reg := NewRegistry([]Tool{
		&fakeTool{name: "artifact.read"},
		&fakeTool{name: "run_history.read"},
	})

	for _, denied := range []string{"shell", "fs.write", "http.fetch", "connector.read.gmail", "artifact.delete", ""} {
		if _, err := reg.Lookup(denied); !errors.Is(err, ErrToolNotAllowed) {
			t.Fatalf("Lookup(%q) err = %v, want ErrToolNotAllowed", denied, err)
		}
	}

	tool, err := reg.Lookup("artifact.read")
	if err != nil || tool.Name() != "artifact.read" {
		t.Fatalf("allowlisted lookup failed: %v", err)
	}

	// ErrToolNotAllowed is a classified RuntimeError with the right code.
	_, lerr := reg.Lookup("shell")
	re, ok := AsRuntimeError(lerr)
	if !ok || re.Code != CodeToolNotAllowed {
		t.Fatalf("denied lookup must classify as %s, got %v", CodeToolNotAllowed, lerr)
	}
}

// TestRegistryListIsExactlyTheAllowlist: the model is shown only what this
// run's scope permitted at construction.
func TestRegistryListIsExactlyTheAllowlist(t *testing.T) {
	reg := NewRegistry([]Tool{
		&fakeTool{name: "artifact.write"},
		&fakeTool{name: "artifact.read"},
	})
	list := reg.List()
	if len(list) != 2 || list[0].Name() != "artifact.read" || list[1].Name() != "artifact.write" {
		names := make([]string, len(list))
		for i, tl := range list {
			names[i] = tl.Name()
		}
		t.Fatalf("List() = %v, want sorted exact allowlist", names)
	}
}
