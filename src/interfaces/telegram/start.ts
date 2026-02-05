import 'dotenv/config';

import process from 'node:process';
import path from 'node:path';
import { createTelegramAdapter } from './bot.js';
import { getHaloHome } from '../../runtime/haloHome.js';
import { reportStartupError } from '../../runtime/startupErrors.js';

const haloHome = getHaloHome(process.env);
const logDir = process.env.LOG_DIR || path.join(haloHome, 'logs');
const rootDir = haloHome;

const start = async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN in environment');
  }

  const adapter = createTelegramAdapter({ token, logDir, rootDir, haloHome });

  console.log('halo (telegram) starting…');
  await adapter.start();
};

start().catch((err) => {
  reportStartupError(err, { mode: 'telegram', haloHome, logDir });
  process.exit(1);
});
