import { createTelegramAdapter } from '../interfaces/telegram/bot.js';
import { resolveVersion, startAdminServer } from './admin.js';
import { defaultSessionStore, SessionStore } from '../sessions/sessionStore.js';
import { createSemanticSyncScheduler } from '../memory/semanticSyncScheduler.js';

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
    deps: {
      runPrime: (input, opts) => {
        return import('../prime/prime.js').then(({ runPrime }) =>
          runPrime(input, {
            ...opts,
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

  const admin = await startAdminServer({
    host: adminHost,
    port: adminPort,
    haloHome,
    version,
    sessionStore,
    config: options.config,
    semanticSyncStatusProvider: semanticSync.getStatus,
    startedAtMs: options.admin?.startedAtMs,
  });

  semanticSync.start();

  try {
    await telegram.start();
  } finally {
    semanticSync.stop();
  }

  return { telegram, admin };
}
