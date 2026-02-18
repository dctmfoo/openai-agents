import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  acceptOnboardingInvite,
  bootstrapParentOnboarding,
  issueOnboardingInvite,
} from '../runtime/onboardingFlow.js';
import { loadFamilyConfig } from '../runtime/familyConfig.js';
import { resolveDecisionEnvelope } from '../policies/decisionEnvelope.js';
import { buildScopedRetrievalCandidatePrefilter } from '../tools/semanticSearchTool.js';
import { hashSessionId } from '../sessions/sessionHash.js';
import {
  appendLaneDailyNotesUnique,
  appendLaneLongTermFacts,
} from '../memory/laneMemory.js';
import {
  deleteLaneMemory,
  exportLaneMemory,
  runLaneRetention,
} from '../memory/laneOperations.js';
import {
  createTelegramAdapter,
  type TelegramBotLike,
  type TelegramContext,
} from '../interfaces/telegram/bot.js';

type HandlerBag = {
  messageText?: (ctx: TelegramContext) => Promise<void> | void;
  messageVoice?: (ctx: TelegramContext) => Promise<void> | void;
  error?: (err: unknown) => Promise<void> | void;
};

type FakeBot = TelegramBotLike & {
  handlers: HandlerBag;
};

const makeFakeBot = (): FakeBot => {
  const handlers: HandlerBag = {};

  return {
    handlers,
    on: (event, handler) => {
      if (event === 'message:text') {
        handlers.messageText = handler;
      }

      if (event === 'message:voice') {
        handlers.messageVoice = handler;
      }
    },
    catch: (handler) => {
      handlers.error = handler;
    },
    start: async () => {},
  };
};

