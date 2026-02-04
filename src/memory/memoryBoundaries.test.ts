import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  appendScopedDailyNote,
  getScopedDailyPath,
  loadScopedContextFiles,
} from './scopedMemory.js';

describe('memory boundaries (scope isolation)', () => {
  it('writes daily memory into distinct scope directories (DM vs parents-group)', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'halo-boundary-'));

    const dmScope = 'telegram:dm:wags';
    const groupScope = 'telegram:parents_group:-100123';

    const date = new Date('2026-02-03T12:00:00Z');

    const dmPath = await appendScopedDailyNote({ rootDir, scopeId: dmScope }, 'dm secret', date);
    const groupPath = await appendScopedDailyNote({ rootDir, scopeId: groupScope }, 'group note', date);

    expect(dmPath).not.toBe(groupPath);
    expect(path.dirname(dmPath)).not.toBe(path.dirname(groupPath));

    const dmContents = await readFile(dmPath, 'utf8');
    const groupContents = await readFile(groupPath, 'utf8');

    expect(dmContents).toContain('dm secret');
    expect(dmContents).not.toContain('group note');

    expect(groupContents).toContain('group note');
    expect(groupContents).not.toContain('dm secret');
  });

  it('loadScopedContextFiles only loads memory for the given scopeId', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'halo-boundary-'));

    const dmScope = 'telegram:dm:wags';
    const groupScope = 'telegram:parents_group:-100123';

    const date = new Date('2026-02-03T12:00:00Z');

    // loadScopedContextFiles uses the current system date to determine "today".
    // Freeze time so this test is deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(date);

    try {
      await appendScopedDailyNote({ rootDir, scopeId: dmScope }, 'dm-only', date);
      await appendScopedDailyNote({ rootDir, scopeId: groupScope }, 'group-only', date);

      const dmTodayPath = getScopedDailyPath({ rootDir, scopeId: dmScope }, date);

      const ctx = await loadScopedContextFiles({ rootDir, scopeId: dmScope });

      expect(ctx.todayPath).toBe(dmTodayPath);
      expect(ctx.today).toContain('dm-only');
      expect(ctx.today).not.toContain('group-only');
    } finally {
      vi.useRealTimers();
    }
  });
});
