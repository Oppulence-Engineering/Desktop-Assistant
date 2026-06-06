package perf

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

func readBudget(path string) (*budgetFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var budget budgetFile
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&budget); err != nil {
		return nil, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, fmt.Errorf("budget file must contain exactly one JSON document")
	}
	if budget.SchemaVersion != schemaVersion {
		return nil, fmt.Errorf("unsupported budget schemaVersion %d", budget.SchemaVersion)
	}
	if failures := validateBudgetFile(budget); len(failures) > 0 {
		return nil, fmt.Errorf("invalid budget file %s: %s", path, strings.Join(failures, "; "))
	}
	return &budget, nil
}

func comparableMetrics(rep report) map[string]float64 {
	out := map[string]float64{}
	for key, value := range rep.Timings {
		out[key] = value
	}
	for key, value := range rep.Measurements {
		out[key] = value
	}
	for key, value := range rendererComparableMetrics(rep.Renderer) {
		if _, exists := out[key]; !exists {
			out[key] = value
		}
	}
	out["peakRssMb"] = rep.Resources.PeakRSSMB
	out["meanCpuPercent"] = rep.Resources.MeanCPUPercent
	out["peakCpuPercent"] = rep.Resources.PeakCPUPercent
	out["idleCpuPercent"] = rep.Resources.IdleMeanCPUPercent
	out["peakProcesses"] = float64(rep.Resources.PeakProcessCount)
	out["peakThreads"] = float64(rep.Resources.PeakThreadCount)
	if rep.Resources.OpenFilesSupported {
		out["peakOpenFiles"] = float64(rep.Resources.PeakOpenFiles)
	}
	if v, ok := rep.Renderer["JSHeapUsedSizeMB"]; ok {
		out["rendererJsHeapUsedMb"] = v
	}
	return out
}

func rendererComparableMetrics(renderer map[string]float64) map[string]float64 {
	out := map[string]float64{}
	for metric, source := range map[string]string{
		"scriptDurationMs":      "ScriptDuration",
		"taskDurationMs":        "TaskDuration",
		"layoutDurationMs":      "LayoutDuration",
		"recalcStyleDurationMs": "RecalcStyleDuration",
	} {
		if value, ok := renderer[source]; ok {
			out[metric] = value * 1000
		}
	}
	for metric, sources := range map[string][]string{
		"domNodeCount":          {"DOMCounters.nodes", "Nodes"},
		"jsEventListenerCount":  {"DOMCounters.jsEventListeners", "JSEventListeners"},
		"rendererResourceCount": {"Resources"},
	} {
		for _, source := range sources {
			if value, ok := renderer[source]; ok {
				out[metric] = value
				break
			}
		}
	}
	if navigationStart, ok := renderer["NavigationStart"]; ok {
		for metric, source := range map[string]string{
			"navigationDomContentLoadedMs": "DomContentLoaded",
			"firstMeaningfulPaintMs":       "FirstMeaningfulPaint",
		} {
			if value, ok := renderer[source]; ok && value > navigationStart {
				out[metric] = (value - navigationStart) * 1000
			}
		}
	}
	return out
}

type budgetLimit struct {
	key   string
	limit float64
}

