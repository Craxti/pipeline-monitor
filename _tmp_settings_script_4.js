
// ── State ──────────────────────────────────────────────────────────────────────
let _ji = [];   // jenkins instances
let _gi = [];   // gitlab instances
let _ghi = [];  // github instances
let _tgBots = []; // telegram bot rows
let _hc = [];   // http checks
let _dc = [];   // docker container names
let _dh = [];   // docker remote hosts
let _sm = [];   // service monitor instances

// ── Navigation ─────────────────────────────────────────────────────────────────
const _SETTINGS_SECTION_META = {
  integrations: {
    titleKey: 'st.integrations_hub',
    subKey: 'st.integrations_hub_sub',
    wizard: false,
  },
  jenkins: {
    titleKey: 'st.integrations_hub',
    subKey: 'st.integrations_hub_sub',
    wizard: false,
  },
  gitlab: {
    titleKey: 'st.integrations_hub',
    subKey: 'st.integrations_hub_sub',
    wizard: false,
  },
  github: {
    titleKey: 'st.integrations_hub',
    subKey: 'st.integrations_hub_sub',
    wizard: false,
  },
  monitoring: {
    titleKey: 'st.integrations_hub',
    subKey: 'st.integrations_hub_sub',
    wizard: false,
  },
  docker: {
    titleKey: 'st.integrations_hub',
    subKey: 'st.integrations_hub_sub',
    wizard: false,
  },
  svcmon: {
    titleKey: 'st.integrations_hub',
    subKey: 'st.integrations_hub_sub',
    wizard: false,
  },
  general: {
    titleKey: 'st.general_integration',
    subKey: 'st.general_integration_sub',
    wizard: false,
  },
  notifications: {
    titleKey: 'st.notifications_integration',
    subKey: 'st.notifications_integration_sub',
    wizard: false,
  },
  ai: {
    titleKey: 'st.ai_integration',
    subKey: 'st.ai_integration_sub',
    wizard: false,
  },
};

function showSec(name) {
  const intAliases = ['jenkins', 'gitlab', 'github', 'monitoring', 'docker', 'svcmon'];
  if (intAliases.includes(name)) name = 'integrations';
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const sec = document.getElementById('sec-' + name);
  if (sec) sec.classList.add('active');
  document.querySelectorAll('.snav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.sec === name)
  );
  const meta = _SETTINGS_SECTION_META[name] || _SETTINGS_SECTION_META.integrations;
  const titleEl = $('settings-section-title');
  const subEl = $('settings-section-sub');
  const wiz = $('integration-wizard');
  const guideEl = $('settings-wizard-guide');
  const addBtn = $('wizard-add-btn');
  if (titleEl) {
    titleEl.textContent = t(meta.titleKey);
    titleEl.setAttribute('data-i18n', meta.titleKey);
  }
  if (subEl) {
    subEl.textContent = t(meta.subKey);
    subEl.setAttribute('data-i18n', meta.subKey);
  }
  if (wiz) wiz.hidden = !meta.wizard;
  if (guideEl && meta.guideKey) {
    guideEl.innerHTML = t(meta.guideKey);
    guideEl.setAttribute('data-i18n-html', meta.guideKey);
  }
  if (addBtn && meta.addFn) {
    addBtn.setAttribute('onclick', meta.addFn);
    addBtn.textContent = t(meta.addKey);
    addBtn.setAttribute('data-i18n', meta.addKey);
  }
  const hdrActions = $('settings-header-actions');
  if (hdrActions) hdrActions.hidden = name !== 'integrations';
}

// ── Tiny helpers ───────────────────────────────────────────────────────────────
const $   = id => document.getElementById(id);
const gV  = id => $(id).value;
const sV  = (id, v) => { if ($(id)) $(id).value = v ?? ''; };
const gC  = id => $(id).checked;
const sC  = (id, v) => { if ($(id)) $(id).checked = !!v; };
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const toInt = v => parseInt(v) || 0;

function apiUrl(path) {
  const p = path.startsWith('/') ? path.slice(1) : path;
  const base = window.location.origin + window.location.pathname;
  return new URL(p, base).href;
}

function _applyTheme(theme) {
  document.documentElement.classList.toggle('light', theme === 'light');
  const btn = document.getElementById('btn-theme-settings') || document.getElementById('btn-theme');
  if (btn) {
    btn.setAttribute('title', theme === 'light' ? t('dash.theme_light_hint') : t('dash.theme_dark_hint'));
    btn.textContent = '';
    btn.classList.remove('theme-ico-dark', 'theme-ico-light');
    btn.classList.add(theme === 'light' ? 'theme-ico-dark' : 'theme-ico-light');
  }
}
function toggleTheme() {
  const next = document.documentElement.classList.contains('light') ? 'dark' : 'light';
  localStorage.setItem('cimon-theme', next);
  _applyTheme(next);
}

function refreshAiModelOptionsI18n() {
  const sel = $('ai-model');
  if (!sel) return;
  const ogKeys = {
    'ai-models-openai': 'st.ai_og_openai',
    'ai-models-gemini': 'st.ai_og_gemini',
    'ai-models-openrouter': 'st.ai_og_openrouter',
    'ai-models-cursor': 'st.ai_og_cursor',
    'ai-models-ollama': 'st.ai_og_ollama',
  };
  Object.entries(ogKeys).forEach(([id, key]) => {
    const g = $(id);
    if (g) g.label = t(key);
  });
  const modelKeys = {
    'gpt-4o-mini': 'st.ai_m_gpt4o_mini',
    'gpt-4o': 'st.ai_m_gpt4o',
    'gpt-4.1-mini': 'st.ai_m_gpt41_mini',
    'gpt-4.1': 'st.ai_m_gpt41',
    'o4-mini': 'st.ai_m_o4_mini',
    'gemini-2.0-flash': 'st.ai_m_gem20_flash',
    'gemini-2.0-flash-lite': 'st.ai_m_gem20_flash_lite',
    'gemini-1.5-flash': 'st.ai_m_gem15_flash',
    'gemini-2.5-pro-preview-03-25': 'st.ai_m_gem25_pro',
    'google/gemini-2.0-flash-exp:free': 'st.ai_m_or_gem_flash',
    'deepseek/deepseek-chat-v3-0324:free': 'st.ai_m_or_deepseek',
    'meta-llama/llama-4-maverick:free': 'st.ai_m_or_llama4',
    'qwen/qwen-2.5-72b-instruct:free': 'st.ai_m_or_qwen',
    auto: 'st.ai_m_cursor_auto',
    'gpt-5.2': 'st.ai_m_cursor_gpt52',
    'llama3.1:8b': 'st.ai_m_llama318b',
    'phi3:mini': 'st.ai_m_phi3mini',
    'llama3.2': 'st.ai_m_llama32',
    'llama3.1': 'st.ai_m_llama31',
    mistral: 'st.ai_m_mistral',
    codellama: 'st.ai_m_codellama',
    'qwen2.5': 'st.ai_m_qwen25',
    'gpt-oss': 'st.ai_m_gpt_oss',
  };
  sel.querySelectorAll('option').forEach((opt) => {
    const k = modelKeys[opt.value];
    if (k) opt.textContent = t(k);
  });
}

function refreshAiProviderOptionsI18n() {
  const sel = $('ai-provider');
  if (!sel) return;
  const keys = {
    openai: 'st.ai_opt_openai',
    gemini: 'st.ai_opt_gemini',
    openrouter: 'st.ai_opt_openrouter',
    cursor: 'st.ai_opt_cursor',
    ollama: 'st.ai_opt_ollama',
    custom: 'st.ai_opt_custom',
  };
  sel.querySelectorAll('option').forEach((opt) => {
    const k = keys[opt.value];
    if (k) opt.textContent = t(k);
  });
}

