package perf

import (
	"context"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

func readRepoInfo(root string) repoInfo {
	status := runGit(root, "status", "--short")
	return repoInfo{
		Branch: strings.TrimSpace(runGit(root, "rev-parse", "--abbrev-ref", "HEAD")),
		Commit: strings.TrimSpace(runGit(root, "rev-parse", "HEAD")),
		Dirty:  strings.TrimSpace(status) != "",
	}
}

func runGit(root string, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = root
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return string(out)
}

func readEnvironment() map[string]string {
	keys := []string{
		"CI",
		"DISPLAY",
		"GITHUB_ACTIONS",
		"NODE_ENV",
		"ROWBOAT_DESKTOP_PERF_MODE",
		"ROWBOAT_DESKTOP_PERF_INCLUDE_CLOUD",
		"RUNNER_OS",
	}
	out := map[string]string{
		"goos":        runtime.GOOS,
		"goarch":      runtime.GOARCH,
		"goVersion":   runtime.Version(),
		"numCPU":      strconv.Itoa(runtime.NumCPU()),
		"currentTime": time.Now().Format(time.RFC3339),
	}
	for _, key := range keys {
		if value, ok := os.LookupEnv(key); ok {
			out[key] = value
		}
	}
	if node, err := exec.LookPath("node"); err == nil {
		out["nodePath"] = node
	}
	return out
}
