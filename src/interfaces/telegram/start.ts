import 'dotenv/config';

import process from 'node:process';
import path from 'node:path';
import { createTelegramAdapter } from './bot.js';
import { getHaloHome } from '../../runtime/haloHome.js';
import { loadHaloConfig } from '../../runtime/haloConfig.js';
import { reportStartupError } from '../../runtime/startupErrors.js';
import { SessionStore } from '../../sessions/sessionStore.js';
import { createSemanticSyncScheduler } from '../../memory/semanticSyncScheduler.js';

const haloHome = getHaloHome(process.env);
const logDir = process.env.LOG_DIR || path.join(haloHome, 'logs');
const rootDir = haloHome;

const start = async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN in environment');
  }

  const haloConfig = await loadHaloConfig(process.env);

  const sessionStore = new SessionStore({
    compactionEnabled: haloConfig.features.compactionEnabled,
    distillationEnabled: haloConfig.features.distillationEnabled,
    distillationMode: haloConfig.memory.distillationMode,
    distillationEveryNItems: haloConfig.memory.distillationEveryNItems,
    distillationMaxItems: haloConfig.memory.distillationMaxItems,
    rootDir: haloHome,
    baseDir: path.join(haloHome, 'sessions'),
    transcriptsDir: path.join(haloHome, 'transcripts'),
  });

  const semanticSync = createSemanticSyncScheduler({
    rootDir: haloHome,
    sessionStore,
    semanticConfig: haloConfig.semanticMemory,
  });

  const adapter = createTelegramAdapter({
    token,
    logDir,
    rootDir,
    haloHome,
    deps: {
      runPrime: (input, opts) => {
        return import('../../prime/prime.js').then(({ runPrime }) =>
          runPrime(input, {
            ...opts,
            sessionStore,
          }),
        );
      },
    },
  });

  semanticSync.start();

  console.log('halo (telegram) starting…');
  try {
    await adapter.start();
  } finally {
    semanticSync.stop();
  }
};

start().catch((err) => {
  reportStartupError(err, { mode: 'telegram', haloHome, logDir });
  process.exit(1);
});
