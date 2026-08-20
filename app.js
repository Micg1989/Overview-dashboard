// Morning Brief — live refresh button.
// Ported logic lives in financial_snapshot.js / stock_check.js (both
// validated against the exact same output as the skill's Python scripts).
// This file wires them to Google OAuth (client-side, browser-only — no
// server, no stored credentials) and updates the already-rendered DOM.
//
// Scope, by design (agreed before building):
//   LIVE on refresh: GP yesterday, £ to target, flagged Thornaby cars,
//                     the schedule's time blocks (using the calendar's own
//                     event text — literal, not phrased)
//   STATIC, unchanged by refresh: headline, headlineFull, reflectionTag,
//                     reflectionText, attentionItems/Count/Tag
//   These stay as Claude last wrote them — a browser button has no "me" on
//   the other end of it to re-write those with judgement.

const CLIENT_ID = "435191356512-mn75l0p56egmqa7kr9risl33bbk8ti0e.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/spreadsheets.readonly";
const SPREADSHEET_1T = "1Gbvo5RCkoBbQ0oPfApaOCIHAe8jpcLVrkOhXoQFHL5c"; // 1T Arrow Motor Company
const SPREADSHEET_2D = "1zAf3l1dkhpW1ZqJsEcMqN5Duqdvf4aYZpWrC8euOc7M"; // 2D Arrow Motor Company

let tokenClient = null;
let accessToken = null;

function gbpShort(n) {
  const abs = Math.abs(n);
  if (abs >= 1000) return `£${(abs / 1000).toFixed(1)}K`;
  return `£${abs.toFixed(0)}`;
}

function fmtGbpFull(n) {
  return `£${n.toFixed(2)}`;
}

