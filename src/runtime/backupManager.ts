import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { appendIncidentEvent, type IncidentEventAction } from './incidentLog.js';

const BACKUP_MANIFEST_SCHEMA_VERSION = 1;

const DEFAULT_BACKUP_PATHS = ['config', 'memory', 'sessions', 'transcripts', 'logs'] as const;

type BackupManifest = {
  schemaVersion: number;
  backupId: string;
  createdAtMs: number;
  includedPaths: string[];
  fileCount: number;
  totalBytes: number;
};

type RuntimeBackupResult = {
  backupId: string;
  backupDir: string;
  manifestPath: string;
  includedPaths: string[];
  fileCount: number;
  totalBytes: number;
};

type RuntimeRestoreResult = {
  backupId: string;
  manifestPath: string;
  restoredPaths: string[];
};

type BackupIncident = {
  action: IncidentEventAction;
  severity: 'warning' | 'critical';
  message: string;
  details?: Record<string, unknown>;
};

type BackupIncidentReporter = (event: BackupIncident) => Promise<void> | void;

type CreateRuntimeBackupOptions = {
  rootDir: string;
  backupId?: string;
  includePaths?: string[];
  now?: Date;
  reportIncident?: BackupIncidentReporter;
};

type RestoreRuntimeBackupOptions = {
  rootDir: string;
  backupId: string;
  restorePaths?: string[];
  reportIncident?: BackupIncidentReporter;
};

function sanitizeBackupId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('backupId must not be empty.');
  }

  if (/[\\/]/.test(trimmed) || trimmed.includes('..')) {
    throw new Error('backupId must not contain path separators or traversal segments.');
  }

  return trimmed;
}

