package backgroundtaskworkflow

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrunevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

// integrationHarness wires the FULL runtime path: ExecuteAPITask →
// DefaultRuntime → GatewayLLM → llm.ChatComplete → httptest upstream, plus a
// Google mock behind the gmail connector tool.
type integrationHarness struct {
	activities *Activities
	client     *ent.Client
	in         StartInput
	llmCalls   *int
}

func newIntegrationHarness(t *testing.T, llmHandler func(call int, w http.ResponseWriter, body []byte)) *integrationHarness {
	t.Helper()
	d, err := dbOpenForTest(t)
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	bg := context.Background()
	u := d.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(bg)
	bg = auth.WithUser(bg, u)
	d.Subscription.Create().SetUser(u).SetSanctionedCredits(100000).SaveX(bg)
	task := d.BackgroundTask.Create().
		SetUser(u).SetSlug("acme-ar-watch").SetName("Acme AR Watch").
		SetInstructions("Watch disputed Acme invoices and keep the artifact current.").
		SetExecutionTarget("api").SaveX(bg)
	d.BackgroundTaskRun.Create().
		SetUser(u).SetTask(task).
		SetRunID("run-int-1").SetStatus("running").SetExecutor("api").
		SaveX(bg)

	sealer, err := crypto.NewSealer("test-encryption-key-for-integration")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	sealed, _ := sealer.SealString("1//refresh")
	d.OAuthConnection.Create().
		SetUser(u).SetProvider("google").
		SetRefreshTokenEncrypted(sealed).
		SetScopes([]string{backgroundtaskruntime.ScopeGmailReadonly}).
		SaveX(bg)

	// Google mock: token endpoint + gmail list/get.
	gmux := http.NewServeMux()
	gmux.HandleFunc("/token", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "ya29.t"})
	})
	gmux.HandleFunc("/gmail/v1/users/me/messages", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"messages": []map[string]string{{"id": "m1", "threadId": "t1"}}})
	})
	gmux.HandleFunc("/gmail/v1/users/me/messages/", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "m1", "threadId": "t1", "snippet": "We dispute line 3 of invoice #4821",
			"payload": map[string]any{"headers": []map[string]string{
				{"name": "From", "value": "ap@acme.com"},
				{"name": "Subject", "value": "Invoice #4821 dispute"},
			}},
		})
	})
	googleSrv := httptest.NewServer(gmux)
	t.Cleanup(googleSrv.Close)

	// LLM upstream mock: delegates per-call scripting to the test.
	calls := 0
	llmSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		calls++
		w.Header().Set("Content-Type", "application/json")
		llmHandler(calls, w, body)
	}))
	t.Cleanup(llmSrv.Close)

	sec := secrets.NewFromConfig(appconfig.Config{
		OpenRouterAPIKey:        "or-key",
		GoogleOAuthClientID:     "cid",
		GoogleOAuthClientSecret: "csec",
	})
	gate := quota.New(d, zap.NewNop())
	llmH := llm.New(pricing.DefaultTable(), gate, sec, d, zap.NewNop())
	llmH.SetUpstream(llmSrv.URL)

	a := &Activities{
		Client:        d,
		Log:           zap.NewNop(),
		Runtime:       backgroundtaskruntime.NewDefault(),
		RuntimeLimits: backgroundtaskruntime.DefaultLimits(),
		LLM:           llmH,
		Sealer:        sealer,
		Secrets:       sec,
		Google:        googleapi.New(googleapi.Config{TokenURL: googleSrv.URL + "/token", GmailBaseURL: googleSrv.URL}),
		DefaultModel:  "anthropic/claude-sonnet-4-5",
	}
	return &integrationHarness{
		activities: a,
		client:     d,
		in: StartInput{
			UserID: u.ID.String(), TaskID: task.ID.String(), Slug: task.Slug,
			RunID: "run-int-1", Trigger: "event",
			RequestedContext: "Cloud event trigger: source=gmail. Subject: Invoice #4821 dispute.",
		},
		llmCalls: &calls,
	}
}

func chatResponse(content string, toolCalls string, usage string) string {
	tc := ""
	if toolCalls != "" {
		tc = `,"tool_calls":` + toolCalls
	}
	return `{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":` + content + tc + `}}],"usage":` + usage + `}`
}

