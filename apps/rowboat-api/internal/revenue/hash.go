package revenue

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// RevisionContent is the exact set of fields whose change constitutes a new
// action revision (RFC 030 invariant 3): recipient, sender account, assignee,
// channel, subject, message, and action type. Anything else (queue triage,
// priority, timestamps) can change without invalidating policy or approval.
type RevisionContent struct {
	ActionType       string `json:"actionType"`
	Channel          string `json:"channel"`
	RecipientEmail   string `json:"recipientEmail"`
	ProposedSubject  string `json:"proposedSubject"`
	ProposedMessage  string `json:"proposedMessage"`
	SenderAccountRef string `json:"senderAccountRef"`
	AssignedUserID   string `json:"assignedUserId"`
	ExecutionMode    string `json:"executionMode"`
}

// Hash returns the canonical revision hash ("sha256:<hex>"). Struct JSON
// marshaling emits fields in declaration order, so the encoding is canonical
// for this fixed shape.
func (c RevisionContent) Hash() string {
	raw, err := json.Marshal(c)
	if err != nil {
		// A fixed struct of strings cannot fail to marshal; guard anyway.
		raw = []byte(fmt.Sprintf("%+v", c))
	}
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}

// ExecutionIdempotencyKey derives the execute idempotency key from
// {action_id, revision} (RFC 030 invariant 7).
func ExecutionIdempotencyKey(actionID string, revision int) string {
	return fmt.Sprintf("revenue-action:%s:revision:%d", actionID, revision)
}
