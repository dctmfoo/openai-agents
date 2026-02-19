import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { appendOperationalAuditEvent, type OperationalAuditEventInput } from './operationsAudit.js';
import type { OperationalAction } from './incidentLog.js';

describe('operationsAudit', () => {
  it('OperationalAuditEventInput.action uses the shared OperationalAction type', () => {
    expectTypeOf<OperationalAuditEventInput['action']>().toEqualTypeOf<OperationalAction>();
  });

  it('writes structured operational audit events as jsonl', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'ops-audit-'));

    const logPath = await appendOperationalAuditEvent({
      rootDir,
      action: 'lane_export',
      actorMemberId: 'parent-1',
      targetLaneId: 'child_private:child-1',
      outcome: 'allowed',
      details: {
        entryCount: 2,
      },
      atMs: 1_762_000_000_000,
    });

    const contents = await readFile(logPath, 'utf8');
    const lines = contents
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0] ?? '{}') as {
      action: string;
      actorMemberId: string;
      targetLaneId: string;
      outcome: string;
      details: { entryCount: number };
      atMs: number;
    };

    expect(payload).toEqual({
      action: 'lane_export',
      actorMemberId: 'parent-1',
      targetLaneId: 'child_private:child-1',
      outcome: 'allowed',
      details: {
        entryCount: 2,
      },
      atMs: 1_762_000_000_000,
    });
  });
});
