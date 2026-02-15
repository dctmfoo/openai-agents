export const TOOL_NAMES = {
  webSearch: 'web_search_call',
  readScopedMemory: 'read_scoped_memory',
  rememberDaily: 'remember_daily',
  semanticSearch: 'semantic_search',
  fileSearch: 'file_search',
  shell: 'shell',
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];
