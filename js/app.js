(function () {
  const fmtMoney = (v) => {
    if (v === null || v === undefined || isNaN(v)) return "—";
    const sign = v < 0 ? "-" : "";
    return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const fmtNum = (v, d = 0) => (v === null || v === undefined || isNaN(v) ? "—" : v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
  const fmtDate = (s) => (s ? new Date(s + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }) : "—");
  const fmtPerMile = (v) => (v === null || v === undefined || isNaN(v) ? "—" : `$${v.toFixed(3)}`);

  function showToast(msg) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function refresh() {
    window.Metrics.setDieselPrice(parseFloat(document.getElementById("diesel-price").value));
    const raw = window.Store.loadStatements();
    const { statements, conflicts } = window.Metrics.dedupeStatements(raw);
    const weeks = statements.map((s) => window.Metrics.computeWeekMetrics(s)).sort((a, b) => new Date(a.periodStart) - new Date(b.periodStart));
    const rollups = window.Metrics.rollupByTruck(weeks);
    const insights = window.Metrics.generateInsights(weeks, conflicts);

    const fixedCosts = window.Store.loadFixedCosts();
    const breakevens = new Map(rollups.map((r) => [r.truckUnit, window.Metrics.computeBreakeven(r, fixedCosts[r.truckUnit])]));
    for (const r of rollups) {
      const b = breakevens.get(r.truckUnit);
      if (b.hasFixedCosts && b.marginPerMile < 0) {
        insights.unshift({
          severity: "critical",
          title: `Truck ${r.truckLabel} is running below breakeven`,
          detail: `Once its $${b.weeklyFixed.toFixed(0)}/week fixed costs (truck payment, permits, etc.) and fuel are counted, it needs $${b.breakevenRpm.toFixed(2)}/mi just to break even — it's averaging $${r.avgRpm.toFixed(2)}/mi, about $${Math.abs(b.weeklyMarginDollars).toFixed(0)}/week underwater. See Fixed Costs & Breakeven on the Truck Comparison tab.`,
        });
      }
    }

    renderInsights(insights);
    renderKpis(weeks, rollups);
    renderCharts(weeks, rollups);
    renderTruckTable(rollups);
    renderFixedCostsTable(rollups, fixedCosts, breakevens);
    renderDriverTables(statements, weeks);
    renderWeekTable(raw, weeks);
  }

  function renderInsights(insights) {
    const el = document.getElementById("insights-list");
    if (!insights.length) {
      el.innerHTML = `<p class="muted">No statements yet — upload one, add a week manually, or use the sample data.</p>`;
      return;
    }
    el.innerHTML = insights
      .map((i) => `<div class="insight ${i.severity}"><span class="badge">${i.severity}</span><div class="body"><strong>${i.title}</strong>${i.detail}</div></div>`)
      .join("");
  }

  function kpiCard(label, value, delta, opts = {}) {
    return `<div class="kpi${opts.hero ? " hero" : ""}"><div class="label">${label}</div><div class="value">${value}</div>${opts.sub ? `<div class="sub">${opts.sub}</div>` : ""}${delta ? `<div class="delta ${delta.dir}">${delta.text}</div>` : ""}</div>`;
  }

  function renderKpis(weeks, rollups) {
    const el = document.getElementById("kpi-row");
    if (!weeks.length) { el.innerHTML = ""; return; }
    const totalMiles = weeks.reduce((a, w) => a + w.totalMiles, 0);
    const totalGross = weeks.reduce((a, w) => a + w.grossRevenue, 0);
    const totalNet = weeks.reduce((a, w) => a + w.ownerNetPay, 0);
    const totalTrueNet = weeks.reduce((a, w) => a + w.trueNetPay, 0);
    const totalDed = weeks.reduce((a, w) => a + w.totalDeductions, 0);
    const totalMaint = weeks.reduce((a, w) => a + w.maintenance, 0);
    const fuelWeeks = weeks.filter((w) => w.hasFuelData);
    const totalFuelCost = fuelWeeks.reduce((a, w) => a + (w.fuelCost || 0), 0);
    const totalGallons = fuelWeeks.reduce((a, w) => a + (w.fuelGallons || 0), 0);
    const avgRpm = totalMiles ? totalGross / totalMiles : 0;
    const avgCpm = totalMiles ? totalDed / totalMiles : 0;
    const avgTrueNetRpm = totalMiles ? totalTrueNet / totalMiles : 0;
    const avgMpg = totalGallons > 0 ? totalMiles / totalGallons : null;
    const last = weeks[weeks.length - 1];
    const prev = weeks[weeks.length - 2];
    const trend = prev ? (last.trueNetRpm >= prev.trueNetRpm ? { dir: "up", text: `▲ vs prior week ($${prev.trueNetRpm.toFixed(2)}/mi)` } : { dir: "down", text: `▼ vs prior week ($${prev.trueNetRpm.toFixed(2)}/mi)` }) : null;

    el.innerHTML = [
      kpiCard("True Profit (after fuel)", fmtMoney(totalTrueNet), trend, { hero: true, sub: `$${avgTrueNetRpm.toFixed(2)}/mi · carrier reported ${fmtMoney(totalNet)} before fuel` }),
      kpiCard("Weeks tracked", weeks.length),
      kpiCard("Trucks", rollups.length),
      kpiCard("Total miles", fmtNum(totalMiles)),
      kpiCard("Gross revenue", fmtMoney(totalGross)),
      kpiCard("Avg RPM (revenue/mi)", `$${avgRpm.toFixed(2)}`),
      kpiCard("Avg CPM (cost/mi, excl. fuel)", `$${avgCpm.toFixed(2)}`),
      kpiCard("Maintenance total", fmtMoney(totalMaint)),
      kpiCard("Fuel cost tracked", fuelWeeks.length ? fmtMoney(totalFuelCost) : "No data"),
      kpiCard("Fleet MPG", avgMpg ? `${avgMpg.toFixed(1)}${fuelWeeks.some((w) => w.mpgIsEstimate) ? " (est.)" : ""}` : "No data"),
    ].join("");
  }

  function renderCharts(weeks, rollups) {
    const byTruck = new Map();
    for (const w of weeks) {
      if (!byTruck.has(w.truckUnit)) byTruck.set(w.truckUnit, []);
      byTruck.get(w.truckUnit).push(w);
    }
    const displayMap = new Map();
    for (const [, wks] of byTruck) displayMap.set(wks[wks.length - 1].truckLabel, wks);
    window.Charts.renderRpmTrend("chart-rpm", displayMap);
    window.Charts.renderCostBreakdown("chart-cost", weeks);
    window.Charts.renderCpmVsRpm("chart-cpm-rpm", weeks);
    window.Charts.renderMaintenanceTrend("chart-maint", weeks);
    window.Charts.renderDeadhead("chart-deadhead", weeks);
    window.Charts.renderFuelTrend("chart-fuel", weeks);
  }

  function renderTruckTable(rollups) {
    const tbody = document.querySelector("#table-trucks tbody");
    tbody.innerHTML = rollups
      .map((r, i) => `<tr class="${i === 0 ? "rank-1" : i === rollups.length - 1 && rollups.length > 1 ? "rank-last" : ""}">
        <td>${i === 0 ? "🏆 " : ""}${r.truckLabel}</td>
        <td>${r.weekCount}</td>
        <td>${fmtNum(r.totalMiles)}</td>
        <td>${fmtMoney(r.grossRevenue)}</td>
        <td>${fmtMoney(r.netPay)}</td>
        <td><strong>${fmtMoney(r.trueNetPay)}</strong></td>
        <td>${fmtPerMile(r.avgRpm)}</td>
        <td>${fmtPerMile(r.avgCpm)}</td>
        <td>${fmtPerMile(r.avgAllInCpm)}</td>
        <td><strong>${fmtPerMile(r.avgTrueNetRpm)}</strong></td>
        <td>${r.avgDeadheadPct.toFixed(1)}%</td>
        <td>${fmtPerMile(r.maintenancePerMile)}</td>
        <td>${r.hasAnyFuelData ? fmtPerMile(r.fuelPerMile) : "—"}</td>
        <td>${r.avgMpg ? r.avgMpg.toFixed(1) + (r.mpgIsEstimate ? " (est.)" : "") : "—"}</td>
      </tr>`)
      .join("");
  }

  function renderFixedCostsTable(rollups, fixedCosts, breakevens) {
    const fields = window.Metrics.FIXED_COST_FIELDS;
    const headerRow = document.getElementById("fixed-costs-header");
    headerRow.innerHTML = `<th>Truck</th>${fields.map((f) => `<th>${f.label}</th>`).join("")}<th>Weekly Fixed $</th><th>Fixed $/mi</th><th>Breakeven RPM</th><th>Actual RPM</th><th>Margin/mi</th>`;

    const tbody = document.querySelector("#table-fixed-costs tbody");
    tbody.innerHTML = rollups
      .map((r) => {
        const costs = fixedCosts[r.truckUnit] || {};
        const b = breakevens.get(r.truckUnit);
        const marginClass = !b.hasFixedCosts ? "" : b.marginPerMile >= 0 ? 'style="color:var(--good)"' : 'style="color:var(--bad);font-weight:700"';
        return `<tr data-truck="${r.truckUnit}">
          <td>${r.truckLabel}</td>
          ${fields.map((f) => `<td><input type="number" step="1" min="0" class="fc-input" data-field="${f.key}" value="${costs[f.key] || ""}" placeholder="0" style="width:90px" /></td>`).join("")}
          <td>${fmtMoney(b.weeklyFixed)}</td>
          <td>${fmtPerMile(b.fixedPerMile)}</td>
          <td>${fmtPerMile(b.breakevenRpm)}</td>
          <td>${fmtPerMile(r.avgRpm)}</td>
          <td ${marginClass}>${b.hasFixedCosts ? fmtPerMile(b.marginPerMile) : "enter costs →"}</td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".fc-input").forEach((input) => {
      input.addEventListener("change", () => {
        const truckUnit = input.closest("tr").dataset.truck;
        const costs = Object.assign({}, window.Store.loadFixedCosts()[truckUnit]);
        costs[input.dataset.field] = parseFloat(input.value) || 0;
        window.Store.saveFixedCostsForTruck(truckUnit, costs);
        showToast("Fixed costs saved.");
        // Deferred: rebuilding this table's innerHTML synchronously inside
        // its own input's change handler races the browser's blur/change
        // dispatch on that same input and throws. Let this tick finish first.
        setTimeout(refresh, 0);
      });
    });
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

  function renderWeekTable(rawStatements, weeks) {
    const byRecordId = new Map(rawStatements.map((s) => [s.recordId, s]));
    const tbody = document.querySelector("#table-weeks tbody");
    tbody.innerHTML = weeks
      .map((w) => `<tr>
        <td class="sticky-col row-actions">
          <button class="ghost small" data-action="edit" data-id="${w.recordId}">Edit</button>
          <button class="ghost small" data-action="duplicate" data-id="${w.recordId}" title="Start next week's entry from this one">Duplicate</button>
          <button class="ghost small danger" data-action="delete" data-id="${w.recordId}">Delete</button>
        </td>
        <td>${fmtDate(w.periodStart)} – ${fmtDate(w.periodEnd)}</td>
        <td>${w.truckLabel}</td>
        <td>${w.id}${w.conflict ? ' <span class="tag" style="color:var(--bad);border-color:var(--bad)">conflict</span>' : ""}</td>
        <td>${w.trips}</td>
        <td>${fmtNum(w.totalMiles)}</td>
        <td>${w.deadheadPct.toFixed(1)}%</td>
        <td>${fmtMoney(w.grossRevenue)}</td>
        <td>${fmtPerMile(w.rpm)}</td>
        <td>${fmtPerMile(w.cpm)}</td>
        <td>${fmtMoney(w.ownerNetPay)}</td>
        <td><strong>${fmtMoney(w.trueNetPay)}</strong></td>
        <td><strong>${fmtPerMile(w.trueNetRpm)}</strong></td>
        <td>${w.marginPct.toFixed(1)}%</td>
        <td>${fmtMoney(w.maintenance)}</td>
        <td>${w.hasFuelData ? fmtMoney(w.fuelCost) : '<span class="tag" style="color:var(--bad);border-color:var(--bad)">missing</span>'}</td>
        <td>${w.mpg ? w.mpg.toFixed(1) + (w.mpgIsEstimate ? " (est.)" : "") : "—"}</td>
        <td>${w.notes ? `<span title="${w.notes.replace(/"/g, "&quot;")}">📝 ${w.notes.length > 24 ? w.notes.slice(0, 24) + "…" : w.notes}</span>` : '<span class="muted">—</span>'}</td>
      </tr>`)
      .join("");

    tbody.querySelectorAll("button[data-action='edit']").forEach((btn) => {
      btn.addEventListener("click", () => openEditModal(byRecordId.get(btn.dataset.id)));
    });
    tbody.querySelectorAll("button[data-action='duplicate']").forEach((btn) => {
      btn.addEventListener("click", () => openDuplicateModal(byRecordId.get(btn.dataset.id)));
    });
    tbody.querySelectorAll("button[data-action='delete']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = byRecordId.get(btn.dataset.id);
        if (confirm(`Delete statement ${s.id} (week of ${fmtDate(s.periodStart)})? This can't be undone.`)) {
          window.Store.deleteStatement(btn.dataset.id);
          showToast("Deleted.");
          refresh();
        }
      });
    });
  }

  function addDays(dateStr, days) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function openDuplicateModal(statement) {
    // Carries forward truck/driver and the recurring fixed deductions
    // (company fee %, insurance, trailer, ELD, IFTA) since those repeat
    // most weeks — but blanks out everything that's specific to this
    // week's trip (miles, revenue, net pay, fuel, maintenance) so it's
    // never mistaken for the same week's numbers.
    const next = Object.assign({}, statement, {
      recordId: undefined,
      id: "",
      periodStart: statement.periodEnd ? addDays(statement.periodEnd, 1) : "",
      periodEnd: statement.periodEnd ? addDays(statement.periodEnd, 7) : "",
      trips: 1,
      loadedMiles: null, emptyMiles: null, totalMiles: null,
      grossRevenue: null, ownerNetPay: null,
      fuelCost: null, fuelGallons: null,
      deductionCategories: Object.assign({}, statement.deductionCategories, { maintenance: 0, other: 0 }),
      driverSettlement: { earnings: null, advances: 0, otherPay: 0, netPay: null, fines: [] },
      notes: "",
      sourceFile: "duplicated from " + statement.id,
    });
    openEditModal(next, { isNew: true, sourceLabel: `New week, carried forward from ${statement.id}` });
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

  // ---- Reset / clear / export / import ----
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
  document.getElementById("btn-export").addEventListener("click", () => {
    window.Store.exportJSON();
    showToast("Downloaded backup JSON.");
  });
  document.getElementById("btn-export-csv").addEventListener("click", () => {
    const { statements } = window.Metrics.dedupeStatements(window.Store.loadStatements());
    const weeks = statements.map((s) => window.Metrics.computeWeekMetrics(s)).sort((a, b) => new Date(a.periodStart) - new Date(b.periodStart));
    window.Store.exportCSV(weeks);
    showToast("Downloaded CSV.");
  });
  document.getElementById("btn-import").addEventListener("click", () => document.getElementById("import-file-input").click());
  document.getElementById("import-file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      window.Store.importJSON(text);
      showToast("Imported.");
      refresh();
    } catch (err) {
      alert("Couldn't import that file: " + err.message);
    }
    e.target.value = "";
  });

  // ---- Upload modal (PDF) ----
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

  let pendingFiles = [];
  let pendingIndex = 0;

  async function handleFiles(files) {
    const pdfFiles = files.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfFiles.length) return;
    if (!window.pdfjsLib) { alert("PDF engine is still loading — please try again in a moment."); return; }
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
    showNextPending();
  }

  function showNextPending() {
    if (pendingIndex >= pendingFiles.length) { refresh(); return; }
    const { statement, warnings, file } = pendingFiles[pendingIndex];
    openEditModal(statement, { warnings, sourceLabel: file.name, isNew: true, queued: true, onDone: () => { pendingIndex++; showNextPending(); } });
  }

  // ---- Add week manually ----
  document.getElementById("btn-add-manual").addEventListener("click", () => {
    openEditModal(null, { isNew: true, sourceLabel: "Manual entry" });
  });

  // ---- Edit / Add / Review modal (one shared form) ----
  const editModal = document.getElementById("edit-modal");
  const CATS = [
    { key: "companyFee", label: "Company Fee" },
    { key: "insurance", label: "Insurance" },
    { key: "trailer", label: "Trailer Rental" },
    { key: "maintenance", label: "Maintenance" },
    { key: "eld", label: "ELD" },
    { key: "ifta", label: "IFTA" },
    { key: "escrow", label: "Escrow" },
    { key: "other", label: "Other" },
  ];

  function n(v) { return v === null || v === undefined ? "" : v; }

  function openEditModal(statement, opts = {}) {
    const s = statement || {
      id: "", truckUnit: "", truckLabel: "", driver: "", periodStart: "", periodEnd: "", trips: 1,
      loadedMiles: null, emptyMiles: null, totalMiles: null, grossRevenue: null, ownerNetPay: null,
      fuelCost: null, fuelGallons: null, deductionCategories: {},
      driverSettlement: { earnings: null, advances: 0, otherPay: 0, netPay: null, fines: [] },
    };
    const cats = s.deductionCategories || {};
    const ds = s.driverSettlement || {};

    document.getElementById("edit-modal-title").textContent = opts.isNew ? (statement ? "Review parsed statement" : "Add a week manually") : "Edit statement";
    const warnEl = document.getElementById("review-warnings");
    if (opts.warnings && opts.warnings.length) {
      warnEl.innerHTML = `<div class="warn-list"><strong>${opts.sourceLabel || ""}</strong> — please check:<ul>${opts.warnings.map((w) => `<li>${w}</li>`).join("")}</ul></div>`;
    } else if (opts.sourceLabel) {
      warnEl.innerHTML = `<div class="warn-list" style="background:var(--info-bg);border-color:var(--info-border);color:var(--info-text)"><strong>${opts.sourceLabel}</strong>${statement ? " parsed cleanly. Please confirm the fields below." : ""}</div>`;
    } else {
      warnEl.innerHTML = "";
    }

    document.getElementById("ef-id").value = n(s.id);
    document.getElementById("ef-truck").value = n(s.truckLabel);
    document.getElementById("ef-driver").value = n(s.driver);
    document.getElementById("ef-start").value = n(s.periodStart);
    document.getElementById("ef-end").value = n(s.periodEnd);
    document.getElementById("ef-trips").value = n(s.trips);
    document.getElementById("ef-loaded-miles").value = n(s.loadedMiles);
    document.getElementById("ef-empty-miles").value = n(s.emptyMiles);
    document.getElementById("ef-total-miles").value = n(s.totalMiles);
    document.getElementById("ef-gross").value = n(s.grossRevenue);
    document.getElementById("ef-net").value = n(s.ownerNetPay);
    document.getElementById("ef-fuel-cost").value = n(s.fuelCost);
    document.getElementById("ef-fuel-gallons").value = n(s.fuelGallons);
    for (const c of CATS) {
      document.getElementById(`ef-cat-${c.key}`).value = n(cats[c.key] || 0);
    }
    document.getElementById("ef-driver-earnings").value = n(ds.earnings);
    document.getElementById("ef-driver-advances").value = n(ds.advances);
    document.getElementById("ef-driver-other").value = n(ds.otherPay);
    document.getElementById("ef-driver-net").value = n(ds.netPay);
    document.getElementById("ef-notes").value = s.notes || "";

    editModal.dataset.recordId = statement ? statement.recordId || "" : "";
    editModal.dataset.isNew = opts.isNew ? "1" : "";
    editModal.dataset.existingFines = JSON.stringify(ds.fines || []);
    editModal._onDone = opts.onDone || null;
    document.getElementById("btn-skip-edit").classList.toggle("hidden", !opts.queued);
    editModal.classList.remove("hidden");
  }

  document.getElementById("btn-close-edit").addEventListener("click", () => {
    editModal.classList.add("hidden");
    if (editModal._onDone) editModal._onDone();
  });
  document.getElementById("btn-skip-edit").addEventListener("click", () => {
    editModal.classList.add("hidden");
    if (editModal._onDone) editModal._onDone();
  });

  document.getElementById("btn-save-edit").addEventListener("click", () => {
    const val = (id) => document.getElementById(id).value;
    const numVal = (id) => { const v = val(id); return v === "" ? null : parseFloat(v); };

    const truckLabelRaw = val("ef-truck") || "Unknown";
    const truckUnit = (truckLabelRaw.match(/\d+/) || [truckLabelRaw])[0];
    const loadedMiles = numVal("ef-loaded-miles");
    const emptyMiles = numVal("ef-empty-miles");
    let totalMiles = numVal("ef-total-miles");
    if (totalMiles === null && loadedMiles !== null && emptyMiles !== null) totalMiles = loadedMiles + emptyMiles;

    const deductionCategories = {};
    for (const c of CATS) deductionCategories[c.key] = numVal(`ef-cat-${c.key}`) || 0;

    let fines = [];
    try { fines = JSON.parse(editModal.dataset.existingFines || "[]"); } catch (e) { fines = []; }

    const statement = {
      id: val("ef-id") || `MANUAL-${Date.now()}`,
      truckUnit,
      truckLabel: truckLabelRaw,
      driver: val("ef-driver") || "Unknown driver",
      periodStart: val("ef-start"),
      periodEnd: val("ef-end"),
      trips: parseInt(val("ef-trips"), 10) || 1,
      loadedMiles, emptyMiles, totalMiles,
      grossRevenue: numVal("ef-gross"),
      ownerNetPay: numVal("ef-net"),
      fuelCost: numVal("ef-fuel-cost"),
      fuelGallons: numVal("ef-fuel-gallons"),
      deductionCategories,
      driverSettlement: {
        earnings: numVal("ef-driver-earnings"),
        advances: numVal("ef-driver-advances") || 0,
        reimbursements: 0,
        deductions: 0,
        otherPay: numVal("ef-driver-other") || 0,
        netPay: numVal("ef-driver-net"),
        fines,
      },
      notes: val("ef-notes").trim(),
      sourceFile: editModal.dataset.sourceFile || "manual entry",
    };

    if (!statement.periodStart || !statement.periodEnd) {
      alert("Please set both a period start and end date.");
      return;
    }

    const recordId = editModal.dataset.recordId;
    if (recordId) {
      window.Store.updateStatement(recordId, statement);
      showToast("Saved changes.");
    } else {
      window.Store.addStatement(statement);
      showToast("Week saved.");
    }
    editModal.classList.add("hidden");
    refresh();
    if (editModal._onDone) editModal._onDone();
  });

  // ---- Init ----
  refresh();
})();
