import 'dotenv/config';

import process from 'node:process';
import { runPrime } from '../../prime/prime.js';
import { appendDailyNote } from '../../memory/memoryFiles.js';
import { getHaloHome } from '../../runtime/haloHome.js';

const input = process.argv.slice(2).join(' ').trim();
if (!input) {
  console.error('Usage: pnpm dev:cli "your message"');
  process.exit(1);
}

const rootDir = getHaloHome(process.env);

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
