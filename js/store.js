// Thin localStorage-backed store. Swap this out for a real backend API in
// production — the rest of the app only talks to these four functions.

const STORAGE_KEY = "fleet-dashboard.statements.v1";

function loadStatements() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Failed to read stored statements, falling back to sample data.", e);
  }
  return JSON.parse(JSON.stringify(window.SAMPLE_STATEMENTS));
}

function saveStatements(statements) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(statements));
}

function addStatement(stmt) {
  const all = loadStatements();
  all.push(stmt);
  saveStatements(all);
  return all;
}

function resetToSample() {
  saveStatements(JSON.parse(JSON.stringify(window.SAMPLE_STATEMENTS)));
  return loadStatements();
}

function clearAll() {
  saveStatements([]);
  return [];
}

window.Store = { loadStatements, saveStatements, addStatement, resetToSample, clearAll };
