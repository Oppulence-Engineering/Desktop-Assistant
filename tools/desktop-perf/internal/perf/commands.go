package perf

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"
)

func runLoggedCommand(timeout time.Duration, logPath, cwd string, env []string, name string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = cwd
	cmd.Env = append(os.Environ(), env...)
	var output bytes.Buffer
	var writer io.Writer = &output
	if logPath != "" {
		file, err := os.Create(logPath)
		if err != nil {
			return err
		}
		defer file.Close()
		writer = io.MultiWriter(file, os.Stdout, &output)
	}
	cmd.Stdout = writer
	cmd.Stderr = writer
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s %s failed: %w", name, strings.Join(args, " "), err)
	}
	return nil
}

func runAgent(timeout time.Duration, stdin string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "agent-browser", args...)
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	out := stdout.String()
	if stderr.Len() > 0 {
		out += "\n" + stderr.String()
	}
	return out, err
}

func runAgentEval(timeout time.Duration, script string) (string, error) {
	return runAgent(timeout, script, "eval", "--stdin")
}

func waitForSnapshotAny(timeout time.Duration, needles []string) (string, error) {
	deadline := time.Now().Add(timeout)
	var last string
	for time.Now().Before(deadline) {
		out, err := runAgent(12*time.Second, "", "snapshot", "-i", "-c")
		if err == nil {
			last = out
			for _, needle := range needles {
				if strings.Contains(out, needle) {
					return out, nil
				}
			}
		}
		time.Sleep(time.Second)
	}
	return last, fmt.Errorf("timed out waiting for desktop UI text %v", needles)
}
