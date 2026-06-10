package feedback

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

// Plain's customer/thread mutations. Mutation-level errors come back as data
// (the error object), not as GraphQL top-level errors, so both are checked.
const upsertCustomerMutation = `mutation upsertCustomer($input: UpsertCustomerInput!) {
  upsertCustomer(input: $input) {
    result
    customer { id }
    error { message code }
  }
}`

const createThreadMutation = `mutation createThread($input: CreateThreadInput!) {
  createThread(input: $input) {
    thread { id }
    error { message code }
  }
}`

// plainClient posts GraphQL documents to Plain's core API.
type plainClient struct {
	baseURL string
	http    *outbound.Client
}

type plainMutationError struct {
	Message string `json:"message"`
	Code    string `json:"code"`
}

func (e *plainMutationError) err(op string) error {
	if e == nil {
		return nil
	}
	return fmt.Errorf("plain %s: %s (%s)", op, e.Message, e.Code)
}

// do posts one GraphQL operation and unmarshals the `data` object into out.
func (c *plainClient) do(ctx context.Context, apiKey, query string, variables, out any) error {
	body, err := json.Marshal(map[string]any{"query": query, "variables": variables})
	if err != nil {
		return fmt.Errorf("plain marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, strings.NewReader(string(body)))
	if err != nil {
		return fmt.Errorf("plain build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("plain request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := outbound.ReadAll(resp.Body, c.http.MaxResponseBytes())
	if err != nil {
		return fmt.Errorf("plain read response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("plain non-200: %d", resp.StatusCode)
	}

	var envelope struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return fmt.Errorf("plain malformed response: %w", err)
	}
	if len(envelope.Errors) > 0 {
		return fmt.Errorf("plain graphql error: %s", envelope.Errors[0].Message)
	}
	if err := json.Unmarshal(envelope.Data, out); err != nil {
		return fmt.Errorf("plain malformed data: %w", err)
	}
	return nil
}

// upsertCustomer creates-or-updates the Plain customer for email and returns
// the Plain customer id. The email comes from the IdP-verified account.
func (c *plainClient) upsertCustomer(ctx context.Context, apiKey, email string) (string, error) {
	variables := map[string]any{
		"input": map[string]any{
			"identifier": map[string]any{"emailAddress": email},
			"onCreate": map[string]any{
				"fullName": email,
				"email":    map[string]any{"email": email, "isVerified": true},
			},
			"onUpdate": map[string]any{},
		},
	}
	var data struct {
		UpsertCustomer struct {
			Customer *struct {
				ID string `json:"id"`
			} `json:"customer"`
			Error *plainMutationError `json:"error"`
		} `json:"upsertCustomer"`
	}
	if err := c.do(ctx, apiKey, upsertCustomerMutation, variables, &data); err != nil {
		return "", err
	}
	if err := data.UpsertCustomer.Error.err("upsertCustomer"); err != nil {
		return "", err
	}
	if data.UpsertCustomer.Customer == nil || data.UpsertCustomer.Customer.ID == "" {
		return "", fmt.Errorf("plain upsertCustomer: missing customer id")
	}
	return data.UpsertCustomer.Customer.ID, nil
}

// createThread opens a thread for the customer and returns the thread id.
// labelTypeID is optional ("" → no label).
func (c *plainClient) createThread(ctx context.Context, apiKey, customerID, title, message, metadata, labelTypeID string) (string, error) {
	input := map[string]any{
		"customerIdentifier": map[string]any{"customerId": customerID},
		"title":              title,
		"components": []map[string]any{
			{"componentText": map[string]any{"text": message}},
			{"componentSpacer": map[string]any{"spacerSize": "M"}},
			{"componentText": map[string]any{"text": metadata, "textSize": "S", "textColor": "MUTED"}},
		},
	}
	if labelTypeID != "" {
		input["labelTypeIds"] = []string{labelTypeID}
	}
	var data struct {
		CreateThread struct {
			Thread *struct {
				ID string `json:"id"`
			} `json:"thread"`
			Error *plainMutationError `json:"error"`
		} `json:"createThread"`
	}
	if err := c.do(ctx, apiKey, createThreadMutation, map[string]any{"input": input}, &data); err != nil {
		return "", err
	}
	if err := data.CreateThread.Error.err("createThread"); err != nil {
		return "", err
	}
	if data.CreateThread.Thread == nil || data.CreateThread.Thread.ID == "" {
		return "", fmt.Errorf("plain createThread: missing thread id")
	}
	return data.CreateThread.Thread.ID, nil
}
