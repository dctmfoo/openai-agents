import { createTelegramAdapter } from '../interfaces/telegram/bot.js';
import { resolveVersion, startAdminServer } from './admin.js';
import { defaultSessionStore, SessionStore } from '../sessions/sessionStore.js';

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

  const admin = await startAdminServer({
    host: adminHost,
    port: adminPort,
    haloHome,
    version,
    sessionStore,
    config: options.config,
    startedAtMs: options.admin?.startedAtMs,
  });

  await telegram.start();

  return { telegram, admin };
}
