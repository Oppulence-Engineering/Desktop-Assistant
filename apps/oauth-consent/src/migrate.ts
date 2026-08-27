import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['oauth-consent-migrations']);
    await client.query(
      `CREATE TABLE IF NOT EXISTS oauth_consent_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const name = '20260827210000_shared_state_and_audit_outbox.sql';
    const exists = await client.query('SELECT 1 FROM oauth_consent_schema_migrations WHERE name=$1', [name]);
    if (!exists.rowCount) {
      await client.query('BEGIN');
      await client.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
      await client.query('INSERT INTO oauth_consent_schema_migrations(name) VALUES ($1)', [name]);
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['oauth-consent-migrations']).catch(() => undefined);
    client.release();
  }
} finally {
  await pool.end();
}
