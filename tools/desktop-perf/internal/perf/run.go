package perf

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

func Main() {
	defer func() {
		if value := recover(); value != nil {
			if exit, ok := value.(controlledExit); ok {
				os.Exit(exit.code)
			}
			panic(value)
		}
	}()

	startedAt := time.Now()
	cfg, err := loadConfig()
	if err != nil {
		fatal(err)
	}
	if err := os.MkdirAll(cfg.ArtifactDir, 0o755); err != nil {
		fatal(err)
	}
	if err := os.Setenv("AGENT_BROWSER_SESSION", cfg.AgentSession); err != nil {
		fatal(err)
	}

	rep := report{
		SchemaVersion: schemaVersion,
		StartedAt:     startedAt.UTC().Format(time.RFC3339),
		Repo:          readRepoInfo(cfg.RepoRoot),
		Config: map[string]any{
			"mode":           cfg.Mode,
			"apiUrl":         cfg.APIURL,
			"devstackUrl":    cfg.DevstackURL,
			"cdpPort":        cfg.CDPPort,
			"vitePort":       cfg.VitePort,
			"workDir":        cfg.WorkDir,
			"tier":           cfg.Tier,
			"artifactDir":    cfg.ArtifactDir,
			"budgetPath":     cfg.BudgetPath,
			"baselinePath":   cfg.BaselinePath,
			"agentSession":   cfg.AgentSession,
			"updateBaseline": cfg.UpdateBaseline,
			"skipPackage":    cfg.SkipPackage,
			"includeCloud":   cfg.IncludeCloud,
			"idleSeconds":    cfg.IdleSeconds,
			"seedNotes":      cfg.SeedNotes,
			"memoryRepeats":  cfg.MemoryRepeats,
		},
		Timings:      map[string]float64{},
		Measurements: map[string]float64{},
		Renderer:     map[string]float64{},
		Workflow:     map[string]any{},
		Artifacts:    map[string]string{},
		Environment:  readEnvironment(),
		Raw:          map[string]interface{}{},
	}

	reportPath := filepath.Join(cfg.ArtifactDir, "report.json")
	samplesCSVPath := filepath.Join(cfg.ArtifactDir, "resource-samples.csv")
	samplesJSONPath := filepath.Join(cfg.ArtifactDir, "resource-samples.json")
	desktopLogPath := filepath.Join(cfg.ArtifactDir, "desktop.log")
	warmDesktopLogPath := filepath.Join(cfg.ArtifactDir, "desktop-warm.log")
	packageLogPath := filepath.Join(cfg.ArtifactDir, "package.log")
	profilePath := filepath.Join(cfg.ArtifactDir, "renderer-workflow.cpuprofile")
	screenshotPath := filepath.Join(cfg.ArtifactDir, "desktop-result.png")
	snapshotPath := filepath.Join(cfg.ArtifactDir, "desktop-result.txt")

	rep.Artifacts["report"] = reportPath
	rep.Artifacts["resourceSamplesCsv"] = samplesCSVPath
	rep.Artifacts["resourceSamplesJson"] = samplesJSONPath
	rep.Artifacts["desktopLog"] = desktopLogPath
	rep.Artifacts["warmDesktopLog"] = warmDesktopLogPath
	rep.Artifacts["packageLog"] = packageLogPath
	rep.Artifacts["rendererCpuProfile"] = profilePath
	rep.Artifacts["screenshot"] = screenshotPath
	rep.Artifacts["snapshot"] = snapshotPath

	defer func() {
		rep.CompletedAt = time.Now().UTC().Format(time.RFC3339)
		if err := writeJSON(reportPath, rep); err != nil {
			fmt.Fprintf(os.Stderr, "failed to write report: %v\n", err)
		}
		updateLatestSymlink(cfg)
	}()

	fmt.Printf("desktop perf: artifacts %s\n", cfg.ArtifactDir)

	if err := preflight(cfg); err != nil {
		rep.Failures = append(rep.Failures, err.Error())
		fatalWithReport(err, reportPath)
	}

	budgets, err := readBudget(cfg.BudgetPath)
	if err != nil {
		rep.Failures = append(rep.Failures, err.Error())
		fatalWithReport(err, reportPath)
	}

	token, err := seedWorkspace(cfg)
	if err != nil {
		rep.Failures = append(rep.Failures, err.Error())
		fatalWithReport(err, reportPath)
	}
	fmt.Println("desktop perf: checking local backend readiness")
	if err := waitForDesktopAPIs(cfg, token); err != nil {
		rep.Failures = append(rep.Failures, err.Error())
		fatalWithReport(err, reportPath)
	}

	if cfg.Mode == "package" && !cfg.SkipPackage {
		fmt.Println("desktop perf: packaging production Electron app")
		t0 := time.Now()
		if err := packageApp(cfg, packageLogPath); err != nil {
			rep.Failures = append(rep.Failures, err.Error())
			fatalWithReport(err, reportPath)
		}
		rep.Timings["packageMs"] = elapsedMs(t0)
	}
	if cfg.Mode == "package" {
		sizeMetrics, sizeRaw, err := measurePackageSizes(cfg)
		if err != nil {
			rep.Failures = append(rep.Failures, fmt.Sprintf("package size measurement failed: %v", err))
			fatalWithReport(errors.New(rep.Failures[len(rep.Failures)-1]), reportPath)
		}
		for key, value := range sizeMetrics {
			rep.Measurements[key] = value
		}
		rep.Raw["packageSize"] = sizeRaw
	}
	fmt.Println("desktop perf: confirming local backend readiness")
	if err := waitForDesktopAPIs(cfg, token); err != nil {
		rep.Failures = append(rep.Failures, err.Error())
		fatalWithReport(err, reportPath)
	}

	appCtx, cancelApp := context.WithCancel(context.Background())
	defer cancelApp()
	cmd, err := startDesktop(appCtx, cfg, desktopLogPath)
	if err != nil {
		rep.Failures = append(rep.Failures, err.Error())
		fatalWithReport(err, reportPath)
	}
	defer cleanupDesktop(cmd)

	mon := newMonitor(int32(cmd.Process.Pid), time.Second)
	mon.startSampling()
	defer mon.stopSampling()

	launchStarted := time.Now()
	fmt.Println("desktop perf: waiting for Electron CDP")
	if err := waitForCDP(cfg.CDPPort, 120*time.Second); err != nil {
		rep.Failures = append(rep.Failures, err.Error())
		fatalWithReport(err, reportPath)
	}
	rep.Timings["launchToCdpMs"] = elapsedMs(launchStarted)

	if out, err := runAgent(30*time.Second, "", "connect", strconv.Itoa(cfg.CDPPort)); err != nil {
		rep.Failures = append(rep.Failures, fmt.Sprintf("agent-browser connect failed: %v: %s", err, out))
		fatalWithReport(errors.New(rep.Failures[len(rep.Failures)-1]), reportPath)
	}
	defer runAgent(10*time.Second, "", "close")

	cdp, err := connectCDP(cfg.CDPPort)
	if err != nil {
		rep.Warnings = append(rep.Warnings, fmt.Sprintf("CDP profile unavailable: %v", err))
	} else {
		defer cdp.close()
		if _, err := cdp.call("Performance.enable", nil); err != nil {
			rep.Warnings = append(rep.Warnings, fmt.Sprintf("CDP Performance.enable failed: %v", err))
		}
		if _, err := cdp.call("Profiler.enable", nil); err != nil {
			rep.Warnings = append(rep.Warnings, fmt.Sprintf("CDP Profiler.enable failed: %v", err))
		}
	}
	if raw, err := evaluateInRenderer(cdp, startLongTaskObserverJS(), 10*time.Second); err != nil {
		rep.Warnings = append(rep.Warnings, fmt.Sprintf("long-task observer unavailable: %v: %s", err, raw))
	} else {
		rep.Workflow["longTaskObserver"] = parseJSONOrRaw(raw)
	}

	fmt.Println("desktop perf: waiting for interactive UI")
	signedInShellMs, err := waitForInteractive(launchStarted)
	if err != nil {
		finalizeRuntimeArtifacts(mon, &rep, samplesCSVPath, samplesJSONPath, snapshotPath, screenshotPath)
		rep.Failures = append(rep.Failures, err.Error())
		fatalWithReport(err, reportPath)
	}
	rep.Timings["signedInShellMs"] = signedInShellMs
	rep.Timings["startupInteractiveMs"] = elapsedMs(launchStarted)
	chatInputUsableMs, err := waitForChatInputUsable(cdp, launchStarted)
	if err != nil {
		finalizeRuntimeArtifacts(mon, &rep, samplesCSVPath, samplesJSONPath, snapshotPath, screenshotPath)
		rep.Failures = append(rep.Failures, err.Error())
		fatalWithReport(err, reportPath)
	}
	rep.Timings["chatInputUsableMs"] = chatInputUsableMs
	navRaw, err := evaluateInRenderer(cdp, navigationTimingJS(), 10*time.Second)
	if err != nil {
		finalizeRuntimeArtifacts(mon, &rep, samplesCSVPath, samplesJSONPath, snapshotPath, screenshotPath)
		rep.Failures = append(rep.Failures, fmt.Sprintf("navigation timing failed: %v: %s", err, navRaw))
		fatalWithReport(errors.New(rep.Failures[len(rep.Failures)-1]), reportPath)
	}
	rep.Workflow["startup"] = parseJSONOrRaw(navRaw)
	if err := recordNavigationMetrics(&rep, navRaw, ""); err != nil {
		finalizeRuntimeArtifacts(mon, &rep, samplesCSVPath, samplesJSONPath, snapshotPath, screenshotPath)
		rep.Failures = append(rep.Failures, err.Error())
		fatalWithReport(err, reportPath)
	}

	if cdp != nil {
		if _, err := cdp.call("Profiler.start", nil); err != nil {
			rep.Warnings = append(rep.Warnings, fmt.Sprintf("CDP Profiler.start failed: %v", err))
		}
	}

	fmt.Println("desktop perf: running IPC workspace/search/model workload")
	ipcStart := time.Now()
	ipcRaw, err := evaluateInRenderer(cdp, ipcWorkflowJS(), 90*time.Second)
	if err != nil {
		finalizeRuntimeArtifacts(mon, &rep, samplesCSVPath, samplesJSONPath, snapshotPath, screenshotPath)
		rep.Failures = append(rep.Failures, fmt.Sprintf("IPC workflow failed: %v: %s", err, ipcRaw))
		fatalWithReport(errors.New(rep.Failures[len(rep.Failures)-1]), reportPath)
	}
	rep.Timings["ipcWorkflowMs"] = elapsedMs(ipcStart)
	rep.Workflow["ipc"] = parseJSONOrRaw(ipcRaw)
	if err := recordIPCWorkflowMetrics(&rep, ipcRaw, cfg); err != nil {
		finalizeRuntimeArtifacts(mon, &rep, samplesCSVPath, samplesJSONPath, snapshotPath, screenshotPath)
		rep.Failures = append(rep.Failures, err.Error())
		fatalWithReport(err, reportPath)
	}

	fmt.Println("desktop perf: running chat gateway workflow")
	chatStart := time.Now()
	if err := runChatWorkflow(cfg.Prompt); err != nil {
		finalizeRuntimeArtifacts(mon, &rep, samplesCSVPath, samplesJSONPath, snapshotPath, screenshotPath)
		rep.Failures = append(rep.Failures, err.Error())
		fatalWithReport(err, reportPath)
	}
	rep.Timings["chatRoundTripMs"] = elapsedMs(chatStart)

	if cfg.IncludeCloud {
		fmt.Println("desktop perf: running cloud background-task workflow")
		cloudStart := time.Now()
		cloudRaw, err := evaluateInRenderer(cdp, cloudWorkflowJS(), 240*time.Second)
		if err != nil {
			finalizeRuntimeArtifacts(mon, &rep, samplesCSVPath, samplesJSONPath, snapshotPath, screenshotPath)
			rep.Failures = append(rep.Failures, fmt.Sprintf("cloud workflow failed: %v: %s", err, cloudRaw))
			fatalWithReport(errors.New(rep.Failures[len(rep.Failures)-1]), reportPath)
		}
		rep.Timings["cloudWorkflowMs"] = elapsedMs(cloudStart)
		rep.Workflow["cloud"] = parseJSONOrRaw(cloudRaw)
	}

	if cfg.MemoryRepeats > 0 {
		fmt.Printf("desktop perf: running memory growth loop (%d repeats)\n", cfg.MemoryRepeats)
		if cdp == nil {
			finalizeRuntimeArtifacts(mon, &rep, samplesCSVPath, samplesJSONPath, snapshotPath, screenshotPath)
			rep.Failures = append(rep.Failures, "memory loop requires CDP renderer metrics")
			fatalWithReport(errors.New(rep.Failures[len(rep.Failures)-1]), reportPath)
		}
		beforeRSSMB := currentProcessTreeRSSMB(int32(cmd.Process.Pid))
		beforeRenderer, err := readRendererMetrics(cdp)
		if err != nil {
			finalizeRuntimeArtifacts(mon, &rep, samplesCSVPath, samplesJSONPath, snapshotPath, screenshotPath)
			rep.Failures = append(rep.Failures, fmt.Sprintf("memory loop pre-metrics failed: %v", err))
			fatalWithReport(errors.New(rep.Failures[len(rep.Failures)-1]), reportPath)
		}
		memoryRaw, err := evaluateInRenderer(cdp, memoryLoopJS(cfg.MemoryRepeats), time.Duration(cfg.MemoryRepeats*20)*time.Second)
		if err != nil {
			finalizeRuntimeArtifacts(mon, &rep, samplesCSVPath, samplesJSONPath, snapshotPath, screenshotPath)
			rep.Failures = append(rep.Failures, fmt.Sprintf("memory loop failed: %v: %s", err, memoryRaw))
			fatalWithReport(errors.New(rep.Failures[len(rep.Failures)-1]), reportPath)
		}
		time.Sleep(2 * time.Second)
		afterRSSMB := currentProcessTreeRSSMB(int32(cmd.Process.Pid))
		afterRenderer, err := readRendererMetrics(cdp)
		if err != nil {
			finalizeRuntimeArtifacts(mon, &rep, samplesCSVPath, samplesJSONPath, snapshotPath, screenshotPath)
			rep.Failures = append(rep.Failures, fmt.Sprintf("memory loop post-metrics failed: %v", err))
			fatalWithReport(errors.New(rep.Failures[len(rep.Failures)-1]), reportPath)
		}
		rep.Workflow["memoryLoop"] = parseJSONOrRaw(memoryRaw)
		if err := recordMemoryLoopMetrics(&rep, memoryRaw, beforeRSSMB, beforeRenderer["JSHeapUsedSizeMB"], afterRSSMB, afterRenderer["JSHeapUsedSizeMB"]); err != nil {
			finalizeRuntimeArtifacts(mon, &rep, samplesCSVPath, samplesJSONPath, snapshotPath, screenshotPath)
			rep.Failures = append(rep.Failures, err.Error())
			fatalWithReport(err, reportPath)
		}
	}

	rep.Timings["totalWorkflowMs"] = elapsedMs(launchStarted)

	if cdp != nil {
		if result, err := cdp.call("Profiler.stop", nil); err != nil {
			rep.Warnings = append(rep.Warnings, fmt.Sprintf("CDP Profiler.stop failed: %v", err))
		} else if err := writeCPUProfile(profilePath, result); err != nil {
			rep.Warnings = append(rep.Warnings, fmt.Sprintf("failed to write CPU profile: %v", err))
		}
		if metrics, err := readRendererMetrics(cdp); err != nil {
			rep.Warnings = append(rep.Warnings, fmt.Sprintf("CDP metrics failed: %v", err))
		} else {
			rep.Renderer = metrics
		}
	}
	if longTaskRaw, err := evaluateInRenderer(cdp, collectLongTaskObserverJS(), 10*time.Second); err != nil {
		rep.Warnings = append(rep.Warnings, fmt.Sprintf("long-task collection failed: %v: %s", err, longTaskRaw))
	} else {
		rep.Workflow["longTasks"] = parseJSONOrRaw(longTaskRaw)
		if supported, err := recordLongTaskMetrics(&rep, longTaskRaw); err != nil {
			rep.Warnings = append(rep.Warnings, err.Error())
		} else if !supported {
			rep.Warnings = append(rep.Warnings, "renderer Long Task API was not available")
		}
	}

	mon.markIdle()
	if cfg.IdleSeconds > 0 {
		fmt.Printf("desktop perf: sampling idle for %ds\n", cfg.IdleSeconds)
		time.Sleep(time.Duration(cfg.IdleSeconds) * time.Second)
	}

	if out, err := runAgent(20*time.Second, "", "snapshot"); err == nil {
		_ = os.WriteFile(snapshotPath, []byte(out), 0o644)
	} else {
		rep.Warnings = append(rep.Warnings, fmt.Sprintf("snapshot failed: %v", err))
	}
	if _, err := runAgent(30*time.Second, "", "screenshot", screenshotPath); err != nil {
		rep.Warnings = append(rep.Warnings, fmt.Sprintf("screenshot failed: %v", err))
	}

	mon.stopSampling()
	samples := mon.snapshot()
	rep.Resources = summarizeSamples(samples, mon.idleStartMs())
	if err := writeSamplesCSV(samplesCSVPath, samples); err != nil {
		rep.Warnings = append(rep.Warnings, fmt.Sprintf("failed to write samples csv: %v", err))
	}
	if err := writeJSON(samplesJSONPath, samples); err != nil {
		rep.Warnings = append(rep.Warnings, fmt.Sprintf("failed to write samples json: %v", err))
	}

	if cfg.Tier != perfTierCommit {
		fmt.Println("desktop perf: measuring warm launch")
		if cdp != nil {
			cdp.close()
		}
		_, _ = runAgent(10*time.Second, "", "close")
		cleanupDesktop(cmd)
		cancelApp()
		if err := waitForPortFree(cfg.CDPPort, "warm Electron CDP", 15*time.Second); err != nil {
			rep.Failures = append(rep.Failures, err.Error())
			fatalWithReport(err, reportPath)
		}
		warmTimings, warmRaw, err := measureWarmLaunch(cfg, warmDesktopLogPath)
		if err != nil {
			rep.Failures = append(rep.Failures, fmt.Sprintf("warm launch failed: %v", err))
			fatalWithReport(errors.New(rep.Failures[len(rep.Failures)-1]), reportPath)
		}
		for key, value := range warmTimings {
			rep.Timings[key] = value
		}
		rep.Workflow["warmLaunch"] = warmRaw
	}

	rep.Comparable = comparableMetrics(rep)
	rep.Failures = append(rep.Failures, checkBudgets(cfg, *budgets, rep.Comparable, rep.Resources.OpenFilesSupported)...)
	baselineFailures, baselineWarnings := checkBaseline(cfg, *budgets, rep.Comparable)
	rep.Failures = append(rep.Failures, baselineFailures...)
	rep.Warnings = append(rep.Warnings, baselineWarnings...)

	// Refresh the baseline when the run is green and either explicitly updating
	// (UpdateBaseline disables the relative check) or rolling it forward in CI
	// (RefreshBaselineOnPass keeps the check active, then promotes a passing run).
	if len(rep.Failures) == 0 && (cfg.UpdateBaseline || cfg.RefreshBaselineOnPass) {
		if err := writeBaseline(cfg, rep.Repo.Commit, rep.Comparable); err != nil {
			rep.Failures = append(rep.Failures, fmt.Sprintf("failed to update baseline: %v", err))
		} else {
			fmt.Printf("desktop perf: updated baseline %s\n", cfg.BaselinePath)
		}
	}

	if len(rep.Failures) > 0 {
		fmt.Fprintln(os.Stderr, "desktop perf: failed")
		for _, failure := range rep.Failures {
			fmt.Fprintf(os.Stderr, "  - %s\n", failure)
		}
		fmt.Fprintf(os.Stderr, "report: %s\n", reportPath)
		panic(controlledExit{code: 1})
	}

	fmt.Println("desktop perf: ok")
	fmt.Printf("  report:   %s\n", reportPath)
	fmt.Printf("  profile:  %s\n", profilePath)
	fmt.Printf("  samples:  %s\n", samplesCSVPath)
}
