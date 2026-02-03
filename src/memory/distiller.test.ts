import { describe, expect, it } from 'vitest';
import type { AgentInputItem } from '@openai/agents';

import { distillMemoryFromItems } from './distiller.js';

const user = (text: string): AgentInputItem => ({
  type: 'message',
  role: 'user',
  content: [{ type: 'input_text', text }],
});

const assistant = (text: string): AgentInputItem => ({
  type: 'message',
  role: 'assistant',
  content: [{ type: 'output_text', text }],
} as any);

describe('distiller (deterministic)', () => {
  it('extracts explicit remember/note lines as durable facts', () => {
    const out = distillMemoryFromItems([
      user('remember: I like black coffee'),
      user('note - preferred language is TypeScript'),
      assistant('ok'),
    ]);

    expect(out.durableFacts).toEqual([
      'I like black coffee',
      'preferred language is TypeScript',
    ]);
    expect(out.temporalNotes).toEqual([]);
  });

  it('extracts simple “my X is Y” into key/value durable facts', () => {
    const out = distillMemoryFromItems([
      user('my timezone is Asia/Calcutta'),
      user('my favorite editor is VS Code'),
    ]);

    expect(out.durableFacts).toEqual([
      'timezone: Asia/Calcutta',
      'favorite editor: VS Code',
    ]);
  });

  it('dedupes identical facts and keeps other content as temporal notes', () => {
    const out = distillMemoryFromItems([
      user('remember: I like black coffee'),
      user('remember: I like black coffee'),
      user('today I feel great'),
      user('today I feel great'),
    ]);

    expect(out.durableFacts).toEqual(['I like black coffee']);
    expect(out.temporalNotes).toEqual(['today I feel great']);
  });
});
