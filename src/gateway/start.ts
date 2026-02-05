import 'dotenv/config';

import process from 'node:process';
import path from 'node:path';
import { startGateway } from './runtime.js';
import { getHaloHome } from '../runtime/haloHome.js';
import { loadHaloConfig } from '../runtime/haloConfig.js';
import { reportStartupError } from '../runtime/startupErrors.js';
import { SessionStore } from '../sessions/sessionStore.js';

// Durable runtime state should live outside the repo.
const haloHome = getHaloHome(process.env);

// Allow overrides, but default to HALO_HOME/logs.
const logDir = process.env.LOG_DIR || path.join(haloHome, 'logs');

const start = async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN in environment');
  }

  const haloConfig = await loadHaloConfig(process.env);

  const adminHost = haloConfig.gateway.host;
  const adminPort = haloConfig.gateway.port;

  const sessionStore = new SessionStore({
    // Canonical settings come from HALO_HOME/config.json
    compactionEnabled: haloConfig.features.compactionEnabled,
    distillationEnabled: haloConfig.features.distillationEnabled,
    distillationMode: haloConfig.memory.distillationMode,
    distillationEveryNItems: haloConfig.memory.distillationEveryNItems,
    distillationMaxItems: haloConfig.memory.distillationMaxItems,
    rootDir: haloHome,
    baseDir: path.join(haloHome, 'sessions'),
    transcriptsDir: path.join(haloHome, 'transcripts'),
  });

  if (!Number.isFinite(adminPort)) {
    throw new Error('Invalid gateway.port in HALO_HOME/config.json');
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
    sessionStore,
    config: {
      schemaVersion: haloConfig.schemaVersion,
      gateway: haloConfig.gateway,
      features: haloConfig.features,
      memory: haloConfig.memory,
      childSafe: haloConfig.childSafe,
      semanticMemory: haloConfig.semanticMemory,
    },
  });
};

start().catch((err) => {
  reportStartupError(err, { mode: 'gateway', haloHome, logDir });
  process.exit(1);
});