// TestRuntimeIntegrationGmailToolThenArtifact runs the whole RFC 004 chain:
// the model calls connector.read.gmail, gets real mocked results, stages the
// artifact, and finishes — asserting artifact provenance, the ordered
// temporal.* + runtime.* event stream, and the run summary.
func TestRuntimeIntegrationGmailToolThenArtifact(t *testing.T) {
	h := newIntegrationHarness(t, func(call int, w http.ResponseWriter, body []byte) {
		switch call {
		case 1:
			// Sanity: tools were advertised, including the scoped gmail tool.
			if !strings.Contains(string(body), "connector.read.gmail") {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = io.WriteString(w, `{"error":"gmail tool not advertised"}`)
				return
			}
			_, _ = io.WriteString(w, chatResponse(`""`,
				`[{"id":"c1","type":"function","function":{"name":"connector.read.gmail","arguments":"{\"query\":\"from:acme.com\",\"limit\":5}"}}]`,
				`{"prompt_tokens":200,"completion_tokens":20,"total_tokens":220}`))
		case 2:
			// The tool result (real mocked Gmail data) must be in the transcript.
			if !strings.Contains(string(body), "We dispute line 3") {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = io.WriteString(w, `{"error":"tool result missing from transcript"}`)
				return
			}
			_, _ = io.WriteString(w, chatResponse(`""`,
				`[{"id":"c2","type":"function","function":{"name":"artifact.write","arguments":"{\"body\":\"# Acme AR Watch\\n\\nInvoice #4821 is disputed (line 3).\"}"}}]`,
				`{"prompt_tokens":300,"completion_tokens":40,"total_tokens":340}`))
		default:
			_, _ = io.WriteString(w, chatResponse(`"Tracked the new Acme dispute on invoice #4821."`, "",
				`{"prompt_tokens":350,"completion_tokens":15,"total_tokens":365}`))
		}
	})

	out, err := h.activities.ExecuteAPITask(context.Background(), h.in)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if out.Summary != "Tracked the new Acme dispute on invoice #4821." {
		t.Fatalf("summary = %q", out.Summary)
	}
	if *h.llmCalls != 3 {
		t.Fatalf("llm calls = %d, want 3", *h.llmCalls)
	}

	ctx := auth.WithInternal(context.Background())

	// Artifact: the staged body, with provenance.
	artifact := h.client.BackgroundTaskArtifact.Query().
		Where(backgroundtaskartifact.UpdatedByRunID("run-int-1")).
		OnlyX(ctx)
	if !strings.Contains(artifact.Body, "Invoice #4821 is disputed") || artifact.ContentType != "text/markdown" {
		t.Fatalf("artifact = %q (%s)", artifact.Body, artifact.ContentType)
	}

	// Event stream: runtime transcript events present and the artifact pairing
	// preserved; llm_call events tagged with the prompt version.
	run := h.client.BackgroundTaskRun.Query().Where(backgroundtaskrun.RunIDEQ("run-int-1")).OnlyX(ctx)
	events := h.client.BackgroundTaskRunEvent.Query().
		Where(backgroundtaskrunevent.HasRunWith(backgroundtaskrun.IDEQ(run.ID))).
		Order(backgroundtaskrunevent.BySeq()).
		AllX(ctx)
	var types []string
	promptVersionSeen := false
	for _, ev := range events {
		types = append(types, ev.EventType)
		if ev.EventType == EventRuntimeLLMCallCompleted && strings.Contains(ev.EventJSON, backgroundtaskruntime.PromptVersion) {
			promptVersionSeen = true
		}
	}
	for _, want := range []string{
		EventRuntimeLLMCallStarted, EventRuntimeLLMCallCompleted,
		EventRuntimeToolCallStarted, EventRuntimeToolCallCompleted,
		EventArtifactUpdated, EventRuntimeFinalArtifactReady,
	} {
		if !sliceContains(types, want) {
			t.Fatalf("events missing %s: %v", want, types)
		}
	}
	if !promptVersionSeen {
		t.Fatal("llm_call_completed events must carry prompt_version")
	}
	if run.ProgressPercent == nil || *run.ProgressPercent != 90 {
		t.Fatalf("final progress = %v", run.ProgressPercent)
	}
}

// TestRuntimeIntegrationLLMFailureClassified: a dead upstream fails the run
// with llm_call_failed through the full classification path.
func TestRuntimeIntegrationLLMFailureClassified(t *testing.T) {
	h := newIntegrationHarness(t, func(_ int, w http.ResponseWriter, _ []byte) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = io.WriteString(w, `{"error":"upstream down"}`)
	})
	_, err := h.activities.ExecuteAPITask(context.Background(), h.in)
	if err == nil {
		t.Fatal("want error")
	}
	code, _ := ClassifyRunError(err)
	if code != ErrCodeLLMCallFailed {
		t.Fatalf("code = %s, want %s", code, ErrCodeLLMCallFailed)
	}
	// Failed run: the artifact was never written.
	n := h.client.BackgroundTaskArtifact.Query().
		Where(backgroundtaskartifact.HasTaskWith(backgroundtask.SlugEQ("acme-ar-watch"))).
		CountX(auth.WithInternal(context.Background()))
	if n != 0 {
		t.Fatalf("artifacts = %d, want 0 on failure", n)
	}
}

func sliceContains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}

// dbOpenForTest opens the in-memory sqlite client used across this package's
// tests (mirrors executeSetup's open).
func dbOpenForTest(t *testing.T) (*ent.Client, error) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		return nil, fmt.Errorf("open: %w", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d.Client, nil
}
