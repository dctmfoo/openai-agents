import path from 'node:path';

type StartupMode = 'gateway' | 'telegram' | 'cli';

type StartupErrorContext = {
  mode: StartupMode;
  haloHome: string;
  logDir: string;
};

const normalizeMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return String(err);
};

const uniqueSteps = (steps: string[]): string[] => {
  return Array.from(new Set(steps));
};

const buildNextSteps = (message: string, configPath: string, familyPath: string): string[] => {
  const steps: string[] = [];
  const lower = message.toLowerCase();

  if (lower.includes('telegram_bot_token')) {
    steps.push('Set TELEGRAM_BOT_TOKEN in your environment or .env file.');
  }
  if (lower.includes('openai_api_key')) {
    steps.push('Set OPENAI_API_KEY in your environment or .env file.');
  }
  if (lower.includes('config.json')) {
    steps.push(`Copy config/halo.example.json to ${configPath} and edit it.`);
  }
  if (lower.includes('family.json') || lower.includes('family config')) {
    steps.push(`Copy config/family.example.json to ${familyPath} and edit it.`);
  }
  if (lower.includes('sqlite_vec_ext') || lower.includes('sqlite-vec')) {
    steps.push('Set SQLITE_VEC_EXT or disable semanticMemory in config.json.');
  }
  if (lower.includes('gateway.port')) {
    steps.push('Update gateway.port in config.json to a positive integer.');
  }

  steps.push('Run `pnpm doctor` to validate env and config.');
  return uniqueSteps(steps);
};

export function reportStartupError(err: unknown, context: StartupErrorContext): void {
  const message = normalizeMessage(err);
  const configPath = path.join(context.haloHome, 'config.json');
  const familyPath = path.join(context.haloHome, 'config', 'family.json');
  const eventsPath = path.join(context.logDir, 'events.jsonl');

  console.error(`halo (${context.mode}) failed to start.`);
  console.error(`Reason: ${message}`);
  console.error('Relevant paths:');
  console.error(`- HALO_HOME: ${context.haloHome}`);
  console.error(`- Config: ${configPath}`);
  console.error(`- Family config: ${familyPath}`);
  console.error(`- Logs (events): ${eventsPath}`);
  console.error(`- Transcripts: ${path.join(context.haloHome, 'transcripts')}`);
  console.error(`- Sessions: ${path.join(context.haloHome, 'sessions')}`);
  console.error(`- Memory: ${path.join(context.haloHome, 'memory')}`);
  console.error('Next steps:');
  for (const step of buildNextSteps(message, configPath, familyPath)) {
    console.error(`- ${step}`);
  }
}
