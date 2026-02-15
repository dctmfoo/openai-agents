import { describe, expect, it } from 'vitest';

import { buildShellTool } from './shellTool.js';
import type { ShellToolConfig } from '../runtime/haloConfig.js';

describe('buildShellTool', () => {
  const baseConfig: ShellToolConfig = {
    enabled: true,
    timeoutMs: 5000,
    maxOutputLength: 4096,
    commandPolicy: {
      parent: {
        allowedPatterns: ['^echo\\b', '^false$', '^sleep\\b'],
        blockedPatterns: ['sudo'],
      },
      child: {
        allowedPatterns: [],
        blockedPatterns: [],
      },
    },
  };

  it('returns null when disabled', () => {
    const tool = buildShellTool({ ...baseConfig, enabled: false }, 'parent');
    expect(tool).toBeNull();
  });

  it('returns null when role has no patterns', () => {
    const tool = buildShellTool(baseConfig, 'child');
    expect(tool).toBeNull();
  });

  it('returns shell tool when configured for role', () => {
    const tool = buildShellTool(baseConfig, 'parent');
    expect(tool).not.toBeNull();
    expect(tool!.type).toBe('shell');
    expect(tool!.name).toBe('shell');
  });

  it('executes allowed command', async () => {
    const tool = buildShellTool(baseConfig, 'parent');
    if (!tool) throw new Error('Expected shell tool');

    const result = await tool.shell.run({ commands: ['echo hello'] });

    expect(result.output).toHaveLength(1);
    expect(result.output[0].stdout.trim()).toBe('hello');
    expect(result.output[0].outcome).toEqual({ type: 'exit', exitCode: 0 });
  });

  it('denies blocked command with exit 126', async () => {
    const tool = buildShellTool(baseConfig, 'parent');
    if (!tool) throw new Error('Expected shell tool');

    const result = await tool.shell.run({ commands: ['sudo echo hi'] });

    expect(result.output).toHaveLength(1);
    expect(result.output[0].outcome).toEqual({ type: 'exit', exitCode: 126 });
    expect(result.output[0].stderr).toContain('blocked');
  });

  it('denies non-allowed command with exit 126', async () => {
    const tool = buildShellTool(baseConfig, 'parent');
    if (!tool) throw new Error('Expected shell tool');

    const result = await tool.shell.run({ commands: ['cat /etc/passwd'] });

    expect(result.output).toHaveLength(1);
    expect(result.output[0].outcome).toEqual({ type: 'exit', exitCode: 126 });
    expect(result.output[0].stderr).toContain('not_allowed');
  });

  it('returns timeout outcome when command exceeds timeout', async () => {
    const tool = buildShellTool(
      {
        ...baseConfig,
        timeoutMs: 100,
        commandPolicy: {
          ...baseConfig.commandPolicy,
          parent: {
            ...baseConfig.commandPolicy.parent,
            allowedPatterns: ['^sleep\\b'],
          },
        },
      },
      'parent',
    );
    if (!tool) throw new Error('Expected shell tool');

    const result = await tool.shell.run({ commands: ['sleep 10'] });

    expect(result.output).toHaveLength(1);
    expect(result.output[0].outcome).toEqual({ type: 'timeout' });
  });
});
