import { MemorySession, OpenAIResponsesCompactionSession } from '@openai/agents';
import type { Session } from '@openai/agents';

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
};

/**
 * In-memory mapping of `scopeId -> Session`.
 *
 * v1: MemorySession wrapped by OpenAIResponsesCompactionSession.
 *
 * NOTE: This does not persist across process restarts yet.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly opts: Required<SessionStoreOptions>;

  constructor(opts: SessionStoreOptions = {}) {
    this.opts = {
      compactionModel: opts.compactionModel ?? 'gpt-5.2',
      compactionCandidateItemsThreshold: opts.compactionCandidateItemsThreshold ?? 12,
    };
  }

  getOrCreate(scopeId: string): Session {
    const existing = this.sessions.get(scopeId);
    if (existing) return existing;

    const underlyingSession = new MemorySession({ sessionId: scopeId });

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

  /** Useful for tests/diagnostics. */
  size(): number {
    return this.sessions.size;
  }
}
