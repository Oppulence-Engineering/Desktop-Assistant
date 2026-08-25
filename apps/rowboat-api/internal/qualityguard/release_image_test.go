package qualityguard

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestFlyProductionIsSmokedAfterDeployment(t *testing.T) {
	repositoryRoot := filepath.Clean(filepath.Join("..", "..", "..", ".."))
	workflow := readRepositoryFile(t, repositoryRoot, ".github/workflows/rowboat-api-deploy.yml")

	for _, required := range []string{
		"Deploy and converge process topology",
		"Smoke test Fly deployment",
		"apps/rowboat-api/scripts/fly-deploy.sh",
		"/healthz",
		"/readyz",
	} {
		if !strings.Contains(workflow, required) {
			t.Errorf("rowboat-api deploy workflow missing release invariant %q", required)
		}
	}

	deploy := strings.Index(workflow, "Deploy and converge process topology")
	smoke := strings.Index(workflow, "Smoke test Fly deployment")
	if deploy < 0 || smoke < deploy {
		t.Fatal("Fly production must be smoke-tested after deployment")
	}
}

func TestProductionImageContainsEveryLocalStackRole(t *testing.T) {
	repositoryRoot := filepath.Clean(filepath.Join("..", "..", "..", ".."))
	dockerfile := readRepositoryFile(t, repositoryRoot, "apps/rowboat-api/Dockerfile")

	for _, required := range []string{
		"COPY --from=build /out/rowboat-api /rowboat-api",
		"COPY --from=build /out/rowboat-api-worker /rowboat-api-worker",
		"COPY --from=build /out/devstack /devstack",
	} {
		if !strings.Contains(dockerfile, required) {
			t.Errorf("rowboat-api production image missing local-stack role %q", required)
		}
	}
}
