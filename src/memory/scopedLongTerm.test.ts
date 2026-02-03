import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { appendScopedLongTermFacts } from './scopedLongTerm.js';
import { getScopedLongTermPath } from './scopedMemory.js';

describe('scopedLongTerm', () => {
  it('creates MEMORY.md and appends bullets, deduping', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'halo-longterm-'));
    const scopeId = 'telegram:dm:wags';

    const p1 = await appendScopedLongTermFacts(
      { rootDir, scopeId },
      ['I like coffee', 'I like coffee', 'Timezone: Asia/Calcutta'],
    );

    expect(p1).toBe(getScopedLongTermPath({ rootDir, scopeId }));

    const content = await readFile(p1, 'utf8');
    expect(content).toContain('# MEMORY');
    expect(content).toContain('- I like coffee');
    expect(content).toContain('- Timezone: Asia/Calcutta');

    // Ensure only one coffee line.
    expect(content.match(/I like coffee/g)?.length).toBe(1);
  });
});
