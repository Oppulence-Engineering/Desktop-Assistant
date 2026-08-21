// Package forbiddenlog detects sensitive data being attached to structured logs.
package forbiddenlog

import (
	"go/ast"
	"go/constant"
	"go/types"
	"strings"
	"unicode"

	"golang.org/x/tools/go/analysis"
)

// Analyzer rejects sensitive Zap field keys.
var Analyzer = &analysis.Analyzer{
	Name: "rbforbiddenlog",
	Doc:  "RB011_FORBIDDEN_LOG_DATA: credentials and authentication material must not be logged",
	Run:  run,
}

var forbiddenKeys = map[string]bool{
	"apikey":        true,
	"authorization": true,
	"cookie":        true,
	"setcookie":     true,
	"password":      true,
	"passwd":        true,
	"secret":        true,
	"accesstoken":   true,
	"refreshtoken":  true,
	"idtoken":       true,
	"privatekey":    true,
	"clientsecret":  true,
}

func run(pass *analysis.Pass) (any, error) {
	for _, file := range pass.Files {
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok || len(call.Args) == 0 {
				return true
			}
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			fn, ok := pass.TypesInfo.ObjectOf(selector.Sel).(*types.Func)
			if !ok || fn.Pkg() == nil || fn.Pkg().Path() != "go.uber.org/zap" || fn.Name() == "Error" {
				return true
			}
			value := pass.TypesInfo.Types[call.Args[0]].Value
			if value == nil || value.Kind() != constant.String {
				return true
			}
			key := constant.StringVal(value)
			if forbiddenKeys[normalize(key)] {
				pass.Reportf(call.Args[0].Pos(), "RB011_FORBIDDEN_LOG_DATA: structured log field %q may contain credentials or authentication material", key)
			}
			return true
		})
	}
	return nil, nil
}

func normalize(value string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return unicode.ToLower(r)
		}
		return -1
	}, value)
}
