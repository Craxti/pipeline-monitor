// ─────────────────────────────────────────────────────────────────────────────
// AI Chat (split out of dashboard.js)
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  const logModal = document.getElementById('log-modal');
  if (e.key === 'Escape' && logModal && logModal.classList.contains('open') && typeof closeLogModal === 'function') {
    closeLogModal();
  }
  const chatPanel = document.getElementById('ai-chat-panel');
  if (e.key === 'Escape' && chatPanel && chatPanel.classList.contains('open')) toggleChat();
  // Ctrl+F inside log modal → focus custom search
  if ((e.ctrlKey || e.metaKey) && e.key === 'f' && logModal && logModal.classList.contains('open')) {
    e.preventDefault();
    const inp = document.getElementById('log-search-input');
    if (inp) { inp.focus(); inp.select(); }
  }
});

/** Human-readable names for `?tab=` on the main dashboard (sent to the model). */
const _CHAT_TAB_LABELS = {
  overview: 'Overview — metrics, status map, situation',
  builds: 'Builds — pipelines, filters, starred jobs',
  tests: 'Tests — top failures and test runs',
  services: 'Services — Docker containers, HTTP checks',
  trends: 'Trends — charts over time',
  incidents: 'Incidents — correlated failures',
  logs: 'Logs — collect output and parsers',
};

function _gatherUiLocationContext() {
  const href = (typeof location !== 'undefined' && location.href) ? location.href : '';
  const page = (document.body && document.body.dataset && document.body.dataset.page) || '';
  const lines = [
    'URL: ' + href,
    'Screen: ' + (page === 'settings' ? 'Settings (YAML-backed configuration in the browser)' : 'Main dashboard'),
  ];
  if (page === 'settings') {
    const nav = document.querySelector('.snav-item.active');
    if (nav) lines.push('Active settings section: ' + nav.textContent.trim().replace(/\s+/g, ' '));
  } else if (page === 'dashboard' || !page) {
    let tab = '';
    try {
      tab = (new URL(href)).searchParams.get('tab') || '';
    } catch { /* ignore */ }
    if (!tab && typeof _dashTab !== 'undefined' && _dashTab) tab = String(_dashTab);
    if (!tab) tab = 'overview';
    const label = _CHAT_TAB_LABELS[tab] || ('Tab «' + tab + '»');
    lines.push('Dashboard tab: ' + tab + ' — ' + label);
  }
  return lines.join('\n');
}

const CHAT_HISTORY_KEY = 'cimon-ai-chat-history';
const CHAT_MAX_MESSAGES = 100;
const _chatHistory = [];
let _chatStreaming = false;
let _chatModel = '';

function _persistChatHistory() {
  try {
    const trimmed = _chatHistory.slice(-CHAT_MAX_MESSAGES);
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(trimmed));
  } catch { /* ignore quota / private mode */ }
}

function _loadChatHistoryFromStorage() {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    _chatHistory.length = 0;
    for (const m of arr) {
      if (!m || typeof m !== 'object') continue;
      const role = m.role;
      const content = m.content;
      if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content.length) {
        _chatHistory.push({ role, content });
      }
    }
    if (_chatHistory.length > CHAT_MAX_MESSAGES) {
      _chatHistory.splice(0, _chatHistory.length - CHAT_MAX_MESSAGES);
    }
  } catch { /* ignore */ }
}

function _renderChatHistoryDom() {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  box.innerHTML = '';
  if (!_chatHistory.length) {
    const sys = document.createElement('div');
    sys.className = 'chat-msg system';
    sys.setAttribute('data-i18n', 'dash.chat_hello');
    sys.textContent = t('dash.chat_hello');
    box.appendChild(sys);
    return;
  }
  for (const m of _chatHistory) {
    if (m.role === 'assistant') {
      const div = document.createElement('div');
      div.className = 'chat-msg assistant';
      div.innerHTML = _miniMarkdown(m.content);
      box.appendChild(div);
    } else {
      const div = document.createElement('div');
      div.className = 'chat-msg user';
      div.textContent = m.content;
      box.appendChild(div);
    }
  }
  box.scrollTop = box.scrollHeight;
}

function _refreshChatHelloI18n() {
  const box = document.getElementById('chat-messages');
  if (!box || _chatHistory.length) return;
  const sys = box.querySelector('.chat-msg.system[data-i18n="dash.chat_hello"]');
  if (sys) sys.textContent = t('dash.chat_hello');
}

(async function initChat() {
  try {
    const r = await fetch(apiUrl('api/chat/status'));
    if (!r.ok) return;
    const d = await r.json();
    if (d.configured) {
      document.getElementById('ai-chat-fab').style.display = 'flex';
      _chatModel = d.model || '';
      const prov = d.provider || 'openai';
      let badge = _chatModel;
      if (prov !== 'openai') badge = prov + ' · ' + badge;
      if (d.proxy_enabled) badge += ' · proxy';
      document.getElementById('chat-model-badge').textContent = badge;
      if (prov === 'cursor' && d.cursor_agent_found === false) {
        const w = document.getElementById('chat-cursor-warn');
        if (w) w.style.display = 'block';
      }
      _loadChatHistoryFromStorage();
      _renderChatHistoryDom();
    }
  } catch {}
})();

