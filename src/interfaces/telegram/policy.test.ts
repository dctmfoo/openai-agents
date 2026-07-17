import { describe, expect, it } from 'vitest';

import { resolveDecisionEnvelope } from '../../policies/decisionEnvelope.js';
import { resolveTelegramPolicy } from './policy.js';

const baseFamily = {
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
      memberId: 'kid',
      displayName: 'Kid',
      role: 'child' as const,
      ageGroup: 'child' as const,
      telegramUserIds: [999],
    },
  ],
  parentsGroup: {
    telegramChatId: 777,
  },
};

describe('telegram policy', () => {
  it('denies unknown users in dms', () => {
    const decision = resolveTelegramPolicy({
      chat: { id: 1, type: 'private' },
      fromId: 123,
      family: baseFamily,
    });

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('unknown_user');
  });

  it('scopes dm messages by member id', () => {
    const decision = resolveTelegramPolicy({
      chat: { id: 456, type: 'private' },
      fromId: 456,
      family: baseFamily,
    });

    expect(decision.allow).toBe(true);
    expect(decision.scopeType).toBe('dm');
    expect(decision.scopeId).toBe('telegram:dm:wags');
    expect(decision.allowedMemoryReadLanes).toEqual([
      'family_shared',
      'parent_private:wags',
      'parents_shared',
    ]);
  });

  it('includes age group for child dms', () => {
    const decision = resolveTelegramPolicy({
      chat: { id: 999, type: 'private' },
      fromId: 999,
      family: baseFamily,
    });

    expect(decision.allow).toBe(true);
    expect(decision.scopeType).toBe('dm');
    expect(decision.scopeId).toBe('telegram:dm:kid');
    expect(decision.ageGroup).toBe('child');
  });

  it('denies unapproved groups', () => {
    const decision = resolveTelegramPolicy({
      chat: { id: 321, type: 'group' },
      fromId: 456,
      family: { ...baseFamily, parentsGroup: { telegramChatId: null } },
    });

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('group_not_approved');
  });

  it('allows parents in the approved group and scopes to the group', () => {
    const decision = resolveTelegramPolicy({
      chat: { id: 777, type: 'group' },
      fromId: 456,
      family: baseFamily,
    });

    expect(decision.allow).toBe(true);
    expect(decision.scopeType).toBe('parents_group');
    expect(decision.scopeId).toBe('telegram:parents_group:777');
  });

  it('denies children in the parents group', () => {
    const decision = resolveTelegramPolicy({
      chat: { id: 777, type: 'group' },
      fromId: 999,
      family: baseFamily,
    });

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('child_in_parents_group');
  });

  it('allows family-group messages when halo is mentioned', () => {
    const decision = resolveTelegramPolicy({
      chat: { id: 888, type: 'group' },
      fromId: 456,
      family: baseFamily,
      familyGroupChatId: 888,
      intent: { isMentioned: true },
    });

    expect(decision.allow).toBe(true);
    expect(decision.scopeType).toBe('family_group');
    expect(decision.scopeId).toBe('telegram:family_group:888');
    expect(decision.allowedCapabilities).toContain('chat.respond.group_safe');
  });

  it('denies family-group messages without mention', () => {
    const decision = resolveTelegramPolicy({
      chat: { id: 888, type: 'group' },
      fromId: 456,
      family: baseFamily,
      familyGroupChatId: 888,
      intent: { isMentioned: false },
    });

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('mention_required');
    expect(decision.rationale).toContain('mention_required_in_family_group');
  });
});

describe('decision envelope baseline scenarios', () => {
  it('allows parent dms', () => {
    const envelope = resolveDecisionEnvelope({
      policyVersion: 'v1',
      chat: { id: 456, type: 'private' },
      fromId: 456,
      family: baseFamily,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
    });

    expect(envelope.action).toBe('allow');
    expect(envelope.scope.scopeType).toBe('dm');
    expect(envelope.speaker.memberId).toBe('wags');
  });

  it('allows child dms', () => {
    const envelope = resolveDecisionEnvelope({
      policyVersion: 'v1',
      chat: { id: 999, type: 'private' },
      fromId: 999,
      family: baseFamily,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
    });

    expect(envelope.action).toBe('allow');
    expect(envelope.scope.scopeType).toBe('dm');
    expect(envelope.speaker.memberId).toBe('kid');
    expect(envelope.speaker.role).toBe('child');
  });

  it('denies family-group messages when halo is not mentioned', () => {
    const envelope = resolveDecisionEnvelope({
      policyVersion: 'v1',
      chat: { id: 888, type: 'group' },
      fromId: 456,
      family: baseFamily,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
    });

    expect(envelope.action).toBe('deny');
    expect(envelope.scope.scopeType).toBe('family_group');
    expect(envelope.rationale).toContain('mention_required_in_family_group');
  });

  it('denies unknown users', () => {
    const envelope = resolveDecisionEnvelope({
      policyVersion: 'v1',
      chat: { id: 111, type: 'private' },
      fromId: 111,
      family: baseFamily,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
    });

    expect(envelope.action).toBe('deny');
    expect(envelope.rationale).toContain('unknown_user');
  });
});

describe('resolveTelegramPolicy modelPlan', () => {
  it('returns modelPlan from the envelope for an allowed dm', () => {
    const decision = resolveTelegramPolicy({
      chat: { id: 456, type: 'private' },
      fromId: 456,
      family: baseFamily,
    });

    expect(decision.allow).toBe(true);
    expect(decision.modelPlan).toBeDefined();
    expect(decision.modelPlan.model).toBe('gpt-4.1');
    expect(decision.modelPlan.tier).toBe('parent_default');
    expect(decision.modelPlan.reason).toBe('dm_default');
  });

  it('uses config-driven model from controlPlane modelPolicies for dm', () => {
    const familyWithModelPolicy = {
      schemaVersion: 1 as const,
      familyId: 'default',
      members: [
        {
          memberId: 'wags',
          displayName: 'Wags',
          role: 'parent' as const,
          profileId: 'parent_default',
          telegramUserIds: [456],
        },
      ],
      controlPlane: {
        policyVersion: 'v2',
        activeProfileId: 'parent_default',
        profiles: [
          {
            profileId: 'parent_default',
            role: 'parent' as const,
            capabilityTierId: 'parent',
            memoryLanePolicyId: 'parent_dm',
            modelPolicyId: 'parent_model',
            safetyPolicyId: 'parent_safety',
          },
        ],
        scopes: [
          { scopeId: 'scope-dm', scopeType: 'dm' as const, telegramChatId: null },
        ],
        capabilityTiers: { parent: ['chat.respond'] },
        memoryLanePolicies: {
          parent_dm: {
            readLanes: ['family_shared', 'parent_private:wags', 'parents_shared'],
            writeLanes: ['parent_private:wags'],
          },
        },
        modelPolicies: {
          parent_model: { tier: 'parent_premium', model: 'gpt-4.1-custom', reason: 'config_driven' },
        },
        safetyPolicies: { parent_safety: { riskLevel: 'low' as const, escalationPolicyId: 'none' } },
      },
    };

    const decision = resolveTelegramPolicy({
      chat: { id: 456, type: 'private' },
      fromId: 456,
      family: familyWithModelPolicy,
    });

    expect(decision.allow).toBe(true);
    expect(decision.modelPlan.model).toBe('gpt-4.1-custom');
    expect(decision.modelPlan.tier).toBe('parent_premium');
    expect(decision.modelPlan.reason).toBe('config_driven');
  });
});
