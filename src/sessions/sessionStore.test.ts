import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from './sessionStore.js';
import type { AgentInputItem } from '@openai/agents';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const userMessage = (text: string) =>
  ({
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text }],
  }) satisfies AgentInputItem;

describe('SessionStore', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'session-store-'));
  });

  afterEach(async () => {
    if (!tempDir) return;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns the same session instance for the same scopeId', async () => {
    const store = new SessionStore({ baseDir: tempDir });

    const a1 = store.getOrCreate('scope-a');
    const a2 = store.getOrCreate('scope-a');

    expect(a1).toBe(a2);
  });

  it('isolates history across different scopeIds', async () => {
    const store = new SessionStore({ baseDir: tempDir });

    const s1 = store.getOrCreate('scope-1');
    const s2 = store.getOrCreate('scope-2');

    await s1.addItems([
      userMessage('hello'),
    ]);

    const items1 = await s1.getItems();
    const items2 = await s2.getItems();

    expect(items1.length).toBe(1);
    expect(items2.length).toBe(0);
  });

  it('can clear a scope session without affecting others', async () => {
    const store = new SessionStore({ baseDir: tempDir });

    const s1 = store.getOrCreate('scope-1');
    const s2 = store.getOrCreate('scope-2');

    await s1.addItems([
      userMessage('x'),
    ]);
    await s2.addItems([
      userMessage('y'),
    ]);

    await store.clear('scope-1');

    expect((await s1.getItems()).length).toBe(0);
    expect((await s2.getItems()).length).toBe(1);
  });

  it('reloads history when a new store is created', async () => {
    const store1 = new SessionStore({ baseDir: tempDir });
    const session1 = store1.getOrCreate('scope-persist');
    await session1.addItems([userMessage('persist me')]);

    const store2 = new SessionStore({ baseDir: tempDir });
    const session2 = store2.getOrCreate('scope-persist');

    expect(await session2.getItems()).toEqual([userMessage('persist me')]);
  });
});
