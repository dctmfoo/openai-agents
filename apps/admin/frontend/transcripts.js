export const buildTranscriptTailUrl = (gatewayBase, scopeId, lines) => {
  const base = gatewayBase.endsWith('/') ? gatewayBase.slice(0, -1) : gatewayBase;
  const url = new URL(`${base}/transcripts/tail`);
  url.searchParams.set('scopeId', scopeId);
  if (Number.isFinite(lines)) {
    url.searchParams.set('lines', String(lines));
  }
  return url.toString();
};

export const formatTranscriptPayload = (payload) => {
  return JSON.stringify(payload, null, 2);
};

export const formatTranscriptError = (error, gatewayBase) => {
  const reason = error instanceof Error ? error.message : String(error);
  return [
    'Load failed.',
    '',
    `Make sure the gateway is running at ${gatewayBase}.`,
    '',
    `Details: ${reason}`,
  ].join('\n');
};
