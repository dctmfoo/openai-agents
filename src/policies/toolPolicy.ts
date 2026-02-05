import { TOOL_NAMES, type ToolName } from '../tools/toolNames.js';

export type ToolPolicyContext = {
  role?: 'parent' | 'child';
  ageGroup?: 'child' | 'teen' | 'young_adult';
  scopeType?: 'dm' | 'parents_group';
};

export type ToolPolicyDecision = {
  allowedToolNames: Set<ToolName>;
};

type Role = NonNullable<ToolPolicyContext['role']>;
type ScopeType = NonNullable<ToolPolicyContext['scopeType']>;
type AgeGroup = NonNullable<ToolPolicyContext['ageGroup']>;

const PARENT_ALLOWLIST: Record<ScopeType, ToolName[]> = {
  dm: [TOOL_NAMES.readScopedMemory, TOOL_NAMES.rememberDaily, TOOL_NAMES.webSearch],
  parents_group: [
    TOOL_NAMES.readScopedMemory,
    TOOL_NAMES.rememberDaily,
    TOOL_NAMES.webSearch,
  ],
};

const CHILD_ALLOWLIST: Record<AgeGroup, Record<ScopeType, ToolName[]>> = {
  child: {
    dm: [TOOL_NAMES.readScopedMemory, TOOL_NAMES.rememberDaily],
    parents_group: [],
  },
  teen: {
    dm: [TOOL_NAMES.readScopedMemory, TOOL_NAMES.rememberDaily, TOOL_NAMES.webSearch],
    parents_group: [],
  },
  young_adult: {
    dm: [TOOL_NAMES.readScopedMemory, TOOL_NAMES.rememberDaily, TOOL_NAMES.webSearch],
    parents_group: [],
  },
};

export function resolveToolPolicy(context: ToolPolicyContext): ToolPolicyDecision {
  const { role, scopeType, ageGroup } = context;
  if (!role || !scopeType) {
    return { allowedToolNames: new Set() };
  }

  if (role === 'parent') {
    return { allowedToolNames: new Set(PARENT_ALLOWLIST[scopeType] ?? []) };
  }

  const group: AgeGroup = ageGroup ?? 'child';
  const allowed = CHILD_ALLOWLIST[group]?.[scopeType] ?? [];
  return { allowedToolNames: new Set(allowed) };
}
