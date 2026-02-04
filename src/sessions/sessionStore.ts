import { OpenAIResponsesCompactionSession } from '@openai/agents';
import type { Session } from '@openai/agents';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { getHaloHome } from '../runtime/haloHome.js';
import { FileBackedSession } from './fileBackedSession.js';
import { hashSessionId } from './sessionHash.js';
import { TranscriptStore } from './transcriptStore.js';
import { wrapWithTranscript } from './transcriptSession.js';
import { wrapWithTranscriptAndDistillation } from './distillingTranscriptSession.js';
import type { DistillationMode } from '../memory/distillationRunner.js';

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
   * Enable deterministic (offline) memory distillation.
   * Defaults to false.
   */
  distillationEnabled?: boolean;

  /**
   * Distillation mode: deterministic or LLM-based.
   */
  distillationMode?: DistillationMode;

  /**
   * Trigger distillation after this many appended transcript items.
   */
  distillationEveryNItems?: number;

  /**
   * Max transcript items to consider when distilling.
   */
  distillationMaxItems?: number;

  /**
   * Root directory for scoped memory writes (HALO_HOME).
   */
  rootDir?: string;

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
  private readonly opts: Required<
    Omit<SessionStoreOptions, 'compactionEnabled' | 'distillationEnabled'>
  > & {
    compactionEnabled: boolean;
    distillationEnabled: boolean;
  };

  constructor(opts: SessionStoreOptions = {}) {
    const envEnabled = process.env.HALO_COMPACTION_ENABLED;
    const defaultEnabled = Boolean(process.env.OPENAI_API_KEY);

    const envDistillEnabled = process.env.HALO_DISTILLATION_ENABLED;

    this.opts = {
      compactionEnabled:
        opts.compactionEnabled ??
        (envEnabled === undefined
          ? defaultEnabled
          : envEnabled !== '0' && envEnabled.toLowerCase() !== 'false'),
      distillationEnabled:
        opts.distillationEnabled ??
        (envDistillEnabled !== undefined &&
          envDistillEnabled !== '0' &&
          envDistillEnabled.toLowerCase() !== 'false'),
      distillationMode: opts.distillationMode ?? 'deterministic',
      distillationEveryNItems: opts.distillationEveryNItems ?? 20,
      distillationMaxItems: opts.distillationMaxItems ?? 200,
      rootDir: opts.rootDir ?? getHaloHome(),
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

    const wrapped = this.opts.distillationEnabled
      ? wrapWithTranscriptAndDistillation(session, transcript, scopeId, {
          enabled: true,
          everyNItems: this.opts.distillationEveryNItems,
          maxItems: this.opts.distillationMaxItems,
          rootDir: this.opts.rootDir,
          mode: this.opts.distillationMode,
        })
      : wrapWithTranscript(session, transcript);

    this.sessions.set(scopeId, wrapped);
    return wrapped;
  }

  async clear(scopeId: string): Promise<void> {
    const session = this.sessions.get(scopeId);
    if (!session) return;
    await session.clearSession();
  }

  async purge(scopeId: string): Promise<void> {
    const session = this.sessions.get(scopeId);
    if (session) {
      await session.clearSession();
      this.sessions.delete(scopeId);
    }

    const hashed = hashSessionId(scopeId);
    await rm(path.join(this.opts.baseDir, `${hashed}.jsonl`), { force: true });
    await rm(path.join(this.opts.transcriptsDir, `${hashed}.jsonl`), { force: true });
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
