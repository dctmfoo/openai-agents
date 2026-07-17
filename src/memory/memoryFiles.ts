import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

type MemoryPaths = {
  rootDir: string; // runtime root (HALO_HOME)
};

function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function getDailyMemoryPath(paths: MemoryPaths, date = new Date()) {
  return join(paths.rootDir, 'memory', `${isoDate(date)}.md`);
}

async function safeRead(path: string): Promise<string> {
  if (!existsSync(path)) return '';
  return await readFile(path, 'utf8');
}

async function loadMarkdownContextFiles(paths: MemoryPaths) {
  const soul = await safeRead(join(paths.rootDir, 'SOUL.md'));
  const user = await safeRead(join(paths.rootDir, 'USER.md'));
  const longTerm = await safeRead(join(paths.rootDir, 'MEMORY.md'));

  const todayPath = getDailyMemoryPath(paths, new Date());
  const yesterdayPath = getDailyMemoryPath(
    paths,
    new Date(Date.now() - 24 * 60 * 60 * 1000),
  );

  const today = await safeRead(todayPath);
  const yesterday = await safeRead(yesterdayPath);

  return {
    soul,
    user,
    longTerm,
    today,
    yesterday,
    todayPath,
  };
}

function sanitize(text: string): string {
  // Very small safety net: avoid accidentally persisting obvious secrets.
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_OPENAI_KEY]')
    .replace(/\b\d{9,}:[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_TELEGRAM_TOKEN]');
}

export async function appendDailyNote(
  paths: MemoryPaths,
  note: string,
  date = new Date(),
) {
  const path = getDailyMemoryPath(paths, date);
  await mkdir(join(paths.rootDir, 'memory'), { recursive: true });

  const header = `# ${isoDate(date)}\n\n`;
  if (!existsSync(path)) {
    await appendFile(path, header, 'utf8');
  }

  const clean = sanitize(note.trim());
  const line = clean.startsWith('-') ? clean : `- ${clean}`;
  await appendFile(path, line + '\n', 'utf8');

  return path;
}
