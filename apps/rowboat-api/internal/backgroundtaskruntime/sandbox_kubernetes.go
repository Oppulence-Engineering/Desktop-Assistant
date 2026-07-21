package backgroundtaskruntime

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	defaultKubernetesTokenPath     = "/var/run/secrets/kubernetes.io/serviceaccount/token"
	defaultKubernetesNamespacePath = "/var/run/secrets/kubernetes.io/serviceaccount/namespace"
	defaultKubernetesCAPath        = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
)

var dnsLabelCleaner = regexp.MustCompile(`[^a-z0-9-]+`)

// KubernetesSandboxConfig configures the dependency-free Kubernetes Job
// executor. Empty APIServer/Token/Namespace values resolve from the in-cluster
// service-account environment.
type KubernetesSandboxConfig struct {
	APIServer          string
	BearerToken        string
	Namespace          string
	CAFile             string
	ServiceAccountName string
	ImagePullPolicy    string
	PollInterval       time.Duration
	BackoffLimit       int32
	TTLSeconds         int32
	CPURequest         string
	MemoryRequest      string
	CPULimit           string
	MemoryLimit        string
	WorkspaceSizeLimit string
	HTTPClient         *http.Client
}

// KubernetesSandboxExecutor runs sandbox.run requests as namespaced Jobs.
type KubernetesSandboxExecutor struct {
	cfg       KubernetesSandboxConfig
	client    *http.Client
	apiServer string
	token     string
	namespace string
}

// NewKubernetesSandboxExecutor builds a Job-backed sandbox executor.
func NewKubernetesSandboxExecutor(cfg KubernetesSandboxConfig) (*KubernetesSandboxExecutor, error) {
	apiServer := strings.TrimRight(cfg.APIServer, "/")
	if apiServer == "" {
		host := os.Getenv("KUBERNETES_SERVICE_HOST")
		port := os.Getenv("KUBERNETES_SERVICE_PORT_HTTPS")
		if port == "" {
			port = os.Getenv("KUBERNETES_SERVICE_PORT")
		}
		if host == "" {
			return nil, errors.New("KUBERNETES_SERVICE_HOST is not set")
		}
		if port == "" {
			port = "443"
		}
		apiServer = "https://" + host + ":" + port
	}

	token := cfg.BearerToken
	if token == "" {
		raw, err := os.ReadFile(defaultKubernetesTokenPath)
		if err != nil {
			return nil, fmt.Errorf("read kubernetes service account token: %w", err)
		}
		token = strings.TrimSpace(string(raw))
	}
	if token == "" {
		return nil, errors.New("kubernetes service account token is empty")
	}

	namespace := strings.TrimSpace(cfg.Namespace)
	if namespace == "" {
		if raw := os.Getenv("POD_NAMESPACE"); raw != "" {
			namespace = raw
		}
	}
	if namespace == "" {
		raw, err := os.ReadFile(defaultKubernetesNamespacePath)
		if err != nil {
			return nil, fmt.Errorf("read kubernetes namespace: %w", err)
		}
		namespace = strings.TrimSpace(string(raw))
	}
	if namespace == "" {
		return nil, errors.New("kubernetes namespace is empty")
	}

	httpClient := cfg.HTTPClient
	if httpClient == nil {
		tr := http.DefaultTransport.(*http.Transport).Clone()
		caFile := cfg.CAFile
		if caFile == "" {
			caFile = defaultKubernetesCAPath
		}
		if raw, err := os.ReadFile(caFile); err == nil && len(raw) > 0 {
			pool := x509.NewCertPool()
			if pool.AppendCertsFromPEM(raw) {
				tr.TLSClientConfig = &tls.Config{RootCAs: pool}
			}
		}
		httpClient = &http.Client{Transport: tr, Timeout: 30 * time.Second}
	}
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 5 * time.Second
	}
	if cfg.ImagePullPolicy == "" {
		cfg.ImagePullPolicy = "IfNotPresent"
	}

	return &KubernetesSandboxExecutor{
		cfg: cfg, client: httpClient, apiServer: apiServer, token: token, namespace: namespace,
	}, nil
}