func budgetLimits(b budgetFile) []budgetLimit {
	return []budgetLimit{
		{key: "startupInteractiveMs", limit: b.Budgets.StartupInteractiveMs},
		{key: "launchToCdpMs", limit: b.Budgets.LaunchToCDPMs},
		{key: "navigationDomContentLoadedMs", limit: b.Budgets.NavigationDOMContentLoadedMs},
		{key: "navigationLoadMs", limit: b.Budgets.NavigationLoadMs},
		{key: "firstMeaningfulPaintMs", limit: b.Budgets.FirstMeaningfulPaintMs},
		{key: "signedInShellMs", limit: b.Budgets.SignedInShellMs},
		{key: "chatInputUsableMs", limit: b.Budgets.ChatInputUsableMs},
		{key: "ipcWorkflowMs", limit: b.Budgets.IPCWorkflowMs},
		{key: "ipcP50Ms", limit: b.Budgets.IPCP50Ms},
		{key: "ipcP95Ms", limit: b.Budgets.IPCP95Ms},
		{key: "ipcMaxMs", limit: b.Budgets.IPCMaxMs},
		{key: "ipcWorkspaceWriteP95Ms", limit: b.Budgets.IPCWorkspaceWriteP95Ms},
		{key: "ipcWorkspaceTreeMs", limit: b.Budgets.IPCWorkspaceTreeMs},
		{key: "ipcSearchMs", limit: b.Budgets.IPCSearchMs},
		{key: "ipcRunsListMs", limit: b.Budgets.IPCRunsListMs},
		{key: "ipcModelsListMs", limit: b.Budgets.IPCModelsListMs},
		{key: "chatRoundTripMs", limit: b.Budgets.ChatRoundTripMs},
		{key: "cloudWorkflowMs", limit: b.Budgets.CloudWorkflowMs},
		{key: "totalWorkflowMs", limit: b.Budgets.TotalWorkflowMs},
		{key: "scriptDurationMs", limit: b.Budgets.ScriptDurationMs},
		{key: "taskDurationMs", limit: b.Budgets.TaskDurationMs},
		{key: "layoutDurationMs", limit: b.Budgets.LayoutDurationMs},
		{key: "recalcStyleDurationMs", limit: b.Budgets.RecalcStyleDurationMs},
		{key: "domNodeCount", limit: b.Budgets.DOMNodeCount},
		{key: "jsEventListenerCount", limit: b.Budgets.JSEventListenerCount},
		{key: "rendererResourceCount", limit: b.Budgets.RendererResourceCount},
		{key: "longTaskCount", limit: b.Budgets.LongTaskCount},
		{key: "longTaskMaxMs", limit: b.Budgets.LongTaskMaxMs},
		{key: "longTaskTotalMs", limit: b.Budgets.LongTaskTotalMs},
		{key: "packagedAppSizeMb", limit: b.Budgets.PackagedAppSizeMB},
		{key: "rendererAssetSizeMb", limit: b.Budgets.RendererAssetSizeMB},
		{key: "warmLaunchToCdpMs", limit: b.Budgets.WarmLaunchToCDPMs},
		{key: "warmStartupInteractiveMs", limit: b.Budgets.WarmStartupInteractiveMs},
		{key: "warmChatInputUsableMs", limit: b.Budgets.WarmChatInputUsableMs},
		{key: "warmNavigationLoadMs", limit: b.Budgets.WarmNavigationLoadMs},
		{key: "scaleWorkspaceTreeMs", limit: b.Budgets.ScaleWorkspaceTreeMs},
		{key: "scaleSearchMs", limit: b.Budgets.ScaleSearchMs},
		{key: "memoryLoopRssGrowthMb", limit: b.Budgets.MemoryLoopRSSGrowthMB},
		{key: "memoryLoopRendererHeapGrowthMb", limit: b.Budgets.MemoryLoopRendererHeapMB},
		{key: "peakRssMb", limit: b.Budgets.PeakRSSMB},
		{key: "meanCpuPercent", limit: b.Budgets.MeanCPUPercent},
		{key: "peakCpuPercent", limit: b.Budgets.PeakCPUPercent},
		{key: "idleCpuPercent", limit: b.Budgets.IdleCPUPercent},
		{key: "peakProcesses", limit: b.Budgets.PeakProcesses},
		{key: "peakThreads", limit: b.Budgets.PeakThreads},
		{key: "peakOpenFiles", limit: b.Budgets.PeakOpenFiles},
		{key: "rendererJsHeapUsedMb", limit: b.Budgets.RendererJSHeapUsedMB},
	}
}

func activeBudgetLimits(cfg config, b budgetFile, openFilesSupported bool) []budgetLimit {
	limits := budgetLimits(b)
	out := make([]budgetLimit, 0, len(limits))
	tier := cfg.Tier
	if tier == "" {
		tier = perfTierCommit
	}
	for _, metric := range limits {
		if metric.key == "cloudWorkflowMs" && !cfg.IncludeCloud {
			continue
		}
		if metric.key == "totalWorkflowMs" && tier != perfTierCommit {
			continue
		}
		if metric.key == "peakOpenFiles" && !openFilesSupported {
			continue
		}
		if (metric.key == "packagedAppSizeMb" || metric.key == "rendererAssetSizeMb") && cfg.Mode != "package" {
			continue
		}
		if isFullTierMetric(metric.key) && tier == perfTierCommit {
			continue
		}
		if strings.HasPrefix(metric.key, "memoryLoop") && cfg.MemoryRepeats == 0 {
			continue
		}
		out = append(out, metric)
	}
	return out
}

func isFullTierMetric(key string) bool {
	return strings.HasPrefix(key, "warm") ||
		strings.HasPrefix(key, "scale") ||
		strings.HasPrefix(key, "memoryLoop")
}

