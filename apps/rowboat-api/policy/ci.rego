package main

required_fragments := {
	"make fmt-check architecture mod-verify",
	"go test ./... -race -count=1",
	"golangci/golangci-lint-action@v8",
	"govulncheck@v1.7.0",
	"gitleaks:v8.30.1",
	"make policy",
}

workflow_contains(fragment) if {
	walk(input, [_, value])
	is_string(value)
	contains(value, fragment)
}

deny contains message if {
	input.name == "Oppulence API Quality"
	fragment := required_fragments[_]
	not workflow_contains(fragment)
	message := sprintf("rowboat-api quality workflow must retain %q", [fragment])
}

migration_required_fragments := {
	"make install-atlas",
	"make migration-validate migration-lint",
}

deny contains message if {
	input.name == "Rowboat API Migrations"
	fragment := migration_required_fragments[_]
	not workflow_contains(fragment)
	message := sprintf("rowboat-api migration workflow must retain %q", [fragment])
}
