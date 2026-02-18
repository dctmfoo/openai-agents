import { resolveMemberMemoryLanes } from '../memory/laneTopology.js';
import type { FamilyConfig } from '../runtime/familyConfig.js';

type KnownSpeakerRole = 'parent' | 'child';

type UnknownSpeaker = {
  memberId: 'unknown';
  role: 'unknown';
  profileId: 'unknown';
};

type KnownSpeaker = {
  memberId: string;
  role: KnownSpeakerRole;
  profileId: string;
};

type DecisionAction = 'allow' | 'deny' | 'requires_parent_approval';

type DecisionScopeType = 'dm' | 'parents_group' | 'family_group';

type DecisionRiskLevel = 'low' | 'medium' | 'high';

type PrecedenceStep =
  | 'safety'
  | 'scope'
  | 'role_profile'
  | 'overrides'
  | 'compatibility';

type ProfilePolicyOverride = {
  mediumRiskParentNotificationDefault?: boolean;
  highRiskParentNotificationDefault?: boolean;
  highRiskEscalationPolicyId?: string;
};

type DecisionOverrides = {
  mediumRiskParentNotification?: boolean;
  capabilityAdditions?: string[];
  capabilityRemovals?: string[];
  model?: string;
};

type DecisionCompatibility = {
  supportedCapabilitiesByModel?: Record<string, string[]>;
  fallbackModelByTier?: Record<string, string>;
};

export type DecisionEnvelope = {
  policyVersion: string;
  speaker: KnownSpeaker | UnknownSpeaker;
  scope: {
    scopeId: string;
    scopeType: DecisionScopeType;
  };
  intent: {
    isMentioned: boolean;
    command?: string;
  };
  action: DecisionAction;
  allowedCapabilities: string[];
  allowedMemoryReadLanes: string[];
  allowedMemoryWriteLanes: string[];
  modelPlan: {
    tier: string;
    model: string;
    reason: string;
  };
  safetyPlan: {
    riskLevel: DecisionRiskLevel;
    escalationPolicyId: string;
  };
  rationale: string[];
};

export type DecisionEnvelopeInput = {
  policyVersion: string;
  family: FamilyConfig;
  chat: {
    id: number;
    type: string;
  };
  fromId?: number | string;
  intent?: {
    isMentioned: boolean;
    command?: string;
  };
  familyGroupChatId?: number | null;
  safetySignal?: {
    riskLevel: DecisionRiskLevel;
  };
  profilePolicies?: Record<string, ProfilePolicyOverride>;
  overrides?: DecisionOverrides;
  compatibility?: DecisionCompatibility;
};

type PolicyPlan = {
  action: DecisionAction;
  allowedCapabilities: string[];
  allowedMemoryReadLanes: string[];
  allowedMemoryWriteLanes: string[];
  modelPlan: DecisionEnvelope['modelPlan'];
  safetyPlan: DecisionEnvelope['safetyPlan'];
  rationale: string[];
};

type SafetyStepOutcome =
  | {
      step: 'safety';
      riskLevel: DecisionRiskLevel;
    }
  | {
      step: 'safety';
      terminalEnvelope: DecisionEnvelope;
    };

type ScopeStepOutcome =
  | {
      step: 'scope';
      scope: DecisionEnvelope['scope'];
    }
  | {
      step: 'scope';
      terminalEnvelope: DecisionEnvelope;
    };

type ScopeResolution =
  | {
      status: 'resolved';
      scope: DecisionEnvelope['scope'];
    }
  | {
      status: 'group_not_approved';
      scope: DecisionEnvelope['scope'];
    };

const normalizeTelegramId = (value?: number | string): number | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }

    return value;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
};

const findMember = (
  family: FamilyConfig,
  fromId?: number | string,
): FamilyConfig['members'][number] | null => {
  const normalizedId = normalizeTelegramId(fromId);
  if (normalizedId === null) {
    return null;
  }

  return (
    family.members.find((candidate) => {
      return candidate.telegramUserIds.includes(normalizedId);
    }) ?? null
  );
};

const resolveConfiguredFamilyGroupChatId = (
  input: DecisionEnvelopeInput,
): number | null => {
  if (input.familyGroupChatId !== undefined && input.familyGroupChatId !== null) {
    return input.familyGroupChatId;
  }

  const familyGroupScope = input.family.controlPlane?.scopes.find((scope) => {
    return scope.scopeType === 'family_group';
  });

  if (!familyGroupScope) {
    return null;
  }

  return familyGroupScope.telegramChatId ?? null;
};

