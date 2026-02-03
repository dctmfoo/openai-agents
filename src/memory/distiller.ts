import type { AgentInputItem } from '@openai/agents';

export type DistilledMemory = {
  durableFacts: string[];
  temporalNotes: string[];
};

const normalizeLine = (line: string) => line.trim().replace(/\s+/g, ' ');

function uniq(lines: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = normalizeLine(line);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line.trim());
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
      // Some SDK types allow plain strings in content arrays.
      texts.push(p);
      continue;
    }
    if (p && typeof p === 'object' && p.type === 'input_text' && typeof p.text === 'string') {
      texts.push(p.text);
    }
  }
  return texts;
}

// Very small, deterministic heuristic set (no model calls).
// The goal is: start safe, be testable, and avoid cross-scope leakage.
export function distillMemoryFromItems(items: AgentInputItem[]): DistilledMemory {
  const durableFacts: string[] = [];
  const temporalNotes: string[] = [];

  for (const item of items) {
    for (const text of extractUserText(item)) {
      const t = text.trim();
      if (!t) continue;

      // Durable facts: explicit “remember” / “my … is …” style.
      // Keep it conservative and short.
      const rememberMatch = t.match(/^(remember|note)\b[:\s-]*(.+)$/i);
      if (rememberMatch?.[2]) {
        durableFacts.push(rememberMatch[2].trim());
        continue;
      }

      const myIsMatch = t.match(/^my\s+([a-z][a-z0-9_\s-]{0,40})\s+is\s+(.{1,80})$/i);
      if (myIsMatch) {
        const key = myIsMatch[1].trim();
        const val = myIsMatch[2].trim();
        durableFacts.push(`${key}: ${val}`);
        continue;
      }

      // Temporal notes: small check-ins (today/tomorrow) or anything else.
      // Keep for daily log by default.
      temporalNotes.push(t);
    }
  }

  return {
    durableFacts: uniq(durableFacts),
    temporalNotes: uniq(temporalNotes),
  };
}
