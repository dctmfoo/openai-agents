import type { ToolPolicyContext } from '../policies/toolPolicy.js';

export type PrimeContext = ToolPolicyContext & {
  rootDir: string;
  scopeId: string;
  channel?: 'telegram' | 'cli';
};
