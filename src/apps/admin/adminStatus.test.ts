import { describe, expect, it } from 'vitest';

import {
  buildStatusUrl,
  DEFAULT_GATEWAY_BASE,
  formatStatusError,
  formatStatusPayload,
  resolveGatewayBase,
} from './status.js';

describe('admin status helpers', () => {
  it('falls back to the default gateway when none is provided', () => {
    expect(resolveGatewayBase('')).toBe(DEFAULT_GATEWAY_BASE);
    expect(resolveGatewayBase('?gateway=')).toBe(DEFAULT_GATEWAY_BASE);
  });

  it('uses a gateway override from the query string', () => {
    expect(resolveGatewayBase('?gateway=http://localhost:9999')).toBe('http://localhost:9999');
    expect(resolveGatewayBase('?gateway=localhost:7777')).toBe('http://localhost:7777');
  });

  it('builds the status URL from the gateway base', () => {
    expect(buildStatusUrl('http://localhost:9999')).toBe('http://localhost:9999/status');
  });

  it('formats the status payload as JSON', () => {
    const payload = { ok: true, uptime: 12 };
    expect(formatStatusPayload(payload)).toBe(JSON.stringify(payload, null, 2));
  });

  it('formats gateway errors with context', () => {
    const message = formatStatusError(new Error('no response'), 'http://localhost:9999');
    expect(message).toContain('no response');
    expect(message).toContain('http://localhost:9999');
  });
});
