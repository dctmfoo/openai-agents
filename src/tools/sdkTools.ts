import { webSearchTool as createWebSearchTool, type HostedTool } from '@openai/agents';

import { TOOL_NAMES } from './toolNames.js';

export const webSearchTool: HostedTool = createWebSearchTool({
  name: TOOL_NAMES.webSearch,
});
