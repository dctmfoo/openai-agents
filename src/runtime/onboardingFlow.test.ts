import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFamilyConfig } from './familyConfig.js';
import {
  acceptOnboardingInvite,
  bootstrapParentOnboarding,
  issueOnboardingInvite,
  relinkOnboardingMember,
  revokeOnboardingInvite,
} from './onboardingFlow.js';

describe('onboardingFlow', () => {
  it('persists parent bootstrap onboarding state', async () => {
    const haloHome = await mkdtemp(join(tmpdir(), 'halo-onboarding-'));
    const configDir = join(haloHome, 'config');
    await mkdir(configDir, { recursive: true });

    await writeFile(
      join(configDir, 'family.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          familyId: 'default',
          members: [
            {
              memberId: 'wags',
              displayName: 'Wags',
              role: 'parent',
              telegramUserIds: [456],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await bootstrapParentOnboarding({
      haloHome,
      householdId: 'household-default',
      householdDisplayName: 'Default Household',
      ownerMemberId: 'wags',
      ownerTelegramUserId: 456,
      ownerProfileId: 'parent_default',
      now: '2026-02-17T10:00:00.000Z',
    });

    expect(result.outcome).toBe('bootstrapped');

    const persisted = await loadFamilyConfig({ haloHome });
    expect(persisted.onboarding?.household.ownerMemberId).toBe('wags');
    expect(persisted.onboarding?.memberLinks).toEqual([
      {
        memberId: 'wags',
        role: 'parent',
        profileId: 'parent_default',
        telegramUserId: 456,
        linkedAt: '2026-02-17T10:00:00.000Z',
        linkedByMemberId: 'wags',
      },
    ]);
  });

  it('is idempotent for repeated parent bootstrap calls', async () => {
    const haloHome = await mkdtemp(join(tmpdir(), 'halo-onboarding-'));
    const configDir = join(haloHome, 'config');
    await mkdir(configDir, { recursive: true });

    await writeFile(
      join(configDir, 'family.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          familyId: 'default',
          members: [
            {
              memberId: 'wags',
              displayName: 'Wags',
              role: 'parent',
              telegramUserIds: [456],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await bootstrapParentOnboarding({
      haloHome,
      householdId: 'household-default',
      householdDisplayName: 'Default Household',
      ownerMemberId: 'wags',
      ownerTelegramUserId: 456,
      ownerProfileId: 'parent_default',
      now: '2026-02-17T10:00:00.000Z',
    });

    const repeated = await bootstrapParentOnboarding({
      haloHome,
      householdId: 'household-default',
      householdDisplayName: 'Default Household',
      ownerMemberId: 'wags',
      ownerTelegramUserId: 456,
      ownerProfileId: 'parent_default',
      now: '2026-02-17T10:05:00.000Z',
    });

    expect(repeated.outcome).toBe('already_bootstrapped');

    const persisted = await loadFamilyConfig({ haloHome });
    expect(persisted.onboarding?.memberLinks).toHaveLength(1);
    expect(persisted.onboarding?.memberLinks[0]?.linkedAt).toBe('2026-02-17T10:00:00.000Z');
  });

  it('persists member add-link flow through invite acceptance', async () => {
    const haloHome = await mkdtemp(join(tmpdir(), 'halo-onboarding-'));
    const configDir = join(haloHome, 'config');
    await mkdir(configDir, { recursive: true });

    await writeFile(
      join(configDir, 'family.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          familyId: 'default',
          members: [
            {
              memberId: 'wags',
              displayName: 'Wags',
              role: 'parent',
              telegramUserIds: [456],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await bootstrapParentOnboarding({
      haloHome,
      householdId: 'household-default',
      householdDisplayName: 'Default Household',
      ownerMemberId: 'wags',
      ownerTelegramUserId: 456,
      ownerProfileId: 'parent_default',
      now: '2026-02-17T10:00:00.000Z',
    });

    await issueOnboardingInvite({
      haloHome,
      inviteId: 'invite-child-1',
      issuedByMemberId: 'wags',
      role: 'child',
      profileId: 'young_child',
      issuedAt: '2026-02-17T10:10:00.000Z',
      expiresAt: '2026-02-18T10:10:00.000Z',
    });

    const accepted = await acceptOnboardingInvite({
      haloHome,
      inviteId: 'invite-child-1',
      memberId: 'kid',
      displayName: 'Kid',
      telegramUserId: 999,
      linkedByMemberId: 'wags',
      acceptedAt: '2026-02-17T10:11:00.000Z',
      ageGroup: 'child',
    });

    expect(accepted.outcome).toBe('joined');

    const persisted = await loadFamilyConfig({ haloHome });
    expect(persisted.members).toContainEqual(
      expect.objectContaining({
        memberId: 'kid',
        role: 'child',
        ageGroup: 'child',
        telegramUserIds: [999],
      }),
    );

    expect(persisted.onboarding?.memberLinks).toContainEqual({
      memberId: 'kid',
      role: 'child',
      profileId: 'young_child',
      telegramUserId: 999,
      linkedAt: '2026-02-17T10:11:00.000Z',
      linkedByMemberId: 'wags',
    });

    expect(persisted.onboarding?.invites).toContainEqual(
      expect.objectContaining({
        inviteId: 'invite-child-1',
        state: 'accepted',
        acceptedByMemberId: 'kid',
        acceptedTelegramUserId: 999,
      }),
    );
  });

  it('is idempotent for repeated invite acceptance by the same member account', async () => {
    const haloHome = await mkdtemp(join(tmpdir(), 'halo-onboarding-'));
    const configDir = join(haloHome, 'config');
    await mkdir(configDir, { recursive: true });

    await writeFile(
      join(configDir, 'family.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          familyId: 'default',
          members: [
            {
              memberId: 'wags',
              displayName: 'Wags',
              role: 'parent',
              telegramUserIds: [456],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await bootstrapParentOnboarding({
      haloHome,
      householdId: 'household-default',
      householdDisplayName: 'Default Household',
      ownerMemberId: 'wags',
      ownerTelegramUserId: 456,
      ownerProfileId: 'parent_default',
      now: '2026-02-17T10:00:00.000Z',
    });

    await issueOnboardingInvite({
      haloHome,
      inviteId: 'invite-child-1',
      issuedByMemberId: 'wags',
      role: 'child',
      profileId: 'young_child',
      issuedAt: '2026-02-17T10:10:00.000Z',
      expiresAt: '2026-02-18T10:10:00.000Z',
    });

    await acceptOnboardingInvite({
      haloHome,
      inviteId: 'invite-child-1',
      memberId: 'kid',
      displayName: 'Kid',
      telegramUserId: 999,
      linkedByMemberId: 'wags',
      acceptedAt: '2026-02-17T10:11:00.000Z',
      ageGroup: 'child',
    });

    const repeated = await acceptOnboardingInvite({
      haloHome,
      inviteId: 'invite-child-1',
      memberId: 'kid',
      displayName: 'Kid',
      telegramUserId: 999,
      linkedByMemberId: 'wags',
      acceptedAt: '2026-02-17T10:12:00.000Z',
      ageGroup: 'child',
    });

    expect(repeated.outcome).toBe('already_joined');

    const persisted = await loadFamilyConfig({ haloHome });
    const kidLinks =
      persisted.onboarding?.memberLinks.filter((link) => link.memberId === 'kid') ?? [];
    expect(kidLinks).toHaveLength(1);
  });

  it('handles duplicate joins when a used invite is reused by another telegram account', async () => {
    const haloHome = await mkdtemp(join(tmpdir(), 'halo-onboarding-'));
    const configDir = join(haloHome, 'config');
    await mkdir(configDir, { recursive: true });

    await writeFile(
      join(configDir, 'family.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          familyId: 'default',
          members: [
            {
              memberId: 'wags',
              displayName: 'Wags',
              role: 'parent',
              telegramUserIds: [456],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await bootstrapParentOnboarding({
      haloHome,
      householdId: 'household-default',
      householdDisplayName: 'Default Household',
      ownerMemberId: 'wags',
      ownerTelegramUserId: 456,
      ownerProfileId: 'parent_default',
      now: '2026-02-17T10:00:00.000Z',
    });

    await issueOnboardingInvite({
      haloHome,
      inviteId: 'invite-child-1',
      issuedByMemberId: 'wags',
      role: 'child',
      profileId: 'young_child',
      issuedAt: '2026-02-17T10:10:00.000Z',
      expiresAt: '2026-02-18T10:10:00.000Z',
    });

    await acceptOnboardingInvite({
      haloHome,
      inviteId: 'invite-child-1',
      memberId: 'kid',
      displayName: 'Kid',
      telegramUserId: 999,
      linkedByMemberId: 'wags',
      acceptedAt: '2026-02-17T10:11:00.000Z',
      ageGroup: 'child',
    });

    const duplicate = await acceptOnboardingInvite({
      haloHome,
      inviteId: 'invite-child-1',
      memberId: 'kid',
      displayName: 'Kid',
      telegramUserId: 123456,
      linkedByMemberId: 'wags',
      acceptedAt: '2026-02-17T10:12:00.000Z',
      ageGroup: 'child',
    });

    expect(duplicate.outcome).toBe('duplicate_join');

    const persisted = await loadFamilyConfig({ haloHome });
    const invite = persisted.onboarding?.invites.find((entry) => entry.inviteId === 'invite-child-1');
    expect(invite?.acceptedTelegramUserId).toBe(999);
  });

  it('supports revoke and re-invite lifecycle transitions', async () => {
    const haloHome = await mkdtemp(join(tmpdir(), 'halo-onboarding-'));
    const configDir = join(haloHome, 'config');
    await mkdir(configDir, { recursive: true });

    await writeFile(
      join(configDir, 'family.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          familyId: 'default',
          members: [
            {
              memberId: 'wags',
              displayName: 'Wags',
              role: 'parent',
              telegramUserIds: [456],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await bootstrapParentOnboarding({
      haloHome,
      householdId: 'household-default',
      householdDisplayName: 'Default Household',
      ownerMemberId: 'wags',
      ownerTelegramUserId: 456,
      ownerProfileId: 'parent_default',
      now: '2026-02-17T10:00:00.000Z',
    });

    await issueOnboardingInvite({
      haloHome,
      inviteId: 'invite-child-1',
      issuedByMemberId: 'wags',
      role: 'child',
      profileId: 'young_child',
      issuedAt: '2026-02-17T10:10:00.000Z',
      expiresAt: '2026-02-18T10:10:00.000Z',
    });

    const revoked = await revokeOnboardingInvite({
      haloHome,
      inviteId: 'invite-child-1',
      revokedByMemberId: 'wags',
      revokedAt: '2026-02-17T10:11:00.000Z',
    });

    expect(revoked.outcome).toBe('revoked');

    await issueOnboardingInvite({
      haloHome,
      inviteId: 'invite-child-2',
      issuedByMemberId: 'wags',
      role: 'child',
      profileId: 'young_child',
      issuedAt: '2026-02-17T10:12:00.000Z',
      expiresAt: '2026-02-18T10:12:00.000Z',
    });

    await acceptOnboardingInvite({
      haloHome,
      inviteId: 'invite-child-2',
      memberId: 'kid',
      displayName: 'Kid',
      telegramUserId: 999,
      linkedByMemberId: 'wags',
      acceptedAt: '2026-02-17T10:13:00.000Z',
      ageGroup: 'child',
    });

    const persisted = await loadFamilyConfig({ haloHome });
    const firstInvite = persisted.onboarding?.invites.find((entry) => entry.inviteId === 'invite-child-1');
    const secondInvite = persisted.onboarding?.invites.find((entry) => entry.inviteId === 'invite-child-2');

    expect(firstInvite?.state).toBe('revoked');
    expect(firstInvite).toEqual(
      expect.objectContaining({
        revokedByMemberId: 'wags',
        revokedAt: '2026-02-17T10:11:00.000Z',
      }),
    );

    expect(secondInvite?.state).toBe('accepted');
    expect(secondInvite?.acceptedByMemberId).toBe('kid');
  });

  it('supports relinking a member when their telegram account changes', async () => {
    const haloHome = await mkdtemp(join(tmpdir(), 'halo-onboarding-'));
    const configDir = join(haloHome, 'config');
    await mkdir(configDir, { recursive: true });

    await writeFile(
      join(configDir, 'family.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          familyId: 'default',
          members: [
            {
              memberId: 'wags',
              displayName: 'Wags',
              role: 'parent',
              telegramUserIds: [456],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await bootstrapParentOnboarding({
      haloHome,
      householdId: 'household-default',
      householdDisplayName: 'Default Household',
      ownerMemberId: 'wags',
      ownerTelegramUserId: 456,
      ownerProfileId: 'parent_default',
      now: '2026-02-17T10:00:00.000Z',
    });

    await issueOnboardingInvite({
      haloHome,
      inviteId: 'invite-child-1',
      issuedByMemberId: 'wags',
      role: 'child',
      profileId: 'young_child',
      issuedAt: '2026-02-17T10:10:00.000Z',
      expiresAt: '2026-02-18T10:10:00.000Z',
    });

    await acceptOnboardingInvite({
      haloHome,
      inviteId: 'invite-child-1',
      memberId: 'kid',
      displayName: 'Kid',
      telegramUserId: 999,
      linkedByMemberId: 'wags',
      acceptedAt: '2026-02-17T10:11:00.000Z',
      ageGroup: 'child',
    });

    const relinked = await relinkOnboardingMember({
      haloHome,
      relinkId: 'relink-1',
      memberId: 'kid',
      previousTelegramUserId: 999,
      nextTelegramUserId: 1001,
      requestedByMemberId: 'wags',
      requestedAt: '2026-02-17T10:20:00.000Z',
      approvedByMemberId: 'wags',
      approvedAt: '2026-02-17T10:21:00.000Z',
    });

    expect(relinked.outcome).toBe('relinked');

    const persisted = await loadFamilyConfig({ haloHome });
    const kid = persisted.members.find((entry) => entry.memberId === 'kid');
    const kidLink = persisted.onboarding?.memberLinks.find((entry) => entry.memberId === 'kid');

    expect(kid?.telegramUserIds).toEqual([1001]);
    expect(kidLink?.telegramUserId).toBe(1001);
    expect(persisted.onboarding?.relinks).toContainEqual(
      expect.objectContaining({
        relinkId: 'relink-1',
        memberId: 'kid',
        previousTelegramUserId: 999,
        nextTelegramUserId: 1001,
      }),
    );
  });
});
