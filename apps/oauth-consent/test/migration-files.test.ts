import { describe, expect, it } from 'vitest';
import { migrationFiles } from '../src/migration-files.js';

describe('oauth-consent migration discovery', () => {
  it('includes every ordered SQL migration, including authoritative consent outcomes', async () => {
    expect(await migrationFiles()).toEqual([
      '20260827210000_shared_state_and_audit_outbox.sql',
      '20260827220700_final_review_b_remediations.sql',
      '20260827232500_irreversible_outcomes_and_login_leases.sql',
      '20260828035100_authoritative_consent_outcomes.sql',
    ]);
  });
});
