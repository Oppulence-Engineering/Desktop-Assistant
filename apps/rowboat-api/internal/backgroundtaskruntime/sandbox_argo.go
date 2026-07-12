package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

// ArgoSandboxExecutor runs sandbox.run requests as Argo Workflow CRs.
type ArgoSandboxExecutor struct {
	kube *KubernetesSandboxExecutor
}

// NewArgoSandboxExecutor builds an Argo Workflow-backed sandbox executor.
// It uses the same in-cluster Kubernetes API credentials as the Job executor.
func NewArgoSandboxExecutor(cfg KubernetesSandboxConfig) (*ArgoSandboxExecutor, error) {
	if strings.TrimSpace(cfg.ServiceAccountName) == "" {
		return nil, errors.New("argo sandbox executor requires a service account")
	}
	kube, err := NewKubernetesSandboxExecutor(cfg)
	if err != nil {
		return nil, err
	}
	return &ArgoSandboxExecutor{kube: kube}, nil
}

// Execute runs one sandbox request as an Argo Workflow.
func (e *ArgoSandboxExecutor) Execute(ctx context.Context, run SandboxRun) (SandboxResult, error) {
	if run.Timeout <= 0 {
		run.Timeout = time.Minute
	}
	workflowName := e.kube.jobName(run)
	if err := e.ensureWorkflow(ctx, workflowName, run); err != nil {
		return SandboxResult{}, err
	}

	ticker := time.NewTicker(e.kube.cfg.PollInterval)
	defer ticker.Stop()
	deadline := time.NewTimer(run.Timeout + 15*time.Second)
	defer deadline.Stop()

	for {
		status, err := e.getWorkflowStatus(ctx, workflowName)
		if err != nil {
			return SandboxResult{}, err
		}
		e.kube.heartbeat(ctx, run, workflowName, status.Phase, status.Message)
		switch status.Phase {
		case "complete", "failed":
			return e.result(ctx, workflowName, status, run.MaxOutputBytes)
		}
		select {
		case <-ctx.Done():
			_ = e.deleteWorkflow(context.Background(), workflowName)
			return SandboxResult{}, ctx.Err()
		case <-deadline.C:
			_ = e.deleteWorkflow(context.Background(), workflowName)
			logs, truncated, _ := e.logs(ctx, workflowName, run.MaxOutputBytes)
			return SandboxResult{
				JobName: workflowName, Status: "timeout", Output: logs, OutputTruncated: truncated, TimedOut: true,
			}, nil
		case <-ticker.C:
		}
	}
}

func (e *ArgoSandboxExecutor) ensureWorkflow(ctx context.Context, name string, run SandboxRun) error {
	if _, err := e.getWorkflowStatus(ctx, name); err == nil {
		return nil
	} else if !errors.Is(err, errKubernetesNotFound) {
		return err
	}
	body, err := json.Marshal(e.workflowSpec(name, run))
	if err != nil {
		return err
	}
	resp, err := e.kube.do(ctx, http.MethodPost, e.workflowsPath(), body)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusConflict {
		return nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("create argo sandbox workflow: kubernetes status %d", resp.StatusCode)
	}
	return nil
}

func (e *ArgoSandboxExecutor) workflowSpec(name string, run SandboxRun) map[string]any {
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
		"image":           run.Image,
		"imagePullPolicy": e.kube.cfg.ImagePullPolicy,
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
	resources := resources(e.kube.cfg)
	if len(resources) > 0 {
		container["resources"] = resources
	}
	ttl := e.kube.cfg.TTLSeconds
	if ttl <= 0 {
		ttl = 600
	}
	serviceAccountName := strings.TrimSpace(e.kube.cfg.ServiceAccountName)
	return map[string]any{
		"apiVersion": "argoproj.io/v1alpha1",
		"kind":       "Workflow",
		"metadata": map[string]any{
			"name":   name,
			"labels": labels,
		},
		"spec": map[string]any{
			"entrypoint":                   "sandbox",
			"activeDeadlineSeconds":        int64(run.Timeout.Seconds()) + 5,
			"automountServiceAccountToken": false,
			"hostNetwork":                  false,
			"podSpecPatch":                 `{"enableServiceLinks":false,"hostIPC":false,"hostPID":false}`,
			"serviceAccountName":           serviceAccountName,
			"executor":                     map[string]string{"serviceAccountName": serviceAccountName},
			"securityContext": map[string]any{
				"runAsNonRoot": true,
				"runAsUser":    65532,
				"runAsGroup":   65532,
				"fsGroup":      65532,
				"seccompProfile": map[string]string{
					"type": "RuntimeDefault",
				},
			},
			"podMetadata": map[string]any{"labels": labels},
			"ttlStrategy": map[string]any{"secondsAfterCompletion": ttl},
			"volumes": []map[string]any{
				{
					"name": "workspace",
					"emptyDir": map[string]string{
						"sizeLimit": valueOrDefault(e.kube.cfg.WorkspaceSizeLimit, "1Gi"),
					},
				},
				{
					"name":     "tmp",
					"emptyDir": map[string]string{"sizeLimit": "64Mi"},
				},
			},
			"templates": []map[string]any{{
				"name":      "sandbox",
				"container": container,
			}},
		},
	}
}

