package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestArgoSandboxExecutorCreatesWorkflowAndReturnsLogs(t *testing.T) {
	var created bool
	var workflowSpec map[string]any
	var heartbeatPhases []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/apis/argoproj.io/v1alpha1/namespaces/sandbox-ns/workflows/"):
			if !created {
				http.NotFound(w, r)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": map[string]any{"phase": "Succeeded", "message": "done"},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/apis/argoproj.io/v1alpha1/namespaces/sandbox-ns/workflows":
			created = true
			if err := json.NewDecoder(r.Body).Decode(&workflowSpec); err != nil {
				t.Fatalf("decode workflow spec: %v", err)
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"metadata":{"name":"created"}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/sandbox-ns/pods":
			if got := r.URL.Query().Get("labelSelector"); !strings.HasPrefix(got, "workflows.argoproj.io/workflow=rb-sandbox-run-1-") {
				t.Fatalf("labelSelector = %q", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]any{{"metadata": map[string]any{"name": "pod-1"}}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/sandbox-ns/pods/pod-1":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": map[string]any{
					"containerStatuses": []map[string]any{
						{"name": "main", "state": map[string]any{"terminated": map[string]any{"exitCode": 0}}},
						{"name": "wait", "state": map[string]any{"terminated": map[string]any{"exitCode": 0}}},
					},
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/sandbox-ns/pods/pod-1/log":
			if r.URL.Query().Get("container") != "main" {
				t.Fatalf("log container = %q", r.URL.Query().Get("container"))
			}
			_, _ = w.Write([]byte("hello from argo\n"))
		default:
			t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer srv.Close()

	exec, err := NewArgoSandboxExecutor(KubernetesSandboxConfig{
		APIServer:          srv.URL,
		BearerToken:        "token",
		Namespace:          "sandbox-ns",
		ServiceAccountName: "rowboat-sandbox",
		PollInterval:       time.Millisecond,
		TTLSeconds:         120,
		CPURequest:         "50m",
		MemoryRequest:      "64Mi",
		CPULimit:           "500m",
		MemoryLimit:        "512Mi",
		WorkspaceSizeLimit: "256Mi",
		HTTPClient:         srv.Client(),
	})
	if err != nil {
		t.Fatalf("executor: %v", err)
	}

	out, err := exec.Execute(context.Background(), SandboxRun{
		UserID: "u1", TaskSlug: "task", RunID: "run-1",
		Image: "python:3.12-slim", Script: "python -c 'print(1)'",
		Env:     map[string]string{"MODE": "test"},
		Timeout: time.Minute, MaxOutputBytes: 1024,
		Heartbeat: func(_ context.Context, hb SandboxHeartbeat) {
			heartbeatPhases = append(heartbeatPhases, hb.Phase)
		},
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if out.Status != "succeeded" || out.Output != "hello from argo\n" || out.JobName == "" {
		t.Fatalf("out = %+v", out)
	}
	if len(heartbeatPhases) == 0 || heartbeatPhases[0] != "complete" {
		t.Fatalf("heartbeat phases = %v", heartbeatPhases)
	}

	if workflowSpec["apiVersion"] != "argoproj.io/v1alpha1" || workflowSpec["kind"] != "Workflow" {
		t.Fatalf("workflow identity = %+v", workflowSpec)
	}
	spec := workflowSpec["spec"].(map[string]any)
	if spec["entrypoint"] != "sandbox" || spec["serviceAccountName"] != "rowboat-sandbox" ||
		spec["automountServiceAccountToken"] != false || spec["activeDeadlineSeconds"].(float64) != 65 {
		t.Fatalf("workflow spec = %+v", spec)
	}
	if spec["hostNetwork"] != false || !strings.Contains(spec["podSpecPatch"].(string), `"hostPID":false`) {
		t.Fatalf("workflow pod isolation fields = %+v", spec)
	}
	metadata := workflowSpec["metadata"].(map[string]any)
	labels := metadata["labels"].(map[string]any)
	if labels["rowboat.io/run-id"] != "run-1" || labels["rowboat.io/task-slug"] != "task" {
		t.Fatalf("workflow labels = %+v", labels)
	}
	executor := spec["executor"].(map[string]any)
	if executor["serviceAccountName"] != "rowboat-sandbox" {
		t.Fatalf("workflow executor = %+v", executor)
	}
	podMetadata := spec["podMetadata"].(map[string]any)
	podLabels := podMetadata["labels"].(map[string]any)
	if podLabels["app.kubernetes.io/name"] != "rowboat-sandbox" {
		t.Fatalf("pod labels = %+v", podLabels)
	}
	ttl := spec["ttlStrategy"].(map[string]any)
	if ttl["secondsAfterCompletion"].(float64) != 120 {
		t.Fatalf("ttlStrategy = %+v", ttl)
	}
	volumes := spec["volumes"].([]any)
	workspace := volumes[0].(map[string]any)
	emptyDir := workspace["emptyDir"].(map[string]any)
	if emptyDir["sizeLimit"] != "256Mi" {
		t.Fatalf("workspace volume = %+v", workspace)
	}
	templates := spec["templates"].([]any)
	container := templates[0].(map[string]any)["container"].(map[string]any)
	if container["image"] != "python:3.12-slim" || container["workingDir"] != "/workspace" {
		t.Fatalf("container = %+v", container)
	}
	security := container["securityContext"].(map[string]any)
	if security["privileged"] != false || security["readOnlyRootFilesystem"] != true || security["allowPrivilegeEscalation"] != false {
		t.Fatalf("container security context = %+v", security)
	}
	if len(container["volumeMounts"].([]any)) != 2 || len(volumes) != 2 {
		t.Fatalf("sandbox must have bounded workspace and tmp volumes: container=%+v volumes=%+v", container, volumes)
	}
	resources := container["resources"].(map[string]any)
	requests := resources["requests"].(map[string]any)
	limits := resources["limits"].(map[string]any)
	if requests["cpu"] != "50m" || requests["memory"] != "64Mi" ||
		limits["cpu"] != "500m" || limits["memory"] != "512Mi" {
		t.Fatalf("resources = %+v", resources)
	}
	if !envContains(container["env"].([]any), "MODE", "test") ||
		!envContains(container["env"].([]any), "ROWBOAT_RUN_ID", "run-1") {
		t.Fatalf("container env = %+v", container["env"])
	}
	if !strings.Contains(container["args"].([]any)[0].(string), "print(1)") {
		t.Fatalf("container args = %+v", container["args"])
	}
}

func TestArgoSandboxExecutorRequiresServiceAccount(t *testing.T) {
	_, err := NewArgoSandboxExecutor(KubernetesSandboxConfig{
		APIServer:   srvURLForConfigTest,
		BearerToken: "token",
		Namespace:   "sandbox-ns",
	})
	if err == nil {
		t.Fatal("missing service account must be rejected")
	}
}

func TestArgoSandboxExecutorWorkflowSpecUsesDefaultsAndSanitizesLabels(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	defer srv.Close()
	exec := newArgoTestExecutor(t, srv, "ns")

	workflow := exec.workflowSpec("wf", SandboxRun{
		UserID: "u", TaskSlug: "Daily/Summary!", RunID: "",
		Image: "alpine:3.20", Script: "echo ok", Timeout: 30 * time.Second,
	})
	metadata := workflow["metadata"].(map[string]any)
	labels := metadata["labels"].(map[string]string)
	if labels["rowboat.io/run-id"] != "unknown" || labels["rowboat.io/task-slug"] != "daily-summary" {
		t.Fatalf("labels = %+v", labels)
	}

	spec := workflow["spec"].(map[string]any)
	if spec["activeDeadlineSeconds"] != int64(35) ||
		spec["serviceAccountName"] != "sandbox" ||
		spec["automountServiceAccountToken"] != false {
		t.Fatalf("workflow defaults = %+v", spec)
	}
	ttl := spec["ttlStrategy"].(map[string]any)
	if ttl["secondsAfterCompletion"] != int32(600) {
		t.Fatalf("ttlStrategy = %+v", ttl)
	}
	securityContext := spec["securityContext"].(map[string]any)
	seccomp := securityContext["seccompProfile"].(map[string]string)
	if securityContext["runAsNonRoot"] != true || securityContext["runAsUser"] != 65532 || seccomp["type"] != "RuntimeDefault" {
		t.Fatalf("securityContext = %+v", securityContext)
	}
	podMetadata := spec["podMetadata"].(map[string]any)
	podLabels := podMetadata["labels"].(map[string]string)
	if podLabels["rowboat.io/task-slug"] != "daily-summary" {
		t.Fatalf("pod labels = %+v", podLabels)
	}
	volumes := spec["volumes"].([]map[string]any)
	emptyDir := volumes[0]["emptyDir"].(map[string]string)
	if emptyDir["sizeLimit"] != "1Gi" {
		t.Fatalf("workspace default = %+v", volumes[0])
	}
	container := spec["templates"].([]map[string]any)[0]["container"].(map[string]any)
	if container["imagePullPolicy"] != "IfNotPresent" || container["image"] != "alpine:3.20" {
		t.Fatalf("container defaults = %+v", container)
	}
	if _, ok := container["resources"]; ok {
		t.Fatalf("resources must be omitted when unset: %+v", container["resources"])
	}
	if !envMapContains(container["env"].([]map[string]string), "ROWBOAT_TASK_SLUG", "Daily/Summary!") {
		t.Fatalf("container env = %+v", container["env"])
	}
}

func TestArgoSandboxExecutorReturnsFailedWorkflowLogs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows/"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": map[string]any{"phase": "Failed", "message": "deadline exceeded"},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]any{{"metadata": map[string]any{"name": "pod-1"}}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods/pod-1":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": map[string]any{
					"containerStatuses": []map[string]any{{"name": "main", "state": map[string]any{"terminated": map[string]any{"exitCode": 42}}}},
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods/pod-1/log":
			_, _ = w.Write([]byte("boom\n"))
		default:
			t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer srv.Close()

	exec, err := NewArgoSandboxExecutor(KubernetesSandboxConfig{
		APIServer: srv.URL, BearerToken: "token", Namespace: "ns", ServiceAccountName: "sandbox", HTTPClient: srv.Client(),
	})
	if err != nil {
		t.Fatalf("executor: %v", err)
	}
	out, err := exec.Execute(context.Background(), SandboxRun{
		UserID: "u", TaskSlug: "task", RunID: "run", Image: "python", Script: "exit 42",
		Timeout: time.Minute, MaxOutputBytes: 1024,
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if out.Status != "failed" || out.ExitCode != 42 || out.Output != "boom\n" || !out.TimedOut {
		t.Fatalf("out = %+v", out)
	}
}

func TestArgoSandboxExecutorCreateConflictThenReadsExistingWorkflow(t *testing.T) {
	var getWorkflowCount int
	var postCount int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows/"):
			getWorkflowCount++
			if getWorkflowCount == 1 {
				http.NotFound(w, r)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"status": map[string]any{"phase": "Succeeded"}})
		case r.Method == http.MethodPost && r.URL.Path == "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows":
			postCount++
			w.WriteHeader(http.StatusConflict)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods":
			_ = json.NewEncoder(w).Encode(map[string]any{"items": []map[string]any{}})
		default:
			t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer srv.Close()

	exec := newArgoTestExecutor(t, srv, "ns")
	out, err := exec.Execute(context.Background(), SandboxRun{
		UserID: "u", TaskSlug: "task", RunID: "run", Image: "python", Script: "echo ok",
		Timeout: time.Minute, MaxOutputBytes: 1024,
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if postCount != 1 || getWorkflowCount != 2 {
		t.Fatalf("postCount=%d getWorkflowCount=%d, want 1 post and 2 workflow reads", postCount, getWorkflowCount)
	}
	if out.Status != "succeeded" || out.Output != "" {
		t.Fatalf("out = %+v", out)
	}
}

func TestArgoSandboxExecutorReusesExistingWorkflow(t *testing.T) {
	var postCount int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"status": map[string]any{"phase": "Succeeded"}})
		case r.Method == http.MethodPost && r.URL.Path == "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows":
			postCount++
			w.WriteHeader(http.StatusConflict)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods":
			_ = json.NewEncoder(w).Encode(map[string]any{"items": []map[string]any{}})
		default:
			t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer srv.Close()

	exec, err := NewArgoSandboxExecutor(KubernetesSandboxConfig{
		APIServer: srv.URL, BearerToken: "token", Namespace: "ns", ServiceAccountName: "sandbox", HTTPClient: srv.Client(),
	})
	if err != nil {
		t.Fatalf("executor: %v", err)
	}
	out, err := exec.Execute(context.Background(), SandboxRun{
		UserID: "u", TaskSlug: "task", RunID: "run", Image: "python", Script: "echo ok",
		Timeout: time.Minute, MaxOutputBytes: 1024,
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if postCount != 0 {
		t.Fatalf("existing workflow must not be posted again, postCount=%d", postCount)
	}
	if out.Status != "succeeded" || out.Output != "" {
		t.Fatalf("out = %+v", out)
	}
}

func TestArgoSandboxExecutorTruncatesLogsAndUsesNonWaitContainer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"status": map[string]any{"phase": "Succeeded"}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]any{{"metadata": map[string]any{"name": "pod-1"}}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods/pod-1":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": map[string]any{
					"containerStatuses": []map[string]any{
						{"name": "wait", "state": map[string]any{"terminated": map[string]any{"exitCode": 0}}},
						{"name": "sandbox-main", "state": map[string]any{"terminated": map[string]any{"exitCode": 0}}},
					},
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods/pod-1/log":
			if r.URL.Query().Get("container") != "sandbox-main" {
				t.Fatalf("log container = %q", r.URL.Query().Get("container"))
			}
			_, _ = w.Write([]byte("abcdef"))
		default:
			t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer srv.Close()

	exec, err := NewArgoSandboxExecutor(KubernetesSandboxConfig{
		APIServer: srv.URL, BearerToken: "token", Namespace: "ns", ServiceAccountName: "sandbox", HTTPClient: srv.Client(),
	})
	if err != nil {
		t.Fatalf("executor: %v", err)
	}
	out, err := exec.Execute(context.Background(), SandboxRun{
		UserID: "u", TaskSlug: "task", RunID: "run", Image: "python", Script: "echo ok",
		Timeout: time.Minute, MaxOutputBytes: 3,
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if out.Status != "succeeded" || out.Output != "abc" || !out.OutputTruncated {
		t.Fatalf("out = %+v", out)
	}
}

func TestArgoSandboxExecutorDeletesWorkflowOnContextCancel(t *testing.T) {
	var created bool
	var deleted bool
	ctx, cancel := context.WithCancel(context.Background())
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows/"):
			if !created {
				http.NotFound(w, r)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"status": map[string]any{"phase": "Running"}})
		case r.Method == http.MethodPost && r.URL.Path == "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows":
			created = true
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"metadata":{"name":"created"}}`))
		case r.Method == http.MethodDelete && strings.Contains(r.URL.Path, "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows/"):
			deleted = true
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer srv.Close()

	exec, err := NewArgoSandboxExecutor(KubernetesSandboxConfig{
		APIServer: srv.URL, BearerToken: "token", Namespace: "ns", ServiceAccountName: "sandbox",
		PollInterval: time.Hour, HTTPClient: srv.Client(),
	})
	if err != nil {
		t.Fatalf("executor: %v", err)
	}
	_, err = exec.Execute(ctx, SandboxRun{
		UserID: "u", TaskSlug: "task", RunID: "run", Image: "python", Script: "sleep 10",
		Timeout: time.Minute, MaxOutputBytes: 1024,
		Heartbeat: func(context.Context, SandboxHeartbeat) {
			cancel()
		},
	})
	if err == nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("execute err = %v, want context.Canceled", err)
	}
	if !created || !deleted {
		t.Fatalf("created=%v deleted=%v, want both true", created, deleted)
	}
}

func TestArgoSandboxExecutorCreateErrorRedactsKubernetesBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows/"):
			http.NotFound(w, r)
		case r.Method == http.MethodPost && r.URL.Path == "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows":
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte("no workflow permissions"))
		default:
			t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer srv.Close()

	exec, err := NewArgoSandboxExecutor(KubernetesSandboxConfig{
		APIServer: srv.URL, BearerToken: "token", Namespace: "ns", ServiceAccountName: "sandbox", HTTPClient: srv.Client(),
	})
	if err != nil {
		t.Fatalf("executor: %v", err)
	}
	_, err = exec.Execute(context.Background(), SandboxRun{
		UserID: "u", TaskSlug: "task", RunID: "run", Image: "python", Script: "echo ok",
		Timeout: time.Minute, MaxOutputBytes: 1024,
	})
	if err == nil || !strings.Contains(err.Error(), "kubernetes status 403") || strings.Contains(err.Error(), "no workflow permissions") {
		t.Fatalf("err = %v", err)
	}
}

func TestArgoSandboxExecutorReadWorkflowErrorRedactsKubernetesBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || !strings.Contains(r.URL.Path, "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows/") {
			t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
		}
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("argo api down"))
	}))
	defer srv.Close()

	exec := newArgoTestExecutor(t, srv, "ns")
	_, err := exec.Execute(context.Background(), SandboxRun{
		UserID: "u", TaskSlug: "task", RunID: "run", Image: "python", Script: "echo ok",
		Timeout: time.Minute, MaxOutputBytes: 1024,
	})
	if err == nil || !strings.Contains(err.Error(), "read argo sandbox workflow: kubernetes status 500") || strings.Contains(err.Error(), "argo api down") {
		t.Fatalf("err = %v", err)
	}
}

func TestArgoSandboxExecutorMalformedWorkflowStatusReturnsDecodeError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || !strings.Contains(r.URL.Path, "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows/") {
			t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
		}
		_, _ = w.Write([]byte(`{"status":`))
	}))
	defer srv.Close()

	exec := newArgoTestExecutor(t, srv, "ns")
	_, err := exec.Execute(context.Background(), SandboxRun{
		UserID: "u", TaskSlug: "task", RunID: "run", Image: "python", Script: "echo ok",
		Timeout: time.Minute, MaxOutputBytes: 1024,
	})
	if err == nil || !strings.Contains(err.Error(), "unexpected EOF") {
		t.Fatalf("err = %v", err)
	}
}

func TestArgoSandboxExecutorListPodsErrorPropagates(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"status": map[string]any{"phase": "Succeeded"}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods":
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte("cannot list pods"))
		default:
			t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer srv.Close()

	exec := newArgoTestExecutor(t, srv, "ns")
	_, err := exec.Execute(context.Background(), SandboxRun{
		UserID: "u", TaskSlug: "task", RunID: "run", Image: "python", Script: "echo ok",
		Timeout: time.Minute, MaxOutputBytes: 1024,
	})
	if err == nil || !strings.Contains(err.Error(), "list argo sandbox pods: kubernetes status 403") || strings.Contains(err.Error(), "cannot list pods") {
		t.Fatalf("err = %v", err)
	}
}

func TestArgoSandboxExecutorLogErrorRedactsKubernetesBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"status": map[string]any{"phase": "Succeeded"}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]any{{"metadata": map[string]any{"name": "pod-1"}}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods/pod-1":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": map[string]any{
					"containerStatuses": []map[string]any{{"name": "main"}},
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods/pod-1/log":
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte("log stream unavailable"))
		default:
			t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer srv.Close()

	exec := newArgoTestExecutor(t, srv, "ns")
	_, err := exec.Execute(context.Background(), SandboxRun{
		UserID: "u", TaskSlug: "task", RunID: "run", Image: "python", Script: "echo ok",
		Timeout: time.Minute, MaxOutputBytes: 1024,
	})
	if err == nil || !strings.Contains(err.Error(), "read argo sandbox logs: kubernetes status 502") || strings.Contains(err.Error(), "log stream unavailable") {
		t.Fatalf("err = %v", err)
	}
}

func TestArgoSandboxExecutorMainContainerFallsBackToMainWhenPodReadFails(t *testing.T) {
	var logContainer string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"status": map[string]any{"phase": "Succeeded"}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]any{{"metadata": map[string]any{"name": "pod-1"}}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods/pod-1":
			w.WriteHeader(http.StatusServiceUnavailable)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods/pod-1/log":
			logContainer = r.URL.Query().Get("container")
			_, _ = w.Write([]byte("ok\n"))
		default:
			t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer srv.Close()

	exec := newArgoTestExecutor(t, srv, "ns")
	out, err := exec.Execute(context.Background(), SandboxRun{
		UserID: "u", TaskSlug: "task", RunID: "run", Image: "python", Script: "echo ok",
		Timeout: time.Minute, MaxOutputBytes: 1024,
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if logContainer != "main" || out.Status != "succeeded" || out.Output != "ok\n" {
		t.Fatalf("logContainer=%q out=%+v", logContainer, out)
	}
}

func TestArgoSandboxExecutorExitCodeUsesFirstTerminatedNonWaitContainer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]any{{"metadata": map[string]any{"name": "pod-1"}}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods/pod-1":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": map[string]any{
					"containerStatuses": []map[string]any{
						{"name": "wait", "state": map[string]any{"terminated": map[string]any{"exitCode": 0}}},
						{"name": "sandbox-main", "state": map[string]any{"terminated": map[string]any{"exitCode": 23}}},
					},
				},
			})
		default:
			t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer srv.Close()

	exec := newArgoTestExecutor(t, srv, "ns")
	code, err := exec.exitCode(context.Background(), "wf")
	if err != nil {
		t.Fatalf("exitCode: %v", err)
	}
	if code != 23 {
		t.Fatalf("exit code = %d, want 23", code)
	}
}

func TestArgoSandboxExecutorDeleteWorkflowHandlesNotFoundAndErrors(t *testing.T) {
	for _, tc := range []struct {
		name      string
		status    int
		wantError string
	}{
		{name: "not-found", status: http.StatusNotFound},
		{name: "server-error", status: http.StatusInternalServerError, wantError: "delete argo sandbox workflow: kubernetes status 500"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodDelete || r.URL.Path != "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows/wf" {
					t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
				}
				if r.URL.Query().Get("propagationPolicy") != "Background" {
					t.Fatalf("propagationPolicy = %q", r.URL.Query().Get("propagationPolicy"))
				}
				w.WriteHeader(tc.status)
			}))
			defer srv.Close()

			exec := newArgoTestExecutor(t, srv, "ns")
			err := exec.deleteWorkflow(context.Background(), "wf")
			if tc.wantError == "" && err != nil {
				t.Fatalf("deleteWorkflow: %v", err)
			}
			if tc.wantError != "" && (err == nil || !strings.Contains(err.Error(), tc.wantError)) {
				t.Fatalf("deleteWorkflow err = %v, want %q", err, tc.wantError)
			}
		})
	}
}

func TestArgoSandboxExecutorStatusMapping(t *testing.T) {
	for _, tc := range []struct {
		name         string
		phase        string
		message      string
		wantPhase    string
		wantMessage  string
		wantTimedOut bool
	}{
		{name: "succeeded", phase: "Succeeded", message: "done", wantPhase: "complete", wantMessage: "done"},
		{name: "failed", phase: "Failed", message: "container exited", wantPhase: "failed", wantMessage: "container exited"},
		{name: "deadline", phase: "Error", message: "pod exceeded active deadline", wantPhase: "failed", wantMessage: "pod exceeded active deadline", wantTimedOut: true},
		{name: "running", phase: "Running", wantPhase: "running", wantMessage: "sandbox workflow running"},
		{name: "empty", phase: "", wantPhase: "pending", wantMessage: "sandbox workflow pending"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || !strings.Contains(r.URL.Path, "/apis/argoproj.io/v1alpha1/namespaces/ns/workflows/") {
					t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"status": map[string]any{"phase": tc.phase, "message": tc.message},
				})
			}))
			defer srv.Close()

			exec, err := NewArgoSandboxExecutor(KubernetesSandboxConfig{
				APIServer: srv.URL, BearerToken: "token", Namespace: "ns", ServiceAccountName: "sandbox", HTTPClient: srv.Client(),
			})
			if err != nil {
				t.Fatalf("executor: %v", err)
			}
			status, err := exec.getWorkflowStatus(context.Background(), "wf")
			if err != nil {
				t.Fatalf("status: %v", err)
			}
			if status.Phase != tc.wantPhase || status.TimedOut != tc.wantTimedOut {
				t.Fatalf("status = %+v, want phase=%s timedOut=%v", status, tc.wantPhase, tc.wantTimedOut)
			}
			if status.Message != tc.wantMessage {
				t.Fatalf("status message = %q, want %q", status.Message, tc.wantMessage)
			}
		})
	}
}

func newLiveArgoSandboxExecutor(t *testing.T, ttlSeconds int32) (*ArgoSandboxExecutor, string) {
	t.Helper()
	if os.Getenv("ROWBOAT_ARGO_SANDBOX_LIVE") != "1" {
		t.Skip("set ROWBOAT_ARGO_SANDBOX_LIVE=1 to run against a live Argo Workflows API")
	}
	apiServer := os.Getenv("ROWBOAT_ARGO_SANDBOX_API_SERVER")
	namespace := os.Getenv("ROWBOAT_ARGO_SANDBOX_NAMESPACE")
	serviceAccount := os.Getenv("ROWBOAT_ARGO_SANDBOX_SERVICE_ACCOUNT")
	if apiServer == "" || namespace == "" || serviceAccount == "" {
		t.Fatal("ROWBOAT_ARGO_SANDBOX_API_SERVER, ROWBOAT_ARGO_SANDBOX_NAMESPACE, and ROWBOAT_ARGO_SANDBOX_SERVICE_ACCOUNT are required")
	}
	image := os.Getenv("ROWBOAT_ARGO_SANDBOX_IMAGE")
	if image == "" {
		image = "redis:7-alpine"
	}
	token := os.Getenv("ROWBOAT_ARGO_SANDBOX_TOKEN")
	if token == "" {
		token = "dummy"
	}

	exec, err := NewArgoSandboxExecutor(KubernetesSandboxConfig{
		APIServer:          apiServer,
		BearerToken:        token,
		Namespace:          namespace,
		CAFile:             os.Getenv("ROWBOAT_ARGO_SANDBOX_CA_FILE"),
		ServiceAccountName: serviceAccount,
		ImagePullPolicy:    "IfNotPresent",
		PollInterval:       time.Second,
		TTLSeconds:         ttlSeconds,
		CPURequest:         "25m",
		MemoryRequest:      "32Mi",
		CPULimit:           "250m",
		MemoryLimit:        "128Mi",
		WorkspaceSizeLimit: "64Mi",
	})
	if err != nil {
		t.Fatalf("executor: %v", err)
	}
	return exec, image
}

func TestArgoSandboxExecutorLiveSmoke(t *testing.T) {
	exec, image := newLiveArgoSandboxExecutor(t, 60)
	runID := "argo-live-smoke-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	run := SandboxRun{
		UserID: "live-smoke", TaskSlug: "sandbox", RunID: runID,
		Image: image, Script: "echo rowboat-argo-sandbox-smoke",
		Timeout: 90 * time.Second, MaxOutputBytes: 4096,
	}
	workflowName := exec.kube.jobName(run)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = exec.deleteWorkflow(ctx, workflowName)
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	out, err := exec.Execute(ctx, run)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if out.Status != "succeeded" || !strings.Contains(out.Output, "rowboat-argo-sandbox-smoke") {
		t.Fatalf("out = %+v", out)
	}
}

func TestArgoSandboxExecutorLiveScenarios(t *testing.T) {
	exec, image := newLiveArgoSandboxExecutor(t, 120)
	for _, tc := range []struct {
		name          string
		script        string
		env           map[string]string
		maxOutput     int
		wantStatus    string
		wantOutput    string
		wantMaxOutput int
		wantExitCode  int
		wantTruncated bool
	}{
		{
			name: "env", script: "echo env=$ROWBOAT_TEST_VALUE",
			env:       map[string]string{"ROWBOAT_TEST_VALUE": "argo-env-ok"},
			maxOutput: 4096, wantStatus: "succeeded", wantOutput: "env=argo-env-ok",
		},
		{
			name: "failure", script: "echo before-fail; exit 7",
			maxOutput: 4096, wantStatus: "failed", wantOutput: "before-fail", wantExitCode: 7,
		},
		{
			name: "truncation", script: "printf abcdefgh",
			maxOutput: 4, wantStatus: "succeeded", wantMaxOutput: 4, wantTruncated: true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			runID := "argo-live-" + tc.name + "-" + strconv.FormatInt(time.Now().UnixNano(), 36)
			run := SandboxRun{
				UserID: "live-scenarios", TaskSlug: "sandbox-" + tc.name, RunID: runID,
				Image: image, Script: tc.script, Env: tc.env,
				Timeout: 90 * time.Second, MaxOutputBytes: tc.maxOutput,
			}
			workflowName := exec.kube.jobName(run)
			t.Cleanup(func() {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				_ = exec.deleteWorkflow(ctx, workflowName)
			})

			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			out, err := exec.Execute(ctx, run)
			if err != nil {
				t.Fatalf("execute: %v", err)
			}
			if out.Status != tc.wantStatus || out.ExitCode != tc.wantExitCode ||
				!strings.Contains(out.Output, tc.wantOutput) || out.OutputTruncated != tc.wantTruncated {
				t.Fatalf("out = %+v, want status=%s exit=%d output~%q truncated=%v", out, tc.wantStatus, tc.wantExitCode, tc.wantOutput, tc.wantTruncated)
			}
			if tc.wantMaxOutput > 0 && len(out.Output) != tc.wantMaxOutput {
				t.Fatalf("output length = %d, want %d; out = %+v", len(out.Output), tc.wantMaxOutput, out)
			}
		})
	}
}

func envContains(raw []any, name, value string) bool {
	for _, item := range raw {
		env := item.(map[string]any)
		if env["name"] == name && env["value"] == value {
			return true
		}
	}
	return false
}

func envMapContains(raw []map[string]string, name, value string) bool {
	for _, env := range raw {
		if env["name"] == name && env["value"] == value {
			return true
		}
	}
	return false
}

func newArgoTestExecutor(t *testing.T, srv *httptest.Server, namespace string) *ArgoSandboxExecutor {
	t.Helper()
	exec, err := NewArgoSandboxExecutor(KubernetesSandboxConfig{
		APIServer:          srv.URL,
		BearerToken:        "token",
		Namespace:          namespace,
		ServiceAccountName: "sandbox",
		PollInterval:       time.Millisecond,
		HTTPClient:         srv.Client(),
	})
	if err != nil {
		t.Fatalf("executor: %v", err)
	}
	return exec
}

const srvURLForConfigTest = "http://127.0.0.1:1"
