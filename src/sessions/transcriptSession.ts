import type {
  AgentInputItem,
  OpenAIResponsesCompactionArgs,
  OpenAIResponsesCompactionAwareSession,
  OpenAIResponsesCompactionResult,
  Session,
} from '@openai/agents';
import { isOpenAIResponsesCompactionAwareSession } from '@openai/agents';
import { TranscriptStore } from './transcriptStore.js';

type TranscriptSessionOptions = {
  session: Session;
  transcript: TranscriptStore;
};

class TranscriptSession implements Session {
  protected readonly session: Session;
  protected readonly transcript: TranscriptStore;

  constructor(options: TranscriptSessionOptions) {
    this.session = options.session;
    this.transcript = options.transcript;
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
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    return this.session.popItem();
  }

  async clearSession(): Promise<void> {
    await this.session.clearSession();
  }
}

class TranscriptCompactionSession
  extends TranscriptSession
  implements OpenAIResponsesCompactionAwareSession
{
  private readonly compactionSession: OpenAIResponsesCompactionAwareSession;

  constructor(options: { session: OpenAIResponsesCompactionAwareSession; transcript: TranscriptStore }) {
    super(options);
    this.compactionSession = options.session;
  }

  runCompaction(
    args?: OpenAIResponsesCompactionArgs,
  ): Promise<OpenAIResponsesCompactionResult | null> | OpenAIResponsesCompactionResult | null {
    return this.compactionSession.runCompaction(args);
  }
}

export function wrapWithTranscript(session: Session, transcript: TranscriptStore): Session {
  if (isOpenAIResponsesCompactionAwareSession(session)) {
    return new TranscriptCompactionSession({
      session,
      transcript,
    });
  }

  return new TranscriptSession({ session, transcript });
}
