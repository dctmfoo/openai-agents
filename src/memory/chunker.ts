import { createHash } from 'node:crypto';

export type Chunk = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  tokenEstimate: number;
};

export type ChunkerOptions = {
  path: string;
  text: string;
  targetTokens?: number;
  overlapTokens?: number;
  minTokens?: number;
  maxTokens?: number;
};

type Unit = {
  text: string;
  startLine: number;
  endLine: number;
  tokenEstimate: number;
  isCodeBlock: boolean;
};

const DEFAULT_TARGET_TOKENS = 400;
const DEFAULT_OVERLAP_TOKENS = 80;
const DEFAULT_MIN_TOKENS = 100;
const DEFAULT_MAX_TOKENS = 600;
const CHARS_PER_TOKEN = 4;

const estimateTokens = (text: string): number => {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
};

const hashText = (text: string): string => {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
};

const buildChunkId = (path: string, startLine: number, endLine: number, text: string) => {
  return `${path}:${startLine}-${endLine}:${hashText(text)}`;
};

const parseUnits = (text: string): Unit[] => {
  const lines = text.split(/\r?\n/);
  const units: Unit[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      const startLine = i + 1;
      const buffer: string[] = [line];
      i += 1;
      let fenceClosed = false;
      while (i < lines.length) {
        buffer.push(lines[i]);
        if (lines[i].trim().startsWith('```')) {
          fenceClosed = true;
          i += 1;
          break;
        }
        i += 1;
      }
      // Safety: unclosed code fences are still chunked (best-effort for malformed markdown)
      void fenceClosed;
      const textBlock = buffer.join('\n');
      units.push({
        text: textBlock,
        startLine,
        endLine: startLine + buffer.length - 1,
        tokenEstimate: estimateTokens(textBlock),
        isCodeBlock: true,
      });
      continue;
    }

    const textBlock = line;
    units.push({
      text: textBlock,
      startLine: i + 1,
      endLine: i + 1,
      tokenEstimate: estimateTokens(textBlock),
      isCodeBlock: false,
    });
    i += 1;
  }

  return units;
};

export function chunkMarkdown(options: ChunkerOptions): Chunk[] {
  const targetTokens = options.targetTokens ?? DEFAULT_TARGET_TOKENS;
  const overlapTokens = options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
  const minTokens = options.minTokens ?? DEFAULT_MIN_TOKENS;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  const units = parseUnits(options.text);
  const chunks: Chunk[] = [];

  let buffer: Unit[] = [];
  let bufferTokens = 0;

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const startLine = buffer[0].startLine;
    const endLine = buffer[buffer.length - 1].endLine;
    const text = buffer.map((unit) => unit.text).join('\n');
    const tokenEstimate = bufferTokens;
    const id = buildChunkId(options.path, startLine, endLine, text);
    chunks.push({ id, path: options.path, startLine, endLine, text, tokenEstimate });

    if (overlapTokens > 0) {
      let overlapUnits: Unit[] = [];
      let overlapCount = 0;

      for (let i = buffer.length - 1; i >= 0; i -= 1) {
        const unit = buffer[i];
        if (unit.isCodeBlock && overlapUnits.length > 0) {
          break;
        }
        overlapUnits.unshift(unit);
        overlapCount += unit.tokenEstimate;
        if (overlapCount >= overlapTokens) {
          break;
        }
      }

      buffer = overlapUnits;
      bufferTokens = overlapUnits.reduce((sum, unit) => sum + unit.tokenEstimate, 0);
    } else {
      buffer = [];
      bufferTokens = 0;
    }
  };

  for (const unit of units) {
    const nextTokens = bufferTokens + unit.tokenEstimate;
    if (buffer.length > 0 && nextTokens > maxTokens && bufferTokens >= minTokens) {
      flushBuffer();
    }

    buffer.push(unit);
    bufferTokens += unit.tokenEstimate;

    if (bufferTokens >= targetTokens && bufferTokens >= minTokens) {
      flushBuffer();
    }
  }

  flushBuffer();

  return chunks;
}
