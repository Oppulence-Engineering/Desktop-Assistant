import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ENTITLEMENT_CONNECTOR_HEADER = 'x-rowboat-connector';
export const ENTITLEMENT_TIMESTAMP_HEADER = 'x-rowboat-timestamp';
export const ENTITLEMENT_REQUEST_ID_HEADER = 'x-rowboat-request-id';
export const ENTITLEMENT_SIGNATURE_HEADER = 'x-rowboat-signature';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{16,128}$/;
const DEFAULT_MAX_AGE_MS = 5 * 60_000;
const DEFAULT_FUTURE_SKEW_MS = 60_000;

export class EntitlementRequestError extends Error {
  constructor(public readonly code: 'invalid' | 'replay' | 'store_unavailable', message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'EntitlementRequestError';
  }
}

/** Atomically claims a request ID through its expiry. Multi-replica products must provide a distributed implementation. */
export interface EntitlementReplayStore {
  claim(requestId: string, expiresAtMs: number): Promise<boolean>;
}

export interface EntitlementRequestVerifierConfig {
  signingKey: string | Uint8Array;
  connector: string;
  replayStore: EntitlementReplayStore;
  maxAgeMs?: number;
  futureSkewMs?: number;
  now?: () => number;
}

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

/** Verifies signed broker-to-product entitlement requests and consumes their nonce/request ID. */
export class EntitlementRequestVerifier {
  private readonly key: Uint8Array;
  private readonly connector: string;
  private readonly store: EntitlementReplayStore;
  private readonly maxAgeMs: number;
  private readonly futureSkewMs: number;
  private readonly now: () => number;

  constructor(cfg: EntitlementRequestVerifierConfig) {
    this.key = typeof cfg.signingKey === 'string' ? Buffer.from(cfg.signingKey) : cfg.signingKey;
    if (this.key.byteLength < 32) throw new Error('entitlement signing key must be at least 32 bytes');
    this.connector = cfg.connector.trim();
    if (!this.connector) throw new Error('entitlement connector is required');
    if (!cfg.replayStore) throw new Error('shared entitlement replay store is required');
    this.store = cfg.replayStore;
    this.maxAgeMs = cfg.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.futureSkewMs = cfg.futureSkewMs ?? DEFAULT_FUTURE_SKEW_MS;
    if (this.maxAgeMs < 0 || this.futureSkewMs < 0) throw new Error('entitlement request time bounds must not be negative');
    this.now = cfg.now ?? Date.now;
  }

  async verify(headers: HeaderSource, body: Uint8Array): Promise<void> {
    const timestamp = getHeader(headers, ENTITLEMENT_TIMESTAMP_HEADER).trim();
    const timestampMs = Date.parse(timestamp);
    const now = this.now();
    if (!Number.isFinite(timestampMs) || now - timestampMs > this.maxAgeMs || timestampMs - now > this.futureSkewMs) {
      throw new EntitlementRequestError('invalid', 'invalid entitlement request signature');
    }
    const requestId = getHeader(headers, ENTITLEMENT_REQUEST_ID_HEADER).trim();
    if (!REQUEST_ID_PATTERN.test(requestId)) throw new EntitlementRequestError('invalid', 'invalid entitlement request signature');
    if (getHeader(headers, ENTITLEMENT_CONNECTOR_HEADER) !== this.connector) throw new EntitlementRequestError('invalid', 'invalid entitlement request signature');
    const supplied = parseSignature(getHeader(headers, ENTITLEMENT_SIGNATURE_HEADER));
    const expected = entitlementMac(this.key, timestamp, requestId, body);
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) {
      throw new EntitlementRequestError('invalid', 'invalid entitlement request signature');
    }
    let claimed: boolean;
    try {
      claimed = await this.store.claim(requestId, timestampMs + this.maxAgeMs + this.futureSkewMs);
    } catch (error) {
      throw new EntitlementRequestError('store_unavailable', 'entitlement replay store unavailable', error);
    }
    if (!claimed) throw new EntitlementRequestError('replay', 'entitlement request replayed');
  }
}

export function signEntitlementRequest(signingKey: string | Uint8Array, timestamp: string, requestId: string, body: Uint8Array): string {
  const key = typeof signingKey === 'string' ? Buffer.from(signingKey) : signingKey;
  if (key.byteLength < 32 || !timestamp.trim() || !REQUEST_ID_PATTERN.test(requestId)) throw new Error('invalid entitlement request signature input');
  return `sha256=${Buffer.from(entitlementMac(key, timestamp, requestId, body)).toString('hex')}`;
}

export function newEntitlementRequestId(): string { return randomBytes(16).toString('hex'); }

/** Bounded one-process replay store. Use Redis/Postgres/etc. for multi-replica production. */
export class MemoryEntitlementReplayStore implements EntitlementReplayStore {
  private readonly entries = new Map<string, number>();
  constructor(private readonly maxEntries: number, private readonly now: () => number = Date.now) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) throw new Error('replay-store capacity must be positive');
  }

  async claim(requestId: string, expiresAtMs: number): Promise<boolean> {
    const now = this.now();
    for (const [id, expiry] of this.entries) if (expiry <= now) this.entries.delete(id);
    const existing = this.entries.get(requestId);
    if (existing !== undefined && existing > now) return false;
    if (this.entries.size >= this.maxEntries) throw new Error('bounded replay store is full');
    this.entries.set(requestId, expiresAtMs);
    return true;
  }
}

function entitlementMac(key: Uint8Array, timestamp: string, requestId: string, body: Uint8Array): Uint8Array {
  return createHmac('sha256', key).update(timestamp).update('\n').update(requestId).update('\n').update(body).digest();
}

function parseSignature(raw: string): Uint8Array {
  if (!raw.startsWith('sha256=')) throw new EntitlementRequestError('invalid', 'invalid entitlement request signature');
  const hex = raw.slice('sha256='.length);
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new EntitlementRequestError('invalid', 'invalid entitlement request signature');
  return Buffer.from(hex, 'hex');
}

function getHeader(headers: HeaderSource, name: string): string {
  if (headers instanceof Headers) return headers.get(name) ?? '';
  const direct = headers[name] ?? headers[canonicalHeader(name)];
  return Array.isArray(direct) ? direct[0] ?? '' : direct ?? '';
}

function canonicalHeader(name: string): string {
  return name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('-');
}
