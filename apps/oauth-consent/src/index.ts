import { loadConfig } from './config.js';
import { buildApp } from './server.js';

const cfg = loadConfig();
const app = buildApp(cfg);

const server = app.listen(cfg.port, () => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ msg: 'oauth-consent listening', port: cfg.port }));
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
