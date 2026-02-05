import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHaloHome } from '../runtime/haloHome.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const haloHome = getHaloHome(process.env);
const force = process.argv.includes('--force');

const exampleHaloPath = path.join(repoRoot, 'config', 'halo.example.json');
const exampleFamilyPath = path.join(repoRoot, 'config', 'family.example.json');

const targetHaloPath = path.join(haloHome, 'config.json');
const targetFamilyPath = path.join(haloHome, 'config', 'family.json');

const exists = async (target: string): Promise<boolean> => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

const copyIfMissing = async (source: string, target: string): Promise<boolean> => {
  const already = await exists(target);
  if (already && !force) return false;

  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  return true;
};

const created: string[] = [];

if (await copyIfMissing(exampleHaloPath, targetHaloPath)) {
  created.push(targetHaloPath);
}

if (await copyIfMissing(exampleFamilyPath, targetFamilyPath)) {
  created.push(targetFamilyPath);
}

if (created.length === 0) {
  console.log('Config files already exist. Nothing to do.');
  console.log(`HALO_HOME=${haloHome}`);
  console.log('Use --force to overwrite with example configs.');
  process.exit(0);
}

console.log('Created config files:');
created.forEach((file) => console.log(`- ${file}`));
console.log(`HALO_HOME=${haloHome}`);
console.log('Edit the files with your family members and bot token before starting.');
console.log('If you want the repo defaults, copy SOUL.md and USER.md into HALO_HOME.');
