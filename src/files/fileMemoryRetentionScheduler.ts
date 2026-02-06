import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { deleteScopeUploadedFile } from './fileMemoryLifecycle.js';
import type { ScopeFileRecord, ScopeFileRegistry } from './scopeFileRegistry.js';

type RetentionPolicyPreset =
  | 'all'
  | 'parents_only'
  | 'exclude_children'
  | 'custom';

type FileMemoryRetentionConfig = {
  enabled?: boolean;
  maxAgeDays?: number;
  runIntervalMinutes?: number;
  deleteOpenAIFiles?: boolean;
  maxFilesPerRun?: number;
  dryRun?: boolean;
  keepRecentPerScope?: number;
  maxDeletesPerScopePerRun?: number;
  allowScopeIds?: string[];
  denyScopeIds?: string[];
  policyPreset?: RetentionPolicyPreset;
};

type FileMemoryConfig = {
  enabled?: boolean;
  retention?: FileMemoryRetentionConfig;
};

type DeleteScopeFileResult =
  | { ok: true }
  | { ok: false; code?: string; message: string };

export type FileMemoryRetentionRunOptions = {
  scopeId?: string;
  dryRun?: boolean;
  uploadedBy?: string[];
  extensions?: string[];
  mimePrefixes?: string[];
  uploadedAfterMs?: number;
  uploadedBeforeMs?: number;
};

type FileMemoryRetentionSchedulerOptions = {
  rootDir: string;
  fileMemoryConfig?: FileMemoryConfig;
  memberRolesById?: Record<string, 'parent' | 'child'>;
  listScopeRegistries?: (rootDir: string) => Promise<ScopeFileRegistry[]>;
  deleteScopedFile?: (input: {
    rootDir: string;
    scopeId: string;
    fileRef: string;
    deleteOpenAIFile: boolean;
  }) => Promise<DeleteScopeFileResult>;
  logger?: Pick<Console, 'error'>;
  nowMs?: () => number;
};

type ResolvedRetentionConfig = {
  maxAgeDays: number;
  intervalMs: number;
  deleteOpenAIFiles: boolean;
  maxFilesPerRun: number;
  dryRun: boolean;
  keepRecentPerScope: number;
  maxDeletesPerScopePerRun: number;
  allowScopeIds: string[];
  denyScopeIds: string[];
  policyPreset: RetentionPolicyPreset;
};

type RetentionMetadataFilters = {
  uploadedBy: string[];
  extensions: string[];
  mimePrefixes: string[];
  uploadedAfterMs: number | null;
  uploadedBeforeMs: number | null;
};

type RetentionError = {
  scopeId?: string;
  fileRef?: string;
  message: string;
  atMs: number;
};

type RetentionRunSummary = {
  scopeCount: number;
  staleCount: number;
  candidateCount: number;
  attemptedCount: number;
  deletedCount: number;
  failedCount: number;
  dryRun: boolean;
  skippedDryRunCount: number;
  skippedInProgressCount: number;
  protectedRecentCount: number;
  deferredByRunCapCount: number;
  deferredByScopeCapCount: number;
  excludedByAllowCount: number;
  excludedByDenyCount: number;
  excludedByPresetCount: number;
  excludedByUploaderCount: number;
  excludedByTypeCount: number;
  excludedByDateCount: number;
  filters: RetentionMetadataFilters;
};

export type FileMemoryRetentionStatusSnapshot = {
  enabled: boolean;
  intervalMinutes: number | null;
  maxAgeDays: number | null;
  deleteOpenAIFiles: boolean;
  maxFilesPerRun: number | null;
  dryRun: boolean;
  keepRecentPerScope: number | null;
  maxDeletesPerScopePerRun: number | null;
  allowScopeIds: string[];
  denyScopeIds: string[];
  policyPreset: RetentionPolicyPreset;
  running: boolean;
  lastRunStartedAtMs: number | null;
  lastRunFinishedAtMs: number | null;
  lastSuccessAtMs: number | null;
  totalRuns: number;
  totalDeleted: number;
  totalFailures: number;
  lastError: RetentionError | null;
  lastRunSummary: RetentionRunSummary | null;
};

