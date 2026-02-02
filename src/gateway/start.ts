import 'dotenv/config';

import process from 'node:process';
import { startGateway } from './runtime.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN in environment');
}

const logDir = process.env.LOG_DIR || 'logs';
const haloHome = process.env.HALO_HOME || process.cwd();
const adminHost = process.env.GATEWAY_HOST || '127.0.0.1';
const adminPortRaw = process.env.GATEWAY_PORT || '8787';
const adminPort = Number.parseInt(adminPortRaw, 10);

if (!Number.isFinite(adminPort)) {
  throw new Error('Invalid GATEWAY_PORT in environment');
}

console.log('halo (gateway) starting…');
await startGateway({
  telegram: {
    token,
    logDir,
    rootDir: haloHome,
  },
  admin: {
    host: adminHost,
    port: adminPort,
    haloHome,
  },
});
