import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from './sessionStore.js';
import { TranscriptStore } from './transcriptStore.js';
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
    const store = new SessionStore({
      baseDir: path.join(tempDir, 'sessions'),
      transcriptsDir: path.join(tempDir, 'transcripts'),
      compactionEnabled: false,
    });

    const a1 = store.getOrCreate('scope-a');
    const a2 = store.getOrCreate('scope-a');

    expect(a1).toBe(a2);
  });

  it('isolates history across different scopeIds', async () => {
    const store = new SessionStore({
      baseDir: path.join(tempDir, 'sessions'),
      transcriptsDir: path.join(tempDir, 'transcripts'),
      compactionEnabled: false,
    });

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
    const store = new SessionStore({
      baseDir: path.join(tempDir, 'sessions'),
      transcriptsDir: path.join(tempDir, 'transcripts'),
      compactionEnabled: false,
    });

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
    const store1 = new SessionStore({
      baseDir: path.join(tempDir, 'sessions'),
      transcriptsDir: path.join(tempDir, 'transcripts'),
      compactionEnabled: false,
    });
    const session1 = store1.getOrCreate('scope-persist');
    await session1.addItems([userMessage('persist me')]);

    const store2 = new SessionStore({
      baseDir: path.join(tempDir, 'sessions'),
      transcriptsDir: path.join(tempDir, 'transcripts'),
      compactionEnabled: false,
    });
    const session2 = store2.getOrCreate('scope-persist');

    expect(await session2.getItems()).toEqual([userMessage('persist me')]);
  });

  it('appends to the transcript without overwriting earlier entries', async () => {
    const transcriptsDir = path.join(tempDir, 'transcripts');
    const store = new SessionStore({
      baseDir: path.join(tempDir, 'sessions'),
      transcriptsDir,
      compactionEnabled: false,
    });

    const session = store.getOrCreate('scope-transcript');
    await session.addItems([userMessage('first')]);
    await session.addItems([userMessage('second')]);

    const transcript = new TranscriptStore({
      sessionId: 'scope-transcript',
      baseDir: transcriptsDir,
    });

    expect(await transcript.getItems()).toEqual([
      userMessage('first'),
      userMessage('second'),
    ]);
  });

  it('clears derived state without deleting transcript history', async () => {
    const transcriptsDir = path.join(tempDir, 'transcripts');
    const store = new SessionStore({
      baseDir: path.join(tempDir, 'sessions'),
      transcriptsDir,
      compactionEnabled: false,
    });

    const session = store.getOrCreate('scope-clear-transcript');
    await session.addItems([userMessage('hello')]);
    await store.clear('scope-clear-transcript');

    expect(await session.getItems()).toEqual([]);

    const transcript = new TranscriptStore({
      sessionId: 'scope-clear-transcript',
      baseDir: transcriptsDir,
    });

    expect(await transcript.getItems()).toEqual([userMessage('hello')]);
  });
});
