package revenue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationattachment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationinteraction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationprivacypolicy"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationprivacyrule"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationsharegrant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipassertion"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueevidence"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspacemember"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

const workspaceCommunicationDefaultsAccount = "__workspace_defaults__"

// CommunicationAccess describes the independently authorized communication
// fields. Keeping fields separate prevents a metadata grant from accidentally
// becoming permission to retrieve provider content.
type CommunicationAccess struct {
	Metadata      bool   `json:"metadata"`
	Subject       bool   `json:"subject"`
	Body          bool   `json:"body"`
	Attachments   bool   `json:"attachments"`
	Protected     bool   `json:"protected"`
	Reason        string `json:"reason"`
	PolicyVersion int    `json:"policyVersion"`
}

// CommunicationResource identifies every bounded scope which may grant access.
// Callers must supply only IDs already resolved inside the same workspace.
type CommunicationResource struct {
	MessageID      string
	ThreadID       string
	RelationshipID string
}

// CommunicationPolicyInput is the owner-controlled default for one mailbox.
type CommunicationPolicyInput struct {
	MetadataVisibility     string `json:"metadataVisibility"`
	ShareSubject           bool   `json:"shareSubject"`
	ShareBody              bool   `json:"shareBody"`
	ShareAttachments       bool   `json:"shareAttachments"`
	SignatureEnrichment    bool   `json:"signatureEnrichment"`
	ModelContactExtraction bool   `json:"modelContactExtraction"`
	RetentionDays          int    `json:"retentionDays"`
}

// CommunicationRuleInput is an owner-controlled protected or private match.
type CommunicationRuleInput struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

