package revenue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/conversationintelligenceartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/predicate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/google/uuid"
)

// ConversationPolicyLayer is one versioned rule at a policy-hierarchy scope.
type ConversationPolicyLayer struct {
	LayerID          string   `json:"layerId"`
	Scope            string   `json:"scope"`
	Enforced         bool     `json:"enforced"`
	Capture          string   `json:"capture"`
	ModelRoute       string   `json:"modelRoute"`
	PublishEvidence  bool     `json:"publishEvidence"`
	ExternalShare    bool     `json:"externalShare"`
	RetentionDays    int      `json:"retentionDays"`
	RedactionClasses []string `json:"redactionClasses"`
	LegalHold        bool     `json:"legalHold"`
}

// ResolvedConversationPolicy is the monotonic effective rule at an operation boundary.
type ResolvedConversationPolicy struct {
	Capture          string   `json:"capture"`
	ModelRoute       string   `json:"modelRoute"`
	PublishEvidence  bool     `json:"publishEvidence"`
	ExternalShare    bool     `json:"externalShare"`
	RetentionDays    int      `json:"retentionDays"`
	RedactionClasses []string `json:"redactionClasses"`
	LegalHold        bool     `json:"legalHold"`
	PolicyVersion    string   `json:"policyVersion"`
	SourceLayerIDs   []string `json:"sourceLayerIds"`
	ResolvedAt       string   `json:"resolvedAt"`
}

// ConversationGovernanceDecision records the policy evaluated at one checkpoint.
type ConversationGovernanceDecision struct {
	DecisionID       string   `json:"decisionId"`
	Checkpoint       string   `json:"checkpoint"`
	PolicyVersion    string   `json:"policyVersion"`
	Allowed          bool     `json:"allowed"`
	Route            string   `json:"route"`
	Reason           string   `json:"reason"`
	RedactionClasses []string `json:"redactionClasses"`
	DecidedAt        string   `json:"decidedAt"`
}

func defaultConversationPolicyLayer() ConversationPolicyLayer {
	return ConversationPolicyLayer{
		LayerID: "builtin:conversation-policy-v1", Scope: "organization", Enforced: true,
		Capture: "require_consent", ModelRoute: "hosted_allowed", PublishEvidence: true,
		ExternalShare: true, RetentionDays: 30,
		RedactionClasses: []string{"credentials", "financial", "health", "personal_identifier"},
	}
}

func validateConversationPolicyLayer(layer ConversationPolicyLayer) error {
	if strings.TrimSpace(layer.LayerID) == "" {
		return fmt.Errorf("%w: policy layer id is required", ErrInvalidInput)
	}
	if !map[string]bool{"organization": true, "workspace": true, "account": true, "user": true, "meeting": true}[layer.Scope] ||
		!map[string]bool{"deny": true, "require_consent": true, "allow": true}[layer.Capture] ||
		!map[string]bool{"local_only": true, "region_restricted": true, "hosted_allowed": true}[layer.ModelRoute] ||
		layer.RetentionDays < 0 {
		return fmt.Errorf("%w: invalid conversation policy layer", ErrInvalidInput)
	}
	allowedRedactions := map[string]bool{
		"credentials": true, "financial": true, "health": true,
		"personal_identifier": true, "workspace_term": true,
	}
	for _, class := range layer.RedactionClasses {
		if !allowedRedactions[class] {
			return fmt.Errorf("%w: invalid redaction class", ErrInvalidInput)
		}
	}
	return nil
}

func strictest(order []string, left, right string) string {
	index := func(value string) int {
		for i, candidate := range order {
			if candidate == value {
				return i
			}
		}
		return len(order)
	}
	if index(left) <= index(right) {
		return left
	}
	return right
}

func resolveConversationPolicyLayers(layers []ConversationPolicyLayer, now time.Time) ResolvedConversationPolicy {
	scopeOrder := map[string]int{"organization": 0, "workspace": 1, "account": 2, "user": 3, "meeting": 4}
	sort.SliceStable(layers, func(i, j int) bool { return scopeOrder[layers[i].Scope] < scopeOrder[layers[j].Scope] })
	first := layers[0]
	resolved := ResolvedConversationPolicy{
		Capture: first.Capture, ModelRoute: first.ModelRoute,
		PublishEvidence: first.PublishEvidence, ExternalShare: first.ExternalShare,
		RetentionDays: first.RetentionDays, RedactionClasses: append([]string(nil), first.RedactionClasses...),
		LegalHold: first.LegalHold, SourceLayerIDs: []string{first.LayerID},
		ResolvedAt: now.UTC().Format(time.RFC3339),
	}
	redactions := map[string]bool{}
	for _, class := range resolved.RedactionClasses {
		redactions[class] = true
	}
	for _, layer := range layers[1:] {
		resolved.Capture = strictest([]string{"deny", "require_consent", "allow"}, resolved.Capture, layer.Capture)
		resolved.ModelRoute = strictest([]string{"local_only", "region_restricted", "hosted_allowed"}, resolved.ModelRoute, layer.ModelRoute)
		resolved.PublishEvidence = resolved.PublishEvidence && layer.PublishEvidence
		resolved.ExternalShare = resolved.ExternalShare && layer.ExternalShare
		if layer.RetentionDays < resolved.RetentionDays {
			resolved.RetentionDays = layer.RetentionDays
		}
		resolved.LegalHold = resolved.LegalHold || layer.LegalHold
		resolved.SourceLayerIDs = append(resolved.SourceLayerIDs, layer.LayerID)
		for _, class := range layer.RedactionClasses {
			redactions[class] = true
		}
	}
	resolved.RedactionClasses = resolved.RedactionClasses[:0]
	for class := range redactions {
		resolved.RedactionClasses = append(resolved.RedactionClasses, class)
	}
	sort.Strings(resolved.RedactionClasses)
	payload, _ := json.Marshal(layers)
	sum := sha256.Sum256(payload)
	resolved.PolicyVersion = "policy:" + hex.EncodeToString(sum[:12])
	return resolved
}

