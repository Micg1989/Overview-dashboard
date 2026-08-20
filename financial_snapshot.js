// Port of scripts/financial_snapshot.py — same label-driven logic, JS instead
// of Python since this runs in the browser. Keep behaviourally identical;
// if the Python version changes, mirror the change here too.

function parseCurrencyJS(s) {
  if (s === null || s === undefined) return null;
  s = String(s).trim();
  if (!s || /^(SUNDAY|SATURDAY)$/i.test(s)) return null;
  s = s.replace(/£/g, '').replace(/,/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function findCellJS(grid, text, contains) {
  const target = text.trim().toLowerCase();
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      const val = row[c];
      if (val === null || val === undefined) continue;
      const v = String(val).trim().toLowerCase();
      if ((contains && v.includes(target)) || (!contains && v === target)) {
        return [r, c];
      }
    }
  }
  return null;
}

function getCellJS(grid, r, c) {
  if (r === null || r === undefined || r < 0 || r >= grid.length) return null;
  const row = grid[r] || [];
  if (c === null || c === undefined || c < 0 || c >= row.length) return null;
  return row[c];
}

// today: JS Date object. grid: 2D array from Sheets values.get.
function parseFinancialSnapshot(grid, today) {
  const monthNames = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY",
    "AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
  const monthHeader = `${monthNames[today.getMonth()]} ${today.getFullYear()} PROFIT`;

  const hdr = findCellJS(grid, monthHeader, false);
  if (!hdr) throw new Error(`Could not find month header '${monthHeader}'`);
  const [hdrRow, labelCol] = hdr;

  let targetRow = null;
  for (let r = hdrRow + 1; r < Math.min(hdrRow + 5, grid.length); r++) {
    const v = getCellJS(grid, r, labelCol);
    if (v && String(v).trim().toLowerCase() === 'target profit') { targetRow = r; break; }
  }
  if (targetRow === null) throw new Error("Could not find 'TARGET PROFIT' row");
  const target = parseCurrencyJS(getCellJS(grid, targetRow, labelCol + 1));

  let dateCol = null, headerRow = null;
  for (let r = hdrRow; r < Math.min(hdrRow + 5, grid.length); r++) {
    const row = grid[r] || [];
    for (let c = labelCol; c < Math.min(labelCol + 8, row.length); c++) {
      if (row[c] && String(row[c]).trim().toLowerCase() === 'date') {
        dateCol = c; headerRow = r; break;
      }
    }
    if (dateCol !== null) break;
  }
  if (dateCol === null) throw new Error("Could not find 'Date' column header");

  let gpDayCol = null, gpMonthCol = null;
  const hRow = grid[headerRow] || [];
  for (let c = dateCol; c < Math.min(dateCol + 6, hRow.length); c++) {
    const v = hRow[c];
    if (!v) continue;
    const vl = String(v).trim().toLowerCase();
    if (vl === 'gross profit for day') gpDayCol = c;
    else if (vl === 'gross profit for the month') gpMonthCol = c;
  }
  if (gpDayCol === null || gpMonthCol === null) throw new Error("Could not find GP columns");

  // dd/mm/yyyy -> Date
  function parseUKDate(s) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s).trim());
    if (!m) return null;
    return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  const dateRows = []; // [{date, row}]
  for (let r = headerRow + 1; r < grid.length; r++) {
    const v = getCellJS(grid, r, dateCol);
    if (!v) continue;
    const d = parseUKDate(v);
    if (d) dateRows.push({ date: d, row: r });
  }

  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const candidates = dateRows.filter(dr => dr.date <= todayMidnight);
  let monthGp = null, monthGpDate = null;
  if (candidates.length) {
    candidates.sort((a, b) => b.date - a.date);
    monthGpDate = candidates[0].date;
    monthGp = parseCurrencyJS(getCellJS(grid, candidates[0].row, gpMonthCol));
  }

  let prevDayGp = null, prevDayDate = null;
  let cursor = new Date(todayMidnight);
  for (let i = 0; i < 7; i++) {
    cursor.setDate(cursor.getDate() - 1);
    const hit = dateRows.find(dr => sameDay(dr.date, cursor));
    if (hit) {
      const val = parseCurrencyJS(getCellJS(grid, hit.row, gpDayCol));
      if (val !== null) { prevDayGp = val; prevDayDate = new Date(cursor); break; }
    }
  }

  const remainingToTarget = (target !== null && monthGp !== null) ? Math.round((target - monthGp) * 100) / 100 : null;

  return {
    target, month_gp: monthGp, month_gp_as_of: monthGpDate,
    remaining_to_target: remainingToTarget,
    prev_day_gp: prevDayGp, prev_day_date: prevDayDate,
  };
}

if (typeof module !== 'undefined') module.exports = { parseFinancialSnapshot, parseCurrencyJS };
