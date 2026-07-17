import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error';

type RuntimeLogRecord = {
  ts: string;
  level: RuntimeLogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
};

type RuntimeLoggerOptions = {
  logDir: string;
  component: string;
  level?: RuntimeLogLevel;
  echoToConsole?: boolean;
};

const LOG_LEVEL_WEIGHT: Record<RuntimeLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const normalizeLevel = (value: string | undefined): RuntimeLogLevel => {
  if (!value) return 'info';
  const lowered = value.toLowerCase();
  if (lowered === 'debug' || lowered === 'info' || lowered === 'warn' || lowered === 'error') {
    return lowered;
  }
  return 'info';
};

export function serializeError(err: unknown): { name: string; message: string; stack?: string } | string {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }

  return String(err);
}

type RuntimeLogger = {
  debug: (message: string, data?: Record<string, unknown>) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
  child: (name: string) => RuntimeLogger;
};

export function createRuntimeLogger(options: RuntimeLoggerOptions): RuntimeLogger {
  const threshold = normalizeLevel(options.level ?? process.env.HALO_LOG_LEVEL);
  const echoToConsole = options.echoToConsole ?? process.env.NODE_ENV !== 'test';
  const logPath = path.join(options.logDir, 'runtime.jsonl');

  const write = async (level: RuntimeLogLevel, message: string, data?: Record<string, unknown>) => {
    if (LOG_LEVEL_WEIGHT[level] < LOG_LEVEL_WEIGHT[threshold]) {
      return;
    }

    const record: RuntimeLogRecord = {
      ts: new Date().toISOString(),
      level,
      component: options.component,
      message,
      ...(data ? { data } : {}),
    };

    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, JSON.stringify(record) + '\n', 'utf8');

    if (!echoToConsole) return;

    const prefix = `[${record.ts}] [${record.level}] [${record.component}] ${record.message}`;
    if (level === 'error' || level === 'warn') {
      console.error(prefix, data ?? '');
    } else {
      console.log(prefix, data ?? '');
    }
  };

  const fireAndForget = (level: RuntimeLogLevel, message: string, data?: Record<string, unknown>) => {
    void write(level, message, data).catch((err) => {
      const fallback = serializeError(err);
      console.error(`[runtime-logger-failure] ${options.component}`, fallback);
    });
  };

  return {
    debug: (message, data) => fireAndForget('debug', message, data),
    info: (message, data) => fireAndForget('info', message, data),
    warn: (message, data) => fireAndForget('warn', message, data),
    error: (message, data) => fireAndForget('error', message, data),
    child: (name) =>
      createRuntimeLogger({
        ...options,
        component: `${options.component}.${name}`,
      }),
  };
}
