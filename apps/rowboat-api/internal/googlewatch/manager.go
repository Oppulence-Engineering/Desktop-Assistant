// Package googlewatch keeps Google push subscriptions alive (RFC 003): for
// every connected Google account it registers — and renews before expiry —
// the Gmail users.watch and the Calendar events channel that make Google
// deliver pushes to /v1/webhooks/google. Without this manager the webhook is
// a working endpoint that Google never calls.
//
// It runs as a periodic loop in the scheduler process. Cross-replica safety:
// the unique (user, kind) index guards creation, and a renewal-claim CAS on
// the row guards renewal, so two replicas can never mint duplicate Calendar
// channels (which would duplicate every event downstream).
package googlewatch

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/googlewatch"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Watch kinds (mirror the GoogleWatch schema enum).
const (
	KindGmail    = "gmail"
	KindCalendar = "calendar"

	// claimTTL bounds how long a renewal claim excludes other replicas. A
	// renewal is a couple of HTTP calls; a claim older than this belongs to a
	// crashed renewer and may be stolen.
	claimTTL = 10 * time.Minute
)

// Config tunes the manager.
type Config struct {
	GmailPubSubTopic string        // projects/{p}/topics/{t}; empty → skip Gmail watches
	WebhookURL       string        // public address Calendar channels push to
	ChannelToken     string        // X-Goog-Channel-Token the webhook verifies
	RenewMargin      time.Duration // renew registrations expiring within this window
	Interval         time.Duration // Run loop cadence

	// Endpoint overrides (dev mocks); empty → real Google endpoints.
	TokenURL        string
	GmailBaseURL    string
	CalendarBaseURL string
}

// Manager owns watch registration and renewal.
type Manager struct {
	client  *ent.Client
	sealer  *crypto.Sealer
	secrets *secrets.Store
	google  *googleapi.Client
	cfg     Config
	log     *zap.Logger
	now     func() time.Time
}

// New builds a Manager, applying endpoint defaults.
func New(client *ent.Client, sealer *crypto.Sealer, sec *secrets.Store, cfg Config, log *zap.Logger) *Manager {
	if cfg.RenewMargin <= 0 {
		cfg.RenewMargin = 24 * time.Hour
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 15 * time.Minute
	}
	if log == nil {
		log = zap.NewNop()
	}
	return &Manager{
		client:  client,
		sealer:  sealer,
		secrets: sec,
		google: googleapi.New(googleapi.Config{
			TokenURL:        cfg.TokenURL,
			GmailBaseURL:    cfg.GmailBaseURL,
			CalendarBaseURL: cfg.CalendarBaseURL,
		}),
		cfg: cfg,
		log: log,
		now: time.Now,
	}
}

// SetClock overrides the clock (tests only).
func (m *Manager) SetClock(clock func() time.Time) {
	if clock != nil {
		m.now = clock
	}
}

// Run drives the renewal loop until ctx is cancelled. It scans once
// immediately and then every Interval.
func (m *Manager) Run(ctx context.Context) error {
	m.log.Info("google watch manager starting",
		zap.Duration("interval", m.cfg.Interval),
		zap.Duration("renew_margin", m.cfg.RenewMargin),
		zap.Bool("gmail", m.cfg.GmailPubSubTopic != ""))
	m.scan(ctx)
	ticker := time.NewTicker(m.cfg.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			m.log.Info("google watch manager stopping")
			return nil
		case <-ticker.C:
			m.scan(ctx)
		}
	}
}

func (m *Manager) scan(ctx context.Context) {
	if err := m.RenewDue(ctx); err != nil {
		m.log.Error("google watch scan failed", zap.Error(err))
	}
}

// RenewDue is one full pass: bootstrap watches for connections that lack
// them, renew registrations expiring within RenewMargin, and sweep watch rows
// whose Google connection is gone (disconnect).
func (m *Manager) RenewDue(ctx context.Context) error {
	ctx = auth.WithInternal(ctx)

	conns, err := m.client.OAuthConnection.Query().
		Where(
			oauthconnection.ProviderEQ("google"),
			oauthconnection.ExternalAccountIDNEQ(""),
		).
		WithUser().
		All(ctx)
	if err != nil {
		return fmt.Errorf("scan google connections: %w", err)
	}

	connected := make(map[uuid.UUID]*ent.OAuthConnection, len(conns))
	for _, conn := range conns {
		owner := conn.Edges.User
		if owner == nil {
			continue
		}
		connected[owner.ID] = conn

		kinds := []string{KindCalendar}
		if m.cfg.GmailPubSubTopic != "" {
			kinds = append(kinds, KindGmail)
		}
		for _, kind := range kinds {
			if err := m.ensureWatch(ctx, owner, conn, kind); err != nil {
				m.log.Warn("google watch ensure failed",
					zap.String("kind", kind),
					zap.String("account", conn.ExternalAccountID),
					zap.Error(err))
			}
		}
	}

	return m.sweepOrphans(ctx, connected)
}

