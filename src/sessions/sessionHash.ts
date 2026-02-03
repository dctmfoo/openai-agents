import { createHash } from 'node:crypto';

export function hashSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex');
}
