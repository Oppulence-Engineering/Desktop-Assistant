package perf

import (
	"fmt"
	"os"
	"strings"
	"time"
)

func waitForInteractive(launchStarted time.Time) (float64, error) {
	snapshot, err := waitForSnapshotAny(120*time.Second, []string{
		"Type your message...",
		"Good morning",
		"New chat",
		"Welcome to Solomon AI",
		"Welcome to Rowboat",
		"Connect Your Accounts",
		"You're All Set!",
	})
	if err != nil {
		return 0, err
	}
	if strings.Contains(snapshot, "Welcome to Rowboat") || strings.Contains(snapshot, "Welcome to Solomon AI") {
		if _, err := runAgent(20*time.Second, "", "find", "role", "button", "click", "--name", "Continue"); err != nil {
			return 0, fmt.Errorf("failed to continue onboarding: %w", err)
		}
		if _, err := runAgent(30*time.Second, "", "wait", "--text", "Connect Your Accounts"); err != nil {
			return 0, fmt.Errorf("failed waiting for connectors onboarding: %w", err)
		}
		if _, err := runAgent(20*time.Second, "", "find", "role", "button", "click", "--name", "Skip for now"); err != nil {
			return 0, fmt.Errorf("failed to skip connectors onboarding: %w", err)
		}
		if _, err := runAgent(30*time.Second, "", "wait", "--text", "You're All Set!"); err != nil {
			return 0, fmt.Errorf("failed waiting for completion onboarding: %w", err)
		}
		if _, err := runAgent(20*time.Second, "", "find", "role", "button", "click", "--name", "Start Using Rowboat"); err != nil {
			if _, fallbackErr := runAgent(20*time.Second, "", "find", "role", "button", "click", "--name", "Start Using Solomon AI"); fallbackErr != nil {
				return 0, fmt.Errorf("failed to finish onboarding: %w", err)
			}
		}
	}
	if _, err := waitForSnapshotAny(60*time.Second, []string{"Type your message...", "Good morning", "New chat"}); err != nil {
		return 0, fmt.Errorf("desktop UI did not reach signed-in home: %w", err)
	}
	return elapsedMs(launchStarted), nil
}

func waitForChatInputUsable(cdp *cdpClient, launchStarted time.Time) (float64, error) {
	deadline := time.Now().Add(30 * time.Second)
	var last string
	for time.Now().Before(deadline) {
		raw, err := evaluateInRenderer(cdp, chatInputUsableJS(), 5*time.Second)
		if err == nil {
			last = raw
			if strings.TrimSpace(raw) == "true" {
				return elapsedMs(launchStarted), nil
			}
		} else {
			last = err.Error()
		}
		time.Sleep(500 * time.Millisecond)
	}
	return 0, fmt.Errorf("chat input did not become usable: %s", last)
}

func runChatWorkflow(prompt string) error {
	if _, err := runAgent(20*time.Second, "", "fill", `textarea[name="message"]`, prompt); err != nil {
		return fmt.Errorf("failed to fill chat prompt: %w", err)
	}
	if _, err := runAgent(10*time.Second, "", "press", "Enter"); err != nil {
		return fmt.Errorf("failed to submit chat prompt: %w", err)
	}
	if _, err := runAgent(45*time.Second, "", "wait", "--text", "Hello from the mock LLM."); err != nil {
		return fmt.Errorf("desktop chat did not receive mock LLM response: %w", err)
	}
	return nil
}

func finalizeRuntimeArtifacts(mon *monitor, rep *report, samplesCSVPath, samplesJSONPath, snapshotPath, screenshotPath string) {
	if out, err := runAgent(10*time.Second, "", "snapshot"); err == nil {
		_ = os.WriteFile(snapshotPath, []byte(out), 0o644)
	} else {
		rep.Warnings = append(rep.Warnings, fmt.Sprintf("failure snapshot failed: %v", err))
	}
	if _, err := runAgent(15*time.Second, "", "screenshot", screenshotPath); err != nil {
		rep.Warnings = append(rep.Warnings, fmt.Sprintf("failure screenshot failed: %v", err))
	}
	samples := mon.snapshot()
	rep.Resources = summarizeSamples(samples, mon.idleStartMs())
	if err := writeSamplesCSV(samplesCSVPath, samples); err != nil {
		rep.Warnings = append(rep.Warnings, fmt.Sprintf("failed to write samples csv: %v", err))
	}
	if err := writeJSON(samplesJSONPath, samples); err != nil {
		rep.Warnings = append(rep.Warnings, fmt.Sprintf("failed to write samples json: %v", err))
	}
	rep.Comparable = comparableMetrics(*rep)
}

