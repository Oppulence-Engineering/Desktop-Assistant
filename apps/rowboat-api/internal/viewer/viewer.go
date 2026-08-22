// Package viewer carries the minimum request identity needed by persistence
// policies. It intentionally does not import Ent so schema privacy rules can
// depend on it without creating a generated-code import cycle.
package viewer

import (
	"context"

	"github.com/google/uuid"
)

type userIDKey struct{}
type internalKey struct{}

// WithUserID returns a context carrying an authenticated user's stable ID.
func WithUserID(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, userIDKey{}, id)
}

// WithoutUser returns a context that explicitly shadows any inherited user.
func WithoutUser(ctx context.Context) context.Context {
	return context.WithValue(ctx, userIDKey{}, uuid.Nil)
}

// UserID returns the authenticated user's ID, if present.
func UserID(ctx context.Context) (uuid.UUID, bool) {
	id, ok := ctx.Value(userIDKey{}).(uuid.UUID)
	return id, ok && id != uuid.Nil
}

// WithInternal marks a deliberate server-to-server execution context.
func WithInternal(ctx context.Context) context.Context {
	return context.WithValue(ctx, internalKey{}, true)
}

// IsInternal reports whether the context is an internal execution boundary.
func IsInternal(ctx context.Context) bool {
	internal, _ := ctx.Value(internalKey{}).(bool)
	return internal
}
