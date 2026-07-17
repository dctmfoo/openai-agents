import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type EventLogRecord = {
  ts: string;
  type:
    | 'telegram.update'
    | 'telegram.restart'
    | 'prime.run.start'
    | 'prime.run.success'
    | 'prime.run.error'
    | 'memory.daily.append'
    | 'file.upload';
  data: Record<string, unknown>;
};

export async function appendJsonl(path: string, record: EventLogRecord) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(record) + '\n', 'utf8');
}