// CommunicationGrantInput is one explicit, revocable content grant.
type CommunicationGrantInput struct {
	Scope        string     `json:"scope"`
	ResourceType string     `json:"resourceType"`
	ResourceID   string     `json:"resourceId"`
	GranteeID    *uuid.UUID `json:"granteeId,omitempty"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
	Reason       string     `json:"reason,omitempty"`
}

// CommunicationPurgeResult reports the durable records retracted by a purge.
type CommunicationPurgeResult struct {
	InteractionID uuid.UUID `json:"interactionId"`
	Observations  int       `json:"observations"`
	Assertions    int       `json:"assertions"`
	Evidence      int       `json:"evidence"`
	Attachments   int       `json:"attachments"`
}

type communicationPolicyState struct {
	metadataVisibility string
	shareSubject       bool
	shareBody          bool
	shareAttachments   bool
	version            int
}

func defaultCommunicationPolicy() communicationPolicyState {
	return communicationPolicyState{
		metadataVisibility: "workspace",
		shareSubject:       true,
		shareBody:          false,
		shareAttachments:   false,
		version:            1,
	}
}

func policyState(row *ent.CommunicationPrivacyPolicy) communicationPolicyState {
	return communicationPolicyState{
		metadataVisibility: row.MetadataVisibility,
		shareSubject:       row.ShareSubject,
		shareBody:          row.ShareBody,
		shareAttachments:   row.ShareAttachments,
		version:            row.Version,
	}
}

func normalizePrivacyValue(kind, value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "", fmt.Errorf("%w: privacy rule value is required", ErrInvalidInput)
	}
	switch kind {
	case "blocked_address", "protected_address":
		if !strings.Contains(value, "@") {
			return "", fmt.Errorf("%w: address rule requires an email address", ErrInvalidInput)
		}
	case "blocked_domain", "protected_domain":
		value = strings.TrimPrefix(value, "@")
		if value == "" || strings.Contains(value, "@") {
			return "", fmt.Errorf("%w: domain rule requires a domain", ErrInvalidInput)
		}
	default:
		return "", fmt.Errorf("%w: unsupported privacy rule kind", ErrInvalidInput)
	}
	return value, nil
}

func privacyValueHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func addressDomain(address string) string {
	address = strings.ToLower(strings.TrimSpace(address))
	if at := strings.LastIndexByte(address, '@'); at >= 0 {
		return address[at+1:]
	}
	return ""
}

func ruleMatches(rule *ent.CommunicationPrivacyRule, participants []string) bool {
	for _, address := range participants {
		address = strings.ToLower(strings.TrimSpace(address))
		switch rule.Kind {
		case "blocked_address", "protected_address":
			if address == rule.Value {
				return true
			}
		case "blocked_domain", "protected_domain":
			if addressDomain(address) == rule.Value {
				return true
			}
		}
	}
	return false
}

func grantMatches(grant *ent.CommunicationShareGrant, resource CommunicationResource) bool {
	switch grant.ResourceType {
	case "message":
		return resource.MessageID != "" && grant.ResourceID == resource.MessageID
	case "thread":
		return resource.ThreadID != "" && grant.ResourceID == resource.ThreadID
	case "relationship":
		return resource.RelationshipID != "" && grant.ResourceID == resource.RelationshipID
	default:
		return false
	}
}

// CommunicationAuthorization centralizes policy evaluation and privacy
// mutations. It deliberately uses internal reads only after callers and exact
// workspaces have been authorized, avoiding policy records being hidden by the
// same field-level restrictions they are used to enforce.
type CommunicationAuthorization struct {
	client *ent.Client
	now    func() time.Time
}

// NewCommunicationAuthorization creates the single server-side communication
// policy authority used by ingestion, projection, read, export, and agents.
func NewCommunicationAuthorization(client *ent.Client) *CommunicationAuthorization {
	return &CommunicationAuthorization{client: client, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) communicationAuthorization() *CommunicationAuthorization {
	return &CommunicationAuthorization{client: s.client, now: s.now}
}

func (a *CommunicationAuthorization) ownerWorkspace(
	ctx context.Context,
	workspaceID, ownerID uuid.UUID,
) (*ent.RevenueWorkspace, *ent.User, error) {
	internal := auth.WithInternalOnly(ctx)
	ws, err := a.client.RevenueWorkspace.Get(internal, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	owner, err := a.client.User.Get(internal, ownerID)
	if err != nil {
		return nil, nil, err
	}
	inside, err := ws.QueryMembers().
		Where(
			revenueworkspacemember.HasUserWith(user.IDEQ(ownerID)),
			revenueworkspacemember.StatusEQ("active"),
		).
		Exist(internal)
	if err != nil {
		return nil, nil, err
	}
	if !inside {
		founder, founderErr := ws.QueryUser().Where(user.IDEQ(ownerID)).Exist(internal)
		if founderErr != nil {
			return nil, nil, founderErr
		}
		if !founder {
			return nil, nil, ErrNotFound
		}
	}
	return ws, owner, nil
}

// Evaluate applies the immutable precedence chain: protected rule, owner
// private rule, active explicit grant, then owner default. Owners retain access
// to their own mailbox so they can manage and delete protected material.
func (a *CommunicationAuthorization) Evaluate(
	ctx context.Context,
	workspaceID, ownerID, actorID uuid.UUID,
	sourceAccountID string,
	participants []string,
	resource CommunicationResource,
) (CommunicationAccess, error) {
	if workspaceID == uuid.Nil || ownerID == uuid.Nil || actorID == uuid.Nil {
		return CommunicationAccess{Reason: "missing_identity"}, ErrForbidden
	}
	if _, _, err := a.ownerWorkspace(ctx, workspaceID, ownerID); err != nil {
		return CommunicationAccess{Reason: "owner_outside_workspace"}, err
	}
	internal := auth.WithInternalOnly(ctx)
	actorInside, err := a.client.RevenueWorkspaceMember.Query().
		Where(
			revenueworkspacemember.HasWorkspaceWith(revenueworkspace.IDEQ(workspaceID)),
			revenueworkspacemember.HasUserWith(user.IDEQ(actorID)),
			revenueworkspacemember.StatusEQ("active"),
		).Exist(internal)
	if err != nil {
		return CommunicationAccess{Reason: "membership_unavailable"}, err
	}
	if !actorInside && actorID != ownerID {
		return CommunicationAccess{Reason: "cross_tenant"}, ErrForbidden
	}

	policy := defaultCommunicationPolicy()
	// Workspace defaults are intentionally metadata-only. They provide an
	// administrative baseline without granting an admin power to expose bodies
	// or attachments from another user's mailbox.
	if row, policyErr := a.client.CommunicationPrivacyPolicy.Query().Where(
		communicationprivacypolicy.SourceAccountIDEQ(workspaceCommunicationDefaultsAccount),
		communicationprivacypolicy.HasWorkspaceWith(revenueworkspace.IDEQ(workspaceID)),
	).Order(ent.Desc(communicationprivacypolicy.FieldUpdatedAt)).First(internal); policyErr == nil {
		policy = policyState(row)
		policy.shareBody = false
		policy.shareAttachments = false
	} else if !ent.IsNotFound(policyErr) {
		return CommunicationAccess{Reason: "workspace_policy_unavailable"}, policyErr
	}
	if row, policyErr := a.client.CommunicationPrivacyPolicy.Query().Where(
		communicationprivacypolicy.SourceAccountIDEQ(strings.ToLower(strings.TrimSpace(sourceAccountID))),
		communicationprivacypolicy.HasWorkspaceWith(revenueworkspace.IDEQ(workspaceID)),
		communicationprivacypolicy.HasOwnerWith(user.IDEQ(ownerID)),
	).Only(internal); policyErr == nil {
		policy = policyState(row)
	} else if !ent.IsNotFound(policyErr) {
		return CommunicationAccess{Reason: "policy_unavailable"}, policyErr
	}

	rules, err := a.client.CommunicationPrivacyRule.Query().Where(
		communicationprivacyrule.ActiveEQ(true),
		communicationprivacyrule.HasWorkspaceWith(revenueworkspace.IDEQ(workspaceID)),
		communicationprivacyrule.HasOwnerWith(user.IDEQ(ownerID)),
	).All(internal)
	if err != nil {
		return CommunicationAccess{Reason: "rules_unavailable"}, err
	}
	protected, blocked := false, false
	for _, rule := range rules {
		if !ruleMatches(rule, participants) {
			continue
		}
		if strings.HasPrefix(rule.Kind, "protected_") {
			protected = true
		} else {
			blocked = true
		}
	}
	if actorID == ownerID {
		return CommunicationAccess{
			Metadata: true, Subject: true, Body: true, Attachments: true,
			Protected: protected, Reason: "mailbox_owner", PolicyVersion: policy.version,
		}, nil
	}
	if protected {
		return CommunicationAccess{Protected: true, Reason: "protected_recipient", PolicyVersion: policy.version}, nil
	}
	if blocked || policy.metadataVisibility == "private" {
		return CommunicationAccess{Reason: "owner_private", PolicyVersion: policy.version}, nil
	}

	decision := CommunicationAccess{
		Metadata: true, Subject: policy.shareSubject, Body: policy.shareBody,
		Attachments: policy.shareAttachments, Reason: "owner_default", PolicyVersion: policy.version,
	}
	grants, err := a.client.CommunicationShareGrant.Query().Where(
		communicationsharegrant.HasWorkspaceWith(revenueworkspace.IDEQ(workspaceID)),
		communicationsharegrant.HasOwnerWith(user.IDEQ(ownerID)),
		communicationsharegrant.Or(
			communicationsharegrant.HasGranteeWith(user.IDEQ(actorID)),
			communicationsharegrant.Not(communicationsharegrant.HasGrantee()),
		),
		communicationsharegrant.RevokedAtIsNil(),
	).All(internal)
	if err != nil {
		return CommunicationAccess{Reason: "grants_unavailable"}, err
	}
	now := a.now().UTC()
	for _, grant := range grants {
		if grant.ExpiresAt != nil && !grant.ExpiresAt.After(now) {
			continue
		}
		if !grantMatches(grant, resource) {
			continue
		}
		switch grant.Scope {
		case "body":
			decision.Body = true
		case "attachments":
			decision.Attachments = true
		case "full":
			decision.Body, decision.Attachments = true, true
		}
		decision.Reason = "explicit_grant"
	}
	return decision, nil
}

// ProjectionVisibility evaluates ingestion without granting a teammate access.
// Protected/private messages are retained only as owner-private projections.
func (a *CommunicationAuthorization) ProjectionVisibility(
	ctx context.Context,
	workspaceID, ownerID uuid.UUID,
	sourceAccountID string,
	participants []string,
) (visibility string, shareSubject bool, err error) {
	decision, err := a.Evaluate(
		ctx, workspaceID, ownerID, ownerID, sourceAccountID, participants, CommunicationResource{},
	)
	if err != nil {
		return "private", false, err
	}
	// Re-evaluate protection for sharing by using an authenticated sentinel
	// workspace member when possible; direct owner access is intentionally full.
	internal := auth.WithInternalOnly(ctx)
	rules, err := a.client.CommunicationPrivacyRule.Query().Where(
		communicationprivacyrule.ActiveEQ(true),
		communicationprivacyrule.HasWorkspaceWith(revenueworkspace.IDEQ(workspaceID)),
		communicationprivacyrule.HasOwnerWith(user.IDEQ(ownerID)),
	).All(internal)
	if err != nil {
		return "private", false, err
	}
	for _, rule := range rules {
		if ruleMatches(rule, participants) {
			return "private", false, nil
		}
	}
	policy := defaultCommunicationPolicy()
	if workspaceRow, workspaceErr := a.client.CommunicationPrivacyPolicy.Query().Where(
		communicationprivacypolicy.SourceAccountIDEQ(workspaceCommunicationDefaultsAccount),
		communicationprivacypolicy.HasWorkspaceWith(revenueworkspace.IDEQ(workspaceID)),
	).Order(ent.Desc(communicationprivacypolicy.FieldUpdatedAt)).First(internal); workspaceErr == nil {
		policy = policyState(workspaceRow)
		policy.shareBody = false
		policy.shareAttachments = false
	} else if !ent.IsNotFound(workspaceErr) {
		return "private", false, workspaceErr
	}
	row, policyErr := a.client.CommunicationPrivacyPolicy.Query().Where(
		communicationprivacypolicy.SourceAccountIDEQ(strings.ToLower(strings.TrimSpace(sourceAccountID))),
		communicationprivacypolicy.HasWorkspaceWith(revenueworkspace.IDEQ(workspaceID)),
		communicationprivacypolicy.HasOwnerWith(user.IDEQ(ownerID)),
	).Only(internal)
	if policyErr == nil {
		policy = policyState(row)
	} else if !ent.IsNotFound(policyErr) {
		return "private", false, policyErr
	}
	if policy.metadataVisibility == "private" {
		return "private", false, nil
	}
	return "metadata", decision.Subject && policy.shareSubject, nil
}

// UpsertCommunicationPolicy changes only the caller's mailbox policy.
func (s *Service) UpsertCommunicationPolicy(
	ctx context.Context,
	actor *ent.User,
	sourceAccountID string,
	in CommunicationPolicyInput,
) (*ent.CommunicationPrivacyPolicy, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, actor, WorkspaceManagePrivacy)
	if err != nil {
		return nil, err
	}
	sourceAccountID = strings.ToLower(strings.TrimSpace(sourceAccountID))
	if sourceAccountID == "" || in.RetentionDays <= 0 ||
		(in.MetadataVisibility != "private" && in.MetadataVisibility != "workspace") {
		return nil, fmt.Errorf("%w: invalid communication policy", ErrInvalidInput)
	}
	internal := auth.WithInternalOnly(ctx)
	existing, err := s.client.CommunicationPrivacyPolicy.Query().Where(
		communicationprivacypolicy.SourceAccountIDEQ(sourceAccountID),
		communicationprivacypolicy.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		communicationprivacypolicy.HasOwnerWith(user.IDEQ(actor.ID)),
	).Only(internal)
	if err == nil {
		return existing.Update().
			SetMetadataVisibility(in.MetadataVisibility).
			SetShareSubject(in.ShareSubject).
			SetShareBody(in.ShareBody).
			SetShareAttachments(in.ShareAttachments).
			SetSignatureEnrichment(in.SignatureEnrichment).
			SetModelContactExtraction(in.ModelContactExtraction).
			SetRetentionDays(in.RetentionDays).
			SetVersion(existing.Version + 1).
			Save(internal)
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	return s.client.CommunicationPrivacyPolicy.Create().
		SetWorkspace(ws).SetOwner(actor).SetSourceAccountID(sourceAccountID).
		SetMetadataVisibility(in.MetadataVisibility).
		SetShareSubject(in.ShareSubject).
		SetShareBody(in.ShareBody).
		SetShareAttachments(in.ShareAttachments).
		SetSignatureEnrichment(in.SignatureEnrichment).
		SetModelContactExtraction(in.ModelContactExtraction).
		SetRetentionDays(in.RetentionDays).
		Save(internal)
}

// CommunicationPolicy returns only the caller-owned mailbox policy.
func (s *Service) CommunicationPolicy(
	ctx context.Context,
	actor *ent.User,
	sourceAccountID string,
) (*ent.CommunicationPrivacyPolicy, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, actor, WorkspaceManagePrivacy)
	if err != nil {
		return nil, err
	}
	row, err := s.client.CommunicationPrivacyPolicy.Query().Where(
		communicationprivacypolicy.SourceAccountIDEQ(strings.ToLower(strings.TrimSpace(sourceAccountID))),
		communicationprivacypolicy.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		communicationprivacypolicy.HasOwnerWith(user.IDEQ(actor.ID)),
	).Only(auth.WithInternalOnly(ctx))
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return row, err
}

// DeleteCommunicationPolicy removes only a caller-owned mailbox override. The
// fail-closed built-in metadata/body defaults immediately become effective.
func (s *Service) DeleteCommunicationPolicy(ctx context.Context, actor *ent.User, sourceAccountID string) error {
	row, err := s.CommunicationPolicy(ctx, actor, sourceAccountID)
	if err != nil {
		return err
	}
	return s.client.CommunicationPrivacyPolicy.DeleteOne(row).Exec(auth.WithInternalOnly(ctx))
}

// SetWorkspaceCommunicationDefaults lets owners/admins choose the metadata
// baseline for mailboxes without an owner policy. Body and attachment sharing
// are rejected because workspace administration is not mailbox ownership.
func (s *Service) SetWorkspaceCommunicationDefaults(
	ctx context.Context,
	actor *ent.User,
	in CommunicationPolicyInput,
) (*ent.CommunicationPrivacyPolicy, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, actor, WorkspaceManagePrivacy)
	if err != nil {
		return nil, err
	}
	if in.ShareBody || in.ShareAttachments {
		return nil, fmt.Errorf("%w: workspace defaults cannot expose communication content", ErrForbidden)
	}
	in.ShareBody = false
	in.ShareAttachments = false
	return s.upsertWorkspaceCommunicationDefaults(auth.WithInternalOnly(ctx), ws, actor, in)
}

func (s *Service) upsertWorkspaceCommunicationDefaults(
	ctx context.Context,
	ws *ent.RevenueWorkspace,
	actor *ent.User,
	in CommunicationPolicyInput,
) (*ent.CommunicationPrivacyPolicy, error) {
	if in.RetentionDays <= 0 ||
		(in.MetadataVisibility != "private" && in.MetadataVisibility != "workspace") {
		return nil, fmt.Errorf("%w: invalid workspace communication defaults", ErrInvalidInput)
	}
	existing, err := s.client.CommunicationPrivacyPolicy.Query().Where(
		communicationprivacypolicy.SourceAccountIDEQ(workspaceCommunicationDefaultsAccount),
		communicationprivacypolicy.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		communicationprivacypolicy.HasOwnerWith(user.IDEQ(actor.ID)),
	).Only(ctx)
	if err == nil {
		return existing.Update().
			SetMetadataVisibility(in.MetadataVisibility).
			SetShareSubject(in.ShareSubject).
			SetShareBody(false).SetShareAttachments(false).
			SetSignatureEnrichment(in.SignatureEnrichment).
			SetModelContactExtraction(in.ModelContactExtraction).
			SetRetentionDays(in.RetentionDays).SetVersion(existing.Version + 1).
			Save(ctx)
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	return s.client.CommunicationPrivacyPolicy.Create().
		SetWorkspace(ws).SetOwner(actor).
		SetSourceAccountID(workspaceCommunicationDefaultsAccount).
		SetMetadataVisibility(in.MetadataVisibility).
		SetShareSubject(in.ShareSubject).SetShareBody(false).SetShareAttachments(false).
		SetSignatureEnrichment(in.SignatureEnrichment).
		SetModelContactExtraction(in.ModelContactExtraction).
		SetRetentionDays(in.RetentionDays).Save(ctx)
}

// CreateCommunicationPrivacyRule creates an owner-only protected/private rule.
func (s *Service) CreateCommunicationPrivacyRule(
	ctx context.Context,
	actor *ent.User,
	in CommunicationRuleInput,
) (*ent.CommunicationPrivacyRule, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, actor, WorkspaceManagePrivacy)
	if err != nil {
		return nil, err
	}
	value, err := normalizePrivacyValue(in.Kind, in.Value)
	if err != nil {
		return nil, err
	}
	internal := auth.WithInternalOnly(ctx)
	return s.client.CommunicationPrivacyRule.Create().
		SetWorkspace(ws).SetOwner(actor).SetKind(in.Kind).SetValue(value).
		SetValueHash(privacyValueHash(value)).SetActive(true).Save(internal)
}

// CommunicationPrivacyRules lists only the caller-owned normalized rules.
func (s *Service) CommunicationPrivacyRules(
	ctx context.Context,
	actor *ent.User,
) ([]*ent.CommunicationPrivacyRule, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, actor, WorkspaceManagePrivacy)
	if err != nil {
		return nil, err
	}
	return s.client.CommunicationPrivacyRule.Query().Where(
		communicationprivacyrule.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		communicationprivacyrule.HasOwnerWith(user.IDEQ(actor.ID)),
	).Order(ent.Asc(communicationprivacyrule.FieldKind), ent.Asc(communicationprivacyrule.FieldValueHash)).
		All(auth.WithInternalOnly(ctx))
}

// SetCommunicationPrivacyRuleActive updates only a rule owned by the caller.
func (s *Service) SetCommunicationPrivacyRuleActive(
	ctx context.Context,
	actor *ent.User,
	ruleID uuid.UUID,
	active bool,
) (*ent.CommunicationPrivacyRule, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, actor, WorkspaceManagePrivacy)
	if err != nil {
		return nil, err
	}
	internal := auth.WithInternalOnly(ctx)
	rule, err := s.client.CommunicationPrivacyRule.Query().Where(
		communicationprivacyrule.IDEQ(ruleID),
		communicationprivacyrule.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		communicationprivacyrule.HasOwnerWith(user.IDEQ(actor.ID)),
	).Only(internal)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return rule.Update().SetActive(active).Save(internal)
}

// DeleteCommunicationPrivacyRule removes only a caller-owned rule.
func (s *Service) DeleteCommunicationPrivacyRule(ctx context.Context, actor *ent.User, ruleID uuid.UUID) error {
	rule, err := s.SetCommunicationPrivacyRuleActive(ctx, actor, ruleID, false)
	if err != nil {
		return err
	}
	return s.client.CommunicationPrivacyRule.DeleteOne(rule).Exec(auth.WithInternalOnly(ctx))
}

// GrantCommunicationAccess creates or replaces a bounded grant. Workspace
// roles never substitute for mailbox ownership.
func (s *Service) GrantCommunicationAccess(
	ctx context.Context,
	actor *ent.User,
	in CommunicationGrantInput,
) (*ent.CommunicationShareGrant, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, actor, WorkspaceShareCommunications)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.ResourceID) == "" ||
		(in.Scope != "body" && in.Scope != "attachments" && in.Scope != "full") ||
		(in.ResourceType != "message" && in.ResourceType != "thread" && in.ResourceType != "relationship") {
		return nil, fmt.Errorf("%w: invalid communication grant", ErrInvalidInput)
	}
	if in.ExpiresAt != nil && !in.ExpiresAt.After(s.now()) {
		return nil, fmt.Errorf("%w: grant expiry must be in the future", ErrInvalidInput)
	}
	internal := auth.WithInternalOnly(ctx)
	create := s.client.CommunicationShareGrant.Create().
		SetWorkspace(ws).SetOwner(actor).SetScope(in.Scope).
		SetResourceType(in.ResourceType).SetResourceID(strings.TrimSpace(in.ResourceID)).
		SetNillableExpiresAt(in.ExpiresAt).SetReason(strings.TrimSpace(in.Reason))
	if in.GranteeID != nil {
		grantee, getErr := s.client.User.Get(internal, *in.GranteeID)
		if getErr != nil {
			return nil, ErrNotFound
		}
		member, memberErr := s.client.RevenueWorkspaceMember.Query().Where(
			revenueworkspacemember.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			revenueworkspacemember.HasUserWith(user.IDEQ(grantee.ID)),
			revenueworkspacemember.StatusEQ("active"),
		).Exist(internal)
		if memberErr != nil {
			return nil, memberErr
		}
		if !member {
			return nil, ErrForbidden
		}
		create.SetGrantee(grantee)
	}
	grant, err := create.Save(internal)
	if ent.IsConstraintError(err) {
		return nil, fmt.Errorf("%w: equivalent grant already exists", ErrReviewRequired)
	}
	return grant, err
}

// RevokeCommunicationAccess records revocation instead of deleting its audit row.
func (s *Service) RevokeCommunicationAccess(
	ctx context.Context,
	actor *ent.User,
	grantID uuid.UUID,
) (*ent.CommunicationShareGrant, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, actor, WorkspaceShareCommunications)
	if err != nil {
		return nil, err
	}
	internal := auth.WithInternalOnly(ctx)
	grant, err := s.client.CommunicationShareGrant.Query().Where(
		communicationsharegrant.IDEQ(grantID),
		communicationsharegrant.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		communicationsharegrant.HasOwnerWith(user.IDEQ(actor.ID)),
	).Only(internal)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if grant.RevokedAt != nil {
		return grant, nil
	}
	return grant.Update().SetRevokedAt(s.now().UTC()).Save(internal)
}

// PurgeCommunication retracts a mailbox owner's provider record, cached
// content, and directly derived evidence in one transaction. The interaction
// tombstone and content-free trust event preserve lineage without retaining
// the deleted material.
func (s *Service) PurgeCommunication(
	ctx context.Context,
	actor *ent.User,
	interactionID uuid.UUID,
) (CommunicationPurgeResult, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, actor, WorkspaceShareCommunications)
	if err != nil {
		return CommunicationPurgeResult{}, err
	}
	internal := auth.WithInternalOnly(ctx)
	interaction, err := s.client.CommunicationInteraction.Query().Where(
		communicationinteraction.IDEQ(interactionID),
		communicationinteraction.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		communicationinteraction.HasOwnerWith(user.IDEQ(actor.ID)),
	).Only(internal)
	if ent.IsNotFound(err) {
		return CommunicationPurgeResult{}, ErrNotFound
	}
	if err != nil {
		return CommunicationPurgeResult{}, err
	}
	tx, err := s.client.Tx(internal)
	if err != nil {
		return CommunicationPurgeResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	txc := tx.Client()
	result := CommunicationPurgeResult{InteractionID: interaction.ID}

	attachments, err := txc.CommunicationAttachment.Query().Where(
		communicationattachment.HasInteractionWith(communicationinteraction.IDEQ(interaction.ID)),
	).All(internal)
	if err != nil {
		return CommunicationPurgeResult{}, err
	}
	result.Attachments = len(attachments)
	if _, err = txc.CommunicationAttachment.Update().Where(
		communicationattachment.HasInteractionWith(communicationinteraction.IDEQ(interaction.ID)),
	).ClearSealedContent().ClearSealedExtractedText().SetVisibility("private").Save(internal); err != nil {
		return CommunicationPurgeResult{}, err
	}

	observations, err := txc.RelationshipObservation.Query().Where(
		relationshipobservation.SourceEQ(interaction.Source),
		relationshipobservation.SourceAccountIDEQ(interaction.SourceAccountID),
		relationshipobservation.ExternalIDEQ(interaction.ProviderObjectID),
		relationshipobservation.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
	).All(internal)
	if err != nil {
		return CommunicationPurgeResult{}, err
	}
	observationIDs := make([]uuid.UUID, 0, len(observations))
	for _, observation := range observations {
		observationIDs = append(observationIDs, observation.ID)
	}
	result.Observations = len(observationIDs)
	if len(observationIDs) > 0 {
		result.Assertions, err = txc.RelationshipAssertion.Delete().Where(
			relationshipassertion.HasObservationWith(relationshipobservation.IDIn(observationIDs...)),
		).Exec(internal)
		if err != nil {
			return CommunicationPurgeResult{}, err
		}
		if _, err = txc.RelationshipObservation.Update().Where(
			relationshipobservation.IDIn(observationIDs...),
		).ClearSummary().SetNormalizedFactsJSON("{}").ClearPayloadCiphertext().Save(internal); err != nil {
			return CommunicationPurgeResult{}, err
		}
	}
	result.Evidence, err = txc.RevenueEvidence.Update().Where(
		revenueevidence.SourceEQ(interaction.Source),
		revenueevidence.SourceAccountIDEQ(interaction.SourceAccountID),
		revenueevidence.Or(
			revenueevidence.SourceRecordIDEQ(interaction.ProviderObjectID),
			revenueevidence.SourceMessageIDEQ(interaction.ProviderObjectID),
		),
		revenueevidence.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
	).ClearExcerpt().ClearPayloadCiphertext().ClearSourceURI().ClearSourceMessageID().Save(internal)
	if err != nil {
		return CommunicationPurgeResult{}, err
	}
	if _, err = txc.CommunicationParticipant.Delete().Where(
		communicationparticipant.HasInteractionWith(communicationinteraction.IDEQ(interaction.ID)),
	).Exec(internal); err != nil {
		return CommunicationPurgeResult{}, err
	}
	if _, err = txc.CommunicationInteraction.Update().Where(
		communicationinteraction.IDEQ(interaction.ID),
	).SetDeleted(true).SetVisibility("private").ClearSubject().
		SetMetadataJSON("{}").SetContentHash(privacyValueHash("purged:" + interaction.ID.String())).
		Save(internal); err != nil {
		return CommunicationPurgeResult{}, err
	}
	txws, err := txc.RevenueWorkspace.Get(internal, ws.ID)
	if err != nil {
		return CommunicationPurgeResult{}, err
	}
	txactor, err := txc.User.Get(internal, actor.ID)
	if err != nil {
		return CommunicationPurgeResult{}, err
	}
	if err = appendTrustEvent(internal, txc, txws, txactor, TrustEventInput{
		Name: "communication_purged", Outcome: "succeeded",
		ReasonCode: "owner_request", CorrelationID: interaction.ID.String(),
		Source: interaction.Source, OccurredAt: s.now(),
	}); err != nil {
		return CommunicationPurgeResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CommunicationPurgeResult{}, err
	}
	return result, nil
}

// AuthorizeCommunicationObservation prevents permissive conversation-policy
// defaults from publishing owner-private communication evidence.
func (s *Service) AuthorizeCommunicationObservation(
	ctx context.Context,
	actor *ent.User,
	input RelationshipObservationInput,
) error {
	if input.Source != "gmail" && input.Source != "calendar" {
		return nil
	}
	ws, err := s.CurrentWorkspace(ctx, actor)
	if err != nil {
		return err
	}
	owner := actor
	if strings.TrimSpace(input.SourceAccountID) == "" {
		return fmt.Errorf("%w: communication source account is required", ErrInvalidInput)
	}
	participants := make([]string, 0, len(input.Participants)+1)
	participants = append(participants, input.PrimaryEmail)
	for _, participant := range input.Participants {
		participants = append(participants, participant.Email)
	}
	resource := CommunicationResource{MessageID: input.ExternalID, RelationshipID: input.RelationshipID.String()}
	decision, err := s.communicationAuthorization().Evaluate(
		ctx, ws.ID, owner.ID, actor.ID, input.SourceAccountID, participants, resource,
	)
	if err != nil {
		return err
	}
	if !decision.Body && (input.Summary != "" || len(input.Payload) > 0 || len(input.Assertions) > 0) {
		return fmt.Errorf("%w: mailbox owner policy denies communication content", ErrForbidden)
	}
	return nil
}
