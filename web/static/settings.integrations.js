/* Unified integrations list + create/edit modal for Settings */
(function () {
  'use strict';

  let _intFilter = 'all';
  let _intModalRef = null; // { mode:'create'|'edit', kind, index?, connectorType? }
  let _intModalDraft = null;
  let _intOpenMenuId = null;
  let _dockerSnapshotCount = null;

  function T(k, vars) {
    if (typeof tf === 'function' && vars) return tf(k, vars);
    if (typeof t === 'function') return t(k);
    return k;
  }

  function _svcMonLabel(type) {
    if (typeof _connectorLabel === 'function') return _connectorLabel(type);
    const meta = (typeof _SVC_MON_TYPES !== 'undefined' ? _SVC_MON_TYPES : []).find((x) => x.id === String(type || ''));
    return meta && meta.label ? meta.label : String(type || '');
  }

  const _DB_TYPES = new Set(['postgres', 'redis', 'mongodb', 'mysql', 'elasticsearch', 'kafka']);
  const _DB_PORTS = { postgres: 5432, redis: 6379, mongodb: 27017, mysql: 3306, elasticsearch: 9200, kafka: 9092 };

  const _CONNECTOR_ICONS = {
    zabbix: '/static/icons/zabbix.svg',
    prometheus: '/static/icons/prometheus.svg',
    alertmanager: '/static/icons/alertmanager.svg',
    uptime_kuma: '/static/icons/uptime-kuma.svg',
    netdata: '/static/icons/netdata.svg',
    prtg: '/static/icons/prtg.svg',
    checkmk: '/static/icons/checkmk.svg',
    http_json: '/static/icons/http-json.svg',
    postgres: '/static/icons/postgres.svg',
    redis: '/static/icons/redis.svg',
    mongodb: '/static/icons/mongodb.svg',
    mysql: '/static/icons/mysql.svg',
    elasticsearch: '/static/icons/elasticsearch.svg',
    kafka: '/static/icons/kafka.svg',
  };

  function _connectorGroup(type) {
    return _DB_TYPES.has(String(type || '')) ? 'database' : 'external';
  }

  function _iconForConnector(type) {
    return _CONNECTOR_ICONS[String(type || '')] || '/static/icons/http-json.svg';
  }

  const _INT_GROUPS = {
    jenkins: 'cicd', gitlab: 'cicd', github: 'cicd',
    docker: 'infra', docker_host: 'infra', http: 'infra',
    connector: 'external',
  };

  const _INT_TYPE_PICKER = [
    {
      group: 'cicd',
      labelKey: 'st.int_group_cicd',
      items: [
        { kind: 'jenkins', labelKey: 'st.nav_jenkins', icon: '/static/icons/jenkins.svg', iconImg: true },
        { kind: 'gitlab', labelKey: 'st.nav_gitlab', icon: '/static/icons/gitlab.svg', iconImg: true },
        { kind: 'github', labelKey: 'st.nav_github', icon: '/static/icons/github.svg', iconImg: true },
      ],
    },
    {
      group: 'infra',
      labelKey: 'st.int_group_infra',
      items: [
        { kind: 'docker', labelKey: 'st.int_docker_local', icon: '/static/icons/docker.svg', iconImg: true },
        { kind: 'docker_host', labelKey: 'st.int_docker_host', icon: '/static/icons/docker.svg', iconImg: true },
        { kind: 'http', labelKey: 'st.http_title', icon: '/static/icons/http.svg', iconImg: true },
      ],
    },
    {
      group: 'external',
      labelKey: 'st.int_group_external',
      items: [
        { kind: 'connector', connectorType: 'zabbix', icon: '/static/icons/zabbix.svg', iconImg: true },
        { kind: 'connector', connectorType: 'prometheus', icon: '/static/icons/prometheus.svg', iconImg: true },
        { kind: 'connector', connectorType: 'alertmanager', icon: '/static/icons/alertmanager.svg', iconImg: true },
        { kind: 'connector', connectorType: 'uptime_kuma', icon: '/static/icons/uptime-kuma.svg', iconImg: true },
        { kind: 'connector', connectorType: 'netdata', icon: '/static/icons/netdata.svg', iconImg: true },
        { kind: 'connector', connectorType: 'prtg', icon: '/static/icons/prtg.svg', iconImg: true },
        { kind: 'connector', connectorType: 'checkmk', icon: '/static/icons/checkmk.svg', iconImg: true },
        { kind: 'connector', connectorType: 'http_json', icon: '/static/icons/http-json.svg', iconImg: true },
      ],
    },
    {
      group: 'database',
      labelKey: 'st.int_group_databases',
      items: [
        { kind: 'connector', connectorType: 'postgres', icon: '/static/icons/postgres.svg', iconImg: true },
        { kind: 'connector', connectorType: 'redis', icon: '/static/icons/redis.svg', iconImg: true },
        { kind: 'connector', connectorType: 'mongodb', icon: '/static/icons/mongodb.svg', iconImg: true },
        { kind: 'connector', connectorType: 'mysql', icon: '/static/icons/mysql.svg', iconImg: true },
        { kind: 'connector', connectorType: 'elasticsearch', icon: '/static/icons/elasticsearch.svg', iconImg: true },
        { kind: 'connector', connectorType: 'kafka', icon: '/static/icons/kafka.svg', iconImg: true },
      ],
    },
  ];

  function _dockerContainerSummary(T) {
    const showAll = typeof gC === 'function' && gC('dm-show-all');
    const configuredN = (_dc || []).filter((c) => String(c).trim()).length;
    if (showAll) {
      if (_dockerSnapshotCount != null && _dockerSnapshotCount >= 0) {
        return T('st.int_docker_summary_all_count').replace('{{count}}', String(_dockerSnapshotCount));
      }
      return T('st.int_docker_summary_all');
    }
    if (configuredN > 0) {
      return T('st.int_docker_summary_list').replace('{{count}}', String(configuredN));
    }
    return T('st.int_docker_summary_empty');
  }

  async function refreshDockerSnapshotCount() {
    try {
      const base = typeof apiUrl === 'function' ? apiUrl('api/services?per_page=500') : '/api/services?per_page=500';
      const res = await fetch(base);
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const items = Array.isArray(data.items) ? data.items : [];
      _dockerSnapshotCount = items.filter((s) => String(s.kind || '').toLowerCase() === 'docker').length;
      renderIntegrationsList();
    } catch (_) {
      /* snapshot optional on settings page */
    }
  }

  function _rowId(kind, index) {
    return `${kind}-${index}`;
  }

  function _closeIntMenus() {
    document.querySelectorAll('.int-row-menu.open').forEach((el) => el.classList.remove('open'));
    _intOpenMenuId = null;
  }

  function _intIconHtml(row) {
    if (row.iconImg) {
      return `<img class="int-row-ico-img" src="${row.icon}" alt="" width="20" height="20"/>`;
    }
    if (row.iconClass) {
      return `<span class="int-row-ico snav-link-ico ${row.iconClass}" aria-hidden="true"></span>`;
    }
    if (row.badgeClass) {
      return `<span class="inst-badge inst-badge--sm ${row.badgeClass}">${typeof esc === 'function' ? esc(row.typeLabel) : row.typeLabel}</span>`;
    }
    return `<span class="int-row-ico snav-link-ico snav-ico-connectors" aria-hidden="true"></span>`;
  }

  function collectIntegrationRows() {
    const rows = [];
    (_ji || []).forEach((inst, i) => {
      rows.push({
        kind: 'jenkins', index: i, group: 'cicd',
        name: inst.name || `Jenkins ${i + 1}`,
        subtitle: (inst.url || '').trim() || T('st.status_not_set'),
        enabled: inst.enabled !== false,
        typeLabel: T('st.nav_jenkins'),
        icon: '/static/icons/jenkins.svg',
        iconImg: true,
      });
    });

    (_gi || []).forEach((inst, i) => {
      const projN = (inst.projects || []).filter((p) => (p.id || '').trim()).length;
      const sub = (inst.url || '').trim() || T('st.status_not_set');
      rows.push({
        kind: 'gitlab', index: i, group: 'cicd',
        name: inst.name || `GitLab ${i + 1}`,
        subtitle: inst.show_all_projects ? sub : `${sub} · ${projN} proj.`,
        enabled: inst.enabled !== false,
        typeLabel: T('st.nav_gitlab'),
        icon: '/static/icons/gitlab.svg',
        iconImg: true,
      });
    });

    (_ghi || []).forEach((inst, i) => {
      rows.push({
        kind: 'github', index: i, group: 'cicd',
        name: inst.name || `GitHub ${i + 1}`,
        subtitle: (inst.url || '').trim() || 'https://github.com',
        enabled: inst.enabled !== false,
        typeLabel: T('st.nav_github'),
        icon: '/static/icons/github.svg',
        iconImg: true,
      });
    });

    const dmOn = typeof gC === 'function' && gC('dm-enabled');
    const hostN = (_dh || []).length;
    const contSummary = _dockerContainerSummary(T);
    rows.push({
      kind: 'docker', index: 0, group: 'infra',
      name: T('st.dm_title'),
      subtitle: T('st.int_docker_subtitle').replace('{{hosts}}', String(hostN)).replace('{{containers}}', contSummary),
      enabled: dmOn,
      typeLabel: T('st.dm_title'),
      icon: '/static/icons/docker.svg',
      iconImg: true,
      noDelete: true,
    });

    (_dh || []).forEach((h, i) => {
      rows.push({
        kind: 'docker_host', index: i, group: 'infra',
        name: (h.name || '').trim() || (h.host || '').trim() || T('st.int_host_default', { n: i + 1 }),
        subtitle: (h.host || '').trim() || T('st.status_not_set'),
        enabled: h.enabled !== false,
        typeLabel: T('st.int_docker_host'),
        icon: '/static/icons/docker.svg',
        iconImg: true,
      });
    });

    (_hc || []).forEach((c, i) => {
      rows.push({
        kind: 'http', index: i, group: 'infra',
        name: (c.name || '').trim() || T('st.int_http_default', { n: i + 1 }),
        subtitle: (c.url || '').trim() || T('st.status_not_set'),
        enabled: true,
        typeLabel: T('st.http_title'),
        icon: '/static/icons/http.svg',
        iconImg: true,
      });
    });

    (_sm || []).forEach((inst, i) => {
      const type = String(inst.type || 'zabbix');
      const isDb = _DB_TYPES.has(type);
      const host = (inst.host || '').trim();
      const port = inst.port || _DB_PORTS[type] || '';
      const subtitle = isDb
        ? (host ? `${host}${port ? ':' + port : ''}` : T('st.status_not_set'))
        : ((inst.url || '').trim() || _svcMonLabel(type));
      rows.push({
        kind: 'connector', index: i, group: _connectorGroup(type),
        name: (inst.name || '').trim() || T('st.int_connector_default', { n: i + 1 }),
        subtitle,
        enabled: inst.enabled !== false,
        typeLabel: _svcMonLabel(type),
        icon: _iconForConnector(type),
        iconImg: true,
      });
    });

    return rows;
  }

  function renderIntegrationsList() {
    const list = $('integrations-list');
    if (!list) return;
    const rows = collectIntegrationRows().filter((r) => _intFilter === 'all' || r.group === _intFilter);

    document.querySelectorAll('.int-filter-chip').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.filter === _intFilter);
    });

    if (!rows.length) {
      list.innerHTML = `<div class="int-empty">
        <p data-i18n="st.int_empty">${T('st.int_empty')}</p>
        <button type="button" class="btn btn-sm" onclick="openIntegrationCreateModal()" data-i18n="st.int_create">${T('st.int_create')}</button>
      </div>`;
      return;
    }

    list.innerHTML = rows.map((row) => {
      const id = _rowId(row.kind, row.index);
      const canToggle = row.kind !== 'http';
      const toggleHtml = canToggle
        ? `<label class="toggle int-row-toggle" title="${T('st.active')}">
            <input type="checkbox" ${row.enabled ? 'checked' : ''} onchange="toggleIntegrationEnabled('${row.kind}', ${row.index}, this.checked)">
            <div class="toggle-track"><div class="toggle-knob"></div></div>
          </label>`
        : '';

      const menuItems = [
        `<button type="button" class="int-row-menu-item" onclick="openIntegrationEdit('${row.kind}', ${row.index}); closeIntRowMenu()">${T('st.int_edit')}</button>`,
      ];
      if (row.kind === 'jenkins' || row.kind === 'gitlab' || row.kind === 'github'
        || row.kind === 'connector' || row.kind === 'http' || row.kind === 'docker_host') {
        menuItems.push(`<button type="button" class="int-row-menu-item" onclick="testIntegrationFromList('${row.kind}', ${row.index}); closeIntRowMenu()">${T('st.test_connection_btn')}</button>`);
      }
      if (!row.noDelete) {
        menuItems.push(`<button type="button" class="int-row-menu-item int-row-menu-item--danger" onclick="deleteIntegration('${row.kind}', ${row.index}); closeIntRowMenu()">${T('st.remove')}</button>`);
      }

      return `<div class="int-row ${row.enabled ? 'int-row--on' : 'int-row--off'}" data-id="${id}">
        <span class="int-row-dot ${row.enabled ? 'int-row-dot--on' : ''}" aria-hidden="true"></span>
        ${_intIconHtml(row)}
        <div class="int-row-body">
          <div class="int-row-name">${typeof esc === 'function' ? esc(row.name) : row.name}</div>
          <div class="int-row-sub">${typeof esc === 'function' ? esc(row.typeLabel) : row.typeLabel} · ${typeof esc === 'function' ? esc(row.subtitle) : row.subtitle}</div>
        </div>
        ${toggleHtml}
        <div class="int-row-menu-wrap">
          <button type="button" class="btn btn-ghost btn-icon-round int-row-menu-btn" onclick="toggleIntRowMenu('${id}')" aria-label="${T('st.int_actions')}">&#8942;</button>
          <div class="int-row-menu" id="int-menu-${id}">${menuItems.join('')}</div>
        </div>
      </div>`;
    }).join('');
  }

  function setIntegrationFilter(filter) {
    _intFilter = filter || 'all';
    renderIntegrationsList();
  }

  function toggleIntRowMenu(id) {
    const menu = $(`int-menu-${id}`);
    if (!menu) return;
    const wasOpen = menu.classList.contains('open');
    _closeIntMenus();
    if (!wasOpen) {
      menu.classList.add('open');
      _intOpenMenuId = id;
    }
  }

  function closeIntRowMenu() {
    _closeIntMenus();
  }

  function toggleIntegrationEnabled(kind, index, on) {
    if (kind === 'jenkins') _ji[index].enabled = on;
    else if (kind === 'gitlab') _gi[index].enabled = on;
    else if (kind === 'github') _ghi[index].enabled = on;
    else if (kind === 'docker') { if (typeof sC === 'function') sC('dm-enabled', on); }
    else if (kind === 'docker_host') _dh[index].enabled = on;
    else if (kind === 'connector') {
      _sm[index].enabled = on;
      if (on && typeof sC === 'function') sC('sm-enabled', true);
    }
    renderIntegrationsList();
  }

  function _defaultDraft(kind, connectorType) {
    if (kind === 'jenkins') {
      return { name: `Jenkins ${(_ji || []).length + 1}`, enabled: true, url: '', username: '', token: '',
        jobs: [], parse_console: true, parse_allure: true, verify_ssl: true };
    }
    if (kind === 'gitlab') {
      return { name: `GitLab ${(_gi || []).length + 1}`, enabled: true, url: '', token: '',
        projects: [], max_pipelines: 10, verify_ssl: true, show_all_projects: false };
    }
    if (kind === 'github') {
      return { name: `GitHub ${(_ghi || []).length + 1}`, enabled: true, url: 'https://github.com', token: '',
        repos: [], max_runs: 10, verify_ssl: true, show_all_repos: false };
    }
    if (kind === 'http') return { name: '', url: '' };
    if (kind === 'docker_host') return { name: '', host: '', username: '', password: '', enabled: true };
    if (kind === 'docker') {
      return {
        enabled: typeof gC === 'function' ? gC('dm-enabled') : false,
        show_all_containers: typeof gC === 'function' ? gC('dm-show-all') : false,
        timeout_seconds: typeof gV === 'function' ? (parseInt(gV('dm-timeout'), 10) || 5) : 5,
        hosts: JSON.parse(JSON.stringify(_dh || [])),
        containers: JSON.parse(JSON.stringify(_dc || [])),
      };
    }
    if (kind === 'connector') {
      const ct = connectorType || 'zabbix';
      const isDb = _DB_TYPES.has(ct);
      return {
        type: ct,
        name: `${isDb ? T('st.int_db_default', { n: (_sm || []).length + 1 }) : T('st.int_connector_default', { n: (_sm || []).length + 1 })}`,
        enabled: true, url: '', host: '', port: _DB_PORTS[ct] || '',
        database: ct === 'postgres' ? 'postgres' : (ct === 'mysql' ? 'mysql' : ''),
        token: '', username: '', password: '',
        verify_ssl: true,
        mode: 'problems', min_severity: 2,
        items_path: 'data', name_field: 'name', status_field: 'status', detail_field: 'detail',
      };
    }
    return {};
  }

  function _loadDraft(kind, index) {
    if (kind === 'jenkins') return JSON.parse(JSON.stringify(_ji[index]));
    if (kind === 'gitlab') return JSON.parse(JSON.stringify(_gi[index]));
    if (kind === 'github') return JSON.parse(JSON.stringify(_ghi[index]));
    if (kind === 'http') return JSON.parse(JSON.stringify(_hc[index]));
    if (kind === 'docker_host') return JSON.parse(JSON.stringify(_dh[index]));
    if (kind === 'connector') return JSON.parse(JSON.stringify(_sm[index]));
    if (kind === 'docker') return _defaultDraft('docker');
    return {};
  }

  function _applyDraft(kind, index, draft) {
    if (kind === 'jenkins') {
      if (index == null) _ji.push(draft);
      else _ji[index] = draft;
    } else if (kind === 'gitlab') {
      if (index == null) _gi.push(draft);
      else _gi[index] = draft;
    } else if (kind === 'github') {
      if (index == null) _ghi.push(draft);
      else _ghi[index] = draft;
    } else if (kind === 'http') {
      if (index == null) _hc.push(draft);
      else _hc[index] = draft;
    } else if (kind === 'docker_host') {
      if (index == null) _dh.push(draft);
      else _dh[index] = draft;
    } else if (kind === 'connector') {
      if (index == null) _sm.push(draft);
      else _sm[index] = draft;
      if (typeof sC === 'function') sC('sm-enabled', true);
    } else if (kind === 'docker') {
      if (typeof sC === 'function') {
        sC('dm-enabled', !!draft.enabled);
        sC('dm-show-all', !!draft.show_all_containers);
        sV('dm-timeout', draft.timeout_seconds ?? 5);
      }
      _dh.length = 0;
      (draft.hosts || []).forEach((h) => _dh.push(h));
      _dc.length = 0;
      (draft.containers || []).forEach((c) => _dc.push(String(c)));
    }
  }

  function _modalTitle(kind, draft, isCreate) {
    if (isCreate) return T('st.int_modal_create');
    const names = {
      jenkins: T('st.nav_jenkins'), gitlab: T('st.nav_gitlab'), github: T('st.nav_github'),
      docker: T('st.dm_title'), docker_host: T('st.int_docker_host'),
      http: T('st.http_title'), connector: T('st.svcmon_connectors'),
    };
    const n = (draft && draft.name) ? draft.name : names[kind] || kind;
    return `${T('st.int_edit')}: ${n}`;
  }

  function _renderTypePicker() {
    return _INT_TYPE_PICKER.map((grp) => `
      <div class="int-type-group">
        <h4 class="int-type-group-title">${T(grp.labelKey)}</h4>
        <div class="int-type-grid">
          ${grp.items.map((item) => {
            const label = item.labelKey ? T(item.labelKey) : (item.connectorType ? _svcMonLabel(item.connectorType) : (item.label || ''));
            const icon = item.iconImg
              ? `<img src="${item.icon}" alt="" width="22" height="22"/>`
              : `<span class="snav-link-ico ${item.iconClass || ''}" aria-hidden="true"></span>`;
            const ct = item.connectorType ? `, '${item.connectorType}'` : '';
            return `<button type="button" class="int-type-card" onclick="pickIntegrationType('${item.kind}'${ct})">
              ${icon}<span>${typeof esc === 'function' ? esc(label) : label}</span>
            </button>`;
          }).join('')}
        </div>
      </div>`).join('');
  }

  function _draftField(label, inputHtml) {
    return `<div class="field-row"><div class="field-label">${label}</div>${inputHtml}</div>`;
  }

  function _renderConnectorForm(d) {
    const type = String(d.type || 'zabbix');
    const isDb = _DB_TYPES.has(type);
    const opts = typeof _svcMonTypeOptions === 'function' ? _svcMonTypeOptions(type) : '';
    const showAuth = ['zabbix', 'uptime_kuma', 'checkmk', 'prtg', 'postgres', 'mysql', 'elasticsearch'].includes(type);
    const showToken = ['zabbix', 'prometheus', 'alertmanager', 'checkmk', 'http_json', 'uptime_kuma'].includes(type);
    const showPassword = showAuth || type === 'redis';
    let extra = '';
    if (isDb) {
      extra = `
        ${_draftField(T('st.int_db_host'), `<input class="field-input" id="imd-host" value="${typeof esc === 'function' ? esc(d.host || '') : ''}" placeholder="10.0.0.5">`)}
        ${_draftField(T('st.int_db_port'), `<input type="number" class="field-input" id="imd-port" min="1" max="65535" value="${d.port ?? _DB_PORTS[type] ?? ''}">`)}
        ${['postgres', 'mysql'].includes(type) ? _draftField(T('st.int_db_name'), `<input class="field-input" id="imd-database" value="${typeof esc === 'function' ? esc(d.database || '') : ''}">`) : ''}`;
    }
    if (type === 'zabbix') {
      extra = `
        ${_draftField(T('st.zabbix_mode'), `<select class="field-input" id="imd-mode">
          <option value="problems" ${d.mode === 'problems' ? 'selected' : ''}>${T('st.zabbix_mode_problems')}</option>
          <option value="hosts" ${d.mode === 'hosts' ? 'selected' : ''}>${T('st.zabbix_mode_hosts')}</option>
        </select>`)}
        ${_draftField(T('st.zabbix_min_severity'), `<input type="number" class="field-input" id="imd-min_severity" min="0" max="5" value="${d.min_severity ?? 2}">`)}`;
    }
    if (type === 'checkmk') {
      extra = _draftField(T('st.checkmk_site'), `<input class="field-input" id="imd-site" value="${typeof esc === 'function' ? esc(d.site || '') : ''}" placeholder="monitoring">`);
    }
    if (type === 'prtg') {
      extra = _draftField(T('st.prtg_passhash'), `<input type="password" class="field-input sensitive" id="imd-passhash" value="${typeof esc === 'function' ? esc(d.passhash || '') : ''}" autocomplete="new-password">`);
    }
    if (type === 'http_json') {
      extra = `
        ${_draftField(T('st.http_json_items_path'), `<input class="field-input" id="imd-items_path" value="${typeof esc === 'function' ? esc(d.items_path || 'data') : 'data'}">`)}
        ${_draftField(T('st.http_json_name_field'), `<input class="field-input" id="imd-name_field" value="${typeof esc === 'function' ? esc(d.name_field || 'name') : 'name'}">`)}
        ${_draftField(T('st.http_json_status_field'), `<input class="field-input" id="imd-status_field" value="${typeof esc === 'function' ? esc(d.status_field || 'status') : 'status'}">`)}
        ${_draftField(T('st.http_json_detail_field'), `<input class="field-input" id="imd-detail_field" value="${typeof esc === 'function' ? esc(d.detail_field || 'detail') : 'detail'}">`)}`;
    }
    return `
      ${_draftField(T('st.int_name'), `<input class="field-input" id="imd-name" value="${typeof esc === 'function' ? esc(d.name || '') : ''}">`)}
      ${_draftField(T('st.field_type'), `<select class="field-input" id="imd-connector-type" onchange="onIntegrationConnectorTypeChange()">${opts}</select>`)}
      ${isDb ? '' : _draftField(T('st.field_url'), `<input class="field-input" id="imd-url" value="${typeof esc === 'function' ? esc(d.url || '') : ''}" placeholder="https://">`)}
      ${showToken ? _draftField(T('st.field_api_token'), `<input type="password" class="field-input sensitive" id="imd-token" value="${typeof esc === 'function' ? esc(d.token || d.api_key || '') : ''}" autocomplete="new-password">`) : ''}
      ${showAuth ? _draftField(T('st.field_username'), `<input class="field-input" id="imd-username" value="${typeof esc === 'function' ? esc(d.username || '') : ''}">`) : ''}
      ${showPassword ? _draftField(T('st.field_password'), `<input type="password" class="field-input sensitive" id="imd-password" value="${typeof esc === 'function' ? esc(d.password || '') : ''}" autocomplete="new-password">`) : ''}
      ${extra}
      ${type === 'elasticsearch' ? `<div class="field-row"><label class="toggle"><input type="checkbox" id="imd-verify_ssl" ${d.verify_ssl !== false ? 'checked' : ''}><div class="toggle-track"><div class="toggle-knob"></div></div><span>${T('st.verify_ssl')}</span></label></div>` : ''}
      <div class="field-row"><label class="toggle"><input type="checkbox" id="imd-enabled" ${d.enabled !== false ? 'checked' : ''}><div class="toggle-track"><div class="toggle-knob"></div></div><span>${T('st.active')}</span></label></div>`;
  }

  function _renderDockerForm(d) {
    const hosts = d.hosts || [];
    const containers = d.containers || [];
    const hostRows = hosts.length ? hosts.map((h, i) => `
      <tr>
        <td><input class="tbl-input" data-dh="name" data-i="${i}" value="${typeof esc === 'function' ? esc(h.name || '') : ''}"></td>
        <td><input class="tbl-input" data-dh="host" data-i="${i}" value="${typeof esc === 'function' ? esc(h.host || '') : ''}"></td>
        <td><input class="tbl-input" data-dh="username" data-i="${i}" value="${typeof esc === 'function' ? esc(h.username || '') : ''}"></td>
        <td><input type="password" class="tbl-input sensitive" data-dh="password" data-i="${i}" value="${typeof esc === 'function' ? esc(h.password || '') : ''}"></td>
        <td class="c"><input type="checkbox" data-dh="enabled" data-i="${i}" ${h.enabled !== false ? 'checked' : ''}></td>
        <td><button type="button" class="btn-icon" onclick="removeDraftDockerHost(${i})">&times;</button></td>
      </tr>`).join('') : `<tr class="empty-row"><td colspan="6">${T('st.int_docker_no_hosts')}</td></tr>`;

    const contRows = containers.length ? containers.map((c, i) => `
      <tr><td><input class="tbl-input" data-dc="${i}" value="${typeof esc === 'function' ? esc(c) : c}"></td>
      <td><button type="button" class="btn-icon" onclick="removeDraftContainer(${i})">&times;</button></td></tr>`).join('')
      : `<tr class="empty-row"><td colspan="2">${T('st.dm_empty_cont')}</td></tr>`;

    return `
      <div class="field-row"><label class="toggle"><input type="checkbox" id="imd-docker-enabled" ${d.enabled ? 'checked' : ''}><div class="toggle-track"><div class="toggle-knob"></div></div><span>${T('st.dm_enable')}</span></label></div>
      ${_draftField(T('st.dm_timeout'), `<input type="number" class="field-input" id="imd-docker-timeout" min="1" max="60" value="${d.timeout_seconds ?? 5}">`)}
      <div class="field-row"><label class="toggle"><input type="checkbox" id="imd-docker-show-all" ${d.show_all_containers ? 'checked' : ''}><div class="toggle-track"><div class="toggle-knob"></div></div><span>${T('st.dm_show_all')}</span></label></div>
      <div class="sub-sec">
        <div class="sub-sec-hdr"><span class="field-label">${T('st.int_docker_hosts')}</span><button type="button" class="btn btn-sm" onclick="addDraftDockerHost()">+</button></div>
        <div class="st-table-wrap"><table><thead><tr><th>${T('st.docker_th_name')}</th><th>${T('st.docker_th_host')}</th><th>${T('st.docker_th_user')}</th><th>${T('st.docker_th_password')}</th><th>${T('st.docker_th_on')}</th><th></th></tr></thead><tbody id="imd-docker-hosts">${hostRows}</tbody></table></div>
      </div>
      <div class="sub-sec" id="imd-containers-wrap" style="display:${d.show_all_containers ? 'none' : ''}">
        <div class="sub-sec-hdr"><span class="field-label">${T('st.dm_containers')}</span><button type="button" class="btn btn-sm" onclick="addDraftContainer()">+</button></div>
        <div class="st-table-wrap"><table><thead><tr><th>${T('st.th_container')}</th><th></th></tr></thead><tbody id="imd-docker-containers">${contRows}</tbody></table></div>
      </div>`;
  }

  function _renderGitlabProjects(d) {
    const projs = d.projects || [];
    const rows = projs.length ? projs.map((p, i) => `
      <tr><td><input class="tbl-input" data-gp="id" data-i="${i}" value="${typeof esc === 'function' ? esc(p.id || '') : ''}"></td>
      <td class="c"><input type="checkbox" data-gp="critical" data-i="${i}" ${p.critical ? 'checked' : ''}></td>
      <td><button type="button" class="btn-icon" onclick="removeDraftGitlabProj(${i})">&times;</button></td></tr>`).join('')
      : `<tr class="empty-row"><td colspan="3">${T('st.g_empty_proj')}</td></tr>`;
    return `
      <div class="field-row"><label class="toggle"><input type="checkbox" id="imd-gl-show-all" ${d.show_all_projects ? 'checked' : ''} onchange="toggleDraftGitlabPanel()"><div class="toggle-track"><div class="toggle-knob"></div></div><span>${T('st.g_show_all')}</span></label></div>
      <div id="imd-gl-projs" style="display:${d.show_all_projects ? 'none' : ''}">
        <div class="sub-sec-hdr"><span class="field-label">${T('st.g_projects_monitor')}</span><button type="button" class="btn btn-sm" onclick="addDraftGitlabProj()">+</button></div>
        <div class="st-table-wrap"><table><thead><tr><th>${T('st.th_project_id')}</th><th>${T('st.th_critical')}</th><th></th></tr></thead><tbody id="imd-gl-proj-body">${rows}</tbody></table></div>
      </div>`;
  }

  function _renderGithubRepos(d) {
    const repos = d.repos || [];
    const rows = repos.length ? repos.map((p, i) => `
      <tr><td><input class="tbl-input" data-ghp="id" data-i="${i}" value="${typeof esc === 'function' ? esc(p.id || '') : ''}"></td>
      <td class="c"><input type="checkbox" data-ghp="critical" data-i="${i}" ${p.critical ? 'checked' : ''}></td>
      <td><button type="button" class="btn-icon" onclick="removeDraftGhRepo(${i})">&times;</button></td></tr>`).join('')
      : `<tr class="empty-row"><td colspan="3">${T('st.gh_empty_repo')}</td></tr>`;
    return `
      <div class="field-row"><label class="toggle"><input type="checkbox" id="imd-gh-show-all" ${d.show_all_repos ? 'checked' : ''} onchange="toggleDraftGithubPanel()"><div class="toggle-track"><div class="toggle-knob"></div></div><span>${T('st.gh_show_all')}</span></label></div>
      <div id="imd-gh-repos" style="display:${d.show_all_repos ? 'none' : ''}">
        <div class="sub-sec-hdr"><span class="field-label">${T('st.gh_repos_monitor')}</span><button type="button" class="btn btn-sm" onclick="addDraftGhRepo()">+</button></div>
        <div class="st-table-wrap"><table><thead><tr><th>${T('st.th_repo')}</th><th>${T('st.th_critical')}</th><th></th></tr></thead><tbody id="imd-gh-repo-body">${rows}</tbody></table></div>
      </div>`;
  }

  function _renderModalForm() {
    const ref = _intModalRef;
    const d = _intModalDraft;
    if (!ref) return '';
    if (ref.mode === 'pick') return `<div class="int-type-picker">${_renderTypePicker()}</div>`;
    if (!d) return '';

    if (ref.kind === 'jenkins') {
      return `
        ${_draftField(T('st.int_name'), `<input class="field-input" id="imd-name" value="${typeof esc === 'function' ? esc(d.name || '') : ''}">`)}
        ${_draftField(T('st.j_server_url'), `<input type="url" class="field-input sensitive" id="imd-url" value="${typeof esc === 'function' ? esc(d.url || '') : ''}">`)}
        <div class="two-col">
          ${_draftField(T('st.j_username'), `<input class="field-input" id="imd-username" value="${typeof esc === 'function' ? esc(d.username || '') : ''}">`)}
          ${_draftField(T('st.j_token'), `<input type="password" class="field-input sensitive" id="imd-token" value="${typeof esc === 'function' ? esc(d.token || '') : ''}" autocomplete="new-password">`)}
        </div>
        <div class="field-row"><label class="toggle"><input type="checkbox" id="imd-parse_console" ${d.parse_console ? 'checked' : ''}><div class="toggle-track"><div class="toggle-knob"></div></div><span>${T('st.parse_console')}</span></label></div>
        <div class="field-row"><label class="toggle"><input type="checkbox" id="imd-parse_allure" ${d.parse_allure ? 'checked' : ''}><div class="toggle-track"><div class="toggle-knob"></div></div><span>${T('st.parse_allure')}</span></label></div>
        <div class="field-row"><label class="toggle"><input type="checkbox" id="imd-verify_ssl" ${d.verify_ssl !== false ? 'checked' : ''}><div class="toggle-track"><div class="toggle-knob"></div></div><span>${T('st.verify_ssl')}</span></label></div>
        <div class="field-row"><label class="toggle"><input type="checkbox" id="imd-enabled" ${d.enabled !== false ? 'checked' : ''}><div class="toggle-track"><div class="toggle-knob"></div></div><span>${T('st.active')}</span></label></div>`;
    }

    if (ref.kind === 'gitlab') {
      return `
        ${_draftField(T('st.int_name'), `<input class="field-input" id="imd-name" value="${typeof esc === 'function' ? esc(d.name || '') : ''}">`)}
        ${_draftField(T('st.g_url'), `<input type="url" class="field-input sensitive" id="imd-url" value="${typeof esc === 'function' ? esc(d.url || '') : ''}">`)}
        ${_draftField(T('st.g_token'), `<input type="password" class="field-input sensitive" id="imd-token" value="${typeof esc === 'function' ? esc(d.token || '') : ''}" autocomplete="new-password">`)}
        ${_draftField(T('st.g_max_pipes'), `<input type="number" class="field-input" id="imd-max_pipelines" min="1" max="200" value="${d.max_pipelines ?? 10}">`)}
        <div class="field-row"><label class="toggle"><input type="checkbox" id="imd-verify_ssl" ${d.verify_ssl !== false ? 'checked' : ''}><div class="toggle-track"><div class="toggle-knob"></div></div><span>${T('st.verify_ssl')}</span></label></div>
        <div class="sub-sec">${_renderGitlabProjects(d)}</div>
        <div class="field-row"><label class="toggle"><input type="checkbox" id="imd-enabled" ${d.enabled !== false ? 'checked' : ''}><div class="toggle-track"><div class="toggle-knob"></div></div><span>${T('st.active')}</span></label></div>`;
    }

    if (ref.kind === 'github') {
      return `
        ${_draftField(T('st.int_name'), `<input class="field-input" id="imd-name" value="${typeof esc === 'function' ? esc(d.name || '') : ''}">`)}
        ${_draftField(T('st.gh_url'), `<input type="url" class="field-input sensitive" id="imd-url" value="${typeof esc === 'function' ? esc(d.url || '') : ''}">`)}
        ${_draftField(T('st.gh_token'), `<input type="password" class="field-input sensitive" id="imd-token" value="${typeof esc === 'function' ? esc(d.token || '') : ''}" autocomplete="new-password">`)}
        ${_draftField(T('st.gh_max_runs'), `<input type="number" class="field-input" id="imd-max_runs" min="1" max="100" value="${d.max_runs ?? 10}">`)}
        <div class="field-row"><label class="toggle"><input type="checkbox" id="imd-verify_ssl" ${d.verify_ssl !== false ? 'checked' : ''}><div class="toggle-track"><div class="toggle-knob"></div></div><span>${T('st.verify_ssl')}</span></label></div>
        <div class="sub-sec">${_renderGithubRepos(d)}</div>
        <div class="field-row"><label class="toggle"><input type="checkbox" id="imd-enabled" ${d.enabled !== false ? 'checked' : ''}><div class="toggle-track"><div class="toggle-knob"></div></div><span>${T('st.active')}</span></label></div>`;
    }

    if (ref.kind === 'http') {
      return `
        ${_draftField(T('st.th_http_name'), `<input class="field-input" id="imd-name" value="${typeof esc === 'function' ? esc(d.name || '') : ''}">`)}
        ${_draftField(T('st.th_url'), `<input class="field-input" id="imd-url" value="${typeof esc === 'function' ? esc(d.url || '') : ''}" placeholder="https://">`)}`;
    }

    if (ref.kind === 'docker_host') {
      return `
        ${_draftField(T('st.int_name'), `<input class="field-input" id="imd-name" value="${typeof esc === 'function' ? esc(d.name || '') : ''}">`)}
        ${_draftField(T('st.field_host_ip'), `<input class="field-input" id="imd-host" value="${typeof esc === 'function' ? esc(d.host || '') : ''}">`)}
        ${_draftField(T('st.field_username'), `<input class="field-input" id="imd-username" value="${typeof esc === 'function' ? esc(d.username || '') : ''}">`)}
        ${_draftField(T('st.field_password'), `<input type="password" class="field-input sensitive" id="imd-password" value="${typeof esc === 'function' ? esc(d.password || '') : ''}">`)}
        <div class="field-row"><label class="toggle"><input type="checkbox" id="imd-enabled" ${d.enabled !== false ? 'checked' : ''}><div class="toggle-track"><div class="toggle-knob"></div></div><span>${T('st.active')}</span></label></div>`;
    }

    if (ref.kind === 'docker') return _renderDockerForm(d);
    if (ref.kind === 'connector') return _renderConnectorForm(d);
    return '';
  }

  function _syncDraftFromDom() {
    const ref = _intModalRef;
    if (!ref || ref.mode === 'pick' || !_intModalDraft) return;
    const d = _intModalDraft;
    const gv = (id) => { const el = $(id); return el ? el.value : ''; };
    const gc = (id) => { const el = $(id); return el ? el.checked : false; };

    if (ref.kind === 'jenkins') {
      d.name = gv('imd-name'); d.url = gv('imd-url'); d.username = gv('imd-username'); d.token = gv('imd-token');
      d.parse_console = gc('imd-parse_console'); d.parse_allure = gc('imd-parse_allure');
      d.verify_ssl = gc('imd-verify_ssl'); d.enabled = gc('imd-enabled');
    } else if (ref.kind === 'gitlab') {
      d.name = gv('imd-name'); d.url = gv('imd-url'); d.token = gv('imd-token');
      d.max_pipelines = parseInt(gv('imd-max_pipelines'), 10) || 10;
      d.verify_ssl = gc('imd-verify_ssl'); d.enabled = gc('imd-enabled');
      d.show_all_projects = gc('imd-gl-show-all');
      if (!Array.isArray(d.projects)) d.projects = [];
      document.querySelectorAll('[data-gp]').forEach((el) => {
        const i = parseInt(el.dataset.i, 10);
        const f = el.dataset.gp;
        if (!d.projects[i]) d.projects[i] = { id: '', critical: true };
        if (f === 'id') d.projects[i].id = el.value;
        if (f === 'critical') d.projects[i].critical = el.checked;
      });
    } else if (ref.kind === 'github') {
      d.name = gv('imd-name'); d.url = gv('imd-url'); d.token = gv('imd-token');
      d.max_runs = parseInt(gv('imd-max_runs'), 10) || 10;
      d.verify_ssl = gc('imd-verify_ssl'); d.enabled = gc('imd-enabled');
      d.show_all_repos = gc('imd-gh-show-all');
      if (!Array.isArray(d.repos)) d.repos = [];
      document.querySelectorAll('[data-ghp]').forEach((el) => {
        const i = parseInt(el.dataset.i, 10);
        const f = el.dataset.ghp;
        if (!d.repos[i]) d.repos[i] = { id: '', critical: true };
        if (f === 'id') d.repos[i].id = el.value;
        if (f === 'critical') d.repos[i].critical = el.checked;
      });
    } else if (ref.kind === 'http') {
      d.name = gv('imd-name'); d.url = gv('imd-url');
    } else if (ref.kind === 'docker_host') {
      d.name = gv('imd-name'); d.host = gv('imd-host');
      d.username = gv('imd-username'); d.password = gv('imd-password');
      d.enabled = gc('imd-enabled');
    } else if (ref.kind === 'docker') {
      d.enabled = gc('imd-docker-enabled');
      d.show_all_containers = gc('imd-docker-show-all');
      d.timeout_seconds = parseInt(gv('imd-docker-timeout'), 10) || 5;
      document.querySelectorAll('[data-dh]').forEach((el) => {
        const i = parseInt(el.dataset.i, 10);
        const f = el.dataset.dh;
        if (!d.hosts[i]) d.hosts[i] = { name: '', host: '', username: '', password: '', enabled: true };
        if (f === 'enabled') d.hosts[i].enabled = el.checked;
        else d.hosts[i][f] = el.value;
      });
      d.containers = [];
      document.querySelectorAll('[data-dc]').forEach((el) => d.containers.push(el.value));
    } else if (ref.kind === 'connector') {
      d.name = gv('imd-name'); d.url = gv('imd-url');
      d.type = gv('imd-connector-type') || d.type;
      d.host = gv('imd-host'); d.port = gv('imd-port'); d.database = gv('imd-database');
      d.token = gv('imd-token'); d.username = gv('imd-username'); d.password = gv('imd-password');
      d.enabled = gc('imd-enabled');
      if ($('imd-verify_ssl')) d.verify_ssl = gc('imd-verify_ssl');
      const mode = gv('imd-mode'); if (mode) d.mode = mode;
      const ms = gv('imd-min_severity'); if (ms !== '') d.min_severity = parseInt(ms, 10);
      const site = gv('imd-site'); if (site) d.site = site;
      const ph = gv('imd-passhash'); if (ph) d.passhash = ph;
      ['items_path', 'name_field', 'status_field', 'detail_field'].forEach((k) => {
        const v = gv(`imd-${k}`); if (v) d[k] = v;
      });
    }
  }

  function _refreshModalBody() {
    const body = $('integration-modal-body');
    const foot = $('integration-modal-footer');
    if (!body) return;
    body.innerHTML = _renderModalForm();
    const isPick = _intModalRef && _intModalRef.mode === 'pick';
    const canTest = _intModalRef && !isPick && _intModalRef.kind !== 'docker';
    if (foot) {
      foot.style.display = isPick ? 'none' : '';
      const testBtn = $('integration-test-btn');
      if (testBtn) testBtn.style.display = canTest ? '' : 'none';
    }
    const title = $('integration-modal-title');
    if (title && _intModalRef) {
      title.textContent = _intModalRef.mode === 'pick'
        ? T('st.int_pick_type')
        : _modalTitle(_intModalRef.kind, _intModalDraft, _intModalRef.mode === 'create');
    }
  }

  function openIntegrationCreateDirect(kind, connectorType) {
    _intModalRef = { mode: 'create', kind, connectorType };
    _intModalDraft = _defaultDraft(kind, connectorType);
    _refreshModalBody();
    $('integration-modal')?.classList.add('show');
    if (typeof showSec === 'function') showSec('integrations');
  }

  function openIntegrationCreateModal() {
    _intModalRef = { mode: 'pick' };
    _intModalDraft = null;
    _refreshModalBody();
    $('integration-modal')?.classList.add('show');
    if (typeof showSec === 'function') showSec('integrations');
  }

  function pickIntegrationType(kind, connectorType) {
    if (kind === 'docker') {
      _intModalRef = { mode: 'edit', kind: 'docker', index: 0 };
      _intModalDraft = _loadDraft('docker', 0);
    } else {
      _intModalRef = { mode: 'create', kind, connectorType };
      _intModalDraft = _defaultDraft(kind, connectorType);
    }
    _refreshModalBody();
  }

  function openIntegrationEdit(kind, index) {
    _intModalRef = { mode: 'edit', kind, index };
    _intModalDraft = _loadDraft(kind, index);
    _refreshModalBody();
    $('integration-modal')?.classList.add('show');
    if (typeof showSec === 'function') showSec('integrations');
  }

  function closeIntegrationModal() {
    $('integration-modal')?.classList.remove('show');
    _intModalRef = null;
    _intModalDraft = null;
  }

  function saveIntegrationModal() {
    if (!_intModalRef || _intModalRef.mode === 'pick') return;
    _syncDraftFromDom();
    const { kind, index, mode } = _intModalRef;
    _applyDraft(kind, mode === 'create' ? null : index, _intModalDraft);
    const refreshDocker = kind === 'docker';
    closeIntegrationModal();
    renderIntegrationsList();
    if (refreshDocker) refreshDockerSnapshotCount();
  }

  async function deleteIntegration(kind, index) {
    const rows = collectIntegrationRows();
    const row = rows.find((r) => r.kind === kind && r.index === index);
    const name = row ? row.name : kind;
    if (typeof openSettingsConfirm === 'function') {
      if (!(await openSettingsConfirm({ message: `${T('st.remove')} "${name}"?`, danger: true }))) return;
    }
    if (kind === 'jenkins') _ji.splice(index, 1);
    else if (kind === 'gitlab') _gi.splice(index, 1);
    else if (kind === 'github') _ghi.splice(index, 1);
    else if (kind === 'http') _hc.splice(index, 1);
    else if (kind === 'docker_host') _dh.splice(index, 1);
    else if (kind === 'connector') _sm.splice(index, 1);
    renderIntegrationsList();
  }

  function _buildTestPayload(kind, draft) {
    if (kind === 'jenkins') {
      return { kind, url: (draft.url || '').trim(), username: draft.username || '', token: draft.token || '', verify_ssl: draft.verify_ssl !== false };
    }
    if (kind === 'gitlab') {
      return { kind, url: (draft.url || '').trim(), token: draft.token || '', verify_ssl: draft.verify_ssl !== false };
    }
    if (kind === 'github') {
      return { kind, url: (draft.url || '').trim() || 'https://github.com', token: draft.token || '', verify_ssl: draft.verify_ssl !== false };
    }
    if (kind === 'http') {
      return { kind: 'http', url: (draft.url || '').trim(), name: draft.name || '' };
    }
    if (kind === 'docker_host') {
      return { kind: 'docker_host', host: (draft.host || '').trim(), name: draft.name || '', username: draft.username || '', password: draft.password || '', port: draft.port || 2375 };
    }
    if (kind === 'connector') {
      return { kind: draft.type, instance: { ...draft, type: draft.type } };
    }
    return null;
  }

  async function _runConnectionTest(payload) {
    const res = await fetch(typeof apiUrl === 'function' ? apiUrl('api/settings/test-connection') : '/api/settings/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    const data = (res && await res.json().catch(() => ({}))) || {};
    const msg = data.message ? String(data.message) : T('st.test_connection_failed');
    const ok = !!(res && res.ok && data.ok);
    if (typeof showToast === 'function') showToast(msg, ok ? 'ok' : 'err');
    return { ok, msg };
  }

  async function testIntegrationModal() {
    if (!_intModalRef || _intModalRef.mode === 'pick') return;
    _syncDraftFromDom();
    const payload = _buildTestPayload(_intModalRef.kind, _intModalDraft);
    if (!payload) return;
    const btn = $('integration-test-btn');
    if (btn) btn.disabled = true;
    try {
      await _runConnectionTest(payload);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function testIntegrationFromList(kind, index) {
    if (kind === 'jenkins' || kind === 'gitlab' || kind === 'github') {
      if (typeof testInstanceConnection === 'function') return testInstanceConnection(kind, index);
    }
    if (kind === 'connector') {
      if (typeof testSvcMonInst === 'function') return testSvcMonInst(index);
    }
    if (kind === 'http') {
      const inst = (_hc || [])[index];
      if (!inst) return;
      return _runConnectionTest({ kind: 'http', url: (inst.url || '').trim(), name: inst.name || '' });
    }
    if (kind === 'docker_host') {
      const inst = (_dh || [])[index];
      if (!inst) return;
      return _runConnectionTest({ kind: 'docker_host', host: (inst.host || '').trim(), name: inst.name || '', username: inst.username || '', password: inst.password || '', port: inst.port || 2375 });
    }
  }

  function onIntegrationConnectorTypeChange() {
    _syncDraftFromDom();
    _refreshModalBody();
  }

  function addDraftDockerHost() {
    _syncDraftFromDom();
    _intModalDraft.hosts = _intModalDraft.hosts || [];
    _intModalDraft.hosts.push({ name: '', host: '', username: '', password: '', enabled: true });
    _refreshModalBody();
  }

  function removeDraftDockerHost(i) {
    _syncDraftFromDom();
    _intModalDraft.hosts.splice(i, 1);
    _refreshModalBody();
  }

  function addDraftContainer() {
    _syncDraftFromDom();
    _intModalDraft.containers = _intModalDraft.containers || [];
    _intModalDraft.containers.push('');
    _refreshModalBody();
  }

  function removeDraftContainer(i) {
    _syncDraftFromDom();
    _intModalDraft.containers.splice(i, 1);
    _refreshModalBody();
  }

  function addDraftGitlabProj() {
    _syncDraftFromDom();
    _intModalDraft.projects = _intModalDraft.projects || [];
    _intModalDraft.projects.push({ id: '', critical: true });
    _refreshModalBody();
  }

  function removeDraftGitlabProj(i) {
    _syncDraftFromDom();
    _intModalDraft.projects.splice(i, 1);
    _refreshModalBody();
  }

  function toggleDraftGitlabPanel() {
    const on = $('imd-gl-show-all')?.checked;
    const panel = $('imd-gl-projs');
    if (panel) panel.style.display = on ? 'none' : '';
  }

  function addDraftGhRepo() {
    _syncDraftFromDom();
    _intModalDraft.repos = _intModalDraft.repos || [];
    _intModalDraft.repos.push({ id: '', critical: true });
    _refreshModalBody();
  }

  function removeDraftGhRepo(i) {
    _syncDraftFromDom();
    _intModalDraft.repos.splice(i, 1);
    _refreshModalBody();
  }

  function toggleDraftGithubPanel() {
    const on = $('imd-gh-show-all')?.checked;
    const panel = $('imd-gh-repos');
    if (panel) panel.style.display = on ? 'none' : '';
  }

  document.addEventListener('click', (e) => {
    if (_intOpenMenuId && !e.target.closest('.int-row-menu-wrap')) _closeIntMenus();
  });

  document.addEventListener('cimon:lang-change', () => {
    renderIntegrationsList();
    if (_intModalRef) _refreshModalBody();
  });

  window.setIntegrationFilter = setIntegrationFilter;
  window.renderIntegrationsList = renderIntegrationsList;
  window.openIntegrationCreateDirect = openIntegrationCreateDirect;
  window.openIntegrationCreateModal = openIntegrationCreateModal;
  window.openIntegrationEdit = openIntegrationEdit;
  window.closeIntegrationModal = closeIntegrationModal;
  window.saveIntegrationModal = saveIntegrationModal;
  window.deleteIntegration = deleteIntegration;
  window.toggleIntegrationEnabled = toggleIntegrationEnabled;
  window.toggleIntRowMenu = toggleIntRowMenu;
  window.closeIntRowMenu = closeIntRowMenu;
  window.pickIntegrationType = pickIntegrationType;
  window.onIntegrationConnectorTypeChange = onIntegrationConnectorTypeChange;
  window.addDraftDockerHost = addDraftDockerHost;
  window.removeDraftDockerHost = removeDraftDockerHost;
  window.addDraftContainer = addDraftContainer;
  window.removeDraftContainer = removeDraftContainer;
  window.addDraftGitlabProj = addDraftGitlabProj;
  window.removeDraftGitlabProj = removeDraftGitlabProj;
  window.toggleDraftGitlabPanel = toggleDraftGitlabPanel;
  window.addDraftGhRepo = addDraftGhRepo;
  window.removeDraftGhRepo = removeDraftGhRepo;
  window.toggleDraftGithubPanel = toggleDraftGithubPanel;
  window.testIntegrationFromList = testIntegrationFromList;
  window.testIntegrationModal = testIntegrationModal;
  window.refreshDockerSnapshotCount = refreshDockerSnapshotCount;
})();
