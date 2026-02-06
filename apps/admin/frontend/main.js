import {
  buildStatusUrl,
  formatStatusError,
  formatStatusPayload,
  resolveGatewayBase,
} from './status.js';
import {
  buildClearSessionUrl,
  buildDistillSessionUrl,
  buildPurgeSessionUrl,
  buildSessionsUrl,
  formatSessionsError,
  formatSessionsPayload,
} from './sessions.js';
import {
  buildPolicyStatusUrl,
  formatPolicyError,
  formatPolicyPayload,
} from './policy.js';
import {
  buildTranscriptTailUrl,
  formatTranscriptError,
  formatTranscriptPayload,
} from './transcripts.js';

const statusCard = document.querySelector('[data-status-card]');
const statusTitle = document.querySelector('[data-status-title]');
const statusMeta = document.querySelector('[data-status-meta]');
const statusPayload = document.querySelector('[data-status-payload]');
const statusGateway = document.querySelector('[data-status-gateway]');
const statusRetry = document.querySelector('[data-status-retry]');

const semanticCard = document.querySelector('[data-semantic-card]');
const semanticTitle = document.querySelector('[data-semantic-title]');
const semanticMeta = document.querySelector('[data-semantic-meta]');
const semanticPayload = document.querySelector('[data-semantic-payload]');
const semanticGateway = document.querySelector('[data-semantic-gateway]');

const sessionsCard = document.querySelector('[data-sessions-card]');
const sessionsTitle = document.querySelector('[data-sessions-title]');
const sessionsMeta = document.querySelector('[data-sessions-meta]');
const sessionsList = document.querySelector('[data-sessions-list]');
const sessionsPayload = document.querySelector('[data-sessions-payload]');
const sessionsGateway = document.querySelector('[data-sessions-gateway]');
const sessionsRetry = document.querySelector('[data-sessions-retry]');

const policyCard = document.querySelector('[data-policy-card]');
const policyTitle = document.querySelector('[data-policy-title]');
const policyMeta = document.querySelector('[data-policy-meta]');
const policyList = document.querySelector('[data-policy-list]');
const policyPayload = document.querySelector('[data-policy-payload]');
const policyGateway = document.querySelector('[data-policy-gateway]');
const policyRetry = document.querySelector('[data-policy-retry]');

const transcriptCard = document.querySelector('[data-transcript-card]');
const transcriptTitle = document.querySelector('[data-transcript-title]');
const transcriptMeta = document.querySelector('[data-transcript-meta]');
const transcriptPayload = document.querySelector('[data-transcript-payload]');
const transcriptGateway = document.querySelector('[data-transcript-gateway]');
const transcriptScope = document.querySelector('[data-transcript-scope]');
const transcriptLines = document.querySelector('[data-transcript-lines]');
const transcriptFetch = document.querySelector('[data-transcript-fetch]');

const gatewayBase = resolveGatewayBase(window.location.search);
const statusUrl = buildStatusUrl(gatewayBase);
const sessionsUrl = buildSessionsUrl(gatewayBase);
const policyUrl = buildPolicyStatusUrl(gatewayBase);

if (statusGateway) {
  statusGateway.textContent = gatewayBase;
}
if (semanticGateway) {
  semanticGateway.textContent = gatewayBase;
}
if (sessionsGateway) {
  sessionsGateway.textContent = gatewayBase;
}
if (policyGateway) {
  policyGateway.textContent = gatewayBase;
}
if (transcriptGateway) {
  transcriptGateway.textContent = gatewayBase;
}

const formatMaybeTime = (value) => {
  if (!Number.isFinite(value)) return '—';
  return new Date(value).toLocaleString();
};

const setSemanticLoading = () => {
  semanticCard?.classList.remove('status--error');
  if (semanticTitle) semanticTitle.textContent = 'Semantic sync';
  if (semanticMeta) semanticMeta.textContent = 'Checking...';
  if (semanticPayload) semanticPayload.textContent = 'Loading semantic sync status...';
};

const setSemanticError = (error) => {
  semanticCard?.classList.add('status--error');
  if (semanticTitle) semanticTitle.textContent = 'Semantic sync unavailable';
  if (semanticMeta) semanticMeta.textContent = 'Unavailable';
  if (semanticPayload) semanticPayload.textContent = formatStatusError(error, gatewayBase);
};

