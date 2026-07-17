import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { hashSessionId } from '../sessions/sessionHash.js';

export type LaneMemoryPaths = {
  rootDir: string;
  laneId: string;
};

function isoDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function sanitize(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_OPENAI_KEY]')
    .replace(/\b\d{9,}:[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_TELEGRAM_TOKEN]');
}

function normalizeBullet(line: string): string {
  return line.trim().replace(/^[-*]\s+/, '').trim().toLowerCase();
}

function laneDir(paths: LaneMemoryPaths): string {
  const hashed = hashSessionId(paths.laneId);
  return join(paths.rootDir, 'memory', 'lanes', hashed);
}

export function getLaneLongTermPath(paths: LaneMemoryPaths): string {
  return join(laneDir(paths), 'MEMORY.md');
}

export function getLaneDailyPath(paths: LaneMemoryPaths, date = new Date()): string {
  return join(laneDir(paths), `${isoDate(date)}.md`);
}

export async function appendLaneLongTermFacts(
  paths: LaneMemoryPaths,
  facts: string[],
): Promise<string> {
  const filePath = getLaneLongTermPath(paths);
  await mkdir(laneDir(paths), { recursive: true });

  const existing = existsSync(filePath) ? await readFile(filePath, 'utf8') : '';
  const seen = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => normalizeBullet(line))
      .filter(Boolean),
  );

  const toAppend: string[] = [];
  for (const fact of facts) {
    const clean = sanitize(fact.trim());
    if (!clean) {
      continue;
    }

    const key = normalizeBullet(clean);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    toAppend.push(`- ${clean}`);
  }

  if (!existsSync(filePath)) {
    await appendFile(filePath, '# MEMORY\n\n', 'utf8');
  }

  if (toAppend.length > 0) {
    await appendFile(filePath, `${toAppend.join('\n')}\n`, 'utf8');
  }

  return filePath;
}

export async function appendLaneDailyNotesUnique(
  paths: LaneMemoryPaths,
  notes: string[],
  date = new Date(),
): Promise<{ path: string; appendedCount: number }> {
  const filePath = getLaneDailyPath(paths, date);
  await mkdir(laneDir(paths), { recursive: true });

  if (!existsSync(filePath)) {
    await appendFile(filePath, `# ${isoDate(date)}\n\n`, 'utf8');
  }

  const existing = existsSync(filePath) ? await readFile(filePath, 'utf8') : '';
  const seen = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => normalizeBullet(line))
      .filter(Boolean),
  );

  const toAppend: string[] = [];
  for (const note of notes) {
    const clean = sanitize(note.trim());
    if (!clean) {
      continue;
    }

    const key = normalizeBullet(clean);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    const line = clean.startsWith('-') ? clean : `- ${clean}`;
    toAppend.push(line);
  }

  if (toAppend.length > 0) {
    await appendFile(filePath, `${toAppend.join('\n')}\n`, 'utf8');
  }

  return {
    path: filePath,
    appendedCount: toAppend.length,
  };
}

type LaneContextLoadInput = {
  rootDir: string;
  laneIds: string[];
};

type LaneContextSection = {
  laneId: string;
  text: string;
};

const safeRead = async (path: string): Promise<string> => {
  if (!existsSync(path)) {
    return '';
  }

  return await readFile(path, 'utf8');
};

const stableUnique = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    if (seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    out.push(trimmed);
  }

  return out;
};

const renderLaneSections = (sections: LaneContextSection[]): string => {
  const nonEmpty = sections.filter((section) => section.text.trim().length > 0);
  if (nonEmpty.length === 0) {
    return '';
  }

  return nonEmpty
    .map((section) => {
      return `[lane:${section.laneId}]\n${section.text}`;
    })
    .join('\n\n');
};

export async function loadLaneContextFiles(input: LaneContextLoadInput): Promise<{
  soul: string;
  user: string;
  longTerm: string;
  today: string;
  yesterday: string;
  longTermPaths: string[];
  todayPaths: string[];
  yesterdayPaths: string[];
}> {
  const lanes = stableUnique(input.laneIds);

  const soul = await safeRead(join(input.rootDir, 'SOUL.md'));
  const user = await safeRead(join(input.rootDir, 'USER.md'));

  const todayDate = new Date();
  const yesterdayDate = new Date(todayDate.getTime() - 24 * 60 * 60 * 1000);

  const longTermPaths: string[] = [];
  const todayPaths: string[] = [];
  const yesterdayPaths: string[] = [];

  const longTermSections: LaneContextSection[] = [];
  const todaySections: LaneContextSection[] = [];
  const yesterdaySections: LaneContextSection[] = [];

  for (const laneId of lanes) {
    const lanePaths = { rootDir: input.rootDir, laneId };

    const longTermPath = getLaneLongTermPath(lanePaths);
    const todayPath = getLaneDailyPath(lanePaths, todayDate);
    const yesterdayPath = getLaneDailyPath(lanePaths, yesterdayDate);

    longTermPaths.push(longTermPath);
    todayPaths.push(todayPath);
    yesterdayPaths.push(yesterdayPath);

    longTermSections.push({
      laneId,
      text: await safeRead(longTermPath),
    });

    todaySections.push({
      laneId,
      text: await safeRead(todayPath),
    });

    yesterdaySections.push({
      laneId,
      text: await safeRead(yesterdayPath),
    });
  }

  return {
    soul,
    user,
    longTerm: renderLaneSections(longTermSections),
    today: renderLaneSections(todaySections),
    yesterday: renderLaneSections(yesterdaySections),
    longTermPaths,
    todayPaths,
    yesterdayPaths,
  };
}