// ensureWatch creates or renews one (user, kind) registration.
func (m *Manager) ensureWatch(ctx context.Context, owner *ent.User, conn *ent.OAuthConnection, kind string) error {
	now := m.now().UTC()
	row, err := m.client.GoogleWatch.Query().
		Where(googlewatch.KindEQ(kind), googlewatch.HasUserWith(user.IDEQ(owner.ID))).
		Only(ctx)
	switch {
	case ent.IsNotFound(err):
		// Fresh row, claimed at insert: the unique (user, kind) index makes a
		// concurrent replica's insert fail, so exactly one creator proceeds to
		// call Google.
		row, err = m.client.GoogleWatch.Create().
			SetUser(owner).
			SetKind(kind).
			SetAccountEmail(conn.ExternalAccountID).
			SetExpiresAt(time.Unix(0, 0).UTC()).
			SetRenewClaimedAt(now).
			Save(ctx)
		if err != nil {
			if ent.IsConstraintError(err) {
				return nil // another replica owns the bootstrap
			}
			return err
		}
	case err != nil:
		return err
	default:
		if row.ExpiresAt.After(now.Add(m.cfg.RenewMargin)) {
			return nil // healthy, not due
		}
		// Renewal-claim CAS: exactly one replica proceeds. A stale claim
		// (crashed renewer) may be stolen after claimTTL.
		n, cerr := m.client.GoogleWatch.Update().
			Where(
				googlewatch.IDEQ(row.ID),
				googlewatch.Or(
					googlewatch.RenewClaimedAtIsNil(),
					googlewatch.RenewClaimedAtLT(now.Add(-claimTTL)),
				),
			).
			SetRenewClaimedAt(now).
			Save(ctx)
		if cerr != nil {
			return cerr
		}
		if n == 0 {
			return nil // a peer holds the claim
		}
	}

	if err := m.register(ctx, conn, kind, row); err != nil {
		metricFailures.WithLabelValues(kind, stageOf(err)).Inc()
		// Record the failure and release the claim so the next tick retries;
		// an invalid_grant stays recorded until the user reconnects (which
		// rewrites the connection's refresh token).
		if uerr := row.Update().
			SetLastError(truncateErr(err)).
			ClearRenewClaimedAt().
			Exec(ctx); uerr != nil {
			m.log.Error("google watch record failure", zap.Error(uerr))
		}
		return err
	}
	metricRenewals.WithLabelValues(kind).Inc()
	return nil
}

// register performs the Google-side registration for one kind and persists
// the result on the row.
func (m *Manager) register(ctx context.Context, conn *ent.OAuthConnection, kind string, row *ent.GoogleWatch) error {
	token, err := m.google.AccessTokenForConnection(ctx, m.sealer, m.secrets, conn)
	if err != nil {
		if errors.Is(err, googleapi.ErrReconnectRequired) {
			return errReconnectRequired
		}
		return err
	}
	switch kind {
	case KindGmail:
		return m.registerGmail(ctx, token, conn, row)
	case KindCalendar:
		return m.registerCalendar(ctx, token, conn, row)
	default:
		return fmt.Errorf("unknown watch kind %q", kind)
	}
}

// gmailWatchResponse: historyId/expiration arrive as decimal strings.
type googleWatchResponse struct {
	HistoryID  string `json:"historyId"`
	ResourceID string `json:"resourceId"`
	Expiration string `json:"expiration"` // ms since epoch
}

