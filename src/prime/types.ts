import type { ToolPolicyContext } from '../policies/toolPolicy.js';
import type { ToolsConfig } from '../runtime/haloConfig.js';

export type PrimeContext = ToolPolicyContext & {
  rootDir: string;
  scopeId: string;
  channel?: 'telegram' | 'cli';
  ageGroup?: 'child' | 'teen' | 'young_adult';
  fileSearchEnabled?: boolean;
  fileSearchVectorStoreId?: string;
  fileSearchIncludeResults?: boolean;
  fileSearchMaxNumResults?: number;
  toolsConfig?: ToolsConfig;
};
