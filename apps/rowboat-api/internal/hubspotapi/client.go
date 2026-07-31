// Package hubspotapi provides the server-held, user-scoped HubSpot CRM client.
// It uses HubSpot's official Go SDK and keeps private-app tokens out of model
// prompts, desktop storage, and action payloads.
package hubspotapi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	hubspotsdk "github.com/HubSpot/hubspot-sdk-go"
	"github.com/HubSpot/hubspot-sdk-go/crm"
	"github.com/HubSpot/hubspot-sdk-go/option"
	"github.com/HubSpot/hubspot-sdk-go/shared"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

const defaultBaseURL = "https://api.hubapi.com"

const actionMarkerPrefix = "oppulence-action:"

// Client resolves a user's sealed private-app token immediately before each
// request and calls HubSpot through the official SDK.
type Client struct {
	client  *ent.Client
	sealer  *crypto.Sealer
	http    *outbound.Client
	baseURL string
	now     func() time.Time
}

// SearchResult is the bounded model-safe CRM search response.
type SearchResult struct {
	ObjectType string                   `json:"objectType"`
	Total      int64                    `json:"total"`
	Results    []crm.SimplePublicObject `json:"results"`
}

// AssociationTarget identifies the CRM record an engagement belongs to.
type AssociationTarget struct {
	ObjectType string
	ObjectID   string
}

// New constructs a HubSpot client with the shared outbound controls.
func New(client *ent.Client, sealer *crypto.Sealer, policy outbound.Policy) *Client {
	policy.Name = "hubspot-crm"
	if policy.Timeout == 0 {
		policy.Timeout = 15 * time.Second
	}
	return &Client{
		client: client, sealer: sealer, http: outbound.NewClient(policy),
		baseURL: defaultBaseURL, now: time.Now,
	}
}

// SetBaseURL overrides the HubSpot API origin for contract tests.
func (c *Client) SetBaseURL(raw string) {
	if strings.TrimSpace(raw) != "" {
		c.baseURL = strings.TrimRight(strings.TrimSpace(raw), "/")
	}
}

// Token opens the connected user's private-app token. The explicit user
// predicate is applied under an internal context so no other tenant's token can
// satisfy the query.
func (c *Client) Token(ctx context.Context, userID uuid.UUID) (string, error) {
	if c == nil || c.client == nil || c.sealer == nil {
		return "", errors.New("hubspot: client is not configured")
	}
	conn, err := c.client.MCPConnection.Query().Where(
		mcpconnection.ConnectorEQ("hubspot"),
		mcpconnection.HasUserWith(user.IDEQ(userID)),
	).Only(auth.WithInternal(ctx))
	if err != nil {
		if ent.IsNotFound(err) {
			return "", errors.New("hubspot: not connected for this user")
		}
		return "", fmt.Errorf("hubspot: load connection: %w", err)
	}
	if len(conn.APIKeyEncrypted) == 0 {
		return "", errors.New("hubspot: connection has no private-app token; reconnect HubSpot")
	}
	token, err := c.sealer.OpenString(conn.APIKeyEncrypted)
	if err != nil {
		return "", fmt.Errorf("hubspot: open credential: %w", err)
	}
	if strings.TrimSpace(token) == "" {
		return "", errors.New("hubspot: connection has an empty private-app token; reconnect HubSpot")
	}
	_ = conn.Update().SetLastUsedAt(c.now()).Exec(auth.WithInternal(ctx))
	return strings.TrimSpace(token), nil
}

