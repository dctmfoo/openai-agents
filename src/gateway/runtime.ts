import { createTelegramAdapter } from '../interfaces/telegram/bot.js';
import { resolveVersion, startAdminServer } from './admin.js';

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
};

export async function startGateway(options: GatewayOptions) {
  const telegramConfig = options.telegram;
  if (!telegramConfig?.token) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN in environment');
  }

  const telegram = createTelegramAdapter({
    token: telegramConfig.token,
    logDir: telegramConfig.logDir,
    rootDir: telegramConfig.rootDir,
  });

  const adminHost = options.admin?.host ?? '127.0.0.1';
  const adminPort = options.admin?.port ?? 8787;
  const haloHome = options.admin?.haloHome ?? telegramConfig.rootDir ?? process.cwd();
  const version =
    options.admin?.version ?? (await resolveVersion(haloHome));

  const admin = await startAdminServer({
    host: adminHost,
    port: adminPort,
    haloHome,
    version,
    startedAtMs: options.admin?.startedAtMs,
  });

  await telegram.start();

  return { telegram, admin };
}