func (m *Manager) registerGmail(ctx context.Context, token string, conn *ent.OAuthConnection, row *ent.GoogleWatch) error {
	body := map[string]any{
		"topicName": m.cfg.GmailPubSubTopic,
		// INBOX keeps push volume proportional to mail the user actually sees.
		"labelIds": []string{"INBOX"},
	}
	var resp googleWatchResponse
	if err := m.google.PostJSON(ctx, token, m.google.GmailBaseURL()+"/gmail/v1/users/me/watch", body, &resp); err != nil {
		return fmt.Errorf("gmail users.watch: %w", err)
	}
	exp, err := parseMsEpoch(resp.Expiration)
	if err != nil {
		return fmt.Errorf("gmail watch expiration: %w", err)
	}
	return row.Update().
		SetAccountEmail(conn.ExternalAccountID).
		SetHistoryID(resp.HistoryID).
		SetExpiresAt(exp).
		ClearLastError().
		ClearRenewClaimedAt().
		Exec(ctx)
}

func (m *Manager) registerCalendar(ctx context.Context, token string, conn *ent.OAuthConnection, row *ent.GoogleWatch) error {
	// Renewal means a NEW channel: Calendar channels cannot be extended. Stop
	// the old one best-effort first (an expired/unknown channel 404s; fine).
	if row.ChannelID != "" && row.ResourceID != "" {
		stopBody := map[string]any{"id": row.ChannelID, "resourceId": row.ResourceID}
		if err := m.google.PostJSON(ctx, token, m.google.CalendarBaseURL()+"/channels/stop", stopBody, nil); err != nil {
			m.log.Warn("calendar channel stop failed (continuing)",
				zap.String("channelId", row.ChannelID), zap.Error(err))
		}
	}

	// The channel id carries the watched account — /v1/webhooks/google parses
	// this exact "gcal:{email}:{uuid}" format for user resolution.
	channelID := "gcal:" + conn.ExternalAccountID + ":" + uuid.NewString()
	body := map[string]any{
		"id":      channelID,
		"type":    "web_hook",
		"address": m.cfg.WebhookURL,
		"token":   m.cfg.ChannelToken,
	}
	var resp googleWatchResponse
	if err := m.google.PostJSON(ctx, token, m.google.CalendarBaseURL()+"/calendars/primary/events/watch", body, &resp); err != nil {
		return fmt.Errorf("calendar events.watch: %w", err)
	}
	exp, err := parseMsEpoch(resp.Expiration)
	if err != nil {
		return fmt.Errorf("calendar watch expiration: %w", err)
	}
	return row.Update().
		SetAccountEmail(conn.ExternalAccountID).
		SetChannelID(channelID).
		SetResourceID(resp.ResourceID).
		SetExpiresAt(exp).
		ClearLastError().
		ClearRenewClaimedAt().
		Exec(ctx)
}

// sweepOrphans deletes watch rows whose user no longer has a Google
// connection (disconnect/reconnect-elsewhere). The Google-side channel cannot
// be stopped without a valid token, so it is left to expire on its own — the
// webhook drops its (now unresolvable) pushes meanwhile.
func (m *Manager) sweepOrphans(ctx context.Context, connected map[uuid.UUID]*ent.OAuthConnection) error {
	rows, err := m.client.GoogleWatch.Query().WithUser().All(ctx)
	if err != nil {
		return fmt.Errorf("scan watches: %w", err)
	}
	for _, row := range rows {
		owner := row.Edges.User
		if owner == nil {
			continue
		}
		if _, ok := connected[owner.ID]; ok {
			continue
		}
		if err := m.client.GoogleWatch.DeleteOne(row).Exec(ctx); err != nil {
			m.log.Error("google watch orphan delete failed", zap.Error(err))
			continue
		}
		metricOrphansSwept.Inc()
		m.log.Info("google watch removed for disconnected account",
			zap.String("kind", row.Kind), zap.String("account", row.AccountEmail))
	}
	return nil
}

// errReconnectRequired marks a dead refresh token: retrying cannot fix it,
// only a user reconnect can (which rewrites the connection row).
var errReconnectRequired = errors.New("googlewatch: invalid_grant; user must reconnect Google")

// parseMsEpoch parses Google's decimal-string millisecond timestamps.
func parseMsEpoch(s string) (time.Time, error) {
	ms, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return time.Time{}, err
	}
	return time.UnixMilli(ms).UTC(), nil
}

func stageOf(err error) string {
	if errors.Is(err, errReconnectRequired) {
		return "invalid_grant"
	}
	return "register"
}

func truncateErr(err error) string {
	s := err.Error()
	if len(s) > 300 {
		s = s[:300]
	}
	return s
}
