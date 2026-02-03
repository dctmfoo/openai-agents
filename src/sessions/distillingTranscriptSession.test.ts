import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SessionStore } from './sessionStore.js';
import { getScopedLongTermPath } from '../memory/scopedMemory.js';
import type { AgentInputItem } from '@openai/agents';

const userMessage = (text: string) =>
  ({
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text }],
  }) satisfies AgentInputItem;

describe('distillation trigger wiring', () => {
  it('runs deterministic distillation and writes scoped MEMORY.md when enabled', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'halo-distill-'));

    const store = new SessionStore({
      baseDir: path.join(rootDir, 'sessions'),
      transcriptsDir: path.join(rootDir, 'transcripts'),
      compactionEnabled: false,
      distillationEnabled: true,
      distillationEveryNItems: 1,
      distillationMaxItems: 50,
      rootDir,
    });

    const scopeId = 'telegram:dm:wags';
    const session = store.getOrCreate(scopeId);

    await session.addItems([userMessage('remember: I like black coffee')]);

    // Wait a tiny bit for the async distillation chain to run.
    await new Promise((r) => setTimeout(r, 20));

    const memPath = getScopedLongTermPath({ rootDir, scopeId });
    const content = await readFile(memPath, 'utf8');
    expect(content).toContain('I like black coffee');
  });
});
