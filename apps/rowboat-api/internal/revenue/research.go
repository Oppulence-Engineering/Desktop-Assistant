package revenue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personattribute"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/parallel"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
)

// Cloud research (RFC 039): enrich a person from the public web through the
// Parallel Task API, and store the answer as evidence rather than as prose.
//
// Every claim written here is an `external_research` PersonAttribute carrying
// the vendor's citations. Nothing is written that a user cannot check by
// clicking a link, and nothing is written at all unless the vendor is confident
// it resolved the right human being.

// ErrResearchUnavailable means no research vendor is configured. Distinct from
// the three admission gates: this is our misconfiguration, not the caller's.
var ErrResearchUnavailable = errors.New("revenue: cloud research is not configured")

// ErrResearchInProgress means an identical enrichment is already running or has
// already completed for this person and task-spec version.
var ErrResearchInProgress = errors.New("revenue: an identical research request is already in flight")

const (
	researchSourceType = "external_research"
	researchSource     = "web"
	researchExtractor  = "parallel"

	// personResearchProcessor is the `base` tier: ~5 fields at $10/1k, which is
	// exactly the shape of the person task below. `core` buys depth this task
	// has no use for; `lite` cannot cover the fields.
	personResearchProcessor = parallel.ProcessorBase

	// maxResearchBatch bounds one bulk request. The desktop chunks a workspace
	// sweep into batches of this size and retries a failed chunk; per-person
	// idempotency (see researchRequestID) makes a retried chunk free for the
	// people it already enriched. A durable job runner would be the alternative,
	// and is not worth building before the first bulk run has ever happened.
	maxResearchBatch = 25

	// researchMatchField is the vendor's own answer to "is this the same
	// person?". It is requested as an output field so entity resolution is a
	// value we can refuse on, rather than something inferred from whether the
	// other fields happen to look plausible.
	researchMatchField = "match_confidence"

	// maxVendorValueRunes bounds any single string a vendor can put into a row.
	//
	// Everything the vendor returns is attacker-adjacent: the task input carries
	// a display name parsed from an email signature, which is supplied by whoever
	// sent the mail. The response is capped at 8MB by the outbound policy, and
	// without a per-field bound that whole budget can land in one `location` cell
	// and then in an attention explanation. A job title is not 512 characters; a
	// value that long is a malfunction, and truncating it would fabricate a claim
	// nobody made, so it is refused.
	maxVendorValueRunes = 512
)

// personResearchDimensions maps task output fields onto PersonAttribute
// dimensions. The task asks for exactly these and nothing else: an output field
// with no dimension has nowhere to go, and a dimension with no citation
// requirement is not evidence.
var personResearchDimensions = map[string]string{
	"title":      "title",
	"org_name":   "org_name",
	"org_domain": "org_domain",
	"seniority":  "seniority",
	"location":   "location",
}

// ResearchConfig wires the vendor client and the billing gate onto the service.
// A zero value disables research; every entry point then returns
// ErrResearchUnavailable rather than silently doing nothing.
type ResearchConfig struct {
	Client *parallel.Client
	Gate   *quota.Gate
	// Costs maps a processor to credits per run. 1 credit = $0.0001, so `base`
	// at $10/1k is 100 credits.
	Costs  map[string]int
	Limits quota.SpendLimits
}

// SetResearch installs the cloud research vendor and its credit gate.
func (s *Service) SetResearch(cfg ResearchConfig) { s.research = cfg }

// ResearchAvailable reports whether a vendor is configured at all. It says
// nothing about whether the caller may use it — see requireCloudResearch.
func (s *Service) ResearchAvailable() bool {
	return s.research.Client.Configured() && s.research.Gate != nil
}

// PersonResearchOutcome is the result of enriching one person.
type PersonResearchOutcome struct {
	PersonID uuid.UUID `json:"personId"`
	// Matched is false when the vendor could not identify the person with high
	// confidence. Nothing is written in that case: see the note on silence
	// below.
	Matched  bool     `json:"matched"`
	RunID    string   `json:"runId,omitempty"`
	Written  int      `json:"written"`
	Rejected []string `json:"rejected,omitempty"`
	// Replayed is true when this person had already been enriched at this
	// task-spec version, so no vendor call and no charge happened.
	Replayed bool `json:"replayed"`
}

