package backgroundtaskruntime

import "sort"

// registry is the deny-by-default tool surface. It is constructed per run
// from an explicit slice — unknown names structurally cannot resolve, and a
// known tool absent from this run's slice (scope-filtered at construction) is
// equally denied. The model sees only List().
type registry struct {
	tools map[string]Tool
	order []string
}

// NewRegistry builds a registry over exactly the given tools.
func NewRegistry(tools []Tool) ToolRegistry {
	r := &registry{tools: make(map[string]Tool, len(tools))}
	for _, t := range tools {
		if t == nil {
			continue
		}
		if _, dup := r.tools[t.Name()]; dup {
			continue // first registration wins; duplicates are a programming error
		}
		r.tools[t.Name()] = t
		r.order = append(r.order, t.Name())
	}
	sort.Strings(r.order)
	return r
}

// Lookup resolves an allowlisted tool or returns ErrToolNotAllowed — for
// unknown names (model hallucinations) and scope-filtered names alike.
func (r *registry) Lookup(name string) (Tool, error) {
	t, ok := r.tools[name]
	if !ok {
		return nil, ErrToolNotAllowed
	}
	return t, nil
}

// List returns the advertised tools in stable name order.
func (r *registry) List() []Tool {
	out := make([]Tool, 0, len(r.order))
	for _, name := range r.order {
		out = append(out, r.tools[name])
	}
	return out
}
