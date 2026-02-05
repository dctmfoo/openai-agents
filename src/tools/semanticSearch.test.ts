import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { semanticSearch } from './semanticSearchTool.js';

describe('semanticSearch', () => {
  it('returns empty results when semantic memory is disabled', async () => {
    const haloHome = await mkdtemp(path.join(tmpdir(), 'halo-semantic-'));
    await mkdir(path.join(haloHome, 'config'), { recursive: true });
    await writeFile(
      path.join(haloHome, 'config', 'family.json'),
      JSON.stringify({
        schemaVersion: 1,
        familyId: 'default',
        members: [
          {
            memberId: 'wags',
            displayName: 'Wags',
            role: 'parent',
            telegramUserIds: [123],
          },
        ],
        parentsGroup: { telegramChatId: null },
      }),
      'utf8',
    );
    await writeFile(
      path.join(haloHome, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        gateway: { host: '127.0.0.1', port: 8787 },
        features: { compactionEnabled: false, distillationEnabled: false },
        memory: { distillationEveryNItems: 20, distillationMaxItems: 200, distillationMode: 'deterministic' },
        childSafe: { enabled: true, maxMessageLength: 800, blockedTopics: [] },
        semanticMemory: {
          enabled: false,
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          embeddingDimensions: 1536,
          syncIntervalMinutes: 15,
          search: { fusionMethod: 'rrf', vectorWeight: 0.7, textWeight: 0.3, minScore: 0.005 },
        },
        family: {
          schemaVersion: 1,
          familyId: 'default',
          members: [
            {
              memberId: 'wags',
              displayName: 'Wags',
              role: 'parent',
              telegramUserIds: [123],
            },
          ],
          parentsGroup: { telegramChatId: null },
        },
      }),
      'utf8',
    );

    const result = await semanticSearch(
      { query: 'hello', topK: 3 },
      {
        rootDir: haloHome,
        scopeId: 'telegram:dm:wags',
        role: 'parent',
        scopeType: 'dm',
      },
    );

    expect(result).toEqual([]);
  });
});
