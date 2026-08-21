// Morning Brief — live refresh button.
// Ported logic lives in financial_snapshot.js / stock_check.js (both
// validated against the exact same output as the skill's Python scripts).
// This file wires them to Google OAuth (client-side, browser-only — no
// server, no stored credentials) and updates the already-rendered DOM.
//
// Scope, by design (agreed before building):
//   LIVE on refresh: GP yesterday, £ to target, flagged Thornaby cars,
//                     today's time blocks and tomorrow's peek-ahead (using
//                     the calendar's own event text — literal, not phrased)
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
let lastStockBySite = null; // populated on refresh; site label -> flagged cars
let selectedSite = null; // site label currently shown in the STOCK section

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
// Fetches one calendar-day's timed events (all-day events skipped — they
// don't fit the hour-range timeline) across every calendar on the account.
async function fetchEventsForRange(calList, rangeStart, rangeEnd) {
  let events = [];
  for (const cal of (calList.items || [])) {
    try {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`
        + `?timeMin=${rangeStart.toISOString()}&timeMax=${rangeEnd.toISOString()}&singleEvents=true&orderBy=startTime`;
      const evs = await apiGet(url);
      for (const e of (evs.items || [])) {
        if (!e.start || !e.start.dateTime) continue;
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
  return events;
}

async function fetchScheduleData() {
  const calList = await apiGet('https://www.googleapis.com/calendar/v3/users/me/calendarList');
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const tomorrowEnd = new Date(dayEnd); tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

  const [events, tomorrowEvents] = await Promise.all([
    fetchEventsForRange(calList, dayStart, dayEnd),
    fetchEventsForRange(calList, dayEnd, tomorrowEnd),
  ]);

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

  const tomorrowBlocks = tomorrowEvents.length === 0
    ? [{ time: "—", text: "Nothing on the books yet." }]
    : tomorrowEvents.map(e => ({ time: `${fmt24h(e.start)}–${fmt24h(e.end)}`, text: e.summary }));

  return { dayClass, timeBlocks, tomorrowBlocks };
}

// ---- DOM update ----
// Rebuilds a time-block list's rows into `containerId` from scratch — shared
// by today's schedule and tomorrow's peek-ahead, which use the same row
// shape with slightly different emphasis (rowStyle/timeStyle/textStyle).
function renderBlockRows(containerId, blocks, rowStyle, textStyle) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  for (const b of blocks) {
    const row = document.createElement('div');
    row.style.cssText = rowStyle;
    row.innerHTML = `<div style="font-size:10px;color:#5C8A93;min-width:88px"></div><div style="${textStyle}"></div>`;
    row.children[0].textContent = b.time;
    row.children[1].textContent = b.text;
    container.appendChild(row);
  }
}

function renderLiveUpdate(data) {
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

  setText('live-gpYesterday', data.gpYesterday);
  setText('live-gapToTarget-caption', `GP · ${data.gapToTargetLabel}`);
  setText('live-dayClass', data.dayClass);

  renderBlockRows('live-timeblocks', data.timeBlocks,
    "display:flex;gap:14px;padding:10px 0;border-top:1px solid rgba(0,229,255,.15)",
    "font-size:11.5px;line-height:1.5;color:#9FD9E2");
  renderBlockRows('live-tomorrow-blocks', data.tomorrowBlocks,
    "display:flex;gap:14px;padding:8px 0;border-top:1px solid rgba(0,229,255,.1)",
    "font-size:11px;line-height:1.5;color:#7FA6AE");

  const ts = document.getElementById('live-synced-at');
  if (ts) ts.textContent = `Last synced ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

// Renders the flagged-car list for one site from the already-fetched,
// cached `lastStockBySite` map — no network call, so switching sites is
// instant. Called once after refresh (for the default site) and again on
// every site-select change.
function renderStockForSite(siteName) {
  const items = (lastStockBySite && lastStockBySite[siteName]) || [];
  selectedSite = siteName;

  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setText('live-stockCount-spoke', `${items.length} FLAGGED`);
  setText('live-stockCount-badge', `${items.length} FLAGGED`);
  setText('live-site-caption', siteName);

  const stockWrap = document.getElementById('live-stock-section');
  const stockList = document.getElementById('live-stocklist');
  if (stockList) {
    stockList.innerHTML = '';
    for (const car of items) {
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
      flagEl.textContent = car.flags.map(f => `${f.type}: ${f.detail}`).join(' · ');
      body.appendChild(modelEl); body.appendChild(flagEl);
      row.appendChild(regEl); row.appendChild(body);
      stockList.appendChild(row);
    }
  }
  if (stockWrap) stockWrap.style.display = Object.keys(lastStockBySite || {}).length > 0 ? '' : 'none';
}

// Rebuilds the site <select>'s options from the freshly-fetched bySite map,
// keeping the user's current selection if that site still has flags, else
// falling back to whichever site looks like Thornaby, else the first site.
function populateSiteSelect(bySite) {
  const select = document.getElementById('live-site-select');
  if (!select) return null;

  const siteNames = Object.keys(bySite);
  select.innerHTML = '';
  for (const name of siteNames) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name.toUpperCase();
    select.appendChild(opt);
  }

  let target = siteNames.includes(selectedSite) ? selectedSite : null;
  if (!target) target = siteNames.find(n => n.toLowerCase().includes(SITE_FILTER)) || siteNames[0];
  if (target) select.value = target;
  return target;
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
    });

    lastStockBySite = stock.bySite;
    const siteToShow = populateSiteSelect(stock.bySite) || "Thornaby";
    renderStockForSite(siteToShow);

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

// Delegated on document, not bound to the button node directly: the dc-runtime
// (support.js) re-renders the page through React after an async CDN fetch,
// replacing the original button with a new node. A direct DOMContentLoaded
// binding attaches to the node that gets discarded, leaving the visible
// button with no listener at all.
document.addEventListener('click', (e) => {
  if (e.target.closest('#live-refresh-btn')) onRefreshClick();
});

// Same delegation reasoning as the refresh button above: the site <select>
// node can be replaced by a post-refresh re-render, so bind on document.
document.addEventListener('change', (e) => {
  if (e.target.id === 'live-site-select') renderStockForSite(e.target.value);
});
