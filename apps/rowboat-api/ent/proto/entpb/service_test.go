package entpb_test

import (
	"context"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/proto/entpb"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

func TestUserServiceGetAndList(t *testing.T) {
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:entpbtest?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	ctx := context.Background()

	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)

	svc := entpb.NewUserService(d.Client)

	// Get by binary uuid id.
	got, err := svc.Get(ctx, &entpb.GetUserRequest{Id: u.ID[:]})
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.GetWorkosUserId() != "user_1" {
		t.Errorf("workos_user_id = %q", got.GetWorkosUserId())
	}
	if got.GetEmail().GetValue() != "a@x.co" {
		t.Errorf("email = %q", got.GetEmail().GetValue())
	}

	// List returns the user.
	resp, err := svc.List(ctx, &entpb.ListUserRequest{PageSize: 10})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(resp.GetUserList()) != 1 {
		t.Fatalf("list returned %d users, want 1", len(resp.GetUserList()))
	}
}
