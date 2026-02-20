import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  buildLaneStorageMetadata,
  type LaneStorageMetadata,
} from '../memory/laneTopology.js';
import { hashSessionId } from '../sessions/sessionHash.js';

type ScopeFileRegistryPaths = {
  rootDir: string;
  scopeId: string;
};

export type ScopeFileRecord = {
  telegramFileId: string;
  telegramFileUniqueId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  openaiFileId: string | null;
  vectorStoreFileId: string | null;
  status: 'in_progress' | 'completed' | 'failed';
  lastError: string | null;
  uploadedBy: string;
  uploadedAtMs: number;
  storageMetadata?: LaneStorageMetadata;
};

export type ScopeFileRegistry = {
  scopeId: string;
  vectorStoreId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  files: ScopeFileRecord[];
};

function getRegistryPath(paths: ScopeFileRegistryPaths): string {
  return path.join(
    paths.rootDir,
    'file-memory',
    'scopes',
    hashSessionId(paths.scopeId),
    'registry.json',
  );
}

async function writeRegistry(paths: ScopeFileRegistryPaths, registry: ScopeFileRegistry) {
  const registryPath = getRegistryPath(paths);
  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf8');
}

function createEmptyRegistry(paths: ScopeFileRegistryPaths, nowMs: number): ScopeFileRegistry {
  return {
    scopeId: paths.scopeId,
    vectorStoreId: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    files: [],
  };
}

function buildDefaultStorageMetadata(
  scopeId: string,
  uploadedBy: string,
): LaneStorageMetadata {
  return buildLaneStorageMetadata({
    laneId: 'system_audit',
    ownerMemberId: uploadedBy.trim() ? uploadedBy : null,
    scopeId,
    policyVersion: 'legacy-v1',
    artifactType: 'document',
  });
}

function normalizeScopeFileRecord(
  scopeId: string,
  record: ScopeFileRecord,
): ScopeFileRecord {
  if (record.storageMetadata) {
    return record;
  }

  return {
    ...record,
    storageMetadata: buildDefaultStorageMetadata(scopeId, record.uploadedBy),
  };
}

function normalizeScopeFileRegistry(registry: ScopeFileRegistry): ScopeFileRegistry {
  return {
    ...registry,
    files: registry.files.map((record) => {
      return normalizeScopeFileRecord(registry.scopeId, record);
    }),
  };
}

export async function readScopeFileRegistry(
  paths: ScopeFileRegistryPaths,
): Promise<ScopeFileRegistry | null> {
  const registryPath = getRegistryPath(paths);
  if (!existsSync(registryPath)) return null;

  const raw = await readFile(registryPath, 'utf8');
  const parsed = JSON.parse(raw) as ScopeFileRegistry;
  if (parsed.scopeId !== paths.scopeId) {
    return null;
  }

  return normalizeScopeFileRegistry(parsed);
}

async function getOrCreateScopeFileRegistry(
  paths: ScopeFileRegistryPaths,
  nowMs: number,
): Promise<ScopeFileRegistry> {
  const existing = await readScopeFileRegistry(paths);
  if (existing) return existing;

  const created = createEmptyRegistry(paths, nowMs);
  await writeRegistry(paths, created);
  return created;
}

export async function getScopeVectorStoreId(
  paths: ScopeFileRegistryPaths,
): Promise<string | null> {
  const registry = await readScopeFileRegistry(paths);
  return registry?.vectorStoreId ?? null;
}

export async function setScopeVectorStoreId(
  paths: ScopeFileRegistryPaths,
  vectorStoreId: string,
  nowMs = Date.now(),
): Promise<ScopeFileRegistry> {
  const registry = await getOrCreateScopeFileRegistry(paths, nowMs);
  const updated: ScopeFileRegistry = {
    ...registry,
    vectorStoreId,
    updatedAtMs: nowMs,
  };
  await writeRegistry(paths, updated);
  return updated;
}

export async function upsertScopeFileRecord(
  paths: ScopeFileRegistryPaths,
  record: ScopeFileRecord,
  nowMs = Date.now(),
): Promise<ScopeFileRegistry> {
  const registry = await getOrCreateScopeFileRegistry(paths, nowMs);
  const files = [...registry.files];
  const normalizedRecord = normalizeScopeFileRecord(paths.scopeId, record);
  const existingIdx = files.findIndex(
    (entry) =>
      entry.telegramFileUniqueId === normalizedRecord.telegramFileUniqueId ||
      entry.telegramFileId === normalizedRecord.telegramFileId,
  );

  if (existingIdx >= 0) {
    files[existingIdx] = normalizedRecord;
  } else {
    files.push(normalizedRecord);
  }

  return await replaceScopeFileRecords(paths, files, nowMs);
}

export async function replaceScopeFileRecords(
  paths: ScopeFileRegistryPaths,
  files: ScopeFileRecord[],
  nowMs = Date.now(),
): Promise<ScopeFileRegistry> {
  const registry = await getOrCreateScopeFileRegistry(paths, nowMs);
  const normalizedFiles = files.map((record) => {
    return normalizeScopeFileRecord(paths.scopeId, record);
  });

  const updated: ScopeFileRegistry = {
    ...registry,
    updatedAtMs: nowMs,
    files: normalizedFiles,
  };

  await writeRegistry(paths, updated);
  return updated;
}
