import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GATEWAY_HOST,
  DEFAULT_GATEWAY_PORT,
  resolveAdminBinding,
} from './runtime.js';

describe('gateway admin binding', () => {
  it('defaults to localhost and 8787', () => {
    const binding = resolveAdminBinding();

    expect(binding).toEqual({
      host: DEFAULT_GATEWAY_HOST,
      port: DEFAULT_GATEWAY_PORT,
    });
  });

  it('uses explicit host and port', () => {
    const binding = resolveAdminBinding({ host: '0.0.0.0', port: 9000 });

    expect(binding).toEqual({ host: '0.0.0.0', port: 9000 });
  });

  it('treats blank host as unset', () => {
    const binding = resolveAdminBinding({ host: '   ' });

    expect(binding.host).toBe(DEFAULT_GATEWAY_HOST);
    expect(binding.port).toBe(DEFAULT_GATEWAY_PORT);
  });
});