const resolveScope = (input: DecisionEnvelopeInput): ScopeResolution => {
  if (input.chat.type === 'private') {
    const fromId = normalizeTelegramId(input.fromId);
    const suffix = fromId === null ? 'unknown' : String(fromId);
    return {
      status: 'resolved',
      scope: {
        scopeType: 'dm',
        scopeId: `telegram:dm:${suffix}`,
      },
    };
  }

  const parentsGroupChatId = input.family.parentsGroup?.telegramChatId ?? null;
  if (parentsGroupChatId !== null && input.chat.id === parentsGroupChatId) {
    return {
      status: 'resolved',
      scope: {
        scopeType: 'parents_group',
        scopeId: `telegram:parents_group:${input.chat.id}`,
      },
    };
  }

  const familyGroupChatId = resolveConfiguredFamilyGroupChatId(input);
  if (familyGroupChatId !== null && input.chat.id === familyGroupChatId) {
    return {
      status: 'resolved',
      scope: {
        scopeType: 'family_group',
        scopeId: `telegram:family_group:${input.chat.id}`,
      },
    };
  }

  return {
    status: 'group_not_approved',
    scope: {
      scopeType: 'family_group',
      scopeId: `telegram:family_group:${input.chat.id}`,
    },
  };
};

const buildDenyEnvelope = (
  input: DecisionEnvelopeInput,
  scope: DecisionEnvelope['scope'],
  rationale: string | string[],
  speaker?: DecisionEnvelope['speaker'],
  safetyPlan?: DecisionEnvelope['safetyPlan'],
): DecisionEnvelope => {
  const resolvedSpeaker =
    speaker ?? {
      memberId: 'unknown',
      role: 'unknown',
      profileId: 'unknown',
    };

  const rationaleList = typeof rationale === 'string' ? [rationale] : rationale;

  return {
    policyVersion: input.policyVersion,
    speaker: resolvedSpeaker,
    scope,
    intent: {
      isMentioned: input.intent?.isMentioned ?? false,
      command: input.intent?.command,
    },
    action: 'deny',
    allowedCapabilities: [],
    allowedMemoryReadLanes: [],
    allowedMemoryWriteLanes: [],
    modelPlan: {
      tier: 'none',
      model: 'none',
      reason: 'action_is_deny',
    },
    safetyPlan:
      safetyPlan ?? {
        riskLevel: 'low',
        escalationPolicyId: 'none',
      },
    rationale: rationaleList,
  };
};

const profileIdForMember = (member: FamilyConfig['members'][number]): string => {
  if (member.profileId) {
    return member.profileId;
  }

  if (member.role === 'parent') {
    return 'parent_default';
  }

  if (member.ageGroup) {
    return member.ageGroup;
  }

  return 'child_default';
};

const toKnownSpeaker = (member: FamilyConfig['members'][number]): KnownSpeaker => {
  return {
    memberId: member.memberId,
    role: member.role,
    profileId: profileIdForMember(member),
  };
};

const lanesForMember = (
  family: FamilyConfig,
  member: FamilyConfig['members'][number],
): {
  read: string[];
  write: string[];
} => {
  const lanes = resolveMemberMemoryLanes(family, member);
  return {
    read: [...lanes.readLanes],
    write: [...lanes.writeLanes],
  };
};

const modelSupportsCapabilities = (
  model: string,
  capabilities: string[],
  supportedCapabilitiesByModel?: Record<string, string[]>,
): boolean => {
  if (!supportedCapabilitiesByModel) {
    return true;
  }

  const supportedCapabilities = supportedCapabilitiesByModel[model];
  if (!supportedCapabilities) {
    return true;
  }

  const supportedSet = new Set(supportedCapabilities);
  for (const capability of capabilities) {
    if (!supportedSet.has(capability)) {
      return false;
    }
  }

  return true;
};

const stableUnique = (values: string[]): string[] => {
  return Array.from(new Set(values)).sort();
};

const resolveSafetyStep = (
  input: DecisionEnvelopeInput,
  member: FamilyConfig['members'][number],
  scope: DecisionEnvelope['scope'],
  speaker: KnownSpeaker,
): SafetyStepOutcome => {
  const step: PrecedenceStep = 'safety';
  const riskLevel = input.safetySignal?.riskLevel ?? 'low';

  switch (riskLevel) {
    case 'low':
    case 'medium':
      return {
        step,
        riskLevel,
      };
    case 'high':
      if (member.role === 'child') {
        return {
          step,
          riskLevel,
        };
      }

      return {
        step,
        terminalEnvelope: buildDenyEnvelope(
          input,
          scope,
          'safety_high_risk_hard_deny',
          speaker,
          {
            riskLevel: 'high',
            escalationPolicyId: 'none',
          },
        ),
      };
  }
};

