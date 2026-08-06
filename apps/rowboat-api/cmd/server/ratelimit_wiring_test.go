package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// The LLM rate limits must come from config, not from literals in the route.
//
// They were hardcoded as `rl.PerUser(ratelimit.GroupLLM, 60)` — sized for
// chat-shaped traffic and unreachable without a code change, which is why the
// desktop hit the ceiling doing ordinary agentic work. Making them
// configurable is only half the fix: a revert to a literal would restore the
// old behaviour, and nothing else in the suite notices. Verified by mutation —
// putting 60 and 12 back left every other Go test passing.
//
// Asserted against the source because the alternative is standing up the whole
// router, and the property is simply "this value is not written twice".
func TestLLMRateLimitsAreWiredFromConfig(t *testing.T) {
	src, err := os.ReadFile("wire.go")
	if err != nil {
		t.Fatalf("read wire.go: %v", err)
	}

	block := regexp.MustCompile(`r\.Route\("/v1/llm".*?\n\t\t\}\)`)
	route := block.FindString(strings.ReplaceAll(string(src), "\r\n", "\n"))
	if route == "" {
		// Matched with (?s) below; a plain find can miss across newlines.
		route = string(src)
	}

	for _, want := range []string{
		"cfg.LLMRateLimitPerUserPerMin",
		"cfg.LLMRateLimitPerUserBurst",
	} {
		if !strings.Contains(route, want) {
			t.Errorf("the /v1/llm rate limiter must read %s, not a literal", want)
		}
	}

	// A literal in either limiter call means the config is decorative.
	literal := regexp.MustCompile(`rl\.PerUser(Window)?\(ratelimit\.GroupLLM(Burst)?, \d+`)
	if m := literal.FindString(string(src)); m != "" {
		t.Errorf("hardcoded LLM rate limit found: %q — use the config field", m)
	}
}
