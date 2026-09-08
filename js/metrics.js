// Pure computation layer: statements[] in -> weekly metrics, truck rollups,
// and rule-based insights out. No DOM here so it stays testable/portable.

let dieselPrice = 3.85; // $/gal, editable in Settings — used only when
                         // real gallons data isn't available.
function setDieselPrice(v) {
  if (v && v > 0) dieselPrice = v;
}

function dedupeStatements(statements) {
  // Group by statement ID; if multiple versions disagree, keep the most
  // recently-listed one as authoritative but surface the conflict.
  const byId = new Map();
  const conflicts = [];
  for (const s of statements) {
    if (byId.has(s.id)) {
      const prev = byId.get(s.id);
      if (JSON.stringify(prev.ownerNetPay) !== JSON.stringify(s.ownerNetPay)) {
        conflicts.push({ id: s.id, versions: [prev, s] });
      }
    }
    byId.set(s.id, s); // last one wins
  }
  return { statements: Array.from(byId.values()), conflicts };
}

function sum(arr, fn) {
  return arr.reduce((a, x) => a + fn(x), 0);
}

function deductionTotal(stmt, type) {
  return sum(stmt.deductions.filter((d) => d.type === type), (d) => d.amount);
}

function computeWeekMetrics(stmt) {
  const totalMiles = sum(stmt.loads, (l) => l.totalMiles);
  const loadedMiles = sum(stmt.loads, (l) => l.loadedMiles);
  const emptyMiles = sum(stmt.loads, (l) => l.emptyMiles);
  const grossRevenue = sum(stmt.loads, (l) => l.gross);
  const maintenance = deductionTotal(stmt, "Maintenance");
  const insurance = deductionTotal(stmt, "Insurance");
  const trailer = deductionTotal(stmt, "Trailer Rental");
  const ifta = deductionTotal(stmt, "Ifta");
  const eld = deductionTotal(stmt, "Eld Logbook");
  const companyFee = deductionTotal(stmt, "Company Fee");
  const escrow = deductionTotal(stmt, "Escrow");
  const totalDeductions = sum(stmt.deductions, (d) => d.amount);

  const estGallons = stmt.fuelBalance ? stmt.fuelBalance / dieselPrice : null;
  const estMPG = estGallons && totalMiles ? totalMiles / estGallons : null;

  return {
    id: stmt.id,
    truckUnit: stmt.truckUnit,
    truckLabel: stmt.truckLabel,
    driver: stmt.driver,
    periodStart: stmt.periodStart,
    periodEnd: stmt.periodEnd,
    trips: stmt.trips,
    totalMiles,
    loadedMiles,
    emptyMiles,
    deadheadPct: totalMiles ? (emptyMiles / totalMiles) * 100 : 0,
    grossRevenue,
    ownerNetPay: stmt.ownerNetPay,
    rpm: totalMiles ? grossRevenue / totalMiles : 0,
    loadedRpm: loadedMiles ? grossRevenue / loadedMiles : 0,
    netRpm: totalMiles ? stmt.ownerNetPay / totalMiles : 0,
    marginPct: grossRevenue ? (stmt.ownerNetPay / grossRevenue) * 100 : 0,
    maintenance,
    insurance,
    trailer,
    ifta,
    eld,
    companyFee,
    escrow,
    totalDeductions,
    costPerMile: totalMiles ? totalDeductions / totalMiles : 0,
    maintenancePerMile: totalMiles ? maintenance / totalMiles : 0,
    fuelBalance: stmt.fuelBalance,
    estGallons,
    estMPG,
    driverNetPay: stmt.driverSettlement ? stmt.driverSettlement.netPay : null,
    fines: stmt.driverSettlement ? stmt.driverSettlement.fines : [],
    conflict: !!stmt.conflictingVersions,
  };
}

function rollupByTruck(weeks) {
  const trucks = new Map();
  for (const w of weeks) {
    if (!trucks.has(w.truckUnit)) trucks.set(w.truckUnit, []);
    trucks.get(w.truckUnit).push(w);
  }
  const rollups = [];
  for (const [unit, wks] of trucks) {
    wks.sort((a, b) => new Date(a.periodStart) - new Date(b.periodStart));
    const totalMiles = sum(wks, (w) => w.totalMiles);
    const grossRevenue = sum(wks, (w) => w.grossRevenue);
    const netPay = sum(wks, (w) => w.ownerNetPay);
    const maintenance = sum(wks, (w) => w.maintenance);
    rollups.push({
      truckUnit: unit,
      truckLabel: wks[wks.length - 1].truckLabel,
      weeks: wks,
      weekCount: wks.length,
      totalMiles,
      grossRevenue,
      netPay,
      maintenance,
      avgRpm: totalMiles ? grossRevenue / totalMiles : 0,
      avgNetRpm: totalMiles ? netPay / totalMiles : 0,
      avgDeadheadPct: wks.length ? sum(wks, (w) => w.deadheadPct) / wks.length : 0,
      avgMarginPct: wks.length ? sum(wks, (w) => w.marginPct) / wks.length : 0,
      maintenancePerMile: totalMiles ? maintenance / totalMiles : 0,
    });
  }
  rollups.sort((a, b) => b.avgNetRpm - a.avgNetRpm);
  return rollups;
}

