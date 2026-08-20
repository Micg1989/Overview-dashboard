// Port of scripts/thornaby_stock_check.py — same label-driven logic and same
// five checks, JS instead of Python since this runs in the browser against
// the Sheets API's grid-with-formatting response (not an xlsx file).
// Deliberately mirrors the Python version's behaviour exactly, quirks
// included (see MOT/service/health-check/notes/service-history below) so
// the live button and the scheduled brief never disagree.

const MOT_LABEL = "mot (6m)";
const SERVICE_LABEL = "service (4k/4m)";
const HEALTHCHECK_LABELS = ["healthcheck done", "health check done"];
const NOTES_LABELS = ["gary notes", "pick up notes"];
const SERVICE_HISTORY_SUBHEADERS = ["service date", "service mileage"];
const STOP_LIST_FOR_NOTES_SCAN = [
  "locking nut", "service history", "service date", "service mileage",
  "healthcheck", "health check", "video", "reel", "mot (6m)", "service (4k/4m)",
  "bookpack", "front pads", "rear pads", "glovebox",
];
const MOT_WINDOW_DAYS = 183;
const SERVICE_WINDOW_DAYS = 122;
const NOTES_SCAN_ROWS = 6;
const SITE_FILTER = "thornaby";

function normJS(v) {
  return v !== null && v !== undefined ? String(v).trim().toLowerCase() : "";
}

function isGreenishJS(bg) {
  if (!bg) return false;
  const r = Math.round((bg.red || 0) * 255);
  const g = Math.round((bg.green || 0) * 255);
  const b = Math.round((bg.blue || 0) * 255);
  if (g < 80) return false;
  return g > r + 20 && g > b + 20;
}

function cellAt(rowData, r, c) {
  const row = (rowData[r] && rowData[r].values) || [];
  return row[c] || {};
}
function cellText(rowData, r, c) {
  const v = cellAt(rowData, r, c).formattedValue;
  return v === undefined ? null : v;
}
function cellBg(rowData, r, c) {
  const fmt = cellAt(rowData, r, c).effectiveFormat;
  return (fmt && fmt.backgroundColor) || null;
}

function parseFlexibleDateJS(value) {
  if (value === null || value === undefined) return { date: null, issue: "missing" };
  const text = String(value).trim();
  if (!text) return { date: null, issue: "missing" };

  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (m) return { date: new Date(+m[3], +m[2] - 1, +m[1]), issue: null };
  m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(text);
  if (m) return { date: new Date(2000 + +m[3], +m[2] - 1, +m[1]), issue: null };
  m = /^(\d{2})\/(\d{4})$/.exec(text);
  if (m) return { date: new Date(+m[2], +m[1] - 1, 1), issue: null };
  m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  if (m) return { date: new Date(+m[3], +m[2] - 1, +m[1]), issue: null };

  m = /(\d{1,2})[\/-](\d{4})/.exec(text);
  if (m) return { date: new Date(+m[2], +m[1] - 1, 1), issue: null };
  m = /(20\d{2})/.exec(text);
  if (m) return { date: new Date(+m[1], 0, 1), issue: null };

  return { date: null, issue: "unparseable" };
}

function findLabelRowJS(rowData, col, labels, maxRow) {
  for (let r = 0; r < Math.min(maxRow, rowData.length); r++) {
    const v = normJS(cellText(rowData, r, col));
    if (labels.includes(v)) return r;
  }
  return null;
}

