package perf

import (
	"encoding/json"
	"fmt"
	"strings"
)

type ipcSummary struct {
	Count       int     `json:"count"`
	P50Ms       float64 `json:"p50Ms"`
	P95Ms       float64 `json:"p95Ms"`
	MaxMs       float64 `json:"maxMs"`
	TotalMs     float64 `json:"totalMs"`
	FailedCount int     `json:"failedCount"`
}

func recordNavigationMetrics(rep *report, raw string, prefix string) error {
	var payload struct {
		NavigationDOMContentLoadedMs float64 `json:"navigationDomContentLoadedMs"`
		NavigationLoadMs             float64 `json:"navigationLoadMs"`
		FirstMeaningfulPaintMs       float64 `json:"firstMeaningfulPaintMs"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return fmt.Errorf("parse navigation metrics: %w", err)
	}
	setMetric(rep.Timings, prefixedMetric(prefix, "navigationDomContentLoadedMs"), payload.NavigationDOMContentLoadedMs)
	setMetric(rep.Timings, prefixedMetric(prefix, "navigationLoadMs"), payload.NavigationLoadMs)
	if prefix == "" {
		setMetric(rep.Timings, "firstMeaningfulPaintMs", payload.FirstMeaningfulPaintMs)
	}
	return nil
}

func recordIPCWorkflowMetrics(rep *report, raw string, cfg config) error {
	var payload struct {
		TreeMs     float64 `json:"treeMs"`
		SearchMs   float64 `json:"searchMs"`
		RunsMs     float64 `json:"runsMs"`
		ModelsMs   float64 `json:"modelsMs"`
		IPCTimings struct {
			ipcSummary
			ByChannel map[string]ipcSummary `json:"byChannel"`
		} `json:"ipcTimings"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return fmt.Errorf("parse IPC workflow metrics: %w", err)
	}
	setMetric(rep.Measurements, "ipcP50Ms", payload.IPCTimings.P50Ms)
	setMetric(rep.Measurements, "ipcP95Ms", payload.IPCTimings.P95Ms)
	setMetric(rep.Measurements, "ipcMaxMs", payload.IPCTimings.MaxMs)
	if summary, ok := payload.IPCTimings.ByChannel["workspace:writeFile"]; ok {
		setMetric(rep.Measurements, "ipcWorkspaceWriteP95Ms", summary.P95Ms)
	}
	setMetric(rep.Measurements, "ipcWorkspaceTreeMs", payload.TreeMs)
	setMetric(rep.Measurements, "ipcSearchMs", payload.SearchMs)
	setMetric(rep.Measurements, "ipcRunsListMs", payload.RunsMs)
	setMetric(rep.Measurements, "ipcModelsListMs", payload.ModelsMs)
	if cfg.Tier != perfTierCommit {
		setMetric(rep.Measurements, "scaleWorkspaceTreeMs", payload.TreeMs)
		setMetric(rep.Measurements, "scaleSearchMs", payload.SearchMs)
	}
	return nil
}

func recordLongTaskMetrics(rep *report, raw string) (bool, error) {
	var payload struct {
		Supported bool    `json:"supported"`
		Count     int     `json:"count"`
		MaxMs     float64 `json:"maxMs"`
		TotalMs   float64 `json:"totalMs"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return false, fmt.Errorf("parse long task metrics: %w", err)
	}
	rep.Measurements["longTaskCount"] = float64(payload.Count)
	rep.Measurements["longTaskMaxMs"] = payload.MaxMs
	rep.Measurements["longTaskTotalMs"] = payload.TotalMs
	return payload.Supported, nil
}

func recordMemoryLoopMetrics(rep *report, raw string, beforeRSSMB, beforeHeapMB, afterRSSMB, afterHeapMB float64) error {
	var payload struct {
		Repeats int     `json:"repeats"`
		TotalMs float64 `json:"totalMs"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return fmt.Errorf("parse memory loop metrics: %w", err)
	}
	rep.Timings["memoryLoopMs"] = payload.TotalMs
	rep.Measurements["memoryLoopRssGrowthMb"] = nonNegativeDelta(afterRSSMB, beforeRSSMB)
	rep.Measurements["memoryLoopRendererHeapGrowthMb"] = nonNegativeDelta(afterHeapMB, beforeHeapMB)
	return nil
}

func setMetric(metrics map[string]float64, key string, value float64) {
	if value > 0 {
		metrics[key] = value
	}
}

func prefixedMetric(prefix, key string) string {
	if prefix == "" {
		return key
	}
	return prefix + strings.ToUpper(key[:1]) + key[1:]
}

func nonNegativeDelta(after, before float64) float64 {
	if after <= before {
		return 0
	}
	return after - before
}
