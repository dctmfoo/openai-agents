import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { appendDailyNote, getDailyMemoryPath } from './memoryFiles.js';

describe('memoryFiles', () => {
  it('appendDailyNote creates the daily file with header and bullet', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'openai-agents-test-'));
    const date = new Date('2026-02-02T00:00:00.000Z');

    const path = await appendDailyNote({ rootDir }, 'hello world', date);
    expect(path).toBe(getDailyMemoryPath({ rootDir }, date));

    const content = await readFile(path, 'utf8');
    expect(content).toContain('# 2026-02-02');
    expect(content).toContain('- hello world');
  });

  it('appendDailyNote redacts obvious OpenAI/Telegram tokens', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'openai-agents-test-'));
    const date = new Date('2026-02-02T00:00:00.000Z');

    const note =
      'keys: sk-THIS_IS_A_FAKE_KEY_1234567890 and 123456789:ABCDefGhijklMNOP_123';

    const path = await appendDailyNote({ rootDir }, note, date);
    const content = await readFile(path, 'utf8');

    expect(content).not.toMatch(/\bsk-[A-Za-z0-9_-]{10,}\b/);
    expect(content).toContain('[REDACTED_OPENAI_KEY]');
    expect(content).toContain('[REDACTED_TELEGRAM_TOKEN]');
  });

  it('appendDailyNote does not double-prefix bullets', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'openai-agents-test-'));
    const date = new Date('2026-02-02T00:00:00.000Z');

    const path = await appendDailyNote({ rootDir }, '- already a bullet', date);
    const content = await readFile(path, 'utf8');

    expect(content).toContain('- already a bullet');
    expect(content).not.toContain('-- already a bullet');
  });
});
