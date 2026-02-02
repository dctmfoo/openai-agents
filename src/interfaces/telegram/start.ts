import 'dotenv/config';

import process from 'node:process';
import { createTelegramAdapter } from './bot.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN in environment');
}

const logDir = process.env.LOG_DIR || 'logs';
const rootDir = process.cwd();

const adapter = createTelegramAdapter({ token, logDir, rootDir });

console.log('halo (telegram) starting…');
await adapter.start();
