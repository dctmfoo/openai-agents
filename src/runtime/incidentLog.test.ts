import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { appendIncidentEvent, type OperationalAction } from './incidentLog.js';

describe('incidentLog', () => {
  it('OperationalAction includes lane operations', () => {
    const laneExport: OperationalAction = 'lane_export';
    const laneDelete: OperationalAction = 'lane_delete';
    const laneRetention: OperationalAction = 'lane_retention';
    const backupCreate: OperationalAction = 'backup_create';
    const backupRestore: OperationalAction = 'backup_restore';

    expect([laneExport, laneDelete, laneRetention, backupCreate, backupRestore]).toEqual([
      'lane_export',
      'lane_delete',
      'lane_retention',
      'backup_create',
      'backup_restore',
    ]);
  });

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
