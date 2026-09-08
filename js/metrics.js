// Pure computation layer: statements[] in -> weekly metrics, truck rollups,
// and rule-based insights out. No DOM here so it stays testable/portable.

let dieselPrice = 3.85; // $/gal, editable in the toolbar — used only as a
                         // fallback when real gallons aren't entered.
function setDieselPrice(v) {
  if (v && v > 0) dieselPrice = v;
}

const DEDUCTION_CATS = [
  { key: "companyFee", label: "Company Fee" },
  { key: "insurance", label: "Insurance" },
  { key: "trailer", label: "Trailer Rental" },
  { key: "maintenance", label: "Maintenance" },
  { key: "eld", label: "ELD" },
  { key: "ifta", label: "IFTA" },
  { key: "escrow", label: "Escrow" },
  { key: "other", label: "Other" },
];

function dedupeStatements(statements) {
  // Group by carrier statement ID; if two records disagree, keep the most
  // recently-listed one as authoritative but surface the conflict.
  const byId = new Map();
  const conflicts = [];
  for (const s of statements) {
    if (byId.has(s.id)) {
      const prev = byId.get(s.id);
      if (prev.ownerNetPay !== s.ownerNetPay) {
        conflicts.push({ id: s.id, versions: [prev, s] });
      }
    }
    byId.set(s.id, s); // last one wins
  }
  return { statements: Array.from(byId.values()), conflicts };
}

function num(v) {
  return typeof v === "number" && !isNaN(v) ? v : 0;
}

function computeWeekMetrics(stmt) {
  const cats = stmt.deductionCategories || {};
  const totalDeductions = DEDUCTION_CATS.reduce((a, c) => a + num(cats[c.key]), 0);
  const totalMiles = num(stmt.totalMiles);
  const grossRevenue = num(stmt.grossRevenue);
  const ownerNetPay = num(stmt.ownerNetPay);

  const hasFuelCost = stmt.fuelCost !== null && stmt.fuelCost !== undefined;
  const hasFuelGallons = stmt.fuelGallons !== null && stmt.fuelGallons !== undefined && stmt.fuelGallons > 0;
  let gallons = null;
  let mpgIsEstimate = true;
  if (hasFuelGallons) {
    gallons = stmt.fuelGallons;
    mpgIsEstimate = false;
  } else if (hasFuelCost && stmt.fuelCost > 0) {
    gallons = stmt.fuelCost / dieselPrice;
    mpgIsEstimate = true;
  }
  const mpg = gallons && totalMiles ? totalMiles / gallons : null;
  const fuelCost = hasFuelCost ? stmt.fuelCost : null;
  const fuelPerMile = fuelCost && totalMiles ? fuelCost / totalMiles : null;

  // The carrier's "net pay" almost never has fuel taken out of it yet — fuel
  // is either on a separate card/balance or paid out of pocket. So the
  // number that actually decides whether the week made money is net pay
  // MINUS fuel, not the carrier figure alone. Everything below calls that
  // "true profit"; the carrier number is kept alongside it for reference.
  const trueNetPay = ownerNetPay - (fuelCost || 0);
  const trueNetRpm = totalMiles ? trueNetPay / totalMiles : 0;
  const allInCpm = totalMiles ? (totalDeductions + (fuelCost || 0)) / totalMiles : 0;

  const byCategory = {};
  for (const c of DEDUCTION_CATS) {
    byCategory[c.key] = { label: c.label, total: num(cats[c.key]), perMile: totalMiles ? num(cats[c.key]) / totalMiles : 0 };
  }

  // Sanity check: gross revenue − driver pay − deductions should land on the
  // carrier's reported net pay. A mismatch usually means a typo somewhere
  // (most often the deduction categories not adding up to what the
  // statement's own total said, or gross entered instead of net).
  const driverGross = stmt.driverSettlement && stmt.driverSettlement.earnings !== null && stmt.driverSettlement.earnings !== undefined
    ? stmt.driverSettlement.earnings : null;
  let reconciliationDelta = null;
  if (driverGross !== null && grossRevenue) {
    reconciliationDelta = grossRevenue - driverGross - totalDeductions - ownerNetPay;
  }

  return {
    recordId: stmt.recordId,
    id: stmt.id,
    truckUnit: stmt.truckUnit,
    truckLabel: stmt.truckLabel,
    driver: stmt.driver,
    periodStart: stmt.periodStart,
    periodEnd: stmt.periodEnd,
    trips: stmt.trips,
    totalMiles,
    loadedMiles: num(stmt.loadedMiles),
    emptyMiles: num(stmt.emptyMiles),
    deadheadPct: totalMiles ? (num(stmt.emptyMiles) / totalMiles) * 100 : 0,
    grossRevenue,
    ownerNetPay,
    rpm: totalMiles ? grossRevenue / totalMiles : 0, // revenue per mile
    netRpm: totalMiles ? ownerNetPay / totalMiles : 0, // carrier-reported net per mile (before fuel)
    trueNetPay,
    trueNetRpm, // net per mile after fuel — the number that decides if the week was profitable
    marginPct: grossRevenue ? (ownerNetPay / grossRevenue) * 100 : 0,
    totalDeductions,
    cpm: totalMiles ? totalDeductions / totalMiles : 0, // cost per mile, deductions only (excl. fuel)
    allInCpm, // cost per mile including fuel
    reconciliationDelta,
    byCategory,
    maintenance: num(cats.maintenance),
    maintenancePerMile: totalMiles ? num(cats.maintenance) / totalMiles : 0,
    fuelCost,
    fuelGallons: gallons,
    fuelPerMile,
    mpg,
    mpgIsEstimate,
    hasFuelData: hasFuelCost || hasFuelGallons,
    driverNetPay: stmt.driverSettlement ? stmt.driverSettlement.netPay : null,
    fines: stmt.driverSettlement ? stmt.driverSettlement.fines : [],
    conflict: !!stmt.conflictingVersions,
    notes: stmt.notes || "",
  };
}