// Execute runs one sandbox request as a Kubernetes Job.
func (e *KubernetesSandboxExecutor) Execute(ctx context.Context, run SandboxRun) (SandboxResult, error) {
	if run.Timeout <= 0 {
		run.Timeout = time.Minute
	}
	jobName := e.jobName(run)
	if err := e.ensureJob(ctx, jobName, run); err != nil {
		return SandboxResult{}, err
	}

	ticker := time.NewTicker(e.cfg.PollInterval)
	defer ticker.Stop()
	deadline := time.NewTimer(run.Timeout + 15*time.Second)
	defer deadline.Stop()

	for {
		status, err := e.getJobStatus(ctx, jobName)
		if err != nil {
			return SandboxResult{}, err
		}
		e.heartbeat(ctx, run, jobName, status.Phase, status.Message)
		switch status.Phase {
		case "complete", "failed":
			return e.result(ctx, jobName, status, run.MaxOutputBytes)
		}
		select {
		case <-ctx.Done():
			_ = e.deleteJob(context.Background(), jobName)
			return SandboxResult{}, ctx.Err()
		case <-deadline.C:
			_ = e.deleteJob(context.Background(), jobName)
			logs, truncated, _ := e.logs(ctx, jobName, run.MaxOutputBytes)
			return SandboxResult{
				JobName: jobName, Status: "timeout", Output: logs, OutputTruncated: truncated, TimedOut: true,
			}, nil
		case <-ticker.C:
		}
	}
}

func (e *KubernetesSandboxExecutor) ensureJob(ctx context.Context, name string, run SandboxRun) error {
	if _, err := e.getJobStatus(ctx, name); err == nil {
		return nil
	} else if !errors.Is(err, errKubernetesNotFound) {
		return err
	}
	body, err := json.Marshal(e.jobSpec(name, run))
	if err != nil {
		return err
	}
	resp, err := e.do(ctx, http.MethodPost, e.jobsPath(), body)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusConflict {
		return nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("create sandbox job: kubernetes status %d", resp.StatusCode)
	}
	return nil
}

func (e *KubernetesSandboxExecutor) jobSpec(name string, run SandboxRun) map[string]any {
	labels := map[string]string{
		"app.kubernetes.io/part-of": "rowboat-api",
		"app.kubernetes.io/name":    "rowboat-sandbox",
		"rowboat.io/run-id":         sanitizeLabelValue(run.RunID),
		"rowboat.io/task-slug":      sanitizeLabelValue(run.TaskSlug),
	}
	env := []map[string]string{
		{"name": "HOME", "value": "/tmp"},
		{"name": "ROWBOAT_RUN_ID", "value": run.RunID},
		{"name": "ROWBOAT_TASK_SLUG", "value": run.TaskSlug},
	}
	for key, value := range run.Env {
		env = append(env, map[string]string{"name": key, "value": value})
	}
	container := map[string]any{
		"name":            "sandbox",
		"image":           run.Image,
		"imagePullPolicy": e.cfg.ImagePullPolicy,
		"workingDir":      "/workspace",
		"command":         []string{"/bin/sh", "-lc"},
		"args":            []string{run.Script},
		"env":             env,
		"securityContext": map[string]any{
			"allowPrivilegeEscalation": false,
			"privileged":               false,
			"readOnlyRootFilesystem":   true,
			"capabilities":             map[string]any{"drop": []string{"ALL"}},
		},
		"volumeMounts": []map[string]string{
			{"name": "workspace", "mountPath": "/workspace"},
			{"name": "tmp", "mountPath": "/tmp"},
		},
	}
	resources := resources(e.cfg)
	if len(resources) > 0 {
		container["resources"] = resources
	}
	podSpec := map[string]any{
		"restartPolicy":                "Never",
		"automountServiceAccountToken": false,
		"enableServiceLinks":           false,
		"hostIPC":                      false,
		"hostNetwork":                  false,
		"hostPID":                      false,
		"securityContext": map[string]any{
			"runAsNonRoot": true,
			"runAsUser":    65532,
			"runAsGroup":   65532,
			"fsGroup":      65532,
			"seccompProfile": map[string]string{
				"type": "RuntimeDefault",
			},
		},
		"containers": []map[string]any{container},
		"volumes": []map[string]any{
			{
				"name": "workspace",
				"emptyDir": map[string]string{
					"sizeLimit": valueOrDefault(e.cfg.WorkspaceSizeLimit, "1Gi"),
				},
			},
			{
				"name":     "tmp",
				"emptyDir": map[string]string{"sizeLimit": "64Mi"},
			},
		},
	}
	if e.cfg.ServiceAccountName != "" {
		podSpec["serviceAccountName"] = e.cfg.ServiceAccountName
	}
	backoff := e.cfg.BackoffLimit
	ttl := e.cfg.TTLSeconds
	if ttl <= 0 {
		ttl = 600
	}
	return map[string]any{
		"apiVersion": "batch/v1",
		"kind":       "Job",
		"metadata": map[string]any{
			"name":   name,
			"labels": labels,
		},
		"spec": map[string]any{
			"backoffLimit":            backoff,
			"activeDeadlineSeconds":   int64(run.Timeout.Seconds()) + 5,
			"ttlSecondsAfterFinished": ttl,
			"template":                map[string]any{"metadata": map[string]any{"labels": labels}, "spec": podSpec},
		},
	}
}

