package revenue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/parallel"
)

const companyResearchProcessor = parallel.ProcessorPro

var companyResearchFields = map[string]string{
	"linkedin_company_url": "Verified public LinkedIn company page URL. Empty if unavailable.",
	"industry_category":    "Concise primary industry category. Empty if unavailable.",
	"subindustry":          "Specific subindustry or market category. Empty if unavailable.",
	"company_description":  "A concise 1-3 sentence summary of the company's operations, mission, and offerings.",
	"headquarters":         "Headquarters city, state or region, and country. Empty if unavailable.",
	"founded_year":         "Four-digit year the company was founded. Empty if unavailable.",
	"employee_range":       "Current employee count or standardized employee range with the observation year.",
	"ownership":            "Ownership status such as private, public, subsidiary, nonprofit, or acquired.",
	"stock_ticker":         "Public stock exchange and ticker. Empty for non-public companies.",
	"funding_summary":      "Total public funding plus the latest disclosed round amount, type, and date.",
	"revenue_range":        "Most recent publicly supported annual revenue figure or estimated range with year.",
	"business_model":       "Concise description of how the company makes money.",
	"products":             "Principal products or services, comma-separated.",
	"customer_segments":    "Primary customer segments or industries served, comma-separated.",
	"technologies":         "Publicly evidenced core technologies or technology categories, comma-separated.",
	"key_executives":       "Current key executives formatted as Name — Title and separated by semicolons.",
	"recent_news":          "Up to three material company events from the last 12 months with dates.",
	"growth_signals":       "Current hiring, expansion, funding, product-launch, partnership, or contraction signals with dates.",
	"website_url":          "Official HTTPS company website URL.",
	"social_urls":          "Official public social profile URLs other than LinkedIn, comma-separated.",
}

// CompanyResearchOutcome reports the fields accepted from a company research run.
type CompanyResearchOutcome struct {
	RelationshipID uuid.UUID `json:"relationshipId"`
	Matched        bool      `json:"matched"`
	RunID          string    `json:"runId,omitempty"`
	Written        int       `json:"written"`
	Rejected       []string  `json:"rejected,omitempty"`
	Replayed       bool      `json:"replayed"`
}

// EstimateCompanyEnrichment returns the cost of enriching pending company records.
func (s *Service) EstimateCompanyEnrichment(ctx context.Context, u *ent.User) (*ResearchEstimate, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	if err := s.requireCloudResearch(ctx, ws); err != nil {
		return nil, err
	}
	ids, err := s.pendingResearchCompanyIDs(ctx, ws)
	if err != nil {
		return nil, err
	}
	credits := s.researchCost(companyResearchProcessor) * len(ids)
	return &ResearchEstimate{
		Companies: len(ids), Processor: companyResearchProcessor, Credits: credits,
		USD: float64(credits) / 10000, BatchSize: maxResearchBatch,
	}, nil
}

// PendingCompanyEnrichmentIDs returns company records not processed by the current task version.
func (s *Service) PendingCompanyEnrichmentIDs(ctx context.Context, u *ent.User) ([]uuid.UUID, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	if err := s.requireCloudResearch(ctx, ws); err != nil {
		return nil, err
	}
	return s.pendingResearchCompanyIDs(ctx, ws)
}

func (s *Service) pendingResearchCompanyIDs(ctx context.Context, ws *ent.RevenueWorkspace) ([]uuid.UUID, error) {
	rels, err := s.client.Relationship.Query().Where(
		relationship.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		relationship.StatusEQ("active"),
		relationship.KindNEQ("person"),
	).Order(ent.Asc(relationship.FieldCreatedAt)).All(ctx)
	if err != nil {
		return nil, err
	}
	version := companyTaskSpecVersion()
	ids := make([]uuid.UUID, 0, len(rels))
	for _, rel := range rels {
		domain := strings.TrimSpace(rel.AccountDomain)
		if domain != "" && !isPublicMailboxDomain(domain) && rel.CompanyEnrichmentVersion != version {
			ids = append(ids, rel.ID)
		}
	}
	return ids, nil
}

