import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import { createConnection, type AddressInfo, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { buildApp } from '../src/server.js';
import {
  DrainState,
  installShutdownSignalHandlers,
  ShutdownCoordinator,
  type ShutdownResult,
} from '../src/shutdown.js';
import { StateStore } from '../src/state.js';

const config: Config = {
  port: 3000,
  cookieSecret: 'shutdown-cookie-secret-that-is-at-least-thirty-two-bytes',
  cookieSecure: false,
  sessionTtlMs: 60_000,
  upstreamTimeoutMs: 1_000,
  databaseUrl: 'postgres://unused',
  auditRetryIntervalMs: 1_000,
  decisionLeaseMs: 1_000,
  shutdownDeadlineMs: 1_000,
  ory: { adminUrl: 'https://unused.test' },
  workos: {
    clientId: 'desktop',
    apiKey: 'unused',
    issuer: 'https://unused.test',
    redirectUri: 'https://unused.test/callback',
    stepUpRedirectUri: 'https://unused.test/step-up/callback',
    stepUpAcr: 'urn:test:mfa',
    stepUpAmr: 'mfa',
  },
  rowboatApi: {
    baseUrl: 'https://unused.test',
    hookSecret: 'shutdown-hook-secret-that-is-at-least-thirty-two-bytes',
    contextPath: '/context',
    auditPath: '/audit',
    signatureMaxAgeMs: 300_000,
  },
};

const servers: Server[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections?.();
        }),
    ),
  );
});

describe('authorization draining and signal shutdown', () => {
  it('fails readiness immediately and rejects new authorization admission while keeping liveness available', async () => {
    const drain = new DrainState();
    const server = await listen(createServer(buildApp(config, { store: new StateStore(60_000), drain })));

    expect((await fetch(`${server.url}/readyz`)).status).toBe(200);
    const preStop = await fetch(`${server.url}/drainz`, { method: 'POST' });
    expect(preStop.status).toBe(202);
    expect(await preStop.json()).toEqual({ status: 'draining' });
    expect(drain.begin()).toBe(false);

    const [ready, admitted, live] = await Promise.all([
      fetch(`${server.url}/readyz`),
      fetch(`${server.url}/login?login_challenge=blocked`),
      fetch(`${server.url}/healthz`),
    ]);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: 'draining' });
    expect(admitted.status).toBe(503);
    expect(admitted.headers.get('connection')).toBe('close');
    expect(admitted.headers.get('retry-after')).toBe('5');
    expect(await admitted.json()).toEqual({ error: 'service_draining' });
    expect(live.status).toBe(200);
  });

  it('handles SIGTERM once, closes a held HTTP connection, and forces completion when PostgreSQL drain hangs', async () => {
    const drain = new DrainState();
    const running = await listen(
      createServer((_req, _res) => {
        // Deliberately never complete the accepted request.
      }),
    );
    const socket = createConnection(Number(new URL(running.url).port), '127.0.0.1');
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.write('GET /held HTTP/1.1\r\nHost: localhost\r\n\r\n');

    let poolEndCalls = 0;
    const pool = {
      end: () => {
        poolEndCalls += 1;
        return new Promise<void>(() => undefined);
      },
    };
    const coordinator = new ShutdownCoordinator({
      drain,
      server: running.server,
      pool,
      timers: [],
      deadlineMs: 160,
    });
    const signals = new EventEmitter();
    const completions: ShutdownResult[] = [];
    const dispose = installShutdownSignalHandlers(coordinator, signals, (result) => void completions.push(result));
    const socketClosed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    const startedAt = Date.now();

    signals.emit('SIGTERM');
    signals.emit('SIGTERM');
    expect(drain.isDraining()).toBe(true);
    const first = coordinator.begin('SIGINT');
    const second = coordinator.begin('SIGTERM');
    expect(first).toBe(second);

    const result = await first;
    await socketClosed;
    await new Promise((resolve) => setImmediate(resolve));
    dispose();

    expect(result).toEqual({ signal: 'SIGTERM', mode: 'forced-deadline' });
    expect(completions).toEqual([result]);
    expect(poolEndCalls).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});

async function listen(server: Server): Promise<{ url: string; server: Server }> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, server };
}
