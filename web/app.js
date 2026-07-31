/* Ledger — deadline planner with public-holiday & event overlay */


const API_BASE = '/api';
const COUNTRY_KEY = 'ledger.country';
const TM_KEY_KEY = 'ledger.tmKey';
const TM_CITY_KEY = 'ledger.tmCity';

let entries = [];
let viewDate = new Date();
viewDate.setDate(1);
let holidaysByYear = {}; // { '2026': [{date, localName}, ...] }
let tmEvents = [];       // [{date, name}]

/* ---------------- API helpers ---------------- */
async function apiRequest(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch (_) { /* response had no JSON body */ }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function loadEntries() {
  try {
    entries = await apiRequest('/entries');
  } catch (e) {
    console.error('Could not load entries from the server.', e);
    entries = [];
    showBanner('Could not reach the server — showing an empty list. ' +
                'Check your connection and reload.');
  }
}

async function createEntry(data) {
  return apiRequest('/entries', { method: 'POST', body: JSON.stringify(data) });
}

async function updateEntry(id, data) {
  return apiRequest(`/entries/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

async function deleteEntryApi(id) {
  return apiRequest(`/entries/${id}`, { method: 'DELETE' });
}

function showBanner(message) {
  // Simple, dependency-free way to surface backend errors to the user
  // without silently failing.
  console.error(message);
  alert(message);
}

/* ---------------- DOM refs ---------------- */
const todayLabel = document.getElementById('today-label');
const entryList = document.getElementById('entry-list');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search-input');
const filterSelect = document.getElementById('filter-select');
const sortSelect = document.getElementById('sort-select');
const addBtn = document.getElementById('add-btn');

const dialog = document.getElementById('entry-dialog');
const entryForm = document.getElementById('entry-form');
const dialogTitle = document.getElementById('dialog-title');
const entryIdField = document.getElementById('entry-id');
const entryTitleField = document.getElementById('entry-title');
const entryDateField = document.getElementById('entry-date');
const entryCategoryField = document.getElementById('entry-category');
const entryPriorityField = document.getElementById('entry-priority');
const entryNotesField = document.getElementById('entry-notes');
const entryLinkField = document.getElementById('entry-link');
const deleteBtn = document.getElementById('delete-entry');
const cancelBtn = document.getElementById('cancel-dialog');

const monthLabel = document.getElementById('month-label');
const calendarGrid = document.getElementById('calendar-grid');
const prevMonthBtn = document.getElementById('prev-month');
const nextMonthBtn = document.getElementById('next-month');
const countryInput = document.getElementById('country-input');

const tmKeyInput = document.getElementById('tm-key');
const tmCityInput = document.getElementById('tm-city');
const tmFetchBtn = document.getElementById('tm-fetch');

/* ---------------- Init ---------------- */
async function init() {
  todayLabel.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  countryInput.value = localStorage.getItem(COUNTRY_KEY) || 'US';
  tmKeyInput.value = localStorage.getItem(TM_KEY_KEY) || '';
  tmCityInput.value = localStorage.getItem(TM_CITY_KEY) || '';

  await loadEntries();
  renderEntries();
  await fetchHolidaysForYear(viewDate.getFullYear());
  renderCalendar();

  addBtn.addEventListener('click', () => openDialog());
  cancelBtn.addEventListener('click', () => dialog.close());
  deleteBtn.addEventListener('click', onDelete);
  entryForm.addEventListener('submit', onSave);

  searchInput.addEventListener('input', renderEntries);
  filterSelect.addEventListener('change', renderEntries);
  sortSelect.addEventListener('change', renderEntries);

  prevMonthBtn.addEventListener('click', () => changeMonth(-1));
  nextMonthBtn.addEventListener('click', () => changeMonth(1));
  countryInput.addEventListener('change', () => {
    const code = countryInput.value.trim().toUpperCase().slice(0, 2);
    countryInput.value = code;
    localStorage.setItem(COUNTRY_KEY, code);
    holidaysByYear = {}; // force refetch for new country
    fetchHolidaysForYear(viewDate.getFullYear()).then(renderCalendar);
  });

  tmFetchBtn.addEventListener('click', fetchTicketmasterEvents);
}

/* ---------------- Entry CRUD ---------------- */
function openDialog(entry) {
  entryForm.reset();
  if (entry) {
    dialogTitle.textContent = 'Edit entry';
    entryIdField.value = entry.id;
    entryTitleField.value = entry.title;
    entryDateField.value = entry.date;
    entryCategoryField.value = entry.category;
    entryPriorityField.value = entry.priority;
    entryNotesField.value = entry.notes || '';
    entryLinkField.value = entry.link || '';
    deleteBtn.hidden = false;
  } else {
    dialogTitle.textContent = 'New entry';
    entryIdField.value = '';
    deleteBtn.hidden = true;
  }
  dialog.showModal();
}

async function onSave(e) {
  e.preventDefault();
  if (!entryTitleField.value.trim() || !entryDateField.value) return;

  const id = entryIdField.value;
  const data = {
    title: entryTitleField.value.trim(),
    date: entryDateField.value,
    category: entryCategoryField.value,
    priority: Number(entryPriorityField.value),
    notes: entryNotesField.value.trim(),
    link: normalizeUrl(entryLinkField.value.trim()),
  };

  const saveBtn = document.getElementById('save-entry');
  saveBtn.disabled = true;
  try {
    if (id) {
      const updated = await updateEntry(id, data);
      const idx = entries.findIndex(en => en.id === id);
      if (idx >= 0) entries[idx] = updated;
    } else {
      const created = await createEntry(data);
      entries.push(created);
    }
    dialog.close();
    renderEntries();
    renderCalendar();
  } catch (err) {
    showBanner(`Could not save this entry: ${err.message}`);
  } finally {
    saveBtn.disabled = false;
  }
}

async function onDelete() {
  const id = entryIdField.value;
  deleteBtn.disabled = true;
  try {
    await deleteEntryApi(id);
    entries = entries.filter(en => en.id !== id);
    dialog.close();
    renderEntries();
    renderCalendar();
  } catch (err) {
    showBanner(`Could not delete this entry: ${err.message}`);
  } finally {
    deleteBtn.disabled = false;
  }
}

/* ---------------- Render: ledger list ---------------- */
function renderEntries() {
  const query = searchInput.value.trim().toLowerCase();
  const category = filterSelect.value;
  const sortMode = sortSelect.value;

  let visible = entries.filter(en => {
    const matchesQuery = !query || en.title.toLowerCase().includes(query) ||
      (en.notes || '').toLowerCase().includes(query);
    const matchesCategory = category === 'all' || en.category === category;
    return matchesQuery && matchesCategory;
  });

  visible.sort((a, b) => {
    if (sortMode === 'date-asc') return a.date.localeCompare(b.date);
    if (sortMode === 'date-desc') return b.date.localeCompare(a.date);
    if (sortMode === 'priority') return b.priority - a.priority || a.date.localeCompare(b.date);
    if (sortMode === 'alpha') return a.title.localeCompare(b.title);
    return 0;
  });

  entryList.innerHTML = '';
  emptyState.hidden = visible.length !== 0;

  const todayStr = new Date().toISOString().slice(0, 10);

  for (const en of visible) {
    const li = document.createElement('li');
    li.className = 'entry-card';
    const daysDiff = daysBetween(todayStr, en.date);
    if (daysDiff < 0) li.classList.add('overdue');
    else if (daysDiff <= 3) li.classList.add('due-soon');

    const dots = [1, 2, 3].map(n =>
      `<span class="${n <= en.priority ? 'active' : ''}">●</span>`).join('');

    li.innerHTML = `
      <div class="entry-top">
        <span class="entry-title">${escapeHtml(en.title)}</span>
        <span class="entry-date">${formatDate(en.date)}</span>
      </div>
      <div class="entry-meta">
        <span class="tag tag-${en.category}">${en.category}</span>
        <span class="priority-dots">${dots}</span>
      </div>
      ${en.notes ? `<div class="entry-notes">${escapeHtml(en.notes)}</div>` : ''}
      ${en.link ? `<div class="entry-link"><a href="${escapeAttr(en.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(en.link)}</a></div>` : ''}
    `;
    const linkEl = li.querySelector('.entry-link a');
    if (linkEl) linkEl.addEventListener('click', ev => ev.stopPropagation());
    li.addEventListener('click', () => openDialog(en));
    entryList.appendChild(li);
  }
}

/* ---------------- Render: calendar ---------------- */
function changeMonth(delta) {
  viewDate.setMonth(viewDate.getMonth() + delta);
  fetchHolidaysForYear(viewDate.getFullYear()).then(renderCalendar);
}

async function fetchHolidaysForYear(year) {
  if (holidaysByYear[year]) return;
  const country = (localStorage.getItem(COUNTRY_KEY) || countryInput.value || 'US').toUpperCase();
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`);
    if (!res.ok) throw new Error(`Nager.Date responded with ${res.status}`);
    holidaysByYear[year] = await res.json();
  } catch (err) {
    console.error('Could not load public holidays.', err);
    holidaysByYear[year] = [];
  }
}

