package revenue

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/hubspotapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slackclient"
)

const (
	googleBackfillDays     = 90
	googleBackfillThreads  = 100
	hubSpotBackfillRecords = 500
	slackBackfillChannels  = 50
	slackBackfillMessages  = 500
)

type googleSourceBackfiller struct {
	sweeper ThreadSweeper
	now     func() time.Time
}

// NewGoogleSourceBackfiller creates a 90-day, sent-anchored Gmail evidence
// backfill that uses the existing sealed Google connection.
func NewGoogleSourceBackfiller(sweeper ThreadSweeper) SourceBackfillProvider {
	return &googleSourceBackfiller{sweeper: sweeper, now: time.Now}
}

func (b *googleSourceBackfiller) Backfill(
	ctx context.Context,
	u *ent.User,
	sourceAccountID string,
	emit func(SourceBackfillBatch) error,
) error {
	if b == nil || b.sweeper == nil {
		return fmt.Errorf("google backfill provider is not configured")
	}
	threads, selfEmail, err := b.sweeper.SweepThreads(
		ctx, u.ID, googleBackfillDays, googleBackfillThreads, nil,
	)
	if err != nil {
		return err
	}
	observations := make([]RelationshipObservationInput, 0, len(threads))
	latest := time.Time{}
	for _, messages := range threads {
		summary := summarizeThread(selfEmail, messages)
		if summary == nil || strings.TrimSpace(summary.ThreadID) == "" {
			continue
		}
		last := latestGmailMessage(messages)
		occurredAt := summary.LastAt.UTC()
		if occurredAt.After(latest) {
			latest = occurredAt
		}
		version := occurredAt.Format(time.RFC3339Nano)
		if last.ID != "" {
			version = last.ID + ":" + version
		}
		payload := map[string]any{
			"threadId": summary.ThreadID, "subject": summary.Subject,
			"lastMessageId": last.ID, "lastOutbound": summary.LastOutbound,
			"outboundCount": summary.OutboundCount, "inboundCount": summary.InboundCount,
		}
		observation, adaptErr := AdaptGmailEvent(AdapterEvent{
			ExternalID: summary.ThreadID, SourceAccountID: sourceAccountID,
			AccountName:  coalesce(summary.CounterpartyName, summary.Counterparty),
			PrimaryEmail: summary.Counterparty,
			ResourceRefs: []string{"gmail:thread:" + summary.ThreadID},
			EventType:    "thread.snapshot", OccurredAt: occurredAt,
			Summary:      "Gmail thread observed: " + strings.TrimSpace(summary.Subject),
			Payload:      payload,
			Participants: summary.Counterparties,
			Facts:        payload,
		})
		if adaptErr != nil {
			return adaptErr
		}
		observation.SourceVersion = version
		observation.ReceivedAt = b.now().UTC()
		observations = append(observations, observation)
	}
	return emitObservationBatches(observations, latest.Format(time.RFC3339Nano), emit)
}

func latestGmailMessage(messages []googleapi.GmailThreadMessage) googleapi.GmailThreadMessage {
	var latest googleapi.GmailThreadMessage
	for _, message := range messages {
		if latest.At.IsZero() || message.At.After(latest.At) {
			latest = message
		}
	}
	return latest
}

type hubSpotSourceBackfiller struct {
	client *hubspotapi.Client
	now    func() time.Time
}

// NewHubSpotSourceBackfiller creates a bounded company-snapshot evidence
// backfill using the tenant's existing HubSpot connection.
func NewHubSpotSourceBackfiller(client *hubspotapi.Client) SourceBackfillProvider {
	return &hubSpotSourceBackfiller{client: client, now: time.Now}
}

func (b *hubSpotSourceBackfiller) Backfill(
	ctx context.Context,
	u *ent.User,
	sourceAccountID string,
	emit func(SourceBackfillBatch) error,
) error {
	if b == nil || b.client == nil {
		return fmt.Errorf("hubspot backfill provider is not configured")
	}
	companies, err := b.client.ListCompanies(ctx, u.ID, hubSpotBackfillRecords)
	if err != nil {
		return err
	}
	cutoff := b.now().UTC().Add(-365 * 24 * time.Hour)
	observations := make([]RelationshipObservationInput, 0, len(companies))
	latest := time.Time{}
	for _, company := range companies {
		if strings.TrimSpace(company.ID) == "" || (!company.UpdatedAt.IsZero() && company.UpdatedAt.Before(cutoff)) {
			continue
		}
		occurredAt := company.UpdatedAt.UTC()
		if occurredAt.IsZero() {
			occurredAt = company.CreatedAt.UTC()
		}
		if occurredAt.IsZero() {
			occurredAt = b.now().UTC()
		}
		if occurredAt.After(latest) {
			latest = occurredAt
		}
		name := strings.TrimSpace(company.Properties["name"])
		if name == "" {
			name = "HubSpot company " + company.ID
		}
		facts := map[string]any{
			"company_id":       company.ID,
			"industry":         company.Properties["industry"],
			"lifecycle_stage":  company.Properties["lifecyclestage"],
			"last_modified_at": occurredAt.Format(time.RFC3339Nano),
		}
		assertions := []RelationshipAssertionInput{}
		if lifecycle := hubSpotLifecycle(company.Properties["lifecyclestage"]); lifecycle != "" {
			assertions = append(assertions, RelationshipAssertionInput{
				Dimension: "lifecycle", Value: lifecycle, SourceType: "source_fact",
				Confidence: 1, Reason: "HubSpot company lifecycle stage.", ValidFrom: occurredAt,
			})
		}
		observation, adaptErr := AdaptHubSpotEvent(AdapterEvent{
			ExternalID: company.ID, SourceAccountID: sourceAccountID,
			AccountName: name, AccountDomain: company.Properties["domain"],
			ResourceRefs: []string{"hubspot:company:" + company.ID},
			EventType:    "company.snapshot", OccurredAt: occurredAt,
			Summary: "HubSpot company snapshot: " + name,
			Payload: company.Properties, Facts: facts, Assertions: assertions,
		})
		if adaptErr != nil {
			return adaptErr
		}
		observation.SourceVersion = occurredAt.Format(time.RFC3339Nano)
		observation.ReceivedAt = b.now().UTC()
		observations = append(observations, observation)
	}
	return emitObservationBatches(observations, latest.Format(time.RFC3339Nano), emit)
}

