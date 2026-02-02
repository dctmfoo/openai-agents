import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';

export type PrimeRunOptions = {
  userId?: string;
  channel?: 'telegram' | 'cli';
};

const getTime = tool({
  name: 'get_time',
  description: 'Get the current time in ISO format. Use when you need an exact timestamp.',
  parameters: z.object({}),
  execute: async () => {
    return new Date().toISOString();
  },
});

export function makePrimeAgent() {
  return new Agent({
    name: 'Prime',
    instructions: [
      'You are Prime, a personal AI companion.',
      'Be helpful, direct, and concise.',
      'If you need the current time, call get_time.',
      'Do not claim you performed actions you did not do.',
    ].join('\n'),
    tools: [getTime],
  });
}

export async function runPrime(input: string, opts: PrimeRunOptions = {}) {
  const agent = makePrimeAgent();

  // Keep it simple for now: no session/memory wired yet.
  const result = await run(agent, input, {
    metadata: {
      userId: opts.userId,
      channel: opts.channel,
    },
  });

  return {
    finalOutput: result.finalOutput,
    raw: result,
  };
}
