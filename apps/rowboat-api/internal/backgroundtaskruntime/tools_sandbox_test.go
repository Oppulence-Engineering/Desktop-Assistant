package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestSandboxRunToolInvokesExecutor(t *testing.T) {
	exec := &fakeSandboxExecutor{result: SandboxResult{Status: "succeeded", Output: "hello\n"}}
	tool := NewSandboxRunTool(exec, SandboxToolConfig{
		Backend:         "argo-workflow",
		DefaultImage:    "python:3.12-slim",
		AllowedImages:   []string{"python:3.12-slim", "mcr.microsoft.com/playwright:*"},
		DefaultTimeout:  time.Minute,
		MaxTimeout:      5 * time.Minute,
		MaxScriptBytes:  1024,
		MaxOutputBytes:  2048,
		MaxEnvVars:      2,
		MaxEnvValueSize: 64,
	})

	raw, err := tool.Invoke(context.Background(), ToolScope{UserID: "u1", TaskSlug: "task", RunID: "run-1", ToolCallIndex: 3}, json.RawMessage(`{
		"script": "python - <<'PY'\nprint('hello')\nPY",
		"image": "mcr.microsoft.com/playwright:v1",
		"timeoutSeconds": 30,
		"env": {"MODE": "test"}
	}`))
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if len(exec.runs) != 1 {
		t.Fatalf("executor runs = %d, want 1", len(exec.runs))
	}
	run := exec.runs[0]
	if run.Image != "mcr.microsoft.com/playwright:v1" || run.Timeout != 30*time.Second ||
		run.MaxOutputBytes != 2048 || run.ToolCallIndex != 3 || run.Env["MODE"] != "test" ||
		!strings.Contains(run.Script, "print('hello')") {
		t.Fatalf("run = %+v", run)
	}
	var out SandboxResult
	if err := json.Unmarshal(raw, &out); err != nil || out.Backend != "argo-workflow" || out.Status != "succeeded" || out.Output != "hello\n" {
		t.Fatalf("result = %s err=%v", raw, err)
	}
}

func TestSandboxRunToolAuditInfo(t *testing.T) {
	tool := NewSandboxRunTool(&fakeSandboxExecutor{}, SandboxToolConfig{DefaultImage: "python:3.12-slim"})
	audit := tool.(ToolAuditProvider).AuditInfo(nil)
	if audit.TrustTier != TierWrite || audit.Connector != "sandbox" || audit.Operation != "code.run" {
		t.Fatalf("audit = %+v, want write/sandbox/code.run", audit)
	}
	if RequiresApproval(audit.TrustTier) {
		t.Fatal("sandbox.run is write-tier infrastructure work and must not require HITL approval")
	}
}

func TestSandboxRunToolUsesDefaultImageAllowlistAndBounds(t *testing.T) {
	exec := &fakeSandboxExecutor{result: SandboxResult{Status: "succeeded", Output: "ok\n"}}
	tool := NewSandboxRunTool(exec, SandboxToolConfig{DefaultImage: "python:3.12-slim"})

	raw, err := tool.Invoke(context.Background(), ToolScope{UserID: "u", TaskSlug: "task", RunID: "run"}, json.RawMessage(`{"script":"echo ok"}`))
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if len(exec.runs) != 1 {
		t.Fatalf("executor runs = %d, want 1", len(exec.runs))
	}
	run := exec.runs[0]
	if run.Image != "python:3.12-slim" || run.Timeout != time.Minute || run.MaxOutputBytes != 64<<10 {
		t.Fatalf("run defaults = %+v", run)
	}
	var out SandboxResult
	if err := json.Unmarshal(raw, &out); err != nil || out.Status != "succeeded" || out.Output != "ok\n" {
		t.Fatalf("result = %s err=%v", raw, err)
	}

	var schema struct {
		Properties map[string]struct {
			Maximum float64  `json:"maximum"`
			Enum    []string `json:"enum"`
		} `json:"properties"`
	}
	if err := json.Unmarshal(tool.JSONSchema(), &schema); err != nil {
		t.Fatalf("schema must be JSON: %v", err)
	}
	if got := schema.Properties["timeoutSeconds"].Maximum; got != 300 {
		t.Fatalf("default timeout maximum = %v, want 300", got)
	}
	if enum := schema.Properties["image"].Enum; len(enum) != 1 || enum[0] != "python:3.12-slim" {
		t.Fatalf("default image enum = %v", enum)
	}
}

func TestSandboxRunToolRejectsUnsafeInputs(t *testing.T) {
	tool := NewSandboxRunTool(&fakeSandboxExecutor{}, SandboxToolConfig{
		DefaultImage:   "python:3.12-slim",
		AllowedImages:  []string{"python:3.12-slim"},
		DefaultTimeout: time.Minute,
		MaxTimeout:     time.Minute,
		MaxScriptBytes: 8,
		MaxOutputBytes: 1024,
	})

	if _, err := tool.Invoke(context.Background(), ToolScope{}, json.RawMessage(`{"script":"echo ok","image":"alpine:latest"}`)); err == nil {
		t.Fatal("disallowed image must be rejected")
	}
	if _, err := tool.Invoke(context.Background(), ToolScope{}, json.RawMessage(`{"script":"0123456789"}`)); err == nil {
		t.Fatal("oversized script must be rejected")
	}
	if _, err := tool.Invoke(context.Background(), ToolScope{}, json.RawMessage(`{"script":"echo ok","timeoutSeconds":120}`)); err == nil {
		t.Fatal("oversized timeout must be rejected")
	}
	if _, err := tool.Invoke(context.Background(), ToolScope{}, json.RawMessage(`{"script":"echo ok","env":{"BAD-NAME":"x"}}`)); err == nil {
		t.Fatal("invalid env var name must be rejected")
	}
}