func hubSpotLifecycle(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "subscriber", "lead", "marketingqualifiedlead", "salesqualifiedlead", "opportunity", "other":
		return "evaluation"
	case "customer", "evangelist":
		return "active_customer"
	case "former_customer":
		return "former_customer"
	default:
		return ""
	}
}

type slackTeamTokenResolver interface {
	ResolveTeam(ctx context.Context, userID, teamID string) (string, error)
}

type slackSourceBackfiller struct {
	tokens slackTeamTokenResolver
	client *slackclient.Client
	now    func() time.Time
}

// NewSlackSourceBackfiller creates a bounded public-channel history backfill
// without inventing account identity beyond provider resource references.
func NewSlackSourceBackfiller(
	tokens slackTeamTokenResolver,
	client *slackclient.Client,
) SourceBackfillProvider {
	return &slackSourceBackfiller{tokens: tokens, client: client, now: time.Now}
}

func (b *slackSourceBackfiller) Backfill(
	ctx context.Context,
	u *ent.User,
	sourceAccountID string,
	emit func(SourceBackfillBatch) error,
) error {
	if b == nil || b.tokens == nil || b.client == nil {
		return fmt.Errorf("slack backfill provider is not configured")
	}
	token, err := b.tokens.ResolveTeam(ctx, u.ID.String(), sourceAccountID)
	if err != nil {
		return err
	}
	channels, err := b.client.ListChannels(ctx, token, slackBackfillChannels)
	if err != nil {
		return err
	}
	oldest := b.now().UTC().Add(-365 * 24 * time.Hour)
	observations := make([]RelationshipObservationInput, 0, slackBackfillMessages)
	latest := time.Time{}
	for _, channel := range channels {
		if len(observations) >= slackBackfillMessages {
			break
		}
		if !channel.IsMember {
			continue
		}
		remaining := slackBackfillMessages - len(observations)
		messages, readErr := b.client.ReadChannelHistory(ctx, token, channel.ID, oldest, min(remaining, 100))
		if readErr != nil {
			return readErr
		}
		for _, message := range messages {
			occurredAt, parseErr := slackTimestamp(message.TS)
			if parseErr != nil || strings.TrimSpace(message.TS) == "" {
				continue
			}
			if occurredAt.After(latest) {
				latest = occurredAt
			}
			name := strings.TrimSpace(channel.Name)
			if name == "" {
				name = "Slack channel " + channel.ID
			}
			facts := map[string]any{
				"channel_id": channel.ID, "channel_name": channel.Name,
				"message_ts": message.TS, "thread_ts": message.ThreadTS,
				"author_ref": message.User,
			}
			observation, adaptErr := AdaptSlackEvent(AdapterEvent{
				ExternalID: channel.ID + ":" + message.TS, SourceAccountID: sourceAccountID,
				AccountName: name, ResourceRefs: []string{"slack:channel:" + channel.ID},
				EventType: "message.snapshot", OccurredAt: occurredAt,
				Summary: "Slack message observed in #" + name,
				Payload: map[string]any{"text": message.Text, "message": facts}, Facts: facts,
				Participants: []RelationshipParticipantInput{{
					DisplayName: coalesce(message.User, "Slack participant"), Role: "contact",
				}},
			})
			if adaptErr != nil {
				return adaptErr
			}
			version := message.Edited.TS
			if strings.TrimSpace(version) == "" {
				version = message.TS
			}
			observation.SourceVersion = version
			observation.ReceivedAt = b.now().UTC()
			observations = append(observations, observation)
		}
	}
	return emitObservationBatches(observations, latest.Format(time.RFC3339Nano), emit)
}

func slackTimestamp(value string) (time.Time, error) {
	seconds, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil {
		return time.Time{}, err
	}
	whole := int64(seconds)
	nanos := int64((seconds - float64(whole)) * float64(time.Second))
	return time.Unix(whole, nanos).UTC(), nil
}

func emitObservationBatches(
	observations []RelationshipObservationInput,
	watermark string,
	emit func(SourceBackfillBatch) error,
) error {
	total := len(observations)
	for start := 0; start < total; start += 100 {
		end := min(start+100, total)
		if err := emit(SourceBackfillBatch{
			Observations: observations[start:end], Completed: end, Total: total, Watermark: watermark,
		}); err != nil {
			return err
		}
	}
	return nil
}
