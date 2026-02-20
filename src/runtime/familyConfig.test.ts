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

  it('loads v2 control-plane config from the active profile path', async () => {
    const haloHome = await mkdtemp(join(tmpdir(), 'halo-config-'));
    const configDir = join(haloHome, 'config');
    await mkdir(configDir, { recursive: true });

    await writeFile(
      join(haloHome, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        controlPlane: {
          activeProfile: 'v2',
          profiles: {
            v2: {
              path: 'config/control-plane.json',
            },
          },
        },
      }),
      'utf8',
    );

    const controlPlane = {
      schemaVersion: 2,
      policyVersion: 'v2',
      familyId: 'default',
      activeProfileId: 'default_household',
      profiles: [
        {
          profileId: 'parent_default',
          role: 'parent',
          capabilityTierId: 'cap_parent',
          memoryLanePolicyId: 'lane_parent',
          modelPolicyId: 'model_parent',
          safetyPolicyId: 'safety_parent',
        },
        {
          profileId: 'young_child',
          role: 'child',
          capabilityTierId: 'cap_child',
          memoryLanePolicyId: 'lane_child',
          modelPolicyId: 'model_child',
          safetyPolicyId: 'safety_child',
        },
      ],
      members: [
        {
          memberId: 'wags',
          displayName: 'Wags',
          role: 'parent',
          profileId: 'parent_default',
          telegramUserIds: [456],
        },
        {
          memberId: 'kid',
          displayName: 'Kid',
          role: 'child',
          profileId: 'young_child',
          telegramUserIds: [999],
        },
      ],
      scopes: [
        {
          scopeId: 'telegram:parents_group:700',
          scopeType: 'parents_group',
          telegramChatId: 700,
        },
      ],
      capabilityTiers: {
        cap_parent: ['chat.respond', 'tools.shell'],
        cap_child: ['chat.respond'],
      },
      memoryLanePolicies: {
        lane_parent: {
          readLanes: ['parent_private:wags', 'family_shared'],
          writeLanes: ['parent_private:wags'],
        },
        lane_child: {
          readLanes: ['child_private:kid', 'child_shared'],
          writeLanes: ['child_private:kid'],
        },
      },
      modelPolicies: {
        model_parent: {
          tier: 'parent_default',
          model: 'gpt-5.1',
          reason: 'parent_dm',
        },
        model_child: {
          tier: 'child_default',
          model: 'gpt-5.1-mini',
          reason: 'child_dm',
        },
      },
      safetyPolicies: {
        safety_parent: {
          riskLevel: 'low',
          escalationPolicyId: 'none',
        },
        safety_child: {
          riskLevel: 'medium',
          escalationPolicyId: 'minor_default',
        },
      },
    };

    await writeFile(
      join(configDir, 'control-plane.json'),
      JSON.stringify(controlPlane, null, 2),
      'utf8',
    );

    const loaded = await loadFamilyConfig({ haloHome });

    expect(loaded).toMatchObject({
      schemaVersion: 2,
      familyId: 'default',
      parentsGroup: {
        telegramChatId: 700,
      },
      controlPlane: {
        policyVersion: 'v2',
        activeProfileId: 'default_household',
      },
    });

    expect(loaded.controlPlane?.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: 'young_child',
          memoryLanePolicyId: 'lane_child',
        }),
      ]),
    );

    expect(loaded.members).toContainEqual(
      expect.objectContaining({
        memberId: 'kid',
        role: 'child',
        profileId: 'young_child',
      }),
    );
  });

  it('loads optional operations policy controls from v2 control-plane config', async () => {
    const haloHome = await mkdtemp(join(tmpdir(), 'halo-config-'));
    const configDir = join(haloHome, 'config');
    await mkdir(configDir, { recursive: true });

    await writeFile(
      join(haloHome, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        controlPlane: {
          activeProfile: 'v2',
          profiles: {
            v2: {
              path: 'config/control-plane.json',
            },
          },
        },
      }),
      'utf8',
    );

    await writeFile(
      join(configDir, 'control-plane.json'),
      JSON.stringify({
        schemaVersion: 2,
        policyVersion: 'v2',
        familyId: 'default',
        activeProfileId: 'default_household',
        profiles: [
          {
            profileId: 'parent_default',
            role: 'parent',
            capabilityTierId: 'cap_parent',
            memoryLanePolicyId: 'lane_parent',
            modelPolicyId: 'model_parent',
            safetyPolicyId: 'safety_parent',
          },
        ],
        members: [
          {
            memberId: 'wags',
            displayName: 'Wags',
            role: 'parent',
            profileId: 'parent_default',
            telegramUserIds: [456],
          },
        ],
        scopes: [
          {
            scopeId: 'telegram:parents_group:700',
            scopeType: 'parents_group',
            telegramChatId: 700,
          },
        ],
        capabilityTiers: {
          cap_parent: ['chat.respond'],
        },
        memoryLanePolicies: {
          lane_parent: {
            readLanes: ['parent_private:{memberId}', 'family_shared'],
            writeLanes: ['parent_private:{memberId}'],
          },
        },
        modelPolicies: {
          model_parent: {
            tier: 'parent_default',
            model: 'gpt-5.1',
            reason: 'parent_dm',
          },
        },
        safetyPolicies: {
          safety_parent: {
            riskLevel: 'low',
            escalationPolicyId: 'none',
          },
        },
        operations: {
          managerMemberIds: ['wags'],
          laneRetention: {
            defaultDays: 30,
            byLaneId: {
              family_shared: 14,
            },
          },
        },
      }),
      'utf8',
    );

    const loaded = await loadFamilyConfig({ haloHome });
    const controlPlane = loaded.controlPlane as
      | {
          operations?: {
            managerMemberIds?: string[];
            laneRetention?: {
              defaultDays?: number;
              byLaneId?: Record<string, number>;
            };
          };
        }
      | undefined;

    expect(controlPlane?.operations?.managerMemberIds).toEqual(['wags']);
    expect(controlPlane?.operations?.laneRetention?.defaultDays).toBe(30);
    expect(controlPlane?.operations?.laneRetention?.byLaneId).toEqual({
      family_shared: 14,
    });
  });

  it('rejects invalid v2 control-plane config with clear profile errors', async () => {
    const haloHome = await mkdtemp(join(tmpdir(), 'halo-config-'));
    const configDir = join(haloHome, 'config');
    await mkdir(configDir, { recursive: true });

    await writeFile(
      join(haloHome, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        controlPlane: {
          activeProfile: 'v2',
          profiles: {
            v2: {
              path: 'config/control-plane.json',
            },
          },
        },
      }),
      'utf8',
    );

    await writeFile(
      join(configDir, 'control-plane.json'),
      JSON.stringify({
        schemaVersion: 2,
        policyVersion: 'v2',
        familyId: 'default',
        activeProfileId: 'default_household',
        profiles: [
          {
            profileId: 'parent_default',
            role: 'parent',
            capabilityTierId: 'cap_parent',
            memoryLanePolicyId: 'lane_parent',
            modelPolicyId: 'model_parent',
            safetyPolicyId: 'safety_parent',
          },
        ],
        members: [
          {
            memberId: 'kid',
            displayName: 'Kid',
            role: 'child',
            profileId: 'missing_profile',
            telegramUserIds: [999],
          },
        ],
        scopes: [
          {
            scopeId: 'telegram:family_group:888',
            scopeType: 'family_group',
            telegramChatId: 888,
          },
        ],
        capabilityTiers: {
          cap_parent: ['chat.respond'],
        },
        memoryLanePolicies: {
          lane_parent: {
            readLanes: ['family_shared'],
            writeLanes: ['family_shared'],
          },
        },
        modelPolicies: {
          model_parent: {
            tier: 'group_safe',
            model: 'gpt-5.1-mini',
            reason: 'default',
          },
        },
        safetyPolicies: {
          safety_parent: {
            riskLevel: 'low',
            escalationPolicyId: 'none',
          },
        },
      }),
      'utf8',
    );

    await expect(loadFamilyConfig({ haloHome })).rejects.toThrow('member profileId');
  });

  it('fails when active control-plane profile file is missing', async () => {
    const haloHome = await mkdtemp(join(tmpdir(), 'halo-config-'));
    await mkdir(join(haloHome, 'config'), { recursive: true });

    await writeFile(
      join(haloHome, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        controlPlane: {
          activeProfile: 'v2',
          profiles: {
            v2: {
              path: 'config/control-plane.json',
            },
          },
        },
      }),
      'utf8',
    );

    await expect(loadFamilyConfig({ haloHome })).rejects.toThrow(
      join(haloHome, 'config', 'control-plane.json'),
    );
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

  it('loads onboarding contracts when provided in family config', async () => {
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
      ],
      onboarding: {
        household: {
          householdId: 'default-household',
          displayName: 'Default household',
          ownerMemberId: 'wags',
          createdAt: '2026-02-17T10:00:00.000Z',
        },
        memberLinks: [
          {
            memberId: 'wags',
            role: 'parent',
            profileId: 'parent_default',
            telegramUserId: 889348242,
            linkedAt: '2026-02-17T10:01:00.000Z',
            linkedByMemberId: 'wags',
          },
        ],
        invites: [
          {
            inviteId: 'invite-1',
            householdId: 'default-household',
            role: 'child',
            profileId: 'young_child',
            issuedByMemberId: 'wags',
            issuedAt: '2026-02-17T10:05:00.000Z',
            expiresAt: '2026-02-18T10:05:00.000Z',
            state: 'issued',
          },
        ],
        relinks: [],
        scopeTerminology: {
          dm: 'member DM',
          parentsGroup: 'parents group',
          familyGroup: 'family group',
        },
      },
    };

    await writeFile(
      join(configDir, 'family.json'),
      JSON.stringify(config, null, 2),
      'utf8',
    );

    const loaded = await loadFamilyConfig({ haloHome });

    expect(loaded.onboarding?.scopeTerminology.dm).toBe('member DM');
    expect(loaded.onboarding?.memberLinks[0]?.telegramUserId).toBe(889348242);
  });

  it('rejects invalid onboarding relink contracts in family config', async () => {
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
      ],
      onboarding: {
        household: {
          householdId: 'default-household',
          displayName: 'Default household',
          ownerMemberId: 'wags',
          createdAt: '2026-02-17T10:00:00.000Z',
        },
        memberLinks: [
          {
            memberId: 'wags',
            role: 'parent',
            profileId: 'parent_default',
            telegramUserId: 889348242,
            linkedAt: '2026-02-17T10:01:00.000Z',
            linkedByMemberId: 'wags',
          },
        ],
        invites: [],
        relinks: [
          {
            relinkId: 'relink-1',
            householdId: 'default-household',
            memberId: 'wags',
            previousTelegramUserId: 889348242,
            nextTelegramUserId: 889348242,
            requestedByMemberId: 'wags',
            requestedAt: '2026-02-17T10:10:00.000Z',
            approvedByMemberId: 'wags',
            approvedAt: '2026-02-17T10:11:00.000Z',
          },
        ],
        scopeTerminology: {
          dm: 'member DM',
          parentsGroup: 'parents group',
          familyGroup: 'family group',
        },
      },
    };

    await writeFile(
      join(configDir, 'family.json'),
      JSON.stringify(config, null, 2),
      'utf8',
    );

    await expect(loadFamilyConfig({ haloHome })).rejects.toThrow('nextTelegramUserId');
  });
});
