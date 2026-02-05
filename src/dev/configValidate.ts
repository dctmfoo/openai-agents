import { loadHaloConfig } from '../runtime/haloConfig.js';
import { loadFamilyConfig } from '../runtime/familyConfig.js';
import { getHaloHome } from '../runtime/haloHome.js';

const haloHome = getHaloHome(process.env);
const errors: string[] = [];

try {
  await loadHaloConfig(process.env);
  console.log(`OK: ${haloHome}/config.json`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  errors.push(`config.json: ${message}`);
}

try {
  await loadFamilyConfig({ haloHome });
  console.log(`OK: ${haloHome}/config/family.json`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  errors.push(`config/family.json: ${message}`);
}

if (errors.length > 0) {
  console.error('Config validation failed:');
  errors.forEach((message) => console.error(`- ${message}`));
  console.error('Run `pnpm halo:config:init` to generate example configs.');
  process.exit(1);
}

console.log('All config files look valid.');
