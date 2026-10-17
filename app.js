const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

// ---- Storage: IndexedDB with synchronous & persistent localStorage fallback for Safari private browsing / quota limits ----
const memStore = new Map();
const ls = {
  get: k => {
    try {
      const v = localStorage.getItem('lift_' + k);
      return v ? JSON.parse(v) : undefined;
    } catch {
      return memStore.get(k);
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem('lift_' + k, JSON.stringify(v));
    } catch {
      memStore.set(k, v);
    }
  }
};

const db = new Promise(resolve => {
  try {
    if (!('indexedDB' in window)) return resolve(null);
    const r = indexedDB.open('lift', 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('kv')) {
        r.result.createObjectStore('kv');
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
  } catch {
    resolve(null);
  }
});

const get = async k => {
  try {
    const d = await db;
    if (!d) return ls.get(k);
    return await new Promise(res => {
      try {
        const t = d.transaction('kv', 'readonly');
        const q = t.objectStore('kv').get(k);
        t.oncomplete = () => res(q.result !== undefined ? q.result : ls.get(k));
        t.onerror = () => res(ls.get(k));
        t.onabort = () => res(ls.get(k));
      } catch {
        res(ls.get(k));
      }
    });
  } catch {
    return ls.get(k);
  }
};

const put = async (k, v) => {
  ls.set(k, v);
  try {
    const d = await db;
    if (!d) return;
    return await new Promise(res => {
      try {
        const t = d.transaction('kv', 'readwrite');
        t.objectStore('kv').put(v, k);
        t.oncomplete = () => res();
        t.onerror = () => res();
        t.onabort = () => res();
      } catch {
        res();
      }
    });
  } catch {
    // Fallback already saved in ls
  }
};

let S = {
  routines: [],
  logs: [],
  weights: [],
  cfg: { rest: 90, flash: true },
  act: null
};

let view = 'train', P, E, U, wl, ac, tt;
const save = (...k) => Promise.all(k.map(x => put(x, S[x])));

// ---- Air-Gapped Exercise Database ----
let EXDB = [];
let EXIDX = {};

const mapBodyPartToGroup = bp => {
  const b = String(bp || '').toLowerCase();
  if (b.includes('chest')) return 'Chest';
  if (b.includes('back')) return 'Back';
  if (b.includes('arm')) return 'Arms';
  if (b.includes('leg')) return 'Legs';
  if (b.includes('shoulder')) return 'Shoulders';
  if (b.includes('waist') || b.includes('neck') || b.includes('abs')) return 'Core';
  if (b.includes('cardio')) return 'Cardio';
  return 'Core';
};

const normalizeExercise = e => {
  const isCardio = e.bp === 'cardio';
  const isBodyweight = e.eq === 'body weight';
  return {
    id: String(e.id || '').replace(/[^a-zA-Z0-9_-]/g, ''),
    name: String(e.n || e.name || e.id || ''),
    g: mapBodyPartToGroup(e.bp || e.g),
    bp: String(e.bp || 'waist'),
    eq: String(e.eq || 'body weight'),
    tg: String(e.tg || ''),
    sec: Array.isArray(e.sm || e.sec) ? (e.sm || e.sec).map(String) : [],
    st: Array.isArray(e.st) ? e.st.map(String) : [],
    img: String(e.img || '').replace(/[^a-zA-Z0-9_.-]/g, ''),
    gif: String(e.gif || '').replace(/[^a-zA-Z0-9_.-]/g, ''),
    t: isCardio ? 't' : (isBodyweight ? 'b' : 'w'),
    u: false
  };
};

const X = id => {
  const sid = String(id || '');
  if (EXIDX[sid]) return EXIDX[sid];
  return {
    id: sid,
    name: sid,
    g: 'Core',
    bp: 'waist',
    eq: 'body weight',
    tg: '',
    sec: [],
    st: [],
    img: '',
    gif: '',
    t: 'w',
    u: false
  };
};

// ---- Icons ----
const IC = {
  act: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  weight: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  sl: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  chk: '<polyline points="20 6 9 17 4 12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
};
const ic = (n, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[n] || ''}</svg>`;

// ---- Muscle Map ----
const MM = [
  ['Shoulders', '<ellipse cx="30" cy="38" rx="9" ry="7"/><ellipse cx="70" cy="38" rx="9" ry="7"/><ellipse cx="130" cy="38" rx="9" ry="7"/><ellipse cx="170" cy="38" rx="9" ry="7"/>'],
  ['Chest', '<rect x="36" y="34" width="28" height="18" rx="6"/>'],
  ['Arms', '<rect x="17" y="46" width="9" height="36" rx="4"/><rect x="74" y="46" width="9" height="36" rx="4"/><rect x="117" y="46" width="9" height="36" rx="4"/><rect x="174" y="46" width="9" height="36" rx="4"/>'],
  ['Core', '<rect x="38" y="55" width="24" height="30" rx="6"/>'],
  ['Legs', '<rect x="36" y="89" width="13" height="52" rx="6"/><rect x="51" y="89" width="13" height="52" rx="6"/><rect x="136" y="89" width="13" height="52" rx="6"/><rect x="151" y="89" width="13" height="52" rx="6"/>'],
  ['Back', '<rect x="134" y="34" width="32" height="44" rx="8"/>']
];
const mmap = (p = [], q = []) => `<svg class="mm" viewBox="0 0 200 150"><g class="bd"><circle cx="50" cy="16" r="10"/><circle cx="150" cy="16" r="10"/></g>${MM.map(([g, s]) => `<g class="${p.includes(g) ? 'p' : q.includes(g) ? 's' : ''}">${s}</g>`).join('')}</svg>`;
const mmLog = l => {
  const p = [...new Set(l.ex.map(x => X(x.id).g))];
  return mmap(p, [...new Set(l.ex.flatMap(x => X(x.id).sec.map(mapBodyPartToGroup)))].filter(g => !p.includes(g)));
};

// ---- Math & Progression Engine ----
const rd = n => Math.round((Number(n) || 0) * 10) / 10;
const e1 = (w, r) => {
  w = Number(w); r = Number(r);
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) return 0;
  return rd(r === 1 ? w : w * (1 + r / 30));
};
const br = (w, r) => {
  w = Number(w); r = Number(r);
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0 || r >= 37) return 0;
  return rd(r === 1 ? w : (w * 36) / (37 - r));
};

const scoreSet = (id, s) => {
  const e = X(id);
  const w = Number(s?.w) || 0;
  const r = Number(s?.r) || 0;
  if (r <= 0) return 0;
  if (e.t === 't') return r;
  if (e.t === 'b') return w > 0 ? e1(w, r) + 1000 : r;
  return e1(w, r);
};

const bestSet = id => {
  let b = null, m = -1;
  for (const l of S.logs) {
    for (const x of l.ex) {
      if (String(x.id) === String(id) && Array.isArray(x.sets)) {
        for (const s of x.sets) {
          const v = scoreSet(id, s);
          if (v > m) { m = v; b = s; }
        }
      }
    }
  }
  return b;
};

const best = id => {
  const b = bestSet(id);
  return b ? scoreSet(id, b) : 0;
};

const lastSet = id => {
  for (let i = S.logs.length - 1; i >= 0; i--) {
    const x = S.logs[i].ex.find(x => String(x.id) === String(id));
    if (x && x.sets && x.sets.length) return x.sets[0];
  }
  return null;
};

const dk = t => {
  const d = new Date(t);
  return d.getFullYear() * 1e4 + (d.getMonth() + 1) * 100 + d.getDate();
};

function streak() {
  const s = new Set(S.logs.map(l => dk(l.date)));
  const d = new Date();
  let n = 0;
  if (!s.has(dk(d))) d.setDate(d.getDate() - 1);
  while (s.has(dk(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function prog(rx, sets) {
  rx.inc = Number(rx.inc) || 2.5;
  rx.w = Number(rx.w) || 0;
  rx.stalls = Number(rx.stalls) || 0;
  rx.sets = Number(rx.sets) || 3;
  rx.reps = Number(rx.reps) || 5;
  rx.reps2 = Math.max(rx.reps, Number(rx.reps2) || rx.reps);
  rx.cur = Number(rx.cur) || rx.reps;

  const need = rx.prog === 'double' ? rx.cur : rx.reps;
  const d = sets.filter(s => s && s.done);
  const R = n => Math.round(n / 2.5) * 2.5;
  const ok = d.length >= rx.sets && d.every(s => (Number(s.r) || 0) >= need);

  if (ok) {
    rx.stalls = 0;
    if (rx.prog === 'double') {
      if (rx.cur >= rx.reps2) {
        rx.w = rd(rx.w + rx.inc);
        rx.cur = rx.reps;
        return `Weight up to ${rx.w} kg (${rx.reps} reps)`;
      }
      rx.cur++;
      return `Target up to ${rx.cur} reps`;
    }
    const lastR = d.length ? (Number(d.at(-1)?.r) || 0) : 0;
    const isDoubleBump = rx.prog === 'gslp' && lastR >= 2 * rx.reps;
    rx.w = rd(rx.w + rx.inc + (isDoubleBump ? rx.inc : 0));
    return `Weight up to ${rx.w} kg${isDoubleBump ? ' (double bump)' : ''}`;
  }

  rx.stalls++;
  const stallLimit = rx.prog === 'gslp' ? 1 : 3;
  if (rx.stalls >= stallLimit) {
    rx.w = Math.max(0, rd(R(rx.w * 0.9)));
    rx.stalls = 0;
    if (rx.prog === 'double') rx.cur = rx.reps;
    return `Deload 10% to ${rx.w} kg`;
  }
  return `Stall ${rx.stalls}/${stallLimit}`;
}

// ---- Rest Timer, Audio & Wake Lock ----
const T = { end: 0, iv: 0 };

const unlock = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!ac) ac = new AudioCtx();
    if (ac.state === 'suspended') ac.resume();
    // Warm up iOS audio pipeline with a silent 1-sample buffer
    const buf = ac.createBuffer(1, 1, 22050);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    src.start(0);
  } catch {}
};

const beep = () => {
  try {
    if (!ac) unlock();
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume();
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g);
    g.connect(ac.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.3, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.7);
    o.start();
    o.stop(ac.currentTime + 0.7);
  } catch {}
};

function startRest(s) {
  unlock();
  T.end = Date.now() + Math.max(1, s) * 1000;
  clearInterval(T.iv);
  T.iv = setInterval(tick, 250);
  $('#rest').hidden = false;
  tick();
}

function tick() {
  const l = Math.ceil((T.end - Date.now()) / 1000);
  if (l <= 0) {
    stopRest();
    beep();
    navigator.vibrate?.([200, 100, 200]);
    if (S.cfg.flash) {
      document.body.classList.remove('flash');
      void document.body.offsetWidth;
      document.body.classList.add('flash');
    }
    return;
  }
  $('#rest b').textContent = Math.floor(l / 60) + ':' + String(l % 60).padStart(2, '0');
}

const stopRest = () => {
  clearInterval(T.iv);
  $('#rest').hidden = true;
};

const wake = async () => {
  try {
    if ('wakeLock' in navigator) {
      wl = await navigator.wakeLock.request('screen');
    }
  } catch {}
};

document.addEventListener('visibilitychange', () => {
  if (S.act && document.visibilityState === 'visible') wake();
});

// ---- UI Helpers ----
const modal = h => {
  $('#m').innerHTML = `<div class="sheet"><button class="x" data-a="close">Close</button>${h}</div>`;
  $('#m').hidden = false;
};
const close = () => {
  $('#m').hidden = true;
  $('#m').innerHTML = '';
};
const toast = (m, u) => {
  const t = $('#toast');
  U = u;
  t.innerHTML = `<span>${esc(m)}</span>` + (u ? '<button data-a="undo">Undo</button>' : '');
  t.className = 'show';
  clearTimeout(tt);
  tt = setTimeout(() => { t.className = ''; }, 4000);
};

const newSets = (id, n = 3) => {
  const l = lastSet(id);
  const defReps = X(id).t === 't' ? 30 : 8;
  return Array.from({ length: Math.max(1, n) }, () => ({
    w: l ? l.w : 0,
    r: l ? l.r : defReps,
    rpe: '',
    done: false
  }));
};

// ---- State for Library Filters & Calendar ----
let libQuery = '';
let libCategory = 'All';
let libEquipment = 'All';
let libPageSize = 40;
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let calSelectedDate = new Date().toISOString().slice(0, 10);

const BP_CATEGORIES = ['All', 'Chest', 'Back', 'Arms', 'Legs', 'Shoulders', 'Core', 'Cardio'];
const EQ_OPTIONS = ['All', 'body weight', 'barbell', 'dumbbell', 'cable', 'leverage machine', 'weighted', 'band', 'kettlebell', 'medicine ball', 'smith machine'];

// ---- Views ----

// 1. Train View
const vTrain = () => `<h1>Train</h1><div class="card row"><span><b>${streak()}</b> day streak 🔥</span><span class="t2">${S.logs.length} workouts</span></div>` +
  (S.act ? `<button class="btn" data-a="tab" data-k="work">Resume: ${esc(S.act.name)}</button>` : '') +
  '<h2>Routines</h2>' +
  S.routines.map(r => `<div class="card"><div class="row"><b>${esc(r.name)}</b><span class="t2">${r.ex.length} exercises</span></div><div class="t2 sm">${r.ex.map(x => esc(X(x.id).name) + ' ' + x.sets + '×' + x.reps + ' @ ' + x.w + ' kg').join(' · ')}</div><div class="row g"><button class="btn" data-a="start" data-id="${esc(r.id)}">Start</button><button class="btn s" data-a="edit" data-id="${esc(r.id)}">Edit</button></div></div>`).join('') +
  `<button class="btn s" data-a="edit">${ic('plus', 18)} New routine</button><button class="btn s" data-a="start">Empty workout</button>`;

// 2. Active Workout View
function vWork() {
  const a = S.act;
  if (!a) { view = 'train'; return vTrain(); }
  return `<div class="row"><h1>${esc(a.name)}</h1><button class="btn" data-a="fin">Finish</button></div>` +
    a.ex.map((x, i) => {
      const e = X(x.id);
      const r = (f, v, u) => `<input type="number" inputmode="decimal" data-f="${f}" data-i="${i}" data-j="@" value="${v}"><span class="u">${u}</span>`;
      return `<div class="card ${x.ss ? 'ss' : ''}"><div class="row"><b>${esc(e.name)}</b><button class="chip ${x.ss ? 'on' : ''}" data-a="ss" data-i="${i}">Superset</button></div><div class="t2 sm">${esc(e.g)}${e.t === 't' ? ' · seconds' : ''}</div>` +
        x.sets.map((s, j) => `<div class="set ${s.done ? 'd' : ''}" data-i="${i}" data-j="${j}"><button class="n" data-a="done" data-i="${i}" data-j="${j}">${j + 1}</button>${(e.t === 't' ? '' : r('w', s.w, e.t === 'b' ? '+kg' : 'kg')) + r('r', s.r, e.t === 't' ? 'sec' : 'reps')}<input class="rpe" type="number" inputmode="decimal" placeholder="RPE" data-f="rpe" data-i="${i}" data-j="@" value="${esc(s.rpe ?? '')}"><button class="ck ${s.done ? 'd' : ''}" data-a="done" data-i="${i}" data-j="${j}">${ic('chk', 18)}</button></div>`.replace(/data-j="@"/g, `data-j="${j}"`)).join('') +
        `<button class="btn s" data-a="addset" data-i="${i}">${ic('plus', 18)} Duplicate set</button><input class="note" placeholder="Notes" data-f="note" data-i="${i}" value="${esc(x.note || '')}"></div>`;
    }).join('') +
    '<button class="btn s" data-a="addex">Add exercise</button><button class="btn s red" data-a="cancel">Discard workout</button>';
}

// 3. Air-Gapped Exercise Library View
const filterExercises = () => {
  const q = libQuery.trim().toLowerCase();
  return EXDB.filter(e => {
    if (libCategory !== 'All' && e.g !== libCategory) return false;
    if (libEquipment !== 'All' && e.eq !== libEquipment) return false;
    if (q) {
      const matchName = e.name.toLowerCase().includes(q);
      const matchTg = e.tg.toLowerCase().includes(q);
      const matchEq = e.eq.toLowerCase().includes(q);
      return matchName || matchTg || matchEq;
    }
    return true;
  });
};

function vLib() {
  const filtered = filterExercises();
  const visible = filtered.slice(0, libPageSize);

  return `<h1>Library</h1>` +
    `<input class="txt" placeholder="Search 1,300+ exercises..." data-f="libsearch" value="${esc(libQuery)}">` +
    `<div class="chips">${BP_CATEGORIES.map(c => `<button class="chip ${libCategory === c ? 'on' : ''}" data-a="libcat" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` +
    `<div class="row" style="margin-bottom:12px"><label class="t2 sm" style="flex:1">Equipment:<select data-f="libeq">${EQ_OPTIONS.map(eq => `<option value="${esc(eq)}" ${libEquipment === eq ? 'selected' : ''}>${esc(eq.toUpperCase())}</option>`).join('')}</select></label><span class="t2 sm" style="align-self:flex-end;margin-bottom:10px">${filtered.length} exercises</span></div>` +
    `<div class="card" style="padding:0 12px">${visible.map(e => `
      <div class="ex-row" data-a="libex" data-id="${esc(e.id)}">
        <img class="ex-thumb" src="./media/${esc(e.img || e.gif)}" alt="${esc(e.name)}" loading="lazy" onerror="this.style.display='none'">
        <div class="ex-info">
          <div class="ex-name">${esc(e.name)}</div>
          <div class="ex-meta">${esc(e.tg || e.g)} · ${esc(e.eq)}</div>
        </div>
      </div>
    `).join('')}</div>` +
    (visible.length < filtered.length ? `<button class="btn s" data-a="libmore">Load more (${filtered.length - visible.length} remaining)</button>` : '');
}

// 4. Interactive Calendar View
function vCal() {
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const totalDays = new Date(calYear, calMonth + 1, 0).getDate();
  const prevMonthTotalDays = new Date(calYear, calMonth, 0).getDate();
  const monthName = new Date(calYear, calMonth, 1).toLocaleString('default', { month: 'long', year: 'numeric' });

  // Map of completed workout dates
  const workoutDates = new Set(S.logs.map(l => new Date(l.date).toISOString().slice(0, 10)));
  const todayStr = new Date().toISOString().slice(0, 10);

  // Calendar cells
  let cells = [];
  // Prev month padding
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevMonthTotalDays - i;
    cells.push(`<div class="cal-day other">${d}</div>`);
  }
  // Current month days
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const isSel = dateStr === calSelectedDate;
    const hasW = workoutDates.has(dateStr);
    cells.push(`<button class="cal-day ${isToday ? 'today' : ''} ${hasW ? 'has-w' : ''} ${isSel ? 'sel' : ''}" data-a="calsel" data-date="${esc(dateStr)}">${d}</button>`);
  }

  // Workouts for selected date
  const selLogs = S.logs.filter(l => new Date(l.date).toISOString().slice(0, 10) === calSelectedDate);
  const selDateDisplay = new Date(calSelectedDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  return `<h1>Calendar</h1>` +
    `<div class="card row"><span><b>${streak()}</b> Day Active Streak 🔥</span><span class="t2">${workoutDates.size} active days</span></div>` +
    `<div class="card">` +
      `<div class="cal-nav">` +
        `<button data-a="calprev">‹</button>` +
        `<b>${esc(monthName)}</b>` +
        `<button data-a="calnext">›</button>` +
      `</div>` +
      `<div class="cal-grid">` +
        ['S','M','T','W','T','F','S'].map(d => `<div class="cal-day-name">${d}</div>`).join('') +
        cells.join('') +
      `</div>` +
    `</div>` +
    `<h2>${esc(selDateDisplay)}</h2>` +
    (selLogs.length ? selLogs.map(l => `
      <div class="card">
        <div class="row"><b>${esc(l.name)}</b><span class="t2 sm">${Math.round(l.dur / 60000)} min · ${vol(l)} kg volume</span></div>
        <div class="t2 sm" style="margin-top:6px">${l.ex.map(x => `${esc(X(x.id).name)} (${x.sets.length} sets)`).join(' · ')}</div>
      </div>
    `).join('') : '<p class="t2">No workouts logged on this date.</p>');
}

// 5. Body Weight Tracker & SVG Line Chart
function vWeight() {
  const sorted = [...S.weights].sort((a, b) => a.t - b.t);
  const current = sorted.length ? sorted.at(-1).w : null;
  const weightsArr = sorted.map(x => x.w);
  const minW = sorted.length ? Math.min(...weightsArr) : 0;
  const maxW = sorted.length ? Math.max(...weightsArr) : 0;
  const todayStr = new Date().toISOString().slice(0, 10);

  // SVG Chart calculation
  let chartSvg = '';
  if (sorted.length >= 2) {
    const W = 340, H = 160, pad = 24;
    const rangeW = (maxW - minW) || 1;
    const getX = (idx, total) => pad + (idx / (total - 1)) * (W - 2 * pad);
    const getY = val => H - pad - ((val - minW) / rangeW) * (H - 2 * pad);

    const points = sorted.map((d, i) => `${getX(i, sorted.length)},${getY(d.w)}`);
    const pathD = `M ` + points.join(' L ');
    const areaD = `${pathD} L ${getX(sorted.length - 1, sorted.length)},${H - pad} L ${pad},${H - pad} Z`;

    chartSvg = `
      <svg class="svg-chart" viewBox="0 0 ${W} ${H}">
        <defs>
          <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0A84FF" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#0A84FF" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--bd)" stroke-width="1"/>
        <line x1="${pad}" y1="${pad}" x2="${W - pad}" y2="${pad}" stroke="var(--bd)" stroke-width="0.5" stroke-dasharray="4"/>
        <path d="${areaD}" fill="url(#wg)"/>
        <path d="${pathD}" fill="none" stroke="var(--ac)" stroke-width="2.5" stroke-linecap="round"/>
        ${sorted.map((d, i) => `<circle cx="${getX(i, sorted.length)}" cy="${getY(d.w)}" r="3.5" fill="#FFFFFF" stroke="var(--ac)" stroke-width="2"/>`).join('')}
      </svg>
    `;
  }

  return `<h1>Body Weight</h1>` +
    `<div class="stat-grid">` +
      `<div class="stat-box"><div class="stat-val">${current != null ? Number(current).toFixed(1) : '--'}</div><div class="stat-lbl">Current (kg)</div></div>` +
      `<div class="stat-box"><div class="stat-val">${minW ? Number(minW).toFixed(1) : '--'}</div><div class="stat-lbl">Lowest</div></div>` +
      `<div class="stat-box"><div class="stat-val">${maxW ? Number(maxW).toFixed(1) : '--'}</div><div class="stat-lbl">Highest</div></div>` +
    `</div>` +
    `<div class="card">` +
      `<b>Trend Chart</b>` +
      (chartSvg || '<p class="t2 sm" style="margin:20px 0">Log at least 2 entries to display trend chart.</p>') +
    `</div>` +
    `<h2>Log Weight</h2>` +
    `<div class="card">` +
      `<div class="row">` +
        `<input type="number" step="0.1" inputmode="decimal" id="wt-input" placeholder="Weight (kg)" style="width:50%">` +
        `<input type="date" id="wt-date" value="${esc(todayStr)}" style="width:45%">` +
      `</div>` +
      `<button class="btn" data-a="logweight" style="margin-top:10px">Save Weight Entry</button>` +
    `</div>` +
    `<h2>History</h2>` +
    `<div class="card" style="padding:0 14px">` +
      (sorted.length ? [...sorted].reverse().map((item, idx, arr) => {
        const next = arr[idx + 1];
        let diffHtml = '';
        if (next) {
          const diff = rd(item.w - next.w);
          if (diff > 0) diffHtml = `<span class="diff-tag up">+${diff} kg</span>`;
          else if (diff < 0) diffHtml = `<span class="diff-tag down">${diff} kg</span>`;
          else diffHtml = `<span class="diff-tag same">0 kg</span>`;
        }
        return `
          <div class="weight-row">
            <div>
              <div class="weight-val">${Number(item.w).toFixed(1)} kg</div>
              <div class="t2 sm">${esc(item.date)}</div>
            </div>
            <div class="row" style="gap:8px">
              ${diffHtml}
              <button class="x" data-a="delweight" data-id="${esc(item.id)}">${ic('trash', 18)}</button>
            </div>
          </div>
        `;
      }).join('') : '<p class="t2 sm" style="padding:14px 0">No body weight entries yet.</p>') +
    `</div>`;
}

// 6. History & Settings View
const vol = l => Math.round(l.ex.reduce((a, x) => a + (Array.isArray(x.sets) ? x.sets.reduce((b, s) => b + (Number(s.w) || 0) * (Number(s.r) || 0), 0) : 0), 0));

const vHist = () => `<h1>History & Settings</h1>` +
  `<h2>Workout History</h2>` +
  (S.logs.length ? [...S.logs].reverse().map(l => `<button class="card" data-a="hist" data-id="${esc(l.id)}"><div class="row"><b>${esc(l.name)}</b><span class="t2 sm">${new Date(l.date).toLocaleDateString()}</span></div><div class="t2 sm">${Math.round(l.dur / 60000)} min · ${vol(l)} kg volume · ${l.ex.length} exercises</div></button>`).join('') : '<p class="t2">No workouts yet.</p>') +
  `<h2>Preferences</h2>` +
  `<div class="card"><label class="t2 sm">Rest timer (seconds)</label><input type="number" inputmode="numeric" data-c="rest" value="${Number(S.cfg.rest) || 90}"><label class="row g" style="cursor:pointer;min-height:44px"><span>Visual flash when rest ends</span><input type="checkbox" data-c="flash" ${S.cfg.flash ? 'checked' : ''}></label></div>` +
  `<h2>Data Management</h2>` +
  `<button class="btn" data-a="exp">Export Backup (JSON)</button><label class="btn s">Restore Backup (JSON)<input type="file" id="f" accept="application/json,.json" hidden></label><button class="btn s red" data-a="wipe">Erase all data</button><p class="t2 sm">All data is 100% on-device & air-gapped.</p>`;

function render() {
  const v = $('#v'), y = v.scrollTop;
  v.innerHTML = ({
    train: vTrain,
    work: vWork,
    lib: vLib,
    cal: vCal,
    weight: vWeight,
    hist: vHist
  })[view]();
  v.scrollTop = y;

  $('#tabs').innerHTML = [
    ['train', 'act', 'Train'],
    ['lib', 'list', 'Library'],
    ['cal', 'cal', 'Calendar'],
    ['weight', 'weight', 'Weight'],
    ['hist', 'clock', 'History']
  ].map(([k, i, t]) => `<button data-a="tab" data-k="${k}" class="${view === k || (view === 'work' && k === 'train') ? 'on' : ''}">${ic(i)}<span>${t}</span></button>`).join('');
}

// ---- Exercise Details Modal ----
function showExerciseModal(ex) {
  const b = bestSet(ex.id);
  let bestHtml = '';
  if (b) {
    if (ex.t === 't') {
      bestHtml = `<div class="card">Best: <b>${Number(b.r) || 0} sec</b></div>`;
    } else if (ex.t === 'b') {
      bestHtml = `<div class="card">Best: <b>${b.w > 0 ? '+' + (Number(b.w) || 0) + ' kg × ' : ''}${Number(b.r) || 0} reps</b>${b.w > 0 ? `<br>Epley 1RM: <b>+${rd(e1(b.w, b.r))} kg</b>` : ''}</div>`;
    } else {
      bestHtml = `<div class="card">Best: <b>${Number(b.w) || 0} kg × ${Number(b.r) || 0}</b><br>Epley 1RM: <b>${rd(e1(b.w, b.r))} kg</b> · Brzycki 1RM: <b>${rd(br(b.w, b.r))} kg</b></div>`;
    }
  }

  const mediaSrc = `./media/${esc(ex.gif || ex.img)}`;

  modal(`
    <h2>${esc(ex.name)}</h2>
    <div>
      <span class="ex-badge ac">${esc(ex.g)}</span>
      <span class="ex-badge">${esc(ex.eq)}</span>
      ${ex.tg ? `<span class="ex-badge">Target: ${esc(ex.tg)}</span>` : ''}
    </div>
    <img class="ex-modal-gif" src="${mediaSrc}" alt="${esc(ex.name)}" onerror="this.style.display='none'">
    ${ex.sec && ex.sec.length ? `<div class="t2 sm" style="margin-bottom:8px">Secondary: ${esc(ex.sec.join(', '))}</div>` : ''}
    ${bestHtml}
    ${ex.st && ex.st.length ? `<b>Instructions:</b><ol class="ex-steps">${ex.st.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${S.act ? `<button class="btn" data-a="addextoworkout" data-id="${esc(ex.id)}">Add to Active Workout</button>` : ''}
  `);
}

// ---- Routine Editor ----
function showE() {
  modal(`<h2>${E.isNew ? 'New' : 'Edit'} routine</h2><input class="txt" data-e="name" placeholder="Routine name" value="${esc(E.name)}">` +
    E.ex.map((x, i) => `<div class="card"><div class="row"><b>${esc(X(x.id).name)}</b><button class="chip" data-a="rmx" data-i="${i}">Remove</button></div><div class="grid">` +
      [['sets', 'Sets'], ['reps', 'Reps'], ['reps2', 'Top reps (double)'], ['w', 'Start weight (kg)'], ['inc', 'Increase (kg)']].map(([f, l]) => `<label>${l}<input type="number" inputmode="decimal" data-e="${f}" data-i="${i}" value="${x[f]}"></label>`).join('') +
      `<label>Progression<select data-e="prog" data-i="${i}">${[['linear', 'Linear'], ['gslp', 'Greyskull LP'], ['double', 'Double']].map(([v, l]) => `<option value="${v}"${x.prog === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div></div>`).join('') +
    `<button class="btn s" data-a="adde">Add exercise</button><button class="btn" data-a="savee">Save</button>` +
    (E.isNew ? '' : '<button class="btn s red" data-a="delr">Delete routine</button>'));
}

// ---- Backup & Security Hardened Validation ----
const MAX_BACKUP_SIZE = 5 * 1024 * 1024; // 5 MB maximum

const valid = o => {
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.app !== 'lift' || o.v !== 1) return false;
  if (!Array.isArray(o.routines) || !Array.isArray(o.logs)) return false;
  if (o.routines.length > 500 || o.logs.length > 5000) return false;
  if (o.weights && (!Array.isArray(o.weights) || o.weights.length > 5000)) return false;

  const validRoutine = r => (
    r && typeof r === 'object' && !Array.isArray(r) &&
    typeof r.id === 'string' && r.id.length <= 100 &&
    typeof r.name === 'string' && r.name.length <= 200 &&
    Array.isArray(r.ex) && r.ex.length <= 100 &&
    r.ex.every(x => (
      x && typeof x === 'object' && !Array.isArray(x) &&
      typeof x.id === 'string' && x.id.length <= 100 &&
      Number.isFinite(x.w) &&
      Number.isFinite(x.sets) &&
      Number.isFinite(x.reps)
    ))
  );

  const validLog = l => (
    l && typeof l === 'object' && !Array.isArray(l) &&
    typeof l.id === 'string' && l.id.length <= 100 &&
    typeof l.name === 'string' && l.name.length <= 200 &&
    Number.isFinite(l.date) &&
    Array.isArray(l.ex) && l.ex.length <= 100 &&
    l.ex.every(x => (
      x && typeof x === 'object' && !Array.isArray(x) &&
      typeof x.id === 'string' && x.id.length <= 100 &&
      Array.isArray(x.sets) && x.sets.length <= 50 &&
      x.sets.every(s => s && typeof s === 'object' && !Array.isArray(s) && Number.isFinite(s.w) && Number.isFinite(s.r))
    ))
  );

  const validWeight = w => (
    w && typeof w === 'object' && !Array.isArray(w) &&
    typeof w.id === 'string' && w.id.length <= 100 &&
    typeof w.date === 'string' && w.date.length <= 20 &&
    Number.isFinite(w.w) && w.w > 0 && w.w < 500
  );

  if (!o.routines.every(validRoutine) || !o.logs.every(validLog)) return false;
  if (o.weights && !o.weights.every(validWeight)) return false;

  return true;
};

function exp() {
  const b = new Blob([JSON.stringify({ app: 'lift', v: 1, exported: Date.now(), routines: S.routines, logs: S.logs, weights: S.weights, cfg: S.cfg }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `lift-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 9e3);
}

async function imp(f) {
  try {
    if (!f || f.size > MAX_BACKUP_SIZE) {
      throw new Error('File exceeds maximum allowable size (5MB)');
    }
    const text = await f.text();

    // Reject prototype pollution vectors immediately
    if (/["'](?:__proto__|constructor|prototype)["']\s*:/i.test(text)) {
      throw new Error('Prototype pollution sequence detected');
    }

    const o = JSON.parse(text, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new Error('Prototype pollution detected');
      }
      return value;
    });

    if (!valid(o)) throw new Error('Invalid schema structure');
    if (!confirm('Replace all current data with this backup?')) return;

    // Deep sanitize & reconstruct objects with strictly whitelisted properties
    S.routines = o.routines.map(r => ({
      id: String(r.id).slice(0, 50),
      name: String(r.name).slice(0, 100),
      ex: r.ex.map(x => ({
        id: String(x.id).slice(0, 50),
        sets: Math.max(1, Math.min(50, parseInt(x.sets, 10) || 1)),
        reps: Math.max(1, Math.min(200, parseInt(x.reps, 10) || 1)),
        reps2: Math.max(1, Math.min(200, parseInt(x.reps2, 10) || parseInt(x.reps, 10) || 1)),
        w: Math.max(0, Math.min(1000, parseFloat(x.w) || 0)),
        inc: Math.max(0.25, Math.min(50, parseFloat(x.inc) || 2.5)),
        prog: ['linear', 'gslp', 'double'].includes(x.prog) ? x.prog : 'linear',
        cur: Math.max(1, Math.min(200, parseInt(x.cur, 10) || parseInt(x.reps, 10) || 1)),
        stalls: Math.max(0, Math.min(10, parseInt(x.stalls, 10) || 0)),
        ss: Boolean(x.ss)
      }))
    }));

    S.logs = o.logs.map(l => ({
      id: String(l.id).slice(0, 50),
      date: Number(l.date) || Date.now(),
      name: String(l.name).slice(0, 100),
      dur: Math.max(0, Number(l.dur) || 0),
      ex: l.ex.map(x => ({
        id: String(x.id).slice(0, 50),
        note: String(x.note || '').slice(0, 500),
        sets: x.sets.map(s => ({
          w: Math.max(0, Math.min(1000, Number(s.w) || 0)),
          r: Math.max(0, Math.min(500, Number(s.r) || 0)),
          rpe: s.rpe != null && s.rpe !== '' && !isNaN(+s.rpe) ? Math.min(10, Math.max(1, +s.rpe)) : null
        }))
      }))
    }));

    if (Array.isArray(o.weights)) {
      S.weights = o.weights.map(w => ({
        id: String(w.id).slice(0, 50),
        date: String(w.date).slice(0, 10),
        w: rd(Math.max(10, Math.min(500, Number(w.w) || 70))),
        t: Number(w.t) || new Date(w.date + 'T12:00:00').getTime() || Date.now()
      }));
    }

    if (o.cfg && typeof o.cfg === 'object' && !Array.isArray(o.cfg)) {
      if (Number.isFinite(o.cfg.rest)) S.cfg.rest = Math.max(5, Math.min(600, +o.cfg.rest));
      if (typeof o.cfg.flash === 'boolean') S.cfg.flash = o.cfg.flash;
    }

    await save('routines', 'logs', 'weights', 'cfg');
    toast('Backup restored');
    render();
  } catch (err) {
    console.warn('Backup import blocked:', err.message);
    toast('Invalid backup file');
  }
}

// ---- Finish Workout ----
function finish() {
  const a = S.act;
  if (!a) return;
  const ex = a.ex.map(x => ({
    id: x.id,
    note: x.note || '',
    sets: x.sets.filter(s => s.done).map(s => ({
      w: Number(s.w) || 0,
      r: Number(s.r) || 0,
      rpe: s.rpe === '' || s.rpe == null ? null : +s.rpe
    }))
  })).filter(x => x.sets.length);

  if (!ex.length) return toast('Complete at least one set first');

  const prs = ex.flatMap(x => {
    const o = best(x.id);
    const bestNew = Math.max(...x.sets.map(s => scoreSet(x.id, s)));
    if (o > 0 && bestNew > o) {
      const e = X(x.id);
      if (e.t === 't') return [`${e.name}: new record ${bestNew} sec`];
      if (e.t === 'b' && !x.sets.some(s => s.w > 0)) return [`${e.name}: new record ${bestNew} reps`];
      return [`${e.name}: est. 1RM ${rd(bestNew > 1000 ? bestNew - 1000 : bestNew)} kg`];
    }
    return [];
  });

  const r = S.routines.find(r => r.id === a.rid);
  const notes = [];
  if (r) {
    a.ex.forEach(x => {
      const rx = r.ex.find(q => String(q.id) === String(x.id));
      if (rx && x.sets.some(s => s.done)) notes.push(X(x.id).name + ': ' + prog(rx, x.sets));
    });
  }

  const log = { id: uid(), date: Date.now(), name: a.name, dur: Date.now() - a.t0, ex };
  S.logs.push(log);
  S.act = null;
  save('logs', 'act', 'routines');
  stopRest();
  wl?.release?.();

  modal(`<h2>Workout complete</h2>${mmLog(log)}<p>${vol(log)} kg volume · ${Math.round(log.dur / 60000)} min · ${streak()} day streak</p>` +
    (prs.length ? `<h2>New records</h2>${prs.map(p => `<div>${esc(p)}</div>`).join('')}` : '') +
    (notes.length ? `<h2>Next session</h2>${notes.map(p => `<div class="t2">${esc(p)}</div>`).join('')}` : ''));
  view = 'train';
  render();
}

// ---- Event Listeners ----
document.addEventListener('click', e => {
  unlock();
  const t = e.target.closest('[data-a]');
  if (!t) return;
  const { a, k, id } = t.dataset;
  const i = +t.dataset.i, j = +t.dataset.j;

  switch (a) {
    case 'tab': view = k; close(); break;
    case 'close': close(); return;
    case 'undo': U?.(); $('#toast').className = ''; return;
    case 'r15': T.end += 15000; tick(); return;
    case 'rskip': stopRest(); return;

    // Library category and pagination
    case 'libcat':
      libCategory = t.dataset.cat;
      libPageSize = 40;
      break;
    case 'libmore':
      libPageSize += 40;
      break;
    case 'libex': {
      const ex = X(id);
      showExerciseModal(ex);
      return;
    }
    case 'addextoworkout': {
      if (S.act) {
        S.act.ex.push({ id, ss: false, note: '', sets: newSets(id) });
        save('act');
        close();
        view = 'work';
        toast('Exercise added to workout');
      }
      break;
    }

    // Calendar
    case 'calprev': {
      calMonth--;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      break;
    }
    case 'calnext': {
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
      break;
    }
    case 'calsel':
      calSelectedDate = t.dataset.date;
      break;

    // Body Weight
    case 'logweight': {
      const inp = $('#wt-input');
      const dinp = $('#wt-date');
      const val = parseFloat(inp?.value);
      const dateVal = dinp?.value || new Date().toISOString().slice(0, 10);
      if (Number.isFinite(val) && val > 0 && val < 500) {
        S.weights.push({ id: uid(), date: dateVal, w: rd(val), t: new Date(dateVal + 'T12:00:00').getTime() });
        save('weights');
        inp.value = '';
        toast(`Logged ${rd(val)} kg`);
      } else {
        toast('Please enter a valid weight');
      }
      break;
    }
    case 'delweight': {
      S.weights = S.weights.filter(x => x.id !== id);
      save('weights');
      toast('Entry deleted');
      break;
    }

    // Workout Logger
    case 'start': {
      const r = S.routines.find(r => r.id === id);
      S.act = {
        rid: r ? r.id : null,
        name: r ? r.name : 'Workout',
        t0: Date.now(),
        ex: r ? r.ex.map(x => ({
          id: x.id,
          ss: !!x.ss,
          note: '',
          sets: Array.from({ length: Math.max(1, x.sets || 1) }, () => ({
            w: x.w || 0,
            r: x.prog === 'double' ? (x.cur || x.reps) : x.reps,
            rpe: '',
            done: false
          }))
        })) : []
      };
      save('act');
      wake();
      view = 'work';
      break;
    }
    case 'done': {
      const x = S.act?.ex[i], s = x?.sets[j];
      if (!s) return;
      s.done = !s.done;
      save('act');
      if (s.done && !x.ss) startRest(S.cfg.rest);
      break;
    }
    case 'addset': {
      const x = S.act?.ex[i];
      if (!x) return;
      const prev = x.sets.at(-1) || { w: 0, r: X(x.id).t === 't' ? 30 : 8, rpe: '' };
      x.sets.push({ ...prev, done: false });
      save('act');
      break;
    }
    case 'ss': {
      if (S.act?.ex[i]) {
        S.act.ex[i].ss = !S.act.ex[i].ss;
        save('act');
      }
      break;
    }
    case 'addex': {
      modal(`<h2>Add exercise</h2><input class="txt" placeholder="Search exercises..." data-f="picksearch"><div class="card" id="pick-list" style="max-height:60vh;overflow-y:auto">` +
        EXDB.slice(0, 50).map(e => `<button class="li" data-a="pick" data-id="${esc(e.id)}">${esc(e.name)}</button>`).join('') +
      `</div>`);
      return;
    }
    case 'pick': {
      close();
      if (P) P(id);
      else if (S.act) {
        S.act.ex.push({ id, ss: false, note: '', sets: newSets(id) });
        save('act');
      }
      break;
    }
    case 'fin': finish(); return;
    case 'cancel': if (confirm('Discard this workout?')) { S.act = null; save('act'); stopRest(); view = 'train'; } break;
    case 'hist': {
      const l = S.logs.find(l => String(l.id) === String(id));
      if (!l) return;
      modal(`<h2>${esc(l.name)}</h2>${mmLog(l)}` + l.ex.map(x => `<div class="card"><b>${esc(X(x.id).name)}</b>${x.sets.map((s, n) => `<div class="t2">${n + 1}. ${Number(s.w) || 0} × ${Number(s.r) || 0}${s.rpe != null && s.rpe !== '' ? ' @ RPE ' + esc(s.rpe) : ''}</div>`).join('')}${x.note ? `<div class="sm">${esc(x.note)}</div>` : ''}</div>`).join(''));
      return;
    }
    case 'edit': {
      const r = S.routines.find(r => r.id === id);
      E = r ? JSON.parse(JSON.stringify(r)) : { id: uid(), name: '', ex: [], isNew: 1 };
      showE();
      return;
    }
    case 'adde': {
      P = exId => {
        E.ex.push({ id: exId, sets: 3, reps: 5, reps2: 8, w: 20, inc: 2.5, prog: 'linear', cur: 5, stalls: 0, ss: false });
        showE();
      };
      modal(`<h2>Choose Exercise</h2><input class="txt" placeholder="Search..." data-f="picksearch"><div class="card" id="pick-list" style="max-height:60vh;overflow-y:auto">` +
        EXDB.slice(0, 50).map(e => `<button class="li" data-a="pick" data-id="${esc(e.id)}">${esc(e.name)}</button>`).join('') +
      `</div>`);
      return;
    }
    case 'rmx': E.ex.splice(i, 1); showE(); return;
    case 'savee': {
      E.name = E.name.trim() || 'Routine';
      E.ex.forEach(x => {
        x.sets = Math.max(1, parseInt(x.sets, 10) || 1);
        x.reps = Math.max(1, parseInt(x.reps, 10) || 1);
        x.reps2 = Math.max(x.reps, parseInt(x.reps2, 10) || x.reps);
        x.w = Math.max(0, parseFloat(x.w) || 0);
        x.inc = Math.max(0.25, parseFloat(x.inc) || 2.5);
        x.cur = x.prog === 'double' ? Math.max(x.reps, Math.min(x.cur || x.reps, x.reps2)) : x.reps;
      });
      const n = S.routines.findIndex(r => r.id === E.id), r = { ...E };
      delete r.isNew;
      n < 0 ? S.routines.push(r) : S.routines[n] = r;
      save('routines');
      close();
      break;
    }
    case 'delr': if (confirm('Delete this routine?')) { S.routines = S.routines.filter(r => r.id !== E.id); save('routines'); close(); break; } return;
    case 'exp': exp(); return;
    case 'wipe': if (confirm('Erase ALL data on this device?') && confirm('This cannot be undone. Continue?')) { S.routines = []; S.logs = []; S.weights = []; S.act = null; save('routines', 'logs', 'weights', 'act'); stopRest(); } break;
  }
  render();
});

// Debounced Search and Field Updates
let searchTimeout;
const handleFieldUpdate = t => {
  const i = t.dataset.i, f = t.dataset.f;

  if (f === 'libsearch') {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      libQuery = t.value;
      libPageSize = 40;
      render();
    }, 150);
    return;
  }

  if (f === 'libeq') {
    libEquipment = t.value;
    libPageSize = 40;
    render();
    return;
  }

  if (f === 'picksearch') {
    const list = $('#pick-list');
    if (list) {
      const q = t.value.trim().toLowerCase();
      const results = EXDB.filter(e => e.name.toLowerCase().includes(q) || e.tg.toLowerCase().includes(q)).slice(0, 50);
      list.innerHTML = results.map(e => `<button class="li" data-a="pick" data-id="${esc(e.id)}">${esc(e.name)}</button>`).join('');
    }
    return;
  }

  if (f && S.act && S.act.ex[i]) {
    const x = S.act.ex[i];
    if (f === 'note') x.note = t.value;
    else if (x.sets && x.sets[t.dataset.j]) {
      x.sets[t.dataset.j][f] = f === 'rpe' ? t.value : parseFloat(t.value) || 0;
    }
    save('act');
  }

  if (t.dataset.e && E) {
    const ef = t.dataset.e;
    if (ef === 'name') E.name = t.value;
    else if (E.ex[i]) {
      E.ex[i][ef] = ef === 'prog' ? t.value : parseFloat(t.value) || 0;
    }
  }
};

document.addEventListener('input', e => handleFieldUpdate(e.target));
document.addEventListener('change', e => {
  const t = e.target;
  handleFieldUpdate(t);
  if (t.id === 'f' && t.files[0]) {
    imp(t.files[0]);
    t.value = '';
  }
  if (t.dataset.c) {
    S.cfg[t.dataset.c] = t.type === 'checkbox' ? t.checked : Math.max(5, +t.value || 90);
    save('cfg');
  }
});

// Swipe left on a set row to delete (with undo)
let sw;
document.addEventListener('touchstart', e => {
  unlock();
  const r = e.target.closest('.set');
  sw = r && !e.target.closest('input,button') ? { r, x: e.touches[0].clientX, d: 0 } : null;
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (sw) {
    sw.d = Math.min(0, e.touches[0].clientX - sw.x);
    sw.r.style.transform = `translateX(${sw.d}px)`;
  }
}, { passive: true });

const resetSwipe = () => {
  if (!sw) return;
  const { r, d } = sw;
  sw = null;
  if (d < -90) {
    const i = +r.dataset.i, j = +r.dataset.j;
    const x = S.act?.ex[i];
    if (x && x.sets && x.sets[j]) {
      const [s] = x.sets.splice(j, 1);
      save('act');
      render();
      toast('Set deleted', () => {
        x.sets.splice(j, 0, s);
        save('act');
        render();
      });
    }
  } else {
    r.style.transform = '';
  }
};

document.addEventListener('touchend', resetSwipe);
document.addEventListener('touchcancel', () => {
  if (sw) {
    sw.r.style.transform = '';
    sw = null;
  }
});

// ---- Boot Sequence ----
(async () => {
  // 1. Asynchronously load all 1,324 exercises from local exercises.json
  try {
    const res = await fetch('./exercises.json');
    if (res.ok) {
      const raw = await res.json();
      EXDB = raw.map(normalizeExercise);
      EXIDX = {};
      EXDB.forEach(e => { EXIDX[e.id] = e; });
    }
  } catch (err) {
    console.warn('Local exercises.json load issue:', err);
  }

  // 2. Load stored state from IndexedDB / localStorage
  for (const k of ['routines', 'logs', 'weights', 'cfg', 'act']) {
    try {
      const v = await get(k);
      if (k === 'cfg' && v && typeof v === 'object') {
        S.cfg = { ...S.cfg, ...v };
      } else if (v != null) {
        S[k] = v;
      }
    } catch {
      // Storage fallback absorbs
    }
  }

  // 3. Seed starter routine if fresh install
  if ((await get('seeded')) == null) {
    S.routines = [{
      id: uid(),
      name: 'Full Body A',
      ex: [
        ['0025', 3, 5, 5, 20], // Barbell squat
        ['0047', 3, 5, 5, 20], // Barbell bench press
        ['0027', 3, 5, 5, 30]  // Barbell bent over row
      ].map(([id, sets, reps, reps2, w]) => ({
        id: EXIDX[id] ? id : 'squat',
        sets,
        reps,
        reps2,
        w,
        inc: 2.5,
        prog: 'linear',
        cur: reps,
        stalls: 0,
        ss: false
      }))
    }];
    await save('routines');
    await put('seeded', 1);
  }

  // 4. Check active workout
  if (S.act) {
    view = 'work';
    wake();
  }

  render();
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js');
  }
})();
