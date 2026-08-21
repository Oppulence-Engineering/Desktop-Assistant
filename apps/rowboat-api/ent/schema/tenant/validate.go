package tenant

import (
	"encoding/json"
	"fmt"
	"strings"

	"entgo.io/ent/entc/gen"
)

// ValidateHook rejects incomplete tenant schemas before Ent writes generated
// code. This makes tenant ownership metadata part of code generation rather
// than another handwritten registry that can drift.
func ValidateHook() gen.Hook {
	return func(next gen.Generator) gen.Generator {
		return gen.GenerateFunc(func(graph *gen.Graph) error {
			for _, node := range graph.Nodes {
				if strings.HasSuffix(node.Name, "History") {
					continue
				}
				descriptor, annotated, err := annotationFor(node)
				if err != nil {
					return err
				}
				ownershipEdges := make(map[string]*gen.Edge)
				for _, edge := range node.Edges {
					if edge.IsInverse() && (edge.Name == "user" || edge.Name == "workspace") {
						ownershipEdges[edge.Name] = edge
						if !edge.Unique || edge.Optional || !edge.Immutable {
							return fmt.Errorf("tenant schema %s edge %q must be unique, required, and immutable", node.Name, edge.Name)
						}
					}
				}
				if !annotated {
					if len(ownershipEdges) > 0 {
						return fmt.Errorf("tenant schema %s has an ownership edge but no RowboatTenant annotation", node.Name)
					}
					continue
				}
				requiredEdge := map[Scope]string{
					ScopeUser:            "user",
					ScopeWorkspace:       "workspace",
					ScopeWorkspaceRoot:   "user",
					ScopeActionWorkspace: "action",
				}[descriptor.Scope]
				if requiredEdge == "" {
					return fmt.Errorf("tenant schema %s has unsupported scope %q", node.Name, descriptor.Scope)
				}
				edge, ok := edgeNamed(node, requiredEdge)
				if !ok {
					return fmt.Errorf("tenant schema %s scope %q requires edge %q", node.Name, descriptor.Scope, requiredEdge)
				}
				if !edge.Unique || edge.Optional || !edge.Immutable {
					return fmt.Errorf("tenant schema %s scope edge %q must be unique, required, and immutable", node.Name, requiredEdge)
				}
			}
			return next.Generate(graph)
		})
	}
}

func annotationFor(node *gen.Type) (Annotation, bool, error) {
	raw, ok := node.Annotations[(Annotation{}).Name()]
	if !ok {
		return Annotation{}, false, nil
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return Annotation{}, false, fmt.Errorf("encode tenant annotation for %s: %w", node.Name, err)
	}
	var descriptor Annotation
	if err := json.Unmarshal(encoded, &descriptor); err != nil {
		return Annotation{}, false, fmt.Errorf("decode tenant annotation for %s: %w", node.Name, err)
	}
	return descriptor, true, nil
}

func edgeNamed(node *gen.Type, name string) (*gen.Edge, bool) {
	for _, edge := range node.Edges {
		if edge.Name == name {
			return edge, true
		}
	}
	return nil, false
}