func resources(cfg KubernetesSandboxConfig) map[string]any {
	requests := map[string]string{}
	if cfg.CPURequest != "" {
		requests["cpu"] = cfg.CPURequest
	}
	if cfg.MemoryRequest != "" {
		requests["memory"] = cfg.MemoryRequest
	}
	limits := map[string]string{}
	if cfg.CPULimit != "" {
		limits["cpu"] = cfg.CPULimit
	}
	if cfg.MemoryLimit != "" {
		limits["memory"] = cfg.MemoryLimit
	}
	out := map[string]any{}
	if len(requests) > 0 {
		out["requests"] = requests
	}
	if len(limits) > 0 {
		out["limits"] = limits
	}
	return out
}

type kubernetesJobStatus struct {
	Phase    string
	Message  string
	ExitCode int
	TimedOut bool
}

func (e *KubernetesSandboxExecutor) getJobStatus(ctx context.Context, name string) (kubernetesJobStatus, error) {
	resp, err := e.do(ctx, http.MethodGet, path.Join(e.jobsPath(), name), nil)
	if err != nil {
		return kubernetesJobStatus{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusNotFound {
		return kubernetesJobStatus{}, errKubernetesNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return kubernetesJobStatus{}, fmt.Errorf("read sandbox job: kubernetes status %d", resp.StatusCode)
	}
	var job struct {
		Status struct {
			Active     int `json:"active"`
			Succeeded  int `json:"succeeded"`
			Failed     int `json:"failed"`
			Conditions []struct {
				Type    string `json:"type"`
				Status  string `json:"status"`
				Reason  string `json:"reason"`
				Message string `json:"message"`
			} `json:"conditions"`
		} `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&job); err != nil {
		return kubernetesJobStatus{}, err
	}
	for _, condition := range job.Status.Conditions {
		if condition.Status != "True" {
			continue
		}
		switch condition.Type {
		case "Complete":
			return kubernetesJobStatus{Phase: "complete", Message: condition.Message}, nil
		case "Failed":
			return kubernetesJobStatus{
				Phase: "failed", Message: firstNonEmpty(condition.Message, condition.Reason),
				TimedOut: condition.Reason == "DeadlineExceeded",
			}, nil
		}
	}
	if job.Status.Active > 0 {
		return kubernetesJobStatus{Phase: "running", Message: "sandbox job running"}, nil
	}
	return kubernetesJobStatus{Phase: "pending", Message: "sandbox job pending"}, nil
}

func (e *KubernetesSandboxExecutor) result(ctx context.Context, jobName string, status kubernetesJobStatus, maxOutputBytes int) (SandboxResult, error) {
	logs, truncated, err := e.logs(ctx, jobName, maxOutputBytes)
	if err != nil {
		return SandboxResult{}, err
	}
	exitCode, _ := e.exitCode(ctx, jobName)
	if status.Phase == "complete" && exitCode == 0 {
		return SandboxResult{JobName: jobName, Status: "succeeded", Output: logs, OutputTruncated: truncated}, nil
	}
	return SandboxResult{
		JobName: jobName, Status: "failed", ExitCode: exitCode, Output: logs,
		OutputTruncated: truncated, TimedOut: status.TimedOut,
	}, nil
}

func (e *KubernetesSandboxExecutor) logs(ctx context.Context, jobName string, maxOutputBytes int) (string, bool, error) {
	pod, err := e.firstPod(ctx, jobName)
	if err != nil {
		return "", false, err
	}
	if pod == "" {
		return "", false, nil
	}
	q := url.Values{}
	q.Set("container", "sandbox")
	q.Set("timestamps", "false")
	resp, err := e.do(ctx, http.MethodGet, path.Join(e.podsPath(), pod, "log")+"?"+q.Encode(), nil)
	if err != nil {
		return "", false, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", false, fmt.Errorf("read sandbox logs: kubernetes status %d", resp.StatusCode)
	}
	if maxOutputBytes <= 0 {
		maxOutputBytes = 64 << 10
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, int64(maxOutputBytes)+1))
	if err != nil {
		return "", false, err
	}
	truncated := len(raw) > maxOutputBytes
	if truncated {
		raw = raw[:maxOutputBytes]
	}
	return string(raw), truncated, nil
}

func (e *KubernetesSandboxExecutor) exitCode(ctx context.Context, jobName string) (int, error) {
	pod, err := e.firstPod(ctx, jobName)
	if err != nil || pod == "" {
		return 0, err
	}
	resp, err := e.do(ctx, http.MethodGet, path.Join(e.podsPath(), pod), nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, nil
	}
	var body struct {
		Status struct {
			ContainerStatuses []struct {
				Name  string `json:"name"`
				State struct {
					Terminated *struct {
						ExitCode int `json:"exitCode"`
					} `json:"terminated"`
				} `json:"state"`
			} `json:"containerStatuses"`
		} `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return 0, err
	}
	for _, status := range body.Status.ContainerStatuses {
		if status.Name == "sandbox" && status.State.Terminated != nil {
			return status.State.Terminated.ExitCode, nil
		}
	}
	return 0, nil
}

func (e *KubernetesSandboxExecutor) firstPod(ctx context.Context, jobName string) (string, error) {
	q := url.Values{}
	q.Set("labelSelector", "job-name="+jobName)
	resp, err := e.do(ctx, http.MethodGet, e.podsPath()+"?"+q.Encode(), nil)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("list sandbox pods: kubernetes status %d", resp.StatusCode)
	}
	var list struct {
		Items []struct {
			Metadata struct {
				Name string `json:"name"`
			} `json:"metadata"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return "", err
	}
	if len(list.Items) == 0 {
		return "", nil
	}
	return list.Items[0].Metadata.Name, nil
}

func (e *KubernetesSandboxExecutor) deleteJob(ctx context.Context, name string) error {
	q := url.Values{}
	q.Set("propagationPolicy", "Background")
	resp, err := e.do(ctx, http.MethodDelete, path.Join(e.jobsPath(), name)+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusNotFound || (resp.StatusCode >= 200 && resp.StatusCode < 300) {
		return nil
	}
	return fmt.Errorf("delete sandbox job: kubernetes status %d", resp.StatusCode)
}

var errKubernetesNotFound = errors.New("kubernetes resource not found")

func (e *KubernetesSandboxExecutor) do(ctx context.Context, method, apiPath string, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, e.apiServer+apiPath, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+e.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return e.client.Do(req)
}

func (e *KubernetesSandboxExecutor) jobsPath() string {
	return "/apis/batch/v1/namespaces/" + url.PathEscape(e.namespace) + "/jobs"
}

func (e *KubernetesSandboxExecutor) podsPath() string {
	return "/api/v1/namespaces/" + url.PathEscape(e.namespace) + "/pods"
}

func (e *KubernetesSandboxExecutor) jobName(run SandboxRun) string {
	sum := sha256.Sum256([]byte(run.UserID + "\x00" + run.RunID + "\x00" + strconv.Itoa(run.ToolCallIndex) + "\x00" + run.Image + "\x00" + run.Script))
	suffix := hex.EncodeToString(sum[:])[:12]
	base := sanitizeDNSLabel(run.RunID)
	if base == "" {
		base = "run"
	}
	maxBase := 63 - len("rb-sandbox--") - len(suffix)
	if len(base) > maxBase {
		base = strings.Trim(base[:maxBase], "-")
	}
	return "rb-sandbox-" + base + "-" + suffix
}

func (e *KubernetesSandboxExecutor) heartbeat(ctx context.Context, run SandboxRun, jobName, phase, message string) {
	if run.Heartbeat != nil {
		run.Heartbeat(ctx, SandboxHeartbeat{JobName: jobName, Phase: phase, Message: message})
	}
}

func sanitizeDNSLabel(value string) string {
	value = strings.ToLower(value)
	value = dnsLabelCleaner.ReplaceAllString(value, "-")
	value = strings.Trim(value, "-")
	if len(value) > 63 {
		value = strings.Trim(value[:63], "-")
	}
	return value
}

func sanitizeLabelValue(value string) string {
	value = sanitizeDNSLabel(value)
	if value == "" {
		return "unknown"
	}
	return value
}

func valueOrDefault(value, def string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return def
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
