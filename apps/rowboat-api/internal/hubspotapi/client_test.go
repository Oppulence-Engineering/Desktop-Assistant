package hubspotapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

func TestSearchUsesOfficialSDKAndUserCredential(t *testing.T) {
	database, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	user := database.Client.User.Create().
		SetEmail("hubspot@example.com").
		SetWorkosUserID("user_hubspot").
		SaveX(auth.WithInternal(context.Background()))
	ctx := auth.WithUser(context.Background(), user)
	sealer, err := crypto.NewSealer("test-encryption-key-for-hubspot-sdk")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	sealed, err := sealer.SealString("pat-na1-search")
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	database.Client.MCPConnection.Create().
		SetUser(user).
		SetConnector("hubspot").
		SetAudience("hubspot-api").
		SetAPIKeyEncrypted(sealed).
		SaveX(ctx)

	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/crm/objects/2026-03/contacts/search" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer pat-na1-search" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"total":1,"results":[{"id":"101","archived":false,"createdAt":"2026-07-31T12:00:00Z","updatedAt":"2026-07-31T12:00:00Z","properties":{"email":"buyer@example.com"}}]}`)
	}))
	t.Cleanup(server.Close)

	client := New(database.Client, sealer, outbound.Policy{})
	client.SetBaseURL(server.URL)
	result, err := client.Search(ctx, user.ID, "contacts", "buyer@example.com", 100)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if result.ObjectType != "contact" || result.Total != 1 || len(result.Results) != 1 || result.Results[0].ID != "101" {
		t.Fatalf("result = %+v", result)
	}
	if body["query"] != "buyer@example.com" || body["limit"] != float64(25) {
		t.Fatalf("search body = %#v", body)
	}
	properties, ok := body["properties"].([]any)
	if !ok || len(properties) == 0 {
		t.Fatalf("search properties = %#v", body["properties"])
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/hubspot/search", bytes.NewBufferString(`{"objectType":"contact","query":"buyer@example.com","limit":5}`)).
		WithContext(ctx)
	NewHandler(client).Search(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("handler search: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestNormalizeObjectTypeRejectsArbitraryObjects(t *testing.T) {
	if _, err := NormalizeObjectType("owners"); err == nil {
		t.Fatal("expected unsupported object type to fail")
	}
}

func TestListCompaniesUsesBoundedOfficialSDKPage(t *testing.T) {
	database, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	user := database.Client.User.Create().SetEmail("company@example.com").
		SetWorkosUserID("user_company_backfill").SaveX(auth.WithInternal(context.Background()))
	ctx := auth.WithUser(context.Background(), user)
	sealer, err := crypto.NewSealer("test-encryption-key-for-company-list")
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := sealer.SealString("pat-na1-companies")
	if err != nil {
		t.Fatal(err)
	}
	database.Client.MCPConnection.Create().SetUser(user).SetConnector("hubspot").
		SetAudience("hubspot-api").SetAPIKeyEncrypted(sealed).SaveX(ctx)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/crm/objects/2026-03/companies" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer pat-na1-companies" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		if r.URL.Query().Get("limit") != "100" || !strings.Contains(r.URL.Query().Get("properties"), "lifecyclestage") {
			t.Errorf("query = %q", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"results":[{"id":"company-1","archived":false,"createdAt":"2026-07-01T12:00:00Z","updatedAt":"2026-07-31T12:00:00Z","properties":{"name":"Acme","domain":"acme.example","lifecyclestage":"customer"}}]}`)
	}))
	defer server.Close()

	client := New(database.Client, sealer, outbound.Policy{})
	client.SetBaseURL(server.URL)
	companies, err := client.ListCompanies(ctx, user.ID, 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(companies) != 1 || companies[0].ID != "company-1" || companies[0].Properties["domain"] != "acme.example" {
		t.Fatalf("companies = %+v", companies)
	}
}

func TestActionMarkerRequiresAnExactRevisionBoundary(t *testing.T) {
	body := WithActionMarker("Follow up", "revenue-action:abc:revision:10")
	if !strings.Contains(body, actionMarker("revenue-action:abc:revision:10")) {
		t.Fatalf("exact marker missing: %q", body)
	}
	if strings.Contains(body, actionMarker("revenue-action:abc:revision:1")) {
		t.Fatalf("revision 1 must not prefix-match revision 10: %q", body)
	}
}