function refreshSettingsDynamicUI() {
  _applyTheme(localStorage.getItem('cimon-theme') === 'light' ? 'light' : 'dark');
  renderJInsts();
  renderGInsts();
  renderGhInsts();
  renderTgBots();
  renderHttpChecks();
  renderContainers();
  renderDockerHosts();
  updateDockerUI();
  renderSvcMonInsts();
  updateSvcMonUI();
  updateProviderUI();
  updateProxyUI();
  refreshAiProviderOptionsI18n();
  refreshAiModelOptionsI18n();
  if (typeof refreshAllModernSelects === 'function') refreshAllModernSelects();
  if (typeof renderIntegrationsList === 'function') renderIntegrationsList();
  if (typeof refreshDockerSnapshotCount === 'function') refreshDockerSnapshotCount();
  const activeSec = document.querySelector('.snav-item.active')?.dataset?.sec;
  if (activeSec) showSec(activeSec);
}

function setUILang(code) {
  if (!applyUILang(code)) return;
  refreshSettingsDynamicUI();
}

const _providerDefaults = {
  openai:     { base: '',                                        placeholder: 'sk-...',         hint: 'OpenAI API key. Get one at platform.openai.com/api-keys' },
  gemini:     { base: 'https://generativelanguage.googleapis.com/v1beta/openai/', placeholder: 'AIzaSy...',      hint: 'Google AI Studio key (free). Get one at aistudio.google.com/apikey' },
  openrouter: { base: 'https://openrouter.ai/api/v1',           placeholder: 'sk-or-v1-...',   hint: 'OpenRouter key (free tier). Get one at openrouter.ai/keys' },
  cursor:     { base: 'http://127.0.0.1:8765/v1',               placeholder: 'unused / bridge / любой', hint: 'Токен crsr из дашборда сюда не «бьёт» в облако Cursor для чата — публичного chat API нет. Для моделей Cursor нужен cursor-api-proxy + CURSOR_API_KEY в окружении процесса прокси. Поле API Key — для прокси (часто unused).' },
  ollama:     { base: 'http://127.0.0.1:11434/v1',               placeholder: 'optional',       hint: 'Run `ollama serve` locally. Pull a model (`ollama pull llama3.2`). API key is usually not required.' },
  custom:     { base: '',                                        placeholder: 'your-api-key',   hint: 'API key for your custom OpenAI-compatible endpoint.' },
};

function updateProviderUI() {
  const prov = gV('ai-provider');
  const def = _providerDefaults[prov] || _providerDefaults.custom;
  $('ai-api-key').placeholder = def.placeholder;
  const keyHintMap = {
    openai: 'st.ai_key_hint_openai',
    gemini: 'st.ai_key_hint_gemini',
    openrouter: 'st.ai_key_hint_openrouter',
    cursor: 'st.ai_key_hint_cursor_key',
    ollama: 'st.ai_key_hint_ollama',
    custom: 'st.ai_key_hint_custom',
  };
  const hk = keyHintMap[prov] ? t(keyHintMap[prov]) : def.hint;
  $('ai-key-hint').textContent = hk + ' ' + t('st.ai_key_stored');

  const curBase = gV('ai-base-url').trim();
  const knownBases = Object.values(_providerDefaults).map(d => d.base).filter(Boolean);
  if (!curBase || knownBases.includes(curBase)) {
    sV('ai-base-url', def.base);
  }

  document.querySelectorAll('#ai-model optgroup').forEach(g => g.style.display = 'none');
  const groupId = 'ai-models-' + prov;
  const grp = $(groupId);
  if (grp) {
    grp.style.display = '';
    const curModel = gV('ai-model');
    const opts = grp.querySelectorAll('option');
    const inGroup = [...opts].some(o => o.value === curModel);
    if (!inGroup && opts.length) $('ai-model').value = opts[0].value;
  } else {
    document.querySelectorAll('#ai-model optgroup').forEach(g => g.style.display = '');
  }

  const phint = $('ai-provider-hint');
  if (prov === 'gemini') phint.innerHTML = t('st.ai_hint_gemini_html');
  else if (prov === 'openrouter') phint.innerHTML = t('st.ai_hint_openrouter_html');
  else if (prov === 'openai') phint.textContent = t('st.ai_hint_openai');
  else if (prov === 'cursor') phint.innerHTML = t('st.ai_hint_cursor_html');
  else if (prov === 'ollama') phint.textContent = t('st.ai_hint_ollama');
  else phint.textContent = t('st.ai_hint_custom');
  const curAu = $('ai-cursor-autostart-row');
  if (curAu) curAu.style.display = prov === 'cursor' ? '' : 'none';
  const curAb = $('ai-cursor-agent-bin-row');
  if (curAb) curAb.style.display = prov === 'cursor' ? '' : 'none';
}

function updateProxyUI() {
  const el = $('ai-proxy-fields');
  if (el) el.style.display = gC('ai-proxy-enabled') ? 'flex' : 'none';
}

async function testOpenaiProxyEgress() {
  try {
    const r = await fetch(apiUrl('api/proxy-check'));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(t('st.egress_fail') + ' ' + (d.detail || r.statusText || r.status), 'err');
      return;
    }
    const dir = d.direct || {};
    const via = d.via_proxy;
    let msg = t('st.egress_config') + ' ' + (d.config_path || '—') + '\n\n';
    msg += t('st.egress_direct') + ' ' + (dir.ip || dir.error || '—') + '\n';
    if (via) {
      msg += t('st.egress_via') + ' ' + (via.ip || via.error || '—');
    } else {
      msg += t('st.egress_via') + ' ' + t('st.egress_via_off');
    }
    showToast(msg.replace(/\n+/g, ' · '), 'ok');
    if (via && via.ok && dir.ok && via.ip && dir.ip && via.ip === dir.ip) {
      showToast(t('st.egress_proxy_same_ip'), 'err');
    } else {
      showToast(t('st.egress_done'), 'ok');
    }
  } catch (e) {
    showToast(e.message || t('st.egress_req_fail'), 'err');
  }
}

function applyProxyPaste() {
  const raw = gV('ai-proxy-paste').trim();
  if (!raw) return;
  const low = raw.toLowerCase();
  if (low.includes('socks5server')) $('ai-proxy-type').value = 'socks5';
  else if (low.includes('proxyserver') || low.includes('httpserver')) {
    if (!$('ai-proxy-type').value || $('ai-proxy-type').value === 'socks5')
      $('ai-proxy-type').value = 'http';
  }
  let host = '', port = '', user = '', pass = '';
  raw.replace(/\?/g, '&').split('&').forEach(part => {
    const eq = part.indexOf('=');
    if (eq < 0) return;
    const k = part.slice(0, eq).trim().toLowerCase();
    const v = part.slice(eq + 1).trim();
    if (k === 'socks5server' || k === 'proxyserver' || k === 'httpserver') host = v;
    else if (k === 'server') host = v;
    else if (k === 'port') port = v;
    else if (k === 'user' || k === 'username') user = v;
    else if (k === 'pass' || k === 'password' || k === 'secret') pass = v;
  });
  if (host) sV('ai-proxy-host', host);
  if (port) sV('ai-proxy-port', port);
  if (user) sV('ai-proxy-user', user);
  if (pass) sV('ai-proxy-password', pass);
  sC('ai-proxy-enabled', true);
  updateProxyUI();
}

function showToast(msg, type = 'ok') {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 4500);
}

let _settingsConfirmResolve = null;

function openSettingsConfirm({ title, message, danger }) {
  return new Promise((resolve) => {
    const modal = $('settings-confirm-modal');
    const titleEl = $('settings-confirm-title');
    const msgEl = $('settings-confirm-msg');
    const yes = $('settings-confirm-yes');
    if (!modal || !yes) { resolve(false); return; }
    if (titleEl) titleEl.textContent = title || t('dash.action_confirm');
    if (msgEl) msgEl.textContent = message || '';
    yes.classList.toggle('btn-danger', !!danger);
    yes.classList.toggle('btn-primary', !danger);
    _settingsConfirmResolve = resolve;
    modal.classList.add('show');
  });
}

