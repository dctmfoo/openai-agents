import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Root directory for Halo runtime state (sessions, memory, logs, config).
 *
 * Mirrors the OpenClaw convention of keeping durable state out of the repo.
 */
export function getHaloHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.HALO_HOME?.trim();
  if (override) return override;
  return path.join(homedir(), '.halo');
}