function fmtDateUK(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}
function fmtMonthYear(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${mm}/${d.getFullYear()}`;
}

function analyzeBlockJS(rowData, modelCol, maxRow, today) {
  const sorCol = modelCol + 1;
  const regCol = modelCol + 2;

  // Row above the real data row often holds a plain numbering counter ("1",
  // "2"...) in modelCol, which formattedValue can't distinguish from real
  // text (unlike openpyxl's typed cell.value) — exclude purely-numeric
  // values explicitly since no real model name or reg plate is ever
  // digits-only.
  const isPurelyNumeric = s => /^\d+$/.test(String(s).trim());
  let dataRow = null;
  for (let r = 1; r < Math.min(maxRow, 15); r++) {
    const mv = cellText(rowData, r, modelCol);
    const rv = cellText(rowData, r, regCol);
    if (mv && String(mv).trim() && rv && String(rv).trim()
        && !isPurelyNumeric(mv) && !isPurelyNumeric(rv)) { dataRow = r; break; }
  }
  if (dataRow === null) return null;

  const model = String(cellText(rowData, dataRow, modelCol)).trim();
  const reg = String(cellText(rowData, dataRow, regCol)).trim();
  let site = "Unknown site";
  if (dataRow > 0) {
    const sv = cellText(rowData, dataRow - 1, regCol);
    if (sv && String(sv).trim()) site = String(sv).trim();
  }

  const flags = [];
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // MOT due
  const motRow = findLabelRowJS(rowData, modelCol, [MOT_LABEL], maxRow);
  if (motRow !== null) {
    const raw = cellText(rowData, motRow, sorCol);
    const { date: d } = parseFlexibleDateJS(raw);
    if (d) {
      const windowEnd = new Date(todayMid); windowEnd.setDate(windowEnd.getDate() + MOT_WINDOW_DAYS);
      if (d <= windowEnd) {
        flags.push({ type: "MOT due", detail: `MOT due ${fmtDateUK(d)}${d < todayMid ? " (OVERDUE)" : ""}` });
      }
    }
  }

  // Service due
  const serviceRow = findLabelRowJS(rowData, modelCol, [SERVICE_LABEL], maxRow);
  if (serviceRow !== null) {
    const raw = cellText(rowData, serviceRow, sorCol);
    const { date: d } = parseFlexibleDateJS(raw);
    if (d) {
      const windowEnd = new Date(todayMid); windowEnd.setDate(windowEnd.getDate() + SERVICE_WINDOW_DAYS);
      if (d <= windowEnd) {
        flags.push({ type: "Service due", detail: `Service due ${fmtMonthYear(d)}${d < todayMid ? " (OVERDUE)" : ""}` });
      }
    }
  }

  // Health check
  const hcRow = findLabelRowJS(rowData, modelCol, HEALTHCHECK_LABELS, maxRow);
  if (hcRow !== null) {
    const raw = cellText(rowData, hcRow, sorCol);
    const checked = raw === true || raw === "TRUE";
    if (!checked) flags.push({ type: "Health check", detail: "Health check not marked as done" });
  }

  // Unactioned notes
  const notesRow = findLabelRowJS(rowData, modelCol, NOTES_LABELS, maxRow);
  if (notesRow !== null) {
    for (let r = notesRow + 1; r < Math.min(maxRow, notesRow + 1 + NOTES_SCAN_ROWS); r++) {
      const labelCheck = normJS(cellText(rowData, r, modelCol));
      if (STOP_LIST_FOR_NOTES_SCAN.some(s => labelCheck.includes(s))) break;
      for (const c of [modelCol, sorCol]) {
        const v = cellText(rowData, r, c);
        if (v !== null && String(v).trim()) {
          if (!isGreenishJS(cellBg(rowData, r, c))) {
            flags.push({ type: "Unactioned note", detail: String(v).trim() });
          }
        }
      }
    }
  }

  // Service history (mirrors the Python check's exact subheader assumption —
  // see build notes: this sheet's real header is "Service History", not
  // "Service Date"/"Service Mileage", so this check does not currently fire.
  // Kept identical to the Python version on purpose.)
  let svcHdrRow = null;
  for (const label of SERVICE_HISTORY_SUBHEADERS) {
    const row = findLabelRowJS(rowData, sorCol, [label], maxRow);
    if (row !== null) { svcHdrRow = row; break; }
  }
  if (svcHdrRow !== null) {
    let hasData = false;
    for (let r = svcHdrRow + 1; r < maxRow && !hasData; r++) {
      for (const c of [modelCol, sorCol, regCol]) {
        const v = cellText(rowData, r, c);
        if (v !== null && String(v).trim()) { hasData = true; break; }
      }
    }
    if (!hasData) flags.push({ type: "Service history", detail: "No service history recorded" });
  }

  return { model, reg, site, flags };
}

// Groups flagged cars by site label, so the live view can switch sites
// without re-fetching the sheet. Every site with at least one car gets an
// entry (even if none of its cars are currently flagged, so a clean branch
// stays selectable and shows "0 FLAGGED" instead of disappearing from the
// dropdown). Keyed by normalized site text to avoid casing splitting one
// site into two entries; Thornaby sorts first, the rest alphabetically.
function groupFlaggedBySite(allCars) {
  const bySite = new Map(); // normalized key -> { label, flagged: [] }
  for (const c of allCars) {
    const key = normJS(c.site);
    if (!bySite.has(key)) bySite.set(key, { label: c.site, flagged: [] });
    if (c.flags.length > 0) bySite.get(key).flagged.push(c);
  }

  const entries = [...bySite.values()].sort((a, b) => {
    const aThornaby = normJS(a.label).includes(SITE_FILTER);
    const bThornaby = normJS(b.label).includes(SITE_FILTER);
    if (aThornaby !== bThornaby) return aThornaby ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  const result = {};
  for (const e of entries) result[e.label] = e.flagged;
  return result;
}

// gridResponse: the sheets.get JSON body (sheets[0].properties.gridProperties,
// sheets[0].data[0].rowData). today: JS Date.
function analyzeStocklist(gridResponse, today) {
  const sheet = gridResponse.sheets[0];
  const numCols = sheet.properties.gridProperties.columnCount;
  const rowData = sheet.data[0].rowData || [];
  const maxRow = rowData.length;
  const numBlocks = Math.floor(numCols / 3);

  const allCars = [];
  for (let b = 0; b < numBlocks; b++) {
    const modelCol = b * 3;
    const result = analyzeBlockJS(rowData, modelCol, maxRow, today);
    if (result) allCars.push(result);
  }

  const thornabyCars = allCars.filter(c => normJS(c.site).includes(SITE_FILTER));
  const flagged = thornabyCars.filter(c => c.flags.length > 0);
  const bySite = groupFlaggedBySite(allCars);
  return { allCount: allCars.length, thornabyCount: thornabyCars.length, flagged, bySite };
}

if (typeof module !== 'undefined') module.exports = { analyzeStocklist, isGreenishJS, parseFlexibleDateJS };
