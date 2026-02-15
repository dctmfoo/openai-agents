import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { getHaloHome } from './haloHome.js';
import { FAMILY_CONFIG_SCHEMA } from './familyConfig.js';

const HALO_CONFIG_SCHEMA_VERSION = 1;

const SHELL_COMMAND_POLICY_SCHEMA = z.object({
  allowedPatterns: z.array(z.string()).default([]),
  blockedPatterns: z.array(z.string()).default([]),
});

const SHELL_TOOL_CONFIG_SCHEMA = z
  .object({
    enabled: z.boolean().default(false),
    timeoutMs: z.number().int().positive().default(30000),
    maxOutputLength: z.number().int().positive().default(4096),
    cwd: z.string().optional(),
    commandPolicy: z
      .object({
        parent: SHELL_COMMAND_POLICY_SCHEMA.default({
          allowedPatterns: [],
          blockedPatterns: [],
        }),
        child: SHELL_COMMAND_POLICY_SCHEMA.default({
          allowedPatterns: [],
          blockedPatterns: [],
        }),
      })
      .default({
        parent: { allowedPatterns: [], blockedPatterns: [] },
        child: { allowedPatterns: [], blockedPatterns: [] },
      }),
  })
  .default({
    enabled: false,
    timeoutMs: 30000,
    maxOutputLength: 4096,
    commandPolicy: {
      parent: { allowedPatterns: [], blockedPatterns: [] },
      child: { allowedPatterns: [], blockedPatterns: [] },
    },
  });

const ROLE_TOOL_ACCESS_SCHEMA = z.object({
  allowedTools: z.array(z.string()).optional(),
  blockedTools: z.array(z.string()).optional(),
});

const SCOPE_TOOL_ACCESS_SCHEMA = z.record(z.string(), ROLE_TOOL_ACCESS_SCHEMA).default({});

const TOOL_ACCESS_SCHEMA = z
  .object({
    parent: SCOPE_TOOL_ACCESS_SCHEMA,
    child: z.record(z.string(), SCOPE_TOOL_ACCESS_SCHEMA).default({}),
  })
  .default({
    parent: {},
    child: {},
  });

