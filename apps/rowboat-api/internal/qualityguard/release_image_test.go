package qualityguard

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestProductionLatestIsPromotedAfterVerification(t *testing.T) {
	repositoryRoot := filepath.Clean(filepath.Join("..", "..", "..", ".."))
	workflow := readRepositoryFile(t, repositoryRoot, ".github/workflows/rowboat-api-deploy.yml")

	for _, required := range []string{
		"platforms: linux/amd64,linux/arm64",
		"Authenticated production workflow smoke",
		"Promote verified image as production-latest",
		`--tag "${IMAGE_REPOSITORY}:production-latest"`,
		`"${IMAGE_REPOSITORY}@${{ needs.build-image.outputs.image_digest }}"`,
	} {
		if !strings.Contains(workflow, required) {
			t.Errorf("rowboat-api deploy workflow missing release invariant %q", required)
		}
	}

	smoke := strings.Index(workflow, "Authenticated production workflow smoke")
	promotion := strings.Index(workflow, "Promote verified image as production-latest")
	if smoke < 0 || promotion < 0 || promotion < smoke {
		t.Fatal("production-latest must be promoted only after the production smoke test")
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