function fmt24h(date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

async function apiGet(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---- Calendar ----
async function fetchScheduleData() {
  const calList = await apiGet('https://www.googleapis.com/calendar/v3/users/me/calendarList');
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);

  let events = [];
  for (const cal of (calList.items || [])) {
    try {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`
        + `?timeMin=${dayStart.toISOString()}&timeMax=${dayEnd.toISOString()}&singleEvents=true&orderBy=startTime`;
      const evs = await apiGet(url);
      for (const e of (evs.items || [])) {
        if (!e.start || !e.start.dateTime) continue; // skip all-day events for the timeline
        events.push({
          start: new Date(e.start.dateTime),
          end: new Date(e.end.dateTime),
          summary: e.summary || "Untitled event",
        });
      }
    } catch (err) {
      console.warn("Calendar fetch failed for", cal.id, err);
    }
  }
  events.sort((a, b) => a.start - b.start);

  const timeBlocks = [];
  const dayOpen = new Date(dayStart); dayOpen.setHours(8, 0, 0, 0);
  const dayClose = new Date(dayStart); dayClose.setHours(18, 0, 0, 0);

  if (events.length === 0) {
    timeBlocks.push({ time: "ALL DAY", text: "Nothing on the books." });
  } else {
    if (events[0].start > dayOpen) {
      timeBlocks.push({ time: `UNTIL ${fmt24h(events[0].start)}`, text: "Open — nothing on the books before then." });
    }
    for (const e of events) {
      timeBlocks.push({ time: `${fmt24h(e.start)}–${fmt24h(e.end)}`, text: e.summary });
    }
    const last = events[events.length - 1];
    if (last.end < dayClose) {
      timeBlocks.push({ time: `${fmt24h(last.end)} ONWARD`, text: "Nothing else on the books." });
    }
  }

  let dayClass;
  if (events.length === 0) dayClass = "OPEN";
  else if (events.length === 1) dayClass = `${fmt24h(events[0].start)} – ${fmt24h(events[0].end)}`;
  else dayClass = `${events.length} EVENTS`;

  return { dayClass, timeBlocks };
}

// ---- DOM update ----
function renderLiveUpdate(data) {
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

  setText('live-gpYesterday', data.gpYesterday);
  setText('live-gapToTarget-caption', `GP · ${data.gapToTargetLabel}`);
  setText('live-dayClass', data.dayClass);
  setText('live-stockCount-spoke', `${data.stockCount} FLAGGED`);

  const badge = document.getElementById('live-stockCount-badge');
  if (badge) badge.textContent = `${data.stockCount} FLAGGED`;

  const tbContainer = document.getElementById('live-timeblocks');
  if (tbContainer) {
    tbContainer.innerHTML = '';
    for (const b of data.timeBlocks) {
      const row = document.createElement('div');
      row.style.cssText = "display:flex;gap:14px;padding:10px 0;border-top:1px solid rgba(0,229,255,.15)";
      row.innerHTML = `<div style="font-size:10px;color:#5C8A93;min-width:88px"></div><div style="font-size:11.5px;line-height:1.5;color:#9FD9E2"></div>`;
      row.children[0].textContent = b.time;
      row.children[1].textContent = b.text;
      tbContainer.appendChild(row);
    }
  }

  const stockWrap = document.getElementById('live-stock-section');
  const stockList = document.getElementById('live-stocklist');
  if (stockList) {
    stockList.innerHTML = '';
    for (const car of data.stockItems) {
      const row = document.createElement('div');
      row.style.cssText = "display:flex;gap:12px;align-items:flex-start";
      const regEl = document.createElement('div');
      regEl.style.cssText = "font-size:9.5px;border:1px solid rgba(255,111,176,.4);color:#F3B8D3;padding:3px 6px;border-radius:2px;white-space:nowrap;margin-top:1px";
      regEl.textContent = car.reg;
      const body = document.createElement('div');
      const modelEl = document.createElement('div');
      modelEl.style.cssText = "font-size:12px;font-weight:700;color:#E8FBFF";
      modelEl.textContent = car.model;
      const flagEl = document.createElement('div');
      flagEl.style.cssText = "font-size:11px;color:#5C8A93;margin-top:2px";
      flagEl.textContent = car.flag;
      body.appendChild(modelEl); body.appendChild(flagEl);
      row.appendChild(regEl); row.appendChild(body);
      stockList.appendChild(row);
    }
  }
  if (stockWrap) stockWrap.style.display = data.stockItems.length > 0 ? '' : 'none';

  const ts = document.getElementById('live-synced-at');
  if (ts) ts.textContent = `Last synced ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function setButtonState(state) {
  const btn = document.getElementById('live-refresh-btn');
  if (!btn) return;
  if (state === 'loading') { btn.textContent = 'SYNCING…'; btn.disabled = true; }
  else if (state === 'error') { btn.textContent = 'RETRY REFRESH'; btn.disabled = false; }
  else { btn.textContent = 'REFRESH'; btn.disabled = false; }
}

async function runRefresh() {
  setButtonState('loading');
  try {
    const today = new Date();

    const [scheduleData, snapRaw, stockGrid] = await Promise.all([
      fetchScheduleData(),
      apiGet(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_1T}/values/'Service%20Profit'!A1:P60`),
      apiGet(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_2D}?ranges=Stocklist&fields=sheets.properties.gridProperties,sheets.data.rowData.values(formattedValue,effectiveFormat.backgroundColor)`),
    ]);

    const snap = parseFinancialSnapshot(snapRaw.values, today);
    const stock = analyzeStocklist(stockGrid, today);

    const gapToTargetLabel = snap.remaining_to_target >= 0
      ? `${gbpShort(snap.remaining_to_target)} to target`
      : `${gbpShort(snap.remaining_to_target)} over target`;

    renderLiveUpdate({
      gpYesterday: snap.prev_day_gp !== null ? fmtGbpFull(snap.prev_day_gp) : "—",
      gapToTargetLabel,
      dayClass: scheduleData.dayClass,
      timeBlocks: scheduleData.timeBlocks,
      stockCount: stock.flagged.length,
      stockItems: stock.flagged.map(c => ({
        reg: c.reg, model: c.model,
        flag: c.flags.map(f => `${f.type}: ${f.detail}`).join(' · '),
      })),
    });

    setButtonState('idle');
  } catch (err) {
    console.error("Refresh failed:", err);
    setButtonState('error');
  }
}

function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (resp) => {
      if (resp.error) { console.error(resp); setButtonState('error'); return; }
      accessToken = resp.access_token;
      runRefresh();
    },
  });
  return tokenClient;
}

function onRefreshClick() {
  ensureTokenClient();
  if (accessToken) {
    runRefresh();
  } else {
    tokenClient.requestAccessToken({ prompt: '' });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('live-refresh-btn');
  if (btn) btn.addEventListener('click', onRefreshClick);
});
