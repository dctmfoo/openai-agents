import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { getScopedLongTermPath, type ScopedMemoryPaths } from './scopedMemory.js';

function normalize(line: string): string {
  return line.trim().replace(/^[-*]\s+/, '').trim().toLowerCase();
}

/**
 * Append durable facts to the per-scope MEMORY.md, deduping by normalized content.
 *
 * Format is intentionally simple (bullets) so it stays deterministic and human-editable.
 */
export async function appendScopedLongTermFacts(
  paths: ScopedMemoryPaths,
  facts: string[],
): Promise<string> {
  const filePath = getScopedLongTermPath(paths);

  await mkdir(filePath.split('/').slice(0, -1).join('/'), { recursive: true });

  const existing = existsSync(filePath) ? await readFile(filePath, 'utf8') : '';
  const existingLines = existing.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const seen = new Set(existingLines.map(normalize));

  const toAppend: string[] = [];
  for (const fact of facts) {
    const clean = fact.trim();
    if (!clean) continue;
    const key = normalize(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    toAppend.push(`- ${clean}`);
  }

  if (!existsSync(filePath)) {
    await appendFile(filePath, '# MEMORY\n\n', 'utf8');
  }

  if (toAppend.length > 0) {
    await appendFile(filePath, toAppend.join('\n') + '\n', 'utf8');
  }

  return filePath;
}