function normalizeRuntimeRelativePath(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must not be empty.`);
  }

  const normalizedSlashes = trimmed.replace(/\\/g, '/');
  if (normalizedSlashes.startsWith('/')) {
    throw new Error(`${fieldName} must be a relative path.`);
  }

  if (/^[A-Za-z]:/.test(normalizedSlashes)) {
    throw new Error(`${fieldName} must be a relative path.`);
  }

  const segments = normalizedSlashes.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`${fieldName} must not contain path traversal segments.`);
  }

  return segments.join('/');
}

function normalizeRuntimeRelativePathList(values: string[], fieldName: string): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    unique.add(normalizeRuntimeRelativePath(value, fieldName));
  }

  return Array.from(unique).sort();
}

function normalizeBackupId(value: string | undefined, now: Date): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return `backup-${now.toISOString().replace(/[:.]/g, '-')}`;
  }

  return sanitizeBackupId(trimmed);
}

function backupRootDir(rootDir: string, backupId: string): string {
  return join(rootDir, 'backups', backupId);
}

function backupSnapshotDir(rootDir: string, backupId: string): string {
  return join(backupRootDir(rootDir, backupId), 'snapshot');
}

function backupManifestPath(rootDir: string, backupId: string): string {
  return join(backupRootDir(rootDir, backupId), 'manifest.json');
}

function normalizeIncludedPaths(includePaths?: string[]): string[] {
  const source = includePaths && includePaths.length > 0 ? includePaths : [...DEFAULT_BACKUP_PATHS];
  return normalizeRuntimeRelativePathList(source, 'includePaths entry');
}

async function collectSnapshotStats(snapshotPath: string): Promise<{ fileCount: number; totalBytes: number }> {
  if (!existsSync(snapshotPath)) {
    return {
      fileCount: 0,
      totalBytes: 0,
    };
  }

  const stack = [snapshotPath];
  let fileCount = 0;
  let totalBytes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const currentStat = await stat(current);
    if (currentStat.isFile()) {
      fileCount += 1;
      totalBytes += currentStat.size;
      continue;
    }

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      stack.push(join(current, entry.name));
    }
  }

  return {
    fileCount,
    totalBytes,
  };
}

function createIncidentReporter(
  rootDir: string,
  reportIncident?: BackupIncidentReporter,
): BackupIncidentReporter {
  if (reportIncident) {
    return reportIncident;
  }

  return async (event) => {
    await appendIncidentEvent({
      rootDir,
      action: event.action,
      severity: event.severity,
      message: event.message,
      details: event.details,
    });
  };
}

async function reportAndThrow(
  reporter: BackupIncidentReporter,
  payload: BackupIncident,
  error: Error,
): Promise<never> {
  await reporter(payload);
  throw error;
}

export async function createRuntimeBackup(
  options: CreateRuntimeBackupOptions,
): Promise<RuntimeBackupResult> {
  const now = options.now ?? new Date();
  const backupId = normalizeBackupId(options.backupId, now);
  const includePaths = normalizeIncludedPaths(options.includePaths);
  const reporter = createIncidentReporter(options.rootDir, options.reportIncident);

  const backupDir = backupRootDir(options.rootDir, backupId);
  const snapshotDir = backupSnapshotDir(options.rootDir, backupId);
  const manifestPath = backupManifestPath(options.rootDir, backupId);

  try {
    await mkdir(snapshotDir, { recursive: true });

    const includedPaths: string[] = [];
    for (const relativePath of includePaths) {
      const source = join(options.rootDir, relativePath);
      if (!existsSync(source)) {
        continue;
      }

      const destination = join(snapshotDir, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: true, force: true });
      includedPaths.push(relativePath);
    }

    const stats = await collectSnapshotStats(snapshotDir);

    const manifest: BackupManifest = {
      schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION,
      backupId,
      createdAtMs: now.getTime(),
      includedPaths,
      fileCount: stats.fileCount,
      totalBytes: stats.totalBytes,
    };

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    return {
      backupId,
      backupDir,
      manifestPath,
      includedPaths,
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return await reportAndThrow(
      reporter,
      {
        action: 'backup_create',
        severity: 'critical',
        message: 'backup_create_failed',
        details: {
          backupId,
          reason,
        },
      },
      error instanceof Error ? error : new Error(reason),
    );
  }
}

export async function restoreRuntimeBackup(
  options: RestoreRuntimeBackupOptions,
): Promise<RuntimeRestoreResult> {
  const backupId = sanitizeBackupId(options.backupId);
  const reporter = createIncidentReporter(options.rootDir, options.reportIncident);

  const snapshotDir = backupSnapshotDir(options.rootDir, backupId);
  const manifestPath = backupManifestPath(options.rootDir, backupId);

  if (!existsSync(manifestPath)) {
    return await reportAndThrow(
      reporter,
      {
        action: 'backup_restore',
        severity: 'critical',
        message: 'backup_manifest_missing',
        details: {
          backupId,
        },
      },
      new Error(`Backup manifest not found for ${backupId}.`),
    );
  }

  try {
    const raw = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as BackupManifest;

    if (!Array.isArray(manifest.includedPaths)) {
      throw new Error('Backup manifest is invalid: includedPaths must be an array.');
    }

    const manifestIncludedPaths = normalizeRuntimeRelativePathList(
      manifest.includedPaths,
      'manifest included path',
    );

    const selectedPaths = options.restorePaths && options.restorePaths.length > 0
      ? normalizeRuntimeRelativePathList(options.restorePaths, 'restorePaths entry')
      : manifestIncludedPaths;

    const restoredPaths: string[] = [];

    for (const relativePath of selectedPaths) {
      const source = join(snapshotDir, relativePath);
      if (!existsSync(source)) {
        continue;
      }

      const destination = join(options.rootDir, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: true, force: true });
      restoredPaths.push(relativePath);
    }

    return {
      backupId,
      manifestPath,
      restoredPaths,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return await reportAndThrow(
      reporter,
      {
        action: 'backup_restore',
        severity: 'critical',
        message: 'backup_restore_failed',
        details: {
          backupId,
          reason,
        },
      },
      error instanceof Error ? error : new Error(reason),
    );
  }
}
