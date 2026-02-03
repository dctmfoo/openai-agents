export const buildPolicyStatusUrl = (gatewayBase: string): string => {
  const base = gatewayBase.endsWith('/') ? gatewayBase.slice(0, -1) : gatewayBase;
  return `${base}/policy/status`;
};

export const formatPolicyPayload = (payload: unknown): string => {
  return JSON.stringify(payload, null, 2);
};

export const formatPolicyError = (error: unknown, gatewayBase: string): string => {
  const reason = error instanceof Error ? error.message : String(error);
  return [
    'Load failed.',
    '',
    `Make sure the gateway is running at ${gatewayBase}.`,
    '',
    `Details: ${reason}`,
  ].join('\n');
};
