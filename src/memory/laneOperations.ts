import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

import { hashSessionId } from '../sessions/sessionHash.js';
import { getLaneLongTermPath, type LaneMemoryPaths } from './laneMemory.js';

type LaneOperationPaths = {
  rootDir: string;
  laneId: string;
};

type ExportedLaneDailyFile = {
  date: string;
  path: string;
  content: string;
};

type ExportedLaneMemory = {
  laneId: string;
  longTermPath: string;
  longTerm: string;
  dailyFiles: ExportedLaneDailyFile[];
};

type LaneRetentionResult = {
  laneId: string;
  retentionDays: number;
  deletedFiles: string[];
  keptFiles: string[];
};

type DeleteLaneMemoryResult = {
  laneId: string;
  deleted: boolean;
  sourcePath: string;
  trashPath: string;
};

function laneDirectory(paths: LaneOperationPaths): string {
  const laneHash = hashSessionId(paths.laneId);
  return join(paths.rootDir, 'memory', 'lanes', laneHash);
}

function laneTrashRoot(rootDir: string): string {
  return join(rootDir, 'memory', 'trash', 'lanes');
}

function isoTimestampKey(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function isDailyFilename(filename: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\.md$/.test(filename);
}

async function safeRead(path: string): Promise<string> {
  if (!existsSync(path)) {
    return '';
  }

  return await readFile(path, 'utf8');
}

function dailyFileAgeMs(filename: string, now: Date): number | null {
  if (!isDailyFilename(filename)) {
    return null;
  }

  const datePart = filename.slice(0, 'YYYY-MM-DD'.length);
  const parsed = new Date(`${datePart}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return now.getTime() - parsed.getTime();
}

function ensurePositiveRetentionDays(retentionDays: number): number {
  if (!Number.isFinite(retentionDays)) {
    throw new Error('retentionDays must be a finite positive integer.');
  }

  if (!Number.isInteger(retentionDays)) {
    throw new Error('retentionDays must be a positive integer.');
  }

  if (retentionDays <= 0) {
    throw new Error('retentionDays must be greater than 0.');
  }

  return retentionDays;
}

async function resolveUniqueTrashPath(basePath: string): Promise<string> {
  if (!existsSync(basePath)) {
    return basePath;
  }

  let attempt = 1;
  for (;;) {
    const candidate = `${basePath}-${attempt}`;
    if (!existsSync(candidate)) {
      return candidate;
    }

    attempt += 1;
  }
}

export async function exportLaneMemory(paths: LaneMemoryPaths): Promise<ExportedLaneMemory> {
  const sourceDir = laneDirectory(paths);
  const longTermPath = getLaneLongTermPath(paths);
  const longTerm = await safeRead(longTermPath);

  if (!existsSync(sourceDir)) {
    return {
      laneId: paths.laneId,
      longTermPath,
      longTerm,
      dailyFiles: [],
    };
  }

  const files = await readdir(sourceDir, { withFileTypes: true });
  const dailyFilenames = files
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => isDailyFilename(name))
    .sort();

  const dailyFiles: ExportedLaneDailyFile[] = [];

  for (const filename of dailyFilenames) {
    const date = filename.slice(0, 'YYYY-MM-DD'.length);
    const filePath = join(sourceDir, filename);
    const content = await readFile(filePath, 'utf8');
    dailyFiles.push({
      date,
      path: filePath,
      content,
    });
  }

  return {
    laneId: paths.laneId,
    longTermPath,
    longTerm,
    dailyFiles,
  };
}

export async function runLaneRetention(input: {
  rootDir: string;
  laneId: string;
  retentionDays: number;
  now?: Date;
  dryRun?: boolean;
}): Promise<LaneRetentionResult> {
  const retentionDays = ensurePositiveRetentionDays(input.retentionDays);
  const now = input.now ?? new Date();
  const sourceDir = laneDirectory({ rootDir: input.rootDir, laneId: input.laneId });

  if (!existsSync(sourceDir)) {
    return {
      laneId: input.laneId,
      retentionDays,
      deletedFiles: [],
      keptFiles: [],
    };
  }

  const entries = await readdir(sourceDir, { withFileTypes: true });
  const dailyFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((filename) => isDailyFilename(filename))
    .sort();

  const deletedFiles: string[] = [];
  const keptFiles: string[] = [];

  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
  const trashBase = join(
    laneTrashRoot(input.rootDir),
    `${isoTimestampKey(now)}-retention-${hashSessionId(input.laneId)}`,
  );
  let trashDir: string | null = null;

  for (const filename of dailyFiles) {
    const ageMs = dailyFileAgeMs(filename, now);
    if (ageMs === null) {
      keptFiles.push(filename);
      continue;
    }

    const shouldDelete = ageMs > maxAgeMs;
    if (!shouldDelete) {
      keptFiles.push(filename);
      continue;
    }

    deletedFiles.push(filename);

    if (input.dryRun) {
      continue;
    }

    if (!trashDir) {
      trashDir = await resolveUniqueTrashPath(trashBase);
      await mkdir(trashDir, { recursive: true });
    }

    await rename(join(sourceDir, filename), join(trashDir, filename));
  }

  return {
    laneId: input.laneId,
    retentionDays,
    deletedFiles,
    keptFiles,
  };
}

export async function deleteLaneMemory(input: {
  rootDir: string;
  laneId: string;
  now?: Date;
}): Promise<DeleteLaneMemoryResult> {
  const now = input.now ?? new Date();
  const sourcePath = laneDirectory({ rootDir: input.rootDir, laneId: input.laneId });

  const trashRoot = laneTrashRoot(input.rootDir);
  await mkdir(trashRoot, { recursive: true });

  const trashBasePath = join(
    trashRoot,
    `${isoTimestampKey(now)}-${hashSessionId(input.laneId)}`,
  );
  const trashPath = await resolveUniqueTrashPath(trashBasePath);

  if (!existsSync(sourcePath)) {
    return {
      laneId: input.laneId,
      deleted: false,
      sourcePath,
      trashPath,
    };
  }

  await rename(sourcePath, trashPath);

  return {
    laneId: input.laneId,
    deleted: true,
    sourcePath,
    trashPath,
  };
}
