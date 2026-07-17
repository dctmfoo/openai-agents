import { describe, expect, it } from 'vitest';

import {
  buildLaneStorageMetadata,
  resolveMemberMemoryLanes,
} from './laneTopology.js';

const legacyFamily = {
  schemaVersion: 1 as const,
  familyId: 'default',
  members: [
    {
      memberId: 'wags',
      displayName: 'Wags',
      role: 'parent' as const,
      telegramUserIds: [456],
    },
    {
      memberId: 'teen-1',
      displayName: 'Teen',
      role: 'child' as const,
      profileId: 'adolescent',
      telegramUserIds: [999],
    },
  ],
  parentsGroup: {
    telegramChatId: 777,
  },
};

describe('laneTopology', () => {
  it('resolves template defaults for parent and adolescent profiles', () => {
    const parent = legacyFamily.members[0];
    const teen = legacyFamily.members[1];

    const parentLanes = resolveMemberMemoryLanes(legacyFamily, parent);
    const teenLanes = resolveMemberMemoryLanes(legacyFamily, teen);

    expect(parentLanes.readLanes).toEqual([
      'parent_private:wags',
      'parents_shared',
      'family_shared',
    ]);
    expect(parentLanes.writeLanes).toEqual(['parent_private:wags']);

    expect(teenLanes.readLanes).toEqual([
      'child_private:teen-1',
      'child_shared',
    ]);
    expect(teenLanes.writeLanes).toEqual(['child_private:teen-1']);
  });

  it('resolves control-plane memory lane policies by profile mapping', () => {
    const controlPlaneFamily = {
      schemaVersion: 2 as const,
      familyId: 'default',
      members: [
        {
          memberId: 'kid-1',
          displayName: 'Kid',
          role: 'child' as const,
          profileId: 'young_child',
          telegramUserIds: [123],
        },
      ],
      parentsGroup: {
        telegramChatId: null,
      },
      controlPlane: {
        policyVersion: 'v2',
        activeProfileId: 'local-family',
        profiles: [
          {
            profileId: 'young_child',
            role: 'child' as const,
            capabilityTierId: 'cap_child',
            memoryLanePolicyId: 'lane_young_child',
            modelPolicyId: 'model_child',
            safetyPolicyId: 'safety_child',
          },
        ],
        scopes: [
          {
            scopeId: 'telegram:family_group:888',
            scopeType: 'family_group' as const,
            telegramChatId: 888,
          },
        ],
        capabilityTiers: {
          cap_child: ['chat.respond'],
        },
        memoryLanePolicies: {
          lane_young_child: {
            readLanes: ['child_private:{memberId}', 'family_shared'],
            writeLanes: ['child_private:{memberId}'],
          },
        },
        modelPolicies: {
          model_child: {
            tier: 'child_default',
            model: 'gpt-5.1-mini',
            reason: 'child_default',
          },
        },
        safetyPolicies: {
          safety_child: {
            riskLevel: 'medium' as const,
            escalationPolicyId: 'minor_default',
          },
        },
      },
    };

    const lanes = resolveMemberMemoryLanes(
      controlPlaneFamily,
      controlPlaneFamily.members[0],
    );

    expect(lanes.readLanes).toEqual([
      'child_private:kid-1',
      'family_shared',
    ]);
    expect(lanes.writeLanes).toEqual(['child_private:kid-1']);
  });

  it('builds storage metadata with deterministic visibility classes', () => {
    const metadata = buildLaneStorageMetadata({
      laneId: 'child_private:kid-1',
      ownerMemberId: 'kid-1',
      scopeId: 'telegram:dm:kid-1',
      policyVersion: 'v2',
      artifactType: 'chunk',
    });

    expect(metadata).toEqual({
      laneId: 'child_private:kid-1',
      ownerMemberId: 'kid-1',
      scopeId: 'telegram:dm:kid-1',
      policyVersion: 'v2',
      artifactType: 'chunk',
      visibilityClass: 'private',
    });
  });
});