type InternalStatus = {
  running: boolean;
  lastRunStartedAtMs: number | null;
  lastRunFinishedAtMs: number | null;
  lastSuccessAtMs: number | null;
  totalRuns: number;
  totalDeleted: number;
  totalFailures: number;
  lastError: RetentionError | null;
  lastRunSummary: RetentionRunSummary | null;
};

type RetentionCandidate = {
  scopeId: string;
  fileRef: string;
  uploadedAtMs: number;
};

type RetentionPlan = {
  scopeCount: number;
  staleCount: number;
  skippedInProgressCount: number;
  protectedRecentCount: number;
  deferredByRunCapCount: number;
  deferredByScopeCapCount: number;
  excludedByAllowCount: number;
  excludedByDenyCount: number;
  excludedByPresetCount: number;
  excludedByUploaderCount: number;
  excludedByTypeCount: number;
  excludedByDateCount: number;
  filters: RetentionMetadataFilters;
  candidates: RetentionCandidate[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_RETENTION_MAX_AGE_DAYS = 30;
const DEFAULT_RETENTION_INTERVAL_MINUTES = 360;
const DEFAULT_RETENTION_MAX_FILES_PER_RUN = 25;
const DEFAULT_RETENTION_DRY_RUN = false;
const DEFAULT_KEEP_RECENT_PER_SCOPE = 2;
const DEFAULT_MAX_DELETES_PER_SCOPE_PER_RUN = 10;
const DEFAULT_RETENTION_POLICY_PRESET: RetentionPolicyPreset = 'exclude_children';

const resolveRetentionConfig = (
  fileMemoryConfig?: FileMemoryConfig,
): ResolvedRetentionConfig | null => {
  if (!fileMemoryConfig?.enabled) return null;
  if (!fileMemoryConfig.retention?.enabled) return null;

  const maxAgeDays =
    fileMemoryConfig.retention.maxAgeDays ?? DEFAULT_RETENTION_MAX_AGE_DAYS;
  const intervalMinutes =
    fileMemoryConfig.retention.runIntervalMinutes ??
    DEFAULT_RETENTION_INTERVAL_MINUTES;
  const maxFilesPerRun =
    fileMemoryConfig.retention.maxFilesPerRun ??
    DEFAULT_RETENTION_MAX_FILES_PER_RUN;
  const dryRun = fileMemoryConfig.retention.dryRun ?? DEFAULT_RETENTION_DRY_RUN;
  const keepRecentPerScope =
    fileMemoryConfig.retention.keepRecentPerScope ?? DEFAULT_KEEP_RECENT_PER_SCOPE;
  const maxDeletesPerScopePerRun =
    fileMemoryConfig.retention.maxDeletesPerScopePerRun ??
    DEFAULT_MAX_DELETES_PER_SCOPE_PER_RUN;

  const allowScopeIds = Array.from(
    new Set(
      (fileMemoryConfig.retention.allowScopeIds ?? [])
        .map((scopeId) => scopeId.trim())
        .filter(Boolean),
    ),
  );
  const denyScopeIds = Array.from(
    new Set(
      (fileMemoryConfig.retention.denyScopeIds ?? [])
        .map((scopeId) => scopeId.trim())
        .filter(Boolean),
    ),
  );
  const policyPreset =
    fileMemoryConfig.retention.policyPreset ?? DEFAULT_RETENTION_POLICY_PRESET;

  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) return null;
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return null;
  if (!Number.isFinite(maxFilesPerRun) || maxFilesPerRun <= 0) return null;
  if (!Number.isFinite(keepRecentPerScope) || keepRecentPerScope < 0) return null;
  if (!Number.isFinite(maxDeletesPerScopePerRun) || maxDeletesPerScopePerRun <= 0) {
    return null;
  }

  return {
    maxAgeDays,
    intervalMs: intervalMinutes * 60 * 1000,
    deleteOpenAIFiles: fileMemoryConfig.retention.deleteOpenAIFiles ?? false,
    maxFilesPerRun,
    dryRun,
    keepRecentPerScope,
    maxDeletesPerScopePerRun,
    allowScopeIds,
    denyScopeIds,
    policyPreset,
  };
};

function normalizeOptionalId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeScopeFileRecord(value: unknown): ScopeFileRecord | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Partial<ScopeFileRecord>;
  if (
    typeof record.telegramFileId !== 'string' ||
    typeof record.telegramFileUniqueId !== 'string' ||
    typeof record.filename !== 'string' ||
    typeof record.mimeType !== 'string' ||
    typeof record.sizeBytes !== 'number' ||
    (record.status !== 'in_progress' &&
      record.status !== 'completed' &&
      record.status !== 'failed') ||
    (record.lastError !== null && typeof record.lastError !== 'string') ||
    typeof record.uploadedBy !== 'string' ||
    typeof record.uploadedAtMs !== 'number'
  ) {
    return null;
  }

  return {
    telegramFileId: record.telegramFileId,
    telegramFileUniqueId: record.telegramFileUniqueId,
    filename: record.filename,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    openaiFileId: normalizeOptionalId(record.openaiFileId),
    vectorStoreFileId: normalizeOptionalId(record.vectorStoreFileId),
    status: record.status,
    lastError: record.lastError,
    uploadedBy: record.uploadedBy,
    uploadedAtMs: record.uploadedAtMs,
  };
}

