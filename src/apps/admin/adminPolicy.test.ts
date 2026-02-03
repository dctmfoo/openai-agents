import { describe, expect, it } from 'vitest';
import {
  buildPolicyStatusUrl,
  formatPolicyError,
  formatPolicyPayload,
} from './policy.js';

describe('admin policy helpers', () => {
  it('buildPolicyStatusUrl appends policy/status', () => {
    expect(buildPolicyStatusUrl('http://127.0.0.1:8787')).toBe(
      'http://127.0.0.1:8787/policy/status',
    );
    expect(buildPolicyStatusUrl('http://127.0.0.1:8787/')).toBe(
      'http://127.0.0.1:8787/policy/status',
    );
  });

  it('formatPolicyPayload renders json', () => {
    expect(formatPolicyPayload({ ok: true })).toBe('{\n  \"ok\": true\n}');
  });

  it('formatPolicyError includes gateway base', () => {
    const text = formatPolicyError(new Error('nope'), 'http://g');
    expect(text).toContain('http://g');
    expect(text).toContain('nope');
  });
});