type argoWorkflowStatus struct {
	Phase    string
	Message  string
	TimedOut bool
}

func (e *ArgoSandboxExecutor) getWorkflowStatus(ctx context.Context, name string) (argoWorkflowStatus, error) {
	resp, err := e.kube.do(ctx, http.MethodGet, path.Join(e.workflowsPath(), name), nil)
	if err != nil {
		return argoWorkflowStatus{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusNotFound {
		return argoWorkflowStatus{}, errKubernetesNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return argoWorkflowStatus{}, fmt.Errorf("read argo sandbox workflow: kubernetes status %d", resp.StatusCode)
	}
	var workflow struct {
		Status struct {
			Phase   string `json:"phase"`
			Message string `json:"message"`
		} `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&workflow); err != nil {
		return argoWorkflowStatus{}, err
	}
	message := workflow.Status.Message
	switch workflow.Status.Phase {
	case "Succeeded":
		return argoWorkflowStatus{Phase: "complete", Message: message}, nil
	case "Failed", "Error":
		return argoWorkflowStatus{
			Phase: "failed", Message: message,
			TimedOut: strings.Contains(strings.ToLower(message), "deadline"),
		}, nil
	case "Running":
		return argoWorkflowStatus{Phase: "running", Message: firstNonEmpty(message, "sandbox workflow running")}, nil
	default:
		return argoWorkflowStatus{Phase: "pending", Message: firstNonEmpty(message, "sandbox workflow pending")}, nil
	}
}

func (e *ArgoSandboxExecutor) result(ctx context.Context, workflowName string, status argoWorkflowStatus, maxOutputBytes int) (SandboxResult, error) {
	logs, truncated, err := e.logs(ctx, workflowName, maxOutputBytes)
	if err != nil {
		return SandboxResult{}, err
	}
	exitCode, _ := e.exitCode(ctx, workflowName)
	if status.Phase == "complete" && exitCode == 0 {
		return SandboxResult{JobName: workflowName, Status: "succeeded", Output: logs, OutputTruncated: truncated}, nil
	}
	return SandboxResult{
		JobName: workflowName, Status: "failed", ExitCode: exitCode, Output: logs,
		OutputTruncated: truncated, TimedOut: status.TimedOut,
	}, nil
}

func (e *ArgoSandboxExecutor) logs(ctx context.Context, workflowName string, maxOutputBytes int) (string, bool, error) {
	pod, err := e.firstWorkflowPod(ctx, workflowName)
	if err != nil {
		return "", false, err
	}
	if pod == "" {
		return "", false, nil
	}
	container := e.mainContainerName(ctx, pod)
	q := url.Values{}
	q.Set("container", container)
	q.Set("timestamps", "false")
	resp, err := e.kube.do(ctx, http.MethodGet, path.Join(e.kube.podsPath(), pod, "log")+"?"+q.Encode(), nil)
	if err != nil {
		return "", false, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", false, fmt.Errorf("read argo sandbox logs: kubernetes status %d", resp.StatusCode)
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

func (e *ArgoSandboxExecutor) exitCode(ctx context.Context, workflowName string) (int, error) {
	pod, err := e.firstWorkflowPod(ctx, workflowName)
	if err != nil || pod == "" {
		return 0, err
	}
	resp, err := e.kube.do(ctx, http.MethodGet, path.Join(e.kube.podsPath(), pod), nil)
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
		if status.Name != "wait" && status.State.Terminated != nil {
			return status.State.Terminated.ExitCode, nil
		}
	}
	return 0, nil
}

func (e *ArgoSandboxExecutor) firstWorkflowPod(ctx context.Context, workflowName string) (string, error) {
	q := url.Values{}
	q.Set("labelSelector", "workflows.argoproj.io/workflow="+workflowName)
	resp, err := e.kube.do(ctx, http.MethodGet, e.kube.podsPath()+"?"+q.Encode(), nil)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("list argo sandbox pods: kubernetes status %d", resp.StatusCode)
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

func (e *ArgoSandboxExecutor) mainContainerName(ctx context.Context, pod string) string {
	resp, err := e.kube.do(ctx, http.MethodGet, path.Join(e.kube.podsPath(), pod), nil)
	if err != nil {
		return "main"
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "main"
	}
	var body struct {
		Status struct {
			ContainerStatuses []struct {
				Name string `json:"name"`
			} `json:"containerStatuses"`
		} `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "main"
	}
	for _, status := range body.Status.ContainerStatuses {
		if status.Name != "wait" {
			return status.Name
		}
	}
	return "main"
}

func (e *ArgoSandboxExecutor) deleteWorkflow(ctx context.Context, name string) error {
	q := url.Values{}
	q.Set("propagationPolicy", "Background")
	resp, err := e.kube.do(ctx, http.MethodDelete, path.Join(e.workflowsPath(), name)+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusNotFound || (resp.StatusCode >= 200 && resp.StatusCode < 300) {
		return nil
	}
	return fmt.Errorf("delete argo sandbox workflow: kubernetes status %d", resp.StatusCode)
}

func (e *ArgoSandboxExecutor) workflowsPath() string {
	return "/apis/argoproj.io/v1alpha1/namespaces/" + url.PathEscape(e.kube.namespace) + "/workflows"
}
