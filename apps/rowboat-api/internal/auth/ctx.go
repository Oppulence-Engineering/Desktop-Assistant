// Package auth holds request-scoped identity: the context helpers that carry
// the authenticated user (and the internal-caller flag) through a request, the
// JWT-verification middleware, and the WorkOS user upsert.
//
// ctx.go is the leaf of this package: it imports only the ent types and is
// safe to import from internal/db (for tenant-scoping interceptors) without
// creating a cycle.
package auth

import (
	"context"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
)

type userKey struct{}
type internalKey struct{}

// WithUser returns a context carrying the authenticated user.
func WithUser(ctx context.Context, u *ent.User) context.Context {
	return context.WithValue(ctx, userKey{}, u)
}

// UserFromCtx returns the authenticated user, if any.
func UserFromCtx(ctx context.Context) (*ent.User, bool) {
	u, ok := ctx.Value(userKey{}).(*ent.User)
	return u, ok && u != nil
}

// WithInternal marks a context as an internal (server-to-server) caller,
// allowing it to bypass the per-user query scope.
func WithInternal(ctx context.Context) context.Context {
	return context.WithValue(ctx, internalKey{}, true)
}

// WithInternalOnly marks a context as internal and explicitly removes any
// authenticated user inherited from the request. Use this only for deliberate
// cross-tenant lookups after the handler has already authenticated and
// authorized the operation. Tenant hooks intentionally let a user identity win
// over WithInternal, so this separate helper makes the bypass explicit.
func WithInternalOnly(ctx context.Context) context.Context {
	ctx = context.WithValue(ctx, userKey{}, (*ent.User)(nil))
	return WithInternal(ctx)
}

// IsInternalCaller reports whether the context is an internal caller.
func IsInternalCaller(ctx context.Context) bool {
	v, _ := ctx.Value(internalKey{}).(bool)
	return v
}
