import {
  resolveDecisionEnvelope,
  type DecisionEnvelope,
} from '../../policies/decisionEnvelope.js';
import type { FamilyConfig } from '../../runtime/familyConfig.js';

type TelegramChat = {
  id: number;
  type: string;
};

export type TelegramPolicyIntent = {
  isMentioned: boolean;
  command?: string;
};

export type TelegramPolicyInput = {
  chat: TelegramChat;
  fromId?: number | string;
  family: FamilyConfig;
  intent?: TelegramPolicyIntent;
  familyGroupChatId?: number | null;
  policyVersion?: string;
};

type TelegramPolicyDenyReason =
  | 'unknown_user'
  | 'group_not_approved'
  | 'child_in_parents_group'
  | 'mention_required'
  | 'requires_parent_approval';

export type TelegramPolicyDecision = {
  allow: boolean;
  reason?: TelegramPolicyDenyReason;
  scopeId?: string;
  scopeType?: 'dm' | 'parents_group' | 'family_group';
  memberId?: string;
  role?: 'parent' | 'child';
  ageGroup?: 'child' | 'teen' | 'young_adult';
  action: DecisionEnvelope['action'];
  allowedCapabilities: string[];
  allowedMemoryReadLanes: string[];
  allowedMemoryWriteLanes: string[];
  rationale: string[];
  policyVersion: string;
};

const normalizeTelegramId = (value?: number | string): number | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const findMember = (family: FamilyConfig, fromId?: number | string) => {
  const normalized = normalizeTelegramId(fromId);
  if (normalized === null) {
    return null;
  }

  return family.members.find((member) => member.telegramUserIds.includes(normalized)) ?? null;
};

const resolvePolicyVersion = (input: TelegramPolicyInput): string => {
  if (input.policyVersion) {
    return input.policyVersion;
  }

  if (input.family.controlPlane?.policyVersion) {
    return input.family.controlPlane.policyVersion;
  }

  return `legacy-v${input.family.schemaVersion}`;
};

const mapDenyReason = (envelope: DecisionEnvelope): TelegramPolicyDenyReason | undefined => {
  if (envelope.action === 'requires_parent_approval') {
    return 'requires_parent_approval';
  }

  if (envelope.rationale.includes('unknown_user')) {
    return 'unknown_user';
  }

  if (envelope.rationale.includes('group_not_approved')) {
    return 'group_not_approved';
  }

  if (envelope.rationale.includes('child_in_parents_group')) {
    return 'child_in_parents_group';
  }

  if (envelope.rationale.includes('mention_required_in_family_group')) {
    return 'mention_required';
  }

  return undefined;
};

export function resolveTelegramPolicy(input: TelegramPolicyInput): TelegramPolicyDecision {
  const member = findMember(input.family, input.fromId);

  const envelope = resolveDecisionEnvelope({
    policyVersion: resolvePolicyVersion(input),
    family: input.family,
    chat: input.chat,
    fromId: input.fromId,
    intent: input.intent,
    familyGroupChatId: input.familyGroupChatId,
  });

  const hasKnownSpeaker = envelope.speaker.role !== 'unknown';
  const memberId = hasKnownSpeaker ? envelope.speaker.memberId : undefined;

  let role: TelegramPolicyDecision['role'];
  if (envelope.speaker.role === 'parent' || envelope.speaker.role === 'child') {
    role = envelope.speaker.role;
  }

  const allow = envelope.action === 'allow';

  return {
    allow,
    reason: allow ? undefined : mapDenyReason(envelope),
    scopeId: envelope.scope.scopeId,
    scopeType: envelope.scope.scopeType,
    memberId,
    role,
    ageGroup: member?.ageGroup,
    action: envelope.action,
    allowedCapabilities: [...envelope.allowedCapabilities],
    allowedMemoryReadLanes: [...envelope.allowedMemoryReadLanes],
    allowedMemoryWriteLanes: [...envelope.allowedMemoryWriteLanes],
    rationale: [...envelope.rationale],
    policyVersion: envelope.policyVersion,
  };
}
