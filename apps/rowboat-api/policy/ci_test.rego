package main

complete_workflow := {
	"name": "Oppulence API Quality",
	"jobs": {
		"quality": {"steps": [
			{"run": "make fmt-check architecture mod-verify"},
			{"run": "go test ./... -race -count=1"},
			{"uses": "golangci/golangci-lint-action@v8"},
			{"run": "go install golang.org/x/vuln/cmd/govulncheck@v1.7.0"},
			{"run": "docker run gitleaks:v8.30.1"},
			{"run": "make policy"},
		]},
	},
}

test_accepts_complete_quality_workflow if {
	result := deny with input as complete_workflow
	count(result) == 0
}

test_rejects_removed_quality_gate if {
	incomplete := object.remove(complete_workflow, ["jobs", "quality", "steps"])
	result := deny with input as incomplete
	count(result) == count(required_fragments)
}

complete_migration_workflow := {
	"name": "Rowboat API Migrations",
	"jobs": {"migration-policy": {"steps": [
		{"run": "make install-atlas"},
		{"run": "make migration-validate migration-lint"},
	]}},
}

test_accepts_complete_migration_workflow if {
	result := deny with input as complete_migration_workflow
	count(result) == 0
}

test_rejects_removed_migration_gate if {
	incomplete := object.remove(complete_migration_workflow, ["jobs", "migration-policy", "steps"])
	result := deny with input as incomplete
	count(result) == count(migration_required_fragments)
}