func validateBudgetFile(b budgetFile) []string {
	var failures []string
	for _, metric := range budgetLimits(b) {
		if !validPositiveFinite(metric.limit) {
			failures = append(failures, fmt.Sprintf("%s budget must be a positive finite number, got %.2f", metric.key, metric.limit))
		}
	}
	if !validPositiveFinite(b.Regression.MaxPercent) {
		failures = append(failures, fmt.Sprintf("regression.maxPercent must be a positive finite number, got %.2f", b.Regression.MaxPercent))
	}
	for key, value := range map[string]float64{
		"regression.minAbsoluteMs":         b.Regression.MinAbsoluteMs,
		"regression.minAbsoluteMb":         b.Regression.MinAbsoluteMB,
		"regression.minAbsoluteCpuPercent": b.Regression.MinAbsoluteCPUPercent,
	} {
		if !validNonNegativeFinite(value) {
			failures = append(failures, fmt.Sprintf("%s must be a non-negative finite number, got %.2f", key, value))
		}
	}
	sort.Strings(failures)
	return failures
}

func checkBudgets(cfg config, b budgetFile, metrics map[string]float64, openFilesSupported bool) []string {
	var failures []string
	for _, metric := range activeBudgetLimits(cfg, b, openFilesSupported) {
		if !validPositiveFinite(metric.limit) {
			failures = append(failures, fmt.Sprintf("%s budget must be a positive finite number, got %.2f", metric.key, metric.limit))
			continue
		}
		value, ok := metrics[metric.key]
		if !ok {
			failures = append(failures, fmt.Sprintf("%s missing; budget %.2f could not be validated", metric.key, metric.limit))
			continue
		}
		if !validNonNegativeFinite(value) {
			failures = append(failures, fmt.Sprintf("%s produced invalid value %.2f", metric.key, value))
			continue
		}
		if value > metric.limit {
			failures = append(failures, fmt.Sprintf("%s %.2f exceeded budget %.2f", metric.key, value, metric.limit))
		}
	}
	sort.Strings(failures)
	return failures
}

func validPositiveFinite(value float64) bool {
	return value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func validNonNegativeFinite(value float64) bool {
	return value >= 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func checkBaseline(cfg config, b budgetFile, metrics map[string]float64) ([]string, []string) {
	if cfg.UpdateBaseline {
		return nil, nil
	}
	data, err := os.ReadFile(cfg.BaselinePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, []string{fmt.Sprintf("baseline not found at %s; run make perf-desktop-baseline after a known-good run to enable relative regression checks", cfg.BaselinePath)}
		}
		return nil, []string{fmt.Sprintf("could not read baseline %s: %v", cfg.BaselinePath, err)}
	}
	var baseline baselineFile
	if err := json.Unmarshal(data, &baseline); err != nil {
		return nil, []string{fmt.Sprintf("could not parse baseline %s: %v", cfg.BaselinePath, err)}
	}
	if baseline.SchemaVersion != schemaVersion {
		return nil, []string{fmt.Sprintf("ignoring unsupported baseline schemaVersion %d", baseline.SchemaVersion)}
	}
	maxPercent := b.Regression.MaxPercent
	if maxPercent <= 0 {
		maxPercent = 25
	}
	var failures []string
	for key, current := range metrics {
		base, ok := baseline.Metrics[key]
		if !ok || base <= 0 {
			continue
		}
		delta := current - base
		if delta <= 0 {
			continue
		}
		minAbs := b.Regression.MinAbsoluteMs
		lowerKey := strings.ToLower(key)
		switch {
		case strings.Contains(lowerKey, "rss") || strings.Contains(lowerKey, "heap") || strings.Contains(lowerKey, "mb"):
			minAbs = b.Regression.MinAbsoluteMB
		case strings.Contains(lowerKey, "cpu"):
			minAbs = b.Regression.MinAbsoluteCPUPercent
		case strings.Contains(lowerKey, "process") ||
			strings.Contains(lowerKey, "thread") ||
			strings.Contains(lowerKey, "file") ||
			strings.Contains(lowerKey, "count") ||
			strings.Contains(lowerKey, "node") ||
			strings.Contains(lowerKey, "listener") ||
			strings.Contains(lowerKey, "resource"):
			minAbs = 2
		}
		if minAbs < 0 {
			minAbs = 0
		}
		percent := (delta / base) * 100
		if percent > maxPercent && delta > minAbs {
			failures = append(failures, fmt.Sprintf("%s regressed %.1f%% (baseline %.2f, current %.2f)", key, percent, base, current))
		}
	}
	sort.Strings(failures)
	return failures, nil
}

func writeBaseline(cfg config, commit string, metrics map[string]float64) error {
	if err := os.MkdirAll(filepath.Dir(cfg.BaselinePath), 0o755); err != nil {
		return err
	}
	baseline := baselineFile{
		SchemaVersion: schemaVersion,
		UpdatedAt:     time.Now().UTC().Format(time.RFC3339),
		Commit:        commit,
		OS:            runtime.GOOS,
		Arch:          runtime.GOARCH,
		Mode:          cfg.Mode,
		Metrics:       metrics,
	}
	return writeJSON(cfg.BaselinePath, baseline)
}
