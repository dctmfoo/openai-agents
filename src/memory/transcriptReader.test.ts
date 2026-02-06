import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readTranscriptAfterOffset, getTranscriptPath } from './transcriptReader.js';
import { hashSessionId } from '../sessions/sessionHash.js';

const SCOPE_ID = 'telegram:dm:test';

const writeScopeTranscript = async (rootDir: string, lines: string[]) => {
  const dir = path.join(rootDir, 'transcripts');
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${hashSessionId(SCOPE_ID)}.jsonl`);
  await writeFile(filePath, lines.join('\n') + '\n', 'utf8');
};

describe('transcriptReader', () => {
  it('computes transcript path from rootDir and scopeId', () => {
    const p = getTranscriptPath('/halo', SCOPE_ID);
    expect(p).toContain('/halo/transcripts/');
    expect(p).toContain('.jsonl');
  });

  it('reads all lines from offset 0', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tr-'));
    await writeScopeTranscript(root, [
      '{"type":"message","role":"user","content":"hello"}',
      '{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}',
    ]);

    const result = await readTranscriptAfterOffset(root, SCOPE_ID, 0);
    expect(result.lines).toHaveLength(2);
    expect(result.endOffset).toBe(2);
    expect(result.lines[0].offset).toBe(0);
    expect(result.lines[1].offset).toBe(1);
  });

  it('reads only lines after offset', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tr-'));
    await writeScopeTranscript(root, [
      '{"type":"message","role":"user","content":"first"}',
      '{"type":"message","role":"user","content":"second"}',
      '{"type":"message","role":"user","content":"third"}',
    ]);

    const result = await readTranscriptAfterOffset(root, SCOPE_ID, 1);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].item.content).toBe('second');
    expect(result.endOffset).toBe(3);
  });

  it('respects maxLines limit', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tr-'));
    await writeScopeTranscript(root, [
      '{"type":"message","role":"user","content":"a"}',
      '{"type":"message","role":"user","content":"b"}',
      '{"type":"message","role":"user","content":"c"}',
      '{"type":"message","role":"user","content":"d"}',
    ]);

    const result = await readTranscriptAfterOffset(root, SCOPE_ID, 0, 2);
    expect(result.lines).toHaveLength(2);
    expect(result.endOffset).toBe(2);
  });

  it('returns empty for missing file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tr-'));
    const result = await readTranscriptAfterOffset(root, SCOPE_ID, 0);
    expect(result.lines).toEqual([]);
    expect(result.endOffset).toBe(0);
  });

  it('clamps negative offset to 0 for missing file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tr-'));
    const result = await readTranscriptAfterOffset(root, SCOPE_ID, -10);
    expect(result.lines).toEqual([]);
    expect(result.endOffset).toBe(0);
  });

  it('returns empty when offset is beyond file length', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tr-'));
    await writeScopeTranscript(root, [
      '{"type":"message","role":"user","content":"only"}',
    ]);

    const result = await readTranscriptAfterOffset(root, SCOPE_ID, 5);
    expect(result.lines).toEqual([]);
    expect(result.endOffset).toBe(5);
  });

  it('stops before malformed JSON lines so they can be retried', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tr-'));
    await writeScopeTranscript(root, [
      '{"type":"message","role":"user","content":"valid"}',
      'NOT VALID JSON',
      '{"type":"message","role":"user","content":"also valid"}',
    ]);

    const result = await readTranscriptAfterOffset(root, SCOPE_ID, 0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].item.content).toBe('valid');
    expect(result.endOffset).toBe(1);
  });
});
