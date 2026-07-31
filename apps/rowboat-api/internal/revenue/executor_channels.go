package revenue

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	slackgo "github.com/slack-go/slack"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/hubspotapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

const scopeCalendarEvents = "https://www.googleapis.com/auth/calendar.events"

// RoutingExecutor owns the provider boundary for approved queue actions.
// Keeping routing here prevents an action's editable channel from ever being
// sent through the wrong provider credential.
type RoutingExecutor struct {
	email    Executor
	slack    Executor
	calendar Executor
	crm      Executor
}

func NewRoutingExecutor(email, slack, calendar, crm Executor) *RoutingExecutor {
	return &RoutingExecutor{email: email, slack: slack, calendar: calendar, crm: crm}
}

func (e *RoutingExecutor) Execute(ctx context.Context, req ExecRequest) (*ExecResult, error) {
	var target Executor
	switch req.Action.Channel {
	case "email":
		target = e.email
	case "slack":
		target = e.slack
	case "calendar":
		target = e.calendar
	case "crm", "crm_task", "task":
		target = e.crm
	default:
		return nil, fmt.Errorf("revenue: no execution backend for channel %q", req.Action.Channel)
	}
	if target == nil {
		return nil, fmt.Errorf("revenue: execution backend for channel %q is not configured", req.Action.Channel)
	}
	return target.Execute(ctx, req)
}

type slackCredentialResolver interface {
	Resolve(ctx context.Context, userID, provider string) (string, error)
	ResolveTeam(ctx context.Context, userID, teamID string) (string, error)
}

// SlackExecutor sends an approved queue action through a connected managed
// Slack workspace. The target is explicit and review-bound:
// slack:<team-id>:<channel-id>[:<thread-ts>].
type SlackExecutor struct {
	tokens slackCredentialResolver
	http   *outbound.Client
	apiURL string
}

func NewSlackExecutor(tokens slackCredentialResolver, policy outbound.Policy) *SlackExecutor {
	policy.Name = "slack-revenue"
	if policy.Timeout == 0 {
		policy.Timeout = 15 * time.Second
	}
	return &SlackExecutor{tokens: tokens, http: outbound.NewClient(policy), apiURL: "https://slack.com/api/"}
}

func (e *SlackExecutor) SetAPIURL(raw string) {
	if strings.TrimSpace(raw) != "" {
		e.apiURL = strings.TrimRight(strings.TrimSpace(raw), "/") + "/"
	}
}

func (e *SlackExecutor) Execute(ctx context.Context, req ExecRequest) (*ExecResult, error) {
	if req.Mode != ExecModeSend {
		return nil, errors.New("revenue: Slack has no provider draft; change execution mode to send after reviewing the action")
	}
	if strings.TrimSpace(req.Action.ProposedMessage) == "" {
		return nil, errors.New("revenue: action has no proposed message")
	}
	team, channel, thread, err := slackTarget(req.Action)
	if err != nil {
		return nil, err
	}
	var token string
	if team != "" {
		token, err = e.tokens.ResolveTeam(ctx, req.UserID.String(), team)
	} else {
		token, err = e.tokens.Resolve(ctx, req.UserID.String(), "slack")
	}
	if err != nil {
		return nil, fmt.Errorf("revenue: resolve Slack workspace: %w", err)
	}
	message := strings.TrimSpace(req.Action.ProposedMessage)
	if subject := strings.TrimSpace(req.Action.ProposedSubject); subject != "" {
		message = "*" + subject + "*\n" + message
	}
	client := slackgo.New(token, slackgo.OptionHTTPClient(e.http), slackgo.OptionAPIURL(e.apiURL))
	options := []slackgo.MsgOption{
		slackgo.MsgOptionText(message, false),
		slackgo.MsgOptionDisableLinkUnfurl(),
		slackgo.MsgOptionDisableMediaUnfurl(),
	}
	if thread != "" {
		options = append(options, slackgo.MsgOptionTS(thread))
	}
	resultChannel, resultTS, err := client.PostMessageContext(ctx, channel, options...)
	if err != nil {
		return nil, classifySubmitError(err)
	}
	return &ExecResult{ProviderMessageID: resultTS, ProviderThreadID: firstNonEmptyString(thread, resultChannel)}, nil
}

func slackTarget(action *ent.RevenueAction) (team, channel, thread string, err error) {
	refs := []string{strings.TrimSpace(action.SenderAccountRef)}
	if rel, edgeErr := action.Edges.RelationshipOrErr(); edgeErr == nil {
		refs = append(refs, rel.ResourceRefs...)
	}
	for _, ref := range refs {
		parts := strings.Split(ref, ":")
		switch {
		case len(parts) >= 3 && parts[0] == "slack" && parts[1] == "channel":
			if parts[2] != "" {
				return "", parts[2], "", nil
			}
		case len(parts) >= 3 && parts[0] == "slack" && parts[1] != "channel" && parts[1] != "thread":
			if parts[1] != "" && parts[2] != "" {
				if len(parts) >= 4 {
					thread = parts[3]
				}
				return parts[1], parts[2], thread, nil
			}
		case len(parts) >= 4 && parts[0] == "slack" && parts[1] == "thread":
			if parts[2] != "" && parts[3] != "" {
				return "", parts[2], parts[3], nil
			}
		}
	}
	return "", "", "", errors.New("revenue: Slack action needs target slack:<team-id>:<channel-id>[:<thread-ts>]")
}

