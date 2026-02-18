import type { FamilyConfig } from '../runtime/familyConfig.js';

type Member = FamilyConfig['members'][number];
type MemberRole = Member['role'];

type ProfileLaneTemplate = {
  role: MemberRole;
  readLanes: string[];
  writeLanes: string[];
};

type ControlPlaneProfileSummary = {
  profileId: string;
  role: MemberRole;
  memoryLanePolicyId: string;
};

type FamilyControlPlaneWithProfiles = NonNullable<FamilyConfig['controlPlane']> & {
  profiles?: ControlPlaneProfileSummary[];
};

const DEFAULT_PROFILE_LANE_TEMPLATES: Record<string, ProfileLaneTemplate> = {
  parent_default: {
    role: 'parent',
    readLanes: ['parent_private:{memberId}', 'parents_shared', 'family_shared'],
    writeLanes: ['parent_private:{memberId}'],
  },
  child_default: {
    role: 'child',
    readLanes: ['child_private:{memberId}', 'child_shared'],
    writeLanes: ['child_private:{memberId}'],
  },
  young_child: {
    role: 'child',
    readLanes: ['child_private:{memberId}', 'child_shared'],
    writeLanes: ['child_private:{memberId}'],
  },
  adolescent: {
    role: 'child',
    readLanes: ['child_private:{memberId}', 'child_shared'],
    writeLanes: ['child_private:{memberId}'],
  },
};

const ROLE_FALLBACK_PROFILE: Record<MemberRole, string> = {
  parent: 'parent_default',
  child: 'child_default',
};

const dedupeStable = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    if (seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    out.push(trimmed);
  }

  return out;
};

function expandLaneTemplate(lane: string, memberId: string): string {
  const replacedMemberToken = lane.replace(/\{memberId\}/g, memberId);
  return replacedMemberToken.replace(/:self\b/g, `:${memberId}`);
}

function getControlPlaneProfiles(
  family: FamilyConfig,
): ControlPlaneProfileSummary[] | null {
  const controlPlane = family.controlPlane as FamilyControlPlaneWithProfiles | undefined;
  if (!controlPlane || !Array.isArray(controlPlane.profiles)) {
    return null;
  }

  return controlPlane.profiles;
}

function resolveFromControlPlane(
  family: FamilyConfig,
  member: Member,
): { readLanes: string[]; writeLanes: string[] } | null {
  if (!member.profileId) {
    return null;
  }

  const profiles = getControlPlaneProfiles(family);
  if (!profiles) {
    return null;
  }

  const profile = profiles.find((candidate) => {
    return candidate.profileId === member.profileId;
  });

  if (!profile) {
    return null;
  }

  const lanePolicy = family.controlPlane?.memoryLanePolicies[profile.memoryLanePolicyId];
  if (!lanePolicy) {
    return null;
  }

  return {
    readLanes: lanePolicy.readLanes.map((lane) => {
      return expandLaneTemplate(lane, member.memberId);
    }),
    writeLanes: lanePolicy.writeLanes.map((lane) => {
      return expandLaneTemplate(lane, member.memberId);
    }),
  };
}

function resolveTemplateProfile(member: Member): string {
  if (member.profileId && member.profileId in DEFAULT_PROFILE_LANE_TEMPLATES) {
    return member.profileId;
  }

  return ROLE_FALLBACK_PROFILE[member.role];
}

export function resolveMemberMemoryLanes(
  family: FamilyConfig,
  member: Member,
): { readLanes: string[]; writeLanes: string[] } {
  const fromControlPlane = resolveFromControlPlane(family, member);
  if (fromControlPlane) {
    return {
      readLanes: dedupeStable(fromControlPlane.readLanes),
      writeLanes: dedupeStable(fromControlPlane.writeLanes),
    };
  }

  const profileId = resolveTemplateProfile(member);
  const template = DEFAULT_PROFILE_LANE_TEMPLATES[profileId];

  const readLanes = template.readLanes.map((lane) => {
    return expandLaneTemplate(lane, member.memberId);
  });

  const writeLanes = template.writeLanes.map((lane) => {
    return expandLaneTemplate(lane, member.memberId);
  });

  return {
    readLanes: dedupeStable(readLanes),
    writeLanes: dedupeStable(writeLanes),
  };
}

type LaneVisibilityClass = 'private' | 'shared' | 'system';

type LaneArtifactType = 'document' | 'transcript' | 'chunk';

export type LaneStorageMetadata = {
  laneId: string;
  ownerMemberId: string | null;
  scopeId: string;
  policyVersion: string;
  artifactType: LaneArtifactType;
  visibilityClass: LaneVisibilityClass;
};

function resolveLaneVisibilityClass(laneId: string): LaneVisibilityClass {
  if (laneId === 'system_audit') {
    return 'system';
  }

  if (laneId.startsWith('parent_private:') || laneId.startsWith('child_private:')) {
    return 'private';
  }

  return 'shared';
}

export function buildLaneStorageMetadata(
  input: Omit<LaneStorageMetadata, 'visibilityClass'>,
): LaneStorageMetadata {
  const visibilityClass = resolveLaneVisibilityClass(input.laneId);
  return {
    laneId: input.laneId,
    ownerMemberId: input.ownerMemberId,
    scopeId: input.scopeId,
    policyVersion: input.policyVersion,
    artifactType: input.artifactType,
    visibilityClass,
  };
}
