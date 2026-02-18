import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { appendIncidentEvent } from './incidentLog.js';

describe('incidentLog', () => {
  it('writes incident events to jsonl log', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'incident-log-'));

    const logPath = await appendIncidentEvent({
      rootDir,
      action: 'backup_restore',
      severity: 'critical',
      message: 'backup_manifest_missing',
      details: {
        backupId: 'missing',
      },
      atMs: 1_762_000_000_000,
    });

    const raw = await readFile(logPath, 'utf8');
    const line = raw.trim();
    const payload = JSON.parse(line) as {
      action: string;
      severity: string;
      message: string;
      details: { backupId: string };
      atMs: number;
    };

    expect(payload).toEqual({
      action: 'backup_restore',
      severity: 'critical',
      message: 'backup_manifest_missing',
      details: {
        backupId: 'missing',
      },
      atMs: 1_762_000_000_000,
    });
  });
});