const TOOLS_CONFIG_SCHEMA = z
  .object({
    shell: SHELL_TOOL_CONFIG_SCHEMA,
    access: TOOL_ACCESS_SCHEMA,
  })
  .default({
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

const FILE_MEMORY_RETENTION_SCHEMA = z
  .object({
    enabled: z.boolean().default(false),
    maxAgeDays: z.number().int().positive().default(30),
    runIntervalMinutes: z.number().int().positive().default(360),
    deleteOpenAIFiles: z.boolean().default(false),
    maxFilesPerRun: z.number().int().positive().default(25),
    dryRun: z.boolean().default(false),
    keepRecentPerScope: z.number().int().min(0).default(2),
    maxDeletesPerScopePerRun: z.number().int().positive().default(10),
    allowScopeIds: z.array(z.string().min(1)).default([]),
    denyScopeIds: z.array(z.string().min(1)).default([]),
    policyPreset: z
      .enum(['all', 'parents_only', 'exclude_children', 'custom'])
      .default('exclude_children'),
  })
  .default({
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
  });

const FILE_MEMORY_CONFIG_SCHEMA = z
  .object({
    enabled: z.boolean().default(false),
    uploadEnabled: z.boolean().default(false),
    maxFileSizeMb: z.number().int().positive().default(20),
    allowedExtensions: z.array(z.string()).default([
      'pdf',
      'txt',
      'md',
      'docx',
      'pptx',
      'csv',
      'json',
      'html',
    ]),
    maxFilesPerScope: z.number().int().positive().default(200),
    pollIntervalMs: z.number().int().positive().default(1500),
    includeSearchResults: z.boolean().default(false),
    maxNumResults: z.number().int().positive().default(5),
    retention: FILE_MEMORY_RETENTION_SCHEMA,
  })
  .default({
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

const HALO_CONFIG_SCHEMA = z.object({
  schemaVersion: z.literal(HALO_CONFIG_SCHEMA_VERSION),

  gateway: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.number().int().positive().default(8787),
    })
    .default({ host: '127.0.0.1', port: 8787 }),

  features: z
    .object({
      compactionEnabled: z.boolean().default(false),
      distillationEnabled: z.boolean().default(false),
    })
    .default({ compactionEnabled: false, distillationEnabled: false }),

  memory: z
    .object({
      distillationEveryNItems: z.number().int().positive().default(20),
      distillationMaxItems: z.number().int().positive().default(200),
      distillationMode: z.enum(['deterministic', 'llm']).default('deterministic'),
    })
    .default({
      distillationEveryNItems: 20,
      distillationMaxItems: 200,
      distillationMode: 'deterministic',
    }),

  childSafe: z
    .object({
      enabled: z.boolean().default(true),
      maxMessageLength: z.number().int().positive().default(800),
      blockedTopics: z.array(z.string()).default([]),
    })
    .default({
      enabled: true,
      maxMessageLength: 800,
      blockedTopics: [],
    }),

  semanticMemory: z
    .object({
      enabled: z.boolean().default(true),
      embeddingProvider: z.enum(['openai', 'gemini']).default('openai'),
      embeddingModel: z.string().default('text-embedding-3-small'),
      embeddingDimensions: z.number().int().positive().default(1536),
      vecExtensionPath: z.string().optional(),
      syncIntervalMinutes: z.number().int().positive().default(15),
      search: z
        .object({
          fusionMethod: z.literal('rrf').default('rrf'),
          vectorWeight: z.number().min(0).max(1).default(0.7),
          textWeight: z.number().min(0).max(1).default(0.3),
          minScore: z.number().min(0).default(0.005),
        })
        .default({
          fusionMethod: 'rrf',
          vectorWeight: 0.7,
          textWeight: 0.3,
          minScore: 0.005,
        }),
    })
    .default({
      enabled: true,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 1536,
      syncIntervalMinutes: 15,
      search: {
        fusionMethod: 'rrf',
        vectorWeight: 0.7,
        textWeight: 0.3,
        minScore: 0.005,
      },
    }),

  fileMemory: FILE_MEMORY_CONFIG_SCHEMA,

  tools: TOOLS_CONFIG_SCHEMA,

  family: FAMILY_CONFIG_SCHEMA.optional(),
});

export type HaloConfig = z.infer<typeof HALO_CONFIG_SCHEMA>;
export type FileMemoryConfig = HaloConfig['fileMemory'];
export type ToolsConfig = HaloConfig['tools'];
export type ShellToolConfig = ToolsConfig['shell'];
export type ToolAccessConfig = ToolsConfig['access'];

function getHaloConfigPath(env: NodeJS.ProcessEnv): string {
  const haloHome = getHaloHome(env);
  return path.join(haloHome, 'config.json');
}

export async function loadHaloConfig(env: NodeJS.ProcessEnv): Promise<HaloConfig> {
  const configPath = getHaloConfigPath(env);

  if (!existsSync(configPath)) {
    throw new Error(
      `Missing halo config at ${configPath}. Copy config/halo.example.json to HALO_HOME/config.json and edit it.`,
    );
  }

  const raw = await readFile(configPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${configPath}: ${(err as Error).message}`);
  }

  const res = HALO_CONFIG_SCHEMA.safeParse(parsed);
  if (!res.success) {
    throw new Error(
      `Invalid halo config at ${configPath}: ${res.error.message}`,
    );
  }

  // Env overrides (keep minimal; tokens remain env-only).
  const host = env.GATEWAY_HOST;
  const portRaw = env.GATEWAY_PORT;

  // Resolve vecExtensionPath: config > env > auto-detect
  const resolvedVecPath =
    res.data.semanticMemory.vecExtensionPath ??
    env.SQLITE_VEC_EXT ??
    undefined;

  return {
    ...res.data,
    gateway: {
      host: host ?? res.data.gateway.host,
      port: portRaw ? Number.parseInt(portRaw, 10) : res.data.gateway.port,
    },
    semanticMemory: {
      ...res.data.semanticMemory,
      vecExtensionPath: resolvedVecPath,
    },
  };
}
