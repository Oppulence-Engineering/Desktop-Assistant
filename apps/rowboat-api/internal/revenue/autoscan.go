package revenue

import (
	"context"
	"errors"
	"time"

	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueleakscan"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenuemetrics"
)

// AutoScanConfig bounds the background revenue-scan sweeper.
type AutoScanConfig struct {
	// Interval is how often the sweeper wakes to look for due users.
	Interval time.Duration
	// MinPerUser is the minimum time between automatic scans for one user;
	// a user whose last scan started more recently than this is skipped.
	MinPerUser time.Duration
	// MaxPerCycle caps how many users a single sweep may start scans for, so
	// one tick cannot fan out unboundedly.
	MaxPerCycle int
	// LookbackDays is the window a first (non-incremental) auto scan reads.
	LookbackDays int
	// RetentionMonths prunes Layer-1 mail-index rows older than this on each
	// sweep (RFC 031 retention). Zero disables pruning.
	RetentionMonths int
}

// AutoScanner periodically runs an incremental leak scan for every user with a
// connected Google account. It reuses Service.StartScan, so each scan inherits
// the same bounds, dedupe, and incremental cursor as an operator-triggered one.
// Ships dark: the scheduler only starts it when REVENUE_AUTO_SCAN_ENABLED is on.
type AutoScanner struct {
	svc *Service
	cfg AutoScanConfig
	log *zap.Logger
}

// NewAutoScanner builds the sweeper. Defaults fill any unset config field.
func NewAutoScanner(svc *Service, cfg AutoScanConfig, log *zap.Logger) *AutoScanner {
	if cfg.Interval <= 0 {
		cfg.Interval = time.Hour
	}
	if cfg.MinPerUser <= 0 {
		cfg.MinPerUser = 24 * time.Hour
	}
	if cfg.MaxPerCycle <= 0 {
		cfg.MaxPerCycle = 200
	}
	if cfg.LookbackDays <= 0 {
		cfg.LookbackDays = defaultLookback
	}
	return &AutoScanner{svc: svc, cfg: cfg, log: log}
}

// Run sweeps on Interval until the context is cancelled. Safe to run on
// multiple replicas: the per-user due check keys on the last scan's start
// time, so a scan another replica just started makes the user look not-due,
// and Service.StartScan rejects any residual concurrent start.
func (a *AutoScanner) Run(ctx context.Context) error {
	a.log.Info("revenue auto-scan sweeper started",
		zap.Duration("interval", a.cfg.Interval),
		zap.Duration("min_per_user", a.cfg.MinPerUser))
	ticker := time.NewTicker(a.cfg.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			a.sweep(ctx)
		}
	}
}

func (a *AutoScanner) sweep(ctx context.Context) {
	// Candidate discovery is a system query across tenants.
	ictx := auth.WithInternal(ctx)
	recoveryUsers, err := a.svc.client.User.Query().
		Where(user.HasCommitmentsWith(
			commitment.StatusEQ("open"),
			commitment.DueAtLTE(a.svc.now().Add(72*time.Hour)),
			commitment.Or(commitment.UserConfirmedEQ(true), commitment.AcceptanceNEQ("candidate")),
		)).
		Order(ent.Asc(user.FieldCreatedAt)).
		Limit(a.cfg.MaxPerCycle).
		All(ictx)
	if err != nil {
		a.log.Warn("commitment recovery: list candidates", zap.Error(err))
	} else {
		for _, u := range recoveryUsers {
			if ctx.Err() != nil {
				return
			}
			if _, err := a.svc.ReconcileDueCommitments(auth.WithUser(ctx, u), u, nil); err != nil {
				a.log.Debug("commitment recovery sweep", zap.String("user", u.ID.String()), zap.Error(err))
			}
		}
	}

	// Mail leak scanning remains restricted to users with a connected Google account.
	cutoff := a.svc.now().Add(-a.cfg.MinPerUser)
	users, err := a.svc.client.User.Query().
		Where(
			user.HasOauthConnectionsWith(oauthconnection.ProviderEQ("google")),
			// Apply due-ness before LIMIT. The old order selected the oldest 200
			// connected users and only then skipped recent scans in Go, which
			// could permanently hide every later account.
			user.Not(user.HasRevenueLeakScansWith(revenueleakscan.StartedAtGTE(cutoff))),
		).
		Order(ent.Asc(user.FieldCreatedAt)).
		Limit(a.cfg.MaxPerCycle).
		All(ictx)
	if err != nil {
		a.log.Warn("revenue auto-scan: list candidates", zap.Error(err))
		return
	}
	started := 0
	for _, u := range users {
		if ctx.Err() != nil {
			return
		}
		// Each scan runs under the owning user's context so tenancy scoping
		// and the workspace get-or-create resolve to that user.
		uctx := auth.WithUser(ctx, u)
		if _, err := a.svc.StartScan(uctx, u, a.cfg.LookbackDays); err != nil {
			// scan_unavailable (already running, or Gmail not connected mid-flight)
			// is expected and benign; anything else is worth a debug line.
			if !isScanUnavailable(err) {
				a.log.Debug("revenue auto-scan: start", zap.String("user", u.ID.String()), zap.Error(err))
			}
			continue
		}
		started++
		revenuemetrics.AutoScansStarted.Inc()
	}
	if started > 0 {
		a.log.Info("revenue auto-scan sweep", zap.Int("candidates", len(users)), zap.Int("started", started))
	}

	// RFC 031 retention: prune Layer-1 mail-index rows past the window and any
	// expired Layer-3 body-cache rows. Cross-tenant maintenance deletes keyed
	// on age, so they run internal.
	if a.cfg.RetentionMonths > 0 {
		cutoff := a.svc.now().AddDate(0, -a.cfg.RetentionMonths, 0)
		if n, err := a.svc.SweepMailRetention(ictx, cutoff); err != nil {
			a.log.Warn("revenue mail retention sweep", zap.Error(err))
		} else if n > 0 {
			a.log.Info("revenue mail retention pruned", zap.Int("rows", n))
		}
	}
	if n, err := a.svc.SweepBodyCache(ictx, a.svc.now()); err != nil {
		a.log.Warn("revenue body-cache sweep", zap.Error(err))
	} else if n > 0 {
		a.log.Info("revenue body cache pruned", zap.Int("rows", n))
	}
}

func isScanUnavailable(err error) bool {
	// StartScan wraps ErrScanUnavailable with fmt.Errorf("%w: ...").
	return errors.Is(err, ErrScanUnavailable)
}
