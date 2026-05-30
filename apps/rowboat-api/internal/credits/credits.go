// Package credits holds credit-accounting math shared by the billing handler
// and the quota gate. available = subscription.sanctioned + SUM(ledger.delta).
package credits

import (
	"context"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/creditledger"
)

// LedgerSum returns SUM(delta) over the current viewer's ledger entries. The
// query is tenant-scoped by the db interceptor, so it must run with a user (or
// internal flag) in context. Returns 0 when the ledger is empty.
func LedgerSum(ctx context.Context, client *ent.Client) (int, error) {
	var rows []struct {
		Total *int `json:"total"`
	}
	err := client.CreditLedger.Query().
		Aggregate(ent.As(ent.Sum(creditledger.FieldDelta), "total")).
		Scan(ctx, &rows)
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 || rows[0].Total == nil {
		return 0, nil
	}
	return *rows[0].Total, nil
}

// Available = sanctioned + SUM(ledger.delta). Never returns < 0.
func Available(ctx context.Context, client *ent.Client, sanctioned int) (int, error) {
	sum, err := LedgerSum(ctx, client)
	if err != nil {
		return 0, err
	}
	available := sanctioned + sum
	if available < 0 {
		available = 0
	}
	return available, nil
}
