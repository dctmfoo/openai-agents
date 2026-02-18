import { describe, expect, it } from 'vitest';

import { resolveDecisionEnvelope } from './decisionEnvelope.js';

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

describe('decisionEnvelope precedence', () => {
  it('applies safety hard deny before dm allow', () => {
    const envelope = resolveDecisionEnvelope({
      policyVersion: 'v1',
      chat: { id: 456, type: 'private' },
      fromId: 456,
      family: baseFamily,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
      safetySignal: { riskLevel: 'high' },
    });

    expect(envelope.action).toBe('deny');
    expect(envelope.rationale).toContain('safety_high_risk_hard_deny');
  });

  it('allows parent messages in parents-group scope', () => {
    const envelope = resolveDecisionEnvelope({
      policyVersion: 'v1',
      chat: { id: 777, type: 'group' },
      fromId: 456,
      family: baseFamily,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
    });

    expect(envelope.action).toBe('allow');
    expect(envelope.scope.scopeType).toBe('parents_group');
    expect(envelope.allowedCapabilities).toEqual(['chat.respond.group_safe']);
    expect(envelope.allowedMemoryReadLanes).toEqual(['parents_shared']);
  });

  it('resolves dm lanes using control-plane profile lane policy', () => {
    const familyWithControlPlane = {
      schemaVersion: 2 as const,
      familyId: 'default',
      members: [
        {
          memberId: 'kid',
          displayName: 'Kid',
          role: 'child' as const,
          profileId: 'young_child',
          telegramUserIds: [999],
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
            memoryLanePolicyId: 'lane_child',
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
          lane_child: {
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

    const envelope = resolveDecisionEnvelope({
      policyVersion: 'v2',
      chat: { id: 999, type: 'private' },
      fromId: 999,
      family: familyWithControlPlane,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
    });

    expect(envelope.action).toBe('allow');
    expect(envelope.allowedMemoryReadLanes).toEqual([
      'child_private:kid',
      'family_shared',
    ]);
    expect(envelope.allowedMemoryWriteLanes).toEqual(['child_private:kid']);
  });

  it('denies unapproved groups even when halo is mentioned', () => {
    const envelope = resolveDecisionEnvelope({
      policyVersion: 'v1',
      chat: { id: 12345, type: 'group' },
      fromId: 456,
      family: baseFamily,
      intent: { isMentioned: true },
      familyGroupChatId: 888,
    });

    expect(envelope.action).toBe('deny');
    expect(envelope.scope.scopeType).toBe('family_group');
    expect(envelope.scope.scopeId).toBe('telegram:family_group:12345');
    expect(envelope.rationale).toContain('group_not_approved');
  });

  it('documents that family-group mention gating has no command exception', () => {
    const envelope = resolveDecisionEnvelope({
      policyVersion: 'v1',
      chat: { id: 888, type: 'group' },
      fromId: 456,
      family: baseFamily,
      intent: { isMentioned: false, command: '/restart' },
      familyGroupChatId: 888,
    });

    expect(envelope.action).toBe('deny');
    expect(envelope.rationale).toEqual(
      expect.arrayContaining([
        'mention_required_in_family_group',
        'family_group_mention_exceptions_none',
      ]),
    );
  });

  it('applies medium-risk parent notification by default for child profiles', () => {
    const envelope = resolveDecisionEnvelope({
      policyVersion: 'v1',
      chat: { id: 999, type: 'private' },
      fromId: 999,
      family: baseFamily,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
      safetySignal: { riskLevel: 'medium' },
    });

    expect(envelope.action).toBe('requires_parent_approval');
    expect(envelope.safetyPlan.riskLevel).toBe('medium');
    expect(envelope.rationale).toContain('medium_risk_parent_notification_default');
  });

  it('routes low/medium/high sensitive topics for adolescent profiles', () => {
    const familyWithProfiles = {
      ...baseFamily,
      members: [
        {
          memberId: 'wags',
          displayName: 'Wags',
          role: 'parent' as const,
          profileId: 'parent_default',
          telegramUserIds: [456],
        },
        {
          memberId: 'kid',
          displayName: 'Kid',
          role: 'child' as const,
          profileId: 'adolescent',
          telegramUserIds: [999],
        },
      ],
    };

    const profilePolicies = {
      adolescent: {
        mediumRiskParentNotificationDefault: false,
      },
    };

    const lowRisk = resolveDecisionEnvelope({
      policyVersion: 'v2',
      chat: { id: 999, type: 'private' },
      fromId: 999,
      family: familyWithProfiles,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
      safetySignal: { riskLevel: 'low' },
      profilePolicies,
    });

    const mediumRisk = resolveDecisionEnvelope({
      policyVersion: 'v2',
      chat: { id: 999, type: 'private' },
      fromId: 999,
      family: familyWithProfiles,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
      safetySignal: { riskLevel: 'medium' },
      profilePolicies,
    });

    const highRisk = resolveDecisionEnvelope({
      policyVersion: 'v2',
      chat: { id: 999, type: 'private' },
      fromId: 999,
      family: familyWithProfiles,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
      safetySignal: { riskLevel: 'high' },
      profilePolicies,
    });

    expect(lowRisk.action).toBe('allow');
    expect(mediumRisk.action).toBe('allow');
    expect(mediumRisk.rationale).toContain('medium_risk_parent_notification_profile_default');
    expect(highRisk.action).toBe('requires_parent_approval');
    expect(highRisk.safetyPlan.riskLevel).toBe('high');
    expect(highRisk.rationale).toContain('high_risk_parent_notification_default');
  });

  it('uses profile defaults when high-risk parent notifications are disabled', () => {
    const familyWithProfiles = {
      ...baseFamily,
      members: [
        {
          memberId: 'wags',
          displayName: 'Wags',
          role: 'parent' as const,
          profileId: 'parent_default',
          telegramUserIds: [456],
        },
        {
          memberId: 'kid',
          displayName: 'Kid',
          role: 'child' as const,
          profileId: 'adolescent',
          telegramUserIds: [999],
        },
      ],
    };

    const profilePolicies = {
      adolescent: {
        highRiskParentNotificationDefault: false,
      },
    };

    const envelope = resolveDecisionEnvelope({
      policyVersion: 'v2',
      chat: { id: 999, type: 'private' },
      fromId: 999,
      family: familyWithProfiles,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
      safetySignal: { riskLevel: 'high' },
      profilePolicies,
    });

    expect(envelope.action).toBe('deny');
    expect(envelope.safetyPlan.riskLevel).toBe('high');
    expect(envelope.rationale).toContain('high_risk_parent_notification_profile_default');
  });

  it('uses profile escalation policies for high-risk minor routing', () => {
    const familyWithProfiles = {
      ...baseFamily,
      members: [
        {
          memberId: 'wags',
          displayName: 'Wags',
          role: 'parent' as const,
          profileId: 'parent_default',
          telegramUserIds: [456],
        },
        {
          memberId: 'kid',
          displayName: 'Kid',
          role: 'child' as const,
          profileId: 'adolescent',
          telegramUserIds: [999],
        },
      ],
    };

    const profilePolicies = {
      adolescent: {
        highRiskEscalationPolicyId: 'adolescent_default',
      },
    };

    const envelope = resolveDecisionEnvelope({
      policyVersion: 'v2',
      chat: { id: 999, type: 'private' },
      fromId: 999,
      family: familyWithProfiles,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
      safetySignal: { riskLevel: 'high' },
      profilePolicies,
    });

    expect(envelope.action).toBe('requires_parent_approval');
    expect(envelope.safetyPlan.riskLevel).toBe('high');
    expect(envelope.safetyPlan.escalationPolicyId).toBe('adolescent_default');
    expect(envelope.rationale).toContain('high_risk_escalation_policy_profile_default');
  });

  it('applies profile policy defaults via inferred profile ids for legacy child members', () => {
    const familyWithLegacyChild = {
      ...baseFamily,
      members: [
        {
          memberId: 'wags',
          displayName: 'Wags',
          role: 'parent' as const,
          profileId: 'parent_default',
          telegramUserIds: [456],
        },
        {
          memberId: 'kid',
          displayName: 'Kid',
          role: 'child' as const,
          ageGroup: 'teen' as const,
          telegramUserIds: [999],
        },
      ],
    };

    const mediumRisk = resolveDecisionEnvelope({
      policyVersion: 'v2',
      chat: { id: 999, type: 'private' },
      fromId: 999,
      family: familyWithLegacyChild,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
      safetySignal: { riskLevel: 'medium' },
      profilePolicies: {
        teen: {
          mediumRiskParentNotificationDefault: false,
        },
      },
    });

    expect(mediumRisk.action).toBe('allow');
    expect(mediumRisk.rationale).toContain('medium_risk_parent_notification_profile_default');

    const highRisk = resolveDecisionEnvelope({
      policyVersion: 'v2',
      chat: { id: 999, type: 'private' },
      fromId: 999,
      family: familyWithLegacyChild,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
      safetySignal: { riskLevel: 'high' },
      profilePolicies: {
        teen: {
          highRiskParentNotificationDefault: true,
          highRiskEscalationPolicyId: 'teen_escalation',
        },
      },
    });

    expect(highRisk.action).toBe('requires_parent_approval');
    expect(highRisk.safetyPlan.escalationPolicyId).toBe('teen_escalation');
    expect(highRisk.rationale).toContain('high_risk_parent_notification_profile_default');
    expect(highRisk.rationale).toContain('high_risk_escalation_policy_profile_default');
  });

  it('allows profile override to disable medium-risk parent notification', () => {
    const envelope = resolveDecisionEnvelope({
      policyVersion: 'v1',
      chat: { id: 999, type: 'private' },
      fromId: 999,
      family: baseFamily,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
      safetySignal: { riskLevel: 'medium' },
      overrides: {
        mediumRiskParentNotification: false,
      },
    });

    expect(envelope.action).toBe('allow');
    expect(envelope.safetyPlan.riskLevel).toBe('medium');
    expect(envelope.rationale).toContain('medium_risk_parent_notification_override');
  });

  it('applies explicit overrides after role/profile defaults', () => {
    const envelope = resolveDecisionEnvelope({
      policyVersion: 'v1',
      chat: { id: 456, type: 'private' },
      fromId: 456,
      family: baseFamily,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
      overrides: {
        capabilityAdditions: ['tools.shell'],
        capabilityRemovals: ['chat.respond'],
        model: 'gpt-4.1',
      },
    });

    expect(envelope.allowedCapabilities).toEqual(['tools.shell']);
    expect(envelope.modelPlan.model).toBe('gpt-4.1');
    expect(envelope.rationale).toContain('parent_overrides_applied');
  });

  it('applies compatibility fallback after overrides', () => {
    const envelope = resolveDecisionEnvelope({
      policyVersion: 'v1',
      chat: { id: 456, type: 'private' },
      fromId: 456,
      family: baseFamily,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
      overrides: {
        capabilityAdditions: ['tools.shell'],
        model: 'gpt-4.1',
      },
      compatibility: {
        supportedCapabilitiesByModel: {
          'gpt-4.1': ['chat.respond'],
          'gpt-5.1': ['chat.respond', 'tools.shell'],
        },
        fallbackModelByTier: {
          parent_default: 'gpt-5.1',
        },
      },
    });

    expect(envelope.modelPlan.model).toBe('gpt-5.1');
    expect(envelope.allowedCapabilities).toContain('tools.shell');
    expect(envelope.rationale).toContain('compatibility_fallback_model');
  });

  it('returns deterministic contract output for identical inputs', () => {
    const input = {
      policyVersion: 'v1',
      chat: { id: 888, type: 'group' },
      fromId: 456,
      family: baseFamily,
      intent: { isMentioned: true },
      familyGroupChatId: 888,
    };

    const first = resolveDecisionEnvelope(input);
    const second = resolveDecisionEnvelope(input);

    expect(second).toEqual(first);
  });
});
