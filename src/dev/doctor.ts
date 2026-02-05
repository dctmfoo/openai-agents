import { access, mkdir } from 'node:fs/promises';
import { constants as fsConstants, existsSync } from 'node:fs';
import path from 'node:path';

import { loadHaloConfig, type HaloConfig } from '../runtime/haloConfig.js';
import { loadFamilyConfig } from '../runtime/familyConfig.js';
import { getHaloHome } from '../runtime/haloHome.js';

type CheckStatus = 'OK' | 'WARN' | 'FAIL';

type CheckResult = {
  status: CheckStatus;
  label: string;
  details?: string;
};

const results: CheckResult[] = [];
const failures: CheckResult[] = [];

const addResult = (status: CheckStatus, label: string, details?: string) => {
  const entry = { status, label, details };
  results.push(entry);
  if (status === 'FAIL') {
    failures.push(entry);
  }
};

const formatDetails = (details?: string) => (details ? ` — ${details}` : '');

const haloHome = getHaloHome(process.env);

console.log('halo doctor (preflight)');
console.log(`HALO_HOME: ${haloHome}`);

const openAiKey = process.env.OPENAI_API_KEY?.trim();
addResult(
  openAiKey ? 'OK' : 'FAIL',
  'env OPENAI_API_KEY',
  openAiKey ? 'set' : 'missing (required for model calls)',
);

const telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
addResult(
  telegramToken ? 'OK' : 'WARN',
  'env TELEGRAM_BOT_TOKEN',
  telegramToken ? 'set' : 'missing (required for dev:telegram/start:gateway)',
);

let haloConfig: HaloConfig | null = null;
try {
  haloConfig = await loadHaloConfig(process.env);
  addResult('OK', 'config.json', path.join(haloHome, 'config.json'));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  addResult('FAIL', 'config.json', message);
}

try {
  await loadFamilyConfig({ haloHome });
  addResult('OK', 'config/family.json', path.join(haloHome, 'config', 'family.json'));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  addResult('FAIL', 'config/family.json', message);
}

if (haloConfig) {
  const semantic = haloConfig.semanticMemory;
  if (!semantic.enabled) {
    addResult('OK', 'semantic memory', 'disabled in config');
  } else {
    const vecPath = semantic.vecExtensionPath;
    if (!vecPath) {
      addResult(
        'FAIL',
        'semantic memory vec extension',
        'missing (set SQLITE_VEC_EXT or semanticMemory.vecExtensionPath)',
      );
    } else if (!existsSync(vecPath)) {
      addResult('FAIL', 'semantic memory vec extension', `path not found: ${vecPath}`);
    } else {
      addResult('OK', 'semantic memory vec extension', vecPath);
    }
  }
} else {
  addResult('FAIL', 'semantic memory', 'skipped (config.json failed validation)');
}

try {
  await mkdir(haloHome, { recursive: true });
  await access(haloHome, fsConstants.W_OK);
  addResult('OK', 'HALO_HOME writable', haloHome);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  addResult('FAIL', 'HALO_HOME writable', message);
}

for (const result of results) {
  console.log(`[${result.status}] ${result.label}${formatDetails(result.details)}`);
}

if (failures.length > 0) {
  console.error('Doctor found blocking issues. Fix the failures above and re-run `pnpm doctor`.');
  process.exit(1);
}

console.log('Doctor finished with no blocking issues.');
