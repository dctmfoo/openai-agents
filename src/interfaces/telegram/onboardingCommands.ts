import { z } from 'zod';

import type { FamilyConfig } from '../../runtime/familyConfig.js';
import {
  acceptOnboardingInvite,
  bootstrapParentOnboarding,
  issueOnboardingInvite,
} from '../../runtime/onboardingFlow.js';
import type { TelegramPolicyDecision } from './policy.js';

const ONBOARDING_HELP_REPLY =
  'Onboarding commands: /onboard bootstrap | /onboard join <parent|spouse|child> <memberId> <displayName> <telegramUserId> [ageGroup] [parentalVisibility]';
const ONBOARDING_PARENT_DM_ONLY_REPLY =
  'Onboarding commands are only available in parent DMs.';
const ONBOARDING_ROLE_SCHEMA = z.enum(['parent', 'spouse', 'child']);
const ONBOARDING_AGE_GROUP_SCHEMA = z.enum(['child', 'teen', 'young_adult']);
const ONBOARDING_EXPIRES_IN_DAYS = 7;

type OnboardingCommand = {
  commandName: string;
  args: string;
};

type TelegramOnboardingCommandInput = {
  command: OnboardingCommand;
  policy: TelegramPolicyDecision;
  family: FamilyConfig;
  haloHome: string;
  telegramFromId?: number | string;
  now: Date;
};

type TelegramOnboardingCommandResult = {
  handled: boolean;
  reply?: string;
};

type TelegramOnboardingCommandDeps = {
  bootstrapParentOnboarding: typeof bootstrapParentOnboarding;
  issueOnboardingInvite: typeof issueOnboardingInvite;
  acceptOnboardingInvite: typeof acceptOnboardingInvite;
};

type ParsedJoinCommand = {
  role: 'parent' | 'spouse' | 'child';
  memberId: string;
  displayName: string;
  telegramUserId: number;
  ageGroup?: 'child' | 'teen' | 'young_adult';
  parentalVisibility?: boolean;
};

const parseBooleanToken = (rawValue: string | undefined): boolean | undefined => {
  if (!rawValue) {
    return undefined;
  }

  const normalized = rawValue.toLowerCase();
  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  throw new Error('parentalVisibility must be true or false when provided.');
};

const parseTelegramUserId = (rawValue: number | string | undefined): number | null => {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }

  const parsed =
    typeof rawValue === 'number' ? rawValue : Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const mapOnboardingRole = (role: 'parent' | 'spouse' | 'child'): 'parent' | 'child' => {
  if (role === 'child') {
    return 'child';
  }

  return 'parent';
};

const resolveProfileId = (role: 'parent' | 'child'): string => {
  if (role === 'child') {
    return 'young_child';
  }

  return 'parent_default';
};

const resolveHouseholdId = (family: FamilyConfig): string => {
  if (family.onboarding) {
    return family.onboarding.household.householdId;
  }

  return `household-${family.familyId}`;
};

const resolveHouseholdDisplayName = (family: FamilyConfig): string => {
  if (family.onboarding) {
    return family.onboarding.household.displayName;
  }

  return `${family.familyId} household`;
};

const resolveOwnerProfileId = (family: FamilyConfig, ownerMemberId: string): string => {
  const owner = family.members.find((member) => member.memberId === ownerMemberId);
  if (!owner) {
    return 'parent_default';
  }

  return owner.profileId ?? 'parent_default';
};

const buildInviteId = (role: 'parent' | 'child', memberId: string, telegramUserId: number): string => {
  return `invite-${role}-${memberId}-${telegramUserId}`;
};

const parseJoinCommand = (rawTokens: string[]): ParsedJoinCommand => {
  if (rawTokens.length < 4 || rawTokens.length > 6) {
    throw new Error(
      'Usage: /onboard join <parent|spouse|child> <memberId> <displayName> <telegramUserId> [ageGroup] [parentalVisibility]',
    );
  }

  const [roleToken, memberId, displayName, rawTelegramUserId, ageGroupToken, parentalVisibilityToken] =
    rawTokens;

  const role = ONBOARDING_ROLE_SCHEMA.parse(roleToken.toLowerCase());
  const telegramUserId = z.coerce.number().int().positive().parse(rawTelegramUserId);

  let ageGroup: 'child' | 'teen' | 'young_adult' | undefined;
  if (ageGroupToken) {
    ageGroup = ONBOARDING_AGE_GROUP_SCHEMA.parse(ageGroupToken.toLowerCase());
  }

  return {
    role,
    memberId,
    displayName,
    telegramUserId,
    ageGroup,
    parentalVisibility: parseBooleanToken(parentalVisibilityToken),
  };
};

const formatCommandError = (err: unknown): string => {
  if (err instanceof z.ZodError) {
    const issue = err.issues[0];
    if (!issue) {
      return 'Onboarding command failed: invalid input.';
    }

    return `Onboarding command failed: ${issue.message}`;
  }

  if (err instanceof Error) {
    return `Onboarding command failed: ${err.message}`;
  }

  return 'Onboarding command failed.';
};

