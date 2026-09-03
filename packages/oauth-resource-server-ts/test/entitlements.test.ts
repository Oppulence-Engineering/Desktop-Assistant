import { describe, expect, it } from 'vitest';
import {
  EntitlementRequestError,
  EntitlementRequestVerifier,
  MemoryEntitlementReplayStore,
  signEntitlementRequest,
} from '../src/entitlements.js';

const key = '0123456789abcdef0123456789abcdef';
const now = Date.parse('2026-08-27T22:00:00Z');

function signedHeaders(requestId = '0123456789abcdef0123456789abcdef', body = Buffer.from('{"allowed":true}')): Record<string, string> {
  const timestamp = '2026-08-27T22:00:00Z';
  return {
    'x-rowboat-connector': 'canvas',
    'x-rowboat-timestamp': timestamp,
    'x-rowboat-request-id': requestId,
    'x-rowboat-signature': signEntitlementRequest(key, timestamp, requestId, body),
  };
}

describe('signed entitlement requests', () => {
  it('matches the Go canonical parity vector', () => {
    expect(signEntitlementRequest(
      key,
      '2026-08-27T22:00:00Z',
      'request-0123456789abcdef',
      Buffer.from('{"allowed":true}'),
    )).toBe('sha256=84db9f0ae97e1b6d17b24c8b27b154a147e1abd7ccd55da3a86d764bc73f0f17');
  });

  it('rejects replay across verifier instances sharing one bounded store', async () => {
    const store = new MemoryEntitlementReplayStore(32, () => now);
    const first = new EntitlementRequestVerifier({ signingKey: key, connector: 'canvas', replayStore: store, now: () => now });
    const second = new EntitlementRequestVerifier({ signingKey: key, connector: 'canvas', replayStore: store, now: () => now });
    const body = Buffer.from('{"allowed":true}');
    const headers = signedHeaders(undefined, body);
    await expect(first.verify(headers, body)).resolves.toBeUndefined();
    await expect(second.verify(headers, body)).rejects.toMatchObject<Partial<EntitlementRequestError>>({ code: 'replay' });
  });

  it('binds the request ID and fails closed when the bounded store is full', async () => {
    const store = new MemoryEntitlementReplayStore(1, () => now);
    const verifier = new EntitlementRequestVerifier({ signingKey: key, connector: 'canvas', replayStore: store, now: () => now });
    const body = Buffer.from('{"allowed":true}');
    const headers = signedHeaders(undefined, body);
    headers['x-rowboat-request-id'] = `${headers['x-rowboat-request-id']}x`;
    await expect(verifier.verify(headers, body)).rejects.toMatchObject<Partial<EntitlementRequestError>>({ code: 'invalid' });

    const firstHeaders = signedHeaders('first-request-id-0001', body);
    await verifier.verify(firstHeaders, body);
    const secondHeaders = signedHeaders('second-request-id-002', body);
    await expect(verifier.verify(secondHeaders, body)).rejects.toMatchObject<Partial<EntitlementRequestError>>({ code: 'store_unavailable' });
  });
});
