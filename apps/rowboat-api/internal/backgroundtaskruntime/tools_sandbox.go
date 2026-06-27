package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"
)

const sandboxToolName = "sandbox.run"

// SandboxExecutor runs untrusted or dependency-heavy work outside the Temporal
// worker process. Implementations must isolate the work from the worker and
// return bounded output.
type SandboxExecutor interface {
	Execute(ctx context.Context, run SandboxRun) (SandboxResult, error)
}

// SandboxRun is one sandboxed container execution requested by the model.
type SandboxRun struct {
	UserID, TaskSlug, RunID string
	ToolCallIndex           int
	Image                   string
	Script                  string
	Env                     map[string]string
	Timeout                 time.Duration
	MaxOutputBytes          int
	Heartbeat               SandboxHeartbeatFunc
}

// SandboxHeartbeatFunc lets a sandbox executor report liveness while waiting
// for out-of-process work. The Kubernetes executor uses it to keep the Temporal
// activity cancellable during long Job runs.
type SandboxHeartbeatFunc func(context.Context, SandboxHeartbeat)

// SandboxHeartbeat describes the currently observed sandbox state.
type SandboxHeartbeat struct {
	JobName string
	Phase   string
	Message string
}

// SandboxResult is serialized back into the tool transcript.
type SandboxResult struct {
	Backend         string `json:"backend,omitempty"`
	JobName         string `json:"jobName,omitempty"`
	Status          string `json:"status"`
	ExitCode        int    `json:"exitCode,omitempty"`
	Output          string `json:"output"`
	OutputTruncated bool   `json:"outputTruncated,omitempty"`
	TimedOut        bool   `json:"timedOut,omitempty"`
}

// SandboxToolConfig bounds the model-facing sandbox.run tool.
type SandboxToolConfig struct {
	Backend         string
	DefaultImage    string
	AllowedImages   []string
	DefaultTimeout  time.Duration
	MaxTimeout      time.Duration
	MaxScriptBytes  int
	MaxOutputBytes  int
	MaxEnvVars      int
	MaxEnvValueSize int
	Heartbeat       SandboxHeartbeatFunc
}

// NewSandboxRunTool exposes a single container-backed execution tool.
func NewSandboxRunTool(executor SandboxExecutor, cfg SandboxToolConfig) Tool {
	return &sandboxRunTool{executor: executor, cfg: cfg}
}

type sandboxRunTool struct {
	executor SandboxExecutor
	cfg      SandboxToolConfig
}

func (t *sandboxRunTool) Name() string { return sandboxToolName }

func (t *sandboxRunTool) AuditInfo(json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierWrite, Connector: "sandbox", Operation: "code.run"}
}

func (t *sandboxRunTool) Description() string {
	return "Run code, browser automation, long-running, or dependency-heavy work in an isolated Kubernetes Job. Provide a POSIX shell script; stdout and stderr are returned as bounded logs."
}

func (t *sandboxRunTool) JSONSchema() json.RawMessage {
	allowed := t.allowedImages()
	imageDescription := "Optional container image. Must match the worker's configured allowlist."
	imageSchema := map[string]any{
		"type":        "string",
		"description": imageDescription,
	}
	if len(allowed) > 0 {
		imageSchema["description"] = fmt.Sprintf("%s Allowed images and prefixes: %s.", imageDescription, strings.Join(allowed, ", "))
		if exactImageAllowlist(allowed) {
			imageSchema["enum"] = allowed
		}
	}

	raw, _ := json.Marshal(map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"script"},
		"properties": map[string]any{
			"script": map[string]any{
				"type":        "string",
				"description": fmt.Sprintf("POSIX shell script to run inside the sandbox container. Write needed files under /workspace. Max %d bytes.", t.maxScriptBytes()),
			},
			"image": imageSchema,
			"timeoutSeconds": map[string]any{
				"type":        "integer",
				"minimum":     1,
				"maximum":     int(t.maxTimeout().Seconds()),
				"description": "Optional timeout for the sandbox job, in seconds.",
			},
			"env": map[string]any{
				"type":                 "object",
				"additionalProperties": map[string]any{"type": "string"},
				"description":          "Optional non-secret environment variables for the sandbox process.",
			},
		},
	})
	return raw
}