function toggleChat() {
  const panel = document.getElementById('ai-chat-panel');
  const fab = document.getElementById('ai-chat-fab');
  const open = panel.classList.toggle('open');
  fab.classList.toggle('has-panel', open);
  document.getElementById('fab-icon').innerHTML = open ? '&times;' : '&#129302;';
  if (open) {
    document.getElementById('chat-input').focus();
    const msgs = document.getElementById('chat-messages');
    msgs.scrollTop = msgs.scrollHeight;
  }
}

function clearChat() {
  _chatHistory.length = 0;
  try { localStorage.removeItem(CHAT_HISTORY_KEY); } catch { /* ignore */ }
  const box = document.getElementById('chat-messages');
  if (!box) return;
  const sys = document.createElement('div');
  sys.className = 'chat-msg system';
  sys.textContent = t('dash.chat_cleared_ok');
  box.innerHTML = '';
  box.appendChild(sys);
}

function _gatherContext() {
  const parts = [];
  const status = document.getElementById('summary-bar');
  if (status) {
    const stats = status.querySelectorAll('.stat');
    const vals = [];
    stats.forEach(s => {
      const label = s.querySelector('.l');
      const num = s.querySelector('.n');
      if (label && num) vals.push(label.textContent.trim() + ': ' + num.textContent.trim());
    });
    if (vals.length) parts.push('Summary: ' + vals.join(', '));
  }

  const buildRows = document.querySelectorAll('#tbody-builds tr:not(.empty-row)');
  if (buildRows.length) {
    const rows = [];
    buildRows.forEach((tr, i) => {
      if (i >= 15) return;
      const cells = tr.querySelectorAll('td');
      const texts = [];
      cells.forEach(c => texts.push(c.textContent.trim().replace(/\s+/g, ' ')));
      rows.push(texts.join(' | '));
    });
    parts.push('Recent builds:\n' + rows.join('\n'));
  }

  const svcRows = document.querySelectorAll('#tbody-svcs tr:not(.empty-row)');
  if (svcRows.length) {
    const rows = [];
    svcRows.forEach((tr, i) => {
      if (i >= 20) return;
      const cells = tr.querySelectorAll('td');
      const texts = [];
      cells.forEach(c => texts.push(c.textContent.trim().replace(/\s+/g, ' ')));
      rows.push(texts.join(' | '));
    });
    parts.push('Services:\n' + rows.join('\n'));
  }

  const failRows = document.querySelectorAll('#tbody-failures tr:not(.empty-row)');
  if (failRows.length) {
    const rows = [];
    failRows.forEach((tr, i) => {
      if (i >= 15) return;
      const cells = tr.querySelectorAll('td');
      const texts = [];
      cells.forEach(c => texts.push(c.textContent.trim().replace(/\s+/g, ' ')));
      rows.push(texts.join(' | '));
    });
    parts.push('Top test failures:\n' + rows.join('\n'));
  }

  const logPre = document.getElementById('log-modal-pre');
  const logModal = document.getElementById('log-modal');
  if (logPre && logModal && logModal.classList.contains('open')) {
    const logTitle = document.getElementById('log-modal-title')?.textContent || 'Log';
    const logText = logPre.textContent.slice(-4000);
    parts.push('Currently open log (' + logTitle + '):\n' + logText);
  }

  return parts.join('\n\n');
}

function _miniMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => '<pre><code>' + code.trim() + '</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
  return html;
}

