import { fileSearchTool, type Tool } from '@openai/agents';

import type { PrimeContext } from '../prime/types.js';
import { resolveToolPolicy } from '../policies/toolPolicy.js';
import { readScopedMemoryTool, rememberDailyTool } from './scopedMemoryTools.js';
import { webSearchTool } from './sdkTools.js';
import { semanticSearchTool } from './semanticSearchTool.js';
import { buildShellTool } from './shellTool.js';
import { TOOL_NAMES, type ToolName } from './toolNames.js';

type StaticToolName = Exclude<ToolName, typeof TOOL_NAMES.fileSearch | typeof TOOL_NAMES.shell>;

const STATIC_TOOL_REGISTRY: Record<StaticToolName, Tool<PrimeContext>> = {
  [TOOL_NAMES.webSearch]: webSearchTool,
  [TOOL_NAMES.readScopedMemory]: readScopedMemoryTool,
  [TOOL_NAMES.rememberDaily]: rememberDailyTool,
  [TOOL_NAMES.semanticSearch]: semanticSearchTool,
};

function buildHostedFileSearchTool(context: PrimeContext): Tool<PrimeContext> | null {
  if (!context.fileSearchEnabled) return null;
  if (!context.fileSearchVectorStoreId) return null;

  return fileSearchTool(context.fileSearchVectorStoreId, {
    name: TOOL_NAMES.fileSearch,
    includeSearchResults: context.fileSearchIncludeResults,
    maxNumResults: context.fileSearchMaxNumResults,
  }) as unknown as Tool<PrimeContext>;
}

export function buildPrimeTools(context: PrimeContext): Tool<PrimeContext>[] {
  const policy = resolveToolPolicy(
    {
      role: context.role,
      ageGroup: context.ageGroup,
      scopeType: context.scopeType,
    },
    context.toolsConfig?.access,
  );
  const allowed = policy.allowedToolNames;
  const disabled = new Set(context.disabledToolNames ?? []);

  const tools = Object.entries(STATIC_TOOL_REGISTRY)
    .filter(([name]) => allowed.has(name as StaticToolName) && !disabled.has(name as StaticToolName))
    .map(([, tool]) => tool);

  if (allowed.has(TOOL_NAMES.fileSearch) && !disabled.has(TOOL_NAMES.fileSearch)) {
    const fileSearch = buildHostedFileSearchTool(context);
    if (fileSearch) {
      tools.push(fileSearch);
    }
  }

  if (allowed.has(TOOL_NAMES.shell) && !disabled.has(TOOL_NAMES.shell)) {
    const shellConfig = context.toolsConfig?.shell;
    const role = context.role;
    if (shellConfig && role) {
      const shell = buildShellTool(shellConfig, role);
      if (shell) {
        tools.push(shell as unknown as Tool<PrimeContext>);
      }
    }
  }

  return tools;
}
