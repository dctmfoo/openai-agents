export const DEFAULT_GATEWAY_BASE = 'http://127.0.0.1:8787';

// Only treat it as a full URL if it includes :// (so "localhost:7777" is NOT a scheme).
const hasScheme = (value) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value);

export function resolveGatewayBase(search = '') {
  if (!search) {
    return DEFAULT_GATEWAY_BASE;
  }

  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const override = params.get('gateway');
  if (!override) {
    return DEFAULT_GATEWAY_BASE;
  }

  const trimmed = override.trim();
  if (!trimmed) {
    return DEFAULT_GATEWAY_BASE;
  }

  return hasScheme(trimmed) ? trimmed : `http://${trimmed}`;
}

export function buildStatusUrl(base) {
  return new URL('/status', base).toString();
}

export function formatStatusPayload(payload) {
  return JSON.stringify(payload, null, 2);
}

export function formatStatusError(error, gatewayBase) {
  const base = gatewayBase || DEFAULT_GATEWAY_BASE;
  let detail = 'Unable to reach the gateway.';

  if (error && typeof error === 'object') {
    if ('name' in error && error.name === 'AbortError') {
      detail = 'Gateway request timed out.';
    } else if ('message' in error && typeof error.message === 'string' && error.message.trim()) {
      detail = error.message.trim();
    }
  }

  return `${detail}\n\nMake sure the gateway is running at ${base}.`;
}
