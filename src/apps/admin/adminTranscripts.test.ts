import { describe, expect, it } from 'vitest';
import {
  buildTranscriptTailUrl,
  formatTranscriptError,
  formatTranscriptPayload,
} from './transcripts.js';

describe('admin transcript helpers', () => {
  it('buildTranscriptTailUrl encodes scope id', () => {
    expect(buildTranscriptTailUrl('http://x', 'telegram:889', 12)).toBe(
      'http://x/transcripts/tail?scopeId=telegram%3A889&lines=12',
    );
  });

  it('formatTranscriptPayload renders json', () => {
    expect(formatTranscriptPayload([{ ok: true }])).toBe('[\n  {\n    \"ok\": true\n  }\n]');
  });

  it('formatTranscriptError includes gateway base', () => {
    const text = formatTranscriptError(new Error('nope'), 'http://g');
    expect(text).toContain('http://g');
    expect(text).toContain('nope');
  });
});
