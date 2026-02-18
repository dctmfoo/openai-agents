import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  appendLaneDailyNotesUnique,
  appendLaneLongTermFacts,
  getLaneDailyPath,
  getLaneLongTermPath,
} from './laneMemory.js';
import {
  deleteLaneMemory,
  exportLaneMemory,
  runLaneRetention,
} from './laneOperations.js';

describe('laneOperations', () => {
  it('exports lane long-term and daily memory in a deterministic order', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'lane-ops-export-'));
    const laneId = 'child_private:kid';

    await appendLaneLongTermFacts({ rootDir, laneId }, ['Kid prefers math puzzles']);
    await appendLaneDailyNotesUnique(
      { rootDir, laneId },
      ['Practiced fractions'],
      new Date('2026-02-17T10:00:00.000Z'),
    );
    await appendLaneDailyNotesUnique(
      { rootDir, laneId },
      ['Read a chapter book'],
      new Date('2026-02-18T10:00:00.000Z'),
    );

    const exported = await exportLaneMemory({ rootDir, laneId });

    expect(exported.laneId).toBe(laneId);
    expect(exported.longTerm).toContain('Kid prefers math puzzles');
    expect(exported.dailyFiles.map((entry) => entry.date)).toEqual([
      '2026-02-17',
      '2026-02-18',
    ]);
    expect(exported.dailyFiles[0]?.content).toContain('Practiced fractions');
    expect(exported.dailyFiles[1]?.content).toContain('Read a chapter book');
  });

  it('deletes only daily files beyond retention window and keeps long-term memory', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'lane-ops-retention-'));
    const laneId = 'child_private:kid';

    await appendLaneLongTermFacts({ rootDir, laneId }, ['Kid likes astronomy']);
    await appendLaneDailyNotesUnique(
      { rootDir, laneId },
      ['Old note'],
      new Date('2026-02-01T10:00:00.000Z'),
    );
    await appendLaneDailyNotesUnique(
      { rootDir, laneId },
      ['Recent note'],
      new Date('2026-02-16T10:00:00.000Z'),
    );

    const summary = await runLaneRetention({
      rootDir,
      laneId,
      retentionDays: 7,
      now: new Date('2026-02-18T10:00:00.000Z'),
    });

    expect(summary.deletedFiles).toEqual(['2026-02-01.md']);
    expect(summary.keptFiles).toContain('2026-02-16.md');

    const longTermPath = getLaneLongTermPath({ rootDir, laneId });
    const dailyRecentPath = getLaneDailyPath(
      { rootDir, laneId },
      new Date('2026-02-16T10:00:00.000Z'),
    );

    expect(await readFile(longTermPath, 'utf8')).toContain('Kid likes astronomy');
    expect(await readFile(dailyRecentPath, 'utf8')).toContain('Recent note');
  });

  it('moves lane memory into recoverable trash on delete', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'lane-ops-delete-'));
    const laneId = 'parent_private:mom';

    await appendLaneLongTermFacts({ rootDir, laneId }, ['Mom keeps finance notes here']);

    const result = await deleteLaneMemory({
      rootDir,
      laneId,
      now: new Date('2026-02-18T10:00:00.000Z'),
    });

    const longTermPath = getLaneLongTermPath({ rootDir, laneId });

    await expect(stat(longTermPath)).rejects.toThrow();
    expect(result.deleted).toBe(true);
    expect(await readFile(path.join(result.trashPath, 'MEMORY.md'), 'utf8')).toContain(
      'finance notes',
    );
  });
});