function normalizeScopeFileRegistry(raw: unknown): ScopeFileRegistry | null {
  if (!raw || typeof raw !== 'object') return null;

  const registry = raw as Partial<ScopeFileRegistry>;
  if (typeof registry.scopeId !== 'string' || !Array.isArray(registry.files)) {
    return null;
  }

  const files = registry.files
    .map((file) => normalizeScopeFileRecord(file))
    .filter((file): file is ScopeFileRecord => Boolean(file));

  return {
    scopeId: registry.scopeId,
    vectorStoreId:
      typeof registry.vectorStoreId === 'string' ? registry.vectorStoreId : null,
    createdAtMs:
      typeof registry.createdAtMs === 'number' ? registry.createdAtMs : 0,
    updatedAtMs:
      typeof registry.updatedAtMs === 'number' ? registry.updatedAtMs : 0,
    files,
  };
}

async function listScopeRegistriesFromDisk(rootDir: string): Promise<ScopeFileRegistry[]> {
  const scopesRoot = path.join(rootDir, 'file-memory', 'scopes');

  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    entries = await readdir(scopesRoot, { withFileTypes: true });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code?: unknown }).code;
      if (code === 'ENOENT') return [];
    }
    throw err;
  }

  const registries: ScopeFileRegistry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const registryPath = path.join(scopesRoot, entry.name, 'registry.json');

    try {
      const raw = await readFile(registryPath, 'utf8');
      const parsed = normalizeScopeFileRegistry(JSON.parse(raw));
      if (parsed) {
        registries.push(parsed);
      }
    } catch {
      // Skip malformed/unreadable scope registry files.
    }
  }

  return registries;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }

  if (err && typeof err === 'object' && 'message' in err) {
    const value = (err as { message?: unknown }).message;
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return String(err);
}

const serializeError = (err: unknown) => {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }

  return String(err);
};

type ScopeClass =
  | 'parent'
  | 'child'
  | 'parents_group'
  | 'unknown_member'
  | 'other';

function classifyScope(
  scopeId: string,
  memberRolesById: Record<string, 'parent' | 'child'>,
): ScopeClass {
  if (scopeId.startsWith('telegram:parents_group:')) {
    return 'parents_group';
  }

  if (scopeId.startsWith('telegram:dm:')) {
    const memberId = scopeId.slice('telegram:dm:'.length).trim();
    if (!memberId) return 'unknown_member';

    const role = memberRolesById[memberId];
    if (role === 'parent') return 'parent';
    if (role === 'child') return 'child';
    return 'unknown_member';
  }

  return 'other';
}

