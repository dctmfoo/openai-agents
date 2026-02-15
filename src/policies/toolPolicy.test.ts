import { describe, expect, it } from 'vitest';

import { resolveToolPolicy } from './toolPolicy.js';
import { TOOL_NAMES } from '../tools/toolNames.js';
import type { ToolAccessConfig } from '../runtime/haloConfig.js';

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
    expect(decision.allowedToolNames.has(TOOL_NAMES.semanticSearch)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.fileSearch)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.webSearch)).toBe(true);
  });

  it('denies web search for child dm but allows memory tools', () => {
    const decision = resolveToolPolicy({ role: 'child', scopeType: 'dm', ageGroup: 'child' });

    expect(decision.allowedToolNames.has(TOOL_NAMES.readScopedMemory)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.rememberDaily)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.semanticSearch)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.fileSearch)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.webSearch)).toBe(false);
  });

  it('allows web search for teen dm', () => {
    const decision = resolveToolPolicy({ role: 'child', scopeType: 'dm', ageGroup: 'teen' });

    expect(decision.allowedToolNames.has(TOOL_NAMES.readScopedMemory)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.rememberDaily)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.fileSearch)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.webSearch)).toBe(true);
  });

  it('allows web search for young adult dm', () => {
    const decision = resolveToolPolicy({
      role: 'child',
      scopeType: 'dm',
      ageGroup: 'young_adult',
    });

    expect(decision.allowedToolNames.has(TOOL_NAMES.readScopedMemory)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.rememberDaily)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.fileSearch)).toBe(true);
    expect(decision.allowedToolNames.has(TOOL_NAMES.webSearch)).toBe(true);
  });

  describe('config overrides', () => {
    it('uses allowedTools from config when present', () => {
      const accessConfig: ToolAccessConfig = {
        parent: {
          dm: {
            allowedTools: [TOOL_NAMES.readScopedMemory, TOOL_NAMES.shell],
          },
        },
        child: {},
      };

      const decision = resolveToolPolicy(
        { role: 'parent', scopeType: 'dm' },
        accessConfig,
      );

      expect(decision.allowedToolNames.has(TOOL_NAMES.readScopedMemory)).toBe(true);
      expect(decision.allowedToolNames.has(TOOL_NAMES.shell)).toBe(true);
      expect(decision.allowedToolNames.has(TOOL_NAMES.webSearch)).toBe(false);
    });

    it('falls back to defaults when config has no allowedTools for scope', () => {
      const accessConfig: ToolAccessConfig = {
        parent: {},
        child: {},
      };

      const decision = resolveToolPolicy(
        { role: 'parent', scopeType: 'dm' },
        accessConfig,
      );

      expect(decision.allowedToolNames.has(TOOL_NAMES.webSearch)).toBe(true);
      expect(decision.allowedToolNames.has(TOOL_NAMES.readScopedMemory)).toBe(true);
    });

    it('applies blockedTools subtraction', () => {
      const accessConfig: ToolAccessConfig = {
        parent: {
          dm: {
            allowedTools: [
              TOOL_NAMES.readScopedMemory,
              TOOL_NAMES.webSearch,
              TOOL_NAMES.shell,
            ],
            blockedTools: [TOOL_NAMES.webSearch],
          },
        },
        child: {},
      };

      const decision = resolveToolPolicy(
        { role: 'parent', scopeType: 'dm' },
        accessConfig,
      );

      expect(decision.allowedToolNames.has(TOOL_NAMES.readScopedMemory)).toBe(true);
      expect(decision.allowedToolNames.has(TOOL_NAMES.shell)).toBe(true);
      expect(decision.allowedToolNames.has(TOOL_NAMES.webSearch)).toBe(false);
    });

    it('ignores unknown tool names in config', () => {
      const accessConfig: ToolAccessConfig = {
        parent: {
          dm: {
            allowedTools: [TOOL_NAMES.readScopedMemory, 'gog', 'made_up_tool'],
          },
        },
        child: {},
      };

      const decision = resolveToolPolicy(
        { role: 'parent', scopeType: 'dm' },
        accessConfig,
      );

      expect(decision.allowedToolNames.has(TOOL_NAMES.readScopedMemory)).toBe(true);
      expect(decision.allowedToolNames.size).toBe(1);
    });

    it('uses config for child role with ageGroup', () => {
      const accessConfig: ToolAccessConfig = {
        parent: {},
        child: {
          teen: {
            dm: {
              allowedTools: [TOOL_NAMES.readScopedMemory, TOOL_NAMES.webSearch],
            },
          },
        },
      };

      const decision = resolveToolPolicy(
        { role: 'child', scopeType: 'dm', ageGroup: 'teen' },
        accessConfig,
      );

      expect(decision.allowedToolNames.has(TOOL_NAMES.readScopedMemory)).toBe(true);
      expect(decision.allowedToolNames.has(TOOL_NAMES.webSearch)).toBe(true);
      expect(decision.allowedToolNames.has(TOOL_NAMES.semanticSearch)).toBe(false);
    });

    it('falls back for child when ageGroup not in config', () => {
      const accessConfig: ToolAccessConfig = {
        parent: {},
        child: {},
      };

      const decision = resolveToolPolicy(
        { role: 'child', scopeType: 'dm', ageGroup: 'child' },
        accessConfig,
      );

      expect(decision.allowedToolNames.has(TOOL_NAMES.readScopedMemory)).toBe(true);
      expect(decision.allowedToolNames.has(TOOL_NAMES.webSearch)).toBe(false);
    });
  });
});
