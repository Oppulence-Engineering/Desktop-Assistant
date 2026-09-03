import type { Server } from 'node:http';
import type { Pool } from 'pg';

export type ShutdownSignal = 'SIGINT' | 'SIGTERM';
export type ShutdownMode = 'graceful' | 'forced-http' | 'forced-deadline';

export interface ShutdownResult {
  signal: ShutdownSignal;
  mode: ShutdownMode;
}

interface ShutdownOptions {
  drain: DrainState;
  server: Server;
  pool: Pick<Pool, 'end'>;
  timers: Array<ReturnType<typeof setInterval>>;
  deadlineMs: number;
  log?: (record: Record<string, unknown>) => void;
}

interface SignalSource {
  on(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
}

/** Shared process state used by readiness, admission, and signal shutdown. */
export class DrainState {
  private draining = false;

  begin(): boolean {
    if (this.draining) return false;
    this.draining = true;
    return true;
  }

  isDraining(): boolean {
    return this.draining;
  }
}

/**
 * Performs shutdown exactly once. HTTP receives most of the application
 * deadline, while the final quarter is reserved for PostgreSQL pool draining.
 * The process-level caller may exit after the returned promise resolves, even
 * when a broken connection or pool operation required forced completion.
 */
export class ShutdownCoordinator {
  private shutdown?: Promise<ShutdownResult>;

  constructor(private readonly options: ShutdownOptions) {}

  begin(signal: ShutdownSignal): Promise<ShutdownResult> {
    if (this.shutdown) return this.shutdown;

    this.options.drain.begin();
    for (const timer of this.options.timers) clearInterval(timer);
    this.options.log?.({ msg: 'oauth-consent draining', signal, deadline_ms: this.options.deadlineMs });
    this.shutdown = this.run(signal);
    return this.shutdown;
  }

  private run(signal: ShutdownSignal): Promise<ShutdownResult> {
    const { server, pool, deadlineMs } = this.options;
    const poolReserveMs = Math.max(100, Math.min(5_000, Math.floor(deadlineMs / 4)));
    const httpDeadlineMs = Math.max(1, deadlineMs - poolReserveMs);
    let forcedHttp = false;
    let poolDrain: Promise<void> | undefined;

    const startPoolDrain = (): Promise<void> => {
      poolDrain ??= pool.end().catch((error: unknown) => {
        this.options.log?.({
          msg: 'oauth-consent PostgreSQL pool drain failed',
          error: error instanceof Error ? error.message : 'unknown',
        });
      });
      return poolDrain;
    };

    const httpClosed = new Promise<void>((resolve) => {
      try {
        server.close((error) => {
          if (error) {
            this.options.log?.({ msg: 'oauth-consent HTTP drain failed', error: error.message });
          }
          resolve();
        });
      } catch (error) {
        this.options.log?.({
          msg: 'oauth-consent HTTP drain failed',
          error: error instanceof Error ? error.message : 'unknown',
        });
        resolve();
      }
    });

    const graceful = httpClosed
      .then(startPoolDrain)
      .then((): ShutdownResult => ({ signal, mode: forcedHttp ? 'forced-http' : 'graceful' }));

    return new Promise<ShutdownResult>((resolve) => {
      let settled = false;
      const finish = (result: ShutdownResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(httpDeadline);
        clearTimeout(applicationDeadline);
        this.options.log?.({ msg: 'oauth-consent shutdown complete', signal, mode: result.mode });
        resolve(result);
      };

      const httpDeadline = setTimeout(() => {
        forcedHttp = true;
        server.closeAllConnections?.();
        void startPoolDrain();
      }, httpDeadlineMs);

      const applicationDeadline = setTimeout(() => {
        server.closeAllConnections?.();
        void startPoolDrain();
        finish({ signal, mode: 'forced-deadline' });
      }, deadlineMs);

      void graceful.then(finish);
    });
  }
}

export function installShutdownSignalHandlers(
  coordinator: ShutdownCoordinator,
  signalSource: SignalSource = process,
  onComplete: (result: ShutdownResult) => void = () => process.exit(0),
): () => void {
  let completion: Promise<void> | undefined;
  const listeners = new Map<ShutdownSignal, () => void>();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const listener = () => {
      const shutdown = coordinator.begin(signal);
      completion ??= shutdown.then(onComplete);
    };
    listeners.set(signal, listener);
    signalSource.on(signal, listener);
  }

  return () => {
    for (const [signal, listener] of listeners) signalSource.off(signal, listener);
  };
}