const resolveScopeStep = (
  input: DecisionEnvelopeInput,
  member: FamilyConfig['members'][number],
  scope: DecisionEnvelope['scope'],
  speaker: KnownSpeaker,
  intent: DecisionEnvelope['intent'],
): ScopeStepOutcome => {
  const step: PrecedenceStep = 'scope';

  if (scope.scopeType === 'dm') {
    return {
      step,
      scope: {
        scopeType: 'dm',
        scopeId: `telegram:dm:${member.memberId}`,
      },
    };
  }

  if (scope.scopeType === 'parents_group') {
    if (member.role === 'parent') {
      return {
        step,
        scope,
      };
    }

    return {
      step,
      terminalEnvelope: buildDenyEnvelope(
        input,
        scope,
        'child_in_parents_group',
        speaker,
      ),
    };
  }

  if (intent.isMentioned) {
    return {
      step,
      scope,
    };
  }

  return {
    step,
    terminalEnvelope: buildDenyEnvelope(
      input,
      scope,
      [
        'mention_required_in_family_group',
        'family_group_mention_exceptions_none',
      ],
      speaker,
    ),
  };
};

const resolveRoleProfileStep = (
  family: FamilyConfig,
  member: FamilyConfig['members'][number],
  scopeType: DecisionScopeType,
  riskLevel: DecisionRiskLevel,
): PolicyPlan => {
  const step: PrecedenceStep = 'role_profile';

  if (scopeType === 'dm') {
    const lanes = lanesForMember(family, member);
    const isParent = member.role === 'parent';
    const modelTier = isParent ? 'parent_default' : 'child_default';
    const escalationPolicyId = isParent ? 'none' : 'minor_default';

    return {
      action: 'allow',
      allowedCapabilities: ['chat.respond'],
      allowedMemoryReadLanes: lanes.read,
      allowedMemoryWriteLanes: lanes.write,
      modelPlan: {
        tier: modelTier,
        model: 'gpt-5.1',
        reason: 'dm_default',
      },
      safetyPlan: {
        riskLevel,
        escalationPolicyId,
      },
      rationale: [`${step}:dm_member_allow`],
    };
  }

  if (scopeType === 'parents_group') {
    return {
      action: 'allow',
      allowedCapabilities: ['chat.respond.group_safe'],
      allowedMemoryReadLanes: ['parents_shared'],
      allowedMemoryWriteLanes: ['parents_shared'],
      modelPlan: {
        tier: 'parent_group_safe',
        model: 'gpt-5.1-mini',
        reason: 'parents_group_parent_allow',
      },
      safetyPlan: {
        riskLevel,
        escalationPolicyId: 'none',
      },
      rationale: [`${step}:parents_group_parent_allow`],
    };
  }

  return {
    action: 'allow',
    allowedCapabilities: ['chat.respond.group_safe'],
    allowedMemoryReadLanes: ['family_shared'],
    allowedMemoryWriteLanes: ['family_shared'],
    modelPlan: {
      tier: 'group_safe',
      model: 'gpt-5.1-mini',
      reason: 'family_group_mentioned',
    },
    safetyPlan: {
      riskLevel,
      escalationPolicyId: 'none',
    },
    rationale: [`${step}:family_group_mentioned_allow`],
  };
};

const resolveMediumRiskParentNotification = (
  input: DecisionEnvelopeInput,
  member: FamilyConfig['members'][number],
): {
  notifyParent: boolean;
  reason: 'override' | 'profile_default' | 'default';
} => {
  const override = input.overrides?.mediumRiskParentNotification;
  if (override !== undefined) {
    return {
      notifyParent: override,
      reason: 'override',
    };
  }

  const profileId = profileIdForMember(member);
  const profileDefault = input.profilePolicies?.[profileId]?.mediumRiskParentNotificationDefault;

  if (profileDefault !== undefined) {
    return {
      notifyParent: profileDefault,
      reason: 'profile_default',
    };
  }

  return {
    notifyParent: member.role === 'child',
    reason: 'default',
  };
};