function _appendMsg(role, content) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  if (role === 'assistant') {
    div.innerHTML = _miniMarkdown(content);
  } else if (role === 'error') {
    div.textContent = content;
  } else {
    div.textContent = content;
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

async function sendChat() {
  if (_chatStreaming) return;
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = 'auto';
  _appendMsg('user', text);
  _chatHistory.push({ role: 'user', content: text });
  _persistChatHistory();

  const sendBtn = document.getElementById('chat-send-btn');
  sendBtn.disabled = true;
  _chatStreaming = true;

  const box = document.getElementById('chat-messages');
  const typing = document.createElement('div');
  typing.className = 'chat-typing';
  typing.textContent = 'Thinking';
  box.appendChild(typing);
  box.scrollTop = box.scrollHeight;

  const body = { messages: _chatHistory, ui_location: _gatherUiLocationContext() };
  if (document.getElementById('chat-ctx-toggle').checked) {
    body.context = _gatherContext();
  }

  let fullResponse = '';
  let assistantDiv = null;
  let streamError = '';

  try {
    const res = await fetch(apiUrl('api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.detail || res.statusText);
    }

    typing.remove();
    assistantDiv = _appendMsg('assistant', '');

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let aborted = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          aborted = true;
          break;
        }
        try {
          const d = JSON.parse(payload);
          if (d.error) {
            streamError = d.error;
            _appendMsg('error', d.error);
            aborted = true;
            break;
          }
          if (d.t) {
            fullResponse += d.t;
            assistantDiv.innerHTML = _miniMarkdown(fullResponse);
            box.scrollTop = box.scrollHeight;
          }
        } catch (parseErr) {
          if (payload && payload !== '[DONE]') {
            console.warn('chat SSE parse', parseErr, payload.slice(0, 120));
          }
        }
      }
      if (aborted) break;
    }
    if (!fullResponse && !streamError && assistantDiv) {
      assistantDiv.innerHTML = '<span style="color:var(--muted)">Нет текста в ответе. Провайдер Cursor: в папке IDE обычно нет `agent` — нужен отдельный Cursor Agent CLI или путь в Настройках → AI. См. документацию CLI.</span>';
    }
  } catch (e) {
    typing.remove();
    _appendMsg('error', e.message || 'Connection failed');
  }

  if (fullResponse) {
    _chatHistory.push({ role: 'assistant', content: fullResponse });
    _persistChatHistory();
    // After streaming done, inject quick action buttons if AI suggested them
    if (assistantDiv) _injectQuickActions(assistantDiv, fullResponse);
  }

  _chatStreaming = false;
  sendBtn.disabled = false;
  document.getElementById('chat-input').focus();
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Quick Actions
// ─────────────────────────────────────────────────────────────────────────────
function _injectQuickActions(msgDiv, text) {
  if (document.body && document.body.dataset && document.body.dataset.page !== 'dashboard') return;
  // Detect container names mentioned with "restart", "stop", "start" context
  // Also look for jobs mentioned with "re-run", "trigger", "run"
  const actions = [];
  const textLower = text.toLowerCase();

  // Scan services panel for containers to suggest restart
  document.querySelectorAll('#tbody-svcs tr').forEach(tr => {
    const nameCell = tr.querySelector('td:first-child strong');
    if (!nameCell) return;
    const name = nameCell.textContent.trim();
    const nameLower = name.toLowerCase();
    if (textLower.includes(nameLower)) {
      const statusCell = tr.querySelector('td:nth-child(3)');
      const status = statusCell ? statusCell.textContent.trim().toLowerCase() : '';
      if (status === 'down' || textLower.includes('restart') || textLower.includes('stop')) {
        actions.push({ label: `↻ Restart ${name}`, action: () => { const btn = document.createElement('button'); dockerContainerAction(btn, name, 'restart'); } });
      }
      if (status === 'down') {
        actions.push({ label: `▶ Start ${name}`, action: () => { const btn = document.createElement('button'); dockerContainerAction(btn, name, 'start'); } });
      }
    }
  });

  // Scan builds panel for Jenkins jobs
  document.querySelectorAll('#tbody-builds tr').forEach(tr => {
    const srcCell = tr.querySelector('td:nth-child(2)');
    const jobCell = tr.querySelector('td:nth-child(3)');
    if (!srcCell || !jobCell) return;
    const src = srcCell.textContent.trim().toLowerCase();
    const job = jobCell.textContent.trim().replace(/FLAKY$/, '').trim();
    const jobLower = job.toLowerCase();
    if (textLower.includes(jobLower) && (textLower.includes('re-run') || textLower.includes('rerun') || textLower.includes('trigger') || textLower.includes('retry'))) {
      if (src === 'jenkins' && !actions.some(a => a.label.includes(job))) {
        actions.push({ label: `▶ Re-run ${job}`, action: () => { const btn = document.createElement('button'); triggerJenkinsBuild(btn, job); } });
      }
    }
  });

  // Scroll to services
  if (textLower.includes('check service') || textLower.includes('services panel') || textLower.includes('docker panel')) {
    actions.push({ label: '⇩ Scroll to Services', action: () => goToInTab('services', 'panel-svcs') });
  }

  // Collect
  if (textLower.includes('collect') || textLower.includes('refresh data') || textLower.includes('update data')) {
    actions.push({ label: '↻ Collect Now', action: () => document.getElementById('btn-collect')?.click() });
  }

  if (!actions.length) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.5rem;';
  actions.slice(0, 5).forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.style.cssText = 'font-size:.72rem;padding:.2rem .55rem;';
    btn.textContent = a.label;
    btn.addEventListener('click', () => {
      a.action();
      showToast('Action triggered: ' + a.label, 'ok');
    });
    wrap.appendChild(btn);
  });
  msgDiv.appendChild(wrap);
}

(function _bindChatInputSizing() {
  const el = document.getElementById('chat-input');
  if (!el) return;
  el.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });
})();