// EnrichCompanies enriches one bounded batch of company records.
func (s *Service) EnrichCompanies(ctx context.Context, u *ent.User, ids []uuid.UUID) ([]*CompanyResearchOutcome, error) {
	if len(ids) == 0 {
		return nil, fmt.Errorf("%w: no companies to enrich", ErrInvalidInput)
	}
	if len(ids) > maxResearchBatch {
		return nil, fmt.Errorf("%w: at most %d companies per request", ErrInvalidInput, maxResearchBatch)
	}
	outcomes := make([]*CompanyResearchOutcome, 0, len(ids))
	for _, id := range ids {
		outcome, err := s.EnrichCompany(ctx, u, id)
		if err != nil {
			if isResearchAdmissionError(err) {
				if len(outcomes) == 0 {
					return nil, err
				}
				return outcomes, nil
			}
			s.log.Warn("revenue: company enrichment failed", zap.String("relationship_id", id.String()), zap.Error(err))
			continue
		}
		outcomes = append(outcomes, outcome)
	}
	return outcomes, nil
}

// EnrichCompany enriches one company record with cited Parallel research.
func (s *Service) EnrichCompany(ctx context.Context, u *ent.User, relationshipID uuid.UUID) (*CompanyResearchOutcome, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute)
	if err != nil {
		return nil, err
	}
	if err := s.requireCloudResearch(ctx, ws); err != nil {
		return nil, err
	}
	if !s.ResearchAvailable() {
		return nil, ErrResearchUnavailable
	}
	rel, err := s.client.Relationship.Query().Where(
		relationship.IDEQ(relationshipID),
		relationship.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
	).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	anchor, err := companyResearchAnchor(rel)
	if err != nil {
		return nil, err
	}
	version := companyTaskSpecVersion()
	cost := s.researchCost(companyResearchProcessor)
	charge, err := s.research.Gate.Reserve(ctx, "parallel_task", cost, researchRequestID(rel.ID, version), s.research.Limits)
	if err != nil {
		return nil, err
	}
	if charge.Finalized() {
		return replayedCompanyOutcome(rel, version), nil
	}
	if charge.InProgress() {
		return nil, ErrResearchInProgress
	}
	result, err := s.research.Client.RunTask(ctx, parallel.TaskRequest{
		Input: anchor, OutputSchema: companyResearchSchema(), Processor: companyResearchProcessor,
	})
	if err != nil {
		s.refundResearch(ctx, charge)
		return nil, err
	}
	profile, matched, rejected := companyProfileFromResult(result)
	outcome := &CompanyResearchOutcome{
		RelationshipID: rel.ID, Matched: matched, RunID: result.RunID,
		Written: profile.written(), Rejected: rejected,
	}
	citations := make(map[string][]string, len(rel.CompanyEnrichmentRefs)+len(profile.citations))
	for field, refs := range rel.CompanyEnrichmentRefs {
		citations[field] = refs
	}
	for field, refs := range profile.citations {
		citations[field] = refs
	}
	enrichmentData := make(map[string]string, len(rel.CompanyEnrichmentData)+len(profile.data))
	for field, value := range rel.CompanyEnrichmentData {
		enrichmentData[field] = value
	}
	for field, value := range profile.data {
		enrichmentData[field] = value
	}
	enrichmentRefs := make(map[string][]string, len(rel.CompanyEnrichmentRefs)+len(citations))
	for field, refs := range rel.CompanyEnrichmentRefs {
		enrichmentRefs[field] = refs
	}
	for field, refs := range citations {
		enrichmentRefs[field] = refs
	}
	update := rel.Update().
		SetCompanyEnrichmentVersion(version).
		SetCompanyEnrichedAt(s.now().UTC()).
		SetCompanyEnrichmentRefs(enrichmentRefs).
		SetCompanyEnrichmentData(enrichmentData)
	if profile.category != "" {
		update.SetCompanyCategories([]string{profile.category})
	}
	if profile.description != "" {
		update.SetCompanyDescription(profile.description)
	}
	if profile.linkedinURL != "" {
		update.SetLinkedinURL(profile.linkedinURL)
		refs, normalizeErr := normalizeResourceRefs(append(append([]string{}, rel.ResourceRefs...), profile.linkedinRef()))
		if normalizeErr != nil {
			s.refundResearch(ctx, charge)
			return nil, normalizeErr
		}
		update.SetResourceRefs(refs)
	}
	if _, err := update.Save(ctx); err != nil {
		s.refundResearch(ctx, charge)
		return nil, err
	}
	s.settleResearch(ctx, charge, cost)
	return outcome, nil
}

func replayedCompanyOutcome(rel *ent.Relationship, version string) *CompanyResearchOutcome {
	profile := companyProfile{
		citations: rel.CompanyEnrichmentRefs, category: strings.Join(rel.CompanyCategories, ", "),
		description: rel.CompanyDescription, linkedinURL: rel.LinkedinURL,
		data: rel.CompanyEnrichmentData,
	}
	return &CompanyResearchOutcome{
		RelationshipID: rel.ID, Matched: rel.CompanyEnrichmentVersion == version && profile.written() > 0,
		Written: profile.written(), Replayed: true,
	}
}