function sum(arr, fn) {
  return arr.reduce((a, x) => a + fn(x), 0);
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
    const trueNetPay = sum(wks, (w) => w.trueNetPay);
    const totalDeductions = sum(wks, (w) => w.totalDeductions);
    const maintenance = sum(wks, (w) => w.maintenance);
    const fuelWeeks = wks.filter((w) => w.hasFuelData);
    const fuelCost = sum(fuelWeeks, (w) => w.fuelCost || 0);
    const fuelGallons = sum(fuelWeeks, (w) => w.fuelGallons || 0);
    rollups.push({
      truckUnit: unit,
      truckLabel: wks[wks.length - 1].truckLabel,
      weeks: wks,
      weekCount: wks.length,
      totalMiles,
      grossRevenue,
      netPay,
      trueNetPay,
      totalDeductions,
      maintenance,
      avgRpm: totalMiles ? grossRevenue / totalMiles : 0,
      avgNetRpm: totalMiles ? netPay / totalMiles : 0,
      avgTrueNetRpm: totalMiles ? trueNetPay / totalMiles : 0,
      avgCpm: totalMiles ? totalDeductions / totalMiles : 0,
      avgAllInCpm: totalMiles ? (totalDeductions + fuelCost) / totalMiles : 0,
      avgDeadheadPct: wks.length ? sum(wks, (w) => w.deadheadPct) / wks.length : 0,
      avgMarginPct: wks.length ? sum(wks, (w) => w.marginPct) / wks.length : 0,
      maintenancePerMile: totalMiles ? maintenance / totalMiles : 0,
      fuelPerMile: fuelWeeks.length && totalMiles ? fuelCost / totalMiles : null,
      avgMpg: fuelGallons > 0 ? sum(fuelWeeks, (w) => w.totalMiles) / fuelGallons : null,
      mpgIsEstimate: fuelWeeks.some((w) => w.mpgIsEstimate),
      hasAnyFuelData: fuelWeeks.length > 0,
    });
  }
  // Rank by true profit per mile (after fuel) — that's the number that
  // actually answers "which truck is outperforming," not the carrier's
  // pre-fuel net pay, which looks the same for a thirsty truck and a
  // fuel-efficient one until fuel is factored in.
  rollups.sort((a, b) => b.avgTrueNetRpm - a.avgTrueNetRpm);
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

  // Numbers that don't add up — usually a typo in one of the deduction
  // fields, or gross entered where net was meant (only checked when driver
  // earnings is filled in, since that's required to do the arithmetic).
  for (const w of sorted) {
    if (w.reconciliationDelta !== null && Math.abs(w.reconciliationDelta) > 1) {
      insights.push({
        severity: "critical",
        title: `Numbers don't add up — Truck ${w.truckLabel}, week of ${w.periodStart}`,
        detail: `Gross − driver pay − deductions should equal net pay, but it's off by $${Math.abs(w.reconciliationDelta).toFixed(2)}. Double-check the deduction amounts and driver earnings on this week's Edit form.`,
      });
    }
  }

  // The single most-requested number: what a truck actually made once fuel
  // (which the carrier never deducts) comes out too.
  const fuelTrackedWeeks = sorted.filter((w) => w.hasFuelData && w.fuelCost > 0);
  if (fuelTrackedWeeks.length) {
    const totalCarrierNet = sum(fuelTrackedWeeks, (w) => w.ownerNetPay);
    const totalTrueNet = sum(fuelTrackedWeeks, (w) => w.trueNetPay);
    const totalFuel = sum(fuelTrackedWeeks, (w) => w.fuelCost);
    insights.push({
      severity: "info",
      title: "Fuel isn't in the carrier's net pay",
      detail: `Across the ${fuelTrackedWeeks.length} week(s) with fuel entered, the carrier reported $${totalCarrierNet.toFixed(2)} net, but true profit after $${totalFuel.toFixed(2)} in fuel was $${totalTrueNet.toFixed(2)}. The dashboard now ranks and reports on true profit, not the carrier figure, wherever the two could be confused.`,
    });
  }

  // Missing fuel data — actionable, since it's now directly editable
  const missingFuelWeeks = sorted.filter((w) => !w.hasFuelData);
  if (missingFuelWeeks.length) {
    insights.push({
      severity: "warning",
      title: `Fuel data missing for ${missingFuelWeeks.length} week(s)`,
      detail: `${missingFuelWeeks.map((w) => w.periodStart).join(", ")} — click Edit on those rows in Weekly Data and enter fuel cost (and gallons, if you have them) to get accurate MPG and fuel $/mile instead of a diesel-price estimate.`,
    });
  } else if (sorted.some((w) => w.mpgIsEstimate)) {
    insights.push({
      severity: "info",
      title: "MPG is estimated for some weeks",
      detail: "Fuel cost is entered but gallons aren't, so MPG is estimated from the diesel price setting. Enter actual gallons per week (from a fuel receipt or card statement) for exact MPG.",
    });
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

  // Trend: declining net RPM 3 weeks in a row (per truck)
  const byTruck = new Map();
  for (const w of sorted) {
    if (!byTruck.has(w.truckUnit)) byTruck.set(w.truckUnit, []);
    byTruck.get(w.truckUnit).push(w);
  }
  for (const [, wks] of byTruck) {
    for (let i = 2; i < wks.length; i++) {
      if (wks[i].trueNetRpm < wks[i - 1].trueNetRpm && wks[i - 1].trueNetRpm < wks[i - 2].trueNetRpm) {
        insights.push({
          severity: "warning",
          title: `3-week declining trend — Truck ${wks[i].truckLabel}`,
          detail: `True profit/mile has fallen for 3 straight weeks ($${wks[i - 2].trueNetRpm.toFixed(2)} → $${wks[i - 1].trueNetRpm.toFixed(2)} → $${wks[i].trueNetRpm.toFixed(2)}). Worth checking lanes, deadhead, fuel, and recent deductions together.`,
        });
      }
    }
  }

  const severityRank = { critical: 0, warning: 1, info: 2 };
  insights.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  return insights;
}

