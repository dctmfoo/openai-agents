import { describe, expect, it } from 'vitest';

import {
  validateCommand,
  compilePatterns,
  LocalShell,
  buildShellTool,
  type CommandPolicy,
} from './shellTool.js';
import type { ShellToolConfig } from '../runtime/haloConfig.js';

describe('compilePatterns', () => {
  it('converts string patterns to RegExp', () => {
    const patterns = compilePatterns(['^ls\\b', '^echo\\b']);
    expect(patterns).toHaveLength(2);
    expect(patterns[0].test('ls -la')).toBe(true);
    expect(patterns[1].test('echo hello')).toBe(true);
  });
});

describe('validateCommand', () => {
  const policy: CommandPolicy = {
    allowedPatterns: compilePatterns(['^ls\\b', '^echo\\b', '^date$', '^pwd$']),
    blockedPatterns: compilePatterns(['rm\\s+-rf', 'sudo', 'chmod']),
  };

  it('allows matching commands', () => {
    expect(validateCommand('ls -la', policy)).toEqual({ ok: true });
    expect(validateCommand('echo hello world', policy)).toEqual({ ok: true });
    expect(validateCommand('date', policy)).toEqual({ ok: true });
    expect(validateCommand('pwd', policy)).toEqual({ ok: true });
  });

  it('blocks matching commands', () => {
    expect(validateCommand('rm -rf /', policy)).toEqual({ ok: false, reason: 'blocked' });
    expect(validateCommand('sudo ls', policy)).toEqual({ ok: false, reason: 'blocked' });
    expect(validateCommand('chmod 777 file', policy)).toEqual({ ok: false, reason: 'blocked' });
  });

  it('denies non-matching commands', () => {
    expect(validateCommand('cat /etc/passwd', policy)).toEqual({ ok: false, reason: 'not_allowed' });
    expect(validateCommand('wget evil.com', policy)).toEqual({ ok: false, reason: 'not_allowed' });
  });

  it('denies all when allowedPatterns is empty', () => {
    const emptyPolicy: CommandPolicy = {
      allowedPatterns: [],
      blockedPatterns: [],
    };
    expect(validateCommand('ls', emptyPolicy)).toEqual({ ok: false, reason: 'not_allowed' });
  });

  it('blocked beats allowed when both match', () => {
    const conflictPolicy: CommandPolicy = {
      allowedPatterns: compilePatterns(['^sudo\\b']),
      blockedPatterns: compilePatterns(['sudo']),
    };
    expect(validateCommand('sudo ls', conflictPolicy)).toEqual({ ok: false, reason: 'blocked' });
  });

  it('trims command before validation', () => {
    expect(validateCommand('  ls -la  ', policy)).toEqual({ ok: true });
  });
});

describe('LocalShell', () => {
  it('executes allowed commands', async () => {
    const shell = new LocalShell({
      policy: {
        allowedPatterns: compilePatterns(['^echo\\b']),
        blockedPatterns: [],
      },
      timeoutMs: 5000,
      maxOutputLength: 4096,
    });

    const result = await shell.run({ commands: ['echo hello'] });
    expect(result.output).toHaveLength(1);
    expect(result.output[0].stdout.trim()).toBe('hello');
    expect(result.output[0].outcome).toEqual({ type: 'exit', exitCode: 0 });
  });

  it('denies blocked commands with exit 126', async () => {
    const shell = new LocalShell({
      policy: {
        allowedPatterns: compilePatterns(['^echo\\b']),
        blockedPatterns: compilePatterns(['sudo']),
      },
      timeoutMs: 5000,
      maxOutputLength: 4096,
    });

    const result = await shell.run({ commands: ['sudo rm -rf /'] });
    expect(result.output).toHaveLength(1);
    expect(result.output[0].outcome).toEqual({ type: 'exit', exitCode: 126 });
    expect(result.output[0].stderr).toContain('denied');
    expect(result.output[0].stderr).toContain('blocked');
  });

  it('denies non-allowed commands with exit 126', async () => {
    const shell = new LocalShell({
      policy: {
        allowedPatterns: compilePatterns(['^echo\\b']),
        blockedPatterns: [],
      },
      timeoutMs: 5000,
      maxOutputLength: 4096,
    });

    const result = await shell.run({ commands: ['cat /etc/passwd'] });
    expect(result.output).toHaveLength(1);
    expect(result.output[0].outcome).toEqual({ type: 'exit', exitCode: 126 });
    expect(result.output[0].stderr).toContain('not_allowed');
  });

  it('handles non-zero exit codes', async () => {
    const shell = new LocalShell({
      policy: {
        allowedPatterns: compilePatterns(['^false$']),
        blockedPatterns: [],
      },
      timeoutMs: 5000,
      maxOutputLength: 4096,
    });

    const result = await shell.run({ commands: ['false'] });
    expect(result.output).toHaveLength(1);
    expect(result.output[0].outcome.type).toBe('exit');
    if (result.output[0].outcome.type === 'exit') {
      expect(result.output[0].outcome.exitCode).not.toBe(0);
    }
  });

  it('handles timeout', async () => {
    const shell = new LocalShell({
      policy: {
        allowedPatterns: compilePatterns(['^sleep\\b']),
        blockedPatterns: [],
      },
      timeoutMs: 100,
      maxOutputLength: 4096,
    });

    const result = await shell.run({ commands: ['sleep 10'] });
    expect(result.output).toHaveLength(1);
    expect(result.output[0].outcome).toEqual({ type: 'timeout' });
  });

  it('processes multiple commands', async () => {
    const shell = new LocalShell({
      policy: {
        allowedPatterns: compilePatterns(['^echo\\b']),
        blockedPatterns: [],
      },
      timeoutMs: 5000,
      maxOutputLength: 4096,
    });

    const result = await shell.run({
      commands: ['echo first', 'echo second'],
    });
    expect(result.output).toHaveLength(2);
    expect(result.output[0].stdout.trim()).toBe('first');
    expect(result.output[1].stdout.trim()).toBe('second');
  });
});

describe('buildShellTool', () => {
  const baseConfig: ShellToolConfig = {
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
  };

  it('returns null when disabled', () => {
    const tool = buildShellTool({ ...baseConfig, enabled: false }, 'parent');
    expect(tool).toBeNull();
  });

  it('returns null when role has no patterns', () => {
    const tool = buildShellTool(baseConfig, 'child');
    expect(tool).toBeNull();
  });

  it('returns ShellTool when configured for parent', () => {
    const tool = buildShellTool(baseConfig, 'parent');
    expect(tool).not.toBeNull();
    expect(tool!.type).toBe('shell');
    expect(tool!.name).toBe('shell');
  });
});
