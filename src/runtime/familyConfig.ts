import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z, type ZodError } from 'zod';
import { getHaloHome } from './haloHome.js';

const FAMILY_SCHEMA_VERSION = 1;

const MemberRoleSchema = z.enum(['parent', 'child']);

const MemberSchema = z
  .object({
    memberId: z.string().min(1),
    displayName: z.string().min(1),
    role: MemberRoleSchema,
    telegramUserIds: z.array(z.number().int().positive()).min(1),
  })
  .strict();

const ParentsGroupSchema = z
  .object({
    telegramChatId: z.number().int().nullable(),
  })
  .strict();

export const FAMILY_CONFIG_SCHEMA = z
  .object({
    schemaVersion: z.literal(FAMILY_SCHEMA_VERSION),
    familyId: z.string().min(1),
    members: z.array(MemberSchema).min(1),
    parentsGroup: ParentsGroupSchema.optional(),
  })
  .strict();

export type FamilyConfig = z.infer<typeof FAMILY_CONFIG_SCHEMA>;

export type FamilyConfigLoadOptions = {
  env?: NodeJS.ProcessEnv;
  haloHome?: string;
};

const resolveFamilyConfigPath = (haloHome: string): string => {
  return join(haloHome, 'config', 'family.json');
};

export function getFamilyConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolveFamilyConfigPath(getHaloHome(env));
}

const formatZodIssues = (error: ZodError): string => {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
};

function parseFamilyConfig(
  data: unknown,
  sourcePath = 'family config',
): FamilyConfig {
  const parsed = FAMILY_CONFIG_SCHEMA.safeParse(data);
  if (parsed.success) return parsed.data;

  const details = formatZodIssues(parsed.error);
  throw new Error(`Family config at ${sourcePath} failed validation: ${details}`);
}

const hasErrorCode = (
  err: unknown,
): err is { code: string } => {
  return Boolean(err && typeof err === 'object' && 'code' in err);
};

export async function loadFamilyConfig(
  options: FamilyConfigLoadOptions = {},
): Promise<FamilyConfig> {
  const haloHome = options.haloHome ?? getHaloHome(options.env);
  const configPath = resolveFamilyConfigPath(haloHome);

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
