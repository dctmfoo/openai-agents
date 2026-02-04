import { Agent, run } from '@openai/agents';
import type { AgentInputItem } from '@openai/agents';
import { z } from 'zod';

import type { DistilledMemory } from './distiller.js';

export const llmDistillerDeps = { run };

const DistilledMemorySchema = z.object({
  durableFacts: z.array(z.string()).default([]),
  temporalNotes: z.array(z.string()).default([]),
});

const distillerAgent = new Agent({
  name: 'MemoryDistiller',
  instructions: [
    'You are a memory distillation assistant.',
    'Extract durable facts and temporal notes from the user transcript.',
    'Durable facts should be stable preferences, identity, relationships, and long-lived details.',
    'Temporal notes should be time-bound updates, daily events, or transient context.',
    'Return ONLY the structured output matching the schema.',
  ].join('\n'),
  outputType: DistilledMemorySchema,
});

const normalizeLine = (line: string) => line.trim().replace(/\s+/g, ' ').toLowerCase();

function uniq(lines: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const clean = line.trim().replace(/\s+/g, ' ');
    if (!clean) continue;
    const key = normalizeLine(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function extractUserText(item: AgentInputItem): string[] {
  if (item.type !== 'message') return [];
  if (item.role !== 'user') return [];

  const parts = item.content ?? [];
  const texts: string[] = [];
  for (const p of parts as any[]) {
    if (typeof p === 'string') {
      texts.push(p);
      continue;
    }
    if (p && typeof p === 'object' && p.type === 'input_text' && typeof p.text === 'string') {
      texts.push(p.text);
    }
  }
  return texts;
}

export async function distillMemoryFromItemsLLM(items: AgentInputItem[]): Promise<DistilledMemory> {
  const userTexts = items.flatMap(extractUserText).map((t) => t.trim()).filter(Boolean);

  if (userTexts.length === 0) {
    return { durableFacts: [], temporalNotes: [] };
  }

  const input = userTexts.join('\n');
  const result = await llmDistillerDeps.run(distillerAgent, input);
  const output = result.finalOutput ?? { durableFacts: [], temporalNotes: [] };

  const durableFacts = uniq(Array.isArray(output.durableFacts) ? output.durableFacts : []);
  const temporalNotes = uniq(Array.isArray(output.temporalNotes) ? output.temporalNotes : []);

  return { durableFacts, temporalNotes };
}
