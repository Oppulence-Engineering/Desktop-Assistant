package connectors

import (
	"fmt"
	"slices"
	"strings"
)

// validateRequestedScopes applies the canonical catalog as a closed allowlist.
// Omitting requested scopes selects only required scopes, preserving least
// privilege while ensuring the connection is usable.
func (r *Registry) validateRequestedScopes(connector string, requested []string) ([]string, error) {
	available := r.AvailableScopes(connector)
	byName := make(map[string]ScopeDefinition, len(available))
	for _, scope := range available {
		byName[scope.Name] = scope
	}
	if len(requested) == 0 {
		for _, scope := range available {
			if scope.GrantTier == "required" {
				requested = append(requested, scope.Name)
			}
		}
	}
	selected := make(map[string]struct{}, len(requested))
	result := make([]string, 0, len(requested))
	for _, raw := range requested {
		name := strings.TrimSpace(raw)
		if name == "" {
			return nil, fmt.Errorf("requested scopes must not contain empty values")
		}
		if _, ok := byName[name]; !ok {
			return nil, fmt.Errorf("scope %q is not available for connector %q in this environment", name, connector)
		}
		if _, duplicate := selected[name]; duplicate {
			return nil, fmt.Errorf("scope %q was requested more than once", name)
		}
		selected[name] = struct{}{}
		result = append(result, name)
	}
	for _, scope := range available {
		if scope.GrantTier == "required" {
			if _, ok := selected[scope.Name]; !ok {
				return nil, fmt.Errorf("required scope %q is missing", scope.Name)
			}
		}
	}
	for _, name := range result {
		scope := byName[name]
		for _, implied := range scope.Implies {
			if _, ok := selected[implied]; !ok {
				return nil, fmt.Errorf("scope %q requires implied scope %q", name, implied)
			}
		}
		for _, conflict := range scope.ConflictsWith {
			if _, ok := selected[conflict]; ok {
				return nil, fmt.Errorf("scope %q conflicts with scope %q", name, conflict)
			}
		}
	}
	return result, nil
}

func (r *Registry) definitionsForScopes(connector string, names []string) []ScopeDefinition {
	selected := make(map[string]struct{}, len(names))
	for _, name := range names {
		selected[name] = struct{}{}
	}
	result := make([]ScopeDefinition, 0, len(names))
	for _, scope := range r.AvailableScopes(connector) {
		if _, ok := selected[scope.Name]; ok {
			result = append(result, scope)
		}
	}
	return result
}

func validateGrantedScopes(requested, granted []string) ([]string, error) {
	if len(granted) == 0 {
		return append([]string(nil), requested...), nil
	}
	allowed := make(map[string]struct{}, len(requested))
	for _, scope := range requested {
		allowed[scope] = struct{}{}
	}
	clean := make([]string, 0, len(granted))
	seen := make(map[string]struct{}, len(granted))
	for _, raw := range granted {
		scope := strings.TrimSpace(raw)
		if scope == "" || scope == "offline_access" {
			continue
		}
		if _, ok := allowed[scope]; !ok {
			return nil, fmt.Errorf("upstream granted unrequested scope %q", scope)
		}
		if _, duplicate := seen[scope]; !duplicate {
			seen[scope] = struct{}{}
			clean = append(clean, scope)
		}
	}
	for _, required := range requested {
		if !slices.Contains(clean, required) {
			return nil, fmt.Errorf("upstream omitted requested scope %q", required)
		}
	}
	return clean, nil
}

func isSubset(requested, granted []string) bool {
	set := make(map[string]struct{}, len(granted))
	for _, scope := range granted {
		set[scope] = struct{}{}
	}
	for _, scope := range requested {
		if _, ok := set[scope]; !ok {
			return false
		}
	}
	return true
}
