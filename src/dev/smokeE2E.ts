import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { AgentInputItem } from '@openai/agents';

import { createTelegramAdapter, type TelegramBotLike, type TelegramContext } from '../interfaces/telegram/bot.js';
import { startAdminServer } from '../gateway/admin.js';
import { hashSessionId } from '../sessions/sessionHash.js';
import { SessionStore } from '../sessions/sessionStore.js';

const userMessage = (text: string) =>
  ({
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text }],
  }) satisfies AgentInputItem;

type HandlerBag = {
  messageText?: (ctx: TelegramContext) => Promise<void> | void;
  error?: (err: unknown) => Promise<void> | void;
};

type FakeBot = TelegramBotLike & {
  handlers: HandlerBag;
  start: () => Promise<void>;
};

const makeFakeBot = (): FakeBot => {
  const handlers: HandlerBag = {};
  return {
    handlers,
    on: (event, handler) => {
      if (event === 'message:text') handlers.messageText = handler;
    },
    catch: (handler) => {
      handlers.error = handler;
    },
    start: async () => {},
  };
};

async function httpGetJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return JSON.parse(text) as unknown;
}

async function main() {
  const haloHome = await mkdtemp(path.join(tmpdir(), 'halo-smoke-'));

  // Minimal family config for policy.
  await mkdir(path.join(haloHome, 'config'), { recursive: true });
  await writeFile(
    path.join(haloHome, 'config', 'family.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        familyId: 'default',
        members: [
          {
            memberId: 'wags',
            displayName: 'Wags',
            role: 'parent',
            telegramUserIds: [456],
          },
        ],
        parentsGroup: { telegramChatId: null },
      },
      null,
      2,
    ),
    'utf8',
  );

  // Canonical config.json (required by gateway runtime).
  await writeFile(
    path.join(haloHome, 'config.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        gateway: { host: '127.0.0.1', port: 0 },
        features: { compactionEnabled: false, distillationEnabled: true },
        memory: { distillationEveryNItems: 1, distillationMaxItems: 50 },
        family: {
          schemaVersion: 1,
          familyId: 'default',
          members: [
            {
              memberId: 'wags',
              displayName: 'Wags',
              role: 'parent',
              telegramUserIds: [456],
            },
          ],
          parentsGroup: { telegramChatId: null },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const store = new SessionStore({
    baseDir: path.join(haloHome, 'sessions'),
    transcriptsDir: path.join(haloHome, 'transcripts'),
    rootDir: haloHome,
    compactionEnabled: false,
    distillationEnabled: true,
    distillationEveryNItems: 1,
    distillationMaxItems: 50,
  });

  // Start admin server on an ephemeral port.
  const admin = await startAdminServer({
    host: '127.0.0.1',
    port: 0,
    haloHome,
    version: 'smoke',
    sessionStore: store,
    config: {
      schemaVersion: 1,
      gateway: { host: '127.0.0.1', port: 0 },
      features: { compactionEnabled: false, distillationEnabled: true },
      memory: { distillationEveryNItems: 1, distillationMaxItems: 50 },
    },
  });

  const { port } = admin.context;

  // Wire a telegram adapter with a fake bot.
  const bot = makeFakeBot();

  const adapter = createTelegramAdapter({
    token: 'token',
    bot,
    logDir: path.join(haloHome, 'logs'),
    rootDir: haloHome,
    haloHome,
    deps: {
      // Stub Prime: just ensure we write a transcript item through the configured session.
      runPrime: async (input, opts) => {
        const scopeId = opts?.scopeId ?? 'telegram:dm:wags';
        const session = store.getOrCreate(scopeId);
        const textInput = typeof input === 'string' ? input : '[multimodal input]';
        await session.addItems([userMessage(textInput)]);
        return { finalOutput: 'smoke reply', raw: null as any };
      },
    },
  });

  const handler = bot.handlers.messageText;
  if (!handler) throw new Error('smoke: telegram handler missing');

  const replyCalls: string[] = [];
  const ctx: TelegramContext = {
    chat: { id: 1, type: 'private' },
    message: { text: 'remember: I like black coffee', message_id: 1 },
    from: { id: 456 },
    reply: async (text) => {
      replyCalls.push(text);
    },
  };

  await handler(ctx);

  if (replyCalls[0] !== 'smoke reply') {
    throw new Error(`smoke: unexpected reply: ${replyCalls[0]}`);
  }

  // Verify transcript was written.
  const scopeId = 'telegram:dm:wags';
  const hashed = hashSessionId(scopeId);
  const transcriptPath = path.join(haloHome, 'transcripts', `${hashed}.jsonl`);
  const transcriptRaw = await readFile(transcriptPath, 'utf8');
  if (!transcriptRaw.includes('black coffee')) {
    throw new Error('smoke: transcript missing expected content');
  }

  // Verify distillation wrote to scoped long-term memory.
  const memoryDir = path.join(haloHome, 'memory', 'scopes', hashed);
  const memoryPath = path.join(memoryDir, 'MEMORY.md');
  const memoryRaw = await readFile(memoryPath, 'utf8');
  if (!memoryRaw.includes('black coffee')) {
    throw new Error('smoke: MEMORY.md missing distilled fact');
  }

  // Verify /status includes config snapshot.
  const status = (await httpGetJson(`http://127.0.0.1:${port}/status`)) as any;
  if (!status?.config?.features || status.config.features.distillationEnabled !== true) {
    throw new Error('smoke: /status config snapshot missing or incorrect');
  }

  await new Promise<void>((resolve) => admin.server.close(() => resolve()));

  console.log('SMOKE_E2E_OK');
  console.log(haloHome);
}

await main();
