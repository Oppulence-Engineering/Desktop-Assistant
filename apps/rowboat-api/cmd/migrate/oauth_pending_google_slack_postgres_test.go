package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	atlasmigrate "ariga.io/atlas/sql/migrate"
	"ariga.io/atlas/sql/sqlclient"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthpending"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	rowboatdb "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/google"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slack"
	_ "github.com/jackc/pgx/v5/stdlib"
	"go.uber.org/zap"
)

// TestOAuthPendingGoogleSlackFlowsOnFullyMigratedPostgres is intentionally
// environment-gated because it requires a fresh disposable PostgreSQL 16
// database. It applies every checked-in Atlas migration, opens the application
// with AUTO_MIGRATE=false, then executes the public start/callback/claim shapes
// for both legacy providers. It also proves that rows minted before hash-only
// storage remain consumable after the contract migration has rewritten them.
func TestOAuthPendingGoogleSlackFlowsOnFullyMigratedPostgres(t *testing.T) {
	dsn := os.Getenv("OAUTH_PENDING_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("OAUTH_PENDING_TEST_DATABASE_URL is required for PostgreSQL 16 OAuth pending integration validation")
	}
	ctx := context.Background()
	rawDB, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rawDB.Close() }()

	var serverVersion int
	if err := rawDB.QueryRowContext(ctx, `SHOW server_version_num`).Scan(&serverVersion); err != nil {
		t.Fatal(err)
	}
	if serverVersion < 160000 || serverVersion >= 170000 {
		t.Fatalf("PostgreSQL server_version_num=%d, want 16.x", serverVersion)
	}
	var tables int
	if err := rawDB.QueryRowContext(ctx, `SELECT count(*) FROM pg_tables WHERE schemaname=current_schema()`).Scan(&tables); err != nil {
		t.Fatal(err)
	}
	if tables != 0 {
		t.Fatalf("OAuth pending integration database is not fresh: found %d table(s)", tables)
	}
	sealer, err := crypto.NewSealer("oauth-pending-postgres-integration-key")
	if err != nil {
		t.Fatal(err)
	}

	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir("../.."); err != nil {
		t.Fatal(err)
	}
	if err := validateDirectory(); err != nil {
		t.Fatal(err)
	}
	if err := applyAllMigrationsAroundLegacyPendingRows(ctx, dsn, sealer); err != nil {
		t.Fatalf("apply all PostgreSQL migrations around legacy pending rows: %v", err)
	}
	if err := os.Chdir(workingDirectory); err != nil {
		t.Fatal(err)
	}

	database, err := rowboatdb.Open(ctx, appconfig.Config{
		DatabaseURL: dsn,
		AutoMigrate: false,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("open fully migrated PostgreSQL with AUTO_MIGRATE=false: %v", err)
	}
	defer func() { _ = database.Close() }()

	user := database.Client.User.Create().
		SetEmail("oauth-pending-postgres@example.com").
		SetWorkosUserID("oauth_pending_postgres_user").
		SaveX(ctx)
	sec := secrets.NewFromConfig(appconfig.Config{
		GoogleOAuthClientID:     "google-client",
		GoogleOAuthClientSecret: "google-secret",
		SlackClientID:           "slack-client",
		SlackClientSecret:       "slack-secret",
	})

	provider := oauthPendingProviderFixture(t)
	googleHandler := google.New(database.Client, sealer, sec, zap.NewNop())
	googleHandler.SetOAuthFlow("https://accounts.example/authorize", "https://api.example/oauth/google/callback", "rowboat", nil)
	googleHandler.SetTokenURL(provider.URL + "/google")
	slackHandler := slack.New(database.Client, sealer, sec, zap.NewNop())
	slackHandler.SetOAuthFlow("https://slack.example/authorize", provider.URL+"/slack", "https://api.example/oauth/slack/callback", "rowboat", "")

	t.Run("new Google writer callback and claim", func(t *testing.T) {
		state := startGooglePostgresFlow(t, googleHandler, user)
		assertPostgresPendingStateHashed(t, database.Client, "google", state)
		callbackGooglePostgresFlow(t, googleHandler, state, "google-new")
		claimGooglePostgresFlow(t, googleHandler, user, state)
	})

	t.Run("new Slack writer callback and claim", func(t *testing.T) {
		state := startSlackPostgresFlow(t, slackHandler, user)
		assertPostgresPendingStateHashed(t, database.Client, "slack", state)
		callbackSlackPostgresFlow(t, slackHandler, state, "slack-new")
		claimSlackPostgresFlow(t, slackHandler, user, state)
	})

	t.Run("pre-migration Google row remains consumable", func(t *testing.T) {
		state := "legacy-google-state-before-contract"
		assertPostgresPendingStateHashed(t, database.Client, "google", state)
		callbackGooglePostgresFlow(t, googleHandler, state, "google-legacy")
		claimGooglePostgresFlow(t, googleHandler, user, state)
	})

	t.Run("pre-migration Slack row remains consumable", func(t *testing.T) {
		state := "legacy-slack-state-before-contract"
		assertPostgresPendingStateHashed(t, database.Client, "slack", state)
		callbackSlackPostgresFlow(t, slackHandler, state, "slack-legacy")
		claimSlackPostgresFlow(t, slackHandler, user, state)
	})
}

