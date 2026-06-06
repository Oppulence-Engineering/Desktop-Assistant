package perf

import (
	"encoding/json"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestCheckBudgetsReportsFailures(t *testing.T) {
	b := testBudget()
	metrics := testMetrics()
	metrics["startupInteractiveMs"] = 1500
	metrics["peakRssMb"] = 499

	failures := checkBudgets(config{}, b, metrics, true)

	if len(failures) != 1 {
		t.Fatalf("expected exactly one failure, got %d: %v", len(failures), failures)
	}
	if !strings.Contains(failures[0], "startupInteractiveMs") {
		t.Fatalf("expected startup failure, got %q", failures[0])
	}
}

func TestCheckBudgetsFailsMissingActiveMetric(t *testing.T) {
	b := testBudget()
	metrics := testMetrics()
	delete(metrics, "rendererJsHeapUsedMb")

	failures := checkBudgets(config{}, b, metrics, true)

	if len(failures) != 1 {
		t.Fatalf("expected exactly one failure, got %d: %v", len(failures), failures)
	}
	if !strings.Contains(failures[0], "rendererJsHeapUsedMb missing") {
		t.Fatalf("expected missing renderer metric failure, got %q", failures[0])
	}
}

func TestCheckBudgetsRequiresCloudMetricOnlyWhenEnabled(t *testing.T) {
	b := testBudget()
	metrics := testMetrics()
	delete(metrics, "cloudWorkflowMs")

	failures := checkBudgets(config{}, b, metrics, true)
	if len(failures) != 0 {
		t.Fatalf("expected default run to skip cloud metric, got %v", failures)
	}

	failures = checkBudgets(config{IncludeCloud: true}, b, metrics, true)
	if len(failures) != 1 {
		t.Fatalf("expected cloud metric failure, got %d: %v", len(failures), failures)
	}
	if !strings.Contains(failures[0], "cloudWorkflowMs missing") {
		t.Fatalf("expected missing cloud metric failure, got %q", failures[0])
	}
}

func TestCheckBudgetsRequiresFullTierMetricsOnlyWhenEnabled(t *testing.T) {
	b := testBudget()
	metrics := testMetrics()
	delete(metrics, "warmStartupInteractiveMs")

	failures := checkBudgets(config{}, b, metrics, true)
	if len(failures) != 0 {
		t.Fatalf("expected commit run to skip warm metrics, got %v", failures)
	}

	failures = checkBudgets(config{Tier: perfTierFull, MemoryRepeats: 3}, b, metrics, true)
	if len(failures) != 1 {
		t.Fatalf("expected warm metric failure, got %d: %v", len(failures), failures)
	}
	if !strings.Contains(failures[0], "warmStartupInteractiveMs missing") {
		t.Fatalf("expected missing warm startup metric failure, got %q", failures[0])
	}
}

func TestCheckBudgetsSkipsOpenFilesWhenUnsupported(t *testing.T) {
	b := testBudget()
	metrics := testMetrics()
	delete(metrics, "peakOpenFiles")

	failures := checkBudgets(config{}, b, metrics, false)
	if len(failures) != 0 {
		t.Fatalf("expected unsupported open-file sampling to skip peakOpenFiles, got %v", failures)
	}
}

func TestCheckBudgetsRejectsInvalidValues(t *testing.T) {
	b := testBudget()
	metrics := testMetrics()
	metrics["peakRssMb"] = math.NaN()

	failures := checkBudgets(config{}, b, metrics, true)
	if len(failures) != 1 {
		t.Fatalf("expected exactly one failure, got %d: %v", len(failures), failures)
	}
	if !strings.Contains(failures[0], "peakRssMb produced invalid value") {
		t.Fatalf("expected invalid metric failure, got %q", failures[0])
	}
}

func TestReadBudgetRejectsIncompleteBudget(t *testing.T) {
	b := testBudget()
	b.Budgets.PeakRSSMB = 0
	path := filepath.Join(t.TempDir(), "budget.json")
	if err := writeJSON(path, b); err != nil {
		t.Fatal(err)
	}

	_, err := readBudget(path)
	if err == nil {
		t.Fatal("expected missing budget limit to fail")
	}
	if !strings.Contains(err.Error(), "peakRssMb budget must be a positive finite number") {
		t.Fatalf("expected peak RSS budget validation error, got %v", err)
	}
}

func TestReadBudgetRejectsUnknownFields(t *testing.T) {
	data, err := json.Marshal(testBudget())
	if err != nil {
		t.Fatal(err)
	}
	data = []byte(strings.Replace(string(data), `"peakRssMb":500`, `"peakRssMb":500,"peakRssMegabytes":500`, 1))
	path := filepath.Join(t.TempDir(), "budget.json")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}

	_, err = readBudget(path)
	if err == nil {
		t.Fatal("expected unknown budget field to fail")
	}
	if !strings.Contains(err.Error(), `unknown field "peakRssMegabytes"`) {
		t.Fatalf("expected unknown field validation error, got %v", err)
	}
}

