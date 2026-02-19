type CitationStorageMetadata = {
  laneId?: string | null;
  scopeId?: string | null;
};

type CitationFileRecord = {
  filename: string;
  storageMetadata?: CitationStorageMetadata;
};

type BuildScopeCitationPolicyInput = {
  files: CitationFileRecord[];
  allowedLaneIds: string[];
  allowedScopeIds: string[];
};

export type ScopeCitationPolicy = {
  disallowedFilenames: string[];
};

export const CITATION_POLICY_BLOCK_MESSAGE =
  'I can’t cite restricted files in this chat. Ask from the right chat or re-upload with the right policy lane.';

const stableUnique = (values: string[]): string[] => {
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

function isMetadataAllowed(
  metadata: CitationStorageMetadata | undefined,
  allowedLaneIds: Set<string>,
  allowedScopeIds: Set<string>,
): boolean {
  if (!metadata) {
    return allowedLaneIds.size === 0 && allowedScopeIds.size === 0;
  }

  const laneId = metadata.laneId?.trim() ?? '';
  const scopeId = metadata.scopeId?.trim() ?? '';

  if (allowedLaneIds.size > 0 && !allowedLaneIds.has(laneId)) {
    return false;
  }

  if (allowedScopeIds.size > 0 && !allowedScopeIds.has(scopeId)) {
    return false;
  }

  return true;
}

export function buildScopeCitationPolicy(
  input: BuildScopeCitationPolicyInput,
): ScopeCitationPolicy {
  const allowedLaneIds = new Set(stableUnique(input.allowedLaneIds));
  const allowedScopeIds = new Set(stableUnique(input.allowedScopeIds));

  const disallowedFilenames: string[] = [];

  for (const file of input.files) {
    const allowed = isMetadataAllowed(
      file.storageMetadata,
      allowedLaneIds,
      allowedScopeIds,
    );

    if (allowed) {
      continue;
    }

    disallowedFilenames.push(file.filename);
  }

  return {
    disallowedFilenames: stableUnique(disallowedFilenames),
  };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function outputMentionsFilename(output: string, filename: string): boolean {
  const normalizedFilename = filename.trim().toLowerCase();

  if (!normalizedFilename) {
    return false;
  }

  const pattern = new RegExp(
    `(?:^|[\\s/\\\\,;:"'(\\[{.!?])${escapeRegex(normalizedFilename)}(?:$|[\\s/\\\\,;:"'\\])}.!?])`,
    'i',
  );

  return pattern.test(output);
}

export function applyScopeCitationPolicy(
  output: string,
  policy: ScopeCitationPolicy,
): { output: string; blocked: boolean } {
  for (const filename of policy.disallowedFilenames) {
    if (outputMentionsFilename(output, filename)) {
      return {
        output: CITATION_POLICY_BLOCK_MESSAGE,
        blocked: true,
      };
    }
  }

  return {
    output,
    blocked: false,
  };
}
