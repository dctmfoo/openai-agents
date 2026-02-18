import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadHaloConfig } from './haloConfig.js';

describe('haloConfig', () => {
  it('applies defaults for fileMemory config', async () => {
    const haloHome = await mkdtemp(path.join(tmpdir(), 'halo-config-'));

    await writeFile(
      path.join(haloHome, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        gateway: { host: '127.0.0.1', port: 8787 },
        features: { compactionEnabled: false, distillationEnabled: false },
        memory: {
          distillationEveryNItems: 20,
          distillationMaxItems: 200,
          distillationMode: 'deterministic',
        },
        childSafe: { enabled: true, maxMessageLength: 800, blockedTopics: [] },
        semanticMemory: {
          enabled: false,
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          embeddingDimensions: 1536,
          syncIntervalMinutes: 15,
          search: { fusionMethod: 'rrf', vectorWeight: 0.7, textWeight: 0.3, minScore: 0.005 },
        },
      }),
      'utf8',
    );

    const config = await loadHaloConfig({ HALO_HOME: haloHome } as NodeJS.ProcessEnv);

    expect(config.fileMemory).toEqual({
      enabled: false,
      uploadEnabled: false,
      maxFileSizeMb: 20,
      allowedExtensions: ['pdf', 'txt', 'md', 'docx', 'pptx', 'csv', 'json', 'html'],
      maxFilesPerScope: 200,
      pollIntervalMs: 1500,
      includeSearchResults: false,
      maxNumResults: 5,
      retention: {
        enabled: false,
        maxAgeDays: 30,
        runIntervalMinutes: 360,
        deleteOpenAIFiles: false,
        maxFilesPerRun: 25,
        dryRun: false,
        keepRecentPerScope: 2,
        maxDeletesPerScopePerRun: 10,
        allowScopeIds: [],
        denyScopeIds: [],
        policyPreset: 'exclude_children',
      },
    });
  });

  it('defaults controlPlane profile mapping when omitted', async () => {
    const haloHome = await mkdtemp(path.join(tmpdir(), 'halo-config-'));

    await writeFile(
      path.join(haloHome, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        gateway: { host: '127.0.0.1', port: 8787 },
        features: { compactionEnabled: false, distillationEnabled: false },
        memory: {
          distillationEveryNItems: 20,
          distillationMaxItems: 200,
          distillationMode: 'deterministic',
        },
        childSafe: { enabled: true, maxMessageLength: 800, blockedTopics: [] },
        semanticMemory: {
          enabled: false,
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          embeddingDimensions: 1536,
          syncIntervalMinutes: 15,
          search: { fusionMethod: 'rrf', vectorWeight: 0.7, textWeight: 0.3, minScore: 0.005 },
        },
      }),
      'utf8',
    );

    const config = await loadHaloConfig({ HALO_HOME: haloHome } as NodeJS.ProcessEnv);

    expect(config.controlPlane).toEqual({
      activeProfile: 'legacy',
      profiles: {
        legacy: {
          path: 'config/family.json',
        },
      },
    });
  });

  it('loads custom controlPlane profile mappings', async () => {
    const haloHome = await mkdtemp(path.join(tmpdir(), 'halo-config-'));

    await writeFile(
      path.join(haloHome, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        gateway: { host: '127.0.0.1', port: 8787 },
        features: { compactionEnabled: false, distillationEnabled: false },
        memory: {
          distillationEveryNItems: 20,
          distillationMaxItems: 200,
          distillationMode: 'deterministic',
        },
        childSafe: { enabled: true, maxMessageLength: 800, blockedTopics: [] },
        semanticMemory: {
          enabled: false,
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          embeddingDimensions: 1536,
          syncIntervalMinutes: 15,
          search: { fusionMethod: 'rrf', vectorWeight: 0.7, textWeight: 0.3, minScore: 0.005 },
        },
        controlPlane: {
          activeProfile: 'v2',
          profiles: {
            legacy: {
              path: 'config/family.json',
            },
            v2: {
              path: 'config/control-plane.json',
            },
          },
        },
      }),
      'utf8',
    );

    const config = await loadHaloConfig({ HALO_HOME: haloHome } as NodeJS.ProcessEnv);

    expect(config.controlPlane).toEqual({
      activeProfile: 'v2',
      profiles: {
        legacy: {
          path: 'config/family.json',
        },
        v2: {
          path: 'config/control-plane.json',
        },
      },
    });
  });

  it('loads custom fileMemory config values', async () => {
    const haloHome = await mkdtemp(path.join(tmpdir(), 'halo-config-'));

    await writeFile(
      path.join(haloHome, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        gateway: { host: '127.0.0.1', port: 8787 },
        features: { compactionEnabled: false, distillationEnabled: false },
        memory: {
          distillationEveryNItems: 20,
          distillationMaxItems: 200,
          distillationMode: 'deterministic',
        },
        childSafe: { enabled: true, maxMessageLength: 800, blockedTopics: [] },
        semanticMemory: {
          enabled: false,
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          embeddingDimensions: 1536,
          syncIntervalMinutes: 15,
          search: { fusionMethod: 'rrf', vectorWeight: 0.7, textWeight: 0.3, minScore: 0.005 },
        },
        fileMemory: {
          enabled: true,
          uploadEnabled: true,
          maxFileSizeMb: 10,
          allowedExtensions: ['pdf', 'txt'],
          maxFilesPerScope: 50,
          pollIntervalMs: 2000,
          includeSearchResults: true,
          maxNumResults: 3,
          retention: {
            enabled: true,
            maxAgeDays: 14,
            runIntervalMinutes: 120,
            deleteOpenAIFiles: true,
            maxFilesPerRun: 7,
            dryRun: true,
            keepRecentPerScope: 2,
            maxDeletesPerScopePerRun: 3,
            allowScopeIds: ['telegram:dm:wags', 'telegram:parents_group:999'],
            denyScopeIds: ['telegram:dm:kid'],
            policyPreset: 'parents_only',
          },
        },
      }),
      'utf8',
    );

    const config = await loadHaloConfig({ HALO_HOME: haloHome } as NodeJS.ProcessEnv);

    expect(config.fileMemory).toEqual({
      enabled: true,
      uploadEnabled: true,
      maxFileSizeMb: 10,
      allowedExtensions: ['pdf', 'txt'],
      maxFilesPerScope: 50,
      pollIntervalMs: 2000,
      includeSearchResults: true,
      maxNumResults: 3,
      retention: {
        enabled: true,
        maxAgeDays: 14,
        runIntervalMinutes: 120,
        deleteOpenAIFiles: true,
        maxFilesPerRun: 7,
        dryRun: true,
        keepRecentPerScope: 2,
        maxDeletesPerScopePerRun: 3,
        allowScopeIds: ['telegram:dm:wags', 'telegram:parents_group:999'],
        denyScopeIds: ['telegram:dm:kid'],
        policyPreset: 'parents_only',
      },
    });
  });

  it('defaults tools section when omitted', async () => {
    const haloHome = await mkdtemp(path.join(tmpdir(), 'halo-config-'));

    await writeFile(
      path.join(haloHome, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        gateway: { host: '127.0.0.1', port: 8787 },
        features: { compactionEnabled: false, distillationEnabled: false },
        memory: {
          distillationEveryNItems: 20,
          distillationMaxItems: 200,
          distillationMode: 'deterministic',
        },
        childSafe: { enabled: true, maxMessageLength: 800, blockedTopics: [] },
        semanticMemory: {
          enabled: false,
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          embeddingDimensions: 1536,
          syncIntervalMinutes: 15,
          search: { fusionMethod: 'rrf', vectorWeight: 0.7, textWeight: 0.3, minScore: 0.005 },
        },
      }),
      'utf8',
    );

    const config = await loadHaloConfig({ HALO_HOME: haloHome } as NodeJS.ProcessEnv);

    expect(config.tools).toEqual({
      shell: {
        enabled: false,
        timeoutMs: 30000,
        maxOutputLength: 4096,
        commandPolicy: {
          parent: { allowedPatterns: [], blockedPatterns: [] },
          child: { allowedPatterns: [], blockedPatterns: [] },
        },
      },
      access: { parent: {}, child: {} },
    });
  });

  it('loads shell config with patterns', async () => {
    const haloHome = await mkdtemp(path.join(tmpdir(), 'halo-config-'));

    await writeFile(
      path.join(haloHome, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        gateway: { host: '127.0.0.1', port: 8787 },
        features: { compactionEnabled: false, distillationEnabled: false },
        memory: {
          distillationEveryNItems: 20,
          distillationMaxItems: 200,
          distillationMode: 'deterministic',
        },
        childSafe: { enabled: true, maxMessageLength: 800, blockedTopics: [] },
        semanticMemory: {
          enabled: false,
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          embeddingDimensions: 1536,
          syncIntervalMinutes: 15,
          search: { fusionMethod: 'rrf', vectorWeight: 0.7, textWeight: 0.3, minScore: 0.005 },
        },
        tools: {
          shell: {
            enabled: true,
            timeoutMs: 10000,
            maxOutputLength: 2048,
            commandPolicy: {
              parent: {
                allowedPatterns: ['^ls\\b', '^echo\\b'],
                blockedPatterns: ['sudo', 'rm\\s+-rf'],
              },
              child: {
                allowedPatterns: ['^date$'],
                blockedPatterns: [],
              },
            },
          },
          access: {
            parent: {
              dm: { allowedTools: ['web_search_call', 'shell'] },
            },
            child: {},
          },
        },
      }),
      'utf8',
    );

    const config = await loadHaloConfig({ HALO_HOME: haloHome } as NodeJS.ProcessEnv);

    expect(config.tools.shell.enabled).toBe(true);
    expect(config.tools.shell.timeoutMs).toBe(10000);
    expect(config.tools.shell.maxOutputLength).toBe(2048);
    expect(config.tools.shell.commandPolicy.parent.allowedPatterns).toEqual(['^ls\\b', '^echo\\b']);
    expect(config.tools.shell.commandPolicy.parent.blockedPatterns).toEqual(['sudo', 'rm\\s+-rf']);
    expect(config.tools.shell.commandPolicy.child.allowedPatterns).toEqual(['^date$']);
    expect(config.tools.access.parent.dm).toEqual({ allowedTools: ['web_search_call', 'shell'] });
  });
});
