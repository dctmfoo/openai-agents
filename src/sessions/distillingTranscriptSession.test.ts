import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SessionStore } from './sessionStore.js';
import { getScopedLongTermPath } from '../memory/scopedMemory.js';
import type { AgentInputItem } from '@openai/agents';
import { distillationDeps } from './distillingTranscriptSession.js';

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

  it('backs off after failure and retries after the window elapses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-04T00:00:00Z'));

    const originalDistill = distillationDeps.runDeterministicDistillation;
    const spy = vi.fn().mockRejectedValue(new Error('boom'));
    distillationDeps.runDeterministicDistillation = spy;

    try {
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

      // First attempt fails -> backoff starts.
      await session.addItems([userMessage('remember: x')]);
      const r1 = (session as any).running as Promise<void> | null;
      if (r1) await r1;
      expect(spy).toHaveBeenCalledTimes(1);

      // Another message within 30s backoff should not attempt again.
      await session.addItems([userMessage('remember: y')]);
      const r2 = (session as any).running as Promise<void> | null;
      if (r2) await r2;
      expect(spy).toHaveBeenCalledTimes(1);

      // After 30s elapses, the next trigger should attempt again.
      await vi.advanceTimersByTimeAsync(30_000);
      await session.addItems([userMessage('remember: z')]);
      const r3 = (session as any).running as Promise<void> | null;
      if (r3) await r3;
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      distillationDeps.runDeterministicDistillation = originalDistill;
      vi.useRealTimers();
    }
  });
});
