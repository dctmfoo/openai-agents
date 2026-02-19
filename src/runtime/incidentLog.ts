import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

type IncidentSeverity = 'warning' | 'critical';

export type OperationalAction =
  | 'lane_export'
  | 'lane_delete'
  | 'lane_retention'
  | 'backup_create'
  | 'backup_restore';

export type IncidentEventAction = OperationalAction;

export type IncidentEventInput = {
  rootDir: string;
  action: IncidentEventAction;
  severity: IncidentSeverity;
  message: string;
  details?: Record<string, unknown>;
  atMs?: number;
};

export async function appendIncidentEvent(input: IncidentEventInput): Promise<string> {
  const logDir = join(input.rootDir, 'logs');
  await mkdir(logDir, { recursive: true });

  const logPath = join(logDir, 'incidents.jsonl');
  const payload = {
    action: input.action,
    severity: input.severity,
    message: input.message,
    details: input.details,
    atMs: input.atMs ?? Date.now(),
  };

  await appendFile(logPath, `${JSON.stringify(payload)}\n`, 'utf8');
  return logPath;
}