const resolveHighRiskParentNotification = (
  input: DecisionEnvelopeInput,
  member: FamilyConfig['members'][number],
): {
  notifyParent: boolean;
  reason: 'profile_default' | 'default';
} => {
  const profileId = profileIdForMember(member);
  const profileDefault = input.profilePolicies?.[profileId]?.highRiskParentNotificationDefault;

  if (profileDefault !== undefined) {
    return {
      notifyParent: profileDefault,
      reason: 'profile_default',
    };
  }

  return {
    notifyParent: member.role === 'child',
    reason: 'default',
  };
};

const resolveHighRiskEscalationPolicy = (
  input: DecisionEnvelopeInput,
  member: FamilyConfig['members'][number],
  fallbackEscalationPolicyId: string,
): {
  escalationPolicyId: string;
  reason: 'profile_default' | 'default';
} => {
  const profileId = profileIdForMember(member);
  const profileDefault = input.profilePolicies?.[profileId]?.highRiskEscalationPolicyId;

  if (profileDefault !== undefined) {
    return {
      escalationPolicyId: profileDefault,
      reason: 'profile_default',
    };
  }

  return {
    escalationPolicyId: fallbackEscalationPolicyId,
    reason: 'default',
  };
};

const clonePolicyPlan = (plan: PolicyPlan): PolicyPlan => {
  return {
    action: plan.action,
    allowedCapabilities: [...plan.allowedCapabilities],
    allowedMemoryReadLanes: stableUnique(plan.allowedMemoryReadLanes),
    allowedMemoryWriteLanes: stableUnique(plan.allowedMemoryWriteLanes),
    modelPlan: {
      ...plan.modelPlan,
    },
    safetyPlan: {
      ...plan.safetyPlan,
    },
    rationale: [...plan.rationale],
  };
};

const appendMediumRiskRationale = (
  plan: PolicyPlan,
  reason: 'override' | 'profile_default' | 'default',
): void => {
  if (reason === 'override') {
    plan.rationale.push('medium_risk_parent_notification_override');
    return;
  }

  if (reason === 'profile_default') {
    plan.rationale.push('medium_risk_parent_notification_profile_default');
    return;
  }

  plan.rationale.push('medium_risk_parent_notification_default');
};

const applyMediumRiskOverride = (
  input: DecisionEnvelopeInput,
  member: FamilyConfig['members'][number],
  plan: PolicyPlan,
): void => {
  const isMediumRiskChild =
    plan.safetyPlan.riskLevel === 'medium' && member.role === 'child';
  if (!isMediumRiskChild) {
    return;
  }

  const mediumRisk = resolveMediumRiskParentNotification(input, member);
  if (mediumRisk.notifyParent) {
    plan.action = 'requires_parent_approval';
  }

  appendMediumRiskRationale(plan, mediumRisk.reason);
};

const appendHighRiskRationale = (
  plan: PolicyPlan,
  reason: 'profile_default' | 'default',
): void => {
  if (reason === 'profile_default') {
    plan.rationale.push('high_risk_parent_notification_profile_default');
    return;
  }

  plan.rationale.push('high_risk_parent_notification_default');
};

const appendHighRiskEscalationRationale = (
  plan: PolicyPlan,
  reason: 'profile_default' | 'default',
): void => {
  if (reason === 'profile_default') {
    plan.rationale.push('high_risk_escalation_policy_profile_default');
  }
};

const applyHighRiskOverride = (
  input: DecisionEnvelopeInput,
  member: FamilyConfig['members'][number],
  plan: PolicyPlan,
): void => {
  const isHighRiskChild =
    plan.safetyPlan.riskLevel === 'high' && member.role === 'child';
  if (!isHighRiskChild) {
    return;
  }

  const highRisk = resolveHighRiskParentNotification(input, member);
  if (highRisk.notifyParent) {
    plan.action = 'requires_parent_approval';
  } else {
    plan.action = 'deny';
  }
  appendHighRiskRationale(plan, highRisk.reason);

  const highRiskEscalationPolicy = resolveHighRiskEscalationPolicy(
    input,
    member,
    plan.safetyPlan.escalationPolicyId,
  );
  plan.safetyPlan.escalationPolicyId = highRiskEscalationPolicy.escalationPolicyId;
  appendHighRiskEscalationRationale(plan, highRiskEscalationPolicy.reason);
};

