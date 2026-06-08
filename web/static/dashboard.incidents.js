// Legacy build-correlation helpers — incidents now come from service analysis only.

function analyzeCorrelation(_builds) {
  return [];
}

function renderServicesIncidentsPanel(_builds) {
  const panel = document.getElementById('panel-services-incidents');
  if (panel) panel.style.display = 'none';
}
