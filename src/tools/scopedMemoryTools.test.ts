import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { getScopedDailyPath, getScopedLongTermPath } from '../memory/scopedMemory.js';
import { getLaneLongTermPath, getLaneDailyPath } from '../memory/laneMemory.js';
import { readScopedMemory } from './scopedMemoryTools.js';

describe('scopedMemoryTools', () => {
  it('reads the requested scoped memory target', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'scoped-memory-tool-'));
    const scopeId = 'telegram:dm:wags';
    const now = new Date('2026-02-03T12:00:00Z');

    const longTermPath = getScopedLongTermPath({ rootDir, scopeId });
    const todayPath = getScopedDailyPath({ rootDir, scopeId }, now);
    const yesterdayPath = getScopedDailyPath(
      { rootDir, scopeId },
      new Date(now.getTime() - 24 * 60 * 60 * 1000),
    );

    await mkdir(path.dirname(longTermPath), { recursive: true });
    await writeFile(longTermPath, 'long term', 'utf8');
    await writeFile(todayPath, 'today note', 'utf8');
    await writeFile(yesterdayPath, 'yesterday note', 'utf8');

    const longTerm = await readScopedMemory({ rootDir, scopeId, target: 'long_term', now: () => now });
    expect(longTerm.path).toBe(longTermPath);
    expect(longTerm.contents).toBe('long term');

    const today = await readScopedMemory({ rootDir, scopeId, target: 'today', now: () => now });
    expect(today.path).toBe(todayPath);
    expect(today.contents).toBe('today note');

    const yesterday = await readScopedMemory({ rootDir, scopeId, target: 'yesterday', now: () => now });
    expect(yesterday.path).toBe(yesterdayPath);
    expect(yesterday.contents).toBe('yesterday note');
  });

  it('reads from lane paths when laneIds are provided', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'lane-memory-tool-'));
    const laneIds = ['parent_private:wags', 'family_shared'];
    const now = new Date('2026-02-03T12:00:00Z');

    for (const laneId of laneIds) {
      const longTermPath = getLaneLongTermPath({ rootDir, laneId });
      const todayPath = getLaneDailyPath({ rootDir, laneId }, now);
      await mkdir(path.dirname(longTermPath), { recursive: true });
      await writeFile(longTermPath, `long term for ${laneId}`, 'utf8');
      await writeFile(todayPath, `today for ${laneId}`, 'utf8');
    }

    const longTerm = await readScopedMemory({
      rootDir,
      scopeId: 'telegram:dm:wags',
      target: 'long_term',
      laneIds,
      now: () => now,
    });
    expect(longTerm.contents).toContain('long term for parent_private:wags');
    expect(longTerm.contents).toContain('long term for family_shared');

    const today = await readScopedMemory({
      rootDir,
      scopeId: 'telegram:dm:wags',
      target: 'today',
      laneIds,
      now: () => now,
    });
    expect(today.contents).toContain('today for parent_private:wags');
    expect(today.contents).toContain('today for family_shared');
  });
});
