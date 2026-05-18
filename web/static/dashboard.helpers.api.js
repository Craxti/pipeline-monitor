// Split from dashboard.helpers.js — preserve script order in web/templates/index.html
/** API URL относительно текущей страницы (работает за nginx с префиксом /monitor/ и т.п.; не используйте ведущий /api). */
function apiUrl(path) {
  const p = path.startsWith('/') ? path.slice(1) : path;
  const base = window.location.origin + window.location.pathname;
  return new URL(p, base).href;
}
