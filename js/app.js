(function () {
  const fmtMoney = (v) => {
    if (v === null || v === undefined || isNaN(v)) return "—";
    const sign = v < 0 ? "-" : "";
    return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const fmtNum = (v, d = 0) => (v === null || v === undefined || isNaN(v) ? "—" : v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
  const fmtDate = (s) => (s ? new Date(s + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }) : "—");

  let pendingFiles = [];
  let pendingIndex = 0;

  function refresh() {
    window.Metrics.setDieselPrice(parseFloat(document.getElementById("diesel-price").value));
    const raw = window.Store.loadStatements();
    const { statements, conflicts } = window.Metrics.dedupeStatements(raw);
    const weeks = statements.map((s) => window.Metrics.computeWeekMetrics(s)).sort((a, b) => new Date(a.periodStart) - new Date(b.periodStart));
    const rollups = window.Metrics.rollupByTruck(weeks);
    const insights = window.Metrics.generateInsights(weeks, conflicts);

    renderInsights(insights);
    renderKpis(weeks, rollups);
    renderCharts(weeks, rollups);
    renderTruckTable(rollups);
    renderDriverTables(statements, weeks);
    renderWeekTable(weeks);
  }

  function renderInsights(insights) {
    const el = document.getElementById("insights-list");
    if (!insights.length) {
      el.innerHTML = `<p class="muted">No statements yet — upload one to get started, or use the sample data.</p>`;
      return;
    }
    el.innerHTML = insights
      .map(
        (i) => `<div class="insight ${i.severity}">
          <span class="badge">${i.severity}</span>
          <div class="body"><strong>${i.title}</strong>${i.detail}</div>
        </div>`
      )
      .join("");
  }

  function kpiCard(label, value, delta) {
    return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div>${delta ? `<div class="delta ${delta.dir}">${delta.text}</div>` : ""}</div>`;
  }

  function renderKpis(weeks, rollups) {
    const el = document.getElementById("kpi-row");
    if (!weeks.length) {
      el.innerHTML = "";
      return;
    }
    const totalMiles = weeks.reduce((a, w) => a + w.totalMiles, 0);
    const totalGross = weeks.reduce((a, w) => a + w.grossRevenue, 0);
    const totalNet = weeks.reduce((a, w) => a + w.ownerNetPay, 0);
    const totalMaint = weeks.reduce((a, w) => a + w.maintenance, 0);
    const avgRpm = totalMiles ? totalGross / totalMiles : 0;
    const avgNetRpm = totalMiles ? totalNet / totalMiles : 0;
    const last = weeks[weeks.length - 1];
    const prev = weeks[weeks.length - 2];
    const trend = prev ? (last.netRpm >= prev.netRpm ? { dir: "up", text: `▲ vs prior week ($${prev.netRpm.toFixed(2)})` } : { dir: "down", text: `▼ vs prior week ($${prev.netRpm.toFixed(2)})` }) : null;

    el.innerHTML = [
      kpiCard("Weeks tracked", weeks.length),
      kpiCard("Trucks", rollups.length),
      kpiCard("Total miles", fmtNum(totalMiles)),
      kpiCard("Gross revenue", fmtMoney(totalGross)),
      kpiCard("Owner net pay", fmtMoney(totalNet)),
      kpiCard("Avg revenue $/mi", `$${avgRpm.toFixed(2)}`),
      kpiCard("Avg net $/mi", `$${avgNetRpm.toFixed(2)}`, trend),
      kpiCard("Maintenance total", fmtMoney(totalMaint)),
    ].join("");
  }

  function renderCharts(weeks, rollups) {
    // Group by truckUnit (the stable identifier), not truckLabel — the same
    // physical truck can carry different labels across weeks (e.g. renamed
    // from the driver's name to the owner's name), and must stay one series.
    const byTruck = new Map();
    for (const w of weeks) {
      if (!byTruck.has(w.truckUnit)) byTruck.set(w.truckUnit, []);
      byTruck.get(w.truckUnit).push(w);
    }
    // Display each series under its most recent label.
    const displayMap = new Map();
    for (const [unit, wks] of byTruck) {
      displayMap.set(wks[wks.length - 1].truckLabel, wks);
    }
    window.Charts.renderRpmTrend("chart-rpm", displayMap);
    window.Charts.renderCostBreakdown("chart-cost", weeks);
    window.Charts.renderMaintenanceTrend("chart-maint", weeks);
    window.Charts.renderDeadhead("chart-deadhead", weeks);
  }

  function renderTruckTable(rollups) {
    const tbody = document.querySelector("#table-trucks tbody");
    tbody.innerHTML = rollups
      .map(
        (r, i) => `<tr class="${i === 0 ? "rank-1" : i === rollups.length - 1 && rollups.length > 1 ? "rank-last" : ""}">
        <td>${i === 0 ? "🏆 " : ""}${r.truckLabel}</td>
        <td>${r.weekCount}</td>
        <td>${fmtNum(r.totalMiles)}</td>
        <td>${fmtMoney(r.grossRevenue)}</td>
        <td>${fmtMoney(r.netPay)}</td>
        <td>$${r.avgRpm.toFixed(2)}</td>
        <td>$${r.avgNetRpm.toFixed(2)}</td>
        <td>${r.avgDeadheadPct.toFixed(1)}%</td>
        <td>$${r.maintenancePerMile.toFixed(3)}</td>
      </tr>`
      )
      .join("");
  }

  function renderDriverTables(statements, weeks) {
    const dbody = document.querySelector("#table-driver tbody");
    dbody.innerHTML = statements
      .map((s) => {
        const d = s.driverSettlement || {};
        return `<tr><td>${fmtDate(s.periodStart)} – ${fmtDate(s.periodEnd)}</td><td>${s.driver}</td><td>${s.truckLabel}</td><td>${fmtMoney(d.earnings)}</td><td>${fmtMoney(d.advances)}</td><td>${fmtMoney(d.otherPay)}</td><td>${fmtMoney(d.netPay)}</td></tr>`;
      })
      .join("");

    const fbody = document.querySelector("#table-fines tbody");
    const rows = [];
    for (const s of statements) {
      for (const f of (s.driverSettlement && s.driverSettlement.fines) || []) {
        rows.push(`<tr><td>${fmtDate(s.periodStart)}</td><td>${s.driver}</td><td>${f.description}</td><td>${fmtMoney(f.amount)}</td></tr>`);
      }
    }
    fbody.innerHTML = rows.length ? rows.join("") : `<tr><td colspan="4" class="muted">No violations logged.</td></tr>`;
  }

  function renderWeekTable(weeks) {
    const tbody = document.querySelector("#table-weeks tbody");
    tbody.innerHTML = weeks
      .map(
        (w) => `<tr>
        <td>${fmtDate(w.periodStart)} – ${fmtDate(w.periodEnd)}</td>
        <td>${w.truckLabel}</td>
        <td>${w.id}${w.conflict ? ' <span class="tag" style="color:var(--bad);border-color:var(--bad)">conflict</span>' : ""}</td>
        <td>${w.trips}</td>
        <td>${fmtNum(w.totalMiles)}</td>
        <td>${w.deadheadPct.toFixed(1)}%</td>
        <td>${fmtMoney(w.grossRevenue)}</td>
        <td>${fmtMoney(w.ownerNetPay)}</td>
        <td>${w.marginPct.toFixed(1)}%</td>
        <td>${fmtMoney(w.maintenance)}</td>
        <td>${w.estMPG ? w.estMPG.toFixed(1) + " (est.)" : "—"}</td>
      </tr>`
      )
      .join("");
  }

  // ---- Tabs ----
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add("active");
    });
  });

  // ---- Theme toggle ----
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const cur = root.getAttribute("data-theme");
    root.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
    refresh();
  });

  // ---- Reset / clear ----
  document.getElementById("btn-reset").addEventListener("click", () => {
    if (confirm("Replace current data with the 5 sample statements?")) {
      window.Store.resetToSample();
      refresh();
    }
  });
  document.getElementById("btn-clear").addEventListener("click", () => {
    if (confirm("Delete all stored statements from this browser?")) {
      window.Store.clearAll();
      refresh();
    }
  });
  document.getElementById("diesel-price").addEventListener("change", refresh);

  // ---- Upload modal ----
  const uploadModal = document.getElementById("upload-modal");
  document.getElementById("btn-upload").addEventListener("click", () => uploadModal.classList.remove("hidden"));
  document.getElementById("btn-close-upload").addEventListener("click", () => uploadModal.classList.add("hidden"));

  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  dropzone.addEventListener("click", () => fileInput.click());
  ["dragenter", "dragover"].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); }));
  dropzone.addEventListener("drop", (e) => handleFiles(Array.from(e.dataTransfer.files)));
  fileInput.addEventListener("change", (e) => handleFiles(Array.from(e.target.files)));

  async function handleFiles(files) {
    const pdfFiles = files.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfFiles.length) return;
    if (!window.pdfjsLib) {
      alert("PDF engine is still loading — please try again in a moment.");
      return;
    }
    pendingFiles = [];
    const progress = document.getElementById("upload-progress");
    for (const file of pdfFiles) {
      progress.textContent = `Parsing ${file.name}…`;
      try {
        const lines = await pdfToLines(file);
        const { statement, warnings } = parseStatement(lines, file.name);
        pendingFiles.push({ statement, warnings, file });
      } catch (err) {
        console.error(err);
        pendingFiles.push({ statement: null, warnings: [`Failed to read this PDF: ${err.message}`], file });
      }
    }
    progress.textContent = `Parsed ${pendingFiles.length} file(s). Review each below.`;
    pendingIndex = 0;
    uploadModal.classList.add("hidden");
    showReview();
  }

  const reviewModal = document.getElementById("review-modal");
  function showReview() {
    if (pendingIndex >= pendingFiles.length) {
      reviewModal.classList.add("hidden");
      refresh();
      return;
    }
    const { statement, warnings, file } = pendingFiles[pendingIndex];
    document.getElementById("review-warnings").innerHTML = warnings.length
      ? `<div class="warn-list"><strong>${file.name}</strong> — please check:<ul>${warnings.map((w) => `<li>${w}</li>`).join("")}</ul></div>`
      : `<div class="warn-list" style="background:var(--info-bg);border-color:var(--info-border);color:var(--info-text)"><strong>${file.name}</strong> parsed cleanly. Please confirm the key fields below.</div>`;

    const s = statement || {};
    const fields = document.getElementById("review-fields");
    fields.innerHTML = `
      ${row("Statement ID", "f-id", s.id)}
      ${row("Truck unit", "f-truck", s.truckLabel)}
      ${row("Driver", "f-driver", s.driver)}
      ${row("Period start", "f-start", s.periodStart, "date")}
      ${row("Period end", "f-end", s.periodEnd, "date")}
      ${row("Trips", "f-trips", s.trips, "number")}
      ${row("Gross revenue ($)", "f-gross", s.totalGross ?? sumLoads(s), "number")}
      ${row("Owner net pay ($)", "f-net", s.ownerNetPay, "number")}
      ${row("Maintenance total ($)", "f-maint", sumDeduction(s, "Maintenance"), "number")}
      ${row("Total miles", "f-miles", sumMiles(s), "number")}
      ${row("Fuel balance ($, optional)", "f-fuel", s.fuelBalance, "number")}
    `;
    reviewModal.classList.remove("hidden");
  }

  function row(label, id, value, type = "text") {
    return `<div class="field-row"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${value ?? ""}" /></div>`;
  }
  function sumLoads(s) { return (s.loads || []).reduce((a, l) => a + (l.gross || 0), 0) || null; }
  function sumMiles(s) { return (s.loads || []).reduce((a, l) => a + (l.totalMiles || 0), 0) || null; }
  function sumDeduction(s, type) { return (s.deductions || []).filter((d) => d.type === type).reduce((a, d) => a + d.amount, 0); }

  document.getElementById("btn-skip-review").addEventListener("click", () => {
    pendingIndex++;
    showReview();
  });

  document.getElementById("btn-confirm-review").addEventListener("click", () => {
    const { statement, file } = pendingFiles[pendingIndex];
    const val = (id) => document.getElementById(id).value;
    const truckLabelRaw = val("f-truck") || "Unknown";
    const truckUnit = (truckLabelRaw.match(/\d+/) || [truckLabelRaw])[0];
    const finalStatement = Object.assign({}, statement, {
      id: val("f-id") || `MANUAL-${Date.now()}`,
      truckUnit,
      truckLabel: truckLabelRaw,
      driver: val("f-driver") || "Unknown driver",
      periodStart: val("f-start"),
      periodEnd: val("f-end"),
      trips: parseInt(val("f-trips"), 10) || (statement.loads || []).length || 1,
      ownerNetPay: parseFloat(val("f-net")) || 0,
      fuelBalance: val("f-fuel") ? parseFloat(val("f-fuel")) : null,
      loads: (statement.loads && statement.loads.length) ? statement.loads : [
        { loadNumber: "MANUAL", pu: "—", del: "—", totalMiles: parseFloat(val("f-miles")) || 0, loadedMiles: parseFloat(val("f-miles")) || 0, emptyMiles: 0, gross: parseFloat(val("f-gross")) || 0, driverPayment: 0 },
      ],
      deductions: (statement.deductions && statement.deductions.length) ? statement.deductions : [
        { type: "Maintenance", amount: parseFloat(val("f-maint")) || 0 },
      ],
      driverSettlement: statement.driverSettlement || { earnings: 0, advances: 0, reimbursements: 0, deductions: 0, otherPay: 0, netPay: 0, fines: [] },
      sourceFile: file.name,
    });
    window.Store.addStatement(finalStatement);
    pendingIndex++;
    showReview();
  });

  // ---- Init ----
  refresh();
})();
