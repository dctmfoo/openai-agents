import 'dotenv/config';

import process from 'node:process';
import path from 'node:path';
import { createTelegramAdapter } from './bot.js';
import { getHaloHome } from '../../runtime/haloHome.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN in environment');
}

const haloHome = getHaloHome(process.env);
const logDir = process.env.LOG_DIR || path.join(haloHome, 'logs');
const rootDir = haloHome;

const adapter = createTelegramAdapter({ token, logDir, rootDir, haloHome });

console.log('halo (telegram) starting…');
await adapter.start();
