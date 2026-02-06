import { describe, expect, it } from 'vitest';

import {
  chunkTranscriptItems,
  buildExchanges,
  extractItemText,
  isAckOnly,
  buildTranscriptChunkId,
  type TranscriptLine,
  type TranscriptItem,
} from './transcriptChunker.js';

const userMsg = (text: string): TranscriptItem => ({
  type: 'message',
  role: 'user',
  content: text,
});

const assistantMsg = (text: string): TranscriptItem => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'output_text', text, annotations: [], logprobs: [] }],
  status: 'completed',
});

const toolCall = (name: string): TranscriptItem => ({
  type: 'function_call',
  callId: 'call_test',
  name,
  status: 'completed',
  arguments: '{}',
});

const toolResult = (name: string, output: string): TranscriptItem => ({
  type: 'function_call_result',
  name,
  callId: 'call_test',
  status: 'completed',
  output: { type: 'text', text: output },
});

const hostedTool = (name: string): TranscriptItem => ({
  type: 'hosted_tool_call',
  id: 'ws_test',
  name,
  status: 'completed',
});

const toLines = (items: TranscriptItem[]): TranscriptLine[] =>
  items.map((item, i) => ({ offset: i, item }));

describe('transcriptChunker', () => {
  describe('extractItemText', () => {
    it('extracts user message with string content', () => {
      expect(extractItemText(userMsg('hello'))).toBe('[User] hello');
    });

    it('extracts assistant message with array content', () => {
      expect(extractItemText(assistantMsg('Hi there!'))).toBe('[Assistant] Hi there!');
    });

    it('extracts tool call', () => {
      expect(extractItemText(toolCall('semantic_search'))).toBe('[Tool Call: semantic_search]');
    });

    it('extracts tool result', () => {
      expect(extractItemText(toolResult('semantic_search', '...'))).toBe('[Tool Result: semantic_search]');
    });

    it('extracts hosted tool call', () => {
      expect(extractItemText(hostedTool('web_search_call'))).toBe('[Tool: web_search_call]');
    });

    it('returns null for unknown item types', () => {
      expect(extractItemText({ type: 'unknown' })).toBeNull();
    });
  });

  describe('isAckOnly', () => {
    it.each(['ok', 'OK', 'thanks', 'lol', 'sure', 'yes', 'nice', 'cool', '👍', 'got it'])(
      'detects "%s" as ack',
      (text) => {
        expect(isAckOnly(userMsg(text))).toBe(true);
      },
    );

    it('does not flag substantive messages', () => {
      expect(isAckOnly(userMsg('I like black coffee'))).toBe(false);
    });

    it('does not flag non-message items', () => {
      expect(isAckOnly(toolCall('search'))).toBe(false);
    });
  });

  describe('buildExchanges', () => {
    it('groups user→assistant into one exchange', () => {
      const lines = toLines([userMsg('hi'), assistantMsg('hello')]);
      const exchanges = buildExchanges(lines);
      expect(exchanges).toHaveLength(1);
      expect(exchanges[0].lines).toHaveLength(2);
    });

    it('splits at new user message after assistant', () => {
      const lines = toLines([
        userMsg('hi'),
        assistantMsg('hello'),
        userMsg('how are you'),
        assistantMsg('good'),
      ]);
      const exchanges = buildExchanges(lines);
      expect(exchanges).toHaveLength(2);
    });

    it('groups consecutive user messages before assistant', () => {
      const lines = toLines([
        userMsg('hello'),
        userMsg('also this'),
        assistantMsg('got both'),
      ]);
      const exchanges = buildExchanges(lines);
      expect(exchanges).toHaveLength(1);
      expect(exchanges[0].lines).toHaveLength(3);
    });

    it('includes tool calls in the exchange', () => {
      const lines = toLines([
        userMsg('search for coffee'),
        toolCall('semantic_search'),
        toolResult('semantic_search', '{"results":[]}'),
        assistantMsg('no results found'),
      ]);
      const exchanges = buildExchanges(lines);
      expect(exchanges).toHaveLength(1);
      expect(exchanges[0].lines).toHaveLength(4);
    });
  });

  describe('buildTranscriptChunkId', () => {
    it('produces deterministic IDs', () => {
      const id1 = buildTranscriptChunkId('scope1', 0, 5, 'hello world');
      const id2 = buildTranscriptChunkId('scope1', 0, 5, 'hello world');
      expect(id1).toBe(id2);
    });

    it('differs for different text', () => {
      const id1 = buildTranscriptChunkId('scope1', 0, 5, 'hello');
      const id2 = buildTranscriptChunkId('scope1', 0, 5, 'world');
      expect(id1).not.toBe(id2);
    });

    it('includes scope prefix', () => {
      const id = buildTranscriptChunkId('telegram:dm:wags', 0, 3, 'test');
      expect(id).toContain('telegram:dm:wags:t:');
    });
  });

  describe('chunkTranscriptItems', () => {
    it('returns empty for no input', () => {
      const chunks = chunkTranscriptItems({
        scopeId: 'test',
        path: 'transcripts/test.jsonl',
        lines: [],
      });
      expect(chunks).toEqual([]);
    });

    it('creates a chunk from a simple exchange', () => {
      const lines = toLines([userMsg('I like coffee'), assistantMsg('Noted!')]);
      const chunks = chunkTranscriptItems({
        scopeId: 'test',
        path: 'transcripts/test.jsonl',
        lines,
        minTokens: 1,
      });
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toContain('[User] I like coffee');
      expect(chunks[0].text).toContain('[Assistant] Noted!');
      expect(chunks[0].startLine).toBe(0);
      expect(chunks[0].endLine).toBe(1);
    });

    it('folds ack-only exchanges into neighbors when buffer is non-empty', () => {
      const lines = toLines([
        userMsg('I like coffee'),
        assistantMsg('Great choice!'),
        userMsg('ok'),
        assistantMsg('Anything else?'),
        userMsg('What about tea?'),
        assistantMsg('Tea is also great!'),
      ]);
      const chunks = chunkTranscriptItems({
        scopeId: 'test',
        path: 'transcripts/test.jsonl',
        lines,
        minTokens: 1,
        targetTokens: 5000,
      });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      const allText = chunks.map((c) => c.text).join(' ');
      expect(allText).toContain('[User] ok');
    });

    it('drops standalone ack-only exchanges when buffer is empty', () => {
      const lines = toLines([
        userMsg('ok'),
        assistantMsg('ok'),
        userMsg('What about tea?'),
        assistantMsg('Tea is also great!'),
      ]);
      const chunks = chunkTranscriptItems({
        scopeId: 'test',
        path: 'transcripts/test.jsonl',
        lines,
        minTokens: 1,
        targetTokens: 5000,
      });
      expect(chunks.length).toBe(1);
      expect(chunks[0].text).not.toContain('[User] ok');
      expect(chunks[0].text).toContain('[User] What about tea?');
    });

    it('respects targetTokens splitting', () => {
      const longText = 'A'.repeat(1200);
      const lines = toLines([
        userMsg(longText),
        assistantMsg('response 1'),
        userMsg('second question'),
        assistantMsg('response 2'),
      ]);
      const chunks = chunkTranscriptItems({
        scopeId: 'test',
        path: 'transcripts/test.jsonl',
        lines,
        targetTokens: 300,
        minTokens: 50,
        maxTokens: 520,
      });
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('does not drop oversized single exchange', () => {
      const longText = 'B'.repeat(3000);
      const lines = toLines([userMsg(longText), assistantMsg('ok')]);
      const chunks = chunkTranscriptItems({
        scopeId: 'test',
        path: 'transcripts/test.jsonl',
        lines,
        targetTokens: 300,
        minTokens: 120,
        maxTokens: 520,
      });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      const combined = chunks.map((c) => c.text).join('');
      expect(combined).toContain('B'.repeat(100));
    });

    it('handles realistic mixed conversation', () => {
      const lines = toLines([
        userMsg('hey'),
        assistantMsg('Hello! How can I help you today?'),
        userMsg('what tools do u have'),
        assistantMsg('I have web search, memory, and semantic search.'),
        userMsg('search for coffee'),
        toolCall('semantic_search'),
        toolResult('semantic_search', '{"results":[]}'),
        assistantMsg('No results found in semantic memory.'),
        userMsg('ok'),
        assistantMsg('Anything else?'),
      ]);
      const chunks = chunkTranscriptItems({
        scopeId: 'telegram:dm:test',
        path: 'transcripts/abc.jsonl',
        lines,
        minTokens: 1,
        targetTokens: 5000,
      });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      const allText = chunks.map((c) => c.text).join(' ');
      expect(allText).toContain('[Tool Call: semantic_search]');
      expect(allText).toContain('[User] hey');
    });

    it('produces stable chunk IDs across calls', () => {
      const lines = toLines([userMsg('hello'), assistantMsg('hi')]);
      const opts = { scopeId: 'test', path: 'transcripts/t.jsonl', lines, minTokens: 1 };
      const c1 = chunkTranscriptItems(opts);
      const c2 = chunkTranscriptItems(opts);
      expect(c1.map((c) => c.id)).toEqual(c2.map((c) => c.id));
    });
  });
});