func ipcWorkflowJS() string {
	return `(() => (async () => {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const timings = [];
  const invokeWithRetry = async (channel, payload, options = {}) => {
    const attempts = options.attempts ?? 5;
    const delayMs = options.delayMs ?? 500;
    let lastError;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await window.ipc.invoke(channel, payload);
      } catch (error) {
        lastError = error;
        if (i + 1 < attempts) {
          await sleep(delayMs * (i + 1));
        }
      }
    }
    throw lastError;
  };
  const timedInvoke = async (channel, payload, options = {}) => {
    const startedAt = performance.now();
    try {
      const result = await invokeWithRetry(channel, payload, options);
      timings.push({ channel, ms: performance.now() - startedAt, ok: true });
      return result;
    } catch (error) {
      timings.push({ channel, ms: performance.now() - startedAt, ok: false, error: String(error?.message ?? error) });
      throw error;
    }
  };
  const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[index];
  };
  const summarize = (values) => ({
    count: values.length,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    maxMs: values.length ? Math.max(...values) : 0,
    totalMs: values.reduce((sum, value) => sum + value, 0)
  });
  const summarizeTimings = () => {
    const successful = timings.filter((entry) => entry.ok);
    const byChannel = {};
    for (const entry of successful) {
      byChannel[entry.channel] ??= [];
      byChannel[entry.channel].push(entry.ms);
    }
    return {
      ...summarize(successful.map((entry) => entry.ms)),
      failedCount: timings.length - successful.length,
      slowest: successful.reduce((slowest, entry) => !slowest || entry.ms > slowest.ms ? entry : slowest, null),
      byChannel: Object.fromEntries(Object.entries(byChannel).map(([channel, values]) => [channel, summarize(values)]))
    };
  };
  const startedAt = performance.now();
  const ipc = window.ipc;
  if (!ipc?.invoke) {
    throw new Error('window.ipc.invoke is unavailable');
  }
  const root = await timedInvoke('workspace:getRoot', null);
  await timedInvoke('workspace:mkdir', { path: 'knowledge/PerfWrite', recursive: true });
  const writes = [];
  for (let i = 0; i < 60; i += 1) {
    writes.push(timedInvoke('workspace:writeFile', {
      path: 'knowledge/PerfWrite/workflow-' + String(i).padStart(3, '0') + '.md',
      data: '# Workflow Note ' + i + '\n\nrowboatperf workflow corpus ' + i + '\n\n' + 'body '.repeat(200),
      opts: { mkdirp: true, atomic: true }
    }, { attempts: 3, delayMs: 250 }));
  }
  await Promise.all(writes);
  const treeStartedAt = performance.now();
  const tree = await timedInvoke('workspace:readdir', { path: 'knowledge', opts: { recursive: true, includeStats: true } }, { attempts: 8, delayMs: 250 });
  const treeMs = performance.now() - treeStartedAt;
  const searchStartedAt = performance.now();
  const search = await timedInvoke('search:query', { query: 'rowboatperf', limit: 20, types: ['knowledge'] });
  const searchMs = performance.now() - searchStartedAt;
  const runsStartedAt = performance.now();
  const runs = await timedInvoke('runs:list', { limit: 20 }, { attempts: 8, delayMs: 1000 });
  const runsMs = performance.now() - runsStartedAt;
  const modelsStartedAt = performance.now();
  const models = await timedInvoke('models:list', null, { attempts: 8, delayMs: 1000 });
  const modelsMs = performance.now() - modelsStartedAt;
  const modelIds = (models.providers ?? []).flatMap((provider) => provider.models?.map((model) => model.id) ?? []);
  if (modelIds.length === 0) {
    throw new Error('models:list returned no gateway models');
  }
  return {
    root,
    written: writes.length,
    treeCount: tree.length,
    searchCount: search.results?.length ?? 0,
    runCount: runs.runs?.length ?? 0,
    providerCount: models.providers?.length ?? 0,
    modelCount: modelIds.length,
    modelIds: modelIds.slice(0, 12),
    treeMs,
    searchMs,
    runsMs,
    modelsMs,
    ipcTimings: summarizeTimings(),
    totalMs: performance.now() - startedAt,
    navigation: performance.getEntriesByType('navigation').map((entry) => ({
      name: entry.name,
      domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
      loadEventEnd: entry.loadEventEnd,
      duration: entry.duration
    }))
  };
})())()`
}

