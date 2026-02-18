import type { ToolPolicyContext } from '../policies/toolPolicy.js';
import type { ToolsConfig } from '../runtime/haloConfig.js';
import type { ToolName } from '../tools/toolNames.js';

export type PrimeContext = ToolPolicyContext & {
  rootDir: string;
  scopeId: string;
  channel?: 'telegram' | 'cli';
  ageGroup?: 'child' | 'teen' | 'young_adult';
  contextMode?: 'full' | 'light';
  fileSearchEnabled?: boolean;
  fileSearchVectorStoreId?: string;
  fileSearchIncludeResults?: boolean;
  fileSearchMaxNumResults?: number;
  disabledToolNames?: ToolName[];
  toolsConfig?: ToolsConfig;
  allowedMemoryReadLanes?: string[];
  allowedMemoryReadScopes?: string[];
};
