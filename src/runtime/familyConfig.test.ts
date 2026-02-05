import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getFamilyConfigPath, loadFamilyConfig } from './familyConfig.js';

describe('familyConfig', () => {
  it('resolves family config path from HALO_HOME', () => {
    expect(getFamilyConfigPath({ HALO_HOME: '/tmp/halo' } as any)).toBe(
      join('/tmp/halo', 'config', 'family.json'),
    );
  });

  it('defaults family config path to ~/.halo', () => {
    expect(getFamilyConfigPath({} as any)).toBe(
      join(homedir(), '.halo', 'config', 'family.json'),
    );
  });

  it('loads and validates family config from HALO_HOME', async () => {
    const haloHome = await mkdtemp(join(tmpdir(), 'halo-config-'));
    const configDir = join(haloHome, 'config');
    await mkdir(configDir, { recursive: true });

    const config = {
      schemaVersion: 1,
      familyId: 'default',
      members: [
        {
          memberId: 'wags',
          displayName: 'Wags',
          role: 'parent',
          telegramUserIds: [889348242],
        },
        {
          memberId: 'kid',
          displayName: 'Kid',
          role: 'child',
          ageGroup: 'child',
          telegramUserIds: [12345],
        },
      ],
      parentsGroup: {
        telegramChatId: null,
      },
    };

    await writeFile(
      join(configDir, 'family.json'),
      JSON.stringify(config, null, 2),
      'utf8',
    );

    const loaded = await loadFamilyConfig({ haloHome });
    expect(loaded).toEqual(config);
  });

  it('surfaces validation errors with context', async () => {
    const haloHome = await mkdtemp(join(tmpdir(), 'halo-config-'));
    const configDir = join(haloHome, 'config');
    await mkdir(configDir, { recursive: true });

    const config = {
      schemaVersion: 1,
      familyId: 'default',
      members: [
        {
          memberId: 'wags',
          displayName: 'Wags',
          role: 'parent',
          telegramUserIds: [],
        },
      ],
    };

    await writeFile(
      join(configDir, 'family.json'),
      JSON.stringify(config, null, 2),
      'utf8',
    );

    let error: unknown;
    try {
      await loadFamilyConfig({ haloHome });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('family.json');
    expect(message).toContain('telegramUserIds');
  });

  it('requires ageGroup for child members', async () => {
    const haloHome = await mkdtemp(join(tmpdir(), 'halo-config-'));
    const configDir = join(haloHome, 'config');
    await mkdir(configDir, { recursive: true });

    const config = {
      schemaVersion: 1,
      familyId: 'default',
      members: [
        {
          memberId: 'kid',
          displayName: 'Kid',
          role: 'child',
          telegramUserIds: [101],
        },
      ],
    };

    await writeFile(
      join(configDir, 'family.json'),
      JSON.stringify(config, null, 2),
      'utf8',
    );

    await expect(loadFamilyConfig({ haloHome })).rejects.toThrow('ageGroup');
  });
});
