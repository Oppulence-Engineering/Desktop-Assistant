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
		`dockerfile = "Dockerfile"`,
		`primary_region = "iad"`,
		`release_command = "/rowboat-api-migrate apply"`,
		`app = "/rowboat-api"`,
		`worker = "/rowboat-api-worker"`,
		`scheduler = "/rowboat-api-scheduler"`,
		`processes = ["app"]`,
		`internal_port = 8080`,
		`auto_stop_machines = "off"`,
		`auto_start_machines = false`,
		`path = "/readyz"`,
		`[checks.worker_readiness]`,
		`processes = ["worker"]`,
		`[checks.scheduler_readiness]`,
		`processes = ["scheduler"]`,
		`port = 9090`,
		`type = "http"`,
		`memory = "512mb"`,
		`memory = "256mb"`,
	} {
		if !strings.Contains(config, required) {
			t.Errorf("fly.toml missing deployment invariant %q", required)
		}
	}

	script := readRepositoryFile(t, root, "scripts/fly-deploy.sh")
	for _, required := range []string{
		`flyctl config validate`,
		`--strict`,
		`--buildkit`,
		`--remote-only`,
		`--process-group app`,
		`flyctl scale count 3`,
		`--region iad,sjc`,
		`--process-group worker --region iad,sjc --max-per-region 1`,
		`--process-group scheduler --region iad,sjc --max-per-region 1`,
		`flyctl machines list`,
		`flyctl checks list`,
	} {
		if !strings.Contains(script, required) {
			t.Errorf("fly deploy script missing regional invariant %q", required)
		}
	}
}

func TestFlyDeploymentWorkflowContract(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	workflow := readRepositoryFile(t, root, "../../.github/workflows/rowboat-api-deploy.yml")

	for _, required := range []string{
		`workflow_dispatch:`,
		`branches: [main]`,
		`environment: production`,
		`ROWBOAT_API_FLY_API_TOKEN`,
		`ROWBOAT_API_FLY_APP_NAME`,
		`infisical export`,
		`flyctl secrets import --stage`,
		`apps/rowboat-api/scripts/fly-deploy.sh`,
		`/healthz`,
		`/readyz`,
		`flyctl logs`,
	} {
		if !strings.Contains(workflow, required) {
			t.Errorf("Fly workflow missing deployment invariant %q", required)
		}
	}
	for _, forbidden := range []string{`kubectl`, `helm upgrade`, `rowboat-staging`} {
		if strings.Contains(workflow, forbidden) {
			t.Errorf("Fly workflow must not contain Kubernetes invariant %q", forbidden)
		}
	}
}

func TestFlyImageSupportsProcessAndReleaseCommands(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	dockerfile := readRepositoryFile(t, root, "Dockerfile")

	for _, required := range []string{
		`ENV GOFLAGS="-p=1"`,
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
