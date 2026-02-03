type SessionSummary = {
  scopeId: string;
  itemCount: number;
};

export const buildSessionsUrl = (gatewayBase: string): string => {
  const base = gatewayBase.endsWith('/') ? gatewayBase.slice(0, -1) : gatewayBase;
  return `${base}/sessions-with-counts`;
};

export const buildClearSessionUrl = (gatewayBase: string, scopeId: string): string => {
  const base = gatewayBase.endsWith('/') ? gatewayBase.slice(0, -1) : gatewayBase;
  return `${base}/sessions/${encodeURIComponent(scopeId)}/clear`;
};

export const formatSessionsError = (error: unknown, gatewayBase: string): string => {
  const reason = error instanceof Error ? error.message : String(error);
  return [
    'Load failed.',
    '',
    `Make sure the gateway is running at ${gatewayBase}.`,
    '',
    `Details: ${reason}`,
  ].join('\n');
};

export const formatSessionsPayload = (sessions: unknown): string => {
  return JSON.stringify(sessions, null, 2);
};