const ensureParentDmContext = (policy: TelegramPolicyDecision): string | null => {
  if (policy.scopeType !== 'dm') {
    return ONBOARDING_PARENT_DM_ONLY_REPLY;
  }

  if (policy.role !== 'parent') {
    return ONBOARDING_PARENT_DM_ONLY_REPLY;
  }

  if (!policy.memberId) {
    return 'Onboarding command failed: parent member id is missing from policy decision.';
  }

  return null;
};

const splitArgs = (args: string): string[] => {
  const trimmed = args.trim();
  if (!trimmed) {
    return [];
  }

  return trimmed.split(/\s+/g);
};

const buildBootstrapInput = (
  input: TelegramOnboardingCommandInput,
  ownerMemberId: string,
  ownerTelegramUserId: number,
) => {
  const nowIso = input.now.toISOString();
  return {
    haloHome: input.haloHome,
    householdId: resolveHouseholdId(input.family),
    householdDisplayName: resolveHouseholdDisplayName(input.family),
    ownerMemberId,
    ownerTelegramUserId,
    ownerProfileId: resolveOwnerProfileId(input.family, ownerMemberId),
    now: nowIso,
  };
};

const runBootstrapCommand = async (
  input: TelegramOnboardingCommandInput,
  deps: TelegramOnboardingCommandDeps,
  ownerMemberId: string,
  ownerTelegramUserId: number,
): Promise<string> => {
  const bootstrapInput = buildBootstrapInput(input, ownerMemberId, ownerTelegramUserId);
  const result = await deps.bootstrapParentOnboarding(bootstrapInput);

  return `Onboarding bootstrap completed: ${result.outcome} (${bootstrapInput.householdId}).`;
};

const runJoinCommand = async (
  input: TelegramOnboardingCommandInput,
  deps: TelegramOnboardingCommandDeps,
  ownerMemberId: string,
  ownerTelegramUserId: number,
  tokens: string[],
): Promise<string> => {
  const join = parseJoinCommand(tokens);

  if (join.role === 'child' && !join.ageGroup) {
    throw new Error('Child join requires ageGroup (child|teen|young_adult).');
  }

  const resolvedRole = mapOnboardingRole(join.role);
  const profileId = resolveProfileId(resolvedRole);
  const inviteId = buildInviteId(resolvedRole, join.memberId, join.telegramUserId);

  const issuedAt = input.now.toISOString();
  const expiresAt = new Date(
    input.now.getTime() + ONBOARDING_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  await deps.bootstrapParentOnboarding(
    buildBootstrapInput(input, ownerMemberId, ownerTelegramUserId),
  );

  await deps.issueOnboardingInvite({
    haloHome: input.haloHome,
    inviteId,
    issuedByMemberId: ownerMemberId,
    role: resolvedRole,
    profileId,
    issuedAt,
    expiresAt,
  });

  const accepted = await deps.acceptOnboardingInvite({
    haloHome: input.haloHome,
    inviteId,
    memberId: join.memberId,
    displayName: join.displayName,
    telegramUserId: join.telegramUserId,
    linkedByMemberId: ownerMemberId,
    acceptedAt: issuedAt,
    ageGroup: join.ageGroup,
    parentalVisibility: join.parentalVisibility,
  });

  const inviteRole =
    accepted.onboarding.invites.find((invite) => invite.inviteId === inviteId)?.role ??
    resolvedRole;

  return `Onboarding join completed: ${join.memberId} joined as ${inviteRole} (${accepted.outcome}).`;
};

export async function runTelegramOnboardingCommand(
  input: TelegramOnboardingCommandInput,
  deps: TelegramOnboardingCommandDeps,
): Promise<TelegramOnboardingCommandResult> {
  if (input.command.commandName !== 'onboard') {
    return { handled: false };
  }

  const contextError = ensureParentDmContext(input.policy);
  if (contextError) {
    return {
      handled: true,
      reply: contextError,
    };
  }

  const ownerMemberId = input.policy.memberId;
  if (!ownerMemberId) {
    return {
      handled: true,
      reply: 'Onboarding command failed: parent member id is missing from policy decision.',
    };
  }

  const ownerTelegramUserId = parseTelegramUserId(input.telegramFromId);
  if (ownerTelegramUserId === null) {
    return {
      handled: true,
      reply: 'Onboarding command failed: telegram user id is missing from context.',
    };
  }

  const tokens = splitArgs(input.command.args);
  const subcommand = tokens.shift()?.toLowerCase() ?? 'help';

  if (subcommand === 'help') {
    return {
      handled: true,
      reply: ONBOARDING_HELP_REPLY,
    };
  }

  try {
    if (subcommand === 'bootstrap') {
      if (tokens.length > 0) {
        throw new Error('Usage: /onboard bootstrap');
      }

      return {
        handled: true,
        reply: await runBootstrapCommand(
          input,
          deps,
          ownerMemberId,
          ownerTelegramUserId,
        ),
      };
    }

    if (subcommand === 'join') {
      return {
        handled: true,
        reply: await runJoinCommand(
          input,
          deps,
          ownerMemberId,
          ownerTelegramUserId,
          tokens,
        ),
      };
    }

    return {
      handled: true,
      reply: ONBOARDING_HELP_REPLY,
    };
  } catch (err) {
    return {
      handled: true,
      reply: formatCommandError(err),
    };
  }
}