func TestSandboxRunToolRejectsAdditionalUnsafeInputs(t *testing.T) {
	baseCfg := SandboxToolConfig{
		DefaultImage:    "python:3.12-slim",
		AllowedImages:   []string{"python:3.12-slim"},
		DefaultTimeout:  time.Minute,
		MaxTimeout:      time.Minute,
		MaxScriptBytes:  1024,
		MaxOutputBytes:  1024,
		MaxEnvVars:      2,
		MaxEnvValueSize: 4,
	}
	for _, tc := range []struct {
		name string
		cfg  SandboxToolConfig
		args string
		want string
	}{
		{name: "invalid-json", cfg: baseCfg, args: `{`, want: "decode sandbox.run arguments"},
		{name: "blank-script", cfg: baseCfg, args: `{"script":"   "}`, want: "script is required"},
		{name: "missing-image-config", cfg: SandboxToolConfig{AllowedImages: []string{"python:3.12-slim"}}, args: `{"script":"echo ok"}`, want: "sandbox image is not configured"},
		{name: "too-many-env-vars", cfg: SandboxToolConfig{
			DefaultImage: "python:3.12-slim", AllowedImages: []string{"python:3.12-slim"},
			MaxEnvVars: 1, MaxEnvValueSize: 8,
		}, args: `{"script":"echo ok","env":{"A":"1","B":"2"}}`, want: "too many env vars"},
		{name: "env-value-too-large", cfg: baseCfg, args: `{"script":"echo ok","env":{"A":"12345"}}`, want: `env var "A" is too large`},
		{name: "reserved-env", cfg: SandboxToolConfig{
			DefaultImage: "python:3.12-slim", AllowedImages: []string{"python:3.12-slim"},
			MaxEnvVars: 2, MaxEnvValueSize: 64,
		}, args: `{"script":"echo ok","env":{"KUBERNETES_SERVICE_HOST":"10.0.0.1"}}`, want: `env var "KUBERNETES_SERVICE_HOST" is reserved`},
		{name: "reserved-home", cfg: baseCfg, args: `{"script":"echo ok","env":{"HOME":"/root"}}`, want: `env var "HOME" is reserved`},
		{name: "reserved-run-id", cfg: baseCfg, args: `{"script":"echo ok","env":{"ROWBOAT_RUN_ID":"forged"}}`, want: `env var "ROWBOAT_RUN_ID" is reserved`},
		{name: "leading-digit-env", cfg: baseCfg, args: `{"script":"echo ok","env":{"1BAD":"x"}}`, want: `invalid env var name "1BAD"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			exec := &fakeSandboxExecutor{}
			tool := NewSandboxRunTool(exec, tc.cfg)
			_, err := tool.Invoke(context.Background(), ToolScope{}, json.RawMessage(tc.args))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want containing %q", err, tc.want)
			}
			if len(exec.runs) != 0 {
				t.Fatalf("executor should not run invalid input: %+v", exec.runs)
			}
		})
	}
}

func TestSandboxRunToolSchemaAdvertisesConfiguredBounds(t *testing.T) {
	tool := NewSandboxRunTool(&fakeSandboxExecutor{}, SandboxToolConfig{
		DefaultImage:   "python:3.12-slim",
		AllowedImages:  []string{"python:3.12-slim", "mcr.microsoft.com/playwright:*"},
		MaxTimeout:     2 * time.Minute,
		MaxScriptBytes: 4096,
	})

	var schema struct {
		Properties map[string]struct {
			Description string   `json:"description"`
			Maximum     float64  `json:"maximum"`
			Enum        []string `json:"enum"`
		} `json:"properties"`
	}
	if err := json.Unmarshal(tool.JSONSchema(), &schema); err != nil {
		t.Fatalf("schema must be JSON: %v", err)
	}
	image := schema.Properties["image"]
	if !strings.Contains(image.Description, "python:3.12-slim") ||
		!strings.Contains(image.Description, "mcr.microsoft.com/playwright:*") {
		t.Fatalf("image schema description does not advertise allowlist: %q", image.Description)
	}
	if len(image.Enum) != 0 {
		t.Fatalf("wildcard allowlist must not be emitted as enum: %v", image.Enum)
	}
	if got := schema.Properties["timeoutSeconds"].Maximum; got != 120 {
		t.Fatalf("timeout maximum = %v, want 120", got)
	}
	if !strings.Contains(schema.Properties["script"].Description, "4096") {
		t.Fatalf("script schema description does not include size bound: %q", schema.Properties["script"].Description)
	}
}

type fakeSandboxExecutor struct {
	runs   []SandboxRun
	result SandboxResult
	err    error
}

func (f *fakeSandboxExecutor) Execute(_ context.Context, run SandboxRun) (SandboxResult, error) {
	f.runs = append(f.runs, run)
	if f.err != nil {
		return SandboxResult{}, f.err
	}
	return f.result, nil
}
