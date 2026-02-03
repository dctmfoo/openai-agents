import {
  buildStatusUrl,
  formatStatusError,
  formatStatusPayload,
  resolveGatewayBase,
} from './status.js';
import {
  buildClearSessionUrl,
  buildSessionsUrl,
  formatSessionsError,
  formatSessionsPayload,
} from './sessions.js';

const statusCard = document.querySelector('[data-status-card]');
const statusTitle = document.querySelector('[data-status-title]');
const statusMeta = document.querySelector('[data-status-meta]');
const statusPayload = document.querySelector('[data-status-payload]');
const statusGateway = document.querySelector('[data-status-gateway]');
const statusRetry = document.querySelector('[data-status-retry]');

const sessionsCard = document.querySelector('[data-sessions-card]');
const sessionsTitle = document.querySelector('[data-sessions-title]');
const sessionsMeta = document.querySelector('[data-sessions-meta]');
const sessionsList = document.querySelector('[data-sessions-list]');
const sessionsPayload = document.querySelector('[data-sessions-payload]');
const sessionsGateway = document.querySelector('[data-sessions-gateway]');
const sessionsRetry = document.querySelector('[data-sessions-retry]');

const gatewayBase = resolveGatewayBase(window.location.search);
const statusUrl = buildStatusUrl(gatewayBase);
const sessionsUrl = buildSessionsUrl(gatewayBase);

if (statusGateway) {
  statusGateway.textContent = gatewayBase;
}
if (sessionsGateway) {
  sessionsGateway.textContent = gatewayBase;
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

const setSessionsLoading = () => {
  sessionsCard?.classList.remove('status--error');
  if (sessionsTitle) sessionsTitle.textContent = 'Sessions';
  if (sessionsMeta) sessionsMeta.textContent = 'Checking...';
  if (sessionsList) sessionsList.textContent = 'Loading sessions...';
  if (sessionsPayload) {
    sessionsPayload.hidden = true;
    sessionsPayload.textContent = '';
  }
};

const setSessionsError = (error) => {
  sessionsCard?.classList.add('status--error');
  if (sessionsTitle) sessionsTitle.textContent = 'Sessions unavailable';
  if (sessionsMeta) sessionsMeta.textContent = 'Unavailable';
  if (sessionsList) sessionsList.textContent = formatSessionsError(error, gatewayBase);
  if (sessionsPayload) {
    sessionsPayload.hidden = true;
    sessionsPayload.textContent = '';
  }
};

const setSessionsSuccess = (payload) => {
  sessionsCard?.classList.remove('status--error');
  if (sessionsTitle) sessionsTitle.textContent = 'Sessions';
  if (sessionsMeta) sessionsMeta.textContent = `Updated ${new Date().toLocaleTimeString()}`;

  if (sessionsList) {
    if (Array.isArray(payload)) {
      sessionsList.textContent = '';
      const list = document.createElement('div');
      list.className = 'sessions';

      if (payload.length === 0) {
        list.textContent = '(no sessions yet)';
      } else {
        for (const entry of payload) {
          const row = document.createElement('div');
          row.className = 'sessions__row';

          const label = document.createElement('div');
          label.className = 'sessions__label';
          label.textContent = `${entry.scopeId} (${entry.itemCount})`;

          const btn = document.createElement('button');
          btn.className = 'status__button';
          btn.type = 'button';
          btn.textContent = 'Clear';
          btn.setAttribute('data-clear-scope-id', entry.scopeId);

          row.appendChild(label);
          row.appendChild(btn);
          list.appendChild(row);
        }
      }

      sessionsList.appendChild(list);
    } else {
      sessionsList.textContent = formatSessionsPayload(payload);
    }
  }

  if (sessionsPayload) {
    sessionsPayload.hidden = true;
    sessionsPayload.textContent = formatSessionsPayload(payload);
  }
};

const fetchSessions = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(sessionsUrl, {
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

const clearSession = async (scopeId) => {
  const url = buildClearSessionUrl(gatewayBase, scopeId);
  const response = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to clear session ${scopeId} (${response.status}).`);
  }
};

const refreshSessions = async () => {
  setSessionsLoading();
  try {
    const payload = await fetchSessions();
    setSessionsSuccess(payload);
  } catch (error) {
    setSessionsError(error);
  }
};

sessionsRetry?.addEventListener('click', () => {
  void refreshSessions();
});

sessionsList?.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest('[data-clear-scope-id]');
  if (!(button instanceof HTMLElement)) return;
  const scopeId = button.getAttribute('data-clear-scope-id');
  if (!scopeId) return;

  try {
    button.setAttribute('disabled', 'disabled');
    await clearSession(scopeId);
    await refreshSessions();
  } catch (error) {
    setSessionsError(error);
  } finally {
    button.removeAttribute('disabled');
  }
});

statusRetry?.addEventListener('click', () => {
  void refreshStatus();
});

void refreshStatus();
void refreshSessions();
