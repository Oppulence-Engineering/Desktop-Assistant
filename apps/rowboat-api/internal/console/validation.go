package console

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxNameRunes       = 120
	maxTitleRunes      = 200
	maxBodyBytes       = 64 << 10
	maxPayloadBytes    = 128 << 10
	maxQueryRunes      = 2_000
	maxIdentifierRunes = 512
	maxContentBlocks   = 1_000
)

type normalizedResource struct {
	name        string
	nameKey     *string
	noteID      *string
	payloadJSON string
	sortOrder   int
}

type noteTemplatePayload struct {
	Title   string            `json:"title"`
	Body    string            `json:"body,omitempty"`
	Content []json.RawMessage `json:"content,omitempty"`
}

type noteFavoritePayload struct {
	NoteID string `json:"noteId"`
}

type graphSavedViewPayload struct {
	State graphSavedViewState `json:"state"`
}

type graphSavedViewState struct {
	Scope              string  `json:"scope"`
	RelationshipID     *string `json:"relationshipId,omitempty"`
	Query              string  `json:"query"`
	Layout             string  `json:"layout"`
	Density            float64 `json:"density"`
	HideIsolated       bool    `json:"hideIsolated"`
	SelectedNodeID     *string `json:"selectedNodeId,omitempty"`
	FocusDepth         int     `json:"focusDepth"`
	AsOf               *string `json:"asOf,omitempty"`
	ChangedSinceReview bool    `json:"changedSinceReview"`
}

func normalizeResource(kind ResourceKind, name string, payload json.RawMessage, sortOrder int) (normalizedResource, error) {
	if sortOrder < -1_000_000 || sortOrder > 1_000_000 {
		return normalizedResource{}, invalid("sortOrder must be between -1000000 and 1000000")
	}
	if len(payload) == 0 || len(payload) > maxPayloadBytes {
		return normalizedResource{}, invalid("payload must contain between 1 and %d bytes", maxPayloadBytes)
	}
	name = strings.TrimSpace(name)
	if !utf8.ValidString(name) || utf8.RuneCountInString(name) > maxNameRunes {
		return normalizedResource{}, invalid("name must be valid UTF-8 and at most %d characters", maxNameRunes)
	}

	out := normalizedResource{name: name, sortOrder: sortOrder}
	switch kind {
	case KindNoteTemplate:
		if name == "" {
			return normalizedResource{}, invalid("name is required for note_template")
		}
		var value noteTemplatePayload
		if err := decodePayload(payload, &value); err != nil {
			return normalizedResource{}, err
		}
		value.Title = strings.TrimSpace(value.Title)
		if value.Title == "" || utf8.RuneCountInString(value.Title) > maxTitleRunes {
			return normalizedResource{}, invalid("template title must contain 1 to %d characters", maxTitleRunes)
		}
		if len(value.Body) > maxBodyBytes || len(value.Content) > maxContentBlocks {
			return normalizedResource{}, invalid("template body or content exceeds its limit")
		}
		for _, block := range value.Content {
			var object map[string]json.RawMessage
			if err := json.Unmarshal(block, &object); err != nil || object == nil {
				return normalizedResource{}, invalid("template content must contain JSON object blocks")
			}
		}
		out.nameKey = stringPointer(normalizeName(name))
		return marshalNormalized(out, value)
	case KindNoteFavorite:
		if name != "" {
			return normalizedResource{}, invalid("name is not allowed for note_favorite")
		}
		var value noteFavoritePayload
		if err := decodePayload(payload, &value); err != nil {
			return normalizedResource{}, err
		}
		value.NoteID = strings.TrimSpace(value.NoteID)
		if value.NoteID == "" || utf8.RuneCountInString(value.NoteID) > maxIdentifierRunes {
			return normalizedResource{}, invalid("noteId must contain 1 to %d characters", maxIdentifierRunes)
		}
		out.noteID = stringPointer(value.NoteID)
		return marshalNormalized(out, value)
	case KindGraphSavedView:
		if name == "" {
			return normalizedResource{}, invalid("name is required for graph_saved_view")
		}
		var value graphSavedViewPayload
		if err := decodePayload(payload, &value); err != nil {
			return normalizedResource{}, err
		}
		if err := validateGraphState(value.State); err != nil {
			return normalizedResource{}, err
		}
		out.nameKey = stringPointer(normalizeName(name))
		return marshalNormalized(out, value)
	default:
		return normalizedResource{}, invalid("kind must be note_template, note_favorite, or graph_saved_view")
	}
}

func decodePayload(payload json.RawMessage, dst any) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return invalid("payload does not match the resource kind: %v", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return invalid("payload must contain exactly one JSON document")
	}
	return nil
}

func validateGraphState(state graphSavedViewState) error {
	if state.Scope != "portfolio" && state.Scope != "relationship" {
		return invalid("graph state scope must be portfolio or relationship")
	}
	if state.Scope == "relationship" && (state.RelationshipID == nil || strings.TrimSpace(*state.RelationshipID) == "") {
		return invalid("relationshipId is required for relationship scope")
	}
	if state.Scope == "portfolio" && state.RelationshipID != nil {
		return invalid("relationshipId is only allowed for relationship scope")
	}
	if utf8.RuneCountInString(state.Query) > maxQueryRunes {
		return invalid("graph query must be at most %d characters", maxQueryRunes)
	}
	if state.Layout != "force" && state.Layout != "radial" && state.Layout != "timeline" {
		return invalid("graph layout must be force, radial, or timeline")
	}
	if math.IsNaN(state.Density) || math.IsInf(state.Density, 0) || state.Density < 0.25 || state.Density > 1 {
		return invalid("graph density must be between 0.25 and 1")
	}
	if state.FocusDepth < 0 || state.FocusDepth > 2 {
		return invalid("graph focusDepth must be 0, 1, or 2")
	}
	for field, value := range map[string]*string{
		"relationshipId": state.RelationshipID,
		"selectedNodeId": state.SelectedNodeID,
	} {
		if value != nil && (!utf8.ValidString(*value) || utf8.RuneCountInString(*value) > maxIdentifierRunes) {
			return invalid("%s must be valid UTF-8 and at most %d characters", field, maxIdentifierRunes)
		}
	}
	if state.AsOf != nil {
		if _, err := time.Parse(time.RFC3339, *state.AsOf); err != nil {
			return invalid("graph asOf must be an RFC3339 timestamp")
		}
	}
	return nil
}

func marshalNormalized(out normalizedResource, value any) (normalizedResource, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return normalizedResource{}, fmt.Errorf("encode validated console payload: %w", err)
	}
	if len(encoded) > maxPayloadBytes {
		return normalizedResource{}, invalid("normalized payload exceeds %d bytes", maxPayloadBytes)
	}
	out.payloadJSON = string(encoded)
	return out, nil
}

func normalizeName(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(value), " "))
}

func stringPointer(value string) *string { return &value }

func invalid(format string, values ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, fmt.Sprintf(format, values...))
}