const setSemanticSuccess = (payload) => {
  semanticCard?.classList.remove('status--error');
  if (semanticTitle) semanticTitle.textContent = 'Semantic sync';
  if (semanticMeta) semanticMeta.textContent = `Updated ${new Date().toLocaleTimeString()}`;

  if (!semanticPayload) return;

  const semantic = payload && typeof payload === 'object' ? payload.semanticSync : null;
  if (!semantic || typeof semantic !== 'object') {
    semanticPayload.textContent = 'Gateway did not report semantic sync status.';
    return;
  }

  const lines = [
    `Enabled: ${semantic.enabled ? 'yes' : 'no'}`,
    `Interval (minutes): ${semantic.intervalMinutes ?? '—'}`,
    `Active scopes: ${semantic.activeScopeCount ?? 0}`,
    `Running: ${semantic.running ? 'yes' : 'no'}`,
    `Total runs: ${semantic.totalRuns ?? 0}`,
    `Total failures: ${semantic.totalFailures ?? 0}`,
    `Last run started: ${formatMaybeTime(semantic.lastRunStartedAtMs)}`,
    `Last run finished: ${formatMaybeTime(semantic.lastRunFinishedAtMs)}`,
    `Last success: ${formatMaybeTime(semantic.lastSuccessAtMs)}`,
  ];

  if (semantic.lastError && typeof semantic.lastError === 'object') {
    lines.push('Last error:');
    if (semantic.lastError.scopeId) {
      lines.push(`  scope: ${semantic.lastError.scopeId}`);
    }
    lines.push(`  at: ${formatMaybeTime(semantic.lastError.atMs)}`);
    lines.push(`  message: ${semantic.lastError.message ?? 'unknown error'}`);
  } else {
    lines.push('Last error: —');
  }

  semanticPayload.textContent = lines.join('\n');
};

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
  setSemanticLoading();
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
  setSemanticError(error);
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
  setSemanticSuccess(payload);
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

          const actions = document.createElement('div');
          actions.className = 'sessions__actions';

          const result = document.createElement('div');
          result.className = 'sessions__result';
          result.setAttribute('data-distill-result-scope-id', entry.scopeId);
          result.textContent = '';

          const tailBtn = document.createElement('button');
          tailBtn.className = 'status__button';
          tailBtn.type = 'button';
          tailBtn.textContent = 'Tail';
          tailBtn.setAttribute('data-tail-scope-id', entry.scopeId);

          const distillBtn = document.createElement('button');
          distillBtn.className = 'status__button';
          distillBtn.type = 'button';
          distillBtn.textContent = 'Distill now';
          distillBtn.setAttribute('data-distill-scope-id', entry.scopeId);

          const clearBtn = document.createElement('button');
          clearBtn.className = 'status__button';
          clearBtn.type = 'button';
          clearBtn.textContent = 'Clear';
          clearBtn.setAttribute('data-clear-scope-id', entry.scopeId);

          const purgeBtn = document.createElement('button');
          purgeBtn.className = 'status__button status__button--danger';
          purgeBtn.type = 'button';
          purgeBtn.textContent = 'Purge';
          purgeBtn.setAttribute('data-purge-scope-id', entry.scopeId);

          actions.appendChild(tailBtn);
          actions.appendChild(distillBtn);
          actions.appendChild(clearBtn);
          actions.appendChild(purgeBtn);

          row.appendChild(label);
          row.appendChild(actions);
          row.appendChild(result);
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

const distillSession = async (scopeId) => {
  const url = buildDistillSessionUrl(gatewayBase, scopeId);
  const response = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json' },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 409 && payload && payload.error === 'distillation_disabled') {
      throw new Error('Distillation is disabled (config.features.distillationEnabled=false).');
    }
    throw new Error(`Failed to distill session ${scopeId} (${response.status}).`);
  }

  return payload;
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

const setPolicyLoading = () => {
  policyCard?.classList.remove('status--error');
  if (policyTitle) policyTitle.textContent = 'Policy status';
  if (policyMeta) policyMeta.textContent = 'Checking...';
  if (policyList) policyList.textContent = 'Loading policy status...';
  if (policyPayload) {
    policyPayload.hidden = true;
    policyPayload.textContent = '';
  }
};

