import { createTelegramAdapter } from '../interfaces/telegram/bot.js';
import { resolveVersion, startAdminServer } from './admin.js';
import type { ToolsConfig } from '../runtime/haloConfig.js';
import { defaultSessionStore, SessionStore } from '../sessions/sessionStore.js';
import { createSemanticSyncScheduler } from '../memory/semanticSyncScheduler.js';
import { createFileMemoryRetentionScheduler } from '../files/fileMemoryRetentionScheduler.js';
import { loadFamilyConfig } from '../runtime/familyConfig.js';

export type GatewayOptions = {
  telegram?: {
    token?: string;
    logDir?: string;
    rootDir?: string;
  };
  admin?: {
    host?: string;
    port?: number;
    haloHome?: string;
    version?: string | null;
    startedAtMs?: number;
  };
  sessionStore?: SessionStore;
  config?: {
    schemaVersion?: number;
    gateway?: { host?: string; port?: number };
    features?: { compactionEnabled?: boolean; distillationEnabled?: boolean };
    memory?: {
      distillationEveryNItems?: number;
      distillationMaxItems?: number;
      distillationMode?: 'deterministic' | 'llm';
    };
    childSafe?: {
      enabled?: boolean;
      maxMessageLength?: number;
      blockedTopics?: string[];
    };
    semanticMemory?: {
      enabled?: boolean;
      embeddingProvider?: 'openai' | 'gemini';
      embeddingModel?: string;
      embeddingDimensions?: number;
      vecExtensionPath?: string;
      syncIntervalMinutes?: number;
      search?: {
        fusionMethod?: 'rrf';
        vectorWeight?: number;
        textWeight?: number;
        minScore?: number;
      };
    };
    fileMemory?: {
      enabled?: boolean;
      uploadEnabled?: boolean;
      maxFileSizeMb?: number;
      allowedExtensions?: string[];
      maxFilesPerScope?: number;
      pollIntervalMs?: number;
      includeSearchResults?: boolean;
      maxNumResults?: number;
      retention?: {
        enabled?: boolean;
        maxAgeDays?: number;
        runIntervalMinutes?: number;
        deleteOpenAIFiles?: boolean;
        maxFilesPerRun?: number;
        dryRun?: boolean;
        keepRecentPerScope?: number;
        maxDeletesPerScopePerRun?: number;
        allowScopeIds?: string[];
        denyScopeIds?: string[];
        policyPreset?: 'all' | 'parents_only' | 'exclude_children' | 'custom';
      };
    };
    tools?: ToolsConfig;
  };
};

export const DEFAULT_GATEWAY_HOST = '127.0.0.1';
export const DEFAULT_GATEWAY_PORT = 8787;

type AdminBinding = {
  host: string;
  port: number;
};

const normalizeHost = (host?: string) => {
  const trimmed = host?.trim();
  return trimmed ? trimmed : DEFAULT_GATEWAY_HOST;
};

export function resolveAdminBinding(options?: GatewayOptions['admin']): AdminBinding {
  return {
    host: normalizeHost(options?.host),
    port: options?.port ?? DEFAULT_GATEWAY_PORT,
  };
}

export async function startGateway(options: GatewayOptions) {
  const telegramConfig = options.telegram;
  if (!telegramConfig?.token) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN in environment');
  }

  const sessionStore = options.sessionStore ?? defaultSessionStore;

  const telegram = createTelegramAdapter({
    token: telegramConfig.token,
    logDir: telegramConfig.logDir,
    rootDir: telegramConfig.rootDir,
    toolsConfig: options.config?.tools,
    fileMemory: {
      enabled: options.config?.fileMemory?.enabled ?? false,
      uploadEnabled: options.config?.fileMemory?.uploadEnabled ?? false,
      maxFileSizeMb: options.config?.fileMemory?.maxFileSizeMb ?? 20,
      allowedExtensions: options.config?.fileMemory?.allowedExtensions ?? ['pdf', 'txt', 'md', 'docx', 'pptx', 'csv', 'json', 'html'],
      maxFilesPerScope: options.config?.fileMemory?.maxFilesPerScope ?? 200,
      pollIntervalMs: options.config?.fileMemory?.pollIntervalMs ?? 1500,
      includeSearchResults: options.config?.fileMemory?.includeSearchResults ?? false,
      maxNumResults: options.config?.fileMemory?.maxNumResults ?? 5,
      retention: {
        enabled: options.config?.fileMemory?.retention?.enabled ?? false,
        maxAgeDays: options.config?.fileMemory?.retention?.maxAgeDays ?? 30,
        runIntervalMinutes:
          options.config?.fileMemory?.retention?.runIntervalMinutes ?? 360,
        deleteOpenAIFiles:
          options.config?.fileMemory?.retention?.deleteOpenAIFiles ?? false,
        maxFilesPerRun:
          options.config?.fileMemory?.retention?.maxFilesPerRun ?? 25,
        dryRun: options.config?.fileMemory?.retention?.dryRun ?? false,
        keepRecentPerScope:
          options.config?.fileMemory?.retention?.keepRecentPerScope ?? 2,
        maxDeletesPerScopePerRun:
          options.config?.fileMemory?.retention?.maxDeletesPerScopePerRun ?? 10,
        allowScopeIds:
          options.config?.fileMemory?.retention?.allowScopeIds ?? [],
        denyScopeIds:
          options.config?.fileMemory?.retention?.denyScopeIds ?? [],
        policyPreset:
          options.config?.fileMemory?.retention?.policyPreset ?? 'exclude_children',
      },
    },
    deps: {
      runPrime: (input, opts) => {
        return import('../prime/prime.js').then(({ runPrime }) =>
          runPrime(input, {
            ...opts,
            toolsConfig: options.config?.tools,
            sessionStore,
          }),
        );
      },
    },
  });

  const { host: adminHost, port: adminPort } = resolveAdminBinding(options.admin);
  const haloHome = options.admin?.haloHome ?? telegramConfig.rootDir ?? process.cwd();
  const version =
    options.admin?.version ?? (await resolveVersion(haloHome));

  const semanticSync = createSemanticSyncScheduler({
    rootDir: haloHome,
    sessionStore,
    semanticConfig: options.config?.semanticMemory,
  });

  let memberRolesById: Record<string, 'parent' | 'child'> = {};
  try {
    const family = await loadFamilyConfig({ haloHome });
    memberRolesById = Object.fromEntries(
      family.members.map((member) => [member.memberId, member.role]),
    );
  } catch {
    memberRolesById = {};
  }

  const fileRetention = createFileMemoryRetentionScheduler({
    rootDir: haloHome,
    fileMemoryConfig: options.config?.fileMemory,
    memberRolesById,
  });

  const admin = await startAdminServer({
    host: adminHost,
    port: adminPort,
    haloHome,
    version,
    sessionStore,
    config: options.config,
    semanticSyncStatusProvider: semanticSync.getStatus,
    fileRetentionStatusProvider: fileRetention.getStatus,
    runFileRetentionNow: fileRetention.runNow,
    startedAtMs: options.admin?.startedAtMs,
  });

  semanticSync.start();
  fileRetention.start();

  try {
    await telegram.start();
  } finally {
    semanticSync.stop();
    fileRetention.stop();
  }

  return { telegram, admin };
}