func TestCommittedBudgetFileIsValid(t *testing.T) {
	if _, err := readBudget("../../budget.json"); err != nil {
		t.Fatal(err)
	}
}

func TestCheckBaselineReportsRegressionPastNoiseFloor(t *testing.T) {
	dir := t.TempDir()
	baselinePath := filepath.Join(dir, "baseline.json")
	cfg := config{BaselinePath: baselinePath}
	var b budgetFile
	b.Regression.MaxPercent = 25
	b.Regression.MinAbsoluteMs = 750
	b.Regression.MinAbsoluteMB = 64

	if err := writeJSON(baselinePath, baselineFile{
		SchemaVersion: schemaVersion,
		Metrics: map[string]float64{
			"startupInteractiveMs": 4000,
			"peakRssMb":            500,
		},
	}); err != nil {
		t.Fatal(err)
	}

	failures, warnings := checkBaseline(cfg, b, map[string]float64{
		"startupInteractiveMs": 6100,
		"peakRssMb":            700,
	})
	if len(warnings) != 0 {
		t.Fatalf("expected no warnings, got %v", warnings)
	}
	if len(failures) != 2 {
		t.Fatalf("expected two regression failures, got %d: %v", len(failures), failures)
	}
	joined := strings.Join(failures, "\n")
	if !strings.Contains(joined, "startupInteractiveMs") || !strings.Contains(joined, "peakRssMb") {
		t.Fatalf("expected startup and RSS regressions, got %v", failures)
	}
}

func TestCheckBaselineMissingFileWarnsOnly(t *testing.T) {
	cfg := config{BaselinePath: filepath.Join(t.TempDir(), "missing.json")}
	failures, warnings := checkBaseline(cfg, budgetFile{}, map[string]float64{"peakRssMb": 500})
	if len(failures) != 0 {
		t.Fatalf("expected no failures for missing baseline, got %v", failures)
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "baseline not found") {
		t.Fatalf("expected missing-baseline warning, got %v", warnings)
	}
}

func TestEmbeddedWorkflowJavaScriptParses(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is not installed")
	}

	for name, script := range map[string]string{
		"chatInputUsable":       chatInputUsableJS(),
		"cloud":                 cloudWorkflowJS(),
		"collectLongTask":       collectLongTaskObserverJS(),
		"ipc":                   ipcWorkflowJS(),
		"memoryLoop":            memoryLoopJS(1),
		"navigationTiming":      navigationTimingJS(),
		"startLongTaskObserver": startLongTaskObserverJS(),
	} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			file := filepath.Join(dir, name+".mjs")
			if err := os.WriteFile(file, []byte(script+";\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command(node, "--check", file)
			out, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("node --check failed: %v\n%s", err, out)
			}
		})
	}
}

func TestLoadConfigCloudWorkflowOptIn(t *testing.T) {
	setLoadConfigTestEnv(t)

	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.IncludeCloud {
		t.Fatal("cloud workflow should be disabled by default for the commit-level gate")
	}

	t.Setenv("ROWBOAT_DESKTOP_PERF_INCLUDE_CLOUD", "1")
	cfg, err = loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.IncludeCloud {
		t.Fatal("cloud workflow should be enabled when ROWBOAT_DESKTOP_PERF_INCLUDE_CLOUD=1")
	}
}

