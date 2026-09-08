// Best-effort parser for the "Wenze Transport Services / datatruck.io"
// Truck Owner Settlement + Driver Pay Settlement PDF template.
//
// Philosophy: never throw the statement away because a regex missed. Return
// whatever was extracted plus a list of fields that need a human to confirm
// or fill in — the UI always shows a review form before saving.

function parseDate(str) {
  if (!str) return null;
  const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function money(str) {
  if (str === undefined || str === null) return null;
  const s = String(str);
  const m = s.replace(/,/g, "").match(/-?\$?\(?-?([\d.]+)\)?/);
  if (!m) return null;
  const neg = /\(/.test(s) || /^-/.test(s.replace(/\$/, ""));
  const v = parseFloat(m[1]);
  return neg ? -v : v;
}

// Header-style "Label: value" lookups run against `flatText`, where cell
// separators ("|") are collapsed to spaces — these fields are single
// key/value pairs so pipe boundaries don't matter and only get in the way.
function findValue(flatText, label) {
  const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:?\\s*([^\\n]+)", "i");
  const m = flatText.match(re);
  return m ? m[1].trim() : null;
}

function parseStatement(lines, sourceFile) {
  const warnings = [];
  const fullText = lines.join("\n"); // keeps "|" cell boundaries, for table row parsing
  const flatText = fullText.replace(/\|/g, " "); // for single key/value header fields

  const idMatch = flatText.match(/ID:?\s*(BL-?\d+)/i);
  const id = idMatch ? idMatch[1].replace(/^BL(?!-)/, "BL-") : null;
  if (!id) warnings.push("Could not find statement ID (e.g. BL-000776).");

  const unitMatch = flatText.match(/Units?:?\s*(\d+)\s*([A-Za-z']*)/i);
  const truckUnit = unitMatch ? unitMatch[1] : null;
  const truckLabel = unitMatch ? `${unitMatch[1]}${unitMatch[2] ? " · " + unitMatch[2] : ""}` : null;
  if (!truckUnit) warnings.push("Could not find truck/unit number.");

  // Some PDF fonts drop double letters (e.g. "Settlement" -> "Selement") when
  // extracted by pdf.js — bound the driver-name capture on the next cell
  // boundary ("|") instead of the literal word "Settlement".
  const driverMatch = fullText.match(/Driver\s*Name:?\s*\|?\s*([A-Z ,.'-]+?)\s*\|/i);
  const driver = driverMatch ? driverMatch[1].trim() : null;

  const periodStart = parseDate(findValue(flatText, "Period Start"));
  const periodEnd = parseDate(findValue(flatText, "Period End"));
  const billDate = parseDate(findValue(flatText, "Bill Date"));
  const checkDate = parseDate(findValue(flatText, "Check Date"));
  if (!periodStart || !periodEnd) warnings.push("Could not find period start/end dates.");

  const tripsMatch = flatText.match(/Trips:?\s*(\d+)/i);
  const trips = tripsMatch ? parseInt(tripsMatch[1], 10) : null;

  const totalGrossMatch = flatText.match(/Total\s*Gross\s*Total\s*Gross\s*[\d.]*\s*\$?([\d,]+\.\d{2})/i)
    || flatText.match(/Total gross bill:?\s*\$?([\d,]+\.\d{2})/i);
  const driverPayMatch = flatText.match(/Driver Pay\s*Driver Pay\s*[\d.]*\s*-?\$?\(?([\d,]+\.\d{2})/i);
  const ownerGrossBillMatch = findValue(flatText, "Total gross bill");
  const ownerNetPayMatch = flatText.match(/Net Pay:?\s*\$?([\d,]+\.\d{2})/i);

  // Deductions table: lines between "Deductions" section header and its "Total:"
  const deductions = [];
  const dedStart = lines.findIndex((l) => /^Deductions\s*$/i.test(l.trim()) || /^\s*Deductions\s*\|/i.test(l));
  if (dedStart >= 0) {
    for (let i = dedStart + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^Total:/i.test(l.trim())) break;
      if (/^(Type|Date|Description|Quantity|Rate|Total amount)/i.test(l.trim())) continue;
      const cells = l.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;
      const amount = money(cells[cells.length - 1]);
      if (amount === null) continue;
      const type = cells[0];
      if (!/^[A-Za-z]/.test(type)) continue;
      deductions.push({
        type,
        description: cells.length > 3 ? cells.slice(2, -2).join(" ") : undefined,
        amount,
      });
    }
  } else {
    warnings.push("Could not locate the Deductions table — add deduction line items manually.");
  }

  // Loads table ("Total Gross" section on the owner-settlement page). Table
  // layouts in this template don't reliably split into fixed columns once
  // extracted (fonts/kerning shift where pdf.js sees a "gap"), so rows are
  // parsed by pulling out the tokens that must be there by shape — dates,
  // dollar amounts, mile figures — rather than assuming a column count.
  const loads = [];
  const loadsStart = lines.findIndex((l) => /Load number/i.test(l));
  if (loadsStart >= 0) {
    for (let i = loadsStart + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^Total:/i.test(l.trim())) break;
      if (/^---PAGE-BREAK---/.test(l)) continue;
      const rowText = l.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
      const dollarMatches = rowText.match(/\$-?[\d,]+\.\d{2}/g) || [];
      const dateMatches = rowText.match(/\d{1,2}\/\d{1,2}\/\d{4}/g) || [];
      if (dollarMatches.length < 1 || dateMatches.length < 2) continue; // not a data row

      const loadNumberMatch = rowText.match(/^([A-Za-z0-9-]+)/);
      const loadNumber = loadNumberMatch ? loadNumberMatch[1] : null;

      let stripped = rowText;
      for (const d of dollarMatches) stripped = stripped.replace(d, " ");
      for (const d of dateMatches) stripped = stripped.replace(d, " ");
      if (loadNumber) stripped = stripped.replace(loadNumber, " ");
      const routeText = stripped.replace(/[\d,]+\.\d{1,2}/g, " ").replace(/\s+/g, " ").trim();
      const mileNums = (stripped.match(/[\d,]+\.\d{1,2}/g) || []).map((n) => money(n)).slice(-3);
      const [loadedMiles, emptyMiles, totalMilesRaw] = mileNums.length === 3 ? mileNums : [null, null, null];
      const totalMiles = totalMilesRaw !== null ? totalMilesRaw : (loadedMiles !== null && emptyMiles !== null ? loadedMiles + emptyMiles : null);

      loads.push({
        loadNumber,
        route: routeText || undefined,
        delDate: parseDate(dateMatches[0]),
        puDate: parseDate(dateMatches[1]),
        loadedMiles,
        emptyMiles,
        totalMiles,
        gross: dollarMatches[0] ? money(dollarMatches[0]) : null,
        driverPayment: dollarMatches[1] ? money(dollarMatches[1]) : null,
      });
    }
  } else {
    warnings.push("Could not locate the load/trip table — add loads manually for accurate mileage metrics.");
  }
  const cleanLoads = loads.filter((l) => l.loadNumber && l.totalMiles !== null);
  if (loadsStart >= 0 && cleanLoads.length === 0) {
    warnings.push("Load table found but rows didn't parse cleanly — please review.");
  } else if (loadsStart >= 0 && cleanLoads.length < loads.length) {
    warnings.push(`${loads.length - cleanLoads.length} load row(s) didn't parse cleanly and were skipped — please double-check total miles.`);
  }

  const fuelMatch = flatText.match(/Fuel\s*\$?([\d,]+\.\d{2})/i);

  return {
    statement: {
      id: id || `UNKNOWN-${Date.now()}`,
      truckUnit: truckUnit || "UNKNOWN",
      truckLabel: truckLabel || "Unknown unit",
      driver: driver || "Unknown driver",
      periodStart,
      periodEnd,
      billDate,
      checkDate,
      trips: trips || cleanLoads.length,
      totalGross: totalGrossMatch ? money(totalGrossMatch[1]) : null,
      driverPayGross: driverPayMatch ? money(driverPayMatch[1]) : null,
      ownerGrossBill: money(ownerGrossBillMatch),
      deductions,
      ownerNetPay: ownerNetPayMatch ? money(ownerNetPayMatch[1]) : null,
      loads: cleanLoads,
      driverSettlement: { earnings: null, advances: 0, reimbursements: 0, deductions: 0, otherPay: 0, netPay: null, fines: [] },
      fuelBalance: fuelMatch ? money(fuelMatch[1]) : null,
      sourceFile,
    },
    warnings,
  };
}

window.parseStatement = parseStatement;
