import type { HostedTool } from '@openai/agents';

import { TOOL_NAMES } from './toolNames.js';

export const webSearchTool: HostedTool = {
  type: 'hosted_tool',
  name: TOOL_NAMES.webSearch,
};
