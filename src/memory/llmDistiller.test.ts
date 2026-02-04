import { describe, expect, it, vi } from 'vitest';
import type { AgentInputItem } from '@openai/agents';

import { distillMemoryFromItemsLLM, llmDistillerDeps } from './llmDistiller.js';

const user = (text: string): AgentInputItem => ({
  type: 'message',
  role: 'user',
  content: [{ type: 'input_text', text }],
});

const assistant = (text: string): AgentInputItem =>
  ({
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text }],
  }) as AgentInputItem;

describe('llm distiller', () => {
  it('returns structured output from the model', async () => {
    const originalRun = llmDistillerDeps.run;
    const spy = vi.fn().mockResolvedValue({
      finalOutput: {
        durableFacts: ['likes tea'],
        temporalNotes: ['felt tired today'],
      },
    });
    llmDistillerDeps.run = spy;

    try {
      const out = await distillMemoryFromItemsLLM([
        user('I like tea.'),
        user('Today I felt tired.'),
      ]);

      expect(out.durableFacts).toEqual(['likes tea']);
      expect(out.temporalNotes).toEqual(['felt tired today']);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      llmDistillerDeps.run = originalRun;
    }
  });

  it('dedupes and trims model output', async () => {
    const originalRun = llmDistillerDeps.run;
    const spy = vi.fn().mockResolvedValue({
      finalOutput: {
        durableFacts: ['  Loves coffee  ', 'loves coffee', ''],
        temporalNotes: ['  went to the park  ', 'went to the park'],
      },
    });
    llmDistillerDeps.run = spy;

    try {
      const out = await distillMemoryFromItemsLLM([user('anything')]);

      expect(out.durableFacts).toEqual(['Loves coffee']);
      expect(out.temporalNotes).toEqual(['went to the park']);
    } finally {
      llmDistillerDeps.run = originalRun;
    }
  });

  it('skips the model call when there is no user text', async () => {
    const originalRun = llmDistillerDeps.run;
    const spy = vi.fn();
    llmDistillerDeps.run = spy;

    try {
      const out = await distillMemoryFromItemsLLM([
        assistant('hello'),
        assistant('still here'),
      ]);

      expect(out.durableFacts).toEqual([]);
      expect(out.temporalNotes).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      llmDistillerDeps.run = originalRun;
    }
  });

  it('only passes user text to the model prompt', async () => {
    const originalRun = llmDistillerDeps.run;
    const spy = vi.fn().mockResolvedValue({
      finalOutput: { durableFacts: [], temporalNotes: [] },
    });
    llmDistillerDeps.run = spy;

    try {
      await distillMemoryFromItemsLLM([
        user('I live in Lisbon.'),
        assistant('Acknowledged.'),
      ]);

      expect(spy).toHaveBeenCalledTimes(1);
      const input = spy.mock.calls[0]?.[1];
      expect(typeof input).toBe('string');
      expect(input).toContain('I live in Lisbon.');
      expect(input).not.toContain('Acknowledged.');
    } finally {
      llmDistillerDeps.run = originalRun;
    }
  });
});
