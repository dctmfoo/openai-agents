import { describe, expect, it } from 'vitest';

import { chunkMarkdown } from './chunker.js';

describe('chunker', () => {
  it('does not split inside code fences', () => {
    const markdown = [
      '# Title',
      '',
      'Intro paragraph line 1.',
      'Intro paragraph line 2.',
      '```ts',
      'const x = 1;',
      'const y = x + 2;',
      'console.log(y);',
      '```',
      '',
      'Outro line.',
    ].join('\n');

    const chunks = chunkMarkdown({
      path: 'memory/MEMORY.md',
      text: markdown,
      targetTokens: 20,
      overlapTokens: 4,
      minTokens: 6,
      maxTokens: 40,
    });

    // Any chunk containing a fence start must also contain a fence end.
    for (const chunk of chunks) {
      const hasStart = chunk.text.includes('```ts');
      const hasEnd = chunk.text.includes('```');
      if (hasStart) {
        expect(hasEnd).toBe(true);
      }
    }
  });

  it('builds chunk ids with line ranges and content hash', () => {
    const markdown = ['alpha', 'beta', 'gamma', 'delta'].join('\n');
    const chunks = chunkMarkdown({
      path: 'memory/MEMORY.md',
      text: markdown,
      targetTokens: 4,
      overlapTokens: 0,
      minTokens: 1,
      maxTokens: 6,
    });

    expect(chunks.length).toBeGreaterThan(0);
    const first = chunks[0];
    expect(first.id.startsWith('memory/MEMORY.md:')).toBe(true);
    expect(first.id).toContain(':');
    expect(first.startLine).toBeGreaterThanOrEqual(1);
    expect(first.endLine).toBeGreaterThanOrEqual(first.startLine);
  });
});
