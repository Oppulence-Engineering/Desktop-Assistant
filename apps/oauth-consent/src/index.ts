import { Pool } from 'pg';
import { loadConfig } from './config.js';
import { buildApp, drainAuditOutbox } from './server.js';
import { RowboatHooks } from './rowboat.js';
import { PostgresStateStore } from './state.js';

const cfg = loadConfig();
const pool = new Pool({ connectionString: cfg.databaseUrl, max: 10 });
const store = new PostgresStateStore(pool, cfg.sessionTtlMs);
const hooks = new RowboatHooks(cfg.rowboatApi, cfg.upstreamTimeoutMs);
const app = buildApp(cfg, { store, hooks });
const retryTimer = setInterval(
  () =>
    void drainAuditOutbox(store, hooks).catch((error) =>
      console.error(
        JSON.stringify({ msg: 'audit outbox drain failed', error: error instanceof Error ? error.message : 'unknown' }),
      ),
    ),
  cfg.auditRetryIntervalMs,
);
retryTimer.unref();

const server = app.listen(cfg.port, () => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ msg: 'oauth-consent listening', port: cfg.port }));
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    clearInterval(retryTimer);
    server.close(() => void pool.end().finally(() => process.exit(0)));
  });
}