func navigationTimingJS() string {
	return `(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const paints = performance.getEntriesByType('paint');
  const paintByName = Object.fromEntries(paints.map((entry) => [entry.name, entry.startTime]));
  const firstPaint = paintByName['first-contentful-paint'] ?? paintByName['first-paint'] ?? 0;
  return {
    navigationDomContentLoadedMs: nav?.domContentLoadedEventEnd ?? 0,
    navigationLoadMs: nav?.loadEventEnd || nav?.duration || 0,
    navigationDurationMs: nav?.duration ?? 0,
    firstMeaningfulPaintMs: firstPaint,
    paintEntries: paints.map((entry) => ({ name: entry.name, startTime: entry.startTime }))
  };
})()`
}

func chatInputUsableJS() string {
	return `(() => {
  const input = document.querySelector('textarea[name="message"]');
  if (!input) return false;
  const rect = input.getBoundingClientRect();
  return !input.disabled && rect.width > 0 && rect.height > 0;
})()`
}

func startLongTaskObserverJS() string {
	return `(() => {
  window.__rowboatPerfLongTasks = [];
  window.__rowboatPerfLongTaskSupported = false;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__rowboatPerfLongTasks.push({
          name: entry.name,
          startTime: entry.startTime,
          duration: entry.duration
        });
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
    window.__rowboatPerfLongTaskObserver = observer;
    window.__rowboatPerfLongTaskSupported = true;
    return { supported: true };
  } catch (error) {
    return { supported: false, error: String(error?.message ?? error) };
  }
})()`
}

func collectLongTaskObserverJS() string {
	return `(() => {
  const tasks = window.__rowboatPerfLongTasks ?? [];
  const durations = tasks.map((task) => task.duration);
  return {
    supported: Boolean(window.__rowboatPerfLongTaskSupported),
    count: tasks.length,
    maxMs: durations.length ? Math.max(...durations) : 0,
    totalMs: durations.reduce((sum, value) => sum + value, 0),
    tasks: tasks.slice(-25)
  };
})()`
}

func memoryLoopJS(repeats int) string {
	return fmt.Sprintf(`(() => (async () => {
  const repeats = %d;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const startedAt = performance.now();
  const iterations = [];
  for (let i = 0; i < repeats; i += 1) {
    const iterationStartedAt = performance.now();
    await window.ipc.invoke('workspace:writeFile', {
      path: 'knowledge/PerfMemory/loop-' + String(i).padStart(3, '0') + '.md',
      data: '# Memory Loop ' + i + '\n\nrowboatperf memory loop ' + i + '\n\n' + 'payload '.repeat(200),
      opts: { mkdirp: true, atomic: true }
    });
    const treeStartedAt = performance.now();
    const tree = await window.ipc.invoke('workspace:readdir', { path: 'knowledge', opts: { recursive: true, includeStats: true } });
    const treeMs = performance.now() - treeStartedAt;
    const searchStartedAt = performance.now();
    const search = await window.ipc.invoke('search:query', { query: 'rowboatperf', limit: 50, types: ['knowledge'] });
    const searchMs = performance.now() - searchStartedAt;
    const modelsStartedAt = performance.now();
    await window.ipc.invoke('models:list', null);
    const modelsMs = performance.now() - modelsStartedAt;
    iterations.push({
      index: i,
      treeCount: tree.length,
      searchCount: search.results?.length ?? 0,
      treeMs,
      searchMs,
      modelsMs,
      totalMs: performance.now() - iterationStartedAt
    });
    await sleep(100);
  }
  return {
    repeats,
    iterations,
    totalMs: performance.now() - startedAt
  };
})())()`, repeats)
}

