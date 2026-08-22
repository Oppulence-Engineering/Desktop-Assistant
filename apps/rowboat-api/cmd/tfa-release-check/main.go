// Command tfa-release-check validates RFC 038's release evidence register and
// fails closed when a requested rollout stage still has unsigned gates.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
)

type register struct {
	SchemaVersion string `json:"schemaVersion"`
	Release       string `json:"release"`
	ReleaseOwner  string `json:"releaseOwner"`
	Gates         []gate `json:"gates"`
}

type gate struct {
	ID             int      `json:"id"`
	Title          string   `json:"title"`
	Owner          string   `json:"owner"`
	Status         string   `json:"status"`
	RequiredStages []string `json:"requiredStages"`
	Evidence       []string `json:"evidence"`
	VerifiedBy     string   `json:"verifiedBy"`
	VerifiedAt     string   `json:"verifiedAt"`
}

var stages = map[string]bool{
	"validate": true, "internal_read_only": true, "internal_governed_action": true,
	"design_partner_read_only": true, "design_partner_governed_action": true, "beta": true,
}

var statuses = map[string]bool{
	"pending": true, "ready_for_verification": true, "passed": true,
}

func main() {
	path := flag.String("register", "docs/trustworthy-first-account-beta/release-evidence.json", "release evidence register")
	stage := flag.String("stage", "validate", "rollout stage to authorize, or validate")
	flag.Parse()
	if err := run(*path, *stage); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "TFA release check failed:", err)
		os.Exit(1)
	}
}

func run(path, stage string) error {
	if !stages[stage] {
		return fmt.Errorf("unsupported stage %q", stage)
	}
	raw, err := os.ReadFile(path) //nolint:gosec // Maintainer selects the local release-evidence file.
	if err != nil {
		return err
	}
	var manifest register
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return fmt.Errorf("decode register: %w", err)
	}
	if manifest.SchemaVersion != "tfa-release-evidence-v1" || strings.TrimSpace(manifest.Release) == "" {
		return fmt.Errorf("unsupported or incomplete register header")
	}
	seen := map[int]bool{}
	blocked := []string{}
	for _, item := range manifest.Gates {
		if item.ID < 1 || item.ID > 17 || seen[item.ID] {
			return fmt.Errorf("gate ids must contain each RFC gate exactly once; invalid id %d", item.ID)
		}
		seen[item.ID] = true
		if strings.TrimSpace(item.Title) == "" || strings.TrimSpace(item.Owner) == "" || !statuses[item.Status] {
			return fmt.Errorf("gate %d has invalid title, owner, or status", item.ID)
		}
		for _, requiredStage := range item.RequiredStages {
			if !stages[requiredStage] || requiredStage == "validate" {
				return fmt.Errorf("gate %d has unsupported required stage %q", item.ID, requiredStage)
			}
		}
		if item.Status == "passed" {
			if len(item.Evidence) == 0 || strings.TrimSpace(item.VerifiedBy) == "" || strings.TrimSpace(item.VerifiedAt) == "" {
				return fmt.Errorf("gate %d claims passed without evidence and verifier attribution", item.ID)
			}
			if _, err := time.Parse(time.RFC3339, item.VerifiedAt); err != nil {
				return fmt.Errorf("gate %d verifiedAt must be RFC3339: %w", item.ID, err)
			}
		}
		if stage != "validate" && contains(item.RequiredStages, stage) && item.Status != "passed" {
			blocked = append(blocked, fmt.Sprintf("%02d %s (%s)", item.ID, item.Title, item.Status))
		}
	}
	for id := 1; id <= 17; id++ {
		if !seen[id] {
			return fmt.Errorf("release register is missing gate %d", id)
		}
	}
	if stage != "validate" {
		if strings.TrimSpace(manifest.ReleaseOwner) == "" || manifest.ReleaseOwner == "pending_assignment" {
			blocked = append(blocked, "named release owner is not assigned")
		}
		if len(blocked) > 0 {
			sort.Strings(blocked)
			return fmt.Errorf("%s remains blocked:\n- %s", stage, strings.Join(blocked, "\n- "))
		}
	}
	fmt.Printf("TFA release register valid for %s (%d gates)\n", stage, len(manifest.Gates))
	return nil
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
