import type { ToolAccessConfig } from '../runtime/haloConfig.js';
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
  dm: [
    TOOL_NAMES.readScopedMemory,
    TOOL_NAMES.rememberDaily,
    TOOL_NAMES.semanticSearch,
    TOOL_NAMES.fileSearch,
    TOOL_NAMES.webSearch,
  ],
  parents_group: [
    TOOL_NAMES.readScopedMemory,
    TOOL_NAMES.rememberDaily,
    TOOL_NAMES.semanticSearch,
    TOOL_NAMES.fileSearch,
    TOOL_NAMES.webSearch,
  ],
};

const CHILD_ALLOWLIST: Record<AgeGroup, Record<ScopeType, ToolName[]>> = {
  child: {
    dm: [
      TOOL_NAMES.readScopedMemory,
      TOOL_NAMES.rememberDaily,
      TOOL_NAMES.semanticSearch,
      TOOL_NAMES.fileSearch,
    ],
    parents_group: [],
  },
  teen: {
    dm: [
      TOOL_NAMES.readScopedMemory,
      TOOL_NAMES.rememberDaily,
      TOOL_NAMES.semanticSearch,
      TOOL_NAMES.fileSearch,
      TOOL_NAMES.webSearch,
    ],
    parents_group: [],
  },
  young_adult: {
    dm: [
      TOOL_NAMES.readScopedMemory,
      TOOL_NAMES.rememberDaily,
      TOOL_NAMES.semanticSearch,
      TOOL_NAMES.fileSearch,
      TOOL_NAMES.webSearch,
    ],
    parents_group: [],
  },
};

function resolveFromConfig(
  role: Role,
  scopeType: ScopeType,
  ageGroup: AgeGroup | undefined,
  accessConfig: ToolAccessConfig,
): ToolPolicyDecision | null {
  if (role === 'parent') {
    const scopeAccess = accessConfig.parent?.[scopeType];
    if (!scopeAccess?.allowedTools) return null;
    let allowed = new Set<string>(scopeAccess.allowedTools);
    if (scopeAccess.blockedTools) {
      for (const tool of scopeAccess.blockedTools) {
        allowed.delete(tool);
      }
    }
    return { allowedToolNames: allowed as Set<ToolName> };
  }

  const group = ageGroup ?? 'child';
  const childGroup = accessConfig.child?.[group];
  if (!childGroup) return null;
  const scopeAccess = childGroup[scopeType];
  if (!scopeAccess?.allowedTools) return null;
  let allowed = new Set<string>(scopeAccess.allowedTools);
  if (scopeAccess.blockedTools) {
    for (const tool of scopeAccess.blockedTools) {
      allowed.delete(tool);
    }
  }
  return { allowedToolNames: allowed as Set<ToolName> };
}

export function resolveToolPolicy(
  context: ToolPolicyContext,
  toolAccessConfig?: ToolAccessConfig,
): ToolPolicyDecision {
  const { role, scopeType, ageGroup } = context;
  if (!role || !scopeType) {
    return { allowedToolNames: new Set() };
  }

  if (toolAccessConfig) {
    const fromConfig = resolveFromConfig(role, scopeType, ageGroup, toolAccessConfig);
    if (fromConfig) return fromConfig;
  }

  if (role === 'parent') {
    return { allowedToolNames: new Set(PARENT_ALLOWLIST[scopeType] ?? []) };
  }

  const group: AgeGroup = ageGroup ?? 'child';
  const allowed = CHILD_ALLOWLIST[group]?.[scopeType] ?? [];
  return { allowedToolNames: new Set(allowed) };
}
