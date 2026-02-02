import { OpenAIResponsesCompactionSession } from '@openai/agents';
import type { Session } from '@openai/agents';
import { FileBackedSession } from './fileBackedSession.js';
import { getHaloHome } from '../runtime/haloHome.js';
import path from 'node:path';

export type SessionStoreOptions = {
  /**
   * Model to use for compaction calls (responses.compact).
   * Keep this aligned with the main agent model unless you have a reason not to.
   */
  compactionModel?: string;

  /**
   * Trigger compaction once the candidate items list reaches this size.
   * This is a simple heuristic; we can later switch to a token-based budget.
   */
  compactionCandidateItemsThreshold?: number;

  /**
   * Base directory for persisted session files.
   */
  baseDir?: string;
};

/**
 * Mapping of `scopeId -> Session`, persisted via FileBackedSession.
 *
 * v1: FileBackedSession wrapped by OpenAIResponsesCompactionSession.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly opts: Required<SessionStoreOptions>;

  constructor(opts: SessionStoreOptions = {}) {
    this.opts = {
      compactionModel: opts.compactionModel ?? 'gpt-5.2',
      compactionCandidateItemsThreshold: opts.compactionCandidateItemsThreshold ?? 12,
      baseDir: opts.baseDir ?? path.join(getHaloHome(), 'sessions'),
    };
  }

  getOrCreate(scopeId: string): Session {
    const existing = this.sessions.get(scopeId);
    if (existing) return existing;

    const underlyingSession = new FileBackedSession({
      sessionId: scopeId,
      baseDir: this.opts.baseDir,
    });

    const wrapped = new OpenAIResponsesCompactionSession({
      underlyingSession,
      model: this.opts.compactionModel,
      shouldTriggerCompaction: ({ compactionCandidateItems }) => {
        return compactionCandidateItems.length >= this.opts.compactionCandidateItemsThreshold;
      },
    });

    this.sessions.set(scopeId, wrapped);
    return wrapped;
  }

  async clear(scopeId: string): Promise<void> {
    const session = this.sessions.get(scopeId);
    if (!session) return;
    await session.clearSession();
  }

  listScopeIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /** Useful for tests/diagnostics. */
  size(): number {
    return this.sessions.size;
  }
}

export const defaultSessionStore = new SessionStore();
