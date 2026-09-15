package openapidoc

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"sort"
	"testing"
)

func TestEnrichDocumentsTheAccountDeletionContract(t *testing.T) {
	spec := obj{
		"openapi":    "3.0.3",
		"info":       obj{"title": "Solomon AI API"},
		"paths":      obj{},
		"components": obj{"schemas": obj{}},
	}
	Enrich(spec)
	assertAccountDeletionContract(t, spec)
}

func TestCheckedInOpenAPIDocumentsTheAccountDeletionContract(t *testing.T) {
	raw, err := os.ReadFile("../../api/openapi.json")
	if err != nil {
		t.Fatalf("read checked-in openapi json: %v", err)
	}
	var spec obj
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("parse checked-in openapi json: %v", err)
	}
	assertAccountDeletionContract(t, spec)
}

func docStrings(v any) []string {
	switch values := v.(type) {
	case []string:
		return slices.Clone(values)
	case []any:
		out := make([]string, 0, len(values))
		for _, value := range values {
			out = append(out, fmt.Sprint(value))
		}
		return out
	}
	return nil
}

func sortedKeys(m obj) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func assertAccountDeletionContract(t *testing.T, spec obj) {
	t.Helper()
	me := asObj(asObj(spec["paths"])["/v1/me"])
	if me["get"] == nil {
		t.Error("GET /v1/me is no longer documented")
	}
	op := asObj(me["delete"])
	if len(op) == 0 {
		t.Fatal("DELETE /v1/me is not documented")
	}
	if op["operationId"] != "deleteMe" {
		t.Errorf("operationId = %v, want deleteMe", op["operationId"])
	}
	if tags := docStrings(op["tags"]); !slices.Equal(tags, []string{"Billing"}) {
		t.Errorf("tags = %v, want [Billing]", tags)
	}
	if op["security"] == nil {
		t.Error("DELETE /v1/me must declare bearer security")
	}

	body := asObj(op["requestBody"])
	if body["required"] != true {
		t.Error("the confirmation body must be required")
	}
	media := asObj(asObj(body["content"])["application/json"])
	if ref := asObj(media["schema"])["$ref"]; ref != "#/components/schemas/AccountDeletionRequest" {
		t.Errorf("request schema = %v", ref)
	}
	if confirm := asObj(media["example"])["confirm"]; confirm != "DELETE" {
		t.Errorf("request example confirm = %v, want DELETE", confirm)
	}

	responses := asObj(op["responses"])
	if codes := sortedKeys(responses); !slices.Equal(codes, []string{"200", "400", "401", "409", "500", "502"}) {
		t.Errorf("response codes = %v", codes)
	}
	ok := asObj(asObj(asObj(responses["200"])["content"])["application/json"])
	if ref := asObj(ok["schema"])["$ref"]; ref != "#/components/schemas/AccountDeletionReceipt" {
		t.Errorf("200 schema = %v", ref)
	}
	for code, wantCode := range map[string]string{
		"400": "confirmation_required",
		"409": "workspace_successor_required",
		"502": "billing_cancellation_failed",
	} {
		problem := asObj(asObj(asObj(responses[code])["content"])["application/problem+json"])
		example := asObj(problem["example"])
		if example["code"] != wantCode || fmt.Sprint(example["status"]) != code {
			t.Errorf("%s example = %v, want code %s", code, example, wantCode)
		}
		if ref := asObj(problem["schema"])["$ref"]; ref != "#/components/schemas/ErrorEnvelope" {
			t.Errorf("%s schema = %v, want ErrorEnvelope", code, ref)
		}
	}
	for _, code := range []string{"401", "500"} {
		if ref := asObj(responses[code])["$ref"]; ref != "#/components/responses/"+code {
			t.Errorf("%s response = %v, want the shared %s response", code, ref, code)
		}
	}

	schemas := asObj(asObj(spec["components"])["schemas"])
	request := asObj(schemas["AccountDeletionRequest"])
	if required := docStrings(request["required"]); !slices.Equal(required, []string{"confirm"}) {
		t.Errorf("AccountDeletionRequest required = %v", required)
	}
	confirm := asObj(asObj(request["properties"])["confirm"])
	if confirm["type"] != "string" || !slices.Equal(docStrings(confirm["enum"]), []string{"DELETE"}) {
		t.Errorf("confirm property = %v, want a string enum of DELETE", confirm)
	}

	receipt := asObj(schemas["AccountDeletionReceipt"])
	wantTypes := map[string]string{
		"receiptId":              "string",
		"requestedAt":            "string",
		"completedAt":            "string",
		"subscriptionsCancelled": "integer",
		"connectorsRevoked":      "integer",
		"workspacesTransferred":  "integer",
		"workspacesDeleted":      "integer",
		"identityDeleted":        "boolean",
	}
	props := asObj(receipt["properties"])
	for name, typ := range wantTypes {
		if got := asObj(props[name])["type"]; got != typ {
			t.Errorf("receipt %s type = %v, want %s", name, got, typ)
		}
	}
	// The receipt is shown to support; a new field could carry personal data.
	if len(props) != len(wantTypes) {
		t.Errorf("receipt properties = %v, want exactly %d reviewed fields", sortedKeys(props), len(wantTypes))
	}
	required := docStrings(receipt["required"])
	sort.Strings(required)
	want := make([]string, 0, len(wantTypes))
	for name := range wantTypes {
		want = append(want, name)
	}
	sort.Strings(want)
	if !slices.Equal(required, want) {
		t.Errorf("receipt required = %v, want %v", required, want)
	}
}
