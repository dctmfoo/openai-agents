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

const TOOL_NAME_SET = new Set<ToolName>(Object.values(TOOL_NAMES));

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

function toToolSet(allowedTools?: string[], blockedTools?: string[]): Set<ToolName> | null {
  if (!allowedTools) return null;

  const allowed = new Set<ToolName>();
  for (const tool of allowedTools) {
    if (TOOL_NAME_SET.has(tool as ToolName)) {
      allowed.add(tool as ToolName);
    }
  }

  if (blockedTools) {
    for (const tool of blockedTools) {
      if (TOOL_NAME_SET.has(tool as ToolName)) {
        allowed.delete(tool as ToolName);
      }
    }
  }

  return allowed;
}

function resolveFromConfig(
  role: Role,
  scopeType: ScopeType,
  ageGroup: AgeGroup | undefined,
  accessConfig: ToolAccessConfig,
): ToolPolicyDecision | null {
  if (role === 'parent') {
    const scopeAccess = accessConfig.parent?.[scopeType];
    const allowed = toToolSet(scopeAccess?.allowedTools, scopeAccess?.blockedTools);
    if (!allowed) return null;
    return { allowedToolNames: allowed };
  }

  const group = ageGroup ?? 'child';
  const childGroup = accessConfig.child?.[group];
  if (!childGroup) return null;
  const scopeAccess = childGroup[scopeType];
  const allowed = toToolSet(scopeAccess?.allowedTools, scopeAccess?.blockedTools);
  if (!allowed) return null;

  return { allowedToolNames: allowed };
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
