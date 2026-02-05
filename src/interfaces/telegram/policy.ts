import type { FamilyConfig } from '../../runtime/familyConfig.js';

type TelegramChat = {
  id: number;
  type: string;
};

export type TelegramPolicyInput = {
  chat: TelegramChat;
  fromId?: number | string;
  family: FamilyConfig;
};

export type TelegramPolicyDecision = {
  allow: boolean;
  reason?: 'unknown_user' | 'group_not_approved' | 'child_in_parents_group';
  scopeId?: string;
  scopeType?: 'dm' | 'parents_group';
  memberId?: string;
  role?: 'parent' | 'child';
  ageGroup?: 'child' | 'teen' | 'young_adult';
};

const normalizeTelegramId = (value?: number | string): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const findMember = (family: FamilyConfig, fromId?: number | string) => {
  const normalized = normalizeTelegramId(fromId);
  if (normalized === null) return null;
  return (
    family.members.find((member) => member.telegramUserIds.includes(normalized)) ?? null
  );
};

export function resolveTelegramPolicy(input: TelegramPolicyInput): TelegramPolicyDecision {
  const member = findMember(input.family, input.fromId);
  if (!member) {
    return { allow: false, reason: 'unknown_user' };
  }

  if (input.chat.type === 'private') {
    return {
      allow: true,
      scopeType: 'dm',
      scopeId: `telegram:dm:${member.memberId}`,
      memberId: member.memberId,
      role: member.role,
      ageGroup: member.ageGroup,
    };
  }

  const approvedGroupId = input.family.parentsGroup?.telegramChatId ?? null;
  if (!approvedGroupId || input.chat.id !== approvedGroupId) {
    return { allow: false, reason: 'group_not_approved' };
  }

  if (member.role !== 'parent') {
    return { allow: false, reason: 'child_in_parents_group' };
  }

  return {
    allow: true,
    scopeType: 'parents_group',
    scopeId: `telegram:parents_group:${approvedGroupId}`,
    memberId: member.memberId,
    role: member.role,
    ageGroup: member.ageGroup,
  };
}
