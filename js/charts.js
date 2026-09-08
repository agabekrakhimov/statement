// Chart.js rendering helpers. One canvas per chart; instances are cached
// and destroyed/recreated on refresh so re-renders don't leak.

const PALETTE = ["#2563eb", "#d97706", "#0d9488", "#e11d48", "#7c3aed", "#65a30d"];
const charts = {};

function isDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    && document.documentElement.getAttribute("data-theme") !== "light"
    || document.documentElement.getAttribute("data-theme") === "dark";
}

function axisColor() {
  return isDark() ? "#9aa4b2" : "#5b6472";
}
function gridColor() {
  return isDark() ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)";
}

function baseOptions(yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: axisColor(), usePointStyle: true, boxWidth: 8 } },
      tooltip: { backgroundColor: isDark() ? "#1c2128" : "#ffffff", titleColor: isDark() ? "#e6e9ef" : "#111827", bodyColor: isDark() ? "#e6e9ef" : "#111827", borderColor: gridColor(), borderWidth: 1 },
    },
    scales: {
      x: { ticks: { color: axisColor() }, grid: { color: "transparent" } },
      y: { ticks: { color: axisColor() }, grid: { color: gridColor() }, title: { display: !!yLabel, text: yLabel, color: axisColor() } },
    },
  };
}

function destroy(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

function labelWeek(w) {
  return new Date(w.periodStart + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderRpmTrend(canvasId, weeksByTruck) {
  destroy(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  const datasets = [];
  let i = 0;
  for (const [truck, weeks] of weeksByTruck) {
    const color = PALETTE[i % PALETTE.length];
    datasets.push({
      label: `${truck} — Net RPM`,
      data: weeks.map((w) => ({ x: labelWeek(w), y: +w.netRpm.toFixed(3) })),
      borderColor: color,
      backgroundColor: color,
      tension: 0.3,
      pointRadius: 4,
      pointHoverRadius: 6,
    });
    datasets.push({
      label: `${truck} — Revenue RPM`,
      data: weeks.map((w) => ({ x: labelWeek(w), y: +w.rpm.toFixed(3) })),
      borderColor: color,
      backgroundColor: color,
      borderDash: [6, 4],
      tension: 0.3,
      pointRadius: 3,
      pointHoverRadius: 5,
    });
    i++;
  }
  const labels = weeksByTruck.size ? Array.from(weeksByTruck.values())[0].map(labelWeek) : [];
  charts[canvasId] = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: { ...baseOptions("$ / mile"), plugins: { ...baseOptions().plugins, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: $${c.parsed.y.toFixed(2)}/mi` } } } },
  });
}

function renderCostBreakdown(canvasId, weeks) {
  destroy(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  const cats = [
    { key: "companyFee", label: "Company Fee", color: PALETTE[0] },
    { key: "insurance", label: "Insurance", color: PALETTE[1] },
    { key: "trailer", label: "Trailer Rental", color: PALETTE[2] },
    { key: "maintenance", label: "Maintenance", color: PALETTE[3] },
    { key: "eld", label: "ELD", color: PALETTE[4] },
    { key: "ifta", label: "IFTA", color: PALETTE[5] },
    { key: "escrow", label: "Escrow", color: "#94a3b8" },
  ];
  charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: weeks.map(labelWeek),
      datasets: cats.map((c) => ({
        label: c.label,
        data: weeks.map((w) => +w[c.key].toFixed(2)),
        backgroundColor: c.color,
        stack: "deductions",
      })),
    },
    options: {
      ...baseOptions("$"),
      scales: {
        x: { stacked: true, ticks: { color: axisColor() }, grid: { color: "transparent" } },
        y: { stacked: true, ticks: { color: axisColor() }, grid: { color: gridColor() } },
      },
    },
  });
}

function renderMaintenanceTrend(canvasId, weeks) {
  destroy(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  const rolling = weeks.map((_, i) => {
    const window_ = weeks.slice(Math.max(0, i - 3), i + 1);
    return window_.reduce((a, w) => a + w.maintenance, 0) / window_.length;
  });
  charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: weeks.map(labelWeek),
      datasets: [
        { type: "bar", label: "Maintenance ($)", data: weeks.map((w) => +w.maintenance.toFixed(2)), backgroundColor: PALETTE[3] },
        { type: "line", label: "Trailing avg (4wk)", data: rolling.map((v) => +v.toFixed(2)), borderColor: PALETTE[0], borderDash: [5, 4], pointRadius: 0, tension: 0.3 },
      ],
    },
    options: baseOptions("$"),
  });
}

function renderDeadhead(canvasId, weeks) {
  destroy(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: weeks.map(labelWeek),
      datasets: [{ label: "Deadhead %", data: weeks.map((w) => +w.deadheadPct.toFixed(1)), backgroundColor: weeks.map((w) => (w.deadheadPct > 15 ? "#e11d48" : PALETTE[2])) }],
    },
    options: {
      ...baseOptions("% empty miles"),
      plugins: { ...baseOptions().plugins, legend: { display: false } },
    },
  });
}

window.Charts = { renderRpmTrend, renderCostBreakdown, renderMaintenanceTrend, renderDeadhead };