const applyCapabilityAndModelOverrides = (
  input: DecisionEnvelopeInput,
  plan: PolicyPlan,
): void => {
  const capabilityAdditions = input.overrides?.capabilityAdditions ?? [];
  const capabilityRemovals = input.overrides?.capabilityRemovals ?? [];
  const modelOverride = input.overrides?.model;

  const hasExplicitOverride =
    capabilityAdditions.length > 0 ||
    capabilityRemovals.length > 0 ||
    modelOverride !== undefined;

  if (!hasExplicitOverride) {
    plan.allowedCapabilities = stableUnique(plan.allowedCapabilities);
    return;
  }

  const capabilitySet = new Set(plan.allowedCapabilities);
  for (const capability of capabilityAdditions) {
    capabilitySet.add(capability);
  }

  for (const capability of capabilityRemovals) {
    capabilitySet.delete(capability);
  }

  plan.allowedCapabilities = stableUnique(Array.from(capabilitySet));

  if (modelOverride) {
    plan.modelPlan.model = modelOverride;
  }

  plan.rationale.push('parent_overrides_applied');
};

const applyOverridesStep = (
  input: DecisionEnvelopeInput,
  member: FamilyConfig['members'][number],
  plan: PolicyPlan,
): PolicyPlan => {
  const nextPlan = clonePolicyPlan(plan);
  applyHighRiskOverride(input, member, nextPlan);
  applyMediumRiskOverride(input, member, nextPlan);
  applyCapabilityAndModelOverrides(input, nextPlan);
  return nextPlan;
};

const applyCompatibilityStep = (
  input: DecisionEnvelopeInput,
  plan: PolicyPlan,
): PolicyPlan => {
  const nextPlan: PolicyPlan = {
    action: plan.action,
    allowedCapabilities: [...plan.allowedCapabilities],
    allowedMemoryReadLanes: [...plan.allowedMemoryReadLanes],
    allowedMemoryWriteLanes: [...plan.allowedMemoryWriteLanes],
    modelPlan: {
      ...plan.modelPlan,
    },
    safetyPlan: {
      ...plan.safetyPlan,
    },
    rationale: [...plan.rationale],
  };

  const supportsCurrentModel = modelSupportsCapabilities(
    nextPlan.modelPlan.model,
    nextPlan.allowedCapabilities,
    input.compatibility?.supportedCapabilitiesByModel,
  );

  if (supportsCurrentModel) {
    return nextPlan;
  }

  const fallbackModel =
    input.compatibility?.fallbackModelByTier?.[nextPlan.modelPlan.tier];
  if (!fallbackModel) {
    return nextPlan;
  }

  const supportsFallbackModel = modelSupportsCapabilities(
    fallbackModel,
    nextPlan.allowedCapabilities,
    input.compatibility?.supportedCapabilitiesByModel,
  );

  if (!supportsFallbackModel) {
    return nextPlan;
  }

  nextPlan.modelPlan.model = fallbackModel;
  nextPlan.rationale.push('compatibility_fallback_model');
  return nextPlan;
};

export function resolveDecisionEnvelope(input: DecisionEnvelopeInput): DecisionEnvelope {
  const scopeResolution = resolveScope(input);
  const scope = scopeResolution.scope;
  const member = findMember(input.family, input.fromId);
  const intent = {
    isMentioned: input.intent?.isMentioned ?? false,
    command: input.intent?.command,
  };

  if (!member) {
    return buildDenyEnvelope(input, scope, 'unknown_user');
  }

  const speaker = toKnownSpeaker(member);

  if (scopeResolution.status === 'group_not_approved') {
    return buildDenyEnvelope(input, scope, 'group_not_approved', speaker);
  }

  const safetyStep = resolveSafetyStep(input, member, scope, speaker);
  if ('terminalEnvelope' in safetyStep) {
    return safetyStep.terminalEnvelope;
  }

  const scopeStep = resolveScopeStep(input, member, scope, speaker, intent);
  if ('terminalEnvelope' in scopeStep) {
    return scopeStep.terminalEnvelope;
  }

  const roleProfilePlan = resolveRoleProfileStep(
    input.family,
    member,
    scopeStep.scope.scopeType,
    safetyStep.riskLevel,
  );
  const overridePlan = applyOverridesStep(input, member, roleProfilePlan);
  const compatiblePlan = applyCompatibilityStep(input, overridePlan);

  return {
    policyVersion: input.policyVersion,
    speaker,
    scope: scopeStep.scope,
    intent,
    action: compatiblePlan.action,
    allowedCapabilities: compatiblePlan.allowedCapabilities,
    allowedMemoryReadLanes: compatiblePlan.allowedMemoryReadLanes,
    allowedMemoryWriteLanes: compatiblePlan.allowedMemoryWriteLanes,
    modelPlan: compatiblePlan.modelPlan,
    safetyPlan: compatiblePlan.safetyPlan,
    rationale: compatiblePlan.rationale,
  };
}
