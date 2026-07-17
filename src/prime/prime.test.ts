import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPrimeInstructions, resolvePrimeModel } from './prime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('buildPrimeInstructions', () => {
  it('adds child-tier instructions for child age group', () => {
    const instructions = buildPrimeInstructions({
      role: 'child',
      ageGroup: 'child',
      toolInstructions: [],
      contextBlock: '---\nContext\n---',
    });

    expect(instructions).toContain('Use simple vocabulary with short sentences.');
    expect(instructions).toContain('Keep the tone encouraging, educational, and fun.');
    expect(instructions).toContain(
      "Never share information from other family members' private conversations.",
    );
    expect(instructions).toContain(
      'If asked about adult topics, gently redirect to age-appropriate alternatives.',
    );
  });

  it('adds teen-tier instructions for teen age group', () => {
    const instructions = buildPrimeInstructions({
      role: 'child',
      ageGroup: 'teen',
      toolInstructions: [],
      contextBlock: '---\nContext\n---',
    });

    expect(instructions).toContain('Use age-appropriate language and be study-focused.');
    expect(instructions).toContain('Encourage critical thinking and safe curiosity.');
  });

  it('adds young-adult instructions for young adult age group', () => {
    const instructions = buildPrimeInstructions({
      role: 'child',
      ageGroup: 'young_adult',
      toolInstructions: [],
      contextBlock: '---\nContext\n---',
    });

    expect(instructions).toContain('Be a respectful study partner with a near-adult tone.');
    expect(instructions).toContain('Offer structured help for exams and long-form learning.');
  });

  it('does not add child-tier instructions for parent role', () => {
    const instructions = buildPrimeInstructions({
      role: 'parent',
      toolInstructions: [],
      contextBlock: '---\nContext\n---',
    });

    expect(instructions).not.toContain('Use simple vocabulary with short sentences.');
    expect(instructions).not.toContain('Use age-appropriate language and be study-focused.');
    expect(instructions).not.toContain(
      "Never share information from other family members' private conversations.",
    );
  });
});

describe('prime.ts lanes-only loading', () => {
  it('does not import or use loadScopedContextFiles (lanes-only)', async () => {
    const primeSrc = await readFile(path.join(__dirname, 'prime.ts'), 'utf8');
    expect(primeSrc).not.toContain('loadScopedContextFiles');
  });
});

describe('resolvePrimeModel', () => {
  it('prefers policyModel over env var and tool-based default', () => {
    const model = resolvePrimeModel([], { policyModel: 'gpt-4.1' });
    expect(model).toBe('gpt-4.1');
  });

  it('returns undefined when no policyModel and no env var', () => {
    const model = resolvePrimeModel([]);
    expect(model).toBeUndefined();
  });
});