// ResearchEstimate is what a bulk run will cost, before it runs.
type ResearchEstimate struct {
	People    int    `json:"people"`
	Processor string `json:"processor"`
	Credits   int    `json:"credits"`
	// USD is the same number in the unit users think in. Credits are an
	// implementation detail of the ledger; "$4.12" is the thing to confirm.
	USD float64 `json:"usd"`
	// BatchSize is the maximum ids one EnrichPersons call accepts, so a caller
	// can chunk without discovering the limit by being rejected.
	BatchSize int `json:"batchSize"`
}

// EstimatePersonEnrichment prices enriching every person in the workspace that
// has not been enriched at the current task-spec version.
//
// This exists because the tail is where bulk enrichment breaks: 5,000 people at
// `base` is $50 in one click. A spinner and a bill is not an acceptable design
// for that, so the count and the price are computed before anything is spent.
func (s *Service) EstimatePersonEnrichment(ctx context.Context, u *ent.User) (*ResearchEstimate, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	if err := s.requireCloudResearch(ctx, ws); err != nil {
		return nil, err
	}
	ids, err := s.pendingResearchPersonIDs(ctx, ws)
	if err != nil {
		return nil, err
	}
	credits := s.researchCost(personResearchProcessor) * len(ids)
	return &ResearchEstimate{
		People:    len(ids),
		Processor: personResearchProcessor,
		Credits:   credits,
		USD:       float64(credits) / 10000,
		BatchSize: maxResearchBatch,
	}, nil
}

// PendingPersonEnrichmentIDs lists the people a bulk run would cover, in a
// stable order, so a caller can chunk deterministically and resume.
func (s *Service) PendingPersonEnrichmentIDs(ctx context.Context, u *ent.User) ([]uuid.UUID, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	if err := s.requireCloudResearch(ctx, ws); err != nil {
		return nil, err
	}
	return s.pendingResearchPersonIDs(ctx, ws)
}

