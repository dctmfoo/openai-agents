import { createHash } from 'node:crypto';

type TranscriptItem = {
  type?: string;
  role?: string;
  content?: unknown;
  name?: string;
  arguments?: string;
  output?: unknown;
  id?: string;
  callId?: string;
  status?: string;
};

type TranscriptLine = {
  offset: number;
  item: TranscriptItem;
};

type Exchange = {
  lines: TranscriptLine[];
  tokenEstimate: number;
};

type TranscriptChunk = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  tokenEstimate: number;
};

type TranscriptChunkerOptions = {
  scopeId: string;
  path: string;
  lines: TranscriptLine[];
  targetTokens?: number;
  minTokens?: number;
  maxTokens?: number;
};

const DEFAULT_TARGET_TOKENS = 300;
const DEFAULT_MIN_TOKENS = 120;
const DEFAULT_MAX_TOKENS = 520;
const CHARS_PER_TOKEN = 4;

const ACK_PATTERN = /^(ok|okay|k|thanks|thx|thank you|lol|haha|nice|sure|yes|yep|yeah|no|nope|got it|cool|great|👍|✅|❤️|🙌|💯)[\s!.?]*$/i;

const estimateTokens = (text: string): number =>
  Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));

const sha256 = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

const buildTranscriptChunkId = (
  scopeId: string,
  startLine: number,
  endLine: number,
  text: string,
): string => {
  const textHash = sha256(text).slice(0, 16);
  return `${scopeId}:t:${startLine}-${endLine}:${textHash}`;
};

function extractItemText(item: TranscriptItem): string | null {
  if (item.type === 'message') {
    const role = item.role === 'assistant' ? 'Assistant' : 'User';
    const content = item.content;

    if (typeof content === 'string') {
      return `[${role}] ${content}`;
    }

    if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const part of content) {
        if (typeof part === 'string') {
          texts.push(part);
        } else if (part && typeof part === 'object') {
          const p = part as Record<string, unknown>;
          if (
            (p.type === 'input_text' || p.type === 'output_text') &&
            typeof p.text === 'string'
          ) {
            texts.push(p.text);
          }
        }
      }
      if (texts.length === 0) return null;
      return `[${role}] ${texts.join('\n')}`;
    }

    return null;
  }

  if (item.type === 'function_call' && item.name) {
    return `[Tool Call: ${item.name}]`;
  }

  if (item.type === 'function_call_result' && item.name) {
    return `[Tool Result: ${item.name}]`;
  }

  if (item.type === 'hosted_tool_call' && item.name) {
    return `[Tool: ${item.name}]`;
  }

  return null;
}

function isAckOnly(item: TranscriptItem): boolean {
  if (item.type !== 'message') return false;
  const content = item.content;
  let text: string | null = null;

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === 'string') {
        parts.push(part);
      } else if (part && typeof part === 'object') {
        const p = part as Record<string, unknown>;
        if (
          (p.type === 'input_text' || p.type === 'output_text') &&
          typeof p.text === 'string'
        ) {
          parts.push(p.text);
        }
      }
    }
    text = parts.join(' ');
  }

  if (!text) return true;
  return ACK_PATTERN.test(text.trim());
}

function isAssistantOrToolResponse(item: TranscriptItem): boolean {
  if (item.role === 'assistant') return true;
  if (item.type === 'function_call_result') return true;
  if (item.type === 'hosted_tool_call') return true;
  return false;
}

function isUserMessage(item: TranscriptItem): boolean {
  return item.type === 'message' && item.role === 'user';
}

function buildExchanges(lines: TranscriptLine[]): Exchange[] {
  const exchanges: Exchange[] = [];
  let current: TranscriptLine[] = [];
  let seenUser = false;
  let seenAssistantAfterUser = false;

  const flushExchange = () => {
    if (current.length === 0) return;
    const textParts: string[] = [];
    for (const line of current) {
      const text = extractItemText(line.item);
      if (text) textParts.push(text);
    }
    const fullText = textParts.join('\n');
    exchanges.push({
      lines: [...current],
      tokenEstimate: estimateTokens(fullText),
    });
    current = [];
    seenUser = false;
    seenAssistantAfterUser = false;
  };

  for (const line of lines) {
    if (isUserMessage(line.item) && seenAssistantAfterUser) {
      flushExchange();
    }

    current.push(line);

    if (isUserMessage(line.item)) {
      seenUser = true;
    }
    if (seenUser && isAssistantOrToolResponse(line.item)) {
      seenAssistantAfterUser = true;
    }
  }

  flushExchange();
  return exchanges;
}

function isExchangeAckOnly(exchange: Exchange): boolean {
  return exchange.lines.every(
    (line) =>
      isAckOnly(line.item) ||
      line.item.type === 'function_call' ||
      line.item.type === 'function_call_result' ||
      line.item.type === 'hosted_tool_call',
  );
}

function renderExchangeText(exchange: Exchange): string {
  const parts: string[] = [];
  for (const line of exchange.lines) {
    const text = extractItemText(line.item);
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

function chunkTranscriptItems(options: TranscriptChunkerOptions): TranscriptChunk[] {
  const targetTokens = options.targetTokens ?? DEFAULT_TARGET_TOKENS;
  const minTokens = options.minTokens ?? DEFAULT_MIN_TOKENS;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  const exchanges = buildExchanges(options.lines);
  const chunks: TranscriptChunk[] = [];

  let buffer: Exchange[] = [];
  let bufferTokens = 0;

  const flushBuffer = () => {
    if (buffer.length === 0) return;

    const allLines = buffer.flatMap((e) => e.lines);
    const startLine = allLines[0].offset;
    const endLine = allLines[allLines.length - 1].offset;
    const text = buffer.map((e) => renderExchangeText(e)).join('\n\n');
    const tokenEstimate = estimateTokens(text);

    const id = buildTranscriptChunkId(options.scopeId, startLine, endLine, text);
    chunks.push({
      id,
      path: options.path,
      startLine,
      endLine,
      text,
      tokenEstimate,
    });

    buffer = [];
    bufferTokens = 0;
  };

  for (const exchange of exchanges) {
    if (isExchangeAckOnly(exchange)) {
      if (buffer.length > 0) {
        buffer.push(exchange);
        bufferTokens += exchange.tokenEstimate;
      }
      continue;
    }

    const nextTokens = bufferTokens + exchange.tokenEstimate;

    if (buffer.length > 0 && nextTokens > maxTokens && bufferTokens >= minTokens) {
      flushBuffer();
    }

    buffer.push(exchange);
    bufferTokens += exchange.tokenEstimate;

    if (bufferTokens >= targetTokens && bufferTokens >= minTokens) {
      flushBuffer();
    }
  }

  flushBuffer();
  return chunks;
}

export {
  chunkTranscriptItems,
  buildExchanges,
  extractItemText,
  isAckOnly,
  buildTranscriptChunkId,
};
export type { TranscriptChunk, TranscriptLine, TranscriptItem };