describe('family-ready acceptance gate', () => {
  it('supports onboarding spouse + children through bootstrap and invite flows', async () => {
    const haloHome = await mkdtemp(path.join(tmpdir(), 'family-ready-onboarding-'));
    const configDir = path.join(haloHome, 'config');
    await mkdir(configDir, { recursive: true });

    await writeFile(
      path.join(configDir, 'family.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          familyId: 'default',
          members: [
            {
              memberId: 'parent-1',
              displayName: 'Parent One',
              role: 'parent',
              telegramUserIds: [111],
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
      ownerMemberId: 'parent-1',
      ownerTelegramUserId: 111,
      ownerProfileId: 'parent_default',
      now: '2026-02-18T09:00:00.000Z',
    });

    await issueOnboardingInvite({
      haloHome,
      inviteId: 'invite-spouse',
      issuedByMemberId: 'parent-1',
      role: 'parent',
      profileId: 'parent_default',
      issuedAt: '2026-02-18T09:10:00.000Z',
      expiresAt: '2026-02-19T09:10:00.000Z',
    });

    await issueOnboardingInvite({
      haloHome,
      inviteId: 'invite-kid',
      issuedByMemberId: 'parent-1',
      role: 'child',
      profileId: 'young_child',
      issuedAt: '2026-02-18T09:12:00.000Z',
      expiresAt: '2026-02-19T09:12:00.000Z',
    });

    await acceptOnboardingInvite({
      haloHome,
      inviteId: 'invite-spouse',
      memberId: 'parent-2',
      displayName: 'Parent Two',
      telegramUserId: 222,
      linkedByMemberId: 'parent-1',
      acceptedAt: '2026-02-18T09:20:00.000Z',
    });

    await acceptOnboardingInvite({
      haloHome,
      inviteId: 'invite-kid',
      memberId: 'kid-1',
      displayName: 'Kid One',
      telegramUserId: 333,
      linkedByMemberId: 'parent-1',
      acceptedAt: '2026-02-18T09:21:00.000Z',
      ageGroup: 'child',
    });

    const loaded = await loadFamilyConfig({ haloHome });
    expect(loaded.members.map((member) => member.memberId).sort()).toEqual([
      'kid-1',
      'parent-1',
      'parent-2',
    ]);
  });

  it('enforces DM + group behavior with mention gating', () => {
    const family = {
      schemaVersion: 1 as const,
      familyId: 'default',
      members: [
        {
          memberId: 'parent-1',
          displayName: 'Parent One',
          role: 'parent' as const,
          telegramUserIds: [111],
        },
        {
          memberId: 'kid-1',
          displayName: 'Kid One',
          role: 'child' as const,
          ageGroup: 'child' as const,
          telegramUserIds: [333],
        },
      ],
      parentsGroup: {
        telegramChatId: 999,
      },
    };

    const dmEnvelope = resolveDecisionEnvelope({
      policyVersion: 'v1',
      chat: { id: 111, type: 'private' },
      fromId: 111,
      family,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
    });
    expect(dmEnvelope.action).toBe('allow');
    expect(dmEnvelope.scope.scopeType).toBe('dm');

    const familyGroupWithoutMention = resolveDecisionEnvelope({
      policyVersion: 'v1',
      chat: { id: 888, type: 'group' },
      fromId: 111,
      family,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
    });
    expect(familyGroupWithoutMention.action).toBe('deny');

    const familyGroupWithMention = resolveDecisionEnvelope({
      policyVersion: 'v1',
      chat: { id: 888, type: 'group' },
      fromId: 111,
      family,
      intent: { isMentioned: true },
      familyGroupChatId: 888,
    });
    expect(familyGroupWithMention.action).toBe('allow');
    expect(familyGroupWithMention.allowedCapabilities).toEqual(['chat.respond.group_safe']);
  });

  it('routes sensitive topics using risk-based child policy actions', () => {
    const family = {
      schemaVersion: 1 as const,
      familyId: 'default',
      members: [
        {
          memberId: 'parent-1',
          displayName: 'Parent One',
          role: 'parent' as const,
          telegramUserIds: [111],
        },
        {
          memberId: 'kid-1',
          displayName: 'Kid One',
          role: 'child' as const,
          profileId: 'adolescent',
          telegramUserIds: [333],
        },
      ],
      parentsGroup: {
        telegramChatId: 999,
      },
    };

    const mediumRisk = resolveDecisionEnvelope({
      policyVersion: 'v2',
      chat: { id: 333, type: 'private' },
      fromId: 333,
      family,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
      safetySignal: { riskLevel: 'medium' },
      profilePolicies: {
        adolescent: {
          mediumRiskParentNotificationDefault: true,
        },
      },
    });

    const highRisk = resolveDecisionEnvelope({
      policyVersion: 'v2',
      chat: { id: 333, type: 'private' },
      fromId: 333,
      family,
      intent: { isMentioned: false },
      familyGroupChatId: 888,
      safetySignal: { riskLevel: 'high' },
    });

    expect(mediumRisk.action).toBe('requires_parent_approval');
    expect(highRisk.action).toBe('requires_parent_approval');
  });

  it('prefilters retrieval candidates by allowed lane/scope before generation', () => {
    const allowedLaneId = 'family_shared';
    const disallowedLaneId = 'parent_private:parent-1';
    const allowedScopeId = 'telegram:family_group:888';

    const prefilter = buildScopedRetrievalCandidatePrefilter({
      allowedLaneIds: [allowedLaneId],
      allowedScopeIds: [allowedScopeId],
    });

    const allowedInput = {
      candidate: {
        path: `/tmp/memory/lanes/${hashSessionId(allowedLaneId)}/MEMORY.md`,
      },
    };

    const blockedInput = {
      candidate: {
        path: `/tmp/memory/lanes/${hashSessionId(disallowedLaneId)}/MEMORY.md`,
      },
    };

    type PrefilterInput = Parameters<typeof prefilter>[0];

    expect(prefilter(allowedInput as PrefilterInput)).toBe(true);
    expect(prefilter(blockedInput as PrefilterInput)).toBe(false);
  });

  it('keeps voice-note flow on the policy path and falls back after retries', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'family-ready-voice-'));
    const bot = makeFakeBot();

    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'voice reply', raw: null });
    const transcribeVoiceNote = vi
      .fn()
      .mockRejectedValue(new Error('transcription unavailable'));

    createTelegramAdapter({
      token: 'token',
      bot,
      rootDir,
      deps: {
        runPrime,
        loadFamilyConfig: async () => {
          return {
            schemaVersion: 1,
            familyId: 'default',
            members: [
              {
                memberId: 'parent-1',
                displayName: 'Parent One',
                role: 'parent',
                telegramUserIds: [111],
              },
            ],
            parentsGroup: {
              telegramChatId: null,
            },
          };
        },
        downloadTelegramFile: async () => {
          return {
            bytes: new Uint8Array([1, 2, 3]),
            filePath: 'voice/file.ogg',
          };
        },
        transcribeVoiceNote,
      },
    });

    const handler = bot.handlers.messageVoice;
    if (!handler) {
      throw new Error('voice handler not registered');
    }

    const reply = vi.fn(async () => undefined);

    await handler({
      chat: {
        id: 1,
        type: 'private',
      },
      message: {
        message_id: 10,
        voice: {
          file_id: 'voice-file-1',
          file_unique_id: 'voice-unique-1',
          duration: 4,
          mime_type: 'audio/ogg',
        },
      },
      from: {
        id: 111,
      },
      reply,
    });

    expect(transcribeVoiceNote).toHaveBeenCalledTimes(3);
    expect(runPrime).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      'I couldn\'t transcribe that voice note right now. Please type your message or try another voice note.',
    );
  });

  it('executes retention, export, and delete operations on a policy lane', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'family-ready-lane-ops-'));
    const laneId = 'child_private:kid-1';

    await appendLaneLongTermFacts({ rootDir, laneId }, ['Kid likes astronomy']);
    await appendLaneDailyNotesUnique(
      { rootDir, laneId },
      ['Older note'],
      new Date('2026-02-01T10:00:00.000Z'),
    );
    await appendLaneDailyNotesUnique(
      { rootDir, laneId },
      ['Recent note'],
      new Date('2026-02-16T10:00:00.000Z'),
    );

    const retention = await runLaneRetention({
      rootDir,
      laneId,
      retentionDays: 7,
      now: new Date('2026-02-18T10:00:00.000Z'),
    });

    const exported = await exportLaneMemory({ rootDir, laneId });
    const deleted = await deleteLaneMemory({
      rootDir,
      laneId,
      now: new Date('2026-02-18T10:00:00.000Z'),
    });

    expect(retention.deletedFiles).toEqual(['2026-02-01.md']);
    expect(exported.longTerm).toContain('Kid likes astronomy');
    expect(exported.dailyFiles.map((entry) => entry.date)).toEqual(['2026-02-16']);
    expect(deleted.deleted).toBe(true);
  });
});
