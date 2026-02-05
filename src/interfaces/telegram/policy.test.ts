import { describe, expect, it } from 'vitest';

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
});
