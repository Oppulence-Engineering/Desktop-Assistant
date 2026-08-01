// Command relationship-projector provides audited recovery operations for the
// durable relationship projection outbox.
//
// Examples:
//
//	relationship-projector replay --user-id <uuid> [--relationship-id <uuid>] [--at RFC3339]
//	relationship-projector repair --user-id <uuid> --job-id <uuid> --reason projector-upgrade
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenue"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/telemetry"
)

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "relationship-projector error:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: relationship-projector <replay|repair> [flags]")
	}
	cfg := appconfig.Load()
	log, err := telemetry.NewLogger(cfg)
	if err != nil {
		return err
	}
	database, err := db.Open(ctx, cfg, log)
	if err != nil {
		return err
	}
	defer func() { _ = database.Close() }()
	svc := revenue.NewService(database.Client, nil, nil, log)

	switch args[0] {
	case "replay":
		flags := flag.NewFlagSet("replay", flag.ContinueOnError)
		userRaw := flags.String("user-id", "", "tenant owner user UUID")
		relationshipRaw := flags.String("relationship-id", "", "optional relationship UUID")
		atRaw := flags.String("at", "", "explicit RFC3339 evaluation boundary (default: now)")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		u, userCtx, err := operatorUserContext(ctx, database.Client, *userRaw)
		if err != nil {
			return err
		}
		var relationshipID *uuid.UUID
		if *relationshipRaw != "" {
			parsed, parseErr := uuid.Parse(*relationshipRaw)
			if parseErr != nil {
				return fmt.Errorf("invalid --relationship-id: %w", parseErr)
			}
			relationshipID = &parsed
		}
		evaluatedAt := time.Now().UTC()
		if *atRaw != "" {
			evaluatedAt, err = time.Parse(time.RFC3339Nano, *atRaw)
			if err != nil {
				return fmt.Errorf("invalid --at: %w", err)
			}
		}
		processed, err := svc.ReplayRelationshipProjections(
			userCtx, u, relationshipID, evaluatedAt, "operator-replay-"+uuid.NewString(),
		)
		if err != nil {
			return err
		}
		fmt.Printf("completed %d relationship projection replay(s) at %s\n", processed, evaluatedAt.Format(time.RFC3339Nano))
		return nil

	case "repair":
		flags := flag.NewFlagSet("repair", flag.ContinueOnError)
		userRaw := flags.String("user-id", "", "tenant owner user UUID")
		jobRaw := flags.String("job-id", "", "failed or dead projection job UUID")
		reason := flags.String("reason", "", "bounded operator repair reason")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		u, userCtx, err := operatorUserContext(ctx, database.Client, *userRaw)
		if err != nil {
			return err
		}
		jobID, err := uuid.Parse(*jobRaw)
		if err != nil {
			return fmt.Errorf("invalid --job-id: %w", err)
		}
		_, replacementID, status, err := svc.RepairRelationshipProjectionJob(
			userCtx, u, jobID, *reason,
		)
		if err != nil {
			return err
		}
		fmt.Printf("replacement projection job %s: %s\n", replacementID, status)
		return nil

	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func operatorUserContext(
	ctx context.Context,
	client *ent.Client,
	raw string,
) (*ent.User, context.Context, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid --user-id: %w", err)
	}
	u, err := client.User.Get(auth.WithInternalOnly(ctx), id)
	if err != nil {
		return nil, nil, fmt.Errorf("load operator-selected tenant: %w", err)
	}
	return u, auth.WithUser(ctx, u), nil
}
