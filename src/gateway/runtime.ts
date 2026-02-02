import { createTelegramAdapter } from '../interfaces/telegram/bot.js';

export type GatewayOptions = {
  telegram?: {
    token?: string;
    logDir?: string;
    rootDir?: string;
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

  await telegram.start();

  return { telegram };
}
