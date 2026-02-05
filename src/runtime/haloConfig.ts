import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { getHaloHome } from './haloHome.js';
import { FAMILY_CONFIG_SCHEMA } from './familyConfig.js';

const HALO_CONFIG_SCHEMA_VERSION = 1;

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

  family: FAMILY_CONFIG_SCHEMA.optional(),
});

export type HaloConfig = z.infer<typeof HALO_CONFIG_SCHEMA>;

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