func (s *Service) conversationPolicyLayersFor(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	rel *ent.Relationship,
) ([]ConversationPolicyLayer, error) {
	predicates := []predicate.ConversationIntelligenceArtifact{
		conversationintelligenceartifact.KindEQ("conversation_policy"),
		conversationintelligenceartifact.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
	}
	rows, err := client.ConversationIntelligenceArtifact.Query().Where(predicates...).Order(
		ent.Desc(conversationintelligenceartifact.FieldVersion),
	).All(ctx)
	if err != nil {
		return nil, err
	}
	latest := map[string]ConversationPolicyLayer{}
	for _, row := range rows {
		if _, exists := latest[row.StableID]; exists {
			continue
		}
		if relationshipEdge, edgeErr := row.QueryRelationship().Only(ctx); edgeErr == nil {
			if rel == nil || relationshipEdge.ID != rel.ID {
				continue
			}
		} else if !ent.IsNotFound(edgeErr) {
			return nil, edgeErr
		}
		var layer ConversationPolicyLayer
		if err := json.Unmarshal([]byte(row.PayloadJSON), &layer); err != nil {
			return nil, err
		}
		latest[row.StableID] = layer
	}
	layers := []ConversationPolicyLayer{defaultConversationPolicyLayer()}
	for _, layer := range latest {
		layers = append(layers, layer)
	}
	return layers, nil
}

// ResolveConversationPolicy returns the strictest applicable conversation policy.
func (s *Service) ResolveConversationPolicy(
	ctx context.Context,
	u *ent.User,
	rel *ent.Relationship,
) (ResolvedConversationPolicy, error) {
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return ResolvedConversationPolicy{}, err
	}
	layers, err := s.conversationPolicyLayersFor(ctx, s.client, ws, rel)
	if err != nil {
		return ResolvedConversationPolicy{}, err
	}
	return resolveConversationPolicyLayers(layers, s.now()), nil
}

func enforceConversationObservationPolicy(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	_ *ent.User,
	rel *ent.Relationship,
	input *RelationshipObservationInput,
	now time.Time,
) error {
	service := &Service{client: client, now: func() time.Time { return now }}
	layers, err := service.conversationPolicyLayersFor(ctx, client, ws, rel)
	if err != nil {
		return err
	}
	policy := resolveConversationPolicyLayers(layers, now)
	route := "device"
	if extraction, ok := input.Facts["conversation_extraction"].(map[string]any); ok {
		if provenance, ok := extraction["provenance"].(map[string]any); ok {
			if routing, ok := provenance["routing"].(string); ok && routing == "cloud" {
				route = "cloud"
			}
		}
	}
	decision := evaluateGovernanceDecision(policy, "evidence_publication", route, input.ExternalID, now)
	input.Facts["conversation_governance_decision"] = decision
	if !decision.Allowed {
		return fmt.Errorf("%w: %s", ErrInvalidInput, decision.Reason)
	}
	return nil
}