func TestLoadConfigTierDefaults(t *testing.T) {
	setLoadConfigTestEnv(t)

	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Tier != perfTierCommit || cfg.SeedNotes != 120 || cfg.MemoryRepeats != 0 {
		t.Fatalf("unexpected commit defaults: tier=%s seed=%d repeats=%d", cfg.Tier, cfg.SeedNotes, cfg.MemoryRepeats)
	}

	t.Setenv("ROWBOAT_DESKTOP_PERF_TIER", perfTierFull)
	cfg, err = loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Tier != perfTierFull || cfg.SeedNotes != 1000 || cfg.MemoryRepeats != 3 || !cfg.IncludeCloud {
		t.Fatalf("unexpected full defaults: tier=%s seed=%d repeats=%d cloud=%v", cfg.Tier, cfg.SeedNotes, cfg.MemoryRepeats, cfg.IncludeCloud)
	}

	t.Setenv("ROWBOAT_DESKTOP_PERF_INCLUDE_CLOUD", "0")
	t.Setenv("ROWBOAT_DESKTOP_PERF_SEED_NOTES", "42")
	t.Setenv("ROWBOAT_DESKTOP_PERF_MEMORY_REPEATS", "2")
	cfg, err = loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.IncludeCloud || cfg.SeedNotes != 42 || cfg.MemoryRepeats != 2 {
		t.Fatalf("overrides not honored: cloud=%v seed=%d repeats=%d", cfg.IncludeCloud, cfg.SeedNotes, cfg.MemoryRepeats)
	}
}

func setLoadConfigTestEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"API_URL",
		"ROWBOAT_API_PORT",
		"ROWBOAT_DEVSTACK_PORT",
		"ROWBOAT_DESKTOP_PERF_AGENT_SESSION",
		"ROWBOAT_DESKTOP_PERF_API_URL",
		"ROWBOAT_DESKTOP_PERF_ARTIFACT_DIR",
		"ROWBOAT_DESKTOP_PERF_BASELINE",
		"ROWBOAT_DESKTOP_PERF_BUDGET",
		"ROWBOAT_DESKTOP_PERF_DEVSTACK_URL",
		"ROWBOAT_DESKTOP_PERF_IDLE_SECONDS",
		"ROWBOAT_DESKTOP_PERF_INCLUDE_CLOUD",
		"ROWBOAT_DESKTOP_PERF_MEMORY_REPEATS",
		"ROWBOAT_DESKTOP_PERF_MODE",
		"ROWBOAT_DESKTOP_PERF_PROMPT",
		"ROWBOAT_DESKTOP_PERF_SEED_NOTES",
		"ROWBOAT_DESKTOP_PERF_SKIP_PACKAGE",
		"ROWBOAT_DESKTOP_PERF_TIER",
		"ROWBOAT_DESKTOP_PERF_UPDATE_BASELINE",
		"ROWBOAT_DESKTOP_PERF_WORKDIR",
		"ROWBOAT_DESKTOP_VITE_PORT",
		"ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT",
	} {
		t.Setenv(key, "")
	}
	t.Setenv("ROWBOAT_REPO_ROOT", t.TempDir())
}

