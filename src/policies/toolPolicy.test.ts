import { describe, expect, it } from 'vitest';

import { resolveToolPolicy } from './toolPolicy.js';
import { TOOL_NAMES } from '../tools/toolNames.js';

describe('toolPolicy', () => {
  it('denies by default when role or scope is missing', () => {
    const missingRole = resolveToolPolicy({ scopeType: 'dm' });
    expect(missingRole.allowedToolNames.size).toBe(0);

    const missingScope = resolveToolPolicy({ role: 'parent' });
    expect(missingScope.allowedToolNames.size).toBe(0);
  });

  it('allows safe tools for parent dm', () => {
    const decision = resolveToolPolicy({ role: 'parent', scopeType: 'dm' });

    expect(decision.allowedToolNames.has(TOOL_NAMES.readScopedMemory)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.rememberDaily)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.webSearch)).toBe(true);
  });

  it('denies web search for child dm but allows memory tools', () => {
    const decision = resolveToolPolicy({ role: 'child', scopeType: 'dm' });

    expect(decision.allowedToolNames.has(TOOL_NAMES.readScopedMemory)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.rememberDaily)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.webSearch)).toBe(false);
  });
});
