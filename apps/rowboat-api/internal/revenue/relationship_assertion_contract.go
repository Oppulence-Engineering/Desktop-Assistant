package revenue

import (
	"fmt"
	"math"
	"strings"
	"time"
)

const (
	relationshipAssertionValueSchemaVersion = 1
	maxRelationshipAssertionValueBytes      = 4096

	relationshipAssertionStatusProposed   = "proposed"
	relationshipAssertionStatusAccepted   = "accepted"
	relationshipAssertionStatusRejected   = "rejected"
	relationshipAssertionStatusSuperseded = "superseded"
	relationshipAssertionStatusRetracted  = "retracted"
	relationshipAssertionStatusExpired    = "expired"

	// relationshipAssertionStatusLegacyActive is read-only compatibility for
	// rolling deployments where a pre-R1.1 binary may still write the former
	// status after the additive migration. New code never persists it.
	relationshipAssertionStatusLegacyActive = "active"
)

type relationshipAssertionAdmission uint8

const (
	relationshipAssertionAdmissionTrusted relationshipAssertionAdmission = iota
	relationshipAssertionAdmissionUntrustedObservation
	relationshipAssertionAdmissionUserCorrection
)

var relationshipAssertionEnumValues = map[string]map[string]struct{}{
	"lifecycle": relationshipAssertionStringSet(
		"prospect", "evaluation", "contracting", "onboarding",
		"active_customer", "renewal", "churned", "former_customer",
	),
	"engagement": relationshipAssertionStringSet("unknown", "increasing", "steady", "declining", "dormant"),
	"sentiment":  relationshipAssertionStringSet("unknown", "positive", "mixed", "negative"),
	"health":     relationshipAssertionStringSet("unknown", "healthy", "needs_attention", "critical"),
}

var relationshipAssertionTextDimensions = relationshipAssertionStringSet("summary", "next_action", "risk", "milestone")

func relationshipAssertionStringSet(values ...string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		set[value] = struct{}{}
	}
	return set
}

// normalizeRelationshipAssertionInput validates the versioned value contract
// before an assertion can become accepted evidence. Projectors only consume
// values that passed this deterministic schema boundary.
func normalizeRelationshipAssertionInput(input RelationshipAssertionInput) (RelationshipAssertionInput, error) {
	input.Dimension = strings.TrimSpace(input.Dimension)
	input.Value = strings.TrimSpace(input.Value)
	input.SourceType = strings.TrimSpace(input.SourceType)
	input.ExtractorVersion = strings.TrimSpace(input.ExtractorVersion)
	input.SupersedesAssertionID = strings.TrimSpace(input.SupersedesAssertionID)
	input.Reason = strings.TrimSpace(input.Reason)

	if input.ValueSchemaVersion == 0 {
		input.ValueSchemaVersion = relationshipAssertionValueSchemaVersion
	}
	if input.ValueSchemaVersion != relationshipAssertionValueSchemaVersion {
		return input, validateRelationshipAssertionValue(input.Dimension, input.Value, input.ValueSchemaVersion)
	}
	if input.Reason == "" {
		return input, fmt.Errorf("%w: assertion reason is required", ErrInvalidInput)
	}
	if len(input.Reason) > maxRelationshipAssertionValueBytes {
		return input, fmt.Errorf(
			"%w: assertion reason exceeds %d bytes",
			ErrInvalidInput, maxRelationshipAssertionValueBytes,
		)
	}
	if err := validateRelationshipAssertionValue(input.Dimension, input.Value, input.ValueSchemaVersion); err != nil {
		return input, err
	}

	switch input.admission {
	case relationshipAssertionAdmissionUntrustedObservation:
		// No public assertion may select a future projector or suppress another
		// assertion. Explicit supersession remains a dedicated correction action
		// where relationship, lifecycle, and dimension are validated transactionally.
		input.ProjectorCompatVersion = relationshipProjectorVersion
		input.SupersedesAssertionID = ""
		if input.UserConfirmed {
			// An authenticated user may confirm a claim in the same atomic,
			// idempotent observation write that durably records its evidence. This
			// is a user decision, never caller-minted provider authority.
			input.admission = relationshipAssertionAdmissionUserCorrection
			input.SourceType = "user_correction"
			input.status = relationshipAssertionStatusAccepted
			break
		}
		if input.SourceType == "user_correction" {
			return input, fmt.Errorf(
				"%w: user corrections must use the dedicated correction endpoint",
				ErrInvalidInput,
			)
		}
		// An authenticated observer may propose a claim, but cannot assign
		// canonical authority to itself. Provider-verified adapters use the
		// trusted internal ingestion path instead.
		input.SourceType = "ai_inference"
		input.status = relationshipAssertionStatusProposed
	case relationshipAssertionAdmissionUserCorrection:
		input.SourceType = "user_correction"
		input.status = relationshipAssertionStatusAccepted
	default:
		if input.SourceType == "user_correction" {
			return input, fmt.Errorf(
				"%w: user corrections must use the dedicated correction path",
				ErrInvalidInput,
			)
		}
		if input.SourceType == "" {
			input.SourceType = "ai_inference"
		}
		input.status = relationshipAssertionStatusAccepted
	}
	authorityRank, ok := relationshipAssertionAuthorityRank(input.SourceType)
	if !ok {
		return input, fmt.Errorf("%w: unsupported assertion source type %q", ErrInvalidInput, input.SourceType)
	}
	input.AuthorityRank = authorityRank
	if math.IsNaN(input.Confidence) || math.IsInf(input.Confidence, 0) || input.Confidence < 0 || input.Confidence > 1 {
		return input, fmt.Errorf("%w: assertion confidence must be between 0 and 1", ErrInvalidInput)
	}
	return input, nil
}

