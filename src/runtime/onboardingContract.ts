import { z } from 'zod';

const MemberRoleSchema = z.enum(['parent', 'child']);
const InviteStateSchema = z.enum(['issued', 'accepted', 'expired', 'revoked']);

const TimestampSchema = z.string().min(1);

const parseTimestamp = (value: string): number | null => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return parsed;
};

const HouseholdSchema = z
  .object({
    householdId: z.string().min(1),
    displayName: z.string().min(1),
    ownerMemberId: z.string().min(1),
    createdAt: TimestampSchema,
  })
  .strict();

const MemberLinkSchema = z
  .object({
    memberId: z.string().min(1),
    role: MemberRoleSchema,
    profileId: z.string().min(1),
    telegramUserId: z.number().int().positive(),
    linkedAt: TimestampSchema,
    linkedByMemberId: z.string().min(1),
  })
  .strict();

const InviteSchema = z
  .object({
    inviteId: z.string().min(1),
    householdId: z.string().min(1),
    role: MemberRoleSchema,
    profileId: z.string().min(1),
    issuedByMemberId: z.string().min(1),
    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema,
    state: InviteStateSchema,
    acceptedAt: TimestampSchema.optional(),
    acceptedByMemberId: z.string().min(1).optional(),
    acceptedTelegramUserId: z.number().int().positive().optional(),
    expiredAt: TimestampSchema.optional(),
    revokedAt: TimestampSchema.optional(),
    revokedByMemberId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((invite, ctx) => {
    const addIssue = (path: string, message: string) => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message,
        path: [path],
      });
    };

    const issuedAt = parseTimestamp(invite.issuedAt);
    if (issuedAt === null) {
      addIssue('issuedAt', 'issuedAt must be a valid timestamp');
    }

    const expiresAt = parseTimestamp(invite.expiresAt);
    if (expiresAt === null) {
      addIssue('expiresAt', 'expiresAt must be a valid timestamp');
    }

    if (issuedAt !== null && expiresAt !== null && expiresAt <= issuedAt) {
      addIssue('expiresAt', 'expiresAt must be later than issuedAt');
    }

    if (invite.acceptedAt) {
      const acceptedAt = parseTimestamp(invite.acceptedAt);
      if (acceptedAt === null) {
        addIssue('acceptedAt', 'acceptedAt must be a valid timestamp');
      }

      if (acceptedAt !== null && issuedAt !== null && acceptedAt < issuedAt) {
        addIssue('acceptedAt', 'acceptedAt must be on or after issuedAt');
      }

      if (acceptedAt !== null && expiresAt !== null && acceptedAt > expiresAt) {
        addIssue('acceptedAt', 'acceptedAt must be on or before expiresAt');
      }
    }

    if (invite.expiredAt) {
      const expiredAt = parseTimestamp(invite.expiredAt);
      if (expiredAt === null) {
        addIssue('expiredAt', 'expiredAt must be a valid timestamp');
      }

      if (expiredAt !== null && expiresAt !== null && expiredAt < expiresAt) {
        addIssue('expiredAt', 'expiredAt must be on or after expiresAt');
      }
    }

    if (invite.revokedAt) {
      const revokedAt = parseTimestamp(invite.revokedAt);
      if (revokedAt === null) {
        addIssue('revokedAt', 'revokedAt must be a valid timestamp');
      }

      if (revokedAt !== null && issuedAt !== null && revokedAt < issuedAt) {
        addIssue('revokedAt', 'revokedAt must be on or after issuedAt');
      }
    }

    if (invite.state === 'issued') {
      if (invite.acceptedAt) {
        addIssue('acceptedAt', 'acceptedAt must be empty when state is issued');
      }

      if (invite.acceptedByMemberId) {
        addIssue('acceptedByMemberId', 'acceptedByMemberId must be empty when state is issued');
      }

      if (invite.acceptedTelegramUserId) {
        addIssue(
          'acceptedTelegramUserId',
          'acceptedTelegramUserId must be empty when state is issued',
        );
      }

      if (invite.expiredAt) {
        addIssue('expiredAt', 'expiredAt must be empty when state is issued');
      }

      if (invite.revokedAt) {
        addIssue('revokedAt', 'revokedAt must be empty when state is issued');
      }

      if (invite.revokedByMemberId) {
        addIssue('revokedByMemberId', 'revokedByMemberId must be empty when state is issued');
      }

      return;
    }

    if (invite.state === 'accepted') {
      if (!invite.acceptedAt) {
        addIssue('acceptedAt', 'acceptedAt is required when state is accepted');
      }

      if (!invite.acceptedByMemberId) {
        addIssue('acceptedByMemberId', 'acceptedByMemberId is required when state is accepted');
      }

      if (!invite.acceptedTelegramUserId) {
        addIssue(
          'acceptedTelegramUserId',
          'acceptedTelegramUserId is required when state is accepted',
        );
      }

      if (invite.expiredAt) {
        addIssue('expiredAt', 'expiredAt must be empty when state is accepted');
      }

      if (invite.revokedAt) {
        addIssue('revokedAt', 'revokedAt must be empty when state is accepted');
      }

      if (invite.revokedByMemberId) {
        addIssue('revokedByMemberId', 'revokedByMemberId must be empty when state is accepted');
      }

      return;
    }

    if (invite.state === 'expired') {
      if (!invite.expiredAt) {
        addIssue('expiredAt', 'expiredAt is required when state is expired');
      }

      if (invite.acceptedAt) {
        addIssue('acceptedAt', 'acceptedAt must be empty when state is expired');
      }

      if (invite.acceptedByMemberId) {
        addIssue('acceptedByMemberId', 'acceptedByMemberId must be empty when state is expired');
      }

      if (invite.acceptedTelegramUserId) {
        addIssue(
          'acceptedTelegramUserId',
          'acceptedTelegramUserId must be empty when state is expired',
        );
      }

      if (invite.revokedAt) {
        addIssue('revokedAt', 'revokedAt must be empty when state is expired');
      }

      if (invite.revokedByMemberId) {
        addIssue('revokedByMemberId', 'revokedByMemberId must be empty when state is expired');
      }

      return;
    }

    if (!invite.revokedAt) {
      addIssue('revokedAt', 'revokedAt is required when state is revoked');
    }

    if (!invite.revokedByMemberId) {
      addIssue('revokedByMemberId', 'revokedByMemberId is required when state is revoked');
    }

    if (invite.acceptedAt) {
      addIssue('acceptedAt', 'acceptedAt must be empty when state is revoked');
    }

    if (invite.acceptedByMemberId) {
      addIssue('acceptedByMemberId', 'acceptedByMemberId must be empty when state is revoked');
    }

    if (invite.acceptedTelegramUserId) {
      addIssue(
        'acceptedTelegramUserId',
        'acceptedTelegramUserId must be empty when state is revoked',
      );
    }

    if (invite.expiredAt) {
      addIssue('expiredAt', 'expiredAt must be empty when state is revoked');
    }
  });

