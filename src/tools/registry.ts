import type { Tool } from '@openai/agents';

import type { PrimeContext } from '../prime/types.js';
import { resolveToolPolicy } from '../policies/toolPolicy.js';
import { readScopedMemoryTool, rememberDailyTool } from './scopedMemoryTools.js';
import { webSearchTool } from './sdkTools.js';
import { TOOL_NAMES, type ToolName } from './toolNames.js';

const TOOL_REGISTRY: Record<ToolName, Tool<PrimeContext>> = {
  [TOOL_NAMES.webSearch]: webSearchTool,
  [TOOL_NAMES.readScopedMemory]: readScopedMemoryTool,
  [TOOL_NAMES.rememberDaily]: rememberDailyTool,
};

export function buildPrimeTools(context: PrimeContext): Tool<PrimeContext>[] {
  const policy = resolveToolPolicy({ role: context.role, scopeType: context.scopeType });
  const allowed = policy.allowedToolNames;

  return Object.entries(TOOL_REGISTRY)
    .filter(([name]) => allowed.has(name as ToolName))
    .map(([, tool]) => tool);
}
