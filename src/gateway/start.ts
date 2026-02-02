import 'dotenv/config';

import process from 'node:process';
import { startGateway } from './runtime.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN in environment');
}

const logDir = process.env.LOG_DIR || 'logs';
const rootDir = process.cwd();

console.log('halo (gateway) starting…');
await startGateway({
  telegram: {
    token,
    logDir,
    rootDir,
  },
});
