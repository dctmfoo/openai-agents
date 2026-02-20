import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { OperationalAction } from './incidentLog.js';

export type OperationalAuditEventInput = {
  rootDir: string;
  action: OperationalAction;
  actorMemberId: string;
  targetLaneId?: string;
  targetBackupId?: string;
  outcome: 'allowed' | 'denied' | 'failed';
  details?: Record<string, unknown>;
  atMs?: number;
};

export async function appendOperationalAuditEvent(
  input: OperationalAuditEventInput,
): Promise<string> {
  const logDir = join(input.rootDir, 'logs');
  await mkdir(logDir, { recursive: true });

  const logPath = join(logDir, 'operations-audit.jsonl');
  const payload = {
    action: input.action,
    actorMemberId: input.actorMemberId,
    targetLaneId: input.targetLaneId,
    targetBackupId: input.targetBackupId,
    outcome: input.outcome,
    details: input.details,
    atMs: input.atMs ?? Date.now(),
  };

  await appendFile(logPath, `${JSON.stringify(payload)}\n`, 'utf8');
  return logPath;
}
