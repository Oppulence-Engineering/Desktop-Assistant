package revenue

import (
	"context"
	"time"

	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/email"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenuemetrics"
)

// DigestConfig bounds the proactive-digest sweeper.
type DigestConfig struct {
	Interval    time.Duration // how often to look for users due a digest
	MinPerUser  time.Duration // minimum time between digests for one user
	MaxPerCycle int
	AppURL      string // dashboard base for the email CTA
}

// DigestSender periodically emails each user with open revenue actions a
// summary of their slipping deals. Ships dark: the scheduler only starts it
// when REVENUE_DIGEST_ENABLED is on and an email provider is configured.
type DigestSender struct {
	svc   *Service
	email email.Sender
	cfg   DigestConfig
	log   *zap.Logger
}

// NewDigestSender builds the sweeper, filling default bounds.
func NewDigestSender(svc *Service, sender email.Sender, cfg DigestConfig, log *zap.Logger) *DigestSender {
	if cfg.Interval <= 0 {
		cfg.Interval = time.Hour
	}
	if cfg.MinPerUser <= 0 {
		cfg.MinPerUser = 7 * 24 * time.Hour
	}
	if cfg.MaxPerCycle <= 0 {
		cfg.MaxPerCycle = 200
	}
	return &DigestSender{svc: svc, email: sender, cfg: cfg, log: log}
}

// Run sweeps on Interval until the context is cancelled.
func (d *DigestSender) Run(ctx context.Context) error {
	if !d.email.Enabled() {
		d.log.Warn("revenue digest sender not started: no email provider configured")
		return nil
	}
	d.log.Info("revenue digest sender started",
		zap.Duration("interval", d.cfg.Interval), zap.Duration("min_per_user", d.cfg.MinPerUser))
	ticker := time.NewTicker(d.cfg.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			d.sweep(ctx)
		}
	}
}

func (d *DigestSender) sweep(ctx context.Context) {
	ictx := auth.WithInternal(ctx)
	cutoff := d.svc.now().Add(-d.cfg.MinPerUser)

	// Candidates: users with at least one OPEN action, whose workspace was not
	// digested since the cutoff. The cross-tenant discovery runs internal.
	users, err := d.svc.client.User.Query().
		Where(
			user.HasRevenueActionsWith(revenueaction.QueueStatusEQ(QueueOpen)),
			user.HasRevenueWorkspacesWith(
				revenueworkspace.Or(
					revenueworkspace.LastDigestAtIsNil(),
					revenueworkspace.LastDigestAtLT(cutoff),
				),
			),
		).
		Limit(d.cfg.MaxPerCycle).
		All(ictx)
	if err != nil {
		d.log.Warn("revenue digest: list candidates", zap.Error(err))
		return
	}

	sent := 0
	for _, u := range users {
		if ctx.Err() != nil {
			return
		}
		if u.Email == "" {
			continue
		}
		if d.sendOne(ctx, u) {
			sent++
		}
	}
	if sent > 0 {
		d.log.Info("revenue digest sweep", zap.Int("candidates", len(users)), zap.Int("sent", sent))
	}
}

// sendOne composes and delivers one user's digest, then stamps the workspace.
// Returns whether an email was sent. It stamps last_digest_at even on an empty
// digest so an idle user is not re-checked every cycle.
func (d *DigestSender) sendOne(ctx context.Context, u *ent.User) bool {
	uctx := auth.WithUser(ctx, u)
	ws, err := d.svc.CurrentWorkspace(uctx, u)
	if err != nil {
		return false
	}
	dg, err := d.svc.Digest(uctx, u)
	if err != nil {
		d.log.Debug("revenue digest: compose", zap.String("user", u.ID.String()), zap.Error(err))
		return false
	}
	if dg.Empty() {
		_ = d.stamp(uctx, ws)
		return false
	}
	subject, htmlBody, textBody := RenderDigest(dg, d.cfg.AppURL)
	if err := d.email.Send(ctx, email.Message{
		To: u.Email, Subject: subject, HTML: htmlBody, Text: textBody,
	}); err != nil {
		d.log.Warn("revenue digest: send failed", zap.String("user", u.ID.String()), zap.Error(err))
		return false
	}
	_ = d.stamp(uctx, ws)
	revenuemetrics.DigestsSent.Inc()
	return true
}

func (d *DigestSender) stamp(ctx context.Context, ws *ent.RevenueWorkspace) error {
	return d.svc.client.RevenueWorkspace.UpdateOneID(ws.ID).
		SetLastDigestAt(d.svc.now()).
		Exec(ctx)
}
