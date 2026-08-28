import { Pool } from 'pg';
import { loadConfig } from './config.js';
import { buildApp, drainAuditOutbox, reconcileDecisions } from './server.js';
import { RowboatHooks } from './rowboat.js';
import { PostgresStateStore } from './state.js';
import { OryAdmin } from './ory.js';

const cfg = loadConfig();
const pool = new Pool({ connectionString: cfg.databaseUrl, max: 10 });
const store = new PostgresStateStore(pool, cfg.sessionTtlMs);
const hooks = new RowboatHooks(cfg.rowboatApi, cfg.upstreamTimeoutMs);
const ory = new OryAdmin(cfg.ory.adminUrl, cfg.upstreamTimeoutMs);
const app = buildApp(cfg, { store, hooks, ory });
const retryTimer = setInterval(
  () =>
    void drainAuditOutbox(store, hooks).catch((error) =>
      console.error(
        JSON.stringify({
          record_class: 'operational_diagnostic',
          delivery_guarantee: 'best_effort',
          msg: 'audit outbox drain failed',
          error: error instanceof Error ? error.message : 'unknown',
        }),
      ),
    ),
  cfg.auditRetryIntervalMs,
);
retryTimer.unref();
const reconcileTimer = setInterval(
  () =>
    void reconcileDecisions(store, ory, hooks, 25, cfg.decisionLeaseMs).catch(
      logBackground('decision reconciliation failed'),
    ),
  cfg.auditRetryIntervalMs,
);
const cleanupTimer = setInterval(() => void store.cleanup().catch(logBackground('state cleanup failed')), 60_000);
reconcileTimer.unref();
cleanupTimer.unref();

const server = app.listen(cfg.port, () => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ msg: 'oauth-consent listening', port: cfg.port }));
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    clearInterval(retryTimer);
    clearInterval(reconcileTimer);
    clearInterval(cleanupTimer);
    server.close(() => void pool.end().finally(() => process.exit(0)));
  });
}

function logBackground(msg: string) {
  return (error: unknown) =>
    console.error(
      JSON.stringify({
        record_class: 'operational_diagnostic',
        delivery_guarantee: 'best_effort',
        msg,
        error: error instanceof Error ? error.message : 'unknown',
      }),
    );
}
