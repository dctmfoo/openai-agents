import type { AgentInputItem, Session } from '@openai/agents';

import { TranscriptStore } from './transcriptStore.js';
import { isOpenAIResponsesCompactionAwareSession } from '@openai/agents';
import type {
  OpenAIResponsesCompactionArgs,
  OpenAIResponsesCompactionAwareSession,
  OpenAIResponsesCompactionResult,
} from '@openai/agents';
import { runDeterministicDistillation } from '../memory/distillationRunner.js';

export type DistillationConfig = {
  enabled: boolean;
  /** Trigger distillation after this many appended items. */
  everyNItems: number;
  /** How many transcript items to consider when distilling. */
  maxItems: number;
  /** Root dir for scoped memory writes (HALO_HOME). */
  rootDir: string;
};

class DistillingTranscriptSession implements Session {
  protected readonly session: Session;
  protected readonly transcript: TranscriptStore;
  protected readonly scopeId: string;
  protected readonly distill: DistillationConfig;

  private pending = 0;
  private running: Promise<void> | null = null;

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

    if (!this.distill.enabled) return;

    this.pending += items.length;
    if (this.pending < this.distill.everyNItems) return;

    // Reset pending first to avoid repeated triggers if we crash.
    this.pending = 0;

    // Fire-and-forget (but serialized) distillation.
    // We don't want to block the user reply on distillation.
    this.running = (this.running ?? Promise.resolve())
      .then(async () => {
        const all = await this.transcript.getItems();
        const slice = all.slice(Math.max(0, all.length - this.distill.maxItems));
        await runDeterministicDistillation({
          rootDir: this.distill.rootDir,
          scopeId: this.scopeId,
          items: slice,
        });
      })
      .catch((err) => {
        // Fail-safe: never break the chat loop because distillation failed.
        // We don't have a structured logger at this layer; callers can monitor gateway event logs.
        console.error('halo: distillation failed', {
          scopeId: this.scopeId,
          error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
        });
      })
      .finally(() => {
        // Keep chain alive.
        if (this.running) this.running = null;
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
    return this.compactionSession.runCompaction(args);
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
