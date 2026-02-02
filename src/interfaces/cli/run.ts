import 'dotenv/config';

import process from 'node:process';
import { runPrime } from '../../prime/prime.js';
import { appendDailyNote } from '../../memory/openclawMemory.js';

const input = process.argv.slice(2).join(' ').trim();
if (!input) {
  console.error('Usage: pnpm dev:cli "your message"');
  process.exit(1);
}

const result = await runPrime(input, { channel: 'cli', userId: 'local' });

// Remember everything (raw transcript) in daily memory.
await appendDailyNote({ rootDir: process.cwd() }, `[user] ${input}`);
await appendDailyNote(
  { rootDir: process.cwd() },
  `[prime] ${String(result.finalOutput ?? '').trim() || '(no output)'}`,
);

console.log(result.finalOutput);
