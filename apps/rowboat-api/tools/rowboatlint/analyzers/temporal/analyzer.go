// Package temporal detects nondeterministic side effects in Temporal workflow functions.
package temporal

import (
	"go/ast"
	"go/types"

	"golang.org/x/tools/go/analysis"
)

const workflowPackage = "go.temporal.io/sdk/workflow"

// Analyzer enforces Temporal workflow determinism.
var Analyzer = &analysis.Analyzer{
	Name: "rbtemporal",
	Doc:  "RB003_TEMPORAL_SIDE_EFFECT: workflow functions must use deterministic Temporal APIs",
	Run:  run,
}

var forbiddenCalls = map[string]map[string]bool{
	"time":                   {"Now": true, "Sleep": true},
	"math/rand":              {"*": true},
	"math/rand/v2":           {"*": true},
	"crypto/rand":            {"*": true},
	"net/http":               {"*": true},
	"os":                     {"*": true},
	"github.com/google/uuid": {"New": true, "NewString": true},
}

func run(pass *analysis.Pass) (any, error) {
	for _, file := range pass.Files {
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil || !acceptsWorkflowContext(pass, fn) {
				continue
			}
			ast.Inspect(fn.Body, func(node ast.Node) bool {
				switch n := node.(type) {
				case *ast.GoStmt:
					pass.Reportf(n.Go, "RB003_TEMPORAL_SIDE_EFFECT: workflow functions must not start goroutines; use Temporal workflow primitives")
				case *ast.CallExpr:
					reportForbiddenCall(pass, n)
				}
				return true
			})
		}
	}
	return nil, nil
}

func acceptsWorkflowContext(pass *analysis.Pass, fn *ast.FuncDecl) bool {
	if fn.Type.Params == nil {
		return false
	}
	for _, field := range fn.Type.Params.List {
		named, ok := pass.TypesInfo.TypeOf(field.Type).(*types.Named)
		if !ok || named.Obj().Pkg() == nil {
			continue
		}
		if named.Obj().Pkg().Path() == workflowPackage && named.Obj().Name() == "Context" {
			return true
		}
	}
	return false
}

func reportForbiddenCall(pass *analysis.Pass, call *ast.CallExpr) {
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return
	}
	fn, ok := pass.TypesInfo.ObjectOf(selector.Sel).(*types.Func)
	if !ok || fn.Pkg() == nil {
		return
	}
	blocked, ok := forbiddenCalls[fn.Pkg().Path()]
	if !ok || (!blocked["*"] && !blocked[fn.Name()]) {
		return
	}
	pass.Reportf(call.Pos(), "RB003_TEMPORAL_SIDE_EFFECT: %s.%s is nondeterministic in workflow code; move the effect to an activity or use workflow APIs", fn.Pkg().Name(), fn.Name())
}