function renderCalendar() {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  monthLabel.textContent = viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const firstOfMonth = new Date(year, month, 1);
  const startDay = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);

  const holidays = holidaysByYear[year] || [];

  calendarGrid.innerHTML = '';

  const totalCells = 42;
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startDay + 1;
    const cell = document.createElement('div');
    cell.className = 'day-cell';

    let cellDate, displayNum, outside = false;
    if (dayNum < 1) {
      displayNum = daysInPrevMonth + dayNum;
      cellDate = new Date(year, month - 1, displayNum);
      outside = true;
    } else if (dayNum > daysInMonth) {
      displayNum = dayNum - daysInMonth;
      cellDate = new Date(year, month + 1, displayNum);
      outside = true;
    } else {
      displayNum = dayNum;
      cellDate = new Date(year, month, dayNum);
    }

    const cellStr = toDateStr(cellDate);
    if (outside) cell.classList.add('outside');
    if (cellStr === todayStr) cell.classList.add('today');

    const badges = [];
    if (entries.some(en => en.date === cellStr)) badges.push('badge-deadline');
    if (holidays.some(h => h.date === cellStr)) badges.push('badge-holiday');
    if (tmEvents.some(ev => ev.date === cellStr)) badges.push('badge-event');

    cell.innerHTML = `
      <div class="day-num">${displayNum}</div>
      <div class="day-badges">${badges.map(b => `<span class="badge-stamp ${b}"></span>`).join('')}</div>
    `;

    const holidayMatch = holidays.find(h => h.date === cellStr);
    if (holidayMatch) cell.title = holidayMatch.localName;

    calendarGrid.appendChild(cell);
  }
}

