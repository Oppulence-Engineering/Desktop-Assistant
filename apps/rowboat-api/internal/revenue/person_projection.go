package revenue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personattribute"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personinteractionstat"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
)

// Person enrichment projection.
//
// projectPersonAttributes is the person analogue of projectRelationshipStateAt: a
// pure function of the attribute set at an evaluation boundary, idempotent,
// hash-guarded, and the only writer of the materialized columns on Person.
//
// Winners are chosen by the SAME precedence ladder the relationship projector uses —
// assertionPriority, then valid_from, then confidence, then id — so "why does it say
// she works at Acme?" has one answer everywhere in the system.

const personProjectorVersion = 2

/** Dimensions that accumulate every active value. */
var personMultiValuedDimensions = [...]string{"alias", "handle"}

/** Titles longer than this are signature-block false positives, not job titles. */
const maxPersonTitleRunes = 128

// PersonAttributeInput is one derived claim about a person.
type PersonAttributeInput struct {
	Dimension  string
	Value      string
	SourceType string
	Source     string
	Extractor  string
	Confidence float64
	Reason     string
	ObservedAt time.Time
	ExternalID string
}

// personAttributeDedupeKey makes replay free.
func personAttributeDedupeKey(personID, dimension, value, source, externalID string) string {
	sum := sha256.Sum256([]byte(strings.Join(
		[]string{personID, dimension, strings.ToLower(strings.TrimSpace(value)), source, externalID},
		"\x00",
	)))
	return hex.EncodeToString(sum[:])
}

// acceptPersonAttribute rejects values before they ever become assertions.
//
// Cheap guards here are worth more than clever resolution later: once a bad value is
// an assertion it competes on the ladder and has to be beaten rather than ignored.
func acceptPersonAttribute(in PersonAttributeInput, email string) bool {
	value := strings.TrimSpace(in.Value)
	if value == "" {
		return false
	}
	switch in.Dimension {
	case "title":
		if len([]rune(value)) > maxPersonTitleRunes {
			return false
		}
	case "org_name":
		// A signature line that merely repeats the mailbox name is not a company.
		if local := emailLocalPart(email); local != "" && strings.EqualFold(local, value) {
			return false
		}
	case "org_domain":
		// Held to the same standard as an account anchor.
		if accountDomain("x@"+value) == "" {
			return false
		}
	case "display_name":
		// The address is a fallback, not evidence — unless it is all we have, in
		// which case the caller sends it at low confidence with an explicit extractor.
		if strings.EqualFold(value, email) && in.Extractor != "email_header" {
			return false
		}
	case "employment_status":
		// Only the two values the projection understands, and only from a mail
		// system's own report. An LLM guessing that someone left from the tone of
		// a thread is exactly the assertion this dimension must not accept —
		// retiring a live contact is worse than never reading the bounce.
		if value != "active" && value != "departed" {
			return false
		}
		if in.Extractor != "mail_delivery_report" && in.Extractor != "user_entry" {
			return false
		}
	}
	return true
}

