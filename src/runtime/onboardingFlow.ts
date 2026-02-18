import { writeFile } from 'node:fs/promises';
import { z } from 'zod';

import {
  getFamilyConfigPath,
  loadFamilyConfig,
  type FamilyConfig,
} from './familyConfig.js';
import {
  ONBOARDING_CONTRACT_SCHEMA,
  type OnboardingContract,
} from './onboardingContract.js';

const BOOTSTRAP_INPUT_SCHEMA = z
  .object({
    haloHome: z.string().min(1),
    householdId: z.string().min(1),
    householdDisplayName: z.string().min(1),
    ownerMemberId: z.string().min(1),
    ownerTelegramUserId: z.number().int().positive(),
    ownerProfileId: z.string().min(1),
    now: z.string().min(1),
  })
  .strict();

const ISSUE_INVITE_INPUT_SCHEMA = z
  .object({
    haloHome: z.string().min(1),
    inviteId: z.string().min(1),
    issuedByMemberId: z.string().min(1),
    role: z.enum(['parent', 'child']),
    profileId: z.string().min(1),
    issuedAt: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

const ACCEPT_INVITE_INPUT_SCHEMA = z
  .object({
    haloHome: z.string().min(1),
    inviteId: z.string().min(1),
    memberId: z.string().min(1),
    displayName: z.string().min(1),
    telegramUserId: z.number().int().positive(),
    linkedByMemberId: z.string().min(1),
    acceptedAt: z.string().min(1),
    ageGroup: z.enum(['child', 'teen', 'young_adult']).optional(),
    parentalVisibility: z.boolean().optional(),
  })
  .strict();

const REVOKE_INVITE_INPUT_SCHEMA = z
  .object({
    haloHome: z.string().min(1),
    inviteId: z.string().min(1),
    revokedByMemberId: z.string().min(1),
    revokedAt: z.string().min(1),
  })
  .strict();

const RELINK_MEMBER_INPUT_SCHEMA = z
  .object({
    haloHome: z.string().min(1),
    relinkId: z.string().min(1),
    memberId: z.string().min(1),
    previousTelegramUserId: z.number().int().positive(),
    nextTelegramUserId: z.number().int().positive(),
    requestedByMemberId: z.string().min(1),
    requestedAt: z.string().min(1),
    approvedByMemberId: z.string().min(1),
    approvedAt: z.string().min(1),
  })
  .strict();

export type BootstrapParentOnboardingInput = z.infer<typeof BOOTSTRAP_INPUT_SCHEMA>;
export type IssueOnboardingInviteInput = z.infer<typeof ISSUE_INVITE_INPUT_SCHEMA>;
export type AcceptOnboardingInviteInput = z.infer<typeof ACCEPT_INVITE_INPUT_SCHEMA>;
export type RevokeOnboardingInviteInput = z.infer<typeof REVOKE_INVITE_INPUT_SCHEMA>;
export type RelinkOnboardingMemberInput = z.infer<typeof RELINK_MEMBER_INPUT_SCHEMA>;

export type BootstrapParentOnboardingResult = {
  outcome: 'bootstrapped' | 'already_bootstrapped';
  onboarding: OnboardingContract;
};

export type IssueOnboardingInviteResult = {
  outcome: 'issued' | 'already_issued';
  onboarding: OnboardingContract;
};

export type AcceptOnboardingInviteResult = {
  outcome: 'joined' | 'already_joined' | 'duplicate_join';
  onboarding: OnboardingContract;
};

export type RevokeOnboardingInviteResult = {
  outcome: 'revoked' | 'already_revoked' | 'not_revocable';
  onboarding: OnboardingContract;
};

export type RelinkOnboardingMemberResult = {
  outcome: 'relinked' | 'already_relinked' | 'duplicate_join';
  onboarding: OnboardingContract;
};

type LegacyFamilyConfig = FamilyConfig & { schemaVersion: 1 };

const SCOPE_TERMINOLOGY = {
  dm: 'member DM',
  parentsGroup: 'parents group',
  familyGroup: 'family group',
} as const;

const buildBootstrapOnboarding = (
  input: BootstrapParentOnboardingInput,
): OnboardingContract => {
  return ONBOARDING_CONTRACT_SCHEMA.parse({
    household: {
      householdId: input.householdId,
      displayName: input.householdDisplayName,
      ownerMemberId: input.ownerMemberId,
      createdAt: input.now,
    },
    memberLinks: [
      {
        memberId: input.ownerMemberId,
        role: 'parent',
        profileId: input.ownerProfileId,
        telegramUserId: input.ownerTelegramUserId,
        linkedAt: input.now,
        linkedByMemberId: input.ownerMemberId,
      },
    ],
    invites: [],
    relinks: [],
    scopeTerminology: SCOPE_TERMINOLOGY,
  });
};

const persistFamilyConfig = async (
  haloHome: string,
  config: LegacyFamilyConfig,
): Promise<void> => {
  const path = getFamilyConfigPath({ HALO_HOME: haloHome } as NodeJS.ProcessEnv);
  const payload = JSON.stringify(config, null, 2);
  await writeFile(path, `${payload}\n`, 'utf8');
};

const assertLegacyFamilyConfig = (config: FamilyConfig): LegacyFamilyConfig => {
  if (config.schemaVersion !== 1) {
    throw new Error(
      'Onboarding persistence currently supports schemaVersion 1 family config only.',
    );
  }

  return config as LegacyFamilyConfig;
};

const requireOnboardingContract = (familyConfig: LegacyFamilyConfig): OnboardingContract => {
  if (familyConfig.onboarding) {
    return familyConfig.onboarding;
  }

  throw new Error('Onboarding contract is not initialized. Run bootstrap first.');
};

const buildAcceptedInvite = (
  invite: OnboardingContract['invites'][number],
  input: AcceptOnboardingInviteInput,
): OnboardingContract['invites'][number] => {
  return {
    inviteId: invite.inviteId,
    householdId: invite.householdId,
    role: invite.role,
    profileId: invite.profileId,
    issuedByMemberId: invite.issuedByMemberId,
    issuedAt: invite.issuedAt,
    expiresAt: invite.expiresAt,
    state: 'accepted',
    acceptedAt: input.acceptedAt,
    acceptedByMemberId: input.memberId,
    acceptedTelegramUserId: input.telegramUserId,
  };
};

const buildRevokedInvite = (
  invite: OnboardingContract['invites'][number],
  input: RevokeOnboardingInviteInput,
): OnboardingContract['invites'][number] => {
  return {
    inviteId: invite.inviteId,
    householdId: invite.householdId,
    role: invite.role,
    profileId: invite.profileId,
    issuedByMemberId: invite.issuedByMemberId,
    issuedAt: invite.issuedAt,
    expiresAt: invite.expiresAt,
    state: 'revoked',
    revokedAt: input.revokedAt,
    revokedByMemberId: input.revokedByMemberId,
  };
};

const dedupeTelegramUserIds = (telegramUserIds: number[]): number[] => {
  const values: number[] = [];
  for (const telegramUserId of telegramUserIds) {
    if (!values.includes(telegramUserId)) {
      values.push(telegramUserId);
    }
  }

  return values;
};

const replaceTelegramUserId = (
  telegramUserIds: number[],
  previousTelegramUserId: number,
  nextTelegramUserId: number,
): number[] => {
  const replaced = telegramUserIds.map((telegramUserId) => {
    if (telegramUserId === previousTelegramUserId) {
      return nextTelegramUserId;
    }

    return telegramUserId;
  });

  return dedupeTelegramUserIds(replaced);
};

const dedupeMemberLinks = (
  memberLinks: OnboardingContract['memberLinks'],
): OnboardingContract['memberLinks'] => {
  const values: OnboardingContract['memberLinks'] = [];
  for (const memberLink of memberLinks) {
    const alreadyExists = values.some((entry) => {
      return (
        entry.memberId === memberLink.memberId &&
        entry.telegramUserId === memberLink.telegramUserId
      );
    });

    if (!alreadyExists) {
      values.push(memberLink);
    }
  }

  return values;
};

export async function bootstrapParentOnboarding(
  rawInput: BootstrapParentOnboardingInput,
): Promise<BootstrapParentOnboardingResult> {
  const input = BOOTSTRAP_INPUT_SCHEMA.parse(rawInput);
  const loaded = await loadFamilyConfig({ haloHome: input.haloHome });
  const familyConfig = assertLegacyFamilyConfig(loaded);

  if (familyConfig.onboarding) {
    const existingOwnerLink = familyConfig.onboarding.memberLinks.find((link) => {
      return (
        link.memberId === input.ownerMemberId &&
        link.telegramUserId === input.ownerTelegramUserId
      );
    });

    if (existingOwnerLink) {
      return {
        outcome: 'already_bootstrapped',
        onboarding: familyConfig.onboarding,
      };
    }
  }

  const onboarding = familyConfig.onboarding ?? buildBootstrapOnboarding(input);

  const nextConfig: LegacyFamilyConfig = {
    ...familyConfig,
    onboarding,
  };

  await persistFamilyConfig(input.haloHome, nextConfig);

  return {
    outcome: familyConfig.onboarding ? 'already_bootstrapped' : 'bootstrapped',
    onboarding,
  };
}

export async function issueOnboardingInvite(
  rawInput: IssueOnboardingInviteInput,
): Promise<IssueOnboardingInviteResult> {
  const input = ISSUE_INVITE_INPUT_SCHEMA.parse(rawInput);
  const loaded = await loadFamilyConfig({ haloHome: input.haloHome });
  const familyConfig = assertLegacyFamilyConfig(loaded);
  const onboarding = requireOnboardingContract(familyConfig);

  const existingInvite = onboarding.invites.find((invite) => invite.inviteId === input.inviteId);
  if (existingInvite) {
    if (
      existingInvite.state === 'issued' &&
      existingInvite.issuedByMemberId === input.issuedByMemberId &&
      existingInvite.role === input.role &&
      existingInvite.profileId === input.profileId &&
      existingInvite.issuedAt === input.issuedAt &&
      existingInvite.expiresAt === input.expiresAt
    ) {
      return {
        outcome: 'already_issued',
        onboarding,
      };
    }

    throw new Error(`Invite ${input.inviteId} already exists with different data.`);
  }

  const nextOnboarding = ONBOARDING_CONTRACT_SCHEMA.parse({
    ...onboarding,
    invites: [
      ...onboarding.invites,
      {
        inviteId: input.inviteId,
        householdId: onboarding.household.householdId,
        role: input.role,
        profileId: input.profileId,
        issuedByMemberId: input.issuedByMemberId,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        state: 'issued',
      },
    ],
  });

  const nextConfig: LegacyFamilyConfig = {
    ...familyConfig,
    onboarding: nextOnboarding,
  };

  await persistFamilyConfig(input.haloHome, nextConfig);

  return {
    outcome: 'issued',
    onboarding: nextOnboarding,
  };
}

export async function acceptOnboardingInvite(
  rawInput: AcceptOnboardingInviteInput,
): Promise<AcceptOnboardingInviteResult> {
  const input = ACCEPT_INVITE_INPUT_SCHEMA.parse(rawInput);
  const loaded = await loadFamilyConfig({ haloHome: input.haloHome });
  const familyConfig = assertLegacyFamilyConfig(loaded);
  const onboarding = requireOnboardingContract(familyConfig);

  const inviteIndex = onboarding.invites.findIndex((invite) => invite.inviteId === input.inviteId);
  if (inviteIndex < 0) {
    throw new Error(`Invite ${input.inviteId} does not exist.`);
  }

  const invite = onboarding.invites[inviteIndex];
  if (!invite) {
    throw new Error(`Invite ${input.inviteId} does not exist.`);
  }

  if (invite.state === 'accepted') {
    const isSameAcceptance =
      invite.acceptedByMemberId === input.memberId &&
      invite.acceptedTelegramUserId === input.telegramUserId;

    if (isSameAcceptance) {
      return {
        outcome: 'already_joined',
        onboarding,
      };
    }

    return {
      outcome: 'duplicate_join',
      onboarding,
    };
  }

  if (invite.state !== 'issued') {
    return {
      outcome: 'duplicate_join',
      onboarding,
    };
  }

  const linkedToOtherMember = familyConfig.members.find((member) => {
    return (
      member.memberId !== input.memberId &&
      member.telegramUserIds.includes(input.telegramUserId)
    );
  });

  if (linkedToOtherMember) {
    return {
      outcome: 'duplicate_join',
      onboarding,
    };
  }

  const conflictingMemberLink = onboarding.memberLinks.find((link) => {
    return link.memberId !== input.memberId && link.telegramUserId === input.telegramUserId;
  });

  if (conflictingMemberLink) {
    return {
      outcome: 'duplicate_join',
      onboarding,
    };
  }

  const existingMember = familyConfig.members.find(
    (member) => member.memberId === input.memberId,
  );

  const members = familyConfig.members.map((member) => ({ ...member }));
  if (!existingMember) {
    if (invite.role === 'child' && !input.ageGroup) {
      throw new Error('ageGroup is required when accepting a child invite for a new member.');
    }

    if (invite.role === 'child') {
      members.push({
        memberId: input.memberId,
        displayName: input.displayName,
        role: 'child',
        ageGroup: input.ageGroup,
        parentalVisibility: input.parentalVisibility,
        telegramUserIds: [input.telegramUserId],
      });
    }

    if (invite.role === 'parent') {
      members.push({
        memberId: input.memberId,
        displayName: input.displayName,
        role: 'parent',
        telegramUserIds: [input.telegramUserId],
      });
    }
  }

  if (existingMember) {
    if (existingMember.role !== invite.role) {
      return {
        outcome: 'duplicate_join',
        onboarding,
      };
    }

    const memberIndex = members.findIndex((member) => member.memberId === input.memberId);
    if (memberIndex < 0) {
      throw new Error(`Member ${input.memberId} does not exist.`);
    }

    const targetMember = members[memberIndex];
    if (!targetMember) {
      throw new Error(`Member ${input.memberId} does not exist.`);
    }

    const nextTelegramIds = targetMember.telegramUserIds.includes(input.telegramUserId)
      ? targetMember.telegramUserIds
      : [...targetMember.telegramUserIds, input.telegramUserId];

    if (invite.role === 'child' && !targetMember.ageGroup && !input.ageGroup) {
      throw new Error('ageGroup is required when linking a child member without ageGroup.');
    }

    members[memberIndex] = {
      ...targetMember,
      displayName: input.displayName,
      telegramUserIds: nextTelegramIds,
      ageGroup:
        targetMember.role === 'child'
          ? targetMember.ageGroup ?? input.ageGroup
          : targetMember.ageGroup,
      parentalVisibility:
        targetMember.role === 'child'
          ? targetMember.parentalVisibility ?? input.parentalVisibility
          : targetMember.parentalVisibility,
    };
  }

  const existingExactLink = onboarding.memberLinks.find((link) => {
    return (
      link.memberId === input.memberId &&
      link.telegramUserId === input.telegramUserId
    );
  });

  const nextMemberLinks = existingExactLink
    ? onboarding.memberLinks
    : [
        ...onboarding.memberLinks,
        {
          memberId: input.memberId,
          role: invite.role,
          profileId: invite.profileId,
          telegramUserId: input.telegramUserId,
          linkedAt: input.acceptedAt,
          linkedByMemberId: input.linkedByMemberId,
        },
      ];

  const nextInvites = onboarding.invites.map((entry, index) => {
    if (index !== inviteIndex) {
      return entry;
    }

    return buildAcceptedInvite(entry, input);
  });

  const nextOnboarding = ONBOARDING_CONTRACT_SCHEMA.parse({
    ...onboarding,
    memberLinks: nextMemberLinks,
    invites: nextInvites,
  });

  const nextConfig: LegacyFamilyConfig = {
    ...familyConfig,
    members,
    onboarding: nextOnboarding,
  };

  await persistFamilyConfig(input.haloHome, nextConfig);

  return {
    outcome: 'joined',
    onboarding: nextOnboarding,
  };
}

export async function revokeOnboardingInvite(
  rawInput: RevokeOnboardingInviteInput,
): Promise<RevokeOnboardingInviteResult> {
  const input = REVOKE_INVITE_INPUT_SCHEMA.parse(rawInput);
  const loaded = await loadFamilyConfig({ haloHome: input.haloHome });
  const familyConfig = assertLegacyFamilyConfig(loaded);
  const onboarding = requireOnboardingContract(familyConfig);

  const inviteIndex = onboarding.invites.findIndex((invite) => invite.inviteId === input.inviteId);
  if (inviteIndex < 0) {
    throw new Error(`Invite ${input.inviteId} does not exist.`);
  }

  const invite = onboarding.invites[inviteIndex];
  if (!invite) {
    throw new Error(`Invite ${input.inviteId} does not exist.`);
  }

  if (invite.state === 'revoked') {
    return {
      outcome: 'already_revoked',
      onboarding,
    };
  }

  if (invite.state !== 'issued') {
    return {
      outcome: 'not_revocable',
      onboarding,
    };
  }

  const nextInvites = onboarding.invites.map((entry, index) => {
    if (index !== inviteIndex) {
      return entry;
    }

    return buildRevokedInvite(entry, input);
  });

  const nextOnboarding = ONBOARDING_CONTRACT_SCHEMA.parse({
    ...onboarding,
    invites: nextInvites,
  });

  const nextConfig: LegacyFamilyConfig = {
    ...familyConfig,
    onboarding: nextOnboarding,
  };

  await persistFamilyConfig(input.haloHome, nextConfig);

  return {
    outcome: 'revoked',
    onboarding: nextOnboarding,
  };
}

export async function relinkOnboardingMember(
  rawInput: RelinkOnboardingMemberInput,
): Promise<RelinkOnboardingMemberResult> {
  const input = RELINK_MEMBER_INPUT_SCHEMA.parse(rawInput);
  const loaded = await loadFamilyConfig({ haloHome: input.haloHome });
  const familyConfig = assertLegacyFamilyConfig(loaded);
  const onboarding = requireOnboardingContract(familyConfig);

  if (input.previousTelegramUserId === input.nextTelegramUserId) {
    throw new Error('nextTelegramUserId must differ from previousTelegramUserId.');
  }

  const existingRelink = onboarding.relinks.find((entry) => entry.relinkId === input.relinkId);
  if (existingRelink) {
    const isSameRelink =
      existingRelink.memberId === input.memberId &&
      existingRelink.previousTelegramUserId === input.previousTelegramUserId &&
      existingRelink.nextTelegramUserId === input.nextTelegramUserId;

    if (isSameRelink) {
      return {
        outcome: 'already_relinked',
        onboarding,
      };
    }

    throw new Error(`Relink ${input.relinkId} already exists with different data.`);
  }

  const linkedToOtherMember = familyConfig.members.find((member) => {
    return (
      member.memberId !== input.memberId &&
      member.telegramUserIds.includes(input.nextTelegramUserId)
    );
  });

  if (linkedToOtherMember) {
    return {
      outcome: 'duplicate_join',
      onboarding,
    };
  }

  const memberIndex = familyConfig.members.findIndex((member) => member.memberId === input.memberId);
  if (memberIndex < 0) {
    throw new Error(`Member ${input.memberId} does not exist.`);
  }

  const member = familyConfig.members[memberIndex];
  if (!member) {
    throw new Error(`Member ${input.memberId} does not exist.`);
  }

  const hasPreviousId = member.telegramUserIds.includes(input.previousTelegramUserId);
  const hasNextId = member.telegramUserIds.includes(input.nextTelegramUserId);

  if (!hasPreviousId && hasNextId) {
    return {
      outcome: 'already_relinked',
      onboarding,
    };
  }

  if (!hasPreviousId && !hasNextId) {
    throw new Error(
      `Member ${input.memberId} is not linked to telegram user ${input.previousTelegramUserId}.`,
    );
  }

  const nextTelegramUserIds = replaceTelegramUserId(
    member.telegramUserIds,
    input.previousTelegramUserId,
    input.nextTelegramUserId,
  );

  const nextMembers = familyConfig.members.map((entry) => ({ ...entry }));
  nextMembers[memberIndex] = {
    ...member,
    telegramUserIds: nextTelegramUserIds,
  };

  const conflictingMemberLink = onboarding.memberLinks.find((memberLink) => {
    return (
      memberLink.memberId !== input.memberId &&
      memberLink.telegramUserId === input.nextTelegramUserId
    );
  });

  if (conflictingMemberLink) {
    return {
      outcome: 'duplicate_join',
      onboarding,
    };
  }

  const memberLinks = onboarding.memberLinks.map((entry) => ({ ...entry }));
  const previousLinkIndex = memberLinks.findIndex((memberLink) => {
    return (
      memberLink.memberId === input.memberId &&
      memberLink.telegramUserId === input.previousTelegramUserId
    );
  });

  if (previousLinkIndex >= 0) {
    const targetLink = memberLinks[previousLinkIndex];
    if (!targetLink) {
      throw new Error(`Member link for ${input.memberId} does not exist.`);
    }

    memberLinks[previousLinkIndex] = {
      ...targetLink,
      telegramUserId: input.nextTelegramUserId,
      linkedAt: input.approvedAt,
      linkedByMemberId: input.approvedByMemberId,
    };
  }

  if (previousLinkIndex < 0) {
    const existingNextLink = memberLinks.find((memberLink) => {
      return (
        memberLink.memberId === input.memberId &&
        memberLink.telegramUserId === input.nextTelegramUserId
      );
    });

    if (existingNextLink) {
      return {
        outcome: 'already_relinked',
        onboarding,
      };
    }

    const fallbackMemberLink = memberLinks.find((memberLink) => {
      return memberLink.memberId === input.memberId;
    });

    if (!fallbackMemberLink) {
      throw new Error(`Member link for ${input.memberId} does not exist.`);
    }

    memberLinks.push({
      ...fallbackMemberLink,
      telegramUserId: input.nextTelegramUserId,
      linkedAt: input.approvedAt,
      linkedByMemberId: input.approvedByMemberId,
    });
  }

  const nextOnboarding = ONBOARDING_CONTRACT_SCHEMA.parse({
    ...onboarding,
    memberLinks: dedupeMemberLinks(memberLinks),
    relinks: [
      ...onboarding.relinks,
      {
        relinkId: input.relinkId,
        householdId: onboarding.household.householdId,
        memberId: input.memberId,
        previousTelegramUserId: input.previousTelegramUserId,
        nextTelegramUserId: input.nextTelegramUserId,
        requestedByMemberId: input.requestedByMemberId,
        requestedAt: input.requestedAt,
        approvedByMemberId: input.approvedByMemberId,
        approvedAt: input.approvedAt,
      },
    ],
  });

  const nextConfig: LegacyFamilyConfig = {
    ...familyConfig,
    members: nextMembers,
    onboarding: nextOnboarding,
  };

  await persistFamilyConfig(input.haloHome, nextConfig);

  return {
    outcome: 'relinked',
    onboarding: nextOnboarding,
  };
}