func (t *sandboxRunTool) Invoke(ctx context.Context, scope ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t.executor == nil {
		return nil, &RuntimeError{Code: CodeToolInvokeFailed, Message: "sandbox executor is not configured"}
	}
	var req struct {
		Script         string            `json:"script"`
		Image          string            `json:"image"`
		TimeoutSeconds int               `json:"timeoutSeconds"`
		Env            map[string]string `json:"env"`
	}
	if err := json.Unmarshal(args, &req); err != nil {
		return nil, fmt.Errorf("decode sandbox.run arguments: %w", err)
	}
	script := strings.TrimSpace(req.Script)
	if script == "" {
		return nil, fmt.Errorf("script is required")
	}
	if scriptLimit := t.maxScriptBytes(); len([]byte(script)) > scriptLimit {
		return nil, fmt.Errorf("script is too large (%d bytes > %d)", len([]byte(script)), scriptLimit)
	}
	image := strings.TrimSpace(req.Image)
	if image == "" {
		image = strings.TrimSpace(t.cfg.DefaultImage)
	}
	if image == "" {
		return nil, &RuntimeError{Code: CodeToolInvokeFailed, Message: "sandbox image is not configured"}
	}
	if !t.imageAllowed(image) {
		return nil, fmt.Errorf("image %q is not allowed", image)
	}
	timeout := t.cfg.DefaultTimeout
	if timeout <= 0 {
		timeout = time.Minute
	}
	if req.TimeoutSeconds > 0 {
		timeout = time.Duration(req.TimeoutSeconds) * time.Second
	}
	if timeoutLimit := t.maxTimeout(); timeout > timeoutLimit {
		return nil, fmt.Errorf("timeout %s exceeds max %s", timeout, timeoutLimit)
	}
	env, err := t.validateEnv(req.Env)
	if err != nil {
		return nil, err
	}

	out, err := t.executor.Execute(ctx, SandboxRun{
		UserID: scope.UserID, TaskSlug: scope.TaskSlug, RunID: scope.RunID,
		ToolCallIndex: scope.ToolCallIndex,
		Image:         image, Script: script, Env: env, Timeout: timeout,
		MaxOutputBytes: t.maxOutputBytes(), Heartbeat: t.cfg.Heartbeat,
	})
	if err != nil {
		return nil, &RuntimeError{Code: CodeToolInvokeFailed, Message: "sandbox execution failed", Cause: err}
	}
	if out.Backend == "" {
		out.Backend = strings.TrimSpace(t.cfg.Backend)
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	return raw, nil
}

func (t *sandboxRunTool) imageAllowed(image string) bool {
	allowed := t.allowedImages()
	if len(allowed) == 0 {
		return false
	}
	for _, entry := range allowed {
		if entry == image {
			return true
		}
		if strings.HasSuffix(entry, "*") && strings.HasPrefix(image, strings.TrimSuffix(entry, "*")) {
			return true
		}
	}
	return false
}

func (t *sandboxRunTool) allowedImages() []string {
	allowed := t.cfg.AllowedImages
	if len(allowed) == 0 && t.cfg.DefaultImage != "" {
		allowed = []string{t.cfg.DefaultImage}
	}
	out := make([]string, 0, len(allowed))
	for _, entry := range allowed {
		entry = strings.TrimSpace(entry)
		if entry != "" {
			out = append(out, entry)
		}
	}
	return out
}

func exactImageAllowlist(allowed []string) bool {
	if len(allowed) == 0 {
		return false
	}
	for _, entry := range allowed {
		if strings.HasSuffix(entry, "*") {
			return false
		}
	}
	return true
}

func (t *sandboxRunTool) validateEnv(env map[string]string) (map[string]string, error) {
	if len(env) == 0 {
		return nil, nil
	}
	maxVars := t.cfg.MaxEnvVars
	if maxVars <= 0 {
		maxVars = 16
	}
	if len(env) > maxVars {
		return nil, fmt.Errorf("too many env vars (%d > %d)", len(env), maxVars)
	}
	maxValue := t.cfg.MaxEnvValueSize
	if maxValue <= 0 {
		maxValue = 1024
	}
	out := make(map[string]string, len(env))
	for key, value := range env {
		if !validEnvName(key) {
			return nil, fmt.Errorf("invalid env var name %q", key)
		}
		if len([]byte(value)) > maxValue {
			return nil, fmt.Errorf("env var %q is too large", key)
		}
		if slices.Contains([]string{"KUBERNETES_SERVICE_HOST", "KUBERNETES_SERVICE_PORT"}, key) {
			return nil, fmt.Errorf("env var %q is reserved", key)
		}
		out[key] = value
	}
	return out, nil
}

func (t *sandboxRunTool) maxTimeout() time.Duration {
	if t.cfg.MaxTimeout > 0 {
		return t.cfg.MaxTimeout
	}
	return 5 * time.Minute
}

func (t *sandboxRunTool) maxScriptBytes() int {
	if t.cfg.MaxScriptBytes > 0 {
		return t.cfg.MaxScriptBytes
	}
	return 32 << 10
}

func (t *sandboxRunTool) maxOutputBytes() int {
	if t.cfg.MaxOutputBytes > 0 {
		return t.cfg.MaxOutputBytes
	}
	return 64 << 10
}

func validEnvName(name string) bool {
	if name == "" {
		return false
	}
	for i, r := range name {
		if r == '_' || ('A' <= r && r <= 'Z') || ('a' <= r && r <= 'z') || (i > 0 && '0' <= r && r <= '9') {
			continue
		}
		return false
	}
	return true
}
