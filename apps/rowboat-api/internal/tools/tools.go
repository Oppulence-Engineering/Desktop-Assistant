//go:build tools

// Package tools pins the code-generation toolchain as module dependencies so
// `go mod tidy` keeps them (the generators are invoked from ent/entc.go, which
// is //go:build ignore and therefore invisible to tidy's import graph).
//
// In particular this forces a Go 1.26-compatible ogen: entgo.io/contrib pins
// an old ogen (v0.56.1) whose jsonschema package fails to compile against the
// current slices API; go.mod requires a newer ogen and this keeps it.
package tools

import (
	_ "entgo.io/contrib/entgql"
	_ "entgo.io/contrib/entoas"
	_ "github.com/99designs/gqlgen"
	_ "github.com/flume/enthistory"
	_ "github.com/ogen-go/ogen"
)