// SaveConversationPolicyLayers transactionally appends validated policy versions.
func (s *Service) SaveConversationPolicyLayers(
	ctx context.Context,
	u *ent.User,
	relationshipID uuid.UUID,
	layers []ConversationPolicyLayer,
) (ResolvedConversationPolicy, error) {
	if len(layers) == 0 {
		return ResolvedConversationPolicy{}, fmt.Errorf("%w: policy layers are required", ErrInvalidInput)
	}
	seenLayerIDs := make(map[string]bool, len(layers))
	for _, layer := range layers {
		if err := validateConversationPolicyLayer(layer); err != nil {
			return ResolvedConversationPolicy{}, err
		}
		if seenLayerIDs[layer.LayerID] {
			return ResolvedConversationPolicy{}, fmt.Errorf("%w: duplicate policy layer id", ErrInvalidInput)
		}
		seenLayerIDs[layer.LayerID] = true
	}
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return ResolvedConversationPolicy{}, err
	}
	rel, err := s.GetRelationship(ctx, relationshipID)
	if err != nil {
		return ResolvedConversationPolicy{}, err
	}
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return ResolvedConversationPolicy{}, err
	}
	defer func() { _ = tx.Rollback() }()
	txc := tx.Client()
	txws, err := txc.RevenueWorkspace.Get(ctx, ws.ID)
	if err != nil {
		return ResolvedConversationPolicy{}, err
	}
	txu, err := txc.User.Get(ctx, u.ID)
	if err != nil {
		return ResolvedConversationPolicy{}, err
	}
	txrel, err := txc.Relationship.Get(ctx, rel.ID)
	if err != nil {
		return ResolvedConversationPolicy{}, err
	}
	for _, layer := range layers {
		latest, queryErr := txc.ConversationIntelligenceArtifact.Query().Where(
			conversationintelligenceartifact.KindEQ("conversation_policy"),
			conversationintelligenceartifact.StableIDEQ(layer.LayerID),
			conversationintelligenceartifact.HasWorkspaceWith(revenueworkspace.IDEQ(txws.ID)),
		).Order(ent.Desc(conversationintelligenceartifact.FieldVersion)).First(ctx)
		version := 1
		if queryErr == nil {
			version = latest.Version + 1
		} else if !ent.IsNotFound(queryErr) {
			return ResolvedConversationPolicy{}, queryErr
		}
		targetRel := txrel
		if layer.Scope == "organization" || layer.Scope == "workspace" || layer.Scope == "user" {
			targetRel = nil
		}
		if _, err := appendConversationArtifact(ctx, txc, txws, txu, targetRel, conversationArtifactInput{
			Kind: "conversation_policy", StableID: layer.LayerID, Version: version,
			Status: "active", SubjectRef: relationshipID.String(), EffectiveAt: s.now(),
			Payload: layer,
		}); err != nil {
			return ResolvedConversationPolicy{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return ResolvedConversationPolicy{}, err
	}
	return s.ResolveConversationPolicy(ctx, u, rel)
}

func evaluateGovernanceDecision(
	policy ResolvedConversationPolicy,
	checkpoint, route, correlationID string,
	now time.Time,
) ConversationGovernanceDecision {
	allowed, reason := true, "effective policy permits this operation"
	switch {
	case route == "cloud" && policy.ModelRoute == "local_only" &&
		(checkpoint == "transcription" || checkpoint == "semantic_enrichment" || checkpoint == "evidence_publication"):
		allowed, route, reason = false, "none", "local-only policy prohibits a cloud route"
	case checkpoint == "evidence_publication" && !policy.PublishEvidence:
		allowed, reason = false, "shared evidence publication is disabled"
	case checkpoint == "external_share" && !policy.ExternalShare:
		allowed, reason = false, "external sharing is disabled"
	case checkpoint == "retention_deletion" && policy.LegalHold:
		allowed, reason = false, "legal hold blocks deletion"
	}
	sum := sha256.Sum256([]byte(policy.PolicyVersion + ":" + checkpoint + ":" + correlationID))
	return ConversationGovernanceDecision{
		DecisionID: "governance:" + hex.EncodeToString(sum[:12]), Checkpoint: checkpoint,
		PolicyVersion: policy.PolicyVersion, Allowed: allowed, Route: route, Reason: reason,
		RedactionClasses: policy.RedactionClasses, DecidedAt: now.UTC().Format(time.RFC3339),
	}
}

func redactConversationText(text string, classes []string) string {
	enabled := map[string]bool{}
	for _, class := range classes {
		enabled[class] = true
	}
	rules := []struct {
		class       string
		pattern     *regexp.Regexp
		replacement string
	}{
		{"credentials", regexp.MustCompile(`(?i)\b(?:api[_ -]?key|password|secret|token)\s*[:=]\s*[^\s,;"']+`), "[REDACTED_CREDENTIAL]"},
		{"financial", regexp.MustCompile(`\b(?:\d[ -]*?){13,19}\b`), "[REDACTED_FINANCIAL]"},
		{"personal_identifier", regexp.MustCompile(`(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b`), "[REDACTED_IDENTIFIER]"},
		{"health", regexp.MustCompile(`(?i)\b(?:diagnosis|patient|medical record|prescription)\b[^.!?]*`), "[REDACTED_HEALTH]"},
	}
	for _, rule := range rules {
		if enabled[rule.class] {
			text = rule.pattern.ReplaceAllString(text, rule.replacement)
		}
	}
	return text
}

func governanceDecisionsFor(
	ctx context.Context,
	client *ent.Client,
	rel *ent.Relationship,
) ([]ConversationGovernanceDecision, error) {
	rows, err := latestConversationArtifacts(ctx, client, rel.ID.String(), "governance_decision")
	if err != nil {
		return nil, err
	}
	result := make([]ConversationGovernanceDecision, 0, len(rows))
	for _, row := range rows {
		var decision ConversationGovernanceDecision
		if err := json.Unmarshal([]byte(row.PayloadJSON), &decision); err != nil {
			return nil, err
		}
		result = append(result, decision)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].DecidedAt > result[j].DecidedAt })
	return result, nil
}
