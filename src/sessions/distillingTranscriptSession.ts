import type { AgentInputItem, Session } from '@openai/agents';

import { TranscriptStore } from './transcriptStore.js';
import { isOpenAIResponsesCompactionAwareSession } from '@openai/agents';
import type {
  OpenAIResponsesCompactionArgs,
  OpenAIResponsesCompactionAwareSession,
  OpenAIResponsesCompactionResult,
} from '@openai/agents';
import { runDistillation } from '../memory/distillationRunner.js';

// Injectable indirection for tests (ESM named imports are hard to mock reliably).
export const distillationDeps = { runDistillation };

type DistillationConfig = {
  enabled: boolean;
  /** Trigger distillation after this many appended items. */
  everyNItems: number;
  /** How many transcript items to consider when distilling. */
  maxItems: number;
  /** Root dir for scoped memory writes (HALO_HOME). */
  rootDir: string;
  /** Distillation mode: deterministic or llm. */
  mode: 'deterministic' | 'llm';
};

function isPromiseLike<T>(value: Promise<T> | T): value is Promise<T> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return typeof (value as { then?: unknown }).then === 'function';
}

class DistillingTranscriptSession implements Session {
  protected readonly session: Session;
  protected readonly transcript: TranscriptStore;
  protected readonly scopeId: string;
  protected readonly distill: DistillationConfig;

  private pending = 0;
  private running: Promise<void> | null = null;

  private distillFailureCount = 0;
  private distillBackoffUntilMs = 0;

  constructor(options: {
    session: Session;
    transcript: TranscriptStore;
    scopeId: string;
    distill: DistillationConfig;
  }) {
    this.session = options.session;
    this.transcript = options.transcript;
    this.scopeId = options.scopeId;
    this.distill = options.distill;
  }

  async getSessionId(): Promise<string> {
    return this.session.getSessionId();
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    return this.session.getItems(limit);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    if (items.length === 0) return;

    // Append to transcript first so the source-of-truth is durable even if derived state fails.
    await this.transcript.appendItems(items);
    await this.session.addItems(items);

    if (!this.distill.enabled) {
      return;
    }

    this.pending += items.length;
    this.queueDistillationIfReady(false);
  }

  protected triggerDistillationAfterCompaction(): void {
    if (!this.distill.enabled) {
      return;
    }

    this.queueDistillationIfReady(true);
  }

  private queueDistillationIfReady(force: boolean): void {
    if (!force && this.pending < this.distill.everyNItems) {
      return;
    }

    this.pending = 0;

    const now = Date.now();
    if (now < this.distillBackoffUntilMs) {
      return;
    }

    this.running = (this.running ?? Promise.resolve())
      .then(async () => {
        const gateNow = Date.now();
        if (gateNow < this.distillBackoffUntilMs) {
          return;
        }

        const all = await this.transcript.getItems();
        const slice = all.slice(Math.max(0, all.length - this.distill.maxItems));
        await distillationDeps.runDistillation({
          rootDir: this.distill.rootDir,
          scopeId: this.scopeId,
          items: slice,
          mode: this.distill.mode,
        });

        this.distillFailureCount = 0;
        this.distillBackoffUntilMs = 0;
      })
      .catch((err) => {
        this.distillFailureCount += 1;
        const backoffMs = Math.min(
          10 * 60 * 1000,
          30 * 1000 * 2 ** Math.max(0, this.distillFailureCount - 1),
        );
        this.distillBackoffUntilMs = Date.now() + backoffMs;

        console.error('halo: distillation failed', {
          scopeId: this.scopeId,
          backoffMs,
          backoffUntilMs: this.distillBackoffUntilMs,
          error:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : String(err),
        });
      })
      .finally(() => {
        if (this.running) {
          this.running = null;
        }
      });
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    return this.session.popItem();
  }

  async clearSession(): Promise<void> {
    await this.session.clearSession();
  }
}

class DistillingTranscriptCompactionSession
  extends DistillingTranscriptSession
  implements OpenAIResponsesCompactionAwareSession
{
  private readonly compactionSession: OpenAIResponsesCompactionAwareSession;

  constructor(options: {
    session: OpenAIResponsesCompactionAwareSession;
    transcript: TranscriptStore;
    scopeId: string;
    distill: DistillationConfig;
  }) {
    super(options);
    this.compactionSession = options.session;
  }

  runCompaction(
    args?: OpenAIResponsesCompactionArgs,
  ): Promise<OpenAIResponsesCompactionResult | null> | OpenAIResponsesCompactionResult | null {
    const result = this.compactionSession.runCompaction(args);

    if (isPromiseLike(result)) {
      return result.then((value) => {
        this.triggerDistillationAfterCompaction();
        return value;
      });
    }

    this.triggerDistillationAfterCompaction();
    return result;
  }
}

export function wrapWithTranscriptAndDistillation(
  session: Session,
  transcript: TranscriptStore,
  scopeId: string,
  distill: DistillationConfig,
): Session {
  if (isOpenAIResponsesCompactionAwareSession(session)) {
    return new DistillingTranscriptCompactionSession({
      session,
      transcript,
      scopeId,
      distill,
    });
  }

  return new DistillingTranscriptSession({ session, transcript, scopeId, distill });
}
