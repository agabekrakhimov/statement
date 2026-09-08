// Thin localStorage-backed store. Swap this out for a real backend API in
// production — the rest of the app only talks to these functions.

const STORAGE_KEY = "fleet-dashboard.statements.v2";

function newRecordId() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `rec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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
  if (!stmt.recordId) stmt.recordId = newRecordId();
  all.push(stmt);
  saveStatements(all);
  return all;
}

function updateStatement(recordId, updatedStmt) {
  const all = loadStatements();
  const idx = all.findIndex((s) => s.recordId === recordId);
  if (idx === -1) return all;
  all[idx] = Object.assign({}, all[idx], updatedStmt, { recordId });
  saveStatements(all);
  return all;
}

function deleteStatement(recordId) {
  const all = loadStatements().filter((s) => s.recordId !== recordId);
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

function exportJSON() {
  const data = loadStatements();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fleet-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV(weeks) {
  const cols = [
    "periodStart", "periodEnd", "truckLabel", "id", "trips", "totalMiles", "loadedMiles", "emptyMiles",
    "deadheadPct", "grossRevenue", "rpm", "cpm", "ownerNetPay", "trueNetPay", "trueNetRpm", "marginPct",
    "maintenance", "fuelCost", "fuelGallons", "mpg", "mpgIsEstimate",
  ];
  const header = cols.join(",");
  const rows = weeks.map((w) => cols.map((c) => {
    const v = w[c];
    if (v === null || v === undefined) return "";
    if (typeof v === "string" && v.includes(",")) return `"${v}"`;
    if (typeof v === "number") return +v.toFixed(4);
    return v;
  }).join(","));
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fleet-weekly-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importJSON(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of statements.");
  const all = loadStatements();
  const byRecordId = new Map(all.map((s) => [s.recordId, s]));
  for (const s of parsed) {
    if (!s.recordId) s.recordId = newRecordId();
    byRecordId.set(s.recordId, s);
  }
  saveStatements(Array.from(byRecordId.values()));
  return loadStatements();
}

window.Store = { loadStatements, saveStatements, addStatement, updateStatement, deleteStatement, resetToSample, clearAll, exportJSON, exportCSV, importJSON, newRecordId };
