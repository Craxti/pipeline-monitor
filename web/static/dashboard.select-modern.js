// Custom styled dropdowns for filter selects (native <option> menus cannot be themed).
(function () {
  'use strict';

  const SKIP_ANCESTOR = '.tc-series-row, .trends-chart-modal, #tc-chart-form, .har-raw-toolbar';

  let _openWrap = null;

  function _shouldEnhance(select) {
    if (!select || select.tagName !== 'SELECT') return false;
    if (select.multiple || select.dataset.modernSelect === '1') return false;
    if (select.closest('.select-modern')) return false;
    if (select.closest(SKIP_ANCESTOR)) return false;
    if (select.classList.contains('tc-sr-only')) return false;
    if (select.hidden || select.getAttribute('aria-hidden') === 'true') return false;
    return true;
  }

  function closeAllModernSelects() {
    if (!_openWrap) return;
    _openWrap.classList.remove('is-open');
    const menu = _openWrap.querySelector('.select-modern-menu');
    const trigger = _openWrap.querySelector('.select-modern-trigger');
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    _openWrap = null;
  }

  function _positionMenu(wrap, menu, trigger) {
    menu.classList.remove('select-modern-menu--up');
    menu.style.maxHeight = '';
    const rect = trigger.getBoundingClientRect();
    const maxH = Math.min(280, Math.max(160, window.innerHeight - rect.bottom - 16));
    const upSpace = rect.top - 16;
    if (maxH < 120 && upSpace > maxH) {
      menu.classList.add('select-modern-menu--up');
      menu.style.maxHeight = `${Math.min(280, upSpace)}px`;
    } else {
      menu.style.maxHeight = `${maxH}px`;
    }
  }

  function enhanceModernSelect(select) {
    if (!_shouldEnhance(select)) return;

    select.dataset.modernSelect = '1';

    const wrap = document.createElement('div');
    wrap.className = 'select-modern';
    select.classList.forEach((cls) => {
      if (cls !== 'f-select') wrap.classList.add(cls);
    });

    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add('select-modern-native');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'select-modern-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');

    const label = document.createElement('span');
    label.className = 'select-modern-label';

    const chevron = document.createElement('span');
    chevron.className = 'select-modern-chevron';
    chevron.setAttribute('aria-hidden', 'true');

    trigger.appendChild(label);
    trigger.appendChild(chevron);

    const menu = document.createElement('div');
    menu.className = 'select-modern-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;

    wrap.appendChild(trigger);
    wrap.appendChild(menu);

    const syncLabel = () => {
      const opt = select.selectedOptions[0];
      label.textContent = opt ? opt.textContent : '—';
    };

    const buildMenu = () => {
      menu.innerHTML = '';
      [...select.options].forEach((opt) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'select-modern-option';
        item.setAttribute('role', 'option');
        item.textContent = opt.textContent;
        if (opt.disabled) {
          item.disabled = true;
          item.classList.add('is-disabled');
        }
        if (opt.value === select.value) {
          item.classList.add('is-selected');
          item.setAttribute('aria-selected', 'true');
        }
        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (opt.disabled) return;
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          closeAllModernSelects();
          syncLabel();
          buildMenu();
        });
        menu.appendChild(item);
      });
    };

    const refresh = () => {
      syncLabel();
      if (wrap.classList.contains('is-open')) buildMenu();
    };

    wrap._modernSelectRefresh = refresh;

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (select.disabled) return;
      if (wrap.classList.contains('is-open')) {
        closeAllModernSelects();
        return;
      }
      buildMenu();
      closeAllModernSelects();
      menu.hidden = false;
      wrap.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      _openWrap = wrap;
      _positionMenu(wrap, menu, trigger);
      const selected = menu.querySelector('.select-modern-option.is-selected');
      selected?.scrollIntoView({ block: 'nearest' });
    });

    select.addEventListener('change', refresh);

    new MutationObserver(refresh).observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['selected', 'disabled'],
    });

    if (select.disabled) {
      wrap.classList.add('is-disabled');
      trigger.disabled = true;
    }

    syncLabel();
  }

  function initModernSelects(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('select').forEach((sel) => enhanceModernSelect(sel));
  }

  function refreshAllModernSelects(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.select-modern').forEach((wrap) => {
      if (typeof wrap._modernSelectRefresh === 'function') wrap._modernSelectRefresh();
    });
  }

  document.addEventListener('click', closeAllModernSelects);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModernSelects();
  });
  window.addEventListener('resize', closeAllModernSelects);

  window.initModernSelects = initModernSelects;
  window.refreshAllModernSelects = refreshAllModernSelects;
  window.closeAllModernSelects = closeAllModernSelects;
})();
