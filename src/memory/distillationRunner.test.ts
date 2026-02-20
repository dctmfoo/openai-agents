import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { AgentInputItem } from '@openai/agents';

import { runDistillation } from './distillationRunner.js';
import { getLaneDailyPath, getLaneLongTermPath } from './laneMemory.js';
import { getScopedLongTermPath, getScopedDailyPath } from './scopedMemory.js';

const user = (text: string): AgentInputItem => ({
  type: 'message',
  role: 'user',
  content: [{ type: 'input_text', text }],
});

describe('distillationRunner lane routing', () => {
  it('routes distilled outputs to profile-driven write lanes and flushes idempotently', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'halo-distillation-runner-'));
    const configDir = path.join(rootDir, 'config');
    await mkdir(configDir, { recursive: true });

    await writeFile(
      path.join(configDir, 'family.json'),
      JSON.stringify(
        {
          schemaVersion: 2,
          policyVersion: 'v2',
          familyId: 'default',
          activeProfileId: 'local-family',
          profiles: [
            {
              profileId: 'young_child',
              role: 'child',
              capabilityTierId: 'cap_child',
              memoryLanePolicyId: 'lane_child',
              modelPolicyId: 'model_child',
              safetyPolicyId: 'safety_child',
            },
          ],
          members: [
            {
              memberId: 'kid',
              displayName: 'Kid',
              role: 'child',
              profileId: 'young_child',
              telegramUserIds: [111],
            },
          ],
          scopes: [
            {
              scopeId: 'telegram:family_group:999',
              scopeType: 'family_group',
              telegramChatId: 999,
            },
          ],
          capabilityTiers: {
            cap_child: ['chat.respond'],
          },
          memoryLanePolicies: {
            lane_child: {
              readLanes: ['child_private:{memberId}', 'family_shared'],
              writeLanes: ['child_private:{memberId}', 'family_shared'],
            },
          },
          modelPolicies: {
            model_child: {
              tier: 'child_default',
              model: 'gpt-5.1-mini',
              reason: 'child_default',
            },
          },
          safetyPolicies: {
            safety_child: {
              riskLevel: 'medium',
              escalationPolicyId: 'minor_default',
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const items = [
      user('remember: prefers mango milkshake'),
      user('today finished homework'),
    ];

    await runDistillation({
      rootDir,
      scopeId: 'telegram:dm:kid',
      items,
      mode: 'deterministic',
    });

    await runDistillation({
      rootDir,
      scopeId: 'telegram:dm:kid',
      items,
      mode: 'deterministic',
    });

    const laneLongTerm = getLaneLongTermPath({
      rootDir,
      laneId: 'child_private:kid',
    });
    const laneDaily = getLaneDailyPath(
      {
        rootDir,
        laneId: 'child_private:kid',
      },
      new Date(),
    );

    const sharedLongTerm = getLaneLongTermPath({
      rootDir,
      laneId: 'family_shared',
    });

    const longTerm = await readFile(laneLongTerm, 'utf8');
    const daily = await readFile(laneDaily, 'utf8');
    const shared = await readFile(sharedLongTerm, 'utf8');

    expect(longTerm).toContain('prefers mango milkshake');
    expect(shared).toContain('prefers mango milkshake');

    expect(longTerm.match(/prefers mango milkshake/g)?.length).toBe(1);
    expect(daily.match(/today finished homework/g)?.length).toBe(1);
  });

  it('does NOT write to scoped memory paths (lanes-only)', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'halo-distillation-no-scoped-'));
    const configDir = path.join(rootDir, 'config');
    await mkdir(configDir, { recursive: true });

    await writeFile(
      path.join(configDir, 'family.json'),
      JSON.stringify(
        {
          schemaVersion: 2,
          policyVersion: 'v2',
          familyId: 'default',
          activeProfileId: 'local-family',
          profiles: [
            {
              profileId: 'parent_profile',
              role: 'parent',
              capabilityTierId: 'cap_parent',
              memoryLanePolicyId: 'lane_parent',
              modelPolicyId: 'model_parent',
              safetyPolicyId: 'safety_parent',
            },
          ],
          members: [
            {
              memberId: 'wags',
              displayName: 'Wags',
              role: 'parent',
              profileId: 'parent_profile',
              telegramUserIds: [456],
            },
          ],
          scopes: [],
          capabilityTiers: {
            cap_parent: ['chat.respond'],
          },
          memoryLanePolicies: {
            lane_parent: {
              readLanes: ['parent_private:{memberId}'],
              writeLanes: ['parent_private:{memberId}'],
            },
          },
          modelPolicies: {
            model_parent: {
              tier: 'parent_default',
              model: 'gpt-5.1',
              reason: 'parent_default',
            },
          },
          safetyPolicies: {
            safety_parent: {
              riskLevel: 'low',
              escalationPolicyId: 'adult_default',
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const scopeId = 'telegram:dm:wags';
    const items = [
      user('remember: likes espresso'),
      user('today read a book'),
    ];

    await runDistillation({ rootDir, scopeId, items, mode: 'deterministic' });

    const scopedLongTermPath = getScopedLongTermPath({ rootDir, scopeId });
    const scopedDailyPath = getScopedDailyPath({ rootDir, scopeId }, new Date());

    expect(existsSync(scopedLongTermPath)).toBe(false);
    expect(existsSync(scopedDailyPath)).toBe(false);
  });
});
