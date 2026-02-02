import 'dotenv/config';

import { runPrime } from '../../prime/prime.js';

const input = process.argv.slice(2).join(' ').trim();
if (!input) {
  console.error('Usage: pnpm dev:cli "your message"');
  process.exit(1);
}

const result = await runPrime(input, { channel: 'cli', userId: 'local' });
console.log(result.finalOutput);
