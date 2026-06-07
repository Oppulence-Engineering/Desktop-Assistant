package gqlapi

import (
	"context"
	"fmt"

	"github.com/99designs/gqlgen/graphql"
	"github.com/vektah/gqlparser/v2/ast"
	"github.com/vektah/gqlparser/v2/gqlerror"
)

type depthLimit struct {
	limit int
}

func (d depthLimit) ExtensionName() string {
	return "DepthLimit"
}

func (d depthLimit) Validate(graphql.ExecutableSchema) error {
	if d.limit <= 0 {
		return fmt.Errorf("GraphQL depth limit must be > 0")
	}
	return nil
}

func (d depthLimit) MutateOperationContext(_ context.Context, opCtx *graphql.OperationContext) *gqlerror.Error {
	if opCtx == nil || opCtx.Operation == nil || opCtx.Doc == nil {
		return nil
	}
	depth := selectionDepth(opCtx.Operation.SelectionSet, opCtx.Doc.Fragments, map[string]bool{})
	if depth > d.limit {
		return gqlerror.Errorf("query depth %d exceeds limit %d", depth, d.limit)
	}
	return nil
}

func selectionDepth(set ast.SelectionSet, fragments ast.FragmentDefinitionList, seen map[string]bool) int {
	maxDepth := 0
	for _, selection := range set {
		depth := 0
		switch s := selection.(type) {
		case *ast.Field:
			depth = 1
			if len(s.SelectionSet) > 0 {
				depth += selectionDepth(s.SelectionSet, fragments, seen)
			}
		case *ast.InlineFragment:
			depth = selectionDepth(s.SelectionSet, fragments, seen)
		case *ast.FragmentSpread:
			if seen[s.Name] {
				continue
			}
			def := fragments.ForName(s.Name)
			if def == nil {
				continue
			}
			seen[s.Name] = true
			depth = selectionDepth(def.SelectionSet, fragments, seen)
			delete(seen, s.Name)
		}
		if depth > maxDepth {
			maxDepth = depth
		}
	}
	return maxDepth
}
