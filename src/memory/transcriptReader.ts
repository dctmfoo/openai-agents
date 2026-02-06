import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hashSessionId } from '../sessions/sessionHash.js';
import type { TranscriptItem, TranscriptLine } from './transcriptChunker.js';

type TranscriptReadResult = {
  lines: TranscriptLine[];
  endOffset: number;
};

function getTranscriptPath(rootDir: string, scopeId: string): string {
  return join(rootDir, 'transcripts', `${hashSessionId(scopeId)}.jsonl`);
}

async function readTranscriptAfterOffset(
  rootDir: string,
  scopeId: string,
  afterOffset: number,
  maxLines?: number,
): Promise<TranscriptReadResult> {
  const effectiveOffset = afterOffset < 0 ? 0 : afterOffset;
  const filePath = getTranscriptPath(rootDir, scopeId);
  let data: string;

  try {
    data = await readFile(filePath, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { lines: [], endOffset: effectiveOffset };
    }
    throw err;
  }

  const rawLines = data.split(/\r?\n/).filter((line) => line.length > 0);
  const totalLines = rawLines.length;

  if (effectiveOffset >= totalLines) {
    return { lines: [], endOffset: effectiveOffset };
  }

  const sliced = maxLines
    ? rawLines.slice(effectiveOffset, effectiveOffset + maxLines)
    : rawLines.slice(effectiveOffset);

  const lines: TranscriptLine[] = [];
  let endOffset = effectiveOffset;

  for (let i = 0; i < sliced.length; i++) {
    const offset = effectiveOffset + i;
    try {
      const item = JSON.parse(sliced[i]) as TranscriptItem;
      lines.push({ offset, item });
      endOffset = offset + 1;
    } catch {
      // Stop at first malformed line so a partial write can be retried.
      break;
    }
  }

  return { lines, endOffset };
}

export { readTranscriptAfterOffset, getTranscriptPath };
