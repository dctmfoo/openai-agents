import type { FamilyConfig } from './familyConfig.js';

type LaneRetentionConfig = {
  defaultDays?: number;
  byLaneId?: Record<string, number>;
};

type OperationsPolicyConfig = {
  managerMemberIds?: string[];
  laneRetention?: LaneRetentionConfig;
};

type ControlPlaneWithOperations = NonNullable<FamilyConfig['controlPlane']> & {
  operations?: OperationsPolicyConfig;
};

type OperationalControlDecision = {
  allow: boolean;
  reason: 'parent_manager' | 'parent_not_manager' | 'not_parent' | 'member_not_found';
};

function isPositiveInteger(value: unknown): value is number {
  if (typeof value !== 'number') {
    return false;
  }

  if (!Number.isFinite(value)) {
    return false;
  }

  return Number.isInteger(value) && value > 0;
}

function getOperationsPolicyConfig(family: FamilyConfig): OperationsPolicyConfig | null {
  const controlPlane = family.controlPlane as ControlPlaneWithOperations | undefined;
  if (!controlPlane) {
    return null;
  }

  return controlPlane.operations ?? null;
}

function normalizeManagerMemberIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }

    if (!normalized.includes(trimmed)) {
      normalized.push(trimmed);
    }
  }

  return normalized;
}

export function canManageOperationalControls(
  family: FamilyConfig,
  memberId: string,
): OperationalControlDecision {
  const member = family.members.find((candidate) => candidate.memberId === memberId);
  if (!member) {
    return {
      allow: false,
      reason: 'member_not_found',
    };
  }

  if (member.role !== 'parent') {
    return {
      allow: false,
      reason: 'not_parent',
    };
  }

  const operations = getOperationsPolicyConfig(family);
  const managerMemberIds = normalizeManagerMemberIds(operations?.managerMemberIds);
  if (managerMemberIds.length === 0) {
    return {
      allow: true,
      reason: 'parent_manager',
    };
  }

  if (managerMemberIds.includes(memberId)) {
    return {
      allow: true,
      reason: 'parent_manager',
    };
  }

  return {
    allow: false,
    reason: 'parent_not_manager',
  };
}

function normalizeLaneRetentionConfig(
  input: unknown,
): { defaultDays: number | null; byLaneId: Record<string, number> } {
  if (!input || typeof input !== 'object') {
    return {
      defaultDays: null,
      byLaneId: {},
    };
  }

  const candidate = input as {
    defaultDays?: unknown;
    byLaneId?: unknown;
  };

  const defaultDays = isPositiveInteger(candidate.defaultDays)
    ? candidate.defaultDays
    : null;

  const byLaneId: Record<string, number> = {};
  if (candidate.byLaneId && typeof candidate.byLaneId === 'object') {
    for (const [laneId, value] of Object.entries(candidate.byLaneId)) {
      const normalizedLaneId = laneId.trim();
      if (!normalizedLaneId) {
        continue;
      }

      if (!isPositiveInteger(value)) {
        continue;
      }

      byLaneId[normalizedLaneId] = value;
    }
  }

  return {
    defaultDays,
    byLaneId,
  };
}

export function resolveLaneRetentionDays(
  family: FamilyConfig,
  laneId: string,
): number | null {
  const normalizedLaneId = laneId.trim();
  if (!normalizedLaneId) {
    return null;
  }

  const operations = getOperationsPolicyConfig(family);
  const retention = normalizeLaneRetentionConfig(operations?.laneRetention);

  if (normalizedLaneId in retention.byLaneId) {
    return retention.byLaneId[normalizedLaneId];
  }

  return retention.defaultDays;
}
