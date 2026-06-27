package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestKubernetesSandboxExecutorCreatesJobAndReturnsLogs(t *testing.T) {
	var created bool
	var jobSpec map[string]any
	var heartbeatPhases []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/apis/batch/v1/namespaces/sandbox-ns/jobs/"):
			if !created {
				http.NotFound(w, r)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": map[string]any{
					"conditions": []map[string]any{{"type": "Complete", "status": "True", "message": "done"}},
				},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/apis/batch/v1/namespaces/sandbox-ns/jobs":
			created = true
			if err := json.NewDecoder(r.Body).Decode(&jobSpec); err != nil {
				t.Fatalf("decode job spec: %v", err)
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"metadata":{"name":"created"}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/sandbox-ns/pods":
			if got := r.URL.Query().Get("labelSelector"); !strings.HasPrefix(got, "job-name=rb-sandbox-run-1-") {
				t.Fatalf("labelSelector = %q", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]any{{"metadata": map[string]any{"name": "pod-1"}}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/sandbox-ns/pods/pod-1/log":
			_, _ = w.Write([]byte("hello from sandbox\n"))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/sandbox-ns/pods/pod-1":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": map[string]any{
					"containerStatuses": []map[string]any{{
						"name":  "sandbox",
						"state": map[string]any{"terminated": map[string]any{"exitCode": 0}},
					}},
				},
			})
		default:
			t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer srv.Close()

	exec, err := NewKubernetesSandboxExecutor(KubernetesSandboxConfig{
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
		Timeout: time.Minute, MaxOutputBytes: 1024,
		Heartbeat: func(_ context.Context, hb SandboxHeartbeat) {
			heartbeatPhases = append(heartbeatPhases, hb.Phase)
		},
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if out.Status != "succeeded" || out.Output != "hello from sandbox\n" || out.JobName == "" {
		t.Fatalf("out = %+v", out)
	}
	if len(heartbeatPhases) == 0 || heartbeatPhases[0] != "complete" {
		t.Fatalf("heartbeat phases = %v", heartbeatPhases)
	}

	spec := jobSpec["spec"].(map[string]any)
	if spec["ttlSecondsAfterFinished"].(float64) != 120 || spec["activeDeadlineSeconds"].(float64) != 65 {
		t.Fatalf("job timing spec = %+v", spec)
	}
	template := spec["template"].(map[string]any)
	podSpec := template["spec"].(map[string]any)
	if podSpec["serviceAccountName"] != "rowboat-sandbox" || podSpec["automountServiceAccountToken"] != false {
		t.Fatalf("pod spec = %+v", podSpec)
	}
	containers := podSpec["containers"].([]any)
	container := containers[0].(map[string]any)
	if container["image"] != "python:3.12-slim" || container["workingDir"] != "/workspace" {
		t.Fatalf("container = %+v", container)
	}
	if !strings.Contains(container["args"].([]any)[0].(string), "print(1)") {
		t.Fatalf("container args = %+v", container["args"])
	}
}

func TestKubernetesSandboxExecutorReturnsFailedJobLogs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/apis/batch/v1/namespaces/ns/jobs/"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": map[string]any{
					"conditions": []map[string]any{{"type": "Failed", "status": "True", "reason": "BackoffLimitExceeded"}},
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]any{{"metadata": map[string]any{"name": "pod-1"}}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods/pod-1/log":
			_, _ = w.Write([]byte("boom\n"))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/namespaces/ns/pods/pod-1":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": map[string]any{
					"containerStatuses": []map[string]any{{
						"name":  "sandbox",
						"state": map[string]any{"terminated": map[string]any{"exitCode": 42}},
					}},
				},
			})
		default:
			t.Fatalf("unexpected kube request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer srv.Close()

	exec, err := NewKubernetesSandboxExecutor(KubernetesSandboxConfig{
		APIServer: srv.URL, BearerToken: "token", Namespace: "ns", HTTPClient: srv.Client(),
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
	if out.Status != "failed" || out.ExitCode != 42 || out.Output != "boom\n" {
		t.Fatalf("out = %+v", out)
	}
}

func TestKubernetesSandboxExecutorLiveSmoke(t *testing.T) {
	if os.Getenv("ROWBOAT_K8S_SANDBOX_LIVE") != "1" {
		t.Skip("set ROWBOAT_K8S_SANDBOX_LIVE=1 to run against a live Kubernetes API")
	}
	apiServer := os.Getenv("ROWBOAT_K8S_SANDBOX_API_SERVER")
	namespace := os.Getenv("ROWBOAT_K8S_SANDBOX_NAMESPACE")
	if apiServer == "" || namespace == "" {
		t.Fatal("ROWBOAT_K8S_SANDBOX_API_SERVER and ROWBOAT_K8S_SANDBOX_NAMESPACE are required")
	}
	image := os.Getenv("ROWBOAT_K8S_SANDBOX_IMAGE")
	if image == "" {
		image = "redis:7-alpine"
	}
	token := os.Getenv("ROWBOAT_K8S_SANDBOX_TOKEN")
	if token == "" {
		token = "dummy"
	}

	exec, err := NewKubernetesSandboxExecutor(KubernetesSandboxConfig{
		APIServer:          apiServer,
		BearerToken:        token,
		Namespace:          namespace,
		ImagePullPolicy:    "IfNotPresent",
		PollInterval:       time.Second,
		TTLSeconds:         60,
		CPURequest:         "25m",
		MemoryRequest:      "32Mi",
		CPULimit:           "250m",
		MemoryLimit:        "128Mi",
		WorkspaceSizeLimit: "64Mi",
	})
	if err != nil {
		t.Fatalf("executor: %v", err)
	}
	runID := "live-smoke-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	run := SandboxRun{
		UserID: "live-smoke", TaskSlug: "sandbox", RunID: runID,
		Image: image, Script: "echo rowboat-sandbox-smoke",
		Timeout: 90 * time.Second, MaxOutputBytes: 4096,
	}
	jobName := exec.jobName(run)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = exec.deleteJob(ctx, jobName)
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	out, err := exec.Execute(ctx, run)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if out.Status != "succeeded" || !strings.Contains(out.Output, "rowboat-sandbox-smoke") {
		t.Fatalf("out = %+v", out)
	}
}