func testBudget() budgetFile {
	var b budgetFile
	b.SchemaVersion = schemaVersion
	b.Budgets.StartupInteractiveMs = 1000
	b.Budgets.LaunchToCDPMs = 1000
	b.Budgets.NavigationDOMContentLoadedMs = 1000
	b.Budgets.NavigationLoadMs = 1000
	b.Budgets.FirstMeaningfulPaintMs = 1000
	b.Budgets.SignedInShellMs = 1000
	b.Budgets.ChatInputUsableMs = 1000
	b.Budgets.IPCWorkflowMs = 1000
	b.Budgets.IPCP50Ms = 1000
	b.Budgets.IPCP95Ms = 1000
	b.Budgets.IPCMaxMs = 1000
	b.Budgets.IPCWorkspaceWriteP95Ms = 1000
	b.Budgets.IPCWorkspaceTreeMs = 1000
	b.Budgets.IPCSearchMs = 1000
	b.Budgets.IPCRunsListMs = 1000
	b.Budgets.IPCModelsListMs = 1000
	b.Budgets.ChatRoundTripMs = 1000
	b.Budgets.CloudWorkflowMs = 1000
	b.Budgets.TotalWorkflowMs = 5000
	b.Budgets.ScriptDurationMs = 1000
	b.Budgets.TaskDurationMs = 1000
	b.Budgets.LayoutDurationMs = 1000
	b.Budgets.RecalcStyleDurationMs = 1000
	b.Budgets.DOMNodeCount = 10000
	b.Budgets.JSEventListenerCount = 10000
	b.Budgets.RendererResourceCount = 1000
	b.Budgets.LongTaskCount = 100
	b.Budgets.LongTaskMaxMs = 1000
	b.Budgets.LongTaskTotalMs = 5000
	b.Budgets.PackagedAppSizeMB = 1000
	b.Budgets.RendererAssetSizeMB = 1000
	b.Budgets.WarmLaunchToCDPMs = 1000
	b.Budgets.WarmStartupInteractiveMs = 1000
	b.Budgets.WarmChatInputUsableMs = 1000
	b.Budgets.WarmNavigationLoadMs = 1000
	b.Budgets.ScaleWorkspaceTreeMs = 1000
	b.Budgets.ScaleSearchMs = 1000
	b.Budgets.MemoryLoopRSSGrowthMB = 100
	b.Budgets.MemoryLoopRendererHeapMB = 100
	b.Budgets.PeakRSSMB = 500
	b.Budgets.MeanCPUPercent = 100
	b.Budgets.PeakCPUPercent = 500
	b.Budgets.IdleCPUPercent = 50
	b.Budgets.PeakProcesses = 20
	b.Budgets.PeakThreads = 200
	b.Budgets.PeakOpenFiles = 500
	b.Budgets.RendererJSHeapUsedMB = 128
	b.Regression.MaxPercent = 25
	b.Regression.MinAbsoluteMs = 750
	b.Regression.MinAbsoluteMB = 64
	b.Regression.MinAbsoluteCPUPercent = 15
	return b
}

func testMetrics() map[string]float64 {
	return map[string]float64{
		"startupInteractiveMs":           100,
		"launchToCdpMs":                  50,
		"navigationDomContentLoadedMs":   80,
		"navigationLoadMs":               90,
		"firstMeaningfulPaintMs":         70,
		"signedInShellMs":                95,
		"chatInputUsableMs":              96,
		"ipcWorkflowMs":                  100,
		"ipcP50Ms":                       5,
		"ipcP95Ms":                       10,
		"ipcMaxMs":                       20,
		"ipcWorkspaceWriteP95Ms":         12,
		"ipcWorkspaceTreeMs":             20,
		"ipcSearchMs":                    20,
		"ipcRunsListMs":                  20,
		"ipcModelsListMs":                20,
		"chatRoundTripMs":                100,
		"cloudWorkflowMs":                100,
		"totalWorkflowMs":                400,
		"scriptDurationMs":               20,
		"taskDurationMs":                 40,
		"layoutDurationMs":               5,
		"recalcStyleDurationMs":          5,
		"domNodeCount":                   500,
		"jsEventListenerCount":           500,
		"rendererResourceCount":          20,
		"longTaskCount":                  0,
		"longTaskMaxMs":                  0,
		"longTaskTotalMs":                0,
		"warmLaunchToCdpMs":              50,
		"warmStartupInteractiveMs":       100,
		"warmChatInputUsableMs":          100,
		"warmNavigationLoadMs":           100,
		"scaleWorkspaceTreeMs":           100,
		"scaleSearchMs":                  100,
		"memoryLoopRssGrowthMb":          10,
		"memoryLoopRendererHeapGrowthMb": 10,
		"peakRssMb":                      100,
		"meanCpuPercent":                 10,
		"peakCpuPercent":                 50,
		"idleCpuPercent":                 5,
		"peakProcesses":                  5,
		"peakThreads":                    50,
		"peakOpenFiles":                  50,
		"rendererJsHeapUsedMb":           64,
	}
}