func cloudWorkflowJS() string {
	return `(async () => {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const startedAt = performance.now();
  const slugHint = String(Date.now());
  const name = ` + "`Perf cloud workflow ${slugHint}`" + `;
  const create = await window.ipc.invoke('bg-task:create', {
    name,
    instructions: 'Build a short markdown artifact proving this task executed in the Oppulence API Temporal worker.',
    executionTarget: 'api',
  });
  if (!create?.success || !create.slug) {
    throw new Error(` + "`create API background task failed: ${create?.error ?? 'missing slug'}`" + `);
  }

  const runResult = await window.ipc.invoke('bg-task:run', {
    slug: create.slug,
    context: 'desktop performance gate requested this cloud workflow through Electron IPC',
  });
  const runId = runResult?.runId ?? runResult?.run?.runId;
  if (!runResult?.success || !runId) {
    throw new Error(` + "`trigger API background task failed: ${runResult?.error ?? 'missing run id'}`" + `);
  }

  let status;
  const polls = [];
  for (let i = 0; i < 120; i += 1) {
    const statusResult = await window.ipc.invoke('bg-task:getCloudRunStatus', { slug: create.slug, runId });
    if (!statusResult?.success || !statusResult.status) {
      throw new Error(` + "`poll API background task failed: ${statusResult?.error ?? 'missing status'}`" + `);
    }
    status = statusResult.status;
    polls.push({
      attempt: i + 1,
      at: new Date().toISOString(),
      status: status.status,
      temporalStatus: status.temporalStatus,
      progressPercent: status.progressPercent,
      progressMessage: status.progressMessage,
    });
    if (['succeeded', 'failed', 'stopped'].includes(status.status)) break;
    await sleep(1000);
  }
  if (!status || status.status !== 'succeeded') {
    throw new Error(` + "`API background task did not succeed: ${status?.status ?? 'missing status'} ${status?.error ?? ''}`" + `);
  }
  if (status.executor !== 'api' || !status.temporalWorkflowId || !status.temporalRunId) {
    throw new Error(` + "`API background task did not expose Temporal metadata: ${JSON.stringify(status)}`" + `);
  }

  const eventsResult = await window.ipc.invoke('bg-task:listCloudRunEvents', { slug: create.slug, runId });
  if (!eventsResult?.success || !eventsResult.events?.length) {
    throw new Error(` + "`API background task events missing: ${eventsResult?.error ?? 'empty events'}`" + `);
  }
  const pull = await window.ipc.invoke('bg-task:pullCloudArtifact', { slug: create.slug });
  if (!pull?.success) {
    throw new Error(` + "`pull API background task artifact failed: ${pull?.error ?? 'unknown error'}`" + `);
  }
  const artifact = await window.ipc.invoke('workspace:readFile', { path: ` + "`bg-tasks/${create.slug}/index.md`" + ` });
  if (!artifact?.data?.includes('- Executor: api') || !artifact?.data?.includes('Temporal worker')) {
    throw new Error(` + "`pulled artifact did not look API-generated: ${artifact?.data ?? ''}`" + `);
  }
  return {
    name,
    slug: create.slug,
    runId,
    status: status.status,
    executor: status.executor,
    temporalWorkflowId: status.temporalWorkflowId,
    temporalRunId: status.temporalRunId,
    eventCount: eventsResult.events.length,
    eventTypes: eventsResult.events.map(event => event.type),
    pollCount: polls.length,
    artifactPreview: artifact.data.slice(0, 240),
    totalMs: performance.now() - startedAt
  };
})()`
}