function allowsByPreset(
  preset: RetentionPolicyPreset,
  scopeClass: ScopeClass,
): boolean {
  if (preset === 'all' || preset === 'custom') {
    return true;
  }

  if (preset === 'parents_only') {
    return scopeClass === 'parent' || scopeClass === 'parents_group';
  }

  // exclude_children
  return scopeClass !== 'child';
}

const normalizeStringList = (
  values: string[] | undefined,
  transform: (value: string) => string = (value) => value,
): string[] => {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => transform(value.trim()))
        .filter(Boolean),
    ),
  );
};

const normalizeRetentionFilters = (
  runOptions: FileMemoryRetentionRunOptions,
): RetentionMetadataFilters => {
  let uploadedAfterMs =
    Number.isFinite(runOptions.uploadedAfterMs) &&
    (runOptions.uploadedAfterMs ?? 0) >= 0
      ? Math.floor(runOptions.uploadedAfterMs ?? 0)
      : null;

  let uploadedBeforeMs =
    Number.isFinite(runOptions.uploadedBeforeMs) &&
    (runOptions.uploadedBeforeMs ?? 0) >= 0
      ? Math.floor(runOptions.uploadedBeforeMs ?? 0)
      : null;

  if (
    uploadedAfterMs !== null &&
    uploadedBeforeMs !== null &&
    uploadedAfterMs > uploadedBeforeMs
  ) {
    const swappedAfter = uploadedBeforeMs;
    uploadedBeforeMs = uploadedAfterMs;
    uploadedAfterMs = swappedAfter;
  }

  return {
    uploadedBy: normalizeStringList(runOptions.uploadedBy),
    extensions: normalizeStringList(runOptions.extensions, (value) =>
      value.startsWith('.') ? value.slice(1).toLowerCase() : value.toLowerCase(),
    ),
    mimePrefixes: normalizeStringList(runOptions.mimePrefixes, (value) =>
      value.toLowerCase(),
    ),
    uploadedAfterMs,
    uploadedBeforeMs,
  };
};

const getFileExtension = (filename: string): string | null => {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === filename.length - 1) return null;
  return filename.slice(dotIndex + 1).toLowerCase();
};