const FIXED_COST_FIELDS = [
  { key: "truckPayment", label: "Truck Payment / Lease" },
  { key: "physicalDamageIns", label: "Physical Damage Insurance" },
  { key: "permits", label: "Permits & Plates" },
  { key: "eldHardware", label: "ELD Hardware (amortized)" },
  { key: "parkingTolls", label: "Parking / Tolls (avg)" },
  { key: "other", label: "Other Fixed Costs" },
];

// Fixed costs never show up on a carrier settlement, so RPM/CPM alone can
// say a truck is "profitable" when it isn't once the truck payment and
// other overhead are counted. `monthlyCosts` is a {key: $} map keyed by
// FIXED_COST_FIELDS above; everything converts to a weekly and per-mile
// figure using the truck's own average weekly mileage.
function computeBreakeven(rollup, monthlyCosts) {
  const monthlyTotal = FIXED_COST_FIELDS.reduce((a, f) => a + num(monthlyCosts && monthlyCosts[f.key]), 0);
  const weeklyFixed = (monthlyTotal * 12) / 52; // avoids the 4.33-weeks/month approximation drifting over a year
  const avgWeeklyMiles = rollup.weekCount ? rollup.totalMiles / rollup.weekCount : 0;
  const fixedPerMile = avgWeeklyMiles ? weeklyFixed / avgWeeklyMiles : 0;
  const fuelPerMile = rollup.hasAnyFuelData ? rollup.fuelPerMile || 0 : 0;
  const breakevenRpm = rollup.avgCpm + fuelPerMile + fixedPerMile;
  const marginPerMile = rollup.avgRpm - breakevenRpm;
  return {
    monthlyTotal,
    weeklyFixed,
    fixedPerMile,
    breakevenRpm,
    marginPerMile,
    weeklyMarginDollars: marginPerMile * avgWeeklyMiles,
    hasFixedCosts: monthlyTotal > 0,
    fuelAssumedZero: !rollup.hasAnyFuelData,
  };
}

window.Metrics = { dedupeStatements, computeWeekMetrics, rollupByTruck, generateInsights, setDieselPrice, computeBreakeven, DEDUCTION_CATS, FIXED_COST_FIELDS };
