// Command broker-key-rotation-check enforces direct-replica JWKS convergence
// before activating or retiring a connector resource-token signing key.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
)

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "broker-key-rotation-check error:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("broker-key-rotation-check", flag.ContinueOnError)
	phase := flags.String("phase", "", "activate or retire")
	replicas := flags.String("replica-jwks-urls", "", "comma-separated direct per-replica JWKS URLs")
	required := flags.String("required-key-ids", "", "comma-separated key IDs every replica must publish")
	candidate := flags.String("candidate-key-id", "", "new key ID to activate")
	retiring := flags.String("retiring-key-id", "", "old key ID to retire")
	activatedAtRaw := flags.String("activated-at", "", "RFC3339 activation timestamp (retire phase)")
	minimumOverlap := flags.Duration("minimum-overlap", 17*time.Minute, "minimum activation-to-retirement overlap")
	timeout := flags.Duration("timeout", 5*time.Second, "per-check HTTP timeout")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}
	if strings.TrimSpace(*phase) == "" || strings.TrimSpace(*replicas) == "" {
		return errors.New("--phase and --replica-jwks-urls are required")
	}
	var activatedAt time.Time
	if strings.TrimSpace(*activatedAtRaw) != "" {
		parsed, err := time.Parse(time.RFC3339, *activatedAtRaw)
		if err != nil {
			return fmt.Errorf("parse --activated-at: %w", err)
		}
		activatedAt = parsed
	}
	report, err := connectors.CheckJWKSRotationConvergence(ctx, connectors.JWKSRotationPolicy{
		Phase:           strings.TrimSpace(*phase),
		ReplicaJWKSURLs: splitCSV(*replicas),
		RequiredKeyIDs:  splitCSV(*required),
		CandidateKeyID:  strings.TrimSpace(*candidate),
		RetiringKeyID:   strings.TrimSpace(*retiring),
		ActivatedAt:     activatedAt,
		MinimumOverlap:  *minimumOverlap,
		HTTPTimeout:     *timeout,
	})
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if encodeErr := encoder.Encode(report); encodeErr != nil {
		return encodeErr
	}
	return err
}

func splitCSV(raw string) []string {
	var values []string
	for _, value := range strings.Split(raw, ",") {
		if value = strings.TrimSpace(value); value != "" {
			values = append(values, value)
		}
	}
	return values
}
