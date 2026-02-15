import { describe, expect, it } from 'vitest';

import { buildPrimeTools } from './registry.js';
import { TOOL_NAMES } from './toolNames.js';
import type { PrimeContext } from '../prime/types.js';
import type { ToolsConfig } from '../runtime/haloConfig.js';

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

  it('includes file_search for parent dm when scope vector store is present', () => {
    const ctx: PrimeContext = {
      rootDir: '/root',
      scopeId: 'telegram:dm:wags',
      role: 'parent',
      scopeType: 'dm',
      channel: 'telegram',
      fileSearchEnabled: true,
      fileSearchVectorStoreId: 'vs_123',
      fileSearchIncludeResults: false,
      fileSearchMaxNumResults: 5,
    };

    const tools = buildPrimeTools(ctx);
    const names = tools.map((tool) => tool.name).sort();

    expect(names).toEqual(
      [
        TOOL_NAMES.fileSearch,
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
    expect(names).not.toContain(TOOL_NAMES.fileSearch);
  });

  describe('config-driven shell tool', () => {
    const shellToolsConfig: ToolsConfig = {
      shell: {
        enabled: true,
        timeoutMs: 5000,
        maxOutputLength: 4096,
        commandPolicy: {
          parent: {
            allowedPatterns: ['^ls\\b', '^echo\\b'],
            blockedPatterns: ['sudo'],
          },
          child: {
            allowedPatterns: [],
            blockedPatterns: [],
          },
        },
      },
      access: {
        parent: {
          dm: {
            allowedTools: [
              TOOL_NAMES.readScopedMemory,
              TOOL_NAMES.rememberDaily,
              TOOL_NAMES.semanticSearch,
              TOOL_NAMES.webSearch,
              TOOL_NAMES.shell,
            ],
          },
        },
        child: {},
      },
    };

    it('includes shell tool for parent when config enables it', () => {
      const ctx: PrimeContext = {
        rootDir: '/root',
        scopeId: 'telegram:dm:wags',
        role: 'parent',
        scopeType: 'dm',
        channel: 'telegram',
        toolsConfig: shellToolsConfig,
      };

      const tools = buildPrimeTools(ctx);
      const names = tools.map((tool) => tool.name);

      expect(names).toContain(TOOL_NAMES.shell);
      expect(names).toContain(TOOL_NAMES.readScopedMemory);
      expect(names).toContain(TOOL_NAMES.webSearch);
    });

    it('excludes shell for child with no patterns', () => {
      const ctx: PrimeContext = {
        rootDir: '/root',
        scopeId: 'telegram:dm:kid',
        role: 'child',
        ageGroup: 'child',
        scopeType: 'dm',
        channel: 'telegram',
        toolsConfig: {
          ...shellToolsConfig,
          access: {
            parent: {},
            child: {
              child: {
                dm: {
                  allowedTools: [TOOL_NAMES.readScopedMemory, TOOL_NAMES.shell],
                },
              },
            },
          },
        },
      };

      const tools = buildPrimeTools(ctx);
      const names = tools.map((tool) => tool.name);

      // Shell is in allowedTools but child has no patterns, so buildShellTool returns null
      expect(names).not.toContain(TOOL_NAMES.shell);
      expect(names).toContain(TOOL_NAMES.readScopedMemory);
    });

    it('preserves existing behavior when no toolsConfig', () => {
      const ctx: PrimeContext = {
        rootDir: '/root',
        scopeId: 'telegram:dm:wags',
        role: 'parent',
        scopeType: 'dm',
        channel: 'telegram',
      };

      const tools = buildPrimeTools(ctx);
      const names = tools.map((tool) => tool.name);

      expect(names).not.toContain(TOOL_NAMES.shell);
      expect(names).toContain(TOOL_NAMES.readScopedMemory);
      expect(names).toContain(TOOL_NAMES.webSearch);
    });
  });
});
