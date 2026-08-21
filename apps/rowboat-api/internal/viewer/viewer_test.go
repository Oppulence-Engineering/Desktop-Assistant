package viewer

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestViewerContext(t *testing.T) {
	t.Parallel()

	id := uuid.New()
	ctx := WithUserID(context.Background(), id)
	if got, ok := UserID(ctx); !ok || got != id {
		t.Fatalf("UserID() = (%v, %v), want (%v, true)", got, ok, id)
	}
	if IsInternal(ctx) {
		t.Fatal("ordinary user context must not be internal")
	}

	ctx = WithInternal(ctx)
	if !IsInternal(ctx) {
		t.Fatal("WithInternal context must be internal")
	}
	ctx = WithoutUser(ctx)
	if _, ok := UserID(ctx); ok {
		t.Fatal("WithoutUser must shadow an inherited user")
	}
}
