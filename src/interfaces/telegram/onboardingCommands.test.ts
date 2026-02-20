import { describe, expect, it, vi } from 'vitest';
import type { FamilyConfig } from '../../runtime/familyConfig.js';
import { runTelegramOnboardingCommand } from './onboardingCommands.js';
import type { TelegramPolicyDecision } from './policy.js';

const makeParentDmPolicy = (): TelegramPolicyDecision => ({
  allow: true,
  action: 'allow' as const,
  allowedCapabilities: [],
  allowedMemoryReadLanes: [],
  allowedMemoryWriteLanes: [],
  modelPlan: { tier: 'standard', model: 'gpt-4o', reason: 'default' },
  rationale: [],
  policyVersion: 'v2-test',
  scopeType: 'dm',
  role: 'parent',
  memberId: 'wags',
  scopeId: 'telegram:dm:wags',
});

const makeV2FamilyConfig = (profiles: Array<{ profileId: string; role: 'parent' | 'child' }>): FamilyConfig => ({
  schemaVersion: 2,
  familyId: 'default',
  members: [
    {
      memberId: 'wags',
      displayName: 'Wags',
      role: 'parent',
      telegramUserIds: [456],
    },
  ],
  controlPlane: {
    policyVersion: 'v2',
    activeProfileId: profiles[0]?.profileId ?? 'parent_default',
    profiles: profiles.map((p) => ({
      profileId: p.profileId,
      role: p.role,
      capabilityTierId: 'standard',
      memoryLanePolicyId: 'default',
      modelPolicyId: 'default',
      safetyPolicyId: 'default',
    })),
    scopes: [{ scopeId: 'scope-dm-wags', scopeType: 'dm', telegramChatId: null }],
    capabilityTiers: {},
    memoryLanePolicies: {},
    modelPolicies: {},
    safetyPolicies: {},
  },
});

const makeDeps = () => ({
  bootstrapParentOnboarding: vi.fn().mockResolvedValue({
    outcome: 'already_bootstrapped',
    onboarding: {
      household: { householdId: 'h1', displayName: 'H', ownerMemberId: 'wags', createdAt: '2026-01-01T00:00:00.000Z' },
      memberLinks: [],
      invites: [],
      relinks: [],
      scopeTerminology: { dm: 'member DM', parentsGroup: 'parents group', familyGroup: 'family group' },
    },
  }),
  issueOnboardingInvite: vi.fn().mockResolvedValue({
    outcome: 'issued',
    onboarding: {
      household: { householdId: 'h1', displayName: 'H', ownerMemberId: 'wags', createdAt: '2026-01-01T00:00:00.000Z' },
      memberLinks: [],
      invites: [],
      relinks: [],
      scopeTerminology: { dm: 'member DM', parentsGroup: 'parents group', familyGroup: 'family group' },
    },
  }),
  acceptOnboardingInvite: vi.fn().mockResolvedValue({
    outcome: 'joined',
    onboarding: {
      household: { householdId: 'h1', displayName: 'H', ownerMemberId: 'wags', createdAt: '2026-01-01T00:00:00.000Z' },
      memberLinks: [],
      invites: [],
      relinks: [],
      scopeTerminology: { dm: 'member DM', parentsGroup: 'parents group', familyGroup: 'family group' },
    },
  }),
});

describe('onboardingCommands', () => {
  describe('resolveProfileId uses v2 control-plane profiles', () => {
    it('uses custom parent profile from v2 config for spouse join', async () => {
      const family = makeV2FamilyConfig([
        { profileId: 'guardian', role: 'parent' },
        { profileId: 'minor', role: 'child' },
      ]);
      const deps = makeDeps();

      await runTelegramOnboardingCommand(
        {
          command: { commandName: 'onboard', args: 'join spouse co_parent CoParent 2002' },
          policy: makeParentDmPolicy(),
          family,
          haloHome: '/tmp/halo-test',
          telegramFromId: 456,
          now: new Date('2026-02-17T10:00:00.000Z'),
        },
        deps,
      );

      expect(deps.issueOnboardingInvite).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: 'guardian' }),
      );
    });

    it('uses custom child profile from v2 config for child join', async () => {
      const family = makeV2FamilyConfig([
        { profileId: 'guardian', role: 'parent' },
        { profileId: 'minor', role: 'child' },
      ]);
      const deps = makeDeps();

      await runTelegramOnboardingCommand(
        {
          command: { commandName: 'onboard', args: 'join child kiddo Kiddo 3003 teen true' },
          policy: makeParentDmPolicy(),
          family,
          haloHome: '/tmp/halo-test',
          telegramFromId: 456,
          now: new Date('2026-02-17T10:00:00.000Z'),
        },
        deps,
      );

      expect(deps.issueOnboardingInvite).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: 'minor' }),
      );
    });

    it('falls back to hardcoded defaults when v2 config has no matching profile for role', async () => {
      const family = makeV2FamilyConfig([
        { profileId: 'guardian', role: 'parent' },
      ]);
      const deps = makeDeps();

      await runTelegramOnboardingCommand(
        {
          command: { commandName: 'onboard', args: 'join child kiddo Kiddo 3003 teen true' },
          policy: makeParentDmPolicy(),
          family,
          haloHome: '/tmp/halo-test',
          telegramFromId: 456,
          now: new Date('2026-02-17T10:00:00.000Z'),
        },
        deps,
      );

      expect(deps.issueOnboardingInvite).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: 'young_child' }),
      );
    });

    it('falls back to hardcoded defaults for v1 config without controlPlane', async () => {
      const family: FamilyConfig = {
        schemaVersion: 1,
        familyId: 'default',
        members: [
          { memberId: 'wags', displayName: 'Wags', role: 'parent', telegramUserIds: [456] },
        ],
      };
      const deps = makeDeps();

      await runTelegramOnboardingCommand(
        {
          command: { commandName: 'onboard', args: 'join spouse co_parent CoParent 2002' },
          policy: makeParentDmPolicy(),
          family,
          haloHome: '/tmp/halo-test',
          telegramFromId: 456,
          now: new Date('2026-02-17T10:00:00.000Z'),
        },
        deps,
      );

      expect(deps.issueOnboardingInvite).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: 'parent_default' }),
      );
    });
  });
});
