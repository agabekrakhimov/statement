// Chart.js rendering helpers. One canvas per chart; instances are cached
// and destroyed/recreated on refresh so re-renders don't leak.

const PALETTE = ["#b5670f", "#2f6fa8", "#0d7d6f", "#d6304a", "#7c5cbf", "#6b8e23", "#0891b2"];
const charts = {};

function isDark() {
  return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    && document.documentElement.getAttribute("data-theme") !== "light")
    || document.documentElement.getAttribute("data-theme") === "dark";
}
function axisColor() { return isDark() ? "#9aa4b2" : "#5b6472"; }
function gridColor() { return isDark() ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)"; }

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
      label: `${truck} — True RPM (after fuel)`,
      data: weeks.map((w) => ({ x: labelWeek(w), y: +w.trueNetRpm.toFixed(3) })),
      borderColor: color, backgroundColor: color, borderWidth: 3, tension: 0.3, pointRadius: 4, pointHoverRadius: 6,
    });
    datasets.push({
      label: `${truck} — Revenue RPM`,
      data: weeks.map((w) => ({ x: labelWeek(w), y: +w.rpm.toFixed(3) })),
      borderColor: color, backgroundColor: color, borderDash: [6, 4], borderWidth: 1.5, tension: 0.3, pointRadius: 3, pointHoverRadius: 5,
    });
    datasets.push({
      label: `${truck} — All-in CPM (incl. fuel)`,
      data: weeks.map((w) => ({ x: labelWeek(w), y: +w.allInCpm.toFixed(3) })),
      borderColor: color, backgroundColor: color, borderDash: [2, 3], borderWidth: 1.5, tension: 0.3, pointRadius: 2, pointHoverRadius: 4,
    });
    i++;
  }
  const labels = weeksByTruck.size ? Array.from(weeksByTruck.values())[0].map(labelWeek) : [];
  const opts = baseOptions("$ / mile");
  opts.plugins.tooltip.callbacks = { label: (c) => `${c.dataset.label}: $${c.parsed.y.toFixed(2)}/mi` };
  charts[canvasId] = new Chart(ctx, { type: "line", data: { labels, datasets }, options: opts });
}

function renderCostBreakdown(canvasId, weeks) {
  destroy(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  const cats = window.Metrics.DEDUCTION_CATS.map((c, i) => ({ ...c, color: PALETTE[i % PALETTE.length] }));
  charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: weeks.map(labelWeek),
      datasets: cats.map((c) => ({
        label: c.label,
        data: weeks.map((w) => +(w.byCategory[c.key] ? w.byCategory[c.key].total : 0).toFixed(2)),
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

function renderCpmVsRpm(canvasId, weeks) {
  destroy(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  const cats = window.Metrics.DEDUCTION_CATS.map((c, i) => ({ ...c, color: PALETTE[i % PALETTE.length] }));
  const datasets = cats.map((c) => ({
    type: "bar",
    label: c.label,
    data: weeks.map((w) => +(w.byCategory[c.key] ? w.byCategory[c.key].perMile : 0).toFixed(3)),
    backgroundColor: c.color,
    stack: "cpm",
  }));
  if (weeks.some((w) => w.fuelPerMile)) {
    datasets.push({
      type: "bar",
      label: "Fuel",
      data: weeks.map((w) => +(w.fuelPerMile || 0).toFixed(3)),
      backgroundColor: "#94a3b8",
      stack: "cpm",
    });
  }
  datasets.push({
    type: "line",
    label: "Revenue RPM",
    data: weeks.map((w) => +w.rpm.toFixed(3)),
    borderColor: "#111827",
    backgroundColor: "#111827",
    borderWidth: 2,
    pointRadius: 3,
    tension: 0.25,
    order: -1,
  });
  charts[canvasId] = new Chart(ctx, {
    data: { labels: weeks.map(labelWeek), datasets },
    options: {
      ...baseOptions("$ / mile"),
      plugins: { ...baseOptions().plugins, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: $${c.parsed.y.toFixed(3)}/mi` } } },
      scales: {
        x: { stacked: true, ticks: { color: axisColor() }, grid: { color: "transparent" } },
        y: { stacked: true, ticks: { color: axisColor() }, grid: { color: gridColor() }, title: { display: true, text: "$ / mile", color: axisColor() } },
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
    options: { ...baseOptions("% empty miles"), plugins: { ...baseOptions().plugins, legend: { display: false } } },
  });
}

function renderFuelTrend(canvasId, weeks) {
  destroy(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  const withFuel = weeks.filter((w) => w.hasFuelData);
  if (!withFuel.length) {
    charts[canvasId] = null;
    ctx.canvas.parentElement.querySelector(".chart-empty")?.remove();
    const div = document.createElement("div");
    div.className = "chart-empty muted";
    div.textContent = "No fuel data entered yet — click Edit on a week in Weekly Data to add fuel cost/gallons.";
    ctx.canvas.parentElement.appendChild(div);
    return;
  }
  ctx.canvas.parentElement.querySelector(".chart-empty")?.remove();
  charts[canvasId] = new Chart(ctx, {
    data: {
      labels: weeks.map(labelWeek),
      datasets: [
        { type: "bar", label: "Fuel $/mile", data: weeks.map((w) => (w.fuelPerMile !== null ? +w.fuelPerMile.toFixed(3) : null)), backgroundColor: PALETTE[6], yAxisID: "y" },
        { type: "line", label: "MPG (est. shown hollow)", data: weeks.map((w) => (w.mpg !== null ? +w.mpg.toFixed(1) : null)), borderColor: PALETTE[1], backgroundColor: PALETTE[1], pointRadius: weeks.map((w) => (w.mpg === null ? 0 : 5)), pointStyle: weeks.map((w) => (w.mpgIsEstimate ? "circle" : "circle")), pointBackgroundColor: weeks.map((w) => (w.mpgIsEstimate ? "transparent" : PALETTE[1])), pointBorderColor: PALETTE[1], borderWidth: 2, tension: 0.3, yAxisID: "y1" },
      ],
    },
    options: {
      ...baseOptions(),
      plugins: { ...baseOptions().plugins, tooltip: { callbacks: { label: (c) => (c.dataset.yAxisID === "y1" ? `MPG: ${c.parsed.y ?? "—"}${weeks[c.dataIndex].mpgIsEstimate ? " (est.)" : ""}` : `Fuel: $${c.parsed.y}/mi`) } } },
      scales: {
        x: { ticks: { color: axisColor() }, grid: { color: "transparent" } },
        y: { position: "left", ticks: { color: axisColor() }, grid: { color: gridColor() }, title: { display: true, text: "$ / mile", color: axisColor() } },
        y1: { position: "right", ticks: { color: axisColor() }, grid: { display: false }, title: { display: true, text: "MPG", color: axisColor() } },
      },
    },
  });
}

window.Charts = { renderRpmTrend, renderCostBreakdown, renderCpmVsRpm, renderMaintenanceTrend, renderDeadhead, renderFuelTrend };
