import { describe, expect, it } from 'vitest';
import { SessionStore } from './sessionStore.js';

describe('SessionStore', () => {
  it('returns the same session instance for the same scopeId', async () => {
    const store = new SessionStore();

    const a1 = store.getOrCreate('scope-a');
    const a2 = store.getOrCreate('scope-a');

    expect(a1).toBe(a2);
  });

  it('isolates history across different scopeIds', async () => {
    const store = new SessionStore();

    const s1 = store.getOrCreate('scope-1');
    const s2 = store.getOrCreate('scope-2');

    await s1.addItems([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
      },
    ]);

    const items1 = await s1.getItems();
    const items2 = await s2.getItems();

    expect(items1.length).toBe(1);
    expect(items2.length).toBe(0);
  });

  it('can clear a scope session without affecting others', async () => {
    const store = new SessionStore();

    const s1 = store.getOrCreate('scope-1');
    const s2 = store.getOrCreate('scope-2');

    await s1.addItems([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'x' }],
      },
    ]);
    await s2.addItems([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'y' }],
      },
    ]);

    await store.clear('scope-1');

    expect((await s1.getItems()).length).toBe(0);
    expect((await s2.getItems()).length).toBe(1);
  });
});
