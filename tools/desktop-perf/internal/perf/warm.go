package perf

import (
	"context"
	"fmt"
	"strconv"
	"time"
)

func measureWarmLaunch(cfg config, logPath string) (map[string]float64, map[string]any, error) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd, err := startDesktop(ctx, cfg, logPath)
	if err != nil {
		return nil, nil, err
	}
	defer cleanupDesktop(cmd)

	launchStarted := time.Now()
	if err := waitForCDP(cfg.CDPPort, 120*time.Second); err != nil {
		return nil, nil, err
	}
	timings := map[string]float64{
		"warmLaunchToCdpMs": elapsedMs(launchStarted),
	}
	if out, err := runAgent(30*time.Second, "", "connect", strconv.Itoa(cfg.CDPPort)); err != nil {
		return nil, nil, fmt.Errorf("agent-browser warm connect failed: %v: %s", err, out)
	}
	defer runAgent(10*time.Second, "", "close")

	cdp, err := connectCDP(cfg.CDPPort)
	if err != nil {
		return nil, nil, fmt.Errorf("warm CDP connect failed: %w", err)
	}
	defer cdp.close()
	_, _ = cdp.call("Performance.enable", nil)

	signedInShellMs, err := waitForInteractive(launchStarted)
	if err != nil {
		return nil, nil, err
	}
	timings["warmSignedInShellMs"] = signedInShellMs
	timings["warmStartupInteractiveMs"] = elapsedMs(launchStarted)
	chatInputUsableMs, err := waitForChatInputUsable(cdp, launchStarted)
	if err != nil {
		return nil, nil, err
	}
	timings["warmChatInputUsableMs"] = chatInputUsableMs

	navRaw, err := evaluateInRenderer(cdp, navigationTimingJS(), 10*time.Second)
	if err != nil {
		return nil, nil, fmt.Errorf("warm navigation metrics failed: %w: %s", err, navRaw)
	}
	tmp := report{Timings: timings}
	if err := recordNavigationMetrics(&tmp, navRaw, "warm"); err != nil {
		return nil, nil, err
	}
	raw := map[string]any{
		"navigation": parseJSONOrRaw(navRaw),
	}
	return timings, raw, nil
}
