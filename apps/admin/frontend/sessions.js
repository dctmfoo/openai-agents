export const buildSessionsUrl = (gatewayBase) => {
  const base = gatewayBase.endsWith('/') ? gatewayBase.slice(0, -1) : gatewayBase;
  return `${base}/sessions-with-counts`;
};

export const buildClearSessionUrl = (gatewayBase, scopeId) => {
  const base = gatewayBase.endsWith('/') ? gatewayBase.slice(0, -1) : gatewayBase;
  return `${base}/sessions/${encodeURIComponent(scopeId)}/clear`;
};

export const buildPurgeSessionUrl = (gatewayBase, scopeId, confirm) => {
  const base = gatewayBase.endsWith('/') ? gatewayBase.slice(0, -1) : gatewayBase;
  const url = new URL(`${base}/sessions/${encodeURIComponent(scopeId)}/purge`);
  if (confirm) {
    url.searchParams.set('confirm', confirm);
  }
  return url.toString();
};

export const formatSessionsError = (error, gatewayBase) => {
  const reason = error instanceof Error ? error.message : String(error);
  return [
    'Load failed.',
    '',
    `Make sure the gateway is running at ${gatewayBase}.`,
    '',
    `Details: ${reason}`,
  ].join('\n');
};

export const formatSessionsPayload = (sessions) => {
  if (!Array.isArray(sessions)) {
    return JSON.stringify(sessions, null, 2);
  }

  const lines = sessions.map(({ scopeId, itemCount }) => {
    return `- ${scopeId} (${itemCount}) [clear]`;
  });

  return lines.length ? lines.join('\n') : '(no sessions yet)';
};
