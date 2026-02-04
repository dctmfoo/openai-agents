import { TOOL_NAMES, type ToolName } from '../tools/toolNames.js';

export type ToolPolicyContext = {
  role?: 'parent' | 'child';
  scopeType?: 'dm' | 'parents_group';
};

export type ToolPolicyDecision = {
  allowedToolNames: Set<ToolName>;
};

type Role = NonNullable<ToolPolicyContext['role']>;
type ScopeType = NonNullable<ToolPolicyContext['scopeType']>;

const TOOL_ALLOWLIST: Record<Role, Record<ScopeType, ToolName[]>> = {
  parent: {
    dm: [TOOL_NAMES.readScopedMemory, TOOL_NAMES.rememberDaily, TOOL_NAMES.webSearch],
    parents_group: [
      TOOL_NAMES.readScopedMemory,
      TOOL_NAMES.rememberDaily,
      TOOL_NAMES.webSearch,
    ],
  },
  child: {
    dm: [TOOL_NAMES.readScopedMemory, TOOL_NAMES.rememberDaily],
    parents_group: [],
  },
};

export function resolveToolPolicy(context: ToolPolicyContext): ToolPolicyDecision {
  const { role, scopeType } = context;
  if (!role || !scopeType) {
    return { allowedToolNames: new Set() };
  }

  const allowed = TOOL_ALLOWLIST[role]?.[scopeType] ?? [];
  return { allowedToolNames: new Set(allowed) };
}
