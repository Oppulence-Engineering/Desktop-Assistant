import { PostHog } from 'posthog-node';
import { getInstallationId } from './installation.js';
import { API_URL } from '../config/env.js';

// Build-time injected via esbuild `define` (apps/main/bundle.mjs).
// In dev/tsc, fall back to process.env so local runs work too.
const POSTHOG_KEY = process.env.POSTHOG_KEY ?? process.env.VITE_PUBLIC_POSTHOG_KEY ?? '';
const POSTHOG_HOST = process.env.POSTHOG_HOST ?? process.env.VITE_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';
const APP_VERSION = (process.env.ROWBOAT_APP_VERSION ?? process.env.npm_package_version ?? '').trim();

let client: PostHog | null = null;
let initAttempted = false;
let identifiedUserId: string | null = null;

/**
 * Whether the user has consented to product analytics.
 *
 * Starts false and is set from `privacy.json` during startup
 * (config/privacy.ts `applyPrivacyConfig`). Fail-closed on purpose: this gates
 * data leaving the machine, so the failure mode for a broken wiring path should
 * be "we sent nothing", not "we sent everything". The previous version of this
 * setting lived in renderer localStorage that nothing read, and analytics ran
 * regardless of what the switch said.
 */
let analyticsEnabled = false;

/**
 * Apply the consent decision. Called at startup and whenever the user changes
 * the setting, so opting out takes effect immediately rather than next launch.
 */
export function setAnalyticsEnabled(enabled: boolean): void {
  if (analyticsEnabled === enabled) return;
  analyticsEnabled = enabled;
  if (enabled) return;

  // Opting out: stop the client rather than leaving it idle. Dropping the
  // reference alone would leave its flush timer running and still shipping the
  // queue. shutdown() drains what was already captured — under the previous
  // consent — and then nothing further is captured because every entry point
  // below checks the flag first.
  const stopping = client;
  client = null;
  identifiedUserId = null;
  if (stopping) {
    void Promise.resolve(stopping.shutdown()).catch(() => {
      // Best effort; the point is that no new events are captured.
    });
  }
}

/** Whether analytics is currently permitted (diagnostics and tests). */
export function isAnalyticsEnabled(): boolean {
  return analyticsEnabled;
}

function getClient(): PostHog | null {
  // Checked before init, not just before capture: constructing the client
  // sends an identify() call of its own.
  if (!analyticsEnabled) return null;
  if (initAttempted) return client;
  initAttempted = true;
  if (!POSTHOG_KEY) {
    console.log('[Analytics] POSTHOG_KEY not set; analytics disabled');
    return null;
  }
  try {
    client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      flushAt: 20,
      flushInterval: 10_000,
    });
    // Tag the install with api_url as a person property up-front,
    // so anonymous users are also segmentable by environment (api_url
    // distinguishes prod / staging / custom — meaning is assigned in PostHog).
    client.identify({
      distinctId: getInstallationId(),
      properties: { api_url: API_URL, ...appVersionProperties() },
    });
  } catch (err) {
    console.error('[Analytics] Failed to init PostHog:', err);
    client = null;
  }
  return client;
}

function activeDistinctId(): string {
  return identifiedUserId ?? getInstallationId();
}

function appVersionProperties(): Record<string, string> {
  return APP_VERSION ? { app_version: APP_VERSION } : {};
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  const ph = getClient();
  if (!ph) return;
  try {
    ph.capture({
      distinctId: activeDistinctId(),
      event,
      properties: {
        ...properties,
        ...appVersionProperties(),
      },
    });
  } catch (err) {
    console.error('[Analytics] capture failed:', err);
  }
}

export function identify(userId: string, properties?: Record<string, unknown>): void {
  const ph = getClient();
  if (!ph) return;
  try {
    // Alias the anonymous installation ID to the rowboat user ID so historical
    // anonymous events are linked to the identified user.
    ph.alias({ distinctId: userId, alias: getInstallationId() });
    ph.identify({
      distinctId: userId,
      properties: {
        ...properties,
        api_url: API_URL,
        ...appVersionProperties(),
      },
    });
    identifiedUserId = userId;
  } catch (err) {
    console.error('[Analytics] identify failed:', err);
  }
}

export function captureException(error: unknown, properties?: Record<string, unknown>): void {
  const ph = getClient();
  if (!ph) return;
  try {
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error));
    const phAny = ph as unknown as { captureException?: (err: unknown, distinctId?: string, props?: Record<string, unknown>) => void };
    if (typeof phAny.captureException === 'function') {
      // posthog-node v4+: native captureException signature
      phAny.captureException(err, activeDistinctId(), properties);
      return;
    }
    // Fallback: emit a $exception event in the documented shape
    ph.capture({
      distinctId: activeDistinctId(),
      event: '$exception',
      properties: {
        ...properties,
        $exception_list: [
          {
            type: err.name,
            value: err.message,
            stacktrace: err.stack ? { frames: [], raw: err.stack } : undefined,
            mechanism: { handled: true, synthetic: false },
          },
        ],
      },
    });
  } catch (e) {
    console.error('[Analytics] captureException failed:', e);
  }
}

export function reset(): void {
  identifiedUserId = null;
}

export async function shutdown(): Promise<void> {
  if (!client) return;
  try {
    await client.shutdown();
  } catch (err) {
    console.error('[Analytics] shutdown failed:', err);
  }
}

/**
 * Capture a native crash event (Crashpad minidump or render/child process gone).
 * Emits as a $exception event with mechanism.handled=false so PostHog flags it
 * separately from JS-level handled exceptions.
 */
export function captureNativeCrash(properties: Record<string, unknown>): void {
  const ph = getClient();
  if (!ph) return;
  try {
    const kind = typeof properties.kind === "string" ? properties.kind : null;
    const message = kind
      ? 'Native crash: ' + kind
      : 'Native crash (minidump from previous launch)';
    ph.capture({
      distinctId: activeDistinctId(),
      event: '$exception',
      properties: {
        ...properties,
        $exception_list: [
          {
            type: 'NativeCrash',
            value: message,
            mechanism: { handled: false, synthetic: true },
          },
        ],
      },
    });
  } catch (err) {
    console.error('[Analytics] captureNativeCrash failed:', err);
  }
}
