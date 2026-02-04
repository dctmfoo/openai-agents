import { describe, expect, it } from 'vitest';
import {
  buildClearSessionUrl,
  buildPurgeSessionUrl,
  buildDistillSessionUrl,
  buildSessionsUrl,
  formatSessionsError,
  formatSessionsPayload,
} from './sessions.js';

describe('admin sessions helpers', () => {
  it('buildSessionsUrl appends sessions-with-counts', () => {
    expect(buildSessionsUrl('http://127.0.0.1:8787')).toBe(
      'http://127.0.0.1:8787/sessions-with-counts',
    );
    expect(buildSessionsUrl('http://127.0.0.1:8787/')).toBe(
      'http://127.0.0.1:8787/sessions-with-counts',
    );
  });

  it('buildClearSessionUrl encodes scope id', () => {
    expect(buildClearSessionUrl('http://x', 'telegram:889348242')).toBe(
      'http://x/sessions/telegram%3A889348242/clear',
    );
  });

  it('buildPurgeSessionUrl appends confirmation', () => {
    expect(buildPurgeSessionUrl('http://x', 'scope-1', 'scope-1')).toBe(
      'http://x/sessions/scope-1/purge?confirm=scope-1',
    );
  });

  it('buildDistillSessionUrl encodes scope id', () => {
    expect(buildDistillSessionUrl('http://x', 'telegram:889348242')).toBe(
      'http://x/sessions/telegram%3A889348242/distill',
    );
  });

  it('formatSessionsPayload renders json', () => {
    expect(formatSessionsPayload([{ scopeId: 'a', itemCount: 1 }])).toBe(
      '[\n  {\n    "scopeId": "a",\n    "itemCount": 1\n  }\n]',
    );
  });

  it('formatSessionsError includes gateway base', () => {
    const text = formatSessionsError(new Error('nope'), 'http://g');
    expect(text).toContain('http://g');
    expect(text).toContain('nope');
  });
});
