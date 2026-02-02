import {
  buildStatusUrl,
  formatStatusError,
  formatStatusPayload,
  resolveGatewayBase,
} from './status.js';

const statusCard = document.querySelector('[data-status-card]');
const statusTitle = document.querySelector('[data-status-title]');
const statusMeta = document.querySelector('[data-status-meta]');
const statusPayload = document.querySelector('[data-status-payload]');
const statusGateway = document.querySelector('[data-status-gateway]');
const statusRetry = document.querySelector('[data-status-retry]');

const gatewayBase = resolveGatewayBase(window.location.search);
const statusUrl = buildStatusUrl(gatewayBase);

if (statusGateway) {
  statusGateway.textContent = gatewayBase;
}

const setLoading = () => {
  statusCard?.classList.remove('status--error');
  if (statusTitle) {
    statusTitle.textContent = 'Gateway status';
  }
  if (statusMeta) {
    statusMeta.textContent = 'Checking...';
  }
  if (statusPayload) {
    statusPayload.textContent = 'Loading gateway status...';
  }
};

const setError = (error) => {
  statusCard?.classList.add('status--error');
  if (statusTitle) {
    statusTitle.textContent = 'Gateway offline';
  }
  if (statusMeta) {
    statusMeta.textContent = 'Unavailable';
  }
  if (statusPayload) {
    statusPayload.textContent = formatStatusError(error, gatewayBase);
  }
};

const setSuccess = (payload) => {
  statusCard?.classList.remove('status--error');
  if (statusTitle) {
    statusTitle.textContent = 'Gateway status';
  }
  if (statusMeta) {
    const now = new Date();
    statusMeta.textContent = `Updated ${now.toLocaleTimeString()}`;
  }
  if (statusPayload) {
    statusPayload.textContent = formatStatusPayload(payload);
  }
};

const fetchStatus = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(statusUrl, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Gateway responded with ${response.status}.`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const refreshStatus = async () => {
  setLoading();
  try {
    const payload = await fetchStatus();
    setSuccess(payload);
  } catch (error) {
    setError(error);
  }
};

statusRetry?.addEventListener('click', () => {
  void refreshStatus();
});

void refreshStatus();
