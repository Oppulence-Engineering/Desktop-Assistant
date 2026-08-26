package revenue

import (
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/google/uuid"
)

func TestRelationshipAssertionInputJSONRequiresConfidenceAndPreservesZero(t *testing.T) {
	t.Parallel()
	var input RelationshipAssertionInput
	err := json.Unmarshal([]byte(`{"dimension":"health","value":"healthy","reason":"Observed."}`), &input)
	if err == nil || !strings.Contains(err.Error(), "confidence is required") {
		t.Fatalf("missing confidence error = %v", err)
	}
	err = json.Unmarshal([]byte(`{"dimension":"health","value":"healthy","confidence":0,"reason":"Observed."}`), &input)
	if err != nil {
		t.Fatalf("decode explicit zero: %v", err)
	}
	if input.Confidence != 0 {
		t.Fatalf("confidence = %v, want explicit zero", input.Confidence)
	}
}

func TestNormalizeRelationshipAssertionInput(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		input     RelationshipAssertionInput
		wantValue string
		wantRank  int
		wantErr   bool
	}{
		{
			name: "typed lifecycle",
			input: RelationshipAssertionInput{
				Dimension: " lifecycle ", Value: " onboarding ", SourceType: "source_fact", Confidence: 1, Reason: "CRM stage changed.",
			},
			wantValue: "onboarding", wantRank: 4,
		},
		{
			name: "bounded text",
			input: RelationshipAssertionInput{
				Dimension: "summary", Value: " Evidence-backed summary. ", SourceType: "deterministic", Confidence: 0.8, Reason: "Summarized from accepted facts.",
			},
			wantValue: "Evidence-backed summary.", wantRank: 3,
		},
		{
			name: "invalid enum",
			input: RelationshipAssertionInput{
				Dimension: "health", Value: "green", SourceType: "source_fact", Confidence: 1, Reason: "Invalid typed value.",
			},
			wantErr: true,
		},
		{
			name: "unknown dimension",
			input: RelationshipAssertionInput{
				Dimension: "opaque_score", Value: "98", SourceType: "deterministic", Confidence: 1, Reason: "Opaque score is forbidden.",
			},
			wantErr: true,
		},
		{
			name: "future value schema",
			input: RelationshipAssertionInput{
				Dimension: "health", Value: "healthy", ValueSchemaVersion: 2, SourceType: "source_fact", Confidence: 1, Reason: "Future schema.",
			},
			wantErr: true,
		},
		{
			name: "unknown authority",
			input: RelationshipAssertionInput{
				Dimension: "health", Value: "healthy", SourceType: "model_guess", Confidence: 1, Reason: "Unknown authority.",
			},
			wantErr: true,
		},
		{
			name: "missing explanation",
			input: RelationshipAssertionInput{
				Dimension: "health", Value: "healthy", SourceType: "source_fact", Confidence: 1,
			},
			wantErr: true,
		},
		{
			name: "non finite confidence",
			input: RelationshipAssertionInput{
				Dimension: "health", Value: "healthy", SourceType: "ai_inference", Confidence: math.NaN(), Reason: "Invalid confidence.",
			},
			wantErr: true,
		},
		{
			name: "oversized text",
			input: RelationshipAssertionInput{
				Dimension: "summary", Value: strings.Repeat("x", maxRelationshipAssertionValueBytes+1), SourceType: "source_fact", Confidence: 1, Reason: "Oversized value.",
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			normalized, err := normalizeRelationshipAssertionInput(tt.input)
			if tt.wantErr {
				if !errors.Is(err, ErrInvalidInput) {
					t.Fatalf("error = %v, want ErrInvalidInput", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalize: %v", err)
			}
			if normalized.Value != tt.wantValue || normalized.AuthorityRank != tt.wantRank ||
				normalized.ValueSchemaVersion != relationshipAssertionValueSchemaVersion {
				t.Fatalf("unexpected normalized assertion: %#v", normalized)
			}
		})
	}
}

func TestRelationshipAssertionEligibleAtPreservesHistory(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 8, 26, 9, 0, 0, 0, time.UTC)
	endedAt := base.Add(2 * time.Hour)

	for _, status := range []string{
		relationshipAssertionStatusSuperseded,
		relationshipAssertionStatusRetracted,
		relationshipAssertionStatusExpired,
	} {
		eligible, valid := relationshipAssertionEligibleAt(status, base, &endedAt, base.Add(time.Hour))
		if !valid || !eligible {
			t.Fatalf("%s should remain eligible before its end boundary", status)
		}
		eligible, valid = relationshipAssertionEligibleAt(status, base, &endedAt, endedAt)
		if !valid || eligible {
			t.Fatalf("%s should be ineligible at its end boundary", status)
		}
	}

	if eligible, valid := relationshipAssertionEligibleAt(
		relationshipAssertionStatusProposed, base, nil, base.Add(time.Hour),
	); !valid || eligible {
		t.Fatal("a proposed assertion must be recognized but never projected")
	}
	if eligible, valid := relationshipAssertionEligibleAt(
		relationshipAssertionStatusLegacyActive, base, nil, base.Add(time.Hour),
	); !valid || !eligible {
		t.Fatal("the rolling-deployment legacy active status must remain readable")
	}
	if _, valid := relationshipAssertionEligibleAt("unknown-status", base, nil, base); valid {
		t.Fatal("an unknown lifecycle status must fail closed")
	}
	if _, valid := relationshipAssertionEligibleAt(relationshipAssertionStatusRetracted, base, nil, base); valid {
		t.Fatal("an ended lifecycle without validTo must fail closed")
	}
}

func TestLegacyActiveAssertionDerivesAuthorityDuringRollingDeploy(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 26, 9, 15, 0, 0, time.UTC)
	legacySourceFact := &ent.RelationshipAssertion{
		ID: uuid.New(), Dimension: "health", Value: "critical", SourceType: "source_fact",
		Status: relationshipAssertionStatusLegacyActive, AuthorityRank: 1, Confidence: 1,
		ValidFrom: now, ValueSchemaVersion: relationshipAssertionValueSchemaVersion,
		ProjectorCompatVersion: relationshipProjectorVersion,
	}
	acceptedAI := &ent.RelationshipAssertion{
		ID: uuid.New(), Dimension: "health", Value: "healthy", SourceType: "ai_inference",
		Status: relationshipAssertionStatusAccepted, AuthorityRank: 1, Confidence: 1,
		ValidFrom: now, ValueSchemaVersion: relationshipAssertionValueSchemaVersion,
		ProjectorCompatVersion: relationshipProjectorVersion,
	}

	winners, _, err := selectRelationshipAssertionsAt(
		[]*ent.RelationshipAssertion{acceptedAI, legacySourceFact}, now,
	)
	if err != nil {
		t.Fatalf("select legacy assertion: %v", err)
	}
	if winners["health"] == nil || winners["health"].ID != legacySourceFact.ID || winners["health"].AuthorityRank != 4 {
		t.Fatalf("legacy source fact did not receive derived authority: %#v", winners["health"])
	}
}