// Search searches contacts, companies, deals, or tickets. Results are bounded
// to 25 records and include a small, type-specific property set.
func (c *Client) Search(ctx context.Context, userID uuid.UUID, objectType, query string, limit int) (SearchResult, error) {
	kind, err := NormalizeObjectType(objectType)
	if err != nil {
		return SearchResult{}, err
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return SearchResult{}, errors.New("hubspot: search query is required")
	}
	if limit <= 0 {
		limit = 10
	}
	if limit > 25 {
		limit = 25
	}
	sdk, err := c.sdk(ctx, userID, 2)
	if err != nil {
		return SearchResult{}, err
	}
	request := crm.PublicObjectSearchRequestParam{
		After: "", FilterGroups: []crm.FilterGroupParam{}, Limit: int64(limit),
		Properties: searchProperties(kind), Sorts: []string{}, Query: hubspotsdk.String(query),
	}
	var response *crm.CollectionResponseWithTotalSimplePublicObject
	switch kind {
	case "contact":
		response, err = sdk.Crm.Objects.Contacts.Search(ctx, crm.ObjectContactSearchParams{PublicObjectSearchRequest: request})
	case "company":
		response, err = sdk.Crm.Objects.Companies.Search(ctx, crm.ObjectCompanySearchParams{PublicObjectSearchRequest: request})
	case "deal":
		response, err = sdk.Crm.Objects.Deals.Search(ctx, crm.ObjectDealSearchParams{PublicObjectSearchRequest: request})
	case "ticket":
		response, err = sdk.Crm.Objects.Tickets.Search(ctx, crm.ObjectTicketSearchParams{PublicObjectSearchRequest: request})
	}
	if err != nil {
		return SearchResult{}, fmt.Errorf("hubspot: search %ss: %w", kind, err)
	}
	if response == nil {
		return SearchResult{}, errors.New("hubspot: search returned no response")
	}
	return SearchResult{ObjectType: kind, Total: response.Total, Results: response.Results}, nil
}

// CreateNote creates a CRM note associated with exactly one explicit target.
// SDK retries are disabled because replaying a write can duplicate activity.
func (c *Client) CreateNote(ctx context.Context, userID uuid.UUID, target AssociationTarget, body string, timestamp time.Time) (*crm.SimplePublicObject, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, errors.New("hubspot: note body is required")
	}
	if timestamp.IsZero() {
		timestamp = c.now()
	}
	return c.createEngagement(ctx, userID, "note", target, map[string]string{
		"hs_timestamp": timestamp.UTC().Format(time.RFC3339),
		"hs_note_body": body,
	})
}

// CreateTask creates a CRM task associated with exactly one explicit target.
// SDK retries are disabled because replaying a write can duplicate activity.
func (c *Client) CreateTask(ctx context.Context, userID uuid.UUID, target AssociationTarget, subject, body string, due time.Time) (*crm.SimplePublicObject, error) {
	if strings.TrimSpace(body) == "" {
		return nil, errors.New("hubspot: task body is required")
	}
	if strings.TrimSpace(subject) == "" {
		subject = "Oppulence follow-up"
	}
	if due.IsZero() {
		due = c.now()
	}
	return c.createEngagement(ctx, userID, "task", target, map[string]string{
		"hs_timestamp":     due.UTC().Format(time.RFC3339),
		"hs_task_subject":  strings.TrimSpace(subject),
		"hs_task_body":     strings.TrimSpace(body),
		"hs_task_status":   "NOT_STARTED",
		"hs_task_priority": "MEDIUM",
		"hs_task_type":     "TODO",
	})
}

// WithActionMarker adds an inert HTML comment that the official HubSpot SDK's
// Notes/Tasks search APIs can find if a create response is lost. It is not a
// retry token: callers still submit the write at most once.
func WithActionMarker(body, idempotencyKey string) string {
	body = strings.TrimSpace(body)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if idempotencyKey == "" {
		return body
	}
	return body + "\n<!-- " + actionMarkerPrefix + idempotencyKey + " -->"
}

// FindEngagementByActionMarker reconciles a note/task through the official SDK
// search service. A nil result is a definite "not observed yet", not permission
// to resubmit the write.
func (c *Client) FindEngagementByActionMarker(ctx context.Context, userID uuid.UUID, engagement, idempotencyKey string) (*crm.SimplePublicObject, error) {
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if idempotencyKey == "" {
		return nil, errors.New("hubspot: reconciliation idempotency key is required")
	}
	marker := actionMarkerPrefix + idempotencyKey
	sdk, err := c.sdk(ctx, userID, 2)
	if err != nil {
		return nil, err
	}
	property := "hs_note_body"
	request := crm.PublicObjectSearchRequestParam{
		After: "", FilterGroups: []crm.FilterGroupParam{}, Limit: 10,
		Properties: []string{property}, Sorts: []string{}, Query: hubspotsdk.String(marker),
	}
	var response *crm.CollectionResponseWithTotalSimplePublicObject
	switch engagement {
	case "note":
		response, err = sdk.Crm.Objects.Notes.Search(ctx, crm.ObjectNoteSearchParams{PublicObjectSearchRequest: request})
	case "task":
		property = "hs_task_body"
		request.Properties = []string{property}
		response, err = sdk.Crm.Objects.Tasks.Search(ctx, crm.ObjectTaskSearchParams{PublicObjectSearchRequest: request})
	default:
		return nil, fmt.Errorf("hubspot: unsupported engagement %q", engagement)
	}
	if err != nil {
		return nil, fmt.Errorf("hubspot: reconcile %s: %w", engagement, err)
	}
	if response == nil {
		return nil, nil
	}
	for i := range response.Results {
		if strings.Contains(response.Results[i].Properties[property], marker) {
			return &response.Results[i], nil
		}
	}
	return nil, nil
}