func (s *Service) pendingResearchPersonIDs(
	ctx context.Context,
	ws *ent.RevenueWorkspace,
) ([]uuid.UUID, error) {
	people, err := s.client.Person.Query().
		Where(
			person.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			person.StatusEQ("active"),
		).
		Order(ent.Asc(person.FieldCreatedAt)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	// Everyone already enriched at this task-spec version, in ONE query.
	//
	// This ran per-person before, which is a query per contact on an endpoint the
	// settings pane calls whenever it opens — 5,001 round trips for a workspace
	// with 5,000 people, to compute a number shown above a button.
	version := personTaskSpecVersion()
	enriched, err := s.client.PersonAttribute.Query().
		Where(
			personattribute.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			personattribute.SourceTypeEQ(researchSourceType),
			personattribute.ExtractorVersionEQ(version),
		).
		QueryPerson().
		IDs(ctx)
	if err != nil {
		return nil, err
	}
	done := make(map[uuid.UUID]struct{}, len(enriched))
	for _, id := range enriched {
		done[id] = struct{}{}
	}
	ids := make([]uuid.UUID, 0, len(people))
	for _, p := range people {
		// Re-running an already-enriched person would ask the same task the same
		// question and pay for the same answer.
		if _, seen := done[p.ID]; !seen {
			ids = append(ids, p.ID)
		}
	}
	return ids, nil
}

// EnrichPersons runs one bounded batch. Each person is charged, called and
// stored independently, so one refusal does not abort the rest of the batch —
// a bulk run that dies halfway through and reports nothing is worse than one
// that reports what it managed.
func (s *Service) EnrichPersons(
	ctx context.Context,
	u *ent.User,
	ids []uuid.UUID,
) ([]*PersonResearchOutcome, error) {
	if len(ids) == 0 {
		return nil, fmt.Errorf("%w: no people to enrich", ErrInvalidInput)
	}
	if len(ids) > maxResearchBatch {
		return nil, fmt.Errorf("%w: at most %d people per request", ErrInvalidInput, maxResearchBatch)
	}
	outcomes := make([]*PersonResearchOutcome, 0, len(ids))
	for _, id := range ids {
		outcome, err := s.EnrichPerson(ctx, u, id)
		if err != nil {
			// Admission failures apply to the whole batch, not to one person:
			// there is no point calling the vendor 24 more times to be told the
			// same thing. Anything else is that person's problem alone.
			if errors.Is(err, ErrCapabilityDisabled) ||
				errors.Is(err, ErrResearchPlanRequired) ||
				errors.Is(err, ErrResearchConsentRequired) ||
				errors.Is(err, ErrResearchUnavailable) ||
				errors.Is(err, quota.ErrInsufficientCredits) ||
				errors.Is(err, quota.ErrDailyLimitExceeded) ||
				errors.Is(err, quota.ErrMonthlyLimitExceeded) ||
				errors.Is(err, quota.ErrSubscriptionNotActive) {
				if len(outcomes) == 0 {
					return nil, err
				}
				return outcomes, nil
			}
			s.log.Warn("revenue: person enrichment failed",
				zap.String("person_id", id.String()), zap.Error(err))
			continue
		}
		outcomes = append(outcomes, outcome)
	}
	return outcomes, nil
}

// EnrichPerson enriches one person from the public web.
//
// What leaves the machine is exactly what the consent copy promises: the
// person's display name, their email DOMAIN, and their current employer. Never
// the address itself, never message content, never a note.
func (s *Service) EnrichPerson(
	ctx context.Context,
	u *ent.User,
	personID uuid.UUID,
) (*PersonResearchOutcome, error) {
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
	p, err := s.client.Person.Query().
		Where(
			person.IDEQ(personID),
			person.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	anchor, err := personResearchAnchor(p)
	if err != nil {
		return nil, err
	}
	schema := personResearchSchema()
	version := personTaskSpecVersion()

	// Reserve before calling. The request id is derived from the person and the
	// task-spec version, so a retry after a crash replays the same reservation
	// instead of buying the same five fields twice.
	cost := s.researchCost(personResearchProcessor)
	charge, err := s.research.Gate.Reserve(
		ctx, "parallel_task", cost, researchRequestID(p.ID, version), s.research.Limits,
	)
	if err != nil {
		return nil, err
	}
	if charge.Finalized() {
		// This person + task-spec version has already been paid for. Report what
		// is actually stored rather than assuming the earlier run succeeded: it
		// may have been an honest "could not identify", and claiming a match here
		// would make a bulk run report enrichment that never happened.
		return s.replayedPersonOutcome(ctx, p, version)
	}
	if charge.InProgress() {
		return nil, ErrResearchInProgress
	}

	result, err := s.research.Client.RunTask(ctx, parallel.TaskRequest{
		Input:        anchor,
		OutputSchema: schema,
		Processor:    personResearchProcessor,
	})
	if err != nil {
		// Failed runs are not billed by the vendor, so they must not be billed
		// to the user either.
		s.refundResearch(ctx, charge)
		return nil, err
	}

	inputs, matched, rejected := personAttributesFromResult(result, version, s.now())
	outcome := &PersonResearchOutcome{
		PersonID: p.ID,
		Matched:  matched,
		RunID:    result.RunID,
		Rejected: rejected,
	}
	if matched && len(inputs) > 0 {
		if err := upsertPersonAttributes(ctx, s.client, ws, u, p, nil, inputs); err != nil {
			s.refundResearch(ctx, charge)
			return nil, err
		}
		if _, err := projectPersonAttributes(ctx, s.client, p, s.now()); err != nil {
			s.refundResearch(ctx, charge)
			return nil, err
		}
		outcome.Written = len(inputs)
	}
	// Settled even when nothing was written. The vendor ran and billed us for
	// the search; refunding an honest "I could not identify this person" would
	// make silence the cheapest possible answer to give, which is the wrong
	// incentive to build into the accounting.
	s.settleResearch(ctx, charge, cost)
	return outcome, nil
}

// replayedPersonOutcome describes an enrichment that was already charged for.
//
// A refused or failed earlier attempt also leaves a terminal ledger row, so this
// must read the stored attributes rather than infer success from the fact that
// money changed hands. `matched: false, written: 0` is the truthful answer for a
// person the vendor could not identify — and for the rarer case where the vendor
// answered but our own write failed, which is refunded and logged but cannot be
// re-attempted at the same task-spec version.
func (s *Service) replayedPersonOutcome(
	ctx context.Context,
	p *ent.Person,
	version string,
) (*PersonResearchOutcome, error) {
	written, err := s.client.PersonAttribute.Query().
		Where(
			personattribute.HasPersonWith(person.IDEQ(p.ID)),
			personattribute.SourceTypeEQ(researchSourceType),
			personattribute.ExtractorVersionEQ(version),
		).Count(ctx)
	if err != nil {
		return nil, err
	}
	return &PersonResearchOutcome{
		PersonID: p.ID,
		Replayed: true,
		Matched:  written > 0,
		Written:  written,
	}, nil
}

func (s *Service) researchCost(processor string) int {
	if cost, ok := s.research.Costs[processor]; ok && cost > 0 {
		return cost
	}
	// A missing rate must not mean free. `core` is the most expensive published
	// tier, so an unpriced processor is charged as the worst case rather than
	// waved through.
	return 250
}

// researchRequestID is the idempotency key for one person at one task-spec
// version. Deterministic by construction: replaying a crashed bulk run must not
// re-bill for people it already covered.
func researchRequestID(personID uuid.UUID, taskSpecVersion string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("parallel_task:"+personID.String()+":"+taskSpecVersion))
}

func (s *Service) refundResearch(ctx context.Context, charge *quota.Charge) {
	rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := charge.Refund(rctx); err != nil {
		s.log.Error("revenue: research refund failed", zap.Error(err))
	}
}

func (s *Service) settleResearch(ctx context.Context, charge *quota.Charge, actual int) {
	sctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := charge.Settle(sctx, actual); err != nil {
		s.log.Error("revenue: research settle failed", zap.Error(err))
	}
}

// personResearchAnchor builds the vendor input.
//
// The anchor is deliberately narrow: a name alone resolves to the wrong Sarah
// Chen, and this codebase would rather return nothing than attribute a
// stranger's job history to a real contact. A verified domain plus a name is the
// minimum that makes a match checkable; without a domain we do not ask.
func personResearchAnchor(p *ent.Person) (map[string]any, error) {
	name := strings.TrimSpace(p.DisplayName)
	if name == "" {
		return nil, fmt.Errorf("%w: person has no name to anchor on", ErrInvalidInput)
	}
	domain := strings.TrimSpace(p.OrgDomain)
	if domain == "" {
		domain = accountDomain(p.PrimaryEmail)
	}
	if domain == "" || isPublicMailboxDomain(domain) {
		// A gmail.com address is not an employer, and "Sarah Chen at gmail.com"
		// is not an anchor — it is a name with extra steps.
		return nil, fmt.Errorf("%w: person has no verified company domain to anchor on", ErrInvalidInput)
	}
	anchor := map[string]any{
		"full_name":      name,
		"company_domain": domain,
	}
	if org := strings.TrimSpace(p.OrgName); org != "" {
		anchor["company_name"] = org
	}
	return anchor, nil
}

// personResearchSchema is the task's output contract. Field names here become
// PersonAttribute dimensions, so the model chooses values and never keys.
func personResearchSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			researchMatchField: map[string]any{
				"type":        "string",
				"enum":        []string{"high", "medium", "low"},
				"description": "How certain you are that the sources describe this exact person at this exact company. Answer low if the name is common and nothing ties the sources to this company.",
			},
			"title": map[string]any{
				"type":        "string",
				"description": "Current job title. Empty if not stated in a source.",
			},
			"org_name": map[string]any{
				"type":        "string",
				"description": "Current employer name.",
			},
			"org_domain": map[string]any{
				"type":        "string",
				"description": "Current employer primary web domain, no scheme.",
			},
			"seniority": map[string]any{
				"type":        "string",
				"enum":        []string{"ic", "manager", "director", "vp", "executive", "founder"},
				"description": "Seniority band implied by the title.",
			},
			"location": map[string]any{
				"type":        "string",
				"description": "City and country the person currently works from.",
			},
		},
		"required":             []string{researchMatchField},
		"additionalProperties": false,
	}
}