function generateInsights(weeks, conflicts) {
  const insights = [];
  const sorted = [...weeks].sort((a, b) => new Date(a.periodStart) - new Date(b.periodStart));

  for (const c of conflicts) {
    insights.push({
      severity: "critical",
      title: `Conflicting statements for ${c.id}`,
      detail: `Two uploaded versions of ${c.id} disagree on net pay ($${c.versions[0].ownerNetPay.toFixed(2)} vs $${c.versions[1].ownerNetPay.toFixed(2)}). Confirm with the carrier which is correct before trusting totals for this week.`,
    });
  }

  // Maintenance spikes vs trailing average
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i];
    const trailing = sorted.slice(Math.max(0, i - 4), i);
    if (trailing.length >= 1) {
      const avg = sum(trailing, (t) => t.maintenance) / trailing.length;
      if (avg > 0 && w.maintenance > avg * 2) {
        insights.push({
          severity: "info",
          title: `Maintenance spike — Truck ${w.truckLabel}, week of ${w.periodStart}`,
          detail: `$${w.maintenance.toFixed(2)} in maintenance vs a trailing average of $${avg.toFixed(2)}. This looks like a one-time capital repair, not an ongoing trend — worth excluding from run-rate comparisons.`,
        });
      } else if (w.maintenance > 0 && trailing.length === 0) {
        insights.push({
          severity: "info",
          title: `Maintenance spend — Truck ${w.truckLabel}, week of ${w.periodStart}`,
          detail: `$${w.maintenance.toFixed(2)} spent on maintenance this week, dropping net RPM to $${w.netRpm.toFixed(2)}/mi vs a fleet-wide average of $${(sum(sorted, (s) => s.netRpm) / sorted.length).toFixed(2)}/mi.`,
        });
      }
    }
  }

  // Deadhead
  for (const w of sorted) {
    if (w.deadheadPct > 15) {
      insights.push({
        severity: "warning",
        title: `High deadhead — Truck ${w.truckLabel}, week of ${w.periodStart}`,
        detail: `${w.deadheadPct.toFixed(1)}% of miles were empty (${w.emptyMiles.toFixed(0)} of ${w.totalMiles.toFixed(0)} mi). Worth a look at lane planning or asking dispatch about the empty legs.`,
      });
    }
  }

  // Fines/violations
  for (const w of sorted) {
    for (const f of w.fines || []) {
      insights.push({
        severity: "warning",
        title: `Driver violation — ${w.driver}`,
        detail: `${f.description}, $${f.amount.toFixed(2)} deducted from driver pay the week of ${w.periodStart}. Doesn't affect owner P&L directly but logged for compliance tracking (CSA score, future insurance risk).`,
      });
    }
  }

  // Unit label changed mid-stream (e.g. relabeled from driver to owner name)
  const labelsByUnit = new Map();
  for (const w of sorted) {
    if (!labelsByUnit.has(w.truckUnit)) labelsByUnit.set(w.truckUnit, new Set());
    labelsByUnit.get(w.truckUnit).add(w.truckLabel);
  }
  for (const [unit, labels] of labelsByUnit) {
    if (labels.size > 1) {
      insights.push({
        severity: "info",
        title: `Truck ${unit} relabeled mid-history`,
        detail: `Seen as ${Array.from(labels).map((l) => `"${l}"`).join(" and ")} across statements — treated as the same physical truck (unit ${unit}) so its trend isn't split in two.`,
      });
    }
  }

  // Missing fuel data
  const anyFuel = sorted.some((w) => w.fuelBalance);
  if (!anyFuel || sorted.some((w) => !w.fuelBalance)) {
    insights.push({
      severity: "info",
      title: "Fuel gallons data not available",
      detail: "Statements show only a lump-sum fuel dollar balance (or nothing) — no gallons, price/gallon, or odometer. MPG shown elsewhere is an estimate only. Connect a fuel card export (EFS/Comdata/WEX/RTS) or your IFTA quarterly report to get real MPG.",
    });
  }

  // Trend: declining net RPM 3 weeks in a row (per truck)
  const byTruck = new Map();
  for (const w of sorted) {
    if (!byTruck.has(w.truckUnit)) byTruck.set(w.truckUnit, []);
    byTruck.get(w.truckUnit).push(w);
  }
  for (const [, wks] of byTruck) {
    for (let i = 2; i < wks.length; i++) {
      if (wks[i].netRpm < wks[i - 1].netRpm && wks[i - 1].netRpm < wks[i - 2].netRpm) {
        insights.push({
          severity: "warning",
          title: `3-week declining trend — Truck ${wks[i].truckLabel}`,
          detail: `Net RPM has fallen for 3 straight weeks ($${wks[i - 2].netRpm.toFixed(2)} → $${wks[i - 1].netRpm.toFixed(2)} → $${wks[i].netRpm.toFixed(2)}). Worth checking lanes, deadhead, and recent deductions together.`,
        });
      }
    }
  }

  const severityRank = { critical: 0, warning: 1, info: 2 };
  insights.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  return insights;
}

window.Metrics = { dedupeStatements, computeWeekMetrics, rollupByTruck, generateInsights, setDieselPrice };