func (c *Client) createEngagement(ctx context.Context, userID uuid.UUID, engagement string, target AssociationTarget, properties map[string]string) (*crm.SimplePublicObject, error) {
	kind, err := NormalizeObjectType(target.ObjectType)
	if err != nil {
		return nil, err
	}
	target.ObjectID = strings.TrimSpace(target.ObjectID)
	if target.ObjectID == "" {
		return nil, errors.New("hubspot: target object id is required")
	}
	associationID := associationTypeID(engagement, kind)
	if associationID == 0 {
		return nil, fmt.Errorf("hubspot: unsupported %s association to %s", engagement, kind)
	}
	sdk, err := c.sdk(ctx, userID, 0)
	if err != nil {
		return nil, err
	}
	input := crm.SimplePublicObjectInputForCreateParam{
		Properties: properties,
		Associations: []crm.PublicAssociationsForObjectParam{{
			To: shared.PublicObjectIDParam{ID: target.ObjectID},
			Types: []shared.AssociationSpecParam{{
				AssociationCategory: shared.AssociationSpecAssociationCategoryHubSpotDefined,
				AssociationTypeID:   int64(associationID),
			}},
		}},
	}
	if engagement == "task" {
		return sdk.Crm.Objects.Tasks.New(ctx, crm.ObjectTaskNewParams{SimplePublicObjectInputForCreate: input})
	}
	return sdk.Crm.Objects.Notes.New(ctx, crm.ObjectNoteNewParams{SimplePublicObjectInputForCreate: input})
}

func (c *Client) sdk(ctx context.Context, userID uuid.UUID, maxRetries int) (hubspotsdk.Client, error) {
	token, err := c.Token(ctx, userID)
	if err != nil {
		return hubspotsdk.Client{}, err
	}
	options := []option.RequestOption{
		option.WithAccessToken(token),
		option.WithHTTPClient(c.http),
		option.WithMaxRetries(maxRetries),
	}
	if c.baseURL != defaultBaseURL {
		options = append(options, option.WithBaseURL(c.baseURL))
	}
	return hubspotsdk.NewClient(options...), nil
}

// NormalizeObjectType accepts singular/plural CRM object names and returns the
// canonical singular form.
func NormalizeObjectType(value string) (string, error) {
	kind := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(value)), "s")
	switch kind {
	case "contact", "company", "deal", "ticket":
		return kind, nil
	default:
		return "", fmt.Errorf("hubspot: objectType must be contact, company, deal, or ticket")
	}
}

func associationTypeID(engagement, target string) int {
	if engagement == "note" {
		return map[string]int{"contact": 202, "company": 190, "deal": 214, "ticket": 228}[target]
	}
	if engagement == "task" {
		return map[string]int{"contact": 204, "company": 192, "deal": 216, "ticket": 230}[target]
	}
	return 0
}

func searchProperties(kind string) []string {
	switch kind {
	case "contact":
		return []string{"firstname", "lastname", "email", "company", "phone", "lifecyclestage", "hs_lastmodifieddate"}
	case "company":
		return []string{"name", "domain", "industry", "phone", "city", "state", "lifecyclestage", "hs_lastmodifieddate"}
	case "deal":
		return []string{"dealname", "amount", "dealstage", "pipeline", "closedate", "hs_lastmodifieddate"}
	default:
		return []string{"subject", "content", "hs_pipeline", "hs_pipeline_stage", "hs_ticket_priority", "createdate", "hs_lastmodifieddate"}
	}
}

// StatusCode extracts the HTTP status from an official SDK API error.
func StatusCode(err error) (int, bool) {
	var apiErr *hubspotsdk.Error
	if !errors.As(err, &apiErr) || apiErr == nil {
		return 0, false
	}
	return apiErr.StatusCode, true
}