// CalendarExecutor creates a reviewed event in the assigned user's primary
// Google Calendar. due_at is the start, and the default duration is 30 minutes.
type CalendarExecutor struct{ google *GmailExecutor }

func NewCalendarExecutor(google *GmailExecutor) *CalendarExecutor {
	return &CalendarExecutor{google: google}
}

func (e *CalendarExecutor) Execute(ctx context.Context, req ExecRequest) (*ExecResult, error) {
	if req.Mode != ExecModeSend {
		return nil, errors.New("revenue: Google Calendar has no provider draft; change execution mode to send after reviewing the action")
	}
	if req.Action.DueAt == nil {
		return nil, errors.New("revenue: calendar action needs dueAt as its start time")
	}
	if e.google == nil {
		return nil, errors.New("revenue: Google Calendar executor is not configured")
	}
	_, token, err := e.google.connection(ctx, req.UserID, scopeCalendarEvents)
	if err != nil {
		return nil, err
	}
	start := req.Action.DueAt.UTC()
	summary := strings.TrimSpace(req.Action.ProposedSubject)
	if summary == "" {
		summary = "Oppulence follow-up"
	}
	mutation := googleapi.CalendarEventMutation{
		Summary:     summary,
		Description: strings.TrimSpace(req.Action.ProposedMessage),
		Start:       start.Format(time.RFC3339),
		End:         start.Add(30 * time.Minute).Format(time.RFC3339),
		TimeZone:    "UTC",
	}
	if attendee := strings.TrimSpace(req.Action.RecipientEmail); attendee != "" {
		mutation.Attendees = []string{attendee}
	}
	event, err := e.google.google.CreateEvent(ctx, token, mutation)
	if err != nil {
		return nil, classifySubmitError(err)
	}
	return &ExecResult{ProviderMessageID: event.ID, ProviderThreadID: event.HTMLLink}, nil
}

// HubSpotExecutor writes approved notes and tasks with the private-app token
// stored by the user's HubSpot connector. It talks to HubSpot's supported CRM
// object API directly; no shared placeholder MCP host is involved.
type HubSpotExecutor struct {
	hubspot *hubspotapi.Client
	now     func() time.Time
}

func NewHubSpotExecutor(client *ent.Client, sealer *crypto.Sealer, policy outbound.Policy) *HubSpotExecutor {
	return &HubSpotExecutor{
		hubspot: hubspotapi.New(client, sealer, policy),
		now:     time.Now,
	}
}

func (e *HubSpotExecutor) SetBaseURL(raw string) {
	if e != nil && e.hubspot != nil {
		e.hubspot.SetBaseURL(raw)
	}
}

func (e *HubSpotExecutor) Execute(ctx context.Context, req ExecRequest) (*ExecResult, error) {
	if req.Mode != ExecModeSend {
		return nil, errors.New("revenue: HubSpot has no provider draft; change execution mode to send after reviewing the action")
	}
	targetType, targetID, err := hubSpotTarget(req.Action)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Action.ProposedMessage) == "" {
		return nil, errors.New("revenue: action has no proposed message")
	}
	target := hubspotapi.AssociationTarget{ObjectType: targetType, ObjectID: targetID}
	var resultID string
	if req.Action.Channel == "task" || req.Action.Channel == "crm_task" {
		due := e.now().UTC()
		if req.Action.DueAt != nil {
			due = req.Action.DueAt.UTC()
		}
		result, createErr := e.hubspot.CreateTask(ctx, req.UserID, target,
			strings.TrimSpace(req.Action.ProposedSubject), strings.TrimSpace(req.Action.ProposedMessage), due)
		if createErr != nil {
			return nil, classifySubmitError(createErr)
		}
		if result != nil {
			resultID = result.ID
		}
	} else {
		result, createErr := e.hubspot.CreateNote(ctx, req.UserID, target,
			strings.TrimSpace(req.Action.ProposedMessage), e.now().UTC())
		if createErr != nil {
			return nil, classifySubmitError(createErr)
		}
		if result != nil {
			resultID = result.ID
		}
	}
	if resultID == "" {
		return nil, fmt.Errorf("%w: HubSpot accepted the action without returning an object id", ErrAmbiguous)
	}
	return &ExecResult{ProviderMessageID: resultID, ProviderThreadID: "hubspot:" + targetType + ":" + targetID}, nil
}

func (e *HubSpotExecutor) token(ctx context.Context, userID uuid.UUID) (string, error) {
	return e.hubspot.Token(ctx, userID)
}

func hubSpotTarget(action *ent.RevenueAction) (string, string, error) {
	refs := []string{strings.TrimSpace(action.SenderAccountRef)}
	if rel, err := action.Edges.RelationshipOrErr(); err == nil {
		refs = append(refs, rel.ResourceRefs...)
	}
	for _, ref := range refs {
		parts := strings.SplitN(ref, ":", 3)
		if len(parts) != 3 || parts[0] != "hubspot" || strings.TrimSpace(parts[2]) == "" {
			continue
		}
		kind := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(parts[1])), "s")
		switch kind {
		case "contact", "company", "deal", "ticket":
			return kind, strings.TrimSpace(parts[2]), nil
		}
	}
	return "", "", errors.New("revenue: HubSpot action needs a relationship resource ref hubspot:<contact|company|deal|ticket>:<id>")
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

var _ Executor = (*RoutingExecutor)(nil)
var _ Executor = (*SlackExecutor)(nil)
var _ Executor = (*CalendarExecutor)(nil)
var _ Executor = (*HubSpotExecutor)(nil)
