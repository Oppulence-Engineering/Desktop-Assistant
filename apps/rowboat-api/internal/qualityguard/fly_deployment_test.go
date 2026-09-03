package qualityguard

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFlyDeploymentContract(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	config := readRepositoryFile(t, root, "fly.toml")

	for _, required := range []string{
		`primary_region = "iad"`,
		`release_command = "/rowboat-api-migrate apply"`,
		`app = "/rowboat-api"`,
		`worker = "/rowboat-api-worker"`,
		`scheduler = "/rowboat-api-scheduler"`,
		`processes = ["app"]`,
		`internal_port = 8080`,
		`auto_stop_machines = "stop"`,
		`auto_start_machines = true`,
		`min_machines_running = 1`,
		`path = "/readyz"`,
		`[checks.worker_readiness]`,
		`processes = ["worker"]`,
		`[checks.scheduler_readiness]`,
		`processes = ["scheduler"]`,
		`port = 9090`,
		`type = "http"`,
		`memory = "512mb"`,
		`memory = "256mb"`,
		`TOKEN_AUDIENCE = ""`,
	} {
		if !strings.Contains(config, required) {
			t.Errorf("fly.toml missing deployment invariant %q", required)
		}
	}

	script := readRepositoryFile(t, root, "scripts/fly-deploy.sh")
	for _, required := range []string{
		`flyctl config validate`,
		`--strict`,
		`--remote-only`,
		`--process-group app`,
		`--region iad,sjc`,
		`--max-per-region 1`,
		`--process-group worker --region iad`,
		`--process-group scheduler --region iad`,
		`flyctl checks list`,
	} {
		if !strings.Contains(script, required) {
			t.Errorf("fly deploy script missing regional invariant %q", required)
		}
	}
}

func TestFlyDeploymentWorkflowContract(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	workflow := readRepositoryFile(t, root, "../../.github/workflows/rowboat-api-fly-deploy.yml")

	for _, required := range []string{
		`workflow_dispatch:`,
		`environment: production`,
		`ROWBOAT_API_FLY_API_TOKEN`,
		`ROWBOAT_API_FLY_APP_NAME`,
		`apps/rowboat-api/scripts/fly-deploy.sh`,
		`/healthz`,
		`/readyz`,
		`flyctl logs`,
	} {
		if !strings.Contains(workflow, required) {
			t.Errorf("Fly workflow missing deployment invariant %q", required)
		}
	}
}

func TestFlyImageSupportsProcessAndReleaseCommands(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	dockerfile := readRepositoryFile(t, root, "Dockerfile")

	for _, required := range []string{
		`RUN chmod -R a=rX /src/apps/rowboat-api/migrations/postgres`,
		`-o /out/rowboat-api-migrate ./cmd/migrate`,
		`COPY --from=build /src/apps/rowboat-api/migrations/postgres /migrations/postgres`,
		`CMD ["/rowboat-api"]`,
	} {
		if !strings.Contains(dockerfile, required) {
			t.Errorf("Dockerfile missing Fly runtime invariant %q", required)
		}
	}
	if strings.Contains(dockerfile, `ENTRYPOINT ["/rowboat-api"]`) {
		t.Error("rowboat-api must be CMD so Fly process groups can replace it")
	}
	if strings.Contains(dockerfile, `COPY --from=atlas`) {
		t.Error("rowboat-api runtime image must not bundle the Atlas CLI")
	}
}

func readRepositoryFile(t *testing.T, root, name string) string {
	t.Helper()
	contents, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(name)))
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}
