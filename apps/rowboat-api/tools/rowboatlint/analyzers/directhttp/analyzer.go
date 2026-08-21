// Package directhttp rejects unbounded net/http convenience clients.
package directhttp

import (
	"go/ast"
	"go/types"
	"strings"

	"golang.org/x/tools/go/analysis"
)

// Analyzer requires explicit HTTP clients and request contexts.
var Analyzer = &analysis.Analyzer{
	Name: "rbdirecthttp",
	Doc:  "RB004_DIRECT_HTTP: outbound calls must use an explicit bounded client and request context",
	Run:  run,
}

var convenienceFunctions = map[string]bool{
	"Get":      true,
	"Head":     true,
	"Post":     true,
	"PostForm": true,
}

func run(pass *analysis.Pass) (any, error) {
	for _, file := range pass.Files {
		if strings.HasSuffix(pass.Fset.Position(file.Pos()).Filename, "_test.go") {
			continue
		}
		ast.Inspect(file, func(node ast.Node) bool {
			selector, ok := node.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			qualifier, ok := selector.X.(*ast.Ident)
			if !ok {
				return true
			}
			pkg, ok := pass.TypesInfo.ObjectOf(qualifier).(*types.PkgName)
			if !ok || pkg.Imported().Path() != "net/http" {
				return true
			}
			obj := pass.TypesInfo.ObjectOf(selector.Sel)
			if obj == nil {
				return true
			}
			switch typed := obj.(type) {
			case *types.Var:
				if typed.Name() == "DefaultClient" {
					pass.Reportf(selector.Pos(), "RB004_DIRECT_HTTP: http.DefaultClient has no repository timeout policy; use an explicit client")
				}
			case *types.Func:
				if convenienceFunctions[typed.Name()] {
					pass.Reportf(selector.Pos(), "RB004_DIRECT_HTTP: http.%s bypasses explicit client and context policy; use NewRequestWithContext and an explicit client", typed.Name())
				}
			}
			return true
		})
	}
	return nil, nil
}
