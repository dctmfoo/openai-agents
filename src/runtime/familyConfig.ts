import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z, type ZodError } from 'zod';
import { getHaloHome } from './haloHome.js';
import {
  ONBOARDING_CONTRACT_SCHEMA,
  type OnboardingContract,
} from './onboardingContract.js';

const LEGACY_FAMILY_SCHEMA_VERSION = 1;
const CONTROL_PLANE_SCHEMA_VERSION = 2;
const DEFAULT_FAMILY_CONFIG_RELATIVE_PATH = 'config/family.json';

const MemberRoleSchema = z.enum(['parent', 'child']);
const AgeGroupSchema = z.enum(['child', 'teen', 'young_adult']);

const LegacyMemberSchema = z
  .object({
    memberId: z.string().min(1),
    displayName: z.string().min(1),
    role: MemberRoleSchema,
    ageGroup: AgeGroupSchema.optional(),
    parentalVisibility: z.boolean().optional(),
    telegramUserIds: z.array(z.number().int().positive()).min(1),
  })
  .strict()
  .superRefine((member, ctx) => {
    if (member.role === 'child' && !member.ageGroup) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ageGroup is required for child members',
        path: ['ageGroup'],
      });
    }
  });

const ParentsGroupSchema = z
  .object({
    telegramChatId: z.number().int().nullable(),
  })
  .strict();

const LegacyFamilyConfigSchema = z
  .object({
    schemaVersion: z.literal(LEGACY_FAMILY_SCHEMA_VERSION),
    familyId: z.string().min(1),
    members: z.array(LegacyMemberSchema).min(1),
    parentsGroup: ParentsGroupSchema.optional(),
    onboarding: ONBOARDING_CONTRACT_SCHEMA.optional(),
  })
  .strict();

const CapabilityTierSchema = z.array(z.string().min(1)).min(1);

const MemoryLanePolicySchema = z
  .object({
    readLanes: z.array(z.string().min(1)).min(1),
    writeLanes: z.array(z.string().min(1)).min(1),
  })
  .strict();

const ModelPolicySchema = z
  .object({
    tier: z.string().min(1),
    model: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

const SafetyPolicySchema = z
  .object({
    riskLevel: z.enum(['low', 'medium', 'high']),
    escalationPolicyId: z.string().min(1),
  })
  .strict();

const LaneRetentionPolicySchema = z
  .object({
    defaultDays: z.number().int().positive().optional(),
    byLaneId: z.record(z.string().min(1), z.number().int().positive()).default({}),
  })
  .strict();

const OperationsPolicySchema = z
  .object({
    managerMemberIds: z.array(z.string().min(1)).default([]),
    laneRetention: LaneRetentionPolicySchema.optional(),
  })
  .strict();

const ControlPlaneProfileSchema = z
  .object({
    profileId: z.string().min(1),
    role: MemberRoleSchema,
    capabilityTierId: z.string().min(1),
    memoryLanePolicyId: z.string().min(1),
    modelPolicyId: z.string().min(1),
    safetyPolicyId: z.string().min(1),
  })
  .strict();

const ControlPlaneMemberSchema = z
  .object({
    memberId: z.string().min(1),
    displayName: z.string().min(1),
    role: MemberRoleSchema,
    profileId: z.string().min(1),
    parentalVisibility: z.boolean().optional(),
    telegramUserIds: z.array(z.number().int().positive()).min(1),
  })
  .strict();

const ScopeTypeSchema = z.enum(['dm', 'parents_group', 'family_group']);

const ControlPlaneScopeSchema = z
  .object({
    scopeId: z.string().min(1),
    scopeType: ScopeTypeSchema,
    telegramChatId: z.number().int().nullable().optional(),
  })
  .strict();

const ControlPlaneConfigSchema = z
  .object({
    schemaVersion: z.literal(CONTROL_PLANE_SCHEMA_VERSION),
    policyVersion: z.string().min(1),
    familyId: z.string().min(1),
    activeProfileId: z.string().min(1),
    profiles: z.array(ControlPlaneProfileSchema).min(1),
    members: z.array(ControlPlaneMemberSchema).min(1),
    scopes: z.array(ControlPlaneScopeSchema).min(1),
    capabilityTiers: z.record(z.string().min(1), CapabilityTierSchema),
    memoryLanePolicies: z.record(z.string().min(1), MemoryLanePolicySchema),
    modelPolicies: z.record(z.string().min(1), ModelPolicySchema),
    safetyPolicies: z.record(z.string().min(1), SafetyPolicySchema),
    operations: OperationsPolicySchema.optional(),
    onboarding: ONBOARDING_CONTRACT_SCHEMA.optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    for (const [index, member] of config.members.entries()) {
      const profile = config.profiles.find((candidate) => candidate.profileId === member.profileId);
      if (!profile) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `member profileId ${member.profileId} is not defined in profiles`,
          path: ['members', index, 'profileId'],
        });
        continue;
      }

      if (profile.role !== member.role) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `member role must match profile role`,
          path: ['members', index, 'role'],
        });
      }
    }

    for (const [index, profile] of config.profiles.entries()) {
      if (!(profile.capabilityTierId in config.capabilityTiers)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `capabilityTierId ${profile.capabilityTierId} is not defined`,
          path: ['profiles', index, 'capabilityTierId'],
        });
      }

      if (!(profile.memoryLanePolicyId in config.memoryLanePolicies)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `memoryLanePolicyId ${profile.memoryLanePolicyId} is not defined`,
          path: ['profiles', index, 'memoryLanePolicyId'],
        });
      }

      if (!(profile.modelPolicyId in config.modelPolicies)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `modelPolicyId ${profile.modelPolicyId} is not defined`,
          path: ['profiles', index, 'modelPolicyId'],
        });
      }

      if (!(profile.safetyPolicyId in config.safetyPolicies)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `safetyPolicyId ${profile.safetyPolicyId} is not defined`,
          path: ['profiles', index, 'safetyPolicyId'],
        });
      }
    }
  });

const ControlPlaneLoaderProfileSchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();

const ControlPlaneLoaderSchema = z
  .object({
    activeProfile: z.string().min(1),
    profiles: z.record(z.string().min(1), ControlPlaneLoaderProfileSchema),
  })
  .strict();

const FamilyConfigMemberSchema = z
  .object({
    memberId: z.string().min(1),
    displayName: z.string().min(1),
    role: MemberRoleSchema,
    profileId: z.string().min(1).optional(),
    ageGroup: AgeGroupSchema.optional(),
    parentalVisibility: z.boolean().optional(),
    telegramUserIds: z.array(z.number().int().positive()).min(1),
  })
  .strict();

const FamilyControlPlaneSummarySchema = z
  .object({
    policyVersion: z.string().min(1),
    activeProfileId: z.string().min(1),
    profiles: z.array(ControlPlaneProfileSchema).min(1),
    scopes: z.array(ControlPlaneScopeSchema).min(1),
    capabilityTiers: z.record(z.string().min(1), CapabilityTierSchema),
    memoryLanePolicies: z.record(z.string().min(1), MemoryLanePolicySchema),
    modelPolicies: z.record(z.string().min(1), ModelPolicySchema),
    safetyPolicies: z.record(z.string().min(1), SafetyPolicySchema),
    operations: OperationsPolicySchema.optional(),
  })
  .strict();

export const FAMILY_CONFIG_SCHEMA = z
  .object({
    schemaVersion: z.union([
      z.literal(LEGACY_FAMILY_SCHEMA_VERSION),
      z.literal(CONTROL_PLANE_SCHEMA_VERSION),
    ]),
    familyId: z.string().min(1),
    members: z.array(FamilyConfigMemberSchema).min(1),
    parentsGroup: ParentsGroupSchema.optional(),
    controlPlane: FamilyControlPlaneSummarySchema.optional(),
    onboarding: ONBOARDING_CONTRACT_SCHEMA.optional(),
  })
  .strict();

type FamilyConfigSchema = z.infer<typeof FAMILY_CONFIG_SCHEMA>;

export type FamilyConfig = Omit<FamilyConfigSchema, 'onboarding'> & {
  onboarding?: OnboardingContract;
};

export type FamilyConfigLoadOptions = {
  env?: NodeJS.ProcessEnv;
  haloHome?: string;
};

const resolveDefaultFamilyConfigPath = (haloHome: string): string => {
  return join(haloHome, DEFAULT_FAMILY_CONFIG_RELATIVE_PATH);
};

export function getFamilyConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolveDefaultFamilyConfigPath(getHaloHome(env));
}

const formatZodIssues = (error: ZodError): string => {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
};