// upsertPersonAttributes appends derived claims. Never overwrites: a new observation
// is a new assertion with its own valid_from, so history stays queryable.
func upsertPersonAttributes(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	p *ent.Person,
	observation *ent.RelationshipObservation,
	inputs []PersonAttributeInput,
) error {
	for _, in := range inputs {
		if !acceptPersonAttribute(in, p.PrimaryEmail) {
			continue
		}
		observedAt := in.ObservedAt
		if observedAt.IsZero() {
			observedAt = time.Now().UTC()
		}
		externalID := in.ExternalID
		if externalID == "" && observation != nil {
			externalID = observation.ExternalID
		}
		dedupe := personAttributeDedupeKey(p.ID.String(), in.Dimension, in.Value, in.Source, externalID)

		exists, err := client.PersonAttribute.Query().
			Where(
				personattribute.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
				personattribute.DedupeKeyEQ(dedupe),
			).Exist(ctx)
		if err != nil {
			return err
		}
		if exists {
			continue
		}

		sourceType := in.SourceType
		if sourceType == "" {
			sourceType = "deterministic"
		}
		extractor := in.Extractor
		if extractor == "" {
			extractor = "unknown"
		}
		create := client.PersonAttribute.Create().
			SetWorkspace(ws).
			SetPerson(p).
			SetUser(u).
			SetDimension(in.Dimension).
			SetValue(strings.TrimSpace(in.Value)).
			SetSourceType(sourceType).
			SetSource(in.Source).
			SetExtractor(extractor).
			SetConfidence(in.Confidence).
			SetObservedAt(observedAt.UTC()).
			SetValidFrom(observedAt.UTC()).
			SetDedupeKey(dedupe)
		if in.Reason != "" {
			create.SetReason(in.Reason)
		}
		if observation != nil {
			create.SetObservation(observation).
				SetSupportingObservationIds([]string{observation.ID.String()})
		}
		if err := create.Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

// selectPersonAttributesAt picks the winning attribute per single-valued dimension,
// and every active value for multi-valued ones, using the shared ladder.
func selectPersonAttributesAt(
	attributes []*ent.PersonAttribute,
	evaluatedAt time.Time,
) (map[string]*ent.PersonAttribute, map[string][]string) {
	superseded := map[string]struct{}{}
	eligible := make([]*ent.PersonAttribute, 0, len(attributes))
	for _, attribute := range attributes {
		if attribute.Status != "active" || attribute.ValidFrom.After(evaluatedAt) ||
			(attribute.ValidTo != nil && !attribute.ValidTo.After(evaluatedAt)) {
			continue
		}
		eligible = append(eligible, attribute)
		if attribute.SupersedesAttributeID != "" {
			superseded[attribute.SupersedesAttributeID] = struct{}{}
		}
	}
	sort.SliceStable(eligible, func(i, j int) bool {
		left, right := eligible[i], eligible[j]
		lp, rp := assertionPriority(left.SourceType), assertionPriority(right.SourceType)
		if lp != rp {
			return lp > rp
		}
		if !left.ValidFrom.Equal(right.ValidFrom) {
			return left.ValidFrom.After(right.ValidFrom)
		}
		if left.Confidence != right.Confidence {
			return left.Confidence > right.Confidence
		}
		return left.ID.String() > right.ID.String()
	})

	single := map[string]*ent.PersonAttribute{}
	multi := map[string][]string{}
	for _, attribute := range eligible {
		if _, gone := superseded[attribute.ID.String()]; gone {
			continue
		}
		if slicesContains(personMultiValuedDimensions[:], attribute.Dimension) {
			multi[attribute.Dimension] = append(multi[attribute.Dimension], attribute.Value)
			continue
		}
		if single[attribute.Dimension] == nil {
			single[attribute.Dimension] = attribute
		}
	}
	for key, values := range multi {
		sort.Strings(values)
		multi[key] = dedupeStrings(values)
	}
	return single, multi
}

// projectPersonAttributes materializes the winning attributes onto the person.
func projectPersonAttributes(
	ctx context.Context,
	client *ent.Client,
	p *ent.Person,
	evaluatedAt time.Time,
) (*ent.Person, error) {
	if evaluatedAt.IsZero() {
		evaluatedAt = time.Now().UTC()
	}
	attributes, err := client.PersonAttribute.Query().
		Where(personattribute.HasPersonWith(person.IDEQ(p.ID))).
		All(ctx)
	if err != nil {
		return nil, err
	}
	single, multi := selectPersonAttributesAt(attributes, evaluatedAt)

	value := func(dimension string) string {
		if attribute := single[dimension]; attribute != nil {
			return attribute.Value
		}
		return ""
	}

	displayName := value("display_name")
	if displayName == "" {
		// display_name is NotEmpty; never let a retraction blank it out.
		displayName = p.PrimaryEmail
	}
	if displayName == "" {
		displayName = p.DisplayName
	}

	orgDomain := value("org_domain")
	// A public mailbox is dropped at PROJECTION time, not at write time: the
	// assertion stays for audit, it just can never win.
	if orgDomain != "" && isPublicMailboxDomain(orgDomain) {
		orgDomain = ""
	}

	aliases := multi["alias"]
	aliases = slicesDeleteString(aliases, displayName)

	// Absent means unknown, not active: we have never had a reason to ask. Only a
	// delivery report or a user saying so moves it off that.
	employment := value("employment_status")
	if employment == "" {
		employment = "unknown"
	}

	projected := map[string]any{
		"display_name": displayName,
		"aliases":      aliases,
		"title":        value("title"),
		"org_name":     value("org_name"),
		"org_domain":   orgDomain,
		"phone":        value("phone"),
		"timezone":     value("timezone"),
		"locale":       value("locale"),
		"employment":   employment,
	}
	encoded, err := json.Marshal(projected)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(encoded)
	hash := "sha256:" + hex.EncodeToString(sum[:])

	if p.AttributesHash == hash && p.ProjectorVersion == personProjectorVersion {
		return p, nil
	}

	update := p.Update().
		SetDisplayName(displayName).
		SetAliases(aliases).
		SetTitle(value("title")).
		SetOrgName(value("org_name")).
		SetOrgDomain(orgDomain).
		SetPhone(value("phone")).
		SetTimezone(value("timezone")).
		SetLocale(value("locale")).
		SetEmploymentStatus(employment).
		SetAttributesHash(hash).
		SetAttributesVersion(p.AttributesVersion + 1).
		SetProjectorVersion(personProjectorVersion).
		SetProjectedAt(evaluatedAt.UTC())
	return update.Save(ctx)
}

// bumpPersonInteraction records one interaction between a person and an account.
//
// Direction is never guessed: an unknown direction increments the total only. A
// wrong inbound/outbound split silently corrupts every reciprocity signal built on
// top of it, and "we don't know" is a supported answer.
func bumpPersonInteraction(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	p *ent.Person,
	rel *ent.Relationship,
	channel, direction, source string,
	occurredAt time.Time,
) error {
	if occurredAt.IsZero() {
		occurredAt = time.Now().UTC()
	}
	occurredAt = occurredAt.UTC()
	if channel == "" {
		channel = channelForSource(source)
	}

	stat, err := client.PersonInteractionStat.Query().
		Where(
			personinteractionstat.HasPersonWith(person.IDEQ(p.ID)),
			personinteractionstat.HasRelationshipWith(relationship.IDEQ(rel.ID)),
		).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return err
	}

	if ent.IsNotFound(err) {
		create := client.PersonInteractionStat.Create().
			SetWorkspace(ws).
			SetPerson(p).
			SetRelationship(rel).
			SetFirstInteractionAt(occurredAt).
			SetLastInteractionAt(occurredAt).
			SetInteractionCount(1).
			SetChannelCounts(map[string]int{channel: 1}).
			SetSourceCounts(map[string]int{source: 1})
		if channel != "" {
			create.SetLastChannel(channel)
		}
		if channel == "meeting" {
			create.SetMeetingCount(1)
		}
		switch direction {
		case "inbound":
			create.SetInboundCount(1).SetLastInboundAt(occurredAt).SetLastDirection("inbound")
		case "outbound":
			create.SetOutboundCount(1).SetLastOutboundAt(occurredAt).SetLastDirection("outbound")
		case "internal":
			create.SetLastDirection("internal")
		}
		if _, err := create.Save(ctx); err != nil {
			return err
		}
		_ = u
		return refreshPersonInteractionRollup(ctx, client, p)
	}

	channels := copyCounts(stat.ChannelCounts)
	channels[channel]++
	sources := copyCounts(stat.SourceCounts)
	sources[source]++

	update := stat.Update().
		SetInteractionCount(stat.InteractionCount + 1).
		SetChannelCounts(channels).
		SetSourceCounts(sources)
	if channel != "" {
		update.SetLastChannel(channel)
	}
	if channel == "meeting" {
		update.SetMeetingCount(stat.MeetingCount + 1)
	}
	if occurredAt.Before(stat.FirstInteractionAt) {
		update.SetFirstInteractionAt(occurredAt)
	}
	if occurredAt.After(stat.LastInteractionAt) {
		update.SetLastInteractionAt(occurredAt)
	}
	switch direction {
	case "inbound":
		update.SetInboundCount(stat.InboundCount + 1).SetLastDirection("inbound")
		if stat.LastInboundAt == nil || occurredAt.After(*stat.LastInboundAt) {
			update.SetLastInboundAt(occurredAt)
		}
	case "outbound":
		update.SetOutboundCount(stat.OutboundCount + 1).SetLastDirection("outbound")
		if stat.LastOutboundAt == nil || occurredAt.After(*stat.LastOutboundAt) {
			update.SetLastOutboundAt(occurredAt)
		}
	case "internal":
		update.SetLastDirection("internal")
	}
	if _, err := update.Save(ctx); err != nil {
		return err
	}
	return refreshPersonInteractionRollup(ctx, client, p)
}

// refreshPersonInteractionRollup sums the per-pair stats onto the person.
func refreshPersonInteractionRollup(ctx context.Context, client *ent.Client, p *ent.Person) error {
	stats, err := client.PersonInteractionStat.Query().
		Where(personinteractionstat.HasPersonWith(person.IDEQ(p.ID))).
		All(ctx)
	if err != nil {
		return err
	}
	if len(stats) == 0 {
		return nil
	}
	first, last := stats[0].FirstInteractionAt, stats[0].LastInteractionAt
	for _, stat := range stats[1:] {
		if stat.FirstInteractionAt.Before(first) {
			first = stat.FirstInteractionAt
		}
		if stat.LastInteractionAt.After(last) {
			last = stat.LastInteractionAt
		}
	}
	_, err = p.Update().
		SetFirstInteractionAt(first).
		SetLastInteractionAt(last).
		SetRelationshipCount(len(stats)).
		Save(ctx)
	return err
}

// channelForSource is the fallback when a caller does not state a channel.
func channelForSource(source string) string {
	switch source {
	case "gmail":
		return "email"
	case "calendar", "meeting":
		return "meeting"
	case "slack":
		return "chat"
	case "hubspot", "crm":
		return "crm"
	case "desktop_note", "voice_note":
		return "note"
	default:
		return "email"
	}
}

func copyCounts(in map[string]int) map[string]int {
	out := make(map[string]int, len(in)+1)
	for key, value := range in {
		out[key] = value
	}
	return out
}

func dedupeStrings(in []string) []string {
	out := in[:0]
	var previous string
	for index, value := range in {
		if index > 0 && value == previous {
			continue
		}
		previous = value
		out = append(out, value)
	}
	return out
}

func slicesContains(haystack []string, needle string) bool {
	for _, value := range haystack {
		if value == needle {
			return true
		}
	}
	return false
}

func slicesDeleteString(in []string, drop string) []string {
	if drop == "" {
		return in
	}
	out := make([]string, 0, len(in))
	for _, value := range in {
		if strings.EqualFold(value, drop) {
			continue
		}
		out = append(out, value)
	}
	return out
}
