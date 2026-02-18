import { describe, expect, it } from 'vitest';
import { ONBOARDING_CONTRACT_SCHEMA } from './onboardingContract.js';

type InviteFixture = {
  inviteId: string;
  householdId: string;
  role: 'parent' | 'child';
  profileId: string;
  issuedByMemberId: string;
  issuedAt: string;
  expiresAt: string;
  state: 'issued' | 'accepted' | 'expired' | 'revoked';
  acceptedAt?: string;
  acceptedByMemberId?: string;
  acceptedTelegramUserId?: number;
  expiredAt?: string;
  revokedAt?: string;
  revokedByMemberId?: string;
};

type RelinkFixture = {
  relinkId: string;
  householdId: string;
  memberId: string;
  previousTelegramUserId: number;
  nextTelegramUserId: number;
  requestedByMemberId: string;
  requestedAt: string;
  approvedByMemberId: string;
  approvedAt: string;
};

type OnboardingFixture = {
  household: {
    householdId: string;
    displayName: string;
    ownerMemberId: string;
    createdAt: string;
  };
  memberLinks: Array<{
    memberId: string;
    role: 'parent' | 'child';
    profileId: string;
    telegramUserId: number;
    linkedAt: string;
    linkedByMemberId: string;
  }>;
  invites: InviteFixture[];
  relinks: RelinkFixture[];
  scopeTerminology: {
    dm: string;
    parentsGroup: string;
    familyGroup: string;
  };
};

const parseOnboardingContract = (input: unknown) => {
  return ONBOARDING_CONTRACT_SCHEMA.parse(input);
};

const buildBaseInvite = (): InviteFixture => {
  return {
    inviteId: 'inv-1',
    householdId: 'household-default',
    role: 'child',
    profileId: 'young_child',
    issuedByMemberId: 'parent-1',
    issuedAt: '2026-02-17T12:00:00.000Z',
    expiresAt: '2026-02-18T12:00:00.000Z',
    state: 'issued',
  };
};

const buildBaseContract = (): OnboardingFixture => {
  return {
    household: {
      householdId: 'household-default',
      displayName: 'Default Household',
      ownerMemberId: 'parent-1',
      createdAt: '2026-02-17T11:00:00.000Z',
    },
    memberLinks: [
      {
        memberId: 'parent-1',
        role: 'parent',
        profileId: 'parent_default',
        telegramUserId: 1001,
        linkedAt: '2026-02-17T11:30:00.000Z',
        linkedByMemberId: 'parent-1',
      },
    ],
    invites: [buildBaseInvite()],
    relinks: [],
    scopeTerminology: {
      dm: 'member DM',
      parentsGroup: 'parents group',
      familyGroup: 'family group',
    },
  };
};

describe('onboardingContract', () => {
  it('accepts issued invites without terminal metadata', () => {
    const contract = buildBaseContract();

    const parsed = parseOnboardingContract(contract);
    expect(parsed.invites[0]?.state).toBe('issued');
  });

  it('requires accepted invite metadata when invite state is accepted', () => {
    const contract = buildBaseContract();
    contract.invites = [
      {
        ...buildBaseInvite(),
        state: 'accepted',
      },
    ];

    expect(() => parseOnboardingContract(contract)).toThrow('acceptedAt');
  });

  it('rejects issued invites when accepted metadata already exists', () => {
    const contract = buildBaseContract();
    contract.invites = [
      {
        ...buildBaseInvite(),
        acceptedAt: '2026-02-17T12:10:00.000Z',
        acceptedByMemberId: 'parent-1',
        acceptedTelegramUserId: 1002,
      },
    ];

    expect(() => parseOnboardingContract(contract)).toThrow('acceptedAt');
  });

  it('requires revoked metadata when invite state is revoked', () => {
    const contract = buildBaseContract();
    contract.invites = [
      {
        ...buildBaseInvite(),
        state: 'revoked',
      },
    ];

    expect(() => parseOnboardingContract(contract)).toThrow('revokedAt');
  });

  it('rejects relink entries when telegram account does not actually change', () => {
    const contract = buildBaseContract();
    contract.relinks = [
      {
        relinkId: 'relink-1',
        householdId: 'household-default',
        memberId: 'parent-1',
        previousTelegramUserId: 1001,
        nextTelegramUserId: 1001,
        requestedByMemberId: 'parent-1',
        requestedAt: '2026-02-17T12:30:00.000Z',
        approvedByMemberId: 'parent-1',
        approvedAt: '2026-02-17T12:31:00.000Z',
      },
    ];

    expect(() => parseOnboardingContract(contract)).toThrow('nextTelegramUserId');
  });

  it('requires at least one member link for a household onboarding contract', () => {
    const contract = buildBaseContract();
    contract.memberLinks = [];

    expect(() => parseOnboardingContract(contract)).toThrow('memberLinks');
  });

  it('rejects accepted invites when acceptedAt is after expiresAt', () => {
    const contract = buildBaseContract();
    contract.invites = [
      {
        ...buildBaseInvite(),
        state: 'accepted',
        acceptedAt: '2026-02-18T13:00:00.000Z',
        acceptedByMemberId: 'parent-1',
        acceptedTelegramUserId: 1002,
      },
    ];

    expect(() => parseOnboardingContract(contract)).toThrow('acceptedAt');
  });

  it('requires expiredAt when invite state is expired', () => {
    const contract = buildBaseContract();
    contract.invites = [
      {
        ...buildBaseInvite(),
        state: 'expired',
      },
    ];

    expect(() => parseOnboardingContract(contract)).toThrow('expiredAt');
  });

  it('locks onboarding scope terminology to member DM and group labels', () => {
    const contract = buildBaseContract();
    contract.scopeTerminology.dm = 'direct message';

    expect(() => parseOnboardingContract(contract)).toThrow('member DM');
  });
});