const RelinkSchema = z
  .object({
    relinkId: z.string().min(1),
    householdId: z.string().min(1),
    memberId: z.string().min(1),
    previousTelegramUserId: z.number().int().positive(),
    nextTelegramUserId: z.number().int().positive(),
    requestedByMemberId: z.string().min(1),
    requestedAt: TimestampSchema,
    approvedByMemberId: z.string().min(1),
    approvedAt: TimestampSchema,
  })
  .strict()
  .superRefine((relink, ctx) => {
    if (relink.previousTelegramUserId !== relink.nextTelegramUserId) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'nextTelegramUserId must differ from previousTelegramUserId',
      path: ['nextTelegramUserId'],
    });
  });

const ScopeTerminologySchema = z
  .object({
    dm: z.literal('member DM'),
    parentsGroup: z.literal('parents group'),
    familyGroup: z.literal('family group'),
  })
  .strict();

export const ONBOARDING_CONTRACT_SCHEMA = z
  .object({
    household: HouseholdSchema,
    memberLinks: z.array(MemberLinkSchema).min(1),
    invites: z.array(InviteSchema),
    relinks: z.array(RelinkSchema),
    scopeTerminology: ScopeTerminologySchema,
  })
  .strict();

export type OnboardingContract = z.infer<typeof ONBOARDING_CONTRACT_SCHEMA>;
