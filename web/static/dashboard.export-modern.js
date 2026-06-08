// Custom export dropdowns (same visual language as select-modern).
(function () {
  'use strict';

  let _openWrap = null;

  function closeAllExportMenus() {
    if (!_openWrap) return;
    _openWrap.classList.remove('is-open');
    _openWrap = null;
  }

  function enhanceExportWrap(wrap) {
    if (!wrap || wrap.dataset.exportModern === '1') return;
    const menu = wrap.querySelector('.export-menu');
    const trigger = wrap.querySelector('.btn-export-trigger, .btn-export-sm');
    if (!menu || !trigger) return;

    wrap.dataset.exportModern = '1';
    wrap.classList.add('export-modern');

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (wrap.classList.contains('is-open')) {
        closeAllExportMenus();
        return;
      }
      closeAllExportMenus();
      wrap.classList.add('is-open');
      _openWrap = wrap;
    });

    menu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => closeAllExportMenus());
    });
  }

  function initExportModern(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.export-wrap').forEach((w) => enhanceExportWrap(w));
  }

  document.addEventListener('click', closeAllExportMenus);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllExportMenus();
  });

  window.initExportModern = initExportModern;
  window.closeAllExportMenus = closeAllExportMenus;
})();
