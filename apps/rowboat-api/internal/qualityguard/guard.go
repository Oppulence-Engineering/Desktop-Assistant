// Package qualityguard checks Rowboat-specific architecture invariants that
// general-purpose Go linters cannot infer.
package qualityguard

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const modulePath = "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api"

// Violation describes one architecture rule failure.
type Violation struct {
	Rule    string
	Path    string
	Line    int
	Message string
}

func (v Violation) String() string {
	location := v.Path
	if v.Line > 0 {
		location = fmt.Sprintf("%s:%d", location, v.Line)
	}
	return fmt.Sprintf("%s: %s: %s", location, v.Rule, v.Message)
}

// Check runs all repository-specific guards against a rowboat-api root.
func Check(root string) ([]Violation, error) {
	checks := []func(string) ([]Violation, error){
		checkTenantRegistries,
		checkDependencyDirection,
	}
	var violations []Violation
	for _, check := range checks {
		got, err := check(root)
		if err != nil {
			return nil, err
		}
		violations = append(violations, got...)
	}
	return violations, nil
}

// checkTenantRegistries treats every handwritten schema with a required user
// edge as tenant-owned. Such an entity must be registered independently on the
// Ent read and write paths; checking both prevents one-sided protection drift.
func checkTenantRegistries(root string) ([]Violation, error) {
	interceptorsPath := filepath.Join(root, "internal", "db", "interceptors.go")
	registry, err := os.ReadFile(interceptorsPath)
	if err != nil {
		return nil, fmt.Errorf("read tenant registry: %w", err)
	}

	paths, err := filepath.Glob(filepath.Join(root, "ent", "schema", "*.go"))
	if err != nil {
		return nil, fmt.Errorf("list Ent schemas: %w", err)
	}
	var violations []Violation
	for _, path := range paths {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		source, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil, fmt.Errorf("read Ent schema %s: %w", path, readErr)
		}
		if !strings.Contains(string(source), `edge.From("user"`) {
			continue
		}
		entity, parseErr := schemaType(path, source)
		if parseErr != nil {
			return nil, parseErr
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return nil, relErr
		}
		if !strings.Contains(string(registry), "client."+entity+".Intercept") {
			violations = append(violations, Violation{
				Rule: "tenant-read-scope", Path: rel,
				Message: entity + " has a user edge but no Ent read interceptor",
			})
		}
		if !strings.Contains(string(registry), "ent.Type"+entity+":") {
			violations = append(violations, Violation{
				Rule: "tenant-write-scope", Path: rel,
				Message: entity + " has a user edge but no tenant mutation registry entry",
			})
		}
	}
	return violations, nil
}

func schemaType(path string, source []byte) (string, error) {
	file, err := parser.ParseFile(token.NewFileSet(), path, source, 0)
	if err != nil {
		return "", fmt.Errorf("parse Ent schema %s: %w", path, err)
	}
	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.TYPE {
			continue
		}
		for _, spec := range gen.Specs {
			typeSpec, ok := spec.(*ast.TypeSpec)
			if !ok {
				continue
			}
			structure, ok := typeSpec.Type.(*ast.StructType)
			if !ok {
				continue
			}
			for _, field := range structure.Fields.List {
				selector, ok := field.Type.(*ast.SelectorExpr)
				if !ok {
					continue
				}
				pkg, pkgOK := selector.X.(*ast.Ident)
				if pkgOK && pkg.Name == "ent" && selector.Sel.Name == "Schema" {
					return typeSpec.Name.Name, nil
				}
			}
		}
	}
	return "", fmt.Errorf("find Ent schema type in %s", path)
}

// checkDependencyDirection prevents production packages from depending on
// executable composition roots. cmd may import internal; never the reverse.
func checkDependencyDirection(root string) ([]Violation, error) {
	var violations []Violation
	err := filepath.WalkDir(filepath.Join(root, "internal"), func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") {
			return nil
		}
		fset := token.NewFileSet()
		file, parseErr := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if parseErr != nil {
			return parseErr
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return relErr
		}
		for _, spec := range file.Imports {
			importPath, quoteErr := strconv.Unquote(spec.Path.Value)
			if quoteErr == nil && strings.HasPrefix(importPath, modulePath+"/cmd/") {
				violations = append(violations, Violation{
					Rule: "dependency-direction", Path: rel, Line: fset.Position(spec.Pos()).Line,
					Message: "internal packages must not import executable composition roots",
				})
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("scan dependency direction: %w", err)
	}
	return violations, nil
}
