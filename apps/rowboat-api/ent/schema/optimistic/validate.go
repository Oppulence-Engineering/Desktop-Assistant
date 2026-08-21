package optimistic

import (
	"encoding/json"
	"fmt"

	"entgo.io/ent/entc/gen"
)

// ValidateHook ensures annotated aggregate roots retain a usable lock field.
func ValidateHook() gen.Hook {
	return func(next gen.Generator) gen.Generator {
		return gen.GenerateFunc(func(graph *gen.Graph) error {
			for _, node := range graph.Nodes {
				raw, ok := node.Annotations[(Annotation{}).Name()]
				if !ok {
					continue
				}
				encoded, err := json.Marshal(raw)
				if err != nil {
					return fmt.Errorf("encode optimistic-lock annotation for %s: %w", node.Name, err)
				}
				var descriptor Annotation
				if err := json.Unmarshal(encoded, &descriptor); err != nil {
					return fmt.Errorf("decode optimistic-lock annotation for %s: %w", node.Name, err)
				}
				var found bool
				for _, schemaField := range node.Fields {
					if schemaField.Name != descriptor.Field {
						continue
					}
					found = true
					if !schemaField.Type.Numeric() || schemaField.Optional || schemaField.Immutable {
						return fmt.Errorf("optimistic-lock field %s.%s must be required, numeric, and mutable", node.Name, descriptor.Field)
					}
				}
				if !found {
					return fmt.Errorf("optimistic-lock schema %s is missing field %q", node.Name, descriptor.Field)
				}
			}
			return next.Generate(graph)
		})
	}
}
