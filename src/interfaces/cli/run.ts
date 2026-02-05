import 'dotenv/config';

import process from 'node:process';
import path from 'node:path';
import { runPrime } from '../../prime/prime.js';
import { appendDailyNote } from '../../memory/memoryFiles.js';
import { getHaloHome } from '../../runtime/haloHome.js';
import { reportStartupError } from '../../runtime/startupErrors.js';

const input = process.argv.slice(2).join(' ').trim();
if (!input) {
  console.error('Usage: pnpm dev:cli "your message"');
  process.exit(1);
}

const rootDir = getHaloHome(process.env);
const logDir = process.env.LOG_DIR || path.join(rootDir, 'logs');

const start = async () => {
  const result = await runPrime(input, {
    channel: 'cli',
    userId: 'local',
    role: 'parent',
    scopeType: 'dm',
    rootDir,
  });

  // Remember everything (raw transcript) in daily memory.
  await appendDailyNote({ rootDir }, `[user] ${input}`);
  await appendDailyNote(
    { rootDir },
    `[prime] ${String(result.finalOutput ?? '').trim() || '(no output)'}`,
  );

  console.log(result.finalOutput);
};

start().catch((err) => {
  reportStartupError(err, { mode: 'cli', haloHome: rootDir, logDir });
  process.exit(1);
});