// personTaskSpecVersion identifies the exact question asked, so a change to the
// schema or the processor reads as a new extractor rather than as the same one
// quietly meaning something else. It is also half the idempotency key: change
// the question and the answer is worth paying for again.
func personTaskSpecVersion() string {
	encoded, err := json.Marshal(personResearchSchema())
	if err != nil {
		// The schema is a literal; marshalling it cannot fail, and a version
		// that silently degrades to a constant would collapse idempotency.
		panic("revenue: person research schema is not marshalable: " + err.Error())
	}
	sum := sha256.Sum256(encoded)
	return researchExtractor + "/" + personResearchProcessor + "@" + hex.EncodeToString(sum[:])[:12]
}

// personAttributesFromResult maps a completed run onto attribute inputs.
//
// Two refusals, both deliberate, both returning silence rather than a hedged
// value:
//
//  1. A match confidence below `high` discards the ENTIRE result. Attaching a
//     stranger's job history to a real contact is worse than never having run
//     the query, and "store it at low confidence" is how that happens: a low
//     confidence still wins a dimension nothing else asserts.
//  2. A field with no usable citation is dropped. The citation is the only thing
//     that makes external_research different from a guess.
func personAttributesFromResult(
	result *parallel.TaskResult,
	extractorVersion string,
	now time.Time,
) (inputs []PersonAttributeInput, matched bool, rejected []string) {
	if result == nil {
		return nil, false, []string{"vendor returned no result"}
	}
	if match := strings.ToLower(strings.TrimSpace(stringValue(result.Content[researchMatchField]))); match != "high" {
		if match == "" {
			match = "unstated"
		}
		return nil, false, []string{"identity match confidence is " + match + "; nothing stored"}
	}

	fields := make([]string, 0, len(personResearchDimensions))
	for field := range personResearchDimensions {
		fields = append(fields, field)
	}
	sort.Strings(fields)

	for _, field := range fields {
		value := strings.TrimSpace(stringValue(result.Content[field]))
		if value == "" {
			continue
		}
		if len([]rune(value)) > maxVendorValueRunes {
			rejected = append(rejected, field+": value is implausibly long")
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
		encoded, err := json.Marshal(citations)
		if err != nil {
			rejected = append(rejected, field+": citations could not be encoded")
			continue
		}
		inputs = append(inputs, PersonAttributeInput{
			Dimension:        personResearchDimensions[field],
			Value:            value,
			SourceType:       researchSourceType,
			Source:           researchSource,
			Extractor:        researchExtractor,
			Confidence:       researchConfidence(basis.Confidence),
			Reason:           strings.TrimSpace(basis.Reasoning),
			ObservedAt:       now.UTC(),
			ExternalID:       result.RunID,
			CitationsJSON:    string(encoded),
			ExtractorVersion: extractorVersion,
		})
	}
	return inputs, true, rejected
}

// researchConfidence coerces the vendor's categorical confidence onto the
// numeric scale the ladder compares.
//
// An unrecognised or missing level maps to the LOW value rather than to a
// middling default: an unlabelled claim is not a medium-confidence claim, and
// rounding unknown upward is how a vendor's silence becomes our assertion.
func researchConfidence(level string) float64 {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "high":
		return 0.85
	case "medium":
		return 0.6
	default:
		return 0.35
	}
}

// usableCitations keeps only citations a user could actually click. A citation
// that does not resolve to a web page is decoration.
func usableCitations(citations []parallel.Citation) []parallel.Citation {
	kept := make([]parallel.Citation, 0, len(citations))
	for _, citation := range citations {
		parsed, err := url.Parse(strings.TrimSpace(citation.URL))
		if err != nil || parsed.Host == "" {
			continue
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			continue
		}
		kept = append(kept, citation)
	}
	return kept
}

func stringValue(v any) string {
	s, _ := v.(string)
	return s
}
