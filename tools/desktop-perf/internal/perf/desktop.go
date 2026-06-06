package perf

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

func packageApp(cfg config, logPath string) error {
	mainDir := filepath.Join(cfg.RepoRoot, "apps", "x", "apps", "main")
	return runLoggedCommand(15*time.Minute, logPath, mainDir, nil, "npm", "run", "package")
}

func startDesktop(ctx context.Context, cfg config, logPath string) (*exec.Cmd, error) {
	env := append(os.Environ(),
		"API_URL="+cfg.APIURL,
		"ROWBOAT_WORKDIR="+cfg.WorkDir,
		"SOLOMON_WORKDIR="+cfg.WorkDir,
		"ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT="+strconv.Itoa(cfg.CDPPort),
		"SOLOMON_ELECTRON_REMOTE_DEBUGGING_PORT="+strconv.Itoa(cfg.CDPPort),
	)

	var cmd *exec.Cmd
	if cfg.Mode == "dev" {
		cmd = exec.CommandContext(ctx, "npm", "run", "dev")
		cmd.Dir = filepath.Join(cfg.RepoRoot, "apps", "x")
	} else {
		bin, err := findPackagedBinary(cfg)
		if err != nil {
			return nil, err
		}
		args := []string{}
		if runtime.GOOS == "linux" {
			args = append(args, "--no-sandbox")
		}
		cmd = exec.CommandContext(ctx, bin, args...)
		cmd.Dir = filepath.Dir(bin)
	}
	cmd.Env = env

	logFile, err := os.Create(logPath)
	if err != nil {
		return nil, err
	}
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return nil, err
	}
	go func() {
		_ = cmd.Wait()
		_ = logFile.Close()
	}()
	return cmd, nil
}

func findPackagedBinary(cfg config) (string, error) {
	outDir := filepath.Join(cfg.RepoRoot, "apps", "x", "apps", "main", "out")
	var candidates []string
	err := filepath.WalkDir(outDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		if info.Mode()&0o111 == 0 {
			return nil
		}
		base := filepath.Base(path)
		switch runtime.GOOS {
		case "darwin":
			if strings.Contains(path, ".app/Contents/MacOS/") {
				candidates = append(candidates, path)
			}
		case "windows":
			if strings.EqualFold(base, "solomon-ai.exe") {
				candidates = append(candidates, path)
			}
		default:
			if base == "solomon-ai" {
				candidates = append(candidates, path)
			}
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if len(candidates) == 0 {
		return "", fmt.Errorf("could not find packaged desktop binary under %s", outDir)
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i] > candidates[j]
	})
	return candidates[0], nil
}

func cleanupDesktop(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	procs := processTree(int32(cmd.Process.Pid))
	sort.Slice(procs, func(i, j int) bool { return procs[i].Pid > procs[j].Pid })
	for _, p := range procs {
		_ = p.Kill()
	}
	_ = cmd.Process.Kill()
}