func applyAllMigrationsAroundLegacyPendingRows(ctx context.Context, dsn string, sealer *crypto.Sealer) error {
	client, err := sqlclient.Open(ctx, dsn)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()
	revisions := &postgresRevisions{db: client.DB}
	if err := revisions.init(ctx); err != nil {
		return err
	}
	directory, err := atlasmigrate.NewLocalDir(postgresMigrationDir)
	if err != nil {
		return err
	}
	files, err := directory.Files()
	if err != nil {
		return err
	}
	if len(files) < 2 || files[len(files)-1].Name() != "20260828030000_connector_state_and_audit_contract.sql" {
		return fmt.Errorf("expected OAuth pending contract migration to be last, got %d migration(s)", len(files))
	}
	executor, err := atlasmigrate.NewExecutor(client.Driver, directory, revisions, atlasmigrate.WithAllowDirty(true))
	if err != nil {
		return err
	}
	if err := executor.ExecuteN(ctx, len(files)-1); err != nil {
		return fmt.Errorf("apply expand migrations: %w", err)
	}
	if err := insertLegacyOAuthPendingRows(ctx, client.DB, sealer); err != nil {
		return err
	}
	if err := executor.ExecuteN(ctx, 0); err != nil {
		return fmt.Errorf("apply contract migration: %w", err)
	}
	return nil
}

func insertLegacyOAuthPendingRows(ctx context.Context, database *sql.DB, sealer *crypto.Sealer) error {
	rows := []struct {
		id       string
		provider string
		state    string
		payload  map[string]any
	}{
		{
			id:       "10000000-0000-0000-0000-000000000001",
			provider: "google",
			state:    "legacy-google-state-before-contract",
			payload: map[string]any{
				"workos_user_id": "oauth_pending_postgres_user",
				"pkce_verifier":  "legacy-google-pkce-verifier",
			},
		},
		{
			id:       "10000000-0000-0000-0000-000000000002",
			provider: "slack",
			state:    "legacy-slack-state-before-contract",
			payload: map[string]any{
				"workos_user_id": "oauth_pending_postgres_user",
			},
		},
	}
	for _, row := range rows {
		encoded, err := json.Marshal(row.payload)
		if err != nil {
			return err
		}
		sealed, err := sealer.Seal(encoded)
		if err != nil {
			return err
		}
		if _, err := database.ExecContext(ctx, `
			INSERT INTO oauth_pendings (
				id, created_at, updated_at, state, provider, payload_encrypted, expires_at
			) VALUES ($1, now(), now(), $2, $3, $4, now() + interval '10 minutes')
		`, row.id, row.state, row.provider, sealed); err != nil {
			return fmt.Errorf("insert legacy %s pending row: %w", row.provider, err)
		}
	}
	return nil
}