func companyResearchAnchor(rel *ent.Relationship) (map[string]any, error) {
	domain := strings.ToLower(strings.TrimSpace(rel.AccountDomain))
	if rel.Kind == "person" || domain == "" || isPublicMailboxDomain(domain) {
		return nil, fmt.Errorf("%w: company has no verified domain to anchor on", ErrInvalidInput)
	}
	return map[string]any{"company_name": strings.TrimSpace(rel.DisplayName), "company_domain": domain}, nil
}

func companyResearchSchema() map[string]any {
	properties := map[string]any{
		researchMatchField: map[string]any{
			"type": "string", "enum": []string{"high", "medium", "low"},
			"description": "How certain you are that the sources describe the company at this exact domain.",
		},
	}
	for field, description := range companyResearchFields {
		properties[field] = map[string]any{"type": "string", "description": description}
	}
	return map[string]any{
		"type": "object", "properties": properties,
		"required": []string{researchMatchField}, "additionalProperties": false,
	}
}

func companyTaskSpecVersion() string {
	encoded, err := json.Marshal(companyResearchSchema())
	if err != nil {
		panic("revenue: company research schema is not marshalable: " + err.Error())
	}
	sum := sha256.Sum256(encoded)
	return researchExtractor + "/" + companyResearchProcessor + "@" + hex.EncodeToString(sum[:])[:12]
}

type companyProfile struct {
	category    string
	description string
	linkedinURL string
	citations   map[string][]string
	data        map[string]string
}

func (p companyProfile) written() int {
	if len(p.data) > 0 {
		return len(p.data)
	}
	n := 0
	for _, value := range []string{p.category, p.description, p.linkedinURL} {
		if value != "" {
			n++
		}
	}
	return n
}

func (p companyProfile) linkedinRef() string {
	parsed, _ := url.Parse(p.linkedinURL)
	return "linkedin:company:" + strings.Split(strings.TrimPrefix(parsed.Path, "/company/"), "/")[0]
}

func companyProfileFromResult(result *parallel.TaskResult) (companyProfile, bool, []string) {
	profile := companyProfile{citations: map[string][]string{}, data: map[string]string{}}
	if result == nil {
		return profile, false, []string{"vendor returned no result"}
	}
	match := strings.ToLower(strings.TrimSpace(stringValue(result.Content[researchMatchField])))
	if match != "high" {
		if match == "" {
			match = "unstated"
		}
		return profile, false, []string{"company match confidence is " + match + "; nothing stored"}
	}
	rejected := []string{}
	fields := make([]string, 0, len(companyResearchFields))
	for field := range companyResearchFields {
		fields = append(fields, field)
	}
	sort.Strings(fields)
	for _, field := range fields {
		value := strings.TrimSpace(stringValue(result.Content[field]))
		if value == "" {
			continue
		}
		basis, ok := result.BasisFor(field)
		if !ok {
			rejected = append(rejected, field+": no basis returned")
			continue
		}
		citations := usableCitations(basis.Citations)
		if len(citations) == 0 {
			rejected = append(rejected, field+": no citation to check")
			continue
		}
		switch field {
		case "industry_category":
			value = strings.Join(strings.Fields(value), " ")
			if len([]rune(value)) > 80 {
				rejected = append(rejected, field+": value is implausibly long")
				continue
			}
			profile.category = value
		case "company_description":
			if len([]rune(value)) > maxVendorValueRunes {
				rejected = append(rejected, field+": value is implausibly long")
				continue
			}
			profile.description = value
		case "linkedin_company_url":
			profile.linkedinURL = canonicalLinkedInCompanyURL(value)
			if profile.linkedinURL == "" {
				rejected = append(rejected, field+": invalid LinkedIn company URL")
				continue
			}
			value = profile.linkedinURL
		default:
			if len([]rune(value)) > maxVendorValueRunes {
				rejected = append(rejected, field+": value is implausibly long")
				continue
			}
		}
		urls := make([]string, 0, len(citations))
		for _, citation := range citations {
			urls = append(urls, citation.URL)
		}
		profile.citations[field] = urls
		profile.data[field] = value
	}
	return profile, true, rejected
}

func canonicalLinkedInCompanyURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Port() != "" {
		return ""
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "linkedin.com" && host != "www.linkedin.com" {
		return ""
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) < 2 || parts[0] != "company" || parts[1] == "" {
		return ""
	}
	return "https://www.linkedin.com/company/" + parts[1]
}
