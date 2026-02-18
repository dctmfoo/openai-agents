import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createRuntimeBackup,
  restoreRuntimeBackup,
} from './backupManager.js';

describe('backupManager', () => {
  it('creates and restores backups for local runtime state', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'halo-backup-'));
    await mkdir(path.join(rootDir, 'config'), { recursive: true });
    await mkdir(path.join(rootDir, 'memory', 'lanes'), { recursive: true });

    const configPath = path.join(rootDir, 'config', 'family.json');
    const memoryPath = path.join(rootDir, 'memory', 'lanes', 'note.md');

    await writeFile(configPath, '{"version":1}\n', 'utf8');
    await writeFile(memoryPath, '# memory\n', 'utf8');

    const backup = await createRuntimeBackup({
      rootDir,
      backupId: 'backup-1',
      now: new Date('2026-02-18T09:00:00.000Z'),
    });

    expect(backup.backupId).toBe('backup-1');
    expect(backup.manifestPath).toContain(path.join('backups', 'backup-1', 'manifest.json'));
    expect(backup.includedPaths).toEqual(expect.arrayContaining(['config', 'memory']));

    await writeFile(configPath, '{"version":2}\n', 'utf8');

    const restored = await restoreRuntimeBackup({
      rootDir,
      backupId: 'backup-1',
    });

    expect(restored.backupId).toBe('backup-1');
    expect(restored.restoredPaths).toEqual(expect.arrayContaining(['config', 'memory']));
    expect(await readFile(configPath, 'utf8')).toBe('{"version":1}\n');
  });

  it('reports restore incidents when backup is missing', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'halo-backup-'));
    const incidents: Array<{ action: string; message: string }> = [];

    await expect(
      restoreRuntimeBackup({
        rootDir,
        backupId: 'missing-backup',
        reportIncident: async (event) => {
          incidents.push({
            action: event.action,
            message: event.message,
          });
        },
      }),
    ).rejects.toThrow('missing-backup');

    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toEqual({
      action: 'backup_restore',
      message: 'backup_manifest_missing',
    });
  });

  it('rejects backup identifiers with traversal separators', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'halo-backup-'));

    await expect(
      createRuntimeBackup({
        rootDir,
        backupId: '../escape',
      }),
    ).rejects.toThrow('backupId');

    await expect(
      restoreRuntimeBackup({
        rootDir,
        backupId: '../escape',
      }),
    ).rejects.toThrow('backupId');
  });

  it('rejects include and restore paths that attempt traversal', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'halo-backup-'));
    await mkdir(path.join(rootDir, 'config'), { recursive: true });
    await writeFile(path.join(rootDir, 'config', 'family.json'), '{"version":1}\n', 'utf8');

    await expect(
      createRuntimeBackup({
        rootDir,
        backupId: 'backup-safe',
        includePaths: ['../../etc'],
      }),
    ).rejects.toThrow('includePaths entry');

    await createRuntimeBackup({
      rootDir,
      backupId: 'backup-safe',
    });

    await expect(
      restoreRuntimeBackup({
        rootDir,
        backupId: 'backup-safe',
        restorePaths: ['../../etc'],
      }),
    ).rejects.toThrow('restorePaths entry');
  });

  it('rejects tampered manifest paths during restore', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'halo-backup-'));
    await mkdir(path.join(rootDir, 'config'), { recursive: true });
    await writeFile(path.join(rootDir, 'config', 'family.json'), '{"version":1}\n', 'utf8');

    const backup = await createRuntimeBackup({
      rootDir,
      backupId: 'backup-manifest-check',
    });

    const manifest = JSON.parse(await readFile(backup.manifestPath, 'utf8')) as {
      schemaVersion: number;
      backupId: string;
      createdAtMs: number;
      includedPaths: string[];
      fileCount: number;
      totalBytes: number;
    };

    manifest.includedPaths = ['../../etc'];
    await writeFile(backup.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    await expect(
      restoreRuntimeBackup({
        rootDir,
        backupId: 'backup-manifest-check',
      }),
    ).rejects.toThrow('manifest included path');
  });
});