/* ---------------- Optional: Ticketmaster events ---------------- */
async function fetchTicketmasterEvents() {
  const key = tmKeyInput.value.trim();
  const city = tmCityInput.value.trim();
  if (!key || !city) {
    alert('Enter both your Ticketmaster API key and a city to fetch events.');
    return;
  }
  localStorage.setItem(TM_KEY_KEY, key);
  localStorage.setItem(TM_CITY_KEY, city);

  tmFetchBtn.disabled = true;
  tmFetchBtn.textContent = 'Fetching…';
  try {
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?city=${encodeURIComponent(city)}&apikey=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Ticketmaster responded with ${res.status}`);
    const data = await res.json();
    const events = data._embedded && data._embedded.events ? data._embedded.events : [];
    tmEvents = events
      .filter(ev => ev.dates && ev.dates.start && ev.dates.start.localDate)
      .map(ev => ({ date: ev.dates.start.localDate, name: ev.name }));
    renderCalendar();
  } catch (err) {
    console.error('Could not load nearby events.', err);
    alert('Could not fetch events. Check your API key and city, then try again.');
  } finally {
    tmFetchBtn.disabled = false;
    tmFetchBtn.textContent = 'Fetch events';
  }
}

/* ---------------- Utilities ---------------- */
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(fromStr, toStr) {
  const from = new Date(fromStr);
  const to = new Date(toStr);
  return Math.round((to - from) / 86400000);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeUrl(raw) {
  if (!raw) return '';
  // If someone types "example.com" instead of "https://example.com",
  // add a protocol so it stays a clickable, valid URL rather than
  // failing server-side validation or the browser's own url input.
  if (!/^https?:\/\//i.test(raw)) {
    return `https://${raw}`;
  }
  return raw;
}

init();
