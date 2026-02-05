import { describe, expect, it } from 'vitest';

import { buildPrimeInstructions } from './prime.js';

describe('buildPrimeInstructions', () => {
  it('adds child-safe instructions for child role', () => {
    const instructions = buildPrimeInstructions({
      role: 'child',
      toolInstructions: [],
      contextBlock: '---\nContext\n---',
    });

    expect(instructions).toContain('Use simple, encouraging language suitable for a child.');
    expect(instructions).toContain(
      "Never share information from other family members' private conversations.",
    );
    expect(instructions).toContain(
      'If asked about adult topics, gently redirect to age-appropriate alternatives.',
    );
  });

  it('does not add child-safe instructions for parent role', () => {
    const instructions = buildPrimeInstructions({
      role: 'parent',
      toolInstructions: [],
      contextBlock: '---\nContext\n---',
    });

    expect(instructions).not.toContain('Use simple, encouraging language suitable for a child.');
    expect(instructions).not.toContain(
      "Never share information from other family members' private conversations.",
    );
    expect(instructions).not.toContain(
      'If asked about adult topics, gently redirect to age-appropriate alternatives.',
    );
  });
});