function collectRetentionPlan(
  registries: ScopeFileRegistry[],
  cutoffMs: number,
  config: ResolvedRetentionConfig,
  memberRolesById: Record<string, 'parent' | 'child'>,
  filters: RetentionMetadataFilters,
): RetentionPlan {
  const rawCandidates: RetentionCandidate[] = [];

  let staleCount = 0;
  let skippedInProgressCount = 0;
  let protectedRecentCount = 0;
  let excludedByAllowCount = 0;
  let excludedByDenyCount = 0;
  let excludedByPresetCount = 0;
  let excludedByUploaderCount = 0;
  let excludedByTypeCount = 0;
  let excludedByDateCount = 0;

  const hasAllowList = config.allowScopeIds.length > 0;
  const allowSet = new Set(config.allowScopeIds);
  const denySet = new Set(config.denyScopeIds);
  const uploaderSet =
    filters.uploadedBy.length > 0 ? new Set(filters.uploadedBy) : null;
  const extensionSet =
    filters.extensions.length > 0 ? new Set(filters.extensions) : null;

  const filteredRegistries = registries.filter((registry) => {
    if (denySet.has(registry.scopeId)) {
      excludedByDenyCount += 1;
      return false;
    }

    if (hasAllowList && !allowSet.has(registry.scopeId)) {
      excludedByAllowCount += 1;
      return false;
    }

    const scopeClass = classifyScope(registry.scopeId, memberRolesById);
    if (!allowsByPreset(config.policyPreset, scopeClass)) {
      excludedByPresetCount += 1;
      return false;
    }

    return true;
  });

  for (const registry of filteredRegistries) {
    const inProgressCount = registry.files.filter(
      (file) => file.status === 'in_progress',
    ).length;
    skippedInProgressCount += inProgressCount;

    const eligible = registry.files
      .filter((file) => file.status !== 'in_progress')
      .sort((a, b) => b.uploadedAtMs - a.uploadedAtMs);

    const protectedRecent = new Set(
      eligible
        .slice(0, config.keepRecentPerScope)
        .map((file) => file.telegramFileUniqueId),
    );

    const stale = eligible.filter((file) => file.uploadedAtMs <= cutoffMs);
    staleCount += stale.length;

    for (const file of stale) {
      if (protectedRecent.has(file.telegramFileUniqueId)) {
        protectedRecentCount += 1;
        continue;
      }

      if (uploaderSet && !uploaderSet.has(file.uploadedBy)) {
        excludedByUploaderCount += 1;
        continue;
      }

      if (
        (filters.uploadedAfterMs !== null && file.uploadedAtMs < filters.uploadedAfterMs) ||
        (filters.uploadedBeforeMs !== null && file.uploadedAtMs > filters.uploadedBeforeMs)
      ) {
        excludedByDateCount += 1;
        continue;
      }

      if (extensionSet || filters.mimePrefixes.length > 0) {
        const fileExtension = getFileExtension(file.filename);
        const extensionMatches = extensionSet
          ? Boolean(fileExtension && extensionSet.has(fileExtension))
          : true;

        const mimeType = file.mimeType.toLowerCase();
        const mimeMatches =
          filters.mimePrefixes.length > 0
            ? filters.mimePrefixes.some((prefix) => mimeType.startsWith(prefix))
            : true;

        if (!extensionMatches || !mimeMatches) {
          excludedByTypeCount += 1;
          continue;
        }
      }

      rawCandidates.push({
        scopeId: registry.scopeId,
        fileRef: file.telegramFileUniqueId,
        uploadedAtMs: file.uploadedAtMs,
      });
    }
  }

  const sorted = rawCandidates.sort((a, b) => a.uploadedAtMs - b.uploadedAtMs);

  const candidates: RetentionCandidate[] = [];
  const perScopeCount = new Map<string, number>();

  let deferredByRunCapCount = 0;
  let deferredByScopeCapCount = 0;

  for (const candidate of sorted) {
    if (candidates.length >= config.maxFilesPerRun) {
      deferredByRunCapCount += 1;
      continue;
    }

    const currentScopeCount = perScopeCount.get(candidate.scopeId) ?? 0;
    if (currentScopeCount >= config.maxDeletesPerScopePerRun) {
      deferredByScopeCapCount += 1;
      continue;
    }

    candidates.push(candidate);
    perScopeCount.set(candidate.scopeId, currentScopeCount + 1);
  }

  return {
    scopeCount: filteredRegistries.length,
    staleCount,
    skippedInProgressCount,
    protectedRecentCount,
    deferredByRunCapCount,
    deferredByScopeCapCount,
    excludedByAllowCount,
    excludedByDenyCount,
    excludedByPresetCount,
    excludedByUploaderCount,
    excludedByTypeCount,
    excludedByDateCount,
    filters,
    candidates,
  };
}