const setPolicyError = (error) => {
  policyCard?.classList.add('status--error');
  if (policyTitle) policyTitle.textContent = 'Policy unavailable';
  if (policyMeta) policyMeta.textContent = 'Unavailable';
  if (policyList) policyList.textContent = formatPolicyError(error, gatewayBase);
  if (policyPayload) {
    policyPayload.hidden = true;
    policyPayload.textContent = '';
  }
};

const setPolicySuccess = (payload) => {
  policyCard?.classList.remove('status--error');
  if (policyTitle) policyTitle.textContent = 'Policy status';
  if (policyMeta) policyMeta.textContent = `Updated ${new Date().toLocaleTimeString()}`;

  if (policyList) {
    if (payload && Array.isArray(payload.scopes)) {
      policyList.textContent = '';
      const list = document.createElement('div');
      list.className = 'policy-list';

      if (payload.scopes.length === 0) {
        list.textContent = '(no policy scopes yet)';
      } else {
        for (const scope of payload.scopes) {
          const row = document.createElement('div');
          row.className = 'policy-row';

          const info = document.createElement('div');
          info.className = 'policy-info';

          const label = document.createElement('div');
          label.className = 'policy-label';
          label.textContent = scope.scopeId ?? '(unknown scope)';

          const meta = document.createElement('div');
          meta.className = 'policy-meta';
          const metaParts = [];
          if (scope.displayName) metaParts.push(scope.displayName);
          if (scope.role) metaParts.push(scope.role);
          if (scope.scopeType) metaParts.push(scope.scopeType.replace('_', ' '));
          meta.textContent = metaParts.length > 0 ? metaParts.join(' · ') : 'unknown';

          info.appendChild(label);
          info.appendChild(meta);

          const state = document.createElement('div');
          state.className = 'policy-state';

          const status = document.createElement('div');
          status.className = `policy-status ${
            scope.allow ? 'policy-status--allow' : 'policy-status--deny'
          }`;
          status.textContent = scope.allow ? 'Allowed' : 'Denied';

          const reason = document.createElement('div');
          reason.className = 'policy-reason';
          reason.textContent = scope.allow ? '—' : scope.reason ?? 'blocked';

          state.appendChild(status);
          state.appendChild(reason);

          row.appendChild(info);
          row.appendChild(state);
          list.appendChild(row);
        }
      }

      policyList.appendChild(list);
    } else {
      policyList.textContent = formatPolicyPayload(payload);
    }
  }

  if (policyPayload) {
    policyPayload.hidden = true;
    policyPayload.textContent = formatPolicyPayload(payload);
  }
};