func oauthPendingProviderFixture(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		form, _ := url.ParseQuery(string(body))
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/google":
			if form.Get("client_secret") != "google-secret" || form.Get("code_verifier") == "" {
				http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "ya29." + form.Get("code"),
				"refresh_token": "google-refresh-" + form.Get("code"),
				"expires_in":    3600,
				"scope":         "openid email",
				"token_type":    "Bearer",
			})
		case "/slack":
			if form.Get("client_secret") != "slack-secret" {
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "invalid_client"})
				return
			}
			teamID := "TEAM_NEW"
			teamName := "New Team"
			if form.Get("code") == "slack-legacy" {
				teamID = "TEAM_LEGACY"
				teamName = "Legacy Team"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":           true,
				"access_token": "xoxb-" + form.Get("code"),
				"scope":        "channels:history,channels:read",
				"bot_user_id":  "UBOT",
				"app_id":       "AAPP",
				"team":         map[string]any{"id": teamID, "name": teamName},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func startGooglePostgresFlow(t *testing.T, handler *google.Handler, user *ent.User) string {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/google-oauth/start", nil).
		WithContext(auth.WithUser(context.Background(), user))
	handler.Start(recorder, request)
	return stateFromStartResponse(t, recorder)
}

func startSlackPostgresFlow(t *testing.T, handler *slack.Handler, user *ent.User) string {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/slack-oauth/start", nil).
		WithContext(auth.WithUser(context.Background(), user))
	handler.Start(recorder, request)
	return stateFromStartResponse(t, recorder)
}

func stateFromStartResponse(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	if recorder.Code != http.StatusOK {
		t.Fatalf("start status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		AuthorizeURL string `json:"authorizeUrl"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	authorizeURL, err := url.Parse(response.AuthorizeURL)
	if err != nil {
		t.Fatal(err)
	}
	state := authorizeURL.Query().Get("state")
	if state == "" {
		t.Fatal("start response omitted state")
	}
	return state
}

func assertPostgresPendingStateHashed(t *testing.T, client *ent.Client, provider, state string) {
	t.Helper()
	stateHash := hashOAuthPendingState(state)
	pending := client.OAuthPending.Query().
		Where(oauthpending.ProviderEQ(provider), oauthpending.StateHashEQ(stateHash)).
		OnlyX(context.Background())
	if pending.State != "sha256:"+stateHash || pending.State == state {
		t.Fatalf("%s pending row retained raw state: state=%q hash=%q", provider, pending.State, pending.StateHash)
	}
}

func callbackGooglePostgresFlow(t *testing.T, handler *google.Handler, state, code string) {
	t.Helper()
	recorder := httptest.NewRecorder()
	target := "/oauth/google/callback?state=" + url.QueryEscape(state) + "&code=" + url.QueryEscape(code)
	handler.Callback(recorder, httptest.NewRequest(http.MethodGet, target, nil))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "status=success") {
		t.Fatalf("Google callback status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func callbackSlackPostgresFlow(t *testing.T, handler *slack.Handler, state, code string) {
	t.Helper()
	recorder := httptest.NewRecorder()
	target := "/oauth/slack/callback?state=" + url.QueryEscape(state) + "&code=" + url.QueryEscape(code)
	handler.Callback(recorder, httptest.NewRequest(http.MethodGet, target, nil))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "status=success") {
		t.Fatalf("Slack callback status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func claimGooglePostgresFlow(t *testing.T, handler *google.Handler, user *ent.User, state string) {
	t.Helper()
	claimOAuthPendingState(t, user, state, handler.Claim, "Google")
}

func claimSlackPostgresFlow(t *testing.T, handler *slack.Handler, user *ent.User, state string) {
	t.Helper()
	claimOAuthPendingState(t, user, state, handler.Claim, "Slack")
}

func claimOAuthPendingState(t *testing.T, user *ent.User, state string, claim http.HandlerFunc, provider string) {
	t.Helper()
	body := strings.NewReader(fmt.Sprintf(`{"session":%q}`, state))
	request := httptest.NewRequest(http.MethodPost, "/claim", body).
		WithContext(auth.WithUser(context.Background(), user))
	recorder := httptest.NewRecorder()
	claim(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("%s claim status=%d body=%s", provider, recorder.Code, recorder.Body.String())
	}
}

func hashOAuthPendingState(state string) string {
	digest := sha256.Sum256([]byte(state))
	return hex.EncodeToString(digest[:])
}
