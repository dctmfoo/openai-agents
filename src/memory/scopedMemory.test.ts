import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  appendScopedDailyNote,
  getScopedDailyPath,
  getScopedLongTermPath,
} from './scopedMemory.js';

describe('scopedMemory', () => {
  it('stores memory under memory/scopes/<hash>/...', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'scoped-memory-'));
    const scopeId = 'telegram:dm:wags';

    const longTerm = getScopedLongTermPath({ rootDir, scopeId });
    const daily = getScopedDailyPath({ rootDir, scopeId }, new Date('2026-02-03T00:00:00Z'));

    expect(longTerm).toContain(path.join(rootDir, 'memory', 'scopes'));
    expect(daily).toContain(path.join(rootDir, 'memory', 'scopes'));
    expect(daily).toContain('2026-02-03.md');
  });

  it('writes a header once and appends bullets', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'scoped-memory-'));
    const scopeId = 'telegram:dm:wags';

    const date = new Date('2026-02-03T12:00:00Z');

    const p1 = await appendScopedDailyNote({ rootDir, scopeId }, 'first', date);
    const p2 = await appendScopedDailyNote({ rootDir, scopeId }, '- second', date);

    expect(p1).toBe(p2);

    const contents = await readFile(p1, 'utf8');
    expect(contents).toContain('# 2026-02-03');
    expect(contents).toContain('- first');
    expect(contents).toContain('- second');

    // Header appears once.
    expect(contents.match(/# 2026-02-03/g)?.length).toBe(1);
  });
});
