import { exec } from 'node:child_process';
import { shellTool, type ShellTool } from '@openai/agents';
import type { Shell, ShellAction, ShellResult } from '@openai/agents';

import type { ShellToolConfig } from '../runtime/haloConfig.js';

type CommandPolicy = {
  allowedPatterns: RegExp[];
  blockedPatterns: RegExp[];
};

type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'blocked' | 'not_allowed' };

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((p) => new RegExp(p));
}

function validateCommand(command: string, policy: CommandPolicy): ValidationResult {
  const trimmed = command.trim();

  for (const pattern of policy.blockedPatterns) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: 'blocked' };
    }
  }

  if (policy.allowedPatterns.length === 0) {
    return { ok: false, reason: 'not_allowed' };
  }

  for (const pattern of policy.allowedPatterns) {
    if (pattern.test(trimmed)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: 'not_allowed' };
}

class LocalShell implements Shell {
  private readonly policy: CommandPolicy;
  private readonly timeoutMs: number;
  private readonly maxOutputLength: number;
  private readonly cwd?: string;

  constructor(options: {
    policy: CommandPolicy;
    timeoutMs: number;
    maxOutputLength: number;
    cwd?: string;
  }) {
    this.policy = options.policy;
    this.timeoutMs = options.timeoutMs;
    this.maxOutputLength = options.maxOutputLength;
    this.cwd = options.cwd;
  }

  async run(action: ShellAction): Promise<ShellResult> {
    const output = [];

    for (const command of action.commands) {
      const validation = validateCommand(command, this.policy);

      if (!validation.ok) {
        output.push({
          stdout: '',
          stderr: `Command denied: ${validation.reason}. Command: ${command}`,
          outcome: { type: 'exit' as const, exitCode: 126 },
        });
        continue;
      }

      const timeout = action.timeoutMs ?? this.timeoutMs;
      const maxBuffer = action.maxOutputLength ?? this.maxOutputLength;

      const result = await this.execCommand(command, timeout, maxBuffer);
      output.push(result);
    }

    return { output };
  }

  private execCommand(
    command: string,
    timeoutMs: number,
    maxBuffer: number,
  ): Promise<ShellResult['output'][number]> {
    return new Promise((resolve) => {
      const child = exec(
        command,
        {
          timeout: timeoutMs,
          maxBuffer,
          cwd: this.cwd,
        },
        (error, stdout, stderr) => {
          if (error && child.killed) {
            resolve({
              stdout: String(stdout ?? ''),
              stderr: String(stderr ?? ''),
              outcome: { type: 'timeout' },
            });
            return;
          }

          const exitCode = error ? (error as NodeJS.ErrnoException & { code?: number | string }).code : 0;
          resolve({
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
            outcome: {
              type: 'exit',
              exitCode: typeof exitCode === 'number' ? exitCode : (child.exitCode ?? 1),
            },
          });
        },
      );
    });
  }
}

export function buildShellTool(
  config: ShellToolConfig,
  role: 'parent' | 'child',
): ShellTool | null {
  if (!config.enabled) return null;

  const rolePolicy = config.commandPolicy[role];
  if (!rolePolicy || rolePolicy.allowedPatterns.length === 0) return null;

  const policy: CommandPolicy = {
    allowedPatterns: compilePatterns(rolePolicy.allowedPatterns),
    blockedPatterns: compilePatterns(rolePolicy.blockedPatterns),
  };

  const shell = new LocalShell({
    policy,
    timeoutMs: config.timeoutMs,
    maxOutputLength: config.maxOutputLength,
    cwd: config.cwd,
  });

  return shellTool({ shell, needsApproval: false });
}