const fetchPolicy = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(policyUrl, {
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

const refreshPolicy = async () => {
  setPolicyLoading();
  try {
    const payload = await fetchPolicy();
    setPolicySuccess(payload);
  } catch (error) {
    setPolicyError(error);
  }
};

const setTranscriptLoading = () => {
  transcriptCard?.classList.remove('status--error');
  if (transcriptTitle) transcriptTitle.textContent = 'Transcript tail (local)';
  if (transcriptMeta) transcriptMeta.textContent = 'Loading...';
  if (transcriptPayload) transcriptPayload.textContent = 'Fetching transcript tail...';
};

const setTranscriptError = (error) => {
  transcriptCard?.classList.add('status--error');
  if (transcriptTitle) transcriptTitle.textContent = 'Transcript unavailable';
  if (transcriptMeta) transcriptMeta.textContent = 'Unavailable';
  if (transcriptPayload) {
    transcriptPayload.textContent = formatTranscriptError(error, gatewayBase);
  }
};

const setTranscriptSuccess = (payload) => {
  transcriptCard?.classList.remove('status--error');
  if (transcriptTitle) transcriptTitle.textContent = 'Transcript tail (local)';
  if (transcriptMeta) transcriptMeta.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  if (transcriptPayload) transcriptPayload.textContent = formatTranscriptPayload(payload);
};

const fetchTranscript = async (scopeId, lines) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(buildTranscriptTailUrl(gatewayBase, scopeId, lines), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('Local-only endpoint. Use a loopback gateway host.');
      }
      throw new Error(`Gateway responded with ${response.status}.`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const refreshTranscript = async () => {
  const scopeId =
    transcriptScope instanceof HTMLInputElement ? transcriptScope.value.trim() : '';
  if (!scopeId) {
    setTranscriptError(new Error('Enter a scope id to fetch transcript tail.'));
    return;
  }

  let lines;
  if (transcriptLines instanceof HTMLInputElement) {
    const parsed = Number.parseInt(transcriptLines.value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      lines = parsed;
    }
  }

  setTranscriptLoading();
  try {
    const payload = await fetchTranscript(scopeId, lines);
    setTranscriptSuccess(payload);
  } catch (error) {
    setTranscriptError(error);
  }
};

const purgeSession = async (scopeId, confirm) => {
  const url = buildPurgeSessionUrl(gatewayBase, scopeId, confirm);
  const response = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('Local-only endpoint. Use a loopback gateway host.');
    }
    throw new Error(`Failed to purge session ${scopeId} (${response.status}).`);
  }
};

sessionsRetry?.addEventListener('click', () => {
  void refreshSessions();
});

sessionsList?.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const tailButton = target.closest('[data-tail-scope-id]');
  if (tailButton instanceof HTMLElement) {
    const scopeId = tailButton.getAttribute('data-tail-scope-id');
    if (!scopeId) return;
    if (transcriptScope instanceof HTMLInputElement) {
      transcriptScope.value = scopeId;
    }
    void refreshTranscript();
    return;
  }

  const clearButton = target.closest('[data-clear-scope-id]');
  if (clearButton instanceof HTMLElement) {
    const scopeId = clearButton.getAttribute('data-clear-scope-id');
    if (!scopeId) return;

    try {
      clearButton.setAttribute('disabled', 'disabled');
      await clearSession(scopeId);
      await refreshSessions();
    } catch (error) {
      setSessionsError(error);
    } finally {
      clearButton.removeAttribute('disabled');
    }
    return;
  }

  const distillButton = target.closest('[data-distill-scope-id]');
  if (distillButton instanceof HTMLElement) {
    const scopeId = distillButton.getAttribute('data-distill-scope-id');
    if (!scopeId) return;

    const resultEl = sessionsList?.querySelector(
      `[data-distill-result-scope-id="${CSS.escape(scopeId)}"]`,
    );

    try {
      distillButton.setAttribute('disabled', 'disabled');
      if (resultEl) resultEl.textContent = 'Distilling…';
      const payload = await distillSession(scopeId);
      const facts = payload?.durableFacts ?? '?';
      const notes = payload?.temporalNotes ?? '?';
      if (resultEl) resultEl.textContent = `Done: durableFacts=${facts}, temporalNotes=${notes}`;
    } catch (error) {
      if (resultEl) {
        const msg = error instanceof Error ? error.message : String(error);
        resultEl.textContent = `Error: ${msg}`;
      } else {
        setSessionsError(error);
      }
    } finally {
      distillButton.removeAttribute('disabled');
    }
    return;
  }

  const purgeButton = target.closest('[data-purge-scope-id]');
  if (purgeButton instanceof HTMLElement) {
    const scopeId = purgeButton.getAttribute('data-purge-scope-id');
    if (!scopeId) return;

    const confirmation = window.prompt(
      `Type the scope id to purge session + transcript:\\n${scopeId}`,
    );
    if (!confirmation) return;
    if (confirmation.trim() !== scopeId) {
      setSessionsError(new Error('Confirmation did not match. Purge cancelled.'));
      return;
    }

    try {
      purgeButton.setAttribute('disabled', 'disabled');
      await purgeSession(scopeId, confirmation.trim());
      await refreshSessions();
      if (transcriptScope instanceof HTMLInputElement && transcriptScope.value === scopeId) {
        if (transcriptPayload) {
          transcriptPayload.textContent = 'Transcript purged. Choose another scope.';
        }
      }
    } catch (error) {
      setSessionsError(error);
    } finally {
      purgeButton.removeAttribute('disabled');
    }
  }
});

policyRetry?.addEventListener('click', () => {
  void refreshPolicy();
});

transcriptFetch?.addEventListener('click', () => {
  void refreshTranscript();
});

statusRetry?.addEventListener('click', () => {
  void refreshStatus();
});

void refreshStatus();
void refreshSessions();
void refreshPolicy();
