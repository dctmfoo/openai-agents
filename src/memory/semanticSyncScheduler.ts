import type { SessionStore } from '../sessions/sessionStore.js';
import { SemanticMemory, type SemanticMemoryConfig } from './semanticMemory.js';

type SemanticSearchConfig = {
  fusionMethod?: 'rrf';
  vectorWeight?: number;
  textWeight?: number;
  minScore?: number;
};

type SemanticSyncConfig = {
  enabled?: boolean;
  embeddingProvider?: 'openai' | 'gemini';
  embeddingModel?: string;
  embeddingDimensions?: number;
  vecExtensionPath?: string;
  syncIntervalMinutes?: number;
  search?: SemanticSearchConfig;
};

type SemanticMemoryLike = {
  sync: (semanticConfig: SemanticMemoryConfig) => Promise<void>;
};

type SemanticSyncSchedulerOptions = {
  rootDir: string;
  sessionStore: Pick<SessionStore, 'listScopeIds'>;
  semanticConfig?: SemanticSyncConfig;
  createSemanticMemory?: (
    scopeId: string,
    semanticConfig: SemanticMemoryConfig,
  ) => SemanticMemoryLike;
  logger?: Pick<Console, 'error'>;
};

type ResolvedSemanticSyncConfig = {
  intervalMs: number;
  semanticConfig: SemanticMemoryConfig;
};

type SemanticSyncError = {
  scopeId?: string;
  message: string;
  atMs: number;
};

export type SemanticSyncStatusSnapshot = {
  enabled: boolean;
  intervalMinutes: number | null;
  activeScopeCount: number;
  running: boolean;
  lastRunStartedAtMs: number | null;
  lastRunFinishedAtMs: number | null;
  lastSuccessAtMs: number | null;
  totalRuns: number;
  totalFailures: number;
  lastError: SemanticSyncError | null;
};

type InternalStatus = {
  activeScopeCount: number;
  running: boolean;
  lastRunStartedAtMs: number | null;
  lastRunFinishedAtMs: number | null;
  lastSuccessAtMs: number | null;
  totalRuns: number;
  totalFailures: number;
  lastError: SemanticSyncError | null;
};

const resolveSemanticSyncConfig = (
  config?: SemanticSyncConfig,
): ResolvedSemanticSyncConfig | null => {
  if (!config?.enabled) return null;

  const syncIntervalMinutes = config.syncIntervalMinutes ?? 15;
  if (!Number.isFinite(syncIntervalMinutes) || syncIntervalMinutes <= 0) {
    return null;
  }

  return {
    intervalMs: syncIntervalMinutes * 60 * 1000,
    semanticConfig: {
      enabled: true,
      embeddingProvider: config.embeddingProvider ?? 'openai',
      embeddingModel: config.embeddingModel ?? 'text-embedding-3-small',
      embeddingDimensions: config.embeddingDimensions ?? 1536,
      vecExtensionPath: config.vecExtensionPath,
      search: {
        fusionMethod: 'rrf',
        vectorWeight: config.search?.vectorWeight ?? 0.7,
        textWeight: config.search?.textWeight ?? 0.3,
        minScore: config.search?.minScore ?? 0.005,
      },
    },
  };
};

const toErrorMessage = (err: unknown): string => {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return String(err);
};

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

export function createSemanticSyncScheduler(options: SemanticSyncSchedulerOptions) {
  const resolved = resolveSemanticSyncConfig(options.semanticConfig);
  const logger = options.logger ?? console;

  const createSemanticMemory =
    options.createSemanticMemory ??
    ((scopeId: string, semanticConfig: SemanticMemoryConfig): SemanticMemoryLike => {
      return new SemanticMemory({
        rootDir: options.rootDir,
        scopeId,
        semanticConfig,
      });
    });

  const memoryByScope = new Map<string, SemanticMemoryLike>();
  let intervalHandle: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;

  const status: InternalStatus = {
    activeScopeCount: 0,
    running: false,
    lastRunStartedAtMs: null,
    lastRunFinishedAtMs: null,
    lastSuccessAtMs: null,
    totalRuns: 0,
    totalFailures: 0,
    lastError: null,
  };

  const setLastError = (message: string, scopeId?: string) => {
    status.lastError = {
      scopeId,
      message,
      atMs: Date.now(),
    };
  };

  const runNow = async (): Promise<void> => {
    if (!resolved) return;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      status.running = true;
      status.totalRuns += 1;
      status.lastRunStartedAtMs = Date.now();

      let runFailed = false;

      try {
        const scopeIds = Array.from(new Set(options.sessionStore.listScopeIds())).sort();
        status.activeScopeCount = scopeIds.length;

        const activeScopes = new Set(scopeIds);
        for (const scopeId of memoryByScope.keys()) {
          if (!activeScopes.has(scopeId)) {
            memoryByScope.delete(scopeId);
          }
        }

        for (const scopeId of scopeIds) {
          const semanticMemory =
            memoryByScope.get(scopeId) ??
            createSemanticMemory(scopeId, resolved.semanticConfig);
          memoryByScope.set(scopeId, semanticMemory);

          try {
            await semanticMemory.sync(resolved.semanticConfig);
          } catch (err) {
            runFailed = true;
            status.totalFailures += 1;
            setLastError(toErrorMessage(err), scopeId);
            logger.error('halo: semantic sync failed', {
              scopeId,
              error: serializeError(err),
            });
          }
        }
      } catch (err) {
        runFailed = true;
        status.totalFailures += 1;
        setLastError(toErrorMessage(err));
        logger.error('halo: semantic sync failed', {
          error: serializeError(err),
        });
      } finally {
        if (!runFailed) {
          status.lastSuccessAtMs = Date.now();
        }

        status.running = false;
        status.lastRunFinishedAtMs = Date.now();
      }
    })().finally(() => {
      inFlight = null;
    });

    return inFlight;
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

  const getStatus = (): SemanticSyncStatusSnapshot => {
    return {
      enabled: Boolean(resolved),
      intervalMinutes: resolved ? resolved.intervalMs / (60 * 1000) : null,
      activeScopeCount: status.activeScopeCount,
      running: status.running,
      lastRunStartedAtMs: status.lastRunStartedAtMs,
      lastRunFinishedAtMs: status.lastRunFinishedAtMs,
      lastSuccessAtMs: status.lastSuccessAtMs,
      totalRuns: status.totalRuns,
      totalFailures: status.totalFailures,
      lastError: status.lastError ? { ...status.lastError } : null,
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
