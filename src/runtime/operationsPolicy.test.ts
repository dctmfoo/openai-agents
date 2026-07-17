import { describe, expect, it } from 'vitest';

import type { FamilyConfig } from './familyConfig.js';
import {
  canManageOperationalControls,
  resolveLaneRetentionDays,
} from './operationsPolicy.js';

function buildFamilyWithOperations(): FamilyConfig {
  const value = {
    schemaVersion: 2,
    familyId: 'household',
    members: [
      {
        memberId: 'mom',
        displayName: 'Mom',
        role: 'parent',
        profileId: 'parent_default',
        telegramUserIds: [1],
      },
      {
        memberId: 'dad',
        displayName: 'Dad',
        role: 'parent',
        profileId: 'parent_default',
        telegramUserIds: [2],
      },
      {
        memberId: 'kid',
        displayName: 'Kid',
        role: 'child',
        profileId: 'young_child',
        telegramUserIds: [3],
      },
    ],
    parentsGroup: { telegramChatId: 999 },
    controlPlane: {
      policyVersion: 'v2',
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
      scopes: [
        {
          scopeId: 'telegram:parents_group:999',
          scopeType: 'parents_group',
          telegramChatId: 999,
        },
      ],
      capabilityTiers: {
        cap_parent: ['chat.respond'],
        cap_child: ['chat.respond'],
      },
      memoryLanePolicies: {
        lane_parent: {
          readLanes: ['parent_private:{memberId}', 'family_shared'],
          writeLanes: ['parent_private:{memberId}'],
        },
        lane_child: {
          readLanes: ['child_private:{memberId}', 'family_shared'],
          writeLanes: ['child_private:{memberId}'],
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
      operations: {
        managerMemberIds: ['mom'],
        laneRetention: {
          defaultDays: 30,
          byLaneId: {
            'child_private:kid': 7,
          },
        },
      },
    },
  };

  return value as unknown as FamilyConfig;
}

describe('operationsPolicy', () => {
  it('allows only configured parent managers to run operational controls', () => {
    const family = buildFamilyWithOperations();

    expect(canManageOperationalControls(family, 'mom')).toEqual({
      allow: true,
      reason: 'parent_manager',
    });

    expect(canManageOperationalControls(family, 'dad')).toEqual({
      allow: false,
      reason: 'parent_not_manager',
    });

    expect(canManageOperationalControls(family, 'kid')).toEqual({
      allow: false,
      reason: 'not_parent',
    });
  });

  it('resolves per-lane retention with lane override before default', () => {
    const family = buildFamilyWithOperations();

    expect(resolveLaneRetentionDays(family, 'child_private:kid')).toBe(7);
    expect(resolveLaneRetentionDays(family, 'family_shared')).toBe(30);
  });
});
