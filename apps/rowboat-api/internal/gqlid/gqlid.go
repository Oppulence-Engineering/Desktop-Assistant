// Package gqlid provides gqlgen marshalers for the uuid.UUID-backed GraphQL
// ID and UUID scalars.
//
// gqlgen discovers a function-based marshaler by looking for Marshal<TypeName>
// in the package the scalar's model points at (see gqlgen binder.go). uuid's
// own package has no such function, so the scalar is bound to gqlid.UUID — an
// alias of uuid.UUID (type-identical, so it matches ent's id type) — and the
// Marshal/Unmarshal functions live here where gqlgen will find them.
package gqlid

import (
	"fmt"
	"io"
	"strconv"

	"github.com/99designs/gqlgen/graphql"
	"github.com/google/uuid"
)

// UUID is an alias of uuid.UUID so resolver/ent signatures stay identical.
type UUID = uuid.UUID

// MarshalUUID renders a UUID as a JSON string.
func MarshalUUID(id UUID) graphql.Marshaler {
	return graphql.WriterFunc(func(w io.Writer) {
		_, _ = io.WriteString(w, strconv.Quote(id.String()))
	})
}

// UnmarshalUUID parses a GraphQL value into a UUID.
func UnmarshalUUID(v any) (UUID, error) {
	switch v := v.(type) {
	case string:
		return uuid.Parse(v)
	case []byte:
		return uuid.Parse(string(v))
	default:
		return uuid.UUID{}, fmt.Errorf("uuid must be a string, got %T", v)
	}
}