const resolveRelativeConfigPath = (haloHome: string, configuredPath: string): string => {
  if (isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return join(haloHome, configuredPath);
};

const getControlPlanePathFromConfig = async (
  haloHome: string,
  sourceEnv: NodeJS.ProcessEnv,
): Promise<string | null> => {
  const overridePath = sourceEnv.HALO_CONTROL_PLANE_PATH?.trim();
  if (overridePath) {
    return resolveRelativeConfigPath(haloHome, overridePath);
  }

  const configPath = join(haloHome, 'config.json');
  if (!existsSync(configPath)) {
    return null;
  }

  const raw = await readFile(configPath, 'utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Family config profile resolution failed for ${configPath}: ${message}`);
  }

  const parsedObject = z
    .object({
      controlPlane: ControlPlaneLoaderSchema.optional(),
    })
    .passthrough()
    .safeParse(parsed);

  if (!parsedObject.success) {
    const details = formatZodIssues(parsedObject.error);
    throw new Error(
      `Family config profile resolution failed for ${configPath}: ${details}`,
    );
  }

  if (!parsedObject.data.controlPlane) {
    return null;
  }

  const configuredProfileOverride = sourceEnv.HALO_CONTROL_PLANE_PROFILE?.trim();
  const activeProfile =
    configuredProfileOverride && configuredProfileOverride.length > 0
      ? configuredProfileOverride
      : parsedObject.data.controlPlane.activeProfile;

  const selectedProfile = parsedObject.data.controlPlane.profiles[activeProfile];
  if (!selectedProfile) {
    throw new Error(
      `Family config profile resolution failed for ${configPath}: active profile ${activeProfile} is not defined`,
    );
  }

  return resolveRelativeConfigPath(haloHome, selectedProfile.path);
};

const normalizeLegacyFamilyConfig = (
  config: z.infer<typeof LegacyFamilyConfigSchema>,
): FamilyConfig => {
  const normalized = {
    schemaVersion: config.schemaVersion,
    familyId: config.familyId,
    members: config.members,
    parentsGroup: config.parentsGroup,
    onboarding: config.onboarding,
  };

  return FAMILY_CONFIG_SCHEMA.parse(normalized);
};

const normalizeControlPlaneConfig = (
  config: z.infer<typeof ControlPlaneConfigSchema>,
): FamilyConfig => {
  const parentsGroupScope = config.scopes.find(
    (scope) => scope.scopeType === 'parents_group',
  );

  const normalizedMembers = config.members.map((member) => {
    return {
      memberId: member.memberId,
      displayName: member.displayName,
      role: member.role,
      profileId: member.profileId,
      parentalVisibility: member.parentalVisibility,
      telegramUserIds: member.telegramUserIds,
    };
  });

  const normalized = {
    schemaVersion: config.schemaVersion,
    familyId: config.familyId,
    members: normalizedMembers,
    parentsGroup: {
      telegramChatId: parentsGroupScope?.telegramChatId ?? null,
    },
    controlPlane: {
      policyVersion: config.policyVersion,
      activeProfileId: config.activeProfileId,
      profiles: config.profiles,
      scopes: config.scopes,
      capabilityTiers: config.capabilityTiers,
      memoryLanePolicies: config.memoryLanePolicies,
      modelPolicies: config.modelPolicies,
      safetyPolicies: config.safetyPolicies,
      operations: config.operations,
    },
    onboarding: config.onboarding,
  };

  return FAMILY_CONFIG_SCHEMA.parse(normalized);
};

function parseFamilyConfig(data: unknown, sourcePath = 'family config'): FamilyConfig {
  const schemaVersion = z
    .object({
      schemaVersion: z.number(),
    })
    .passthrough()
    .safeParse(data);

  if (schemaVersion.success && schemaVersion.data.schemaVersion === CONTROL_PLANE_SCHEMA_VERSION) {
    const parsed = ControlPlaneConfigSchema.safeParse(data);
    if (parsed.success) {
      return normalizeControlPlaneConfig(parsed.data);
    }

    const details = formatZodIssues(parsed.error);
    throw new Error(`Family config at ${sourcePath} failed validation: ${details}`);
  }

  const legacyParsed = LegacyFamilyConfigSchema.safeParse(data);
  if (legacyParsed.success) {
    return normalizeLegacyFamilyConfig(legacyParsed.data);
  }

  const details = formatZodIssues(legacyParsed.error);
  throw new Error(`Family config at ${sourcePath} failed validation: ${details}`);
}

const hasErrorCode = (err: unknown): err is { code: string } => {
  return Boolean(err && typeof err === 'object' && 'code' in err);
};

export async function resolveFamilyConfigPath(
  options: FamilyConfigLoadOptions = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const haloHome = options.haloHome ?? getHaloHome(env);
  const controlPlanePath = await getControlPlanePathFromConfig(haloHome, env);
  return controlPlanePath ?? resolveDefaultFamilyConfigPath(haloHome);
}

export async function loadFamilyConfig(
  options: FamilyConfigLoadOptions = {},
): Promise<FamilyConfig> {
  const env = options.env ?? process.env;
  const haloHome = options.haloHome ?? getHaloHome(env);

  const configPath = await resolveFamilyConfigPath({ env, haloHome });

  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (err) {
    if (hasErrorCode(err) && err.code === 'ENOENT') {
      throw new Error(
        `Family config not found at ${configPath}. Set HALO_HOME or create the file.`,
      );
    }
    throw err;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Family config at ${configPath} is not valid JSON: ${message}`);
  }

  return parseFamilyConfig(parsedJson, configPath);
}
