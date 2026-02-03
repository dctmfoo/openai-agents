import { OpenAIResponsesCompactionSession } from '@openai/agents';
import type { Session } from '@openai/agents';
import { FileBackedSession } from './fileBackedSession.js';
import { TranscriptStore } from './transcriptStore.js';
import { wrapWithTranscript } from './transcriptSession.js';
import { getHaloHome } from '../runtime/haloHome.js';
import path from 'node:path';

export type SessionStoreOptions = {
  /**
   * Enable OpenAI-backed compaction.
   *
   * If unset, defaults to true only when OPENAI_API_KEY is present.
   * This avoids hard-failing unit tests/CI (and other environments) that don't
   * have credentials available.
   */
  compactionEnabled?: boolean;

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
   * Base directory for derived session state (summaries/compactions).
   */
  baseDir?: string;

  /**
   * Base directory for append-only transcripts.
   */
  transcriptsDir?: string;
};

/**
 * Mapping of `scopeId -> Session`.
 *
 * Derived session state (summaries/compactions) is persisted via FileBackedSession,
 * while raw transcripts are stored separately as append-only logs.
 *
 * By default, sessions are wrapped by OpenAIResponsesCompactionSession only when
 * credentials are available (OPENAI_API_KEY) or when explicitly enabled.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly opts: Required<Omit<SessionStoreOptions, 'compactionEnabled'>> & {
    compactionEnabled: boolean;
  };

  constructor(opts: SessionStoreOptions = {}) {
    const envEnabled = process.env.HALO_COMPACTION_ENABLED;
    const defaultEnabled = Boolean(process.env.OPENAI_API_KEY);

    this.opts = {
      compactionEnabled:
        opts.compactionEnabled ??
        (envEnabled === undefined
          ? defaultEnabled
          : envEnabled !== '0' && envEnabled.toLowerCase() !== 'false'),
      compactionModel: opts.compactionModel ?? 'gpt-5.2',
      compactionCandidateItemsThreshold: opts.compactionCandidateItemsThreshold ?? 12,
      baseDir: opts.baseDir ?? path.join(getHaloHome(), 'sessions'),
      transcriptsDir: opts.transcriptsDir ?? path.join(getHaloHome(), 'transcripts'),
    };
  }

  getOrCreate(scopeId: string): Session {
    const existing = this.sessions.get(scopeId);
    if (existing) return existing;

    const underlyingSession = new FileBackedSession({
      sessionId: scopeId,
      baseDir: this.opts.baseDir,
    });

    const session: Session = this.opts.compactionEnabled
      ? new OpenAIResponsesCompactionSession({
          underlyingSession,
          model: this.opts.compactionModel,
          shouldTriggerCompaction: ({ compactionCandidateItems }) => {
            return (
              compactionCandidateItems.length >= this.opts.compactionCandidateItemsThreshold
            );
          },
        })
      : underlyingSession;

    const transcript = new TranscriptStore({
      sessionId: scopeId,
      baseDir: this.opts.transcriptsDir,
    });

    const wrapped = wrapWithTranscript(session, transcript);
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
