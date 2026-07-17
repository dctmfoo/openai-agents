import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hashSessionId } from '../sessions/sessionHash.js';

export type ScopedMemoryPaths = {
  rootDir: string;
  scopeId: string;
};

function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function sanitize(text: string): string {
  // Very small safety net: avoid accidentally persisting obvious secrets.
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_OPENAI_KEY]')
    .replace(/\b\d{9,}:[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_TELEGRAM_TOKEN]');
}

function normalizeBullet(line: string): string {
  return line.trim().replace(/^[-*]\s+/, '').trim().toLowerCase();
}

function scopeDir(paths: ScopedMemoryPaths): string {
  const hashed = hashSessionId(paths.scopeId);
  return join(paths.rootDir, 'memory', 'scopes', hashed);
}

export function getScopedLongTermPath(paths: ScopedMemoryPaths): string {
  return join(scopeDir(paths), 'MEMORY.md');
}

export function getScopedDailyPath(paths: ScopedMemoryPaths, date = new Date()): string {
  return join(scopeDir(paths), `${isoDate(date)}.md`);
}

async function safeRead(path: string): Promise<string> {
  if (!existsSync(path)) return '';
  return await readFile(path, 'utf8');
}

export async function loadScopedContextFiles(paths: ScopedMemoryPaths) {
  const soul = await safeRead(join(paths.rootDir, 'SOUL.md'));
  const user = await safeRead(join(paths.rootDir, 'USER.md'));

  const longTermPath = getScopedLongTermPath(paths);
  const todayPath = getScopedDailyPath(paths, new Date());
  const yesterdayPath = getScopedDailyPath(
    paths,
    new Date(Date.now() - 24 * 60 * 60 * 1000),
  );

  const longTerm = await safeRead(longTermPath);
  const today = await safeRead(todayPath);
  const yesterday = await safeRead(yesterdayPath);

  return {
    soul,
    user,
    longTerm,
    today,
    yesterday,
    longTermPath,
    todayPath,
  };
}

export async function appendScopedDailyNote(
  paths: ScopedMemoryPaths,
  note: string,
  date = new Date(),
) {
  const path = getScopedDailyPath(paths, date);
  await mkdir(scopeDir(paths), { recursive: true });

  const header = `# ${isoDate(date)}\n\n`;
  if (!existsSync(path)) {
    await appendFile(path, header, 'utf8');
  }

  const clean = sanitize(note.trim());
  const line = clean.startsWith('-') ? clean : `- ${clean}`;
  await appendFile(path, line + '\n', 'utf8');

  return path;
}
