import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  appendLaneDailyNotesUnique,
  appendLaneLongTermFacts,
  loadLaneContextFiles,
} from './laneMemory.js';

describe('laneMemory context loading', () => {
  it('loads only allowed lanes when building memory context', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'halo-lane-memory-'));
    const now = new Date('2026-02-18T08:00:00.000Z');

    await writeFile(path.join(rootDir, 'SOUL.md'), '# soul\n', 'utf8');
    await writeFile(path.join(rootDir, 'USER.md'), '# user\n', 'utf8');

    await appendLaneLongTermFacts(
      { rootDir, laneId: 'parent_private:wags' },
      ['parent salary note'],
    );
    await appendLaneLongTermFacts(
      { rootDir, laneId: 'family_shared' },
      ['family grocery note'],
    );

    await appendLaneDailyNotesUnique(
      { rootDir, laneId: 'parent_private:wags' },
      ['today parent lane update'],
      now,
    );
    await appendLaneDailyNotesUnique(
      { rootDir, laneId: 'family_shared' },
      ['today family lane update'],
      now,
    );

    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const context = await loadLaneContextFiles({
        rootDir,
        laneIds: ['parent_private:wags'],
      });

      expect(context.soul).toContain('# soul');
      expect(context.user).toContain('# user');

      expect(context.longTerm).toContain('parent salary note');
      expect(context.longTerm).not.toContain('family grocery note');

      expect(context.today).toContain('today parent lane update');
      expect(context.today).not.toContain('today family lane update');
    } finally {
      vi.useRealTimers();
    }
  });
});
