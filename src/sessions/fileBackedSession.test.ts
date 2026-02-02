import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileBackedSession } from './fileBackedSession.js';
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

describe('FileBackedSession', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'file-backed-session-'));
  });

  afterEach(async () => {
    if (!tempDir) return;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('persists items across restarts', async () => {
    const session1 = new FileBackedSession({
      sessionId: 'scope-persist',
      baseDir: tempDir,
    });

    await session1.addItems([userMessage('hello')]);

    const session2 = new FileBackedSession({
      sessionId: 'scope-persist',
      baseDir: tempDir,
    });

    expect(await session2.getItems()).toEqual([userMessage('hello')]);
  });

  it('popItem removes the latest item and persists', async () => {
    const session = new FileBackedSession({
      sessionId: 'scope-pop',
      baseDir: tempDir,
    });

    const firstItem = userMessage('first');
    const secondItem = userMessage('second');

    await session.addItems([firstItem, secondItem]);

    expect(await session.popItem()).toEqual(secondItem);
    expect(await session.getItems()).toEqual([firstItem]);

    const reloaded = new FileBackedSession({
      sessionId: 'scope-pop',
      baseDir: tempDir,
    });

    expect(await reloaded.getItems()).toEqual([firstItem]);
  });

  it('clearSession removes stored items', async () => {
    const session = new FileBackedSession({
      sessionId: 'scope-clear',
      baseDir: tempDir,
    });

    await session.addItems([userMessage('hello')]);
    await session.clearSession();

    expect(await session.getItems()).toEqual([]);

    const reloaded = new FileBackedSession({
      sessionId: 'scope-clear',
      baseDir: tempDir,
    });

    expect(await reloaded.getItems()).toEqual([]);
  });
});