export function createFileMemoryRetentionScheduler(
  options: FileMemoryRetentionSchedulerOptions,
) {
  const resolved = resolveRetentionConfig(options.fileMemoryConfig);
  const logger = options.logger ?? console;
  const nowMs = options.nowMs ?? (() => Date.now());
  const memberRolesById = options.memberRolesById ?? {};

  const listScopeRegistries =
    options.listScopeRegistries ?? listScopeRegistriesFromDisk;

  const deleteScopedFile =
    options.deleteScopedFile ??
    (async ({ rootDir, scopeId, fileRef, deleteOpenAIFile }) =>
      await deleteScopeUploadedFile({
        rootDir,
        scopeId,
        fileRef,
        deleteOpenAIFile,
      }));

  let intervalHandle: NodeJS.Timeout | null = null;
  let queueDrainPromise: Promise<void> | null = null;
  const pendingRuns: Array<{
    options: FileMemoryRetentionRunOptions;
    resolve: () => void;
    reject: (err: unknown) => void;
  }> = [];

  const status: InternalStatus = {
    running: false,
    lastRunStartedAtMs: null,
    lastRunFinishedAtMs: null,
    lastSuccessAtMs: null,
    totalRuns: 0,
    totalDeleted: 0,
    totalFailures: 0,
    lastError: null,
    lastRunSummary: null,
  };

  const setLastError = (message: string, scopeId?: string, fileRef?: string) => {
    status.lastError = {
      scopeId,
      fileRef,
      message,
      atMs: nowMs(),
    };
  };

  const executeRun = async (
    runOptions: FileMemoryRetentionRunOptions = {},
  ): Promise<void> => {
    if (!resolved) return;

    status.running = true;
    status.totalRuns += 1;
    status.lastRunStartedAtMs = nowMs();

    let runFailed = false;

    try {
      const cutoffMs = nowMs() - resolved.maxAgeDays * DAY_MS;
      const allRegistries = await listScopeRegistries(options.rootDir);

      const requestedScopeId = runOptions.scopeId?.trim();
      const registries = requestedScopeId
        ? allRegistries.filter((registry) => registry.scopeId === requestedScopeId)
        : allRegistries;

      const effectiveFilters = normalizeRetentionFilters(runOptions);

      const plan = collectRetentionPlan(
        registries,
        cutoffMs,
        resolved,
        memberRolesById,
        effectiveFilters,
      );

      const effectiveDryRun = runOptions.dryRun ?? resolved.dryRun;

      let attemptedCount = 0;
      let deletedCount = 0;
      let failedCount = 0;
      let skippedDryRunCount = 0;

      if (effectiveDryRun) {
        skippedDryRunCount = plan.candidates.length;
      } else {
        for (const candidate of plan.candidates) {
          attemptedCount += 1;

          try {
            const result = await deleteScopedFile({
              rootDir: options.rootDir,
              scopeId: candidate.scopeId,
              fileRef: candidate.fileRef,
              deleteOpenAIFile: resolved.deleteOpenAIFiles,
            });

            if (!result.ok) {
              runFailed = true;
              failedCount += 1;
              status.totalFailures += 1;
              setLastError(result.message, candidate.scopeId, candidate.fileRef);
              continue;
            }

            deletedCount += 1;
            status.totalDeleted += 1;
          } catch (err) {
            runFailed = true;
            failedCount += 1;
            status.totalFailures += 1;
            setLastError(toErrorMessage(err), candidate.scopeId, candidate.fileRef);
            logger.error('halo: file retention delete failed', {
              scopeId: candidate.scopeId,
              fileRef: candidate.fileRef,
              error: serializeError(err),
            });
          }
        }
      }

      status.lastRunSummary = {
        scopeCount: plan.scopeCount,
        staleCount: plan.staleCount,
        candidateCount: plan.candidates.length,
        attemptedCount,
        deletedCount,
        failedCount,
        dryRun: effectiveDryRun,
        skippedDryRunCount,
        skippedInProgressCount: plan.skippedInProgressCount,
        protectedRecentCount: plan.protectedRecentCount,
        deferredByRunCapCount: plan.deferredByRunCapCount,
        deferredByScopeCapCount: plan.deferredByScopeCapCount,
        excludedByAllowCount: plan.excludedByAllowCount,
        excludedByDenyCount: plan.excludedByDenyCount,
        excludedByPresetCount: plan.excludedByPresetCount,
        excludedByUploaderCount: plan.excludedByUploaderCount,
        excludedByTypeCount: plan.excludedByTypeCount,
        excludedByDateCount: plan.excludedByDateCount,
        filters: {
          uploadedBy: [...plan.filters.uploadedBy],
          extensions: [...plan.filters.extensions],
          mimePrefixes: [...plan.filters.mimePrefixes],
          uploadedAfterMs: plan.filters.uploadedAfterMs,
          uploadedBeforeMs: plan.filters.uploadedBeforeMs,
        },
      };
    } catch (err) {
      runFailed = true;
      status.totalFailures += 1;
      setLastError(toErrorMessage(err));
      logger.error('halo: file retention run failed', {
        error: serializeError(err),
      });
    } finally {
      if (!runFailed) {
        status.lastSuccessAtMs = nowMs();
      }

      status.running = false;
      status.lastRunFinishedAtMs = nowMs();
    }
  };

  const drainRunQueue = async () => {
    if (queueDrainPromise) return queueDrainPromise;

    queueDrainPromise = (async () => {
      while (pendingRuns.length > 0) {
        const request = pendingRuns.shift();
        if (!request) continue;

        try {
          await executeRun(request.options);
          request.resolve();
        } catch (err) {
          request.reject(err);
        }
      }
    })().finally(() => {
      queueDrainPromise = null;
    });

    return queueDrainPromise;
  };

  const runNow = async (runOptions: FileMemoryRetentionRunOptions = {}): Promise<void> => {
    if (!resolved) return;

    return await new Promise<void>((resolve, reject) => {
      pendingRuns.push({
        options: { ...runOptions },
        resolve,
        reject,
      });

      void drainRunQueue();
    });
  };

  const start = () => {
    if (!resolved) return;
    if (intervalHandle) return;

    void runNow();

    intervalHandle = setInterval(() => {
      void runNow();
    }, resolved.intervalMs);

    intervalHandle.unref?.();
  };

  const stop = () => {
    if (!intervalHandle) return;
    clearInterval(intervalHandle);
    intervalHandle = null;
  };

  const getStatus = (): FileMemoryRetentionStatusSnapshot => {
    return {
      enabled: Boolean(resolved),
      intervalMinutes: resolved ? resolved.intervalMs / (60 * 1000) : null,
      maxAgeDays: resolved ? resolved.maxAgeDays : null,
      deleteOpenAIFiles: resolved?.deleteOpenAIFiles ?? false,
      maxFilesPerRun: resolved ? resolved.maxFilesPerRun : null,
      dryRun: resolved?.dryRun ?? false,
      keepRecentPerScope: resolved ? resolved.keepRecentPerScope : null,
      maxDeletesPerScopePerRun: resolved
        ? resolved.maxDeletesPerScopePerRun
        : null,
      allowScopeIds: resolved ? [...resolved.allowScopeIds] : [],
      denyScopeIds: resolved ? [...resolved.denyScopeIds] : [],
      policyPreset: resolved?.policyPreset ?? DEFAULT_RETENTION_POLICY_PRESET,
      running: status.running,
      lastRunStartedAtMs: status.lastRunStartedAtMs,
      lastRunFinishedAtMs: status.lastRunFinishedAtMs,
      lastSuccessAtMs: status.lastSuccessAtMs,
      totalRuns: status.totalRuns,
      totalDeleted: status.totalDeleted,
      totalFailures: status.totalFailures,
      lastError: status.lastError ? { ...status.lastError } : null,
      lastRunSummary: status.lastRunSummary
        ? {
            ...status.lastRunSummary,
            filters: {
              uploadedBy: [...status.lastRunSummary.filters.uploadedBy],
              extensions: [...status.lastRunSummary.filters.extensions],
              mimePrefixes: [...status.lastRunSummary.filters.mimePrefixes],
              uploadedAfterMs: status.lastRunSummary.filters.uploadedAfterMs,
              uploadedBeforeMs: status.lastRunSummary.filters.uploadedBeforeMs,
            },
          }
        : null,
    };
  };

  return {
    isEnabled: () => Boolean(resolved),
    runNow,
    start,
    stop,
    getStatus,
  };
}
