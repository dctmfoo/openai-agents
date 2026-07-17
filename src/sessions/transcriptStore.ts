import type { AgentInputItem } from '@openai/agents';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getHaloHome } from '../runtime/haloHome.js';
import { hashSessionId } from './sessionHash.js';

type TranscriptStoreOptions = {
  sessionId: string;
  /** Optional override for tests. */
  baseDir?: string;
};

const DEFAULT_BASE_DIR = path.join(getHaloHome(), 'transcripts');

export class TranscriptStore {
  private readonly sessionId: string;
  private readonly baseDir: string;
  private readonly filePath: string;

  constructor(options: TranscriptStoreOptions) {
    this.sessionId = options.sessionId;
    this.baseDir = options.baseDir ?? DEFAULT_BASE_DIR;
    this.filePath = path.join(this.baseDir, `${hashSessionId(this.sessionId)}.jsonl`);
  }

  async appendItems(items: AgentInputItem[]): Promise<void> {
    if (items.length === 0) return;

    await this.ensureDir();
    const payload = `${items.map((item) => JSON.stringify(item)).join('\n')}\n`;
    await appendFile(this.filePath, payload, 'utf8');
  }

  async getItems(): Promise<AgentInputItem[]> {
    try {
      const data = await readFile(this.filePath, 'utf8');
      const lines = data.split(/\r?\n/).filter((line) => line.length > 0);
      return lines.map((line) => JSON.parse(line) as AgentInputItem);
    } catch (err) {
      if (isMissingFileError(err)) {
        return [];
      }
      throw err;
    }
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }
}

function isMissingFileError(err: unknown): err is NodeJS.ErrnoException {
  if (!err || typeof err !== 'object') return false;
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}
