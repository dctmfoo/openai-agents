import { describe, expect, it } from 'vitest';

import { buildPrimeTools } from './registry.js';
import { TOOL_NAMES } from './toolNames.js';
import type { PrimeContext } from '../prime/types.js';

describe('prime tool registry', () => {
  it('includes only allowed tools for parent dm', () => {
    const ctx: PrimeContext = {
      rootDir: '/root',
      scopeId: 'telegram:dm:wags',
      role: 'parent',
      scopeType: 'dm',
      channel: 'telegram',
    };

    const tools = buildPrimeTools(ctx);
    const names = tools.map((tool) => tool.name).sort();

    expect(names).toEqual(
      [
        TOOL_NAMES.readScopedMemory,
        TOOL_NAMES.rememberDaily,
        TOOL_NAMES.semanticSearch,
        TOOL_NAMES.webSearch,
      ].sort(),
    );
  });

  it('excludes web search for child dm', () => {
    const ctx: PrimeContext = {
      rootDir: '/root',
      scopeId: 'telegram:dm:kid',
      role: 'child',
      ageGroup: 'child',
      scopeType: 'dm',
      channel: 'telegram',
    };

    const tools = buildPrimeTools(ctx);
    const names = tools.map((tool) => tool.name);

    expect(names).toContain(TOOL_NAMES.readScopedMemory);
    expect(names).toContain(TOOL_NAMES.rememberDaily);
    expect(names).toContain(TOOL_NAMES.semanticSearch);
    expect(names).not.toContain(TOOL_NAMES.webSearch);
  });
});
