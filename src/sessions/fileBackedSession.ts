import type { AgentInputItem, Session } from '@openai/agents';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getHaloHome } from '../runtime/haloHome.js';
import { sanitizeSessionItems } from './sanitizeSessionItems.js';
import { hashSessionId } from './sessionHash.js';

export type FileBackedSessionOptions = {
  sessionId?: string;
  /** Optional override for tests. */
  baseDir?: string;
};

const DEFAULT_BASE_DIR = path.join(getHaloHome(), 'sessions');

export class FileBackedSession implements Session {
  private readonly sessionId: string;
  private readonly baseDir: string;
  private readonly filePath: string;
  private items: AgentInputItem[] = [];
  private readonly ready: Promise<void>;

  constructor(options: FileBackedSessionOptions = {}) {
    this.sessionId = options.sessionId ?? randomUUID();
    this.baseDir = options.baseDir ?? DEFAULT_BASE_DIR;
    this.filePath = path.join(this.baseDir, `${hashSessionId(this.sessionId)}.jsonl`);
    this.ready = this.loadFromDisk();
  }

  async getSessionId(): Promise<string> {
    return this.sessionId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    await this.ready;

    const clean = sanitizeSessionItems(this.items);

    if (limit === undefined) {
      return clean.map(cloneAgentItem);
    }

    if (limit <= 0) {
      return [];
    }

    const start = Math.max(clean.length - limit, 0);
    return clean.slice(start).map(cloneAgentItem);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    await this.ready;

    if (items.length === 0) {
      return;
    }

    const cloned = items.map(cloneAgentItem);
    this.items = [...this.items, ...cloned];

    await this.ensureDir();
    const payload = `${cloned.map((item) => JSON.stringify(item)).join('\n')}\n`;
    await appendFile(this.filePath, payload, 'utf8');
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    await this.ready;

    if (this.items.length === 0) {
      return undefined;
    }

    const item = this.items[this.items.length - 1];
    this.items = this.items.slice(0, -1);
    await this.flushToDisk();

    return cloneAgentItem(item);
  }

  async clearSession(): Promise<void> {
    await this.ready;
    this.items = [];
    await this.removeFile();
  }

  private async loadFromDisk(): Promise<void> {
    await this.ensureDir();

    try {
      const data = await readFile(this.filePath, 'utf8');
      const lines = data.split(/\r?\n/).filter((line) => line.length > 0);
      this.items = lines.map((line) => JSON.parse(line) as AgentInputItem);
    } catch (err) {
      if (isMissingFileError(err)) {
        this.items = [];
        return;
      }
      throw err;
    }
  }

  private async flushToDisk(): Promise<void> {
    if (this.items.length === 0) {
      await this.removeFile();
      return;
    }

    await this.ensureDir();
    const payload = `${this.items.map((item) => JSON.stringify(item)).join('\n')}\n`;
    await writeFile(this.filePath, payload, 'utf8');
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  private async removeFile(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}

function cloneAgentItem(item: AgentInputItem): AgentInputItem {
  return structuredClone(item);
}

function isMissingFileError(err: unknown): err is NodeJS.ErrnoException {
  if (!err || typeof err !== 'object') return false;
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}