func validateRelationshipAssertionValue(dimension, value string, schemaVersion int) error {
	if schemaVersion != relationshipAssertionValueSchemaVersion {
		return fmt.Errorf(
			"%w: unsupported assertion value schema version %d",
			ErrInvalidInput, schemaVersion,
		)
	}
	if dimension == "" || value == "" {
		return fmt.Errorf("%w: assertion dimension and value are required", ErrInvalidInput)
	}
	if len(value) > maxRelationshipAssertionValueBytes {
		return fmt.Errorf(
			"%w: assertion value exceeds %d bytes",
			ErrInvalidInput, maxRelationshipAssertionValueBytes,
		)
	}
	if allowed, ok := relationshipAssertionEnumValues[dimension]; ok {
		if _, valid := allowed[value]; !valid {
			return fmt.Errorf(
				"%w: invalid %s assertion value %q for schema version %d",
				ErrInvalidInput, dimension, value, schemaVersion,
			)
		}
		return nil
	}
	if _, ok := relationshipAssertionTextDimensions[dimension]; !ok {
		return fmt.Errorf("%w: unsupported assertion dimension %q", ErrInvalidInput, dimension)
	}
	return nil
}

// relationshipAssertionAuthorityRank is an ordinal authority ladder. The
// persisted value makes every winning decision explainable without coupling a
// reader to the current source-type switch.
func relationshipAssertionAuthorityRank(sourceType string) (int, bool) {
	switch sourceType {
	case "user_correction":
		return 5, true
	case "source_fact":
		return 4, true
	case "deterministic":
		return 3, true
	case "external_research":
		return 2, true
	case "ai_inference":
		return 1, true
	default:
		return 0, false
	}
}

// relationshipAssertionEligibleAt preserves historical replay semantics.
// Retraction, supersession, and expiry end an assertion at valid_to, but do not
// erase the fact that it was accepted before that boundary.
func relationshipAssertionEligibleAt(status string, validFrom time.Time, validTo *time.Time, evaluatedAt time.Time) (bool, bool) {
	if status == relationshipAssertionStatusProposed || status == relationshipAssertionStatusRejected {
		return false, true
	}
	if status != relationshipAssertionStatusAccepted && status != relationshipAssertionStatusLegacyActive &&
		status != relationshipAssertionStatusSuperseded &&
		status != relationshipAssertionStatusRetracted && status != relationshipAssertionStatusExpired {
		return false, false
	}
	if status != relationshipAssertionStatusAccepted && status != relationshipAssertionStatusLegacyActive && validTo == nil {
		return false, false
	}
	if validFrom.After(evaluatedAt) {
		return false, true
	}
	return validTo == nil || validTo.After(evaluatedAt), true
}