function closeSettingsConfirm(result) {
  const modal = $('settings-confirm-modal');
  if (modal) modal.classList.remove('show');
  if (_settingsConfirmResolve) {
    _settingsConfirmResolve(!!result);
    _settingsConfirmResolve = null;
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// JENKINS INSTANCES
// ══════════════════════════════════════════════════════════════════════════════

function jInstHtml(ii) {
  const inst = _ji[ii];
  return `
  <div class="inst-card" id="ji-card-${ii}">
    <div class="inst-hdr">
      <span class="inst-badge">Jenkins</span>
      <input class="inst-name-inp" value="${esc(inst.name)}" placeholder="${esc(t('st.j_inst_placeholder'))}"
             oninput="_ji[${ii}].name=this.value">
      <label class="toggle" style="margin-left:auto;margin-right:.5rem">
        <input type="checkbox" ${inst.enabled !== false ? 'checked' : ''}
               onchange="_ji[${ii}].enabled=this.checked">
        <div class="toggle-track"><div class="toggle-knob"></div></div>
        <span style="font-size:.8rem;color:var(--muted)">${esc(t('st.active'))}</span>
      </label>
      <button class="btn-icon" onclick="removeJInst(${ii})" title="${esc(t('st.remove'))}">&#10005;</button>
    </div>
    <div class="inst-body">
      <div class="field-row">
        <div class="field-label">${esc(t('st.j_server_url'))}</div>
        <input type="url" class="field-input sensitive" value="${esc(inst.url||'')}" placeholder="https://jenkins.example.com"
               oninput="_ji[${ii}].url=this.value">
      </div>
      <div class="two-col">
        <div class="field-row">
          <div class="field-label">${esc(t('st.j_username'))}</div>
          <input type="text" class="field-input" value="${esc(inst.username||'')}" placeholder="admin"
                 autocomplete="off" oninput="_ji[${ii}].username=this.value">
        </div>
        <div class="field-row">
          <div class="field-label">${esc(t('st.j_token'))}</div>
          <div class="pw-wrap">
            <input type="password" class="field-input sensitive" value="${esc(inst.token||'')}" data-secret-path="jenkins_instances[${ii}].token"
                   autocomplete="new-password" oninput="_ji[${ii}].token=this.value">
          </div>
        </div>
      </div>
      <div class="inst-test-row">
        <button type="button" class="btn btn-sm btn-ghost" id="ji-test-btn-${ii}" onclick="testInstanceConnection('jenkins', ${ii})">${esc(t('st.test_connection_btn'))}</button>
        <span class="test-status" id="ji-test-status-${ii}"></span>
      </div>
      <div class="field-row">
        <label class="toggle">
          <input type="checkbox" ${inst.parse_console ? 'checked' : ''}
                 onchange="_ji[${ii}].parse_console=this.checked">
          <div class="toggle-track"><div class="toggle-knob"></div></div>
          ${esc(t('st.parse_console'))}
        </label>
      </div>
      <div class="field-row">
        <label class="toggle">
          <input type="checkbox" ${inst.parse_allure ? 'checked' : ''}
                 onchange="_ji[${ii}].parse_allure=this.checked">
          <div class="toggle-track"><div class="toggle-knob"></div></div>
          <span>${esc(t('st.parse_allure'))}</span>
        </label>
        <div class="field-hint">${esc(t('st.parse_allure_hint'))}</div>
      </div>
      <div class="field-row">
        <label class="toggle">
          <input type="checkbox" ${inst.verify_ssl !== false ? 'checked' : ''}
                 onchange="_ji[${ii}].verify_ssl=this.checked">
          <div class="toggle-track"><div class="toggle-knob"></div></div>
          <span>${esc(t('st.verify_ssl'))}</span>
        </label>
        <div class="field-hint">${esc(t('st.verify_ssl_hint'))}</div>
      </div>
    </div>
  </div>`;
}

function renderJInsts() {
  if (typeof renderIntegrationsList === 'function') renderIntegrationsList();
}

function addJenkinsInst() {
  if (typeof openIntegrationCreateDirect === 'function') {
    openIntegrationCreateDirect('jenkins');
    return;
  }
  _ji.push({ name: `Jenkins ${_ji.length + 1}`, enabled: true, url: '', username: '', token: '',
             jobs: [], parse_console: true, parse_allure: false, verify_ssl: true });
  renderJInsts();
}

async function removeJInst(ii) {
  if (!(await openSettingsConfirm({ message: tf('st.j_confirm_remove', { name: _ji[ii].name }), danger: true }))) return;
  _ji.splice(ii, 1);
  renderJInsts();
}
// ══════════════════════════════════════════════════════════════════════════════

function gProjHtml(gi) {
  const projs = _gi[gi].projects || [];
  if (!projs.length) return `<tr class="empty-row"><td colspan="3">${esc(t('st.g_empty_proj'))}</td></tr>`;
  return projs.map((p, pi) => `
    <tr>
      <td><input class="tbl-input" value="${esc(p.id)}" placeholder="${esc(t('st.g_placeholder_proj'))}"
          oninput="_gi[${gi}].projects[${pi}].id=this.value"></td>
      <td class="c st-col-tight"><input type="checkbox" ${p.critical ? 'checked' : ''}
          onchange="_gi[${gi}].projects[${pi}].critical=this.checked"></td>
      <td class="st-col-actions"><button class="btn-icon" onclick="removeGProj(${gi},${pi})" title="${esc(t('st.remove'))}">&#10005;</button></td>
    </tr>`).join('');
}

function renderGProjs(gi) {
  const tb = $(`gp-${gi}`);
  if (tb) tb.innerHTML = gProjHtml(gi);
}

function addGProj(gi) {
  if (!_gi[gi].projects) _gi[gi].projects = [];
  _gi[gi].projects.push({ id: '', critical: true });
  renderGProjs(gi);
  $(`gp-${gi}`)?.querySelector('tr:last-child .tbl-input')?.focus();
}

function removeGProj(gi, pi) { _gi[gi].projects.splice(pi, 1); renderGProjs(gi); }

function gInstHtml(gi) {
  const inst = _gi[gi];
  return `
  <div class="inst-card" id="gi-card-${gi}">
    <div class="inst-hdr">
      <span class="inst-badge gl">GitLab</span>
      <input class="inst-name-inp" value="${esc(inst.name)}" placeholder="${esc(t('st.g_inst_placeholder'))}"
             oninput="_gi[${gi}].name=this.value">
      <label class="toggle" style="margin-left:auto;margin-right:.5rem">
        <input type="checkbox" ${inst.enabled !== false ? 'checked' : ''}
               onchange="_gi[${gi}].enabled=this.checked">
        <div class="toggle-track"><div class="toggle-knob"></div></div>
        <span style="font-size:.8rem;color:var(--muted)">${esc(t('st.active'))}</span>
      </label>
      <button class="btn-icon" onclick="removeGInst(${gi})" title="${esc(t('st.remove'))}">&#10005;</button>
    </div>
    <div class="inst-body">
      <div class="field-row">
        <div class="field-label">${esc(t('st.g_url'))}</div>
        <input type="url" class="field-input sensitive" value="${esc(inst.url||'')}" placeholder="https://gitlab.com"
               oninput="_gi[${gi}].url=this.value">
      </div>
      <div class="two-col">
        <div class="field-row">
          <div class="field-label">${esc(t('st.g_token'))}</div>
          <div class="pw-wrap">
            <input type="password" class="field-input sensitive" value="${esc(inst.token||'')}" data-secret-path="gitlab_instances[${gi}].token"
                   autocomplete="new-password" oninput="_gi[${gi}].token=this.value">
          </div>
        </div>
        <div class="field-row">
          <div class="field-label">${esc(t('st.g_max_pipes'))}</div>
          <input type="number" class="field-input" value="${inst.max_pipelines??10}" min="1" max="200"
                 oninput="_gi[${gi}].max_pipelines=parseInt(this.value)">
        </div>
      </div>
      <div class="inst-test-row">
        <button type="button" class="btn btn-sm btn-ghost" id="gi-test-btn-${gi}" onclick="testInstanceConnection('gitlab', ${gi})">${esc(t('st.test_connection_btn'))}</button>
        <span class="test-status" id="gi-test-status-${gi}"></span>
      </div>
      <div class="field-row">
        <label class="toggle">
          <input type="checkbox" ${inst.verify_ssl !== false ? 'checked' : ''}
                 onchange="_gi[${gi}].verify_ssl=this.checked">
          <div class="toggle-track"><div class="toggle-knob"></div></div>
          <span>${esc(t('st.verify_ssl'))}</span>
        </label>
        <div class="field-hint">${esc(t('st.g_verify_ssl_hint'))}</div>
      </div>

      <div class="sub-sec">
        <div class="field-row" style="margin-bottom:.6rem">
          <label class="toggle">
            <input type="checkbox" id="g-show-all-${gi}" ${inst.show_all_projects ? 'checked' : ''}
                   onchange="_gi[${gi}].show_all_projects=this.checked;toggleGProjs(${gi})">
            <div class="toggle-track"><div class="toggle-knob"></div></div>
            ${esc(t('st.g_show_all'))}
          </label>
          <div class="field-hint" id="g-all-hint-${gi}">
            ${inst.show_all_projects
              ? esc(t('st.g_hint_all'))
              : esc(t('st.g_hint_list'))}
          </div>
        </div>
        <div id="g-projs-panel-${gi}" style="display:${inst.show_all_projects ? 'none' : ''}">
          <div class="sub-sec-hdr">
            <span class="field-label">${esc(t('st.g_projects_monitor'))}</span>
            <button class="btn btn-sm" onclick="addGProj(${gi})">${esc(t('st.g_add_proj'))}</button>
          </div>
          <div class="st-table-wrap">
            <table>
              <thead><tr>
                <th>${esc(t('st.th_project_id'))}</th>
                <th class="c st-col-tight">${esc(t('st.th_critical'))}</th>
                <th class="st-col-actions" aria-label=""></th>
              </tr></thead>
              <tbody id="gp-${gi}">${gProjHtml(gi)}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function toggleGProjs(gi) {
  const showAll = _gi[gi].show_all_projects;
  const panel = $('g-projs-panel-' + gi);
  const hint  = $('g-all-hint-' + gi);
  if (panel) panel.style.display = showAll ? 'none' : '';
  if (hint)  hint.textContent = showAll
    ? t('st.g_hint_all')
    : t('st.g_hint_list');
}

function renderGInsts() {
  if (typeof renderIntegrationsList === 'function') renderIntegrationsList();
}

function addGitlabInst() {
  if (typeof openIntegrationCreateDirect === 'function') {
    openIntegrationCreateDirect('gitlab');
    return;
  }
  _gi.push({ name: `GitLab ${_gi.length + 1}`, enabled: true, url: '', token: '',
             projects: [], max_pipelines: 10, verify_ssl: true });
  renderGInsts();
}

function startQuickSetup(kind) {
  showSec('integrations');
  if (typeof openIntegrationCreateDirect === 'function') openIntegrationCreateDirect(kind);
  const toasts = { jenkins: 'st.wz_toast_jenkins', gitlab: 'st.wz_toast_gitlab', github: 'st.wz_toast_github' };
  if (toasts[kind]) showToast(t(toasts[kind]), 'ok');
}

async function testInstanceConnection(kind, idx) {
  const isJenkins = kind === 'jenkins';
  const isGitlab = kind === 'gitlab';
  const inst = isJenkins ? (_ji[idx] || {}) : (isGitlab ? (_gi[idx] || {}) : (_ghi[idx] || {}));
  const btn = $(isJenkins ? `ji-test-btn-${idx}` : (isGitlab ? `gi-test-btn-${idx}` : `ghi-test-btn-${idx}`));
  const status = $(isJenkins ? `ji-test-status-${idx}` : (isGitlab ? `gi-test-status-${idx}` : `ghi-test-status-${idx}`));
  if (btn) btn.disabled = true;
  if (status) {
    status.className = 'test-status';
    status.textContent = t('st.test_connection_running');
  }

  const payload = isJenkins
    ? {
        kind: 'jenkins',
        url: (inst.url || '').trim(),
        username: inst.username || '',
        token: inst.token || '',
        verify_ssl: inst.verify_ssl !== false,
      }
    : isGitlab
      ? {
          kind: 'gitlab',
          url: (inst.url || '').trim(),
          token: inst.token || '',
          verify_ssl: inst.verify_ssl !== false,
        }
      : {
          kind: 'github',
          url: (inst.url || '').trim() || 'https://github.com',
          token: inst.token || '',
          verify_ssl: inst.verify_ssl !== false,
        };

  const res = await fetch(apiUrl('api/settings/test-connection'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => null);

  if (btn) btn.disabled = false;
  const data = (res && await res.json().catch(() => ({}))) || {};
  const msg = (data && data.message) ? String(data.message) : t('st.test_connection_failed');
  const ok = !!(res && res.ok && data.ok);
  if (status) {
    status.className = ok ? 'test-status ok' : 'test-status err';
    status.textContent = msg;
  }
  showToast(msg, ok ? 'ok' : 'err');
}

async function removeGInst(gi) {
  if (!(await openSettingsConfirm({ message: tf('st.g_confirm_remove', { name: _gi[gi].name }), danger: true }))) return;
  _gi.splice(gi, 1);
  renderGInsts();
}

// ══════════════════════════════════════════════════════════════════════════════
// GITHUB INSTANCES
// ══════════════════════════════════════════════════════════════════════════════

function ghRepoHtml(gi) {
  const repos = _ghi[gi].repos || [];
  if (!repos.length) return `<tr class="empty-row"><td colspan="3">${esc(t('st.gh_empty_repo'))}</td></tr>`;
  return repos.map((p, pi) => `
    <tr>
      <td><input class="tbl-input" value="${esc(p.id)}" placeholder="${esc(t('st.gh_placeholder_repo'))}"
          oninput="_ghi[${gi}].repos[${pi}].id=this.value"></td>
      <td class="c st-col-tight"><input type="checkbox" ${p.critical ? 'checked' : ''}
          onchange="_ghi[${gi}].repos[${pi}].critical=this.checked"></td>
      <td class="st-col-actions"><button class="btn-icon" onclick="removeGhRepo(${gi},${pi})" title="${esc(t('st.remove'))}">&#10005;</button></td>
    </tr>`).join('');
}

function renderGhRepos(gi) {
  const tb = $(`ghp-${gi}`);
  if (tb) tb.innerHTML = ghRepoHtml(gi);
}

function addGhRepo(gi) {
  if (!_ghi[gi].repos) _ghi[gi].repos = [];
  _ghi[gi].repos.push({ id: '', critical: true });
  renderGhRepos(gi);
  $(`ghp-${gi}`)?.querySelector('tr:last-child .tbl-input')?.focus();
}

function removeGhRepo(gi, pi) { _ghi[gi].repos.splice(pi, 1); renderGhRepos(gi); }

function ghInstHtml(gi) {
  const inst = _ghi[gi];
  return `
  <div class="inst-card" id="ghi-card-${gi}">
    <div class="inst-hdr">
      <span class="inst-badge gh">GitHub</span>
      <input class="inst-name-inp" value="${esc(inst.name)}" placeholder="${esc(t('st.gh_inst_placeholder'))}"
             oninput="_ghi[${gi}].name=this.value">
      <label class="toggle" style="margin-left:auto;margin-right:.5rem">
        <input type="checkbox" ${inst.enabled !== false ? 'checked' : ''}
               onchange="_ghi[${gi}].enabled=this.checked">
        <div class="toggle-track"><div class="toggle-knob"></div></div>
        <span style="font-size:.8rem;color:var(--muted)">${esc(t('st.active'))}</span>
      </label>
      <button class="btn-icon" onclick="removeGhInst(${gi})" title="${esc(t('st.remove'))}">&#10005;</button>
    </div>
    <div class="inst-body">
      <div class="field-row">
        <div class="field-label">${esc(t('st.gh_url'))}</div>
        <input type="url" class="field-input sensitive" value="${esc(inst.url||'')}" placeholder="https://github.com"
               oninput="_ghi[${gi}].url=this.value">
        <div class="field-hint">${esc(t('st.gh_url_hint'))}</div>
      </div>
      <div class="two-col">
        <div class="field-row">
          <div class="field-label">${esc(t('st.gh_token'))}</div>
          <div class="pw-wrap">
            <input type="password" class="field-input sensitive" value="${esc(inst.token||'')}" data-secret-path="github_instances[${gi}].token"
                   autocomplete="new-password" oninput="_ghi[${gi}].token=this.value">
          </div>
          <div class="field-hint">${esc(t('st.gh_token_hint'))}</div>
        </div>
        <div class="field-row">
          <div class="field-label">${esc(t('st.gh_max_runs'))}</div>
          <input type="number" class="field-input" value="${inst.max_runs??10}" min="1" max="100"
                 oninput="_ghi[${gi}].max_runs=parseInt(this.value)">
        </div>
      </div>
      <div class="inst-test-row">
        <button type="button" class="btn btn-sm btn-ghost" id="ghi-test-btn-${gi}" onclick="testInstanceConnection('github', ${gi})">${esc(t('st.test_connection_btn'))}</button>
        <span class="test-status" id="ghi-test-status-${gi}"></span>
      </div>
      <div class="field-row">
        <label class="toggle">
          <input type="checkbox" ${inst.verify_ssl !== false ? 'checked' : ''}
                 onchange="_ghi[${gi}].verify_ssl=this.checked">
          <div class="toggle-track"><div class="toggle-knob"></div></div>
          <span>${esc(t('st.verify_ssl'))}</span>
        </label>
      </div>
      <div class="sub-sec">
        <div class="field-row" style="margin-bottom:.6rem">
          <label class="toggle">
            <input type="checkbox" id="gh-show-all-${gi}" ${inst.show_all_repos ? 'checked' : ''}
                   onchange="_ghi[${gi}].show_all_repos=this.checked;toggleGhRepos(${gi})">
            <div class="toggle-track"><div class="toggle-knob"></div></div>
            ${esc(t('st.gh_show_all'))}
          </label>
          <div class="field-hint" id="gh-all-hint-${gi}">
            ${inst.show_all_repos ? esc(t('st.gh_hint_all')) : esc(t('st.gh_hint_list'))}
          </div>
        </div>
        <div id="gh-repos-panel-${gi}" style="display:${inst.show_all_repos ? 'none' : ''}">
          <div class="sub-sec-hdr">
            <span class="field-label">${esc(t('st.gh_repos_monitor'))}</span>
            <button class="btn btn-sm" onclick="addGhRepo(${gi})">${esc(t('st.gh_add_repo'))}</button>
          </div>
          <div class="st-table-wrap">
            <table>
              <thead><tr>
                <th>${esc(t('st.th_repo'))}</th>
                <th class="c st-col-tight">${esc(t('st.th_critical'))}</th>
                <th class="st-col-actions" aria-label=""></th>
              </tr></thead>
              <tbody id="ghp-${gi}">${ghRepoHtml(gi)}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function toggleGhRepos(gi) {
  const showAll = _ghi[gi].show_all_repos;
  const panel = $('gh-repos-panel-' + gi);
  const hint  = $('gh-all-hint-' + gi);
  if (panel) panel.style.display = showAll ? 'none' : '';
  if (hint)  hint.textContent = showAll ? t('st.gh_hint_all') : t('st.gh_hint_list');
}

function renderGhInsts() {
  if (typeof renderIntegrationsList === 'function') renderIntegrationsList();
}

function addGithubInst() {
  if (typeof openIntegrationCreateDirect === 'function') {
    openIntegrationCreateDirect('github');
    return;
  }
  _ghi.push({ name: `GitHub ${_ghi.length + 1}`, enabled: true, url: 'https://github.com', token: '',
             repos: [], max_runs: 10, verify_ssl: true, show_all_repos: false });
  renderGhInsts();
}

async function removeGhInst(gi) {
  if (!(await openSettingsConfirm({ message: tf('st.gh_confirm_remove', { name: _ghi[gi].name }), danger: true }))) return;
  _ghi.splice(gi, 1);
  renderGhInsts();
}

// ══════════════════════════════════════════════════════════════════════════════
// TELEGRAM BOTS (multiple)
// ══════════════════════════════════════════════════════════════════════════════

function tgBotHtml(i) {
  const b = _tgBots[i];
  return `
  <div class="inst-card" id="tg-card-${i}">
    <div class="inst-hdr">
      <span class="inst-badge tg">TG</span>
      <input class="inst-name-inp" value="${esc(b.name)}" placeholder="${esc(t('st.tg_inst_placeholder'))}"
             oninput="_tgBots[${i}].name=this.value">
      <label class="toggle" style="margin-left:auto;margin-right:.5rem">
        <input type="checkbox" ${b.enabled !== false ? 'checked' : ''}
               onchange="_tgBots[${i}].enabled=this.checked">
        <div class="toggle-track"><div class="toggle-knob"></div></div>
        <span style="font-size:.8rem;color:var(--muted)">${esc(t('st.active'))}</span>
      </label>
      <button type="button" class="btn-icon" onclick="removeTgBot(${i})" title="${esc(t('st.remove'))}">&#10005;</button>
    </div>
    <div class="inst-body">
      <div class="field-row">
        <div class="field-label">${esc(t('st.tg_api_base'))}</div>
        <input type="text" class="field-input" value="${esc(b.api_base_url||'')}" placeholder="https://api.telegram.org"
               oninput="_tgBots[${i}].api_base_url=this.value">
        <div class="field-hint">${esc(t('st.tg_api_base_hint'))}</div>
      </div>
      <div class="field-row">
        <div class="field-label">${esc(t('st.bot_token'))}</div>
        <div class="pw-wrap">
          <input type="password" class="field-input" value="${esc(b.bot_token||'')}" data-secret-path="notifications.telegram.bots[${i}].bot_token"
                 autocomplete="new-password" oninput="_tgBots[${i}].bot_token=this.value">
        </div>
      </div>
      <div class="field-row">
        <div class="field-label">${esc(t('st.chat_id'))}</div>
        <input type="text" class="field-input" value="${esc(b.chat_id||'')}" placeholder="-1001234567890"
               oninput="_tgBots[${i}].chat_id=this.value">
      </div>
      <div class="field-row">
        <label class="toggle">
          <input type="checkbox" ${b.critical_only !== false ? 'checked' : ''}
                 onchange="_tgBots[${i}].critical_only=this.checked">
          <div class="toggle-track"><div class="toggle-knob"></div></div>
          <span>${esc(t('st.tg_critical'))}</span>
        </label>
      </div>
    </div>
  </div>`;
}

function renderTgBots() {
  const c = $('telegram-bots');
  if (!c) return;
  if (!_tgBots.length) {
    c.innerHTML = `<div class="empty-card">${esc(t('st.tg_empty'))}</div>`;
    return;
  }
  c.innerHTML = _tgBots.map((_, i) => tgBotHtml(i)).join('');
}

function addTgBot() {
  _tgBots.push({
    name: `Telegram ${_tgBots.length + 1}`,
    enabled: true,
    api_base_url: '',
    bot_token: '',
    chat_id: '',
    critical_only: true,
  });
  renderTgBots();
  $(`tg-card-${_tgBots.length - 1}`)?.querySelector('.inst-name-inp')?.focus();
}

async function removeTgBot(i) {
  if (!(await openSettingsConfirm({ message: tf('st.tg_confirm_remove', { name: _tgBots[i].name || 'Telegram' }), danger: true }))) return;
  _tgBots.splice(i, 1);
  renderTgBots();
}

// ══════════════════════════════════════════════════════════════════════════════
// SERVICE MONITORS
// ══════════════════════════════════════════════════════════════════════════════

const _SVC_MON_TYPES = [
  { id: 'zabbix' },
  { id: 'prometheus' },
  { id: 'alertmanager' },
  { id: 'uptime_kuma' },
  { id: 'netdata' },
  { id: 'prtg' },
  { id: 'checkmk' },
  { id: 'http_json' },
  { id: 'postgres' },
  { id: 'redis' },
  { id: 'mongodb' },
  { id: 'mysql' },
  { id: 'elasticsearch' },
  { id: 'kafka' },
];

function _connectorLabel(id) {
  const sid = String(id || '');
  const key = 'st.conn_' + sid;
  const tr = t(key);
  return (tr && tr !== key) ? tr : sid;
}

function _svcMonTypeOptions(cur) {
  const v = String(cur || 'zabbix');
  return _SVC_MON_TYPES.map((row) => `<option value="${row.id}" ${row.id === v ? 'selected' : ''}>${esc(_connectorLabel(row.id))}</option>`).join('');
}

function updateSvcMonUI() {
  /* legacy no-op */
}

function _svcMonTypeBadge(type) {
  const sid = String(type || 'custom');
  const slug = sid.replace(/[^a-z0-9_]/gi, '');
  return `<span class="inst-badge inst-badge--sm inst-badge--${slug}">${esc(_connectorLabel(sid))}</span>`;
}

function svcMonInstHtml(i) {
  const inst = _sm[i] || {};
  const type = String(inst.type || 'zabbix');
  const showAuth = ['zabbix', 'uptime_kuma', 'checkmk', 'prtg'].includes(type);
  const showToken = ['zabbix', 'prometheus', 'alertmanager', 'checkmk', 'http_json', 'uptime_kuma'].includes(type);
  const showZabbix = type === 'zabbix';
  const showHttpJson = type === 'http_json';
  const showCheckmk = type === 'checkmk';
  const showPrtg = type === 'prtg';
  return `
  <div class="inst-card sm-connector-card" id="sm-card-${i}">
    <div class="inst-hdr inst-hdr--compact">
      ${_svcMonTypeBadge(type)}
      <input class="inst-name-inp" value="${esc(inst.name || '')}" placeholder="prod-monitor"
        oninput="_sm[${i}].name=this.value">
      <label class="toggle" style="margin-left:auto">
        <input type="checkbox" ${inst.enabled !== false ? 'checked' : ''} onchange="_sm[${i}].enabled=this.checked">
        <div class="toggle-track"><div class="toggle-knob"></div></div>
      </label>
      <button type="button" class="btn btn-sm btn-ghost" onclick="testSvcMonInst(${i})" data-i18n="st.test_connection_btn">Test</button>
      <button type="button" class="btn btn-sm btn-ghost" onclick="removeSvcMonInst(${i})" title="Remove">&times;</button>
    </div>
    <div class="inst-body two-col">
      <div class="field-row">
        <div class="field-label">Type</div>
        <select class="field-input" onchange="_sm[${i}].type=this.value; renderSvcMonInsts()">${_svcMonTypeOptions(type)}</select>
      </div>
      <div class="field-row">
        <div class="field-label">URL</div>
        <input class="field-input" value="${esc(inst.url || '')}" placeholder="https://zabbix.example.com"
          oninput="_sm[${i}].url=this.value">
      </div>
      ${showToken ? `<div class="field-row">
        <div class="field-label">API token</div>
        <input type="password" class="field-input sensitive" value="${esc(inst.token || inst.api_key || '')}" autocomplete="new-password"
          oninput="_sm[${i}].token=this.value">
      </div>` : ''}
      ${showAuth ? `<div class="field-row">
        <div class="field-label">Username</div>
        <input class="field-input" value="${esc(inst.username || '')}" oninput="_sm[${i}].username=this.value">
      </div>
      <div class="field-row">
        <div class="field-label">Password</div>
        <input type="password" class="field-input sensitive" value="${esc(inst.password || '')}" autocomplete="new-password"
          oninput="_sm[${i}].password=this.value">
      </div>` : ''}
      ${showZabbix ? `<div class="field-row">
        <div class="field-label">Mode</div>
        <select class="field-input" onchange="_sm[${i}].mode=this.value">
          <option value="problems" ${(inst.mode || 'problems') === 'problems' ? 'selected' : ''}>Active problems</option>
          <option value="hosts" ${inst.mode === 'hosts' ? 'selected' : ''}>Hosts availability</option>
        </select>
      </div>
      <div class="field-row">
        <div class="field-label">Min severity (problems)</div>
        <input type="number" class="field-input" min="0" max="5" value="${esc(String(inst.min_severity ?? 2))}"
          oninput="_sm[${i}].min_severity=toInt(this.value)">
      </div>` : ''}
      ${showCheckmk ? `<div class="field-row">
        <div class="field-label">Checkmk site</div>
        <input class="field-input" value="${esc(inst.site || '')}" placeholder="monitoring"
          oninput="_sm[${i}].site=this.value">
      </div>` : ''}
      ${showPrtg ? `<div class="field-row">
        <div class="field-label">PRTG passhash</div>
        <input type="password" class="field-input sensitive" value="${esc(inst.passhash || '')}" autocomplete="new-password"
          oninput="_sm[${i}].passhash=this.value">
      </div>` : ''}
      ${showHttpJson ? `<div class="field-row">
        <div class="field-label">Items JSON path</div>
        <input class="field-input" value="${esc(inst.items_path || 'data')}" oninput="_sm[${i}].items_path=this.value">
      </div>
      <div class="field-row">
        <div class="field-label">Name / status / detail fields</div>
        <input class="field-input" value="${esc(inst.name_field || 'name')}" placeholder="name"
          oninput="_sm[${i}].name_field=this.value" style="margin-bottom:.35rem">
        <input class="field-input" value="${esc(inst.status_field || 'status')}" placeholder="status"
          oninput="_sm[${i}].status_field=this.value" style="margin-bottom:.35rem">
        <input class="field-input" value="${esc(inst.detail_field || 'detail')}" placeholder="detail"
          oninput="_sm[${i}].detail_field=this.value">
      </div>` : ''}
    </div>
  </div>`;
}

function renderSvcMonInsts() {
  if (typeof renderIntegrationsList === 'function') renderIntegrationsList();
}

function addSvcMonInst() {
  if (typeof openIntegrationCreateDirect === 'function') {
    openIntegrationCreateDirect('connector', 'zabbix');
    return;
  }
  sC('sm-enabled', true);
  _sm.push({
    type: 'zabbix',
    name: `Connector ${_sm.length + 1}`,
    enabled: true,
    url: '', token: '', username: '', password: '',
    mode: 'problems', min_severity: 2,
    items_path: 'data', name_field: 'name', status_field: 'status', detail_field: 'detail',
  });
  renderSvcMonInsts();
}

async function removeSvcMonInst(i) {
  const name = (_sm[i] && _sm[i].name) || 'monitor';
  if (!(await openSettingsConfirm({ message: `Remove monitor "${name}"?`, danger: true }))) return;
  _sm.splice(i, 1);
  renderSvcMonInsts();
}

async function testSvcMonInst(i) {
  const inst = _sm[i];
  if (!inst) return;
  const btn = document.querySelector(`#sm-card-${i} .btn`);
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(apiUrl('api/settings/test-connection'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: inst.type, instance: inst }),
    });
    const data = await res.json().catch(() => ({}));
    showToast(data.message || (data.ok ? 'OK' : 'Failed'), data.ok ? 'ok' : 'err');
  } catch (e) {
    showToast(String(e), 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// HTTP CHECKS (Docker)
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// DOCKER CONTAINERS
// ══════════════════════════════════════════════════════════════════════════════

function updateDockerUI() {
  /* legacy no-op — docker UI lives in integration modal */
}

function renderDockerHosts() {
  if (typeof renderIntegrationsList === 'function') renderIntegrationsList();
}

function addDockerHost() {
  if (typeof openIntegrationCreateDirect === 'function') {
    openIntegrationCreateDirect('docker_host');
  }
}

function addHttpCheck() {
  if (typeof openIntegrationCreateDirect === 'function') {
    openIntegrationCreateDirect('http');
  }
}

function renderContainers() {
  if (typeof renderIntegrationsList === 'function') renderIntegrationsList();
}

function addContainer() {
  if (typeof openIntegrationEdit === 'function') openIntegrationEdit('docker', 0);
}

function renderHttpChecks() {
  if (typeof renderIntegrationsList === 'function') renderIntegrationsList();
}

// ══════════════════════════════════════════════════════════════════════════════
// LOAD & POPULATE
// ══════════════════════════════════════════════════════════════════════════════

async function loadSettings() {
  const res = await fetch(apiUrl('api/settings')).catch(() => null);
  if (!res || !res.ok) { showToast(t('st.load_failed'), 'err'); return; }
  populateForm(await res.json());
}

function populateForm(cfg) {
  _ji = JSON.parse(JSON.stringify(cfg.jenkins_instances || []));
  _gi = JSON.parse(JSON.stringify(cfg.gitlab_instances  || []));
  _ghi = JSON.parse(JSON.stringify(cfg.github_instances || []));
  renderJInsts();
  renderGInsts();
  renderGhInsts();

  const g  = cfg.general        || {};
  const w  = cfg.web            || {};
  const tg = (cfg.notifications || {}).telegram || {};
  const dm = cfg.docker_monitor || {};

  sV('g-lookback',      g.default_lookback_days ?? 7);
  sV('g-history-retention', g.history_retention_days ?? 0);
  sV('g-ui-language', g.ui_language || localStorage.getItem('cimon-ui-lang') || 'en');
  sC('w-auto-collect',  w.auto_collect            ?? true);
  sC('w-docker-auto-update',  w.docker_auto_update_enabled ?? false);
  sV('w-interval',      w.collect_interval_seconds ?? 300);
  _tgBots = Array.isArray(tg.bots) ? JSON.parse(JSON.stringify(tg.bots)) : [];
  if (!_tgBots.length && ((tg.bot_token && String(tg.bot_token).trim()) || (tg.chat_id && String(tg.chat_id).trim()))) {
    _tgBots = [{
      name: 'Default',
      enabled: tg.enabled !== false,
      api_base_url: (tg.api_base_url || '').trim(),
      bot_token: tg.bot_token || '',
      chat_id: tg.chat_id || '',
      critical_only: tg.critical_only !== false,
    }];
  }
  sC('tg-enabled', tg.enabled ?? false);
  renderTgBots();
  sC('dm-enabled',      dm.enabled              ?? false);
  sC('dm-show-all',     dm.show_all_containers  ?? false);
  sV('dm-timeout',      dm.timeout_seconds      ?? 5);
  _hc = JSON.parse(JSON.stringify(dm.http_checks || []));
  _dc = JSON.parse(JSON.stringify((dm.containers || []).map(c => String(c))));
  _dh = JSON.parse(JSON.stringify(dm.docker_hosts || []));

  const sm = cfg.service_monitors || {};
  sC('sm-enabled', sm.enabled ?? false);
  sV('sm-timeout', sm.timeout_seconds ?? 15);
  _sm = JSON.parse(JSON.stringify(sm.instances || []));
  const ai = cfg.openai || {};
  sV('ai-provider', ai.provider || 'openai');
  sV('ai-api-key', ai.api_key || '');
  sV('ai-base-url', (ai.base_url || '').trim());
  updateProviderUI();
  sV('ai-model', ai.model || (
    (ai.provider || '') === 'cursor' ? 'auto'
      : (ai.provider || '') === 'ollama' ? 'llama3.1:8b'
      : 'gpt-4o-mini'));
  sC('ai-cursor-autostart', ai.cursor_proxy_autostart !== false);
  sV('ai-cursor-agent-bin', (ai.cursor_agent_bin || '').trim());
  const px = ai.proxy || {};
  sC('ai-proxy-enabled', px.enabled ?? false);
  sV('ai-proxy-type',    px.type || 'socks5');
  sV('ai-proxy-host',    px.host || '');
  sV('ai-proxy-port',    px.port ? String(px.port) : '');
  sV('ai-proxy-user',    px.username || '');
  sV('ai-proxy-password', px.password || '');
  sV('ai-proxy-url',     px.url || '');
  sV('ai-proxy-paste',   '');
  updateProxyUI();
  const lang = (gV('g-ui-language') || 'en').trim();
  if (lang) setUILang(lang);
}

// ══════════════════════════════════════════════════════════════════════════════
// COLLECT & SAVE
// ══════════════════════════════════════════════════════════════════════════════

function collectForm() {
  return {
    general: {
      project_name: 'CI/CD Monitor',
      default_lookback_days: toInt(gV('g-lookback')),
      history_retention_days: toInt(gV('g-history-retention')),
      ui_language: (gV('g-ui-language') || 'en').trim().slice(0, 5),
      data_dir: 'data',
      log_level: 'DEBUG',
    },
    jenkins_instances: _ji.map((inst) => {
      const { max_builds, console_builds, show_all_jobs, show_all_limit_jobs, ...rest } = inst;
      return rest;
    }),
    gitlab_instances:  _gi,
    github_instances:  _ghi,
    github_instances:  _ghi,
    parsers: {
      pytest_xml_dirs:  [],
      allure_json_dirs: [],
      top_failures: 500,
    },
    reports: {
      output_dir: 'data', csv_filename: 'ci_report.csv',
      html_filename: 'ci_report.html', console_mode: 'detailed',
    },
    notifications: {
      telegram: {
        enabled: gC('tg-enabled'),
        bots: _tgBots.map((b) => ({
          name: (b.name && String(b.name).trim()) ? String(b.name).trim().slice(0, 120) : `Telegram`,
          enabled: b.enabled !== false,
          api_base_url: (b.api_base_url || '').trim().slice(0, 500),
          bot_token: b.bot_token || '',
          chat_id: b.chat_id || '',
          critical_only: b.critical_only !== false,
        })),
      },
    },
    docker_monitor: {
      enabled:              gC('dm-enabled'),
      include_local_host:   true,
      show_all_containers:  gC('dm-show-all'),
      containers:           _dc.filter(c => c.trim()),
      docker_hosts:         _dh
        .map((h) => ({
          name: String(h.name || '').trim(),
          host: String(h.host || '').trim(),
          username: String(h.username || '').trim(),
          password: String(h.password || ''),
          enabled: h.enabled !== false,
        }))
        .filter((h) => h.host),
      http_checks:          _hc,
      timeout_seconds:      toInt(gV('dm-timeout')),
    },
    service_monitors: {
      enabled: gC('sm-enabled'),
      timeout_seconds: toInt(gV('sm-timeout')) || 15,
      instances: _sm.map((inst) => {
        const row = {
          type: String(inst.type || 'zabbix').trim(),
          name: String(inst.name || '').trim(),
          enabled: inst.enabled !== false,
          url: String(inst.url || '').trim(),
        };
        if (inst.host) row.host = String(inst.host || '').trim();
        if (inst.port != null && inst.port !== '') row.port = toInt(inst.port);
        if (inst.database) row.database = String(inst.database || '').trim();
        if (inst.verify_ssl === false) row.verify_ssl = false;
        if (inst.token) row.token = String(inst.token);
        if (inst.api_key) row.api_key = String(inst.api_key);
        if (inst.username) row.username = String(inst.username);
        if (inst.password) row.password = String(inst.password);
        if (inst.passhash) row.passhash = String(inst.passhash);
        if (inst.site) row.site = String(inst.site);
        if (inst.mode) row.mode = String(inst.mode);
        if (inst.min_severity != null) row.min_severity = toInt(inst.min_severity);
        if (inst.items_path) row.items_path = String(inst.items_path);
        if (inst.name_field) row.name_field = String(inst.name_field);
        if (inst.status_field) row.status_field = String(inst.status_field);
        if (inst.detail_field) row.detail_field = String(inst.detail_field);
        if (inst.status_map && typeof inst.status_map === 'object') row.status_map = inst.status_map;
        return row;
      }),
    },
    openai: {
      provider: gV('ai-provider'),
      api_key: gV('ai-api-key'),
      model:   gV('ai-model'),
      base_url: gV('ai-base-url').trim(),
      cursor_proxy_autostart: gC('ai-cursor-autostart'),
      cursor_agent_bin: gV('ai-cursor-agent-bin').trim(),
      proxy: {
        enabled:  gC('ai-proxy-enabled'),
        type:     gV('ai-proxy-type'),
        host:     gV('ai-proxy-host'),
        port:     toInt(gV('ai-proxy-port')),
        username: gV('ai-proxy-user'),
        password: gV('ai-proxy-password'),
        url:      gV('ai-proxy-url').trim(),
      },
    },
    web: {
      host: '0.0.0.0', port: 8020, live_reload: true,
      auto_collect:             gC('w-auto-collect'),
      docker_auto_update_enabled: gC('w-docker-auto-update'),
      collect_interval_seconds: toInt(gV('w-interval')),
    },
  };
}

async function saveSettings() {
  const btn = $('save-btn-hdr'), st = $('save-status-hdr');
  if (btn) { btn.disabled = true; btn.textContent = t('st.saving'); }
  if (st)  { st.textContent = ''; }

  const res = await fetch(apiUrl('api/settings'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collectForm()),
  }).catch(() => null);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '&#10003;&nbsp;<span data-i18n="st.save"></span>';
    applyUITexts();
  }

  if (res && res.ok) {
    const ts = new Date().toLocaleTimeString();
    if (st) st.textContent = t('st.saved_prefix') + ' ' + ts;
    const j = await res.json().catch(() => ({}));
    const cp = j.cursor_proxy;
    let toastType = 'ok';
    if (cp && cp.ok === false) toastType = cp.warning ? 'warn' : 'err';
    showToast(j.message || t('st.saved_toast'), toastType);
    try {
      const lang = (gV('g-ui-language') || 'en').trim();
      if (lang) setUILang(lang);
    } catch { /* ignore */ }
  } else {
    showToast(t('st.save_failed'), 'err');
  }
}

function openResetDataModal() {
  const modal = $('reset-data-modal');
  if (!modal) return;
  modal.classList.add('show');
}

function closeResetDataModal() {
  const modal = $('reset-data-modal');
  if (!modal) return;
  modal.classList.remove('show');
}

async function performResetData() {
  const btn = $('btn-reset-data-yes');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(apiUrl('api/settings/reset-data'), { method: 'POST' }).catch(() => null);
    const data = (res && await res.json().catch(() => ({}))) || {};
    if (!res || !res.ok || !data.ok) {
      const detail = (data && data.detail) ? String(data.detail) : t('st.reset_data_failed');
      showToast(detail, 'err');
      return;
    }
    showToast(data.message || t('st.reset_data_done'), 'ok');
    closeResetDataModal();
    await loadSettings();
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
function _lockDownSettingsPage() {
  try { document.body.classList.add('lockdown'); } catch { /* ignore */ }

  // Block selection/drag/context menu.
  const prevent = (e) => { try { e.preventDefault(); } catch { /* ignore */ } };
  document.addEventListener('contextmenu', prevent, { capture: true });
  document.addEventListener('dragstart', prevent, { capture: true });
  document.addEventListener('selectstart', prevent, { capture: true });

  // Block copy/cut (allow paste so settings can still be entered).
  document.addEventListener('copy', prevent, { capture: true });
  document.addEventListener('cut', prevent, { capture: true });

  // Best-effort: block common DevTools shortcuts (not reliable).
  document.addEventListener('keydown', (e) => {
    const k = String(e.key || '').toLowerCase();
    const ctrl = !!e.ctrlKey || !!e.metaKey;
    const shift = !!e.shiftKey;
    if (k === 'f12') return prevent(e);
    if (ctrl && shift && (k === 'i' || k === 'j' || k === 'c')) return prevent(e);
    if (ctrl && (k === 'u' || k === 's')) return prevent(e);
  }, { capture: true });

  // Best-effort: react to PrintScreen. Browsers generally do NOT allow preventing screenshots.
  const ov = document.createElement('div');
  ov.className = '_ss-block';
  ov.textContent = 'Screenshots disabled on this page';
  document.body.appendChild(ov);
  let t = null;
  const flash = () => {
    try {
      ov.classList.add('on');
      clearTimeout(t);
      t = setTimeout(() => ov.classList.remove('on'), 600);
    } catch { /* ignore */ }
  };
  document.addEventListener('keyup', async (e) => {
    if (String(e.key || '').toLowerCase() !== 'printscreen') return;
    _privacyMask('PrintScreen');
    flash();
    try {
      // Some browsers allow writing empty clipboard after PrintScreen.
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText('');
    } catch { /* ignore */ }
  }, { capture: true });

  // Best-effort: detect DevTools (even if opened from another tab) and block this page.
  // NOTE: A page cannot force-close DevTools; we can only react by blocking content.
  const hardBlock = (reason) => {
    try {
      ov.textContent = reason || 'DevTools detected — Settings locked';
      ov.classList.add('on');
    } catch { /* ignore */ }
    _privacyMask('DevTools');
  };
  const devtoolsLikelyOpen = () => {
    try {
      // Heuristic 1: big viewport deltas (docked devtools).
      const dw = Math.abs((window.outerWidth || 0) - (window.innerWidth || 0));
      const dh = Math.abs((window.outerHeight || 0) - (window.innerHeight || 0));
      if (dw > 180 || dh > 180) return true;

      // Heuristic 2: debugger timing (often spikes when DevTools open).
      const t0 = performance.now();
      // eslint-disable-next-line no-debugger
      debugger;
      const dt = performance.now() - t0;
      if (dt > 120) return true;
    } catch { /* ignore */ }
    return false;
  };

  // Check on load, then periodically, plus on focus/resize.
  const check = () => {
    if (devtoolsLikelyOpen()) hardBlock('DevTools detected — Settings locked');
  };
  check();
  window.addEventListener('focus', check, { passive: true });
  window.addEventListener('resize', check, { passive: true });
  setInterval(check, 900);
}

let _privacyTimer = null;
function _privacyMask(reason) {
  try {
    document.body.classList.add('privacy-on');
    const msg = document.getElementById('privacy-msg');
    if (msg) msg.textContent = reason ? `Sensitive fields hidden (${reason})` : 'Sensitive fields hidden';
  } catch { /* ignore */ }
  // Auto re-mask even if user unmasked once.
  try {
    clearTimeout(_privacyTimer);
    _privacyTimer = setTimeout(() => { try { document.body.classList.add('privacy-on'); } catch { /* ignore */ } }, 1500);
  } catch { /* ignore */ }
}
function _privacyUnmaskOnce() {
  try { document.body.classList.remove('privacy-on'); } catch { /* ignore */ }
}

document.addEventListener('DOMContentLoaded', () => {
  _lockDownSettingsPage();
  // Mask on blur / tab switch (common when using Snipping Tool / recording overlays).
  window.addEventListener('blur', () => _privacyMask('blur'), { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) _privacyMask('hidden');
  }, { passive: true });

  applyUITexts();
  _applyTheme(localStorage.getItem('cimon-theme') || 'dark');
  if (typeof initModernSelects === 'function') initModernSelects();
  loadSettings().then(() => {
    const params = new URLSearchParams(window.location.search);
    const hashSec = (window.location.hash || '').replace(/^#/, '').trim();
    const sec = params.get('sec') || hashSec;
    if (sec) showSec(sec);
  });
  const confirmYes = $('settings-confirm-yes');
  if (confirmYes) confirmYes.addEventListener('click', () => closeSettingsConfirm(true));
  $('reset-data-modal')?.addEventListener('click', (e) => {
    if (e.target === $('reset-data-modal')) closeResetDataModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeResetDataModal();
      if (typeof closeIntegrationModal === 'function') closeIntegrationModal();
    }
  });
  $('integration-modal')?.addEventListener('click', (e) => {
    if (e.target === $('integration-modal') && typeof closeIntegrationModal === 'function') closeIntegrationModal();
  });
});
