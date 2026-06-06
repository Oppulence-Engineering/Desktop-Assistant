package perf

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

func loadConfig() (config, error) {
	root := os.Getenv("ROWBOAT_REPO_ROOT")
	if root == "" {
		wd, err := os.Getwd()
		if err != nil {
			return config{}, err
		}
		root = filepath.Clean(filepath.Join(wd, "..", ".."))
	}
	root, _ = filepath.Abs(root)

	apiPort := envString("ROWBOAT_API_PORT", "18080")
	devstackPort := envString("ROWBOAT_DEVSTACK_PORT", "18090")
	apiURL := envString("ROWBOAT_DESKTOP_PERF_API_URL", envString("API_URL", "http://localhost:"+apiPort))
	devstackURL := envString("ROWBOAT_DESKTOP_PERF_DEVSTACK_URL", "http://localhost:"+devstackPort)
	cdpPort, err := envInt("ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT", 9333)
	if err != nil {
		return config{}, err
	}
	vitePort, err := envInt("ROWBOAT_DESKTOP_VITE_PORT", 5173)
	if err != nil {
		return config{}, err
	}
	idleSeconds, err := envInt("ROWBOAT_DESKTOP_PERF_IDLE_SECONDS", 10)
	if err != nil {
		return config{}, err
	}

	mode := strings.ToLower(envString("ROWBOAT_DESKTOP_PERF_MODE", "package"))
	if mode != "package" && mode != "dev" {
		return config{}, fmt.Errorf("ROWBOAT_DESKTOP_PERF_MODE must be package or dev, got %q", mode)
	}
	tier := strings.ToLower(envString("ROWBOAT_DESKTOP_PERF_TIER", perfTierCommit))
	switch tier {
	case perfTierCommit, perfTierFull, perfTierDeep:
	default:
		return config{}, fmt.Errorf("ROWBOAT_DESKTOP_PERF_TIER must be commit, full, or deep, got %q", tier)
	}
	seedNotesFallback := 120
	memoryRepeatsFallback := 0
	switch tier {
	case perfTierFull:
		seedNotesFallback = 1000
		memoryRepeatsFallback = 3
	case perfTierDeep:
		seedNotesFallback = 5000
		memoryRepeatsFallback = 10
	}
	seedNotes, err := envInt("ROWBOAT_DESKTOP_PERF_SEED_NOTES", seedNotesFallback)
	if err != nil {
		return config{}, err
	}
	if seedNotes <= 0 {
		return config{}, fmt.Errorf("ROWBOAT_DESKTOP_PERF_SEED_NOTES must be positive, got %d", seedNotes)
	}
	memoryRepeats, err := envInt("ROWBOAT_DESKTOP_PERF_MEMORY_REPEATS", memoryRepeatsFallback)
	if err != nil {
		return config{}, err
	}
	if memoryRepeats < 0 {
		return config{}, fmt.Errorf("ROWBOAT_DESKTOP_PERF_MEMORY_REPEATS must be non-negative, got %d", memoryRepeats)
	}

	baseArtifactDir := filepath.Join(root, ".rowboat-kind", "desktop-perf")
	artifactDir := os.Getenv("ROWBOAT_DESKTOP_PERF_ARTIFACT_DIR")
	if artifactDir == "" {
		stamp := time.Now().UTC().Format("20060102T150405Z")
		shortCommit := strings.TrimSpace(runGit(root, "rev-parse", "--short=12", "HEAD"))
		if shortCommit == "" {
			shortCommit = "unknown"
		}
		artifactDir = filepath.Join(baseArtifactDir, stamp+"-"+shortCommit)
	}
	if !filepath.IsAbs(artifactDir) {
		artifactDir = filepath.Join(root, artifactDir)
	}

	budgetPath := envString("ROWBOAT_DESKTOP_PERF_BUDGET", filepath.Join(root, "tools", "desktop-perf", "budget.json"))
	baselinePath := envString(
		"ROWBOAT_DESKTOP_PERF_BASELINE",
		filepath.Join(baseArtifactDir, fmt.Sprintf("baseline-%s-%s-%s-%s.json", mode, tier, runtime.GOOS, runtime.GOARCH)),
	)

	cfg := config{
		RepoRoot:       root,
		ArtifactDir:    artifactDir,
		WorkDir:        filepath.Join(artifactDir, "workdir"),
		Mode:           mode,
		Tier:           tier,
		APIURL:         strings.TrimRight(apiURL, "/"),
		DevstackURL:    strings.TrimRight(devstackURL, "/"),
		CDPPort:        cdpPort,
		VitePort:       vitePort,
		Prompt:         envString("ROWBOAT_DESKTOP_PERF_PROMPT", "Please respond with exactly: local rowboat performance gate passed"),
		BudgetPath:     budgetPath,
		BaselinePath:   baselinePath,
		AgentSession:          envString("ROWBOAT_DESKTOP_PERF_AGENT_SESSION", "rowboat-desktop-perf-"+filepath.Base(artifactDir)),
		UpdateBaseline:        envBool("ROWBOAT_DESKTOP_PERF_UPDATE_BASELINE", false),
		RefreshBaselineOnPass: envBool("ROWBOAT_DESKTOP_PERF_REFRESH_BASELINE_ON_PASS", false),
		SkipPackage:           envBool("ROWBOAT_DESKTOP_PERF_SKIP_PACKAGE", false),
		IncludeCloud:   envBool("ROWBOAT_DESKTOP_PERF_INCLUDE_CLOUD", tier != perfTierCommit),
		IdleSeconds:    idleSeconds,
		SeedNotes:      seedNotes,
		MemoryRepeats:  memoryRepeats,
	}

	if customWorkDir := os.Getenv("ROWBOAT_DESKTOP_PERF_WORKDIR"); customWorkDir != "" {
		cfg.WorkDir = customWorkDir
		if !filepath.IsAbs(cfg.WorkDir) {
			cfg.WorkDir = filepath.Join(root, cfg.WorkDir)
		}
	}
	return cfg, nil
}

func envString(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) (int, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer: %w", key, err)
	}
	return parsed, nil
}

func envBool(key string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	return value == "1" || value == "true" || value == "yes" || value == "on"
}
