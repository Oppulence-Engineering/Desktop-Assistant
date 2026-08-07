package revenue

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personattribute"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/parallel"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
)

// --- vendor double -----------------------------------------------------------

// vendorStub is a Parallel Task API stand-in. It records how many runs were
// created, which is how the cost tests tell "we called the vendor" apart from
// "we replayed a completed run".
type vendorStub struct {
	runs    int
	inputs  []map[string]any
	content map[string]any
	basis   []map[string]any
	status  string
	// httpStatus, when non-zero, fails run creation with that status.
	httpStatus int
}

func (v *vendorStub) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/tasks/runs" {
			if v.httpStatus != 0 {
				w.WriteHeader(v.httpStatus)
				_, _ = w.Write([]byte(`{"error":"nope"}`))
				return
			}
			var body struct {
				Input map[string]any `json:"input"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			v.runs++
			v.inputs = append(v.inputs, body.Input)
			_ = json.NewEncoder(w).Encode(map[string]any{"run_id": "run_stub"})
			return
		}
		status := v.status
		if status == "" {
			status = "completed"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"run": map[string]any{"run_id": "run_stub", "status": status},
			"output": map[string]any{
				"content": v.content,
				"basis":   v.basis,
			},
		})
	})
}

func citedBasis(field, confidence string) map[string]any {
	return map[string]any{
		"field":      field,
		"confidence": confidence,
		"reasoning":  "stated on the company site",
		"citations": []map[string]any{{
			"title":    "Team — Acme",
			"url":      "https://acme.example/team",
			"excerpts": []string{"Sarah Chen, VP Engineering"},
		}},
	}
}

// researchFixture is a fixture with all three gates open and a stubbed vendor.
type researchFixture struct {
	*fixture
	vendor *vendorStub
	person *ent.Person
}

func newResearchFixture(t *testing.T, vendor *vendorStub) *researchFixture {
	t.Helper()
	f := newFixture(t)
	enableCloudResearch(t, f)
	if _, err := f.svc.SetCloudResearchConsent(f.ctx, f.user, true); err != nil {
		t.Fatalf("grant consent: %v", err)
	}
	grantSub(t, f, ResearchPlan, "active")

	srv := httptest.NewServer(vendor.handler())
	t.Cleanup(srv.Close)
	f.svc.SetResearch(ResearchConfig{
		Client: parallel.New(parallel.Config{
			APIKey:             "test-key",
			BaseURL:            srv.URL,
			ResultPollInterval: time.Millisecond,
			ResultPollAttempts: 3,
		}),
		Gate:  quota.New(f.client, zap.NewNop()),
		Costs: map[string]int{parallel.ProcessorBase: 100, parallel.ProcessorLite: 50},
	})
	return &researchFixture{fixture: f, vendor: vendor, person: seedResearchPerson(t, f)}
}

// seedResearchPerson creates one canonical person with a verified company
// domain, which is the minimum anchor research will accept.
func seedResearchPerson(t *testing.T, f *fixture) *ent.Person {
	t.Helper()
	seedPerson(t, f, "obs_research", "Sarah Chen", "sarah@acme.example")
	people := personsIn(t, f)
	if len(people) != 1 {
		t.Fatalf("expected 1 seeded person, got %d", len(people))
	}
	return people[0]
}

func (rf *researchFixture) attributes(t *testing.T) []*ent.PersonAttribute {
	t.Helper()
	rows, err := rf.client.PersonAttribute.Query().
		Where(
			personattribute.HasPersonWith(person.IDEQ(rf.person.ID)),
			personattribute.SourceTypeEQ(researchSourceType),
		).All(rf.ctx)
	if err != nil {
		t.Fatalf("query research attributes: %v", err)
	}
	return rows
}

func creditsSpent(t *testing.T, f *fixture) int {
	t.Helper()
	rows, err := f.client.CreditLedger.Query().All(f.ctx)
	if err != nil {
		t.Fatalf("query ledger: %v", err)
	}
	net := 0
	for _, row := range rows {
		net += row.Delta
	}
	return -net
}

// --- unit: basis → attribute mapping ----------------------------------------

func TestPersonAttributesFromResultMapsBasis(t *testing.T) {
	now := time.Date(2026, 8, 6, 9, 0, 0, 0, time.UTC)
	result := &parallel.TaskResult{
		RunID: "run_1",
		Content: map[string]any{
			researchMatchField: "high",
			"title":            "VP Engineering",
			"seniority":        "vp",
		},
		Basis: []parallel.Basis{
			{Field: "title", Confidence: "high", Reasoning: "leadership page",
				Citations: []parallel.Citation{{URL: "https://acme.example/team", Title: "Team"}}},
			{Field: "seniority", Confidence: "medium",
				Citations: []parallel.Citation{{URL: "https://acme.example/team"}}},
		},
	}

	inputs, matched, rejected := personAttributesFromResult(result, "v1", now)
	if !matched {
		t.Fatal("a high-confidence match must be accepted")
	}
	if len(rejected) != 0 {
		t.Fatalf("unexpected rejections: %v", rejected)
	}
	if len(inputs) != 2 {
		t.Fatalf("mapped %d inputs, want 2: %+v", len(inputs), inputs)
	}
	byDimension := map[string]PersonAttributeInput{}
	for _, in := range inputs {
		byDimension[in.Dimension] = in
	}
	title := byDimension["title"]
	if title.Value != "VP Engineering" {
		t.Fatalf("title value = %q", title.Value)
	}
	if title.SourceType != "external_research" || title.Source != "web" || title.Extractor != "parallel" {
		t.Fatalf("provenance = %s/%s/%s", title.SourceType, title.Source, title.Extractor)
	}
	if title.Confidence != 0.85 {
		t.Fatalf("high confidence coerced to %v, want 0.85", title.Confidence)
	}
	if byDimension["seniority"].Confidence != 0.6 {
		t.Fatalf("medium confidence coerced to %v, want 0.6", byDimension["seniority"].Confidence)
	}
	if title.ExtractorVersion != "v1" || title.ExternalID != "run_1" {
		t.Fatalf("extractor version / run id = %q / %q", title.ExtractorVersion, title.ExternalID)
	}
	var citations []parallel.Citation
	if err := json.Unmarshal([]byte(title.CitationsJSON), &citations); err != nil {
		t.Fatalf("citations are not valid JSON: %v", err)
	}
	if len(citations) != 1 || citations[0].URL != "https://acme.example/team" {
		t.Fatalf("citations = %+v", citations)
	}
}

// The RFC's named unit case: a basis entry with zero citations must be
// rejected, not stored at confidence 0.
func TestPersonAttributesFromResultRejectsUncitedFields(t *testing.T) {
	now := time.Now().UTC()
	result := &parallel.TaskResult{
		Content: map[string]any{
			researchMatchField: "high",
			"title":            "VP Engineering",
			"org_name":         "Acme",
			"location":         "Berlin",
		},
		Basis: []parallel.Basis{
			{Field: "title", Confidence: "high"}, // no citations at all
			{Field: "org_name", Confidence: "high", Citations: []parallel.Citation{{URL: "not a url"}}}, // unusable
			// `location` has no basis entry whatsoever.
		},
	}

	inputs, matched, rejected := personAttributesFromResult(result, "v1", now)
	if !matched {
		t.Fatal("the match itself was fine; only the fields were uncited")
	}
	if len(inputs) != 0 {
		t.Fatalf("stored %d uncited claims: %+v", len(inputs), inputs)
	}
	if len(rejected) != 3 {
		t.Fatalf("expected 3 rejection reasons, got %v", rejected)
	}
}

// Entity resolution: anything short of a high-confidence identity match
// discards the whole result. Silence is an acceptable output.
func TestPersonAttributesFromResultRejectsWeakIdentityMatch(t *testing.T) {
	for _, match := range []string{"medium", "low", "", "nonsense"} {
		result := &parallel.TaskResult{
			Content: map[string]any{researchMatchField: match, "title": "VP Engineering"},
			Basis: []parallel.Basis{{Field: "title", Confidence: "high",
				Citations: []parallel.Citation{{URL: "https://acme.example/team"}}}},
		}
		inputs, matched, rejected := personAttributesFromResult(result, "v1", time.Now().UTC())
		if matched || len(inputs) != 0 {
			t.Fatalf("match %q was accepted: matched=%v inputs=%+v", match, matched, inputs)
		}
		if len(rejected) == 0 {
			t.Fatalf("match %q was refused without saying why", match)
		}
	}
}

func TestResearchConfidenceCoercion(t *testing.T) {
	cases := map[string]float64{
		"high": 0.85, "HIGH": 0.85, "medium": 0.6, "low": 0.35,
		"": 0.35, "extremely certain": 0.35,
	}
	for level, want := range cases {
		if got := researchConfidence(level); got != want {
			t.Fatalf("researchConfidence(%q) = %v, want %v", level, got, want)
		}
	}
}

// --- the anchor --------------------------------------------------------------

// A name with no verified company domain is not an anchor. "Sarah Chen at
// gmail.com" resolves to the wrong Sarah Chen, so the call is never made.
func TestEnrichPersonRefusesWithoutACompanyAnchor(t *testing.T) {
	vendor := &vendorStub{}
	rf := newResearchFixture(t, vendor)

	rf.client.Person.UpdateOne(rf.person).
		SetOrgDomain("").SetPrimaryEmail("sarah@gmail.com").ExecX(rf.ctx)

	_, err := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID)
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("want ErrInvalidInput for an unanchored person, got %v", err)
	}
	if vendor.runs != 0 {
		t.Fatal("an unanchored person reached the vendor")
	}
}

// The consent copy promises the name, the email DOMAIN and the employer. The
// address itself must never leave.
func TestEnrichPersonSendsOnlyWhatConsentPromises(t *testing.T) {
	vendor := &vendorStub{
		content: map[string]any{researchMatchField: "high", "title": "VP Engineering"},
		basis:   []map[string]any{citedBasis("title", "high")},
	}
	rf := newResearchFixture(t, vendor)

	if _, err := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID); err != nil {
		t.Fatalf("EnrichPerson: %v", err)
	}
	if len(vendor.inputs) != 1 {
		t.Fatalf("vendor saw %d inputs", len(vendor.inputs))
	}
	sent, err := json.Marshal(vendor.inputs[0])
	if err != nil {
		t.Fatalf("marshal sent input: %v", err)
	}
	body := string(sent)
	if !strings.Contains(body, "Sarah Chen") || !strings.Contains(body, "acme.example") {
		t.Fatalf("anchor did not carry the name and domain: %s", body)
	}
	if strings.Contains(body, "sarah@acme.example") {
		t.Fatalf("the email address itself was sent to the vendor: %s", body)
	}
}

// --- end to end --------------------------------------------------------------

func TestEnrichPersonWritesCitedAttributesAndProjects(t *testing.T) {
	vendor := &vendorStub{
		content: map[string]any{
			researchMatchField: "high",
			"title":            "VP Engineering",
			"seniority":        "vp",
			"location":         "Berlin, Germany",
		},
		basis: []map[string]any{
			citedBasis("title", "high"),
			citedBasis("seniority", "high"),
			citedBasis("location", "medium"),
		},
	}
	rf := newResearchFixture(t, vendor)

	outcome, err := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID)
	if err != nil {
		t.Fatalf("EnrichPerson: %v", err)
	}
	if !outcome.Matched || outcome.Written != 3 {
		t.Fatalf("outcome = %+v", outcome)
	}

	rows := rf.attributes(t)
	if len(rows) != 3 {
		t.Fatalf("wrote %d attributes, want 3", len(rows))
	}
	for _, row := range rows {
		if row.CitationsJSON == "" {
			t.Fatalf("attribute %s stored with no citation", row.Dimension)
		}
		if row.ExtractorVersion == "unknown-v1" {
			t.Fatalf("attribute %s did not record the task-spec version", row.Dimension)
		}
	}

	refreshed, err := rf.client.Person.Get(rf.ctx, rf.person.ID)
	if err != nil {
		t.Fatalf("reload person: %v", err)
	}
	if refreshed.Seniority != "vp" || refreshed.Location != "Berlin, Germany" {
		t.Fatalf("research did not project: seniority=%q location=%q", refreshed.Seniority, refreshed.Location)
	}
}

// The ladder: a user correction beats research for the same dimension, and
// research beats an ai_inference.
func TestUserCorrectionBeatsExternalResearch(t *testing.T) {
	vendor := &vendorStub{
		content: map[string]any{researchMatchField: "high", "title": "VP Engineering"},
		basis:   []map[string]any{citedBasis("title", "high")},
	}
	rf := newResearchFixture(t, vendor)

	if _, err := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID); err != nil {
		t.Fatalf("EnrichPerson: %v", err)
	}
	refreshed, err := rf.client.Person.Get(rf.ctx, rf.person.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if refreshed.Title != "VP Engineering" {
		t.Fatalf("research title did not project: %q", refreshed.Title)
	}

	if _, err := rf.svc.CorrectPerson(rf.ctx, rf.user, rf.person.ID, PersonCorrectionInput{
		Dimension: "title", Value: "Head of Platform", Reason: "she told me",
	}); err != nil {
		t.Fatalf("correct person: %v", err)
	}
	corrected, err := rf.client.Person.Get(rf.ctx, rf.person.ID)
	if err != nil {
		t.Fatalf("reload after correction: %v", err)
	}
	if corrected.Title != "Head of Platform" {
		t.Fatalf("a user correction lost to a vendor: title = %q", corrected.Title)
	}
}

func TestAssertionPriorityLadder(t *testing.T) {
	ladder := []string{"user_correction", "source_fact", "deterministic", "external_research", "ai_inference"}
	for i := 0; i < len(ladder)-1; i++ {
		if assertionPriority(ladder[i]) <= assertionPriority(ladder[i+1]) {
			t.Fatalf("%s must outrank %s", ladder[i], ladder[i+1])
		}
	}
	// A tier name that does not match a validator falls to the default, which
	// must be the weakest rank and never a mid-ladder one.
	if assertionPriority("deterministic_rule") != assertionPriority("ai_inference") {
		t.Fatal("an unknown tier must rank as the weakest thing in the system")
	}
}

// --- cost --------------------------------------------------------------------

func TestResearchReservesBeforeCallingAndRefundsOnFailure(t *testing.T) {
	vendor := &vendorStub{httpStatus: http.StatusBadGateway}
	rf := newResearchFixture(t, vendor)

	if _, err := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID); err == nil {
		t.Fatal("a failing vendor call must surface an error")
	}
	if spent := creditsSpent(t, rf.fixture); spent != 0 {
		t.Fatalf("a failed run cost %d credits; failed runs are not billed", spent)
	}
}

func TestResearchSettlesOnceAndReplaysForFree(t *testing.T) {
	vendor := &vendorStub{
		content: map[string]any{researchMatchField: "high", "title": "VP Engineering"},
		basis:   []map[string]any{citedBasis("title", "high")},
	}
	rf := newResearchFixture(t, vendor)

	if _, err := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID); err != nil {
		t.Fatalf("first enrich: %v", err)
	}
	if spent := creditsSpent(t, rf.fixture); spent != 100 {
		t.Fatalf("first enrich spent %d credits, want 100", spent)
	}

	// Re-running the same person at the same task-spec version is idempotent:
	// no second vendor call, no second charge.
	second, err := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID)
	if err != nil {
		t.Fatalf("second enrich: %v", err)
	}
	if !second.Replayed {
		t.Fatal("a repeat enrichment was not reported as a replay")
	}
	if vendor.runs != 1 {
		t.Fatalf("vendor was called %d times for one person", vendor.runs)
	}
	if spent := creditsSpent(t, rf.fixture); spent != 100 {
		t.Fatalf("a replay changed the bill to %d credits", spent)
	}
}

// A vendor that runs and honestly reports "I could not identify this person"
// still bills us, so it still settles. Refunding silence would make the cheapest
// possible answer the one we reward.
func TestUnmatchedResearchStillSettles(t *testing.T) {
	vendor := &vendorStub{content: map[string]any{researchMatchField: "low"}}
	rf := newResearchFixture(t, vendor)

	outcome, err := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID)
	if err != nil {
		t.Fatalf("EnrichPerson: %v", err)
	}
	if outcome.Matched || outcome.Written != 0 {
		t.Fatalf("outcome = %+v", outcome)
	}
	if len(rf.attributes(t)) != 0 {
		t.Fatal("an unmatched result wrote attributes")
	}
	if spent := creditsSpent(t, rf.fixture); spent != 100 {
		t.Fatalf("unmatched run spent %d credits, want 100", spent)
	}
}

func TestEstimateBeforeBulkRun(t *testing.T) {
	vendor := &vendorStub{
		content: map[string]any{researchMatchField: "high", "title": "VP Engineering"},
		basis:   []map[string]any{citedBasis("title", "high")},
	}
	rf := newResearchFixture(t, vendor)

	estimate, err := rf.svc.EstimatePersonEnrichment(rf.ctx, rf.user)
	if err != nil {
		t.Fatalf("estimate: %v", err)
	}
	if estimate.People != 1 || estimate.Credits != 100 {
		t.Fatalf("estimate = %+v", estimate)
	}
	if estimate.USD != 0.01 {
		t.Fatalf("estimate priced %v USD for one base task, want 0.01", estimate.USD)
	}

	if _, err := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID); err != nil {
		t.Fatalf("enrich: %v", err)
	}
	after, err := rf.svc.EstimatePersonEnrichment(rf.ctx, rf.user)
	if err != nil {
		t.Fatalf("estimate after: %v", err)
	}
	// Already enriched at this task-spec version: a second bulk run must not
	// offer to charge for the same five fields again.
	if after.People != 0 || after.Credits != 0 {
		t.Fatalf("estimate after enrichment = %+v", after)
	}
}

func TestEnrichPersonsRejectsOversizedBatch(t *testing.T) {
	rf := newResearchFixture(t, &vendorStub{})
	ids := make([]uuid.UUID, maxResearchBatch+1)
	if _, err := rf.svc.EnrichPersons(rf.ctx, rf.user, ids); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("oversized batch: want ErrInvalidInput, got %v", err)
	}
}

// --- the gate, asserted server-side ------------------------------------------

// The client does not get a vote. Each gate is closed in turn and the vendor
// must stay untouched.
func TestResearchGatesAreEnforcedServerSide(t *testing.T) {
	t.Run("consent off", func(t *testing.T) {
		vendor := &vendorStub{}
		rf := newResearchFixture(t, vendor)
		if _, err := rf.svc.SetCloudResearchConsent(rf.ctx, rf.user, false); err != nil {
			t.Fatalf("revoke consent: %v", err)
		}
		_, err := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID)
		if !errors.Is(err, ErrResearchConsentRequired) {
			t.Fatalf("want ErrResearchConsentRequired, got %v", err)
		}
		if vendor.runs != 0 {
			t.Fatal("a counterparty reached the vendor without consent")
		}
	})

	t.Run("wrong plan", func(t *testing.T) {
		vendor := &vendorStub{}
		rf := newResearchFixture(t, vendor)
		rf.client.Subscription.Delete().ExecX(rf.ctx)
		grantSub(t, rf.fixture, "pro", "active")
		_, err := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID)
		if !errors.Is(err, ErrResearchPlanRequired) {
			t.Fatalf("want ErrResearchPlanRequired, got %v", err)
		}
		if vendor.runs != 0 {
			t.Fatal("an under-plan caller reached the vendor")
		}
	})

	t.Run("capability killed", func(t *testing.T) {
		vendor := &vendorStub{}
		rf := newResearchFixture(t, vendor)
		if _, err := rf.svc.SetWorkspaceFeatureControl(
			rf.ctx, rf.user, CapabilityCloudResearch, false, "beta", "vendor_incident",
		); err != nil {
			t.Fatalf("kill switch: %v", err)
		}
		_, err := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID)
		if !errors.Is(err, ErrCapabilityDisabled) {
			t.Fatalf("want ErrCapabilityDisabled, got %v", err)
		}
		if vendor.runs != 0 {
			t.Fatal("the kill switch did not stop the vendor call")
		}
	})

	t.Run("no vendor configured", func(t *testing.T) {
		f := newFixture(t)
		enableCloudResearch(t, f)
		if _, err := f.svc.SetCloudResearchConsent(f.ctx, f.user, true); err != nil {
			t.Fatalf("grant consent: %v", err)
		}
		grantSub(t, f, ResearchPlan, "active")
		p := seedResearchPerson(t, f)
		if _, err := f.svc.EnrichPerson(f.ctx, f.user, p.ID); !errors.Is(err, ErrResearchUnavailable) {
			t.Fatalf("want ErrResearchUnavailable, got %v", err)
		}
	})
}

// A replay must report what is stored, not that money changed hands. An earlier
// run that honestly could not identify the person also leaves a terminal ledger
// row, and reporting it as a match would make a bulk run claim enrichment that
// never happened.
func TestReplayReportsWhatIsStoredNotThatItWasPaidFor(t *testing.T) {
	vendor := &vendorStub{content: map[string]any{researchMatchField: "low"}}
	rf := newResearchFixture(t, vendor)

	first, err := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID)
	if err != nil {
		t.Fatalf("first enrich: %v", err)
	}
	if first.Matched {
		t.Fatal("a low-confidence identity match was reported as matched")
	}

	second, err := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID)
	if err != nil {
		t.Fatalf("second enrich: %v", err)
	}
	if !second.Replayed {
		t.Fatal("the second call was not reported as a replay")
	}
	if second.Matched || second.Written != 0 {
		t.Fatalf("replay claimed an enrichment that never happened: %+v", second)
	}
	if vendor.runs != 1 {
		t.Fatalf("vendor was called %d times", vendor.runs)
	}
}

// The whole promise of this tier is that an enriched fact carries a link you can
// click. Storing the citation and never serving it would ship the cost without
// the capability — the exact failure this codebase has been bitten by before.
func TestCitationsReachTheClient(t *testing.T) {
	vendor := &vendorStub{
		content: map[string]any{researchMatchField: "high", "title": "VP Engineering"},
		basis:   []map[string]any{citedBasis("title", "high")},
	}
	rf := newResearchFixture(t, vendor)

	if _, err := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID); err != nil {
		t.Fatalf("EnrichPerson: %v", err)
	}
	rows := rf.attributes(t)
	if len(rows) != 1 {
		t.Fatalf("expected 1 research attribute, got %d", len(rows))
	}

	dto := personAttributeToDTO(rows[0])
	if len(dto.Citations) != 1 {
		t.Fatalf("the attribute DTO carried no citation: %+v", dto)
	}
	if dto.Citations[0].URL != "https://acme.example/team" {
		t.Fatalf("citation url = %q", dto.Citations[0].URL)
	}
	if len(dto.Citations[0].Excerpts) != 1 {
		t.Fatalf("citation carried no excerpt: %+v", dto.Citations[0])
	}

	// An owned-data attribute has nothing to cite and must not grow an empty
	// array in the payload.
	owned := personAttributeToDTO(&ent.PersonAttribute{SourceType: "source_fact"})
	if owned.Citations != nil {
		t.Fatalf("owned-data attribute carried citations: %+v", owned.Citations)
	}
}

// Everything the vendor returns is attacker-adjacent: the task input carries a
// display name parsed from an email signature, which whoever sent the mail
// controls. A response is capped at 8MB by the outbound policy, and without a
// per-field bound that whole budget lands in one cell.
func TestImplausiblyLongVendorValuesAreRefused(t *testing.T) {
	long := strings.Repeat("x", maxVendorValueRunes+1)
	result := &parallel.TaskResult{
		Content: map[string]any{
			researchMatchField: "high",
			"location":         long,
			"title":            "VP Engineering",
		},
		Basis: []parallel.Basis{
			{Field: "location", Confidence: "high",
				Citations: []parallel.Citation{{URL: "https://acme.example/team"}}},
			{Field: "title", Confidence: "high",
				Citations: []parallel.Citation{{URL: "https://acme.example/team"}}},
		},
	}

	inputs, matched, rejected := personAttributesFromResult(result, "v1", time.Now().UTC())
	if !matched {
		t.Fatal("one bad field must not discard a good identity match")
	}
	if len(inputs) != 1 || inputs[0].Dimension != "title" {
		t.Fatalf("expected only the sane field to survive, got %+v", inputs)
	}
	// Refused, not truncated: a truncated value is a claim nobody made.
	if len(rejected) != 1 || !strings.Contains(rejected[0], "location") {
		t.Fatalf("rejections = %v", rejected)
	}
}

// --- the billing key -----------------------------------------------------

// The task-spec version is half the idempotency key for every research charge.
// If it were not stable across processes and builds, two replicas would compute
// different keys for the same person and bill twice — and a restart would
// re-bill an entire workspace.
//
// It hashes a marshalled map, which is safe only because encoding/json sorts map
// keys. This test pins the value so that property cannot regress silently, and
// so that CHANGING the question is a deliberate act: if you edited the schema or
// the processor on purpose, update the constant and understand that every person
// becomes billable again.
func TestTaskSpecVersionsArePinned(t *testing.T) {
	const (
		wantPerson  = "parallel/base@1bea8549f33c"
		wantTrigger = "parallel/lite@596b6305"
	)

	if got := personTaskSpecVersion(); got != wantPerson {
		t.Fatalf("person task-spec version changed: got %q, want %q.\n"+
			"Every already-enriched person becomes billable again at the new version. "+
			"If that is intended, update the constant.", got, wantPerson)
	}

	day := time.Date(2026, 8, 6, 0, 0, 0, 0, time.UTC)
	if got := triggerTaskSpecVersion(day); got != wantTrigger+":2026-08-06" {
		t.Fatalf("trigger task-spec version changed: got %q, want %q", got, wantTrigger+":2026-08-06")
	}

	// Stable across calls within a process, which is what the map-ordering
	// concern is actually about.
	for i := 0; i < 50; i++ {
		if personTaskSpecVersion() != wantPerson {
			t.Fatal("person task-spec version is not stable across calls")
		}
		if triggerTaskSpecVersion(day) != wantTrigger+":2026-08-06" {
			t.Fatal("trigger task-spec version is not stable across calls")
		}
	}
}

// The trigger key rolls at UTC midnight and nowhere else. A key that rolled on
// local time would bill an account twice on a DST boundary; one that did not
// roll at all would never re-poll.
func TestTriggerKeyRollsOncePerUTCDay(t *testing.T) {
	day := time.Date(2026, 8, 6, 0, 0, 0, 0, time.UTC)
	sameDay := []time.Time{
		day,
		day.Add(23*time.Hour + 59*time.Minute + 59*time.Second),
		// Same instant expressed in another zone must produce the same key:
		// otherwise two replicas in different zones bill the same account twice.
		day.Add(12 * time.Hour).In(time.FixedZone("UTC+9", 9*3600)),
	}
	first := triggerTaskSpecVersion(sameDay[0])
	for _, at := range sameDay[1:] {
		if got := triggerTaskSpecVersion(at); got != first {
			t.Fatalf("key changed within one UTC day: %q vs %q at %s", got, first, at)
		}
	}
	if next := triggerTaskSpecVersion(day.Add(24 * time.Hour)); next == first {
		t.Fatal("the key did not roll at the next UTC day; accounts would never be re-polled")
	}
	// A month boundary is not special.
	monthEnd := time.Date(2026, 8, 31, 23, 0, 0, 0, time.UTC)
	if triggerTaskSpecVersion(monthEnd) == triggerTaskSpecVersion(monthEnd.Add(2*time.Hour)) {
		t.Fatal("the key did not roll across a month boundary")
	}
}

// --- degenerate vendor responses ---------------------------------------------

// The mapper is the trust boundary. A vendor that is broken, adversarial, or
// merely sloppy must produce silence, never a wrong claim about a real person.
func TestDegenerateVendorResponses(t *testing.T) {
	now := time.Now().UTC()
	cited := []parallel.Citation{{URL: "https://acme.example/team"}}

	cases := []struct {
		name    string
		result  *parallel.TaskResult
		matched bool
		written int
	}{
		{
			name:   "nil result",
			result: nil,
		},
		{
			name:   "empty everything",
			result: &parallel.TaskResult{},
		},
		{
			name: "nil content map",
			result: &parallel.TaskResult{
				Content: nil,
				Basis:   []parallel.Basis{{Field: "title", Citations: cited}},
			},
		},
		{
			// A basis for a field the content never mentioned is not a fact; it
			// is evidence for nothing.
			name: "basis without content",
			result: &parallel.TaskResult{
				Content: map[string]any{researchMatchField: "high"},
				Basis:   []parallel.Basis{{Field: "title", Confidence: "high", Citations: cited}},
			},
			matched: true,
		},
		{
			// Non-string types must not be coerced. A title of 42 is not "42".
			name: "wrong types",
			result: &parallel.TaskResult{
				Content: map[string]any{researchMatchField: "high", "title": 42, "org_name": true},
				Basis: []parallel.Basis{
					{Field: "title", Confidence: "high", Citations: cited},
					{Field: "org_name", Confidence: "high", Citations: cited},
				},
			},
			matched: true,
		},
		{
			// The match field itself arriving as a non-string must fail closed.
			name: "match confidence is not a string",
			result: &parallel.TaskResult{
				Content: map[string]any{researchMatchField: 1, "title": "VP Engineering"},
				Basis:   []parallel.Basis{{Field: "title", Confidence: "high", Citations: cited}},
			},
		},
		{
			// Duplicate basis entries: the first wins, and nothing is written
			// twice for one dimension.
			name: "duplicate basis for one field",
			result: &parallel.TaskResult{
				Content: map[string]any{researchMatchField: "high", "title": "VP Engineering"},
				Basis: []parallel.Basis{
					{Field: "title", Confidence: "high", Citations: cited},
					{Field: "title", Confidence: "low", Citations: cited},
				},
			},
			matched: true,
			written: 1,
		},
		{
			// A field the task never asked for has nowhere to go.
			name: "unrequested field",
			result: &parallel.TaskResult{
				Content: map[string]any{researchMatchField: "high", "salary": "200000"},
				Basis:   []parallel.Basis{{Field: "salary", Confidence: "high", Citations: cited}},
			},
			matched: true,
		},
		{
			// Citation schemes that are not web pages are not citations.
			name: "non-http citation schemes",
			result: &parallel.TaskResult{
				Content: map[string]any{researchMatchField: "high", "title": "VP Engineering"},
				Basis: []parallel.Basis{{Field: "title", Confidence: "high", Citations: []parallel.Citation{
					{URL: "javascript:alert(1)"},
					{URL: "file:///etc/passwd"},
					{URL: "data:text/html,<script>"},
					{URL: "ftp://acme.example/x"},
				}}},
			},
			matched: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			inputs, matched, _ := personAttributesFromResult(tc.result, "v1", now)
			if matched != tc.matched {
				t.Fatalf("matched = %v, want %v", matched, tc.matched)
			}
			if len(inputs) != tc.written {
				t.Fatalf("wrote %d attributes, want %d: %+v", len(inputs), tc.written, inputs)
			}
			for _, in := range inputs {
				if strings.TrimSpace(in.CitationsJSON) == "" {
					t.Fatalf("%s stored with no citation", in.Dimension)
				}
			}
		})
	}
}

// A citation URL carrying credentials must not be stored and handed to a user to
// click.
func TestCitationCredentialsAreNotStored(t *testing.T) {
	result := &parallel.TaskResult{
		Content: map[string]any{researchMatchField: "high", "title": "VP Engineering"},
		Basis: []parallel.Basis{{Field: "title", Confidence: "high", Citations: []parallel.Citation{
			{URL: "https://user:secret@acme.example/team"},
			{URL: "https://acme.example/team"},
		}}},
	}
	inputs, _, _ := personAttributesFromResult(result, "v1", time.Now().UTC())
	if len(inputs) != 1 {
		t.Fatalf("expected the title to survive on its clean citation: %+v", inputs)
	}
	if strings.Contains(inputs[0].CitationsJSON, "secret") {
		t.Fatalf("a credential-bearing URL was stored: %s", inputs[0].CitationsJSON)
	}
}

// The spoofing case, which is the sharper half of the credential rule: the
// trigger surface prints a citation URL verbatim into the sentence a user is
// told to trust, so a userinfo-bearing URL reads as one host and resolves to
// another.
func TestSpoofedCitationHostIsRefused(t *testing.T) {
	result := &parallel.TaskResult{
		Content: map[string]any{researchMatchField: "high", "title": "VP Engineering"},
		Basis: []parallel.Basis{{Field: "title", Confidence: "high", Citations: []parallel.Citation{
			{URL: "https://acme.example@evil.example/press"},
		}}},
	}
	inputs, matched, rejected := personAttributesFromResult(result, "v1", time.Now().UTC())
	if !matched {
		t.Fatal("the identity match was fine; only the citation was hostile")
	}
	if len(inputs) != 0 {
		t.Fatalf("a spoofed citation host was accepted: %+v", inputs)
	}
	if len(rejected) != 1 {
		t.Fatalf("rejections = %v", rejected)
	}
}
