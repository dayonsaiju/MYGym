const Calc = (typeof window !== 'undefined' && (window.MYGYM_CALC || window.Calc)) ||
             (typeof globalThis !== 'undefined' && (globalThis.MYGYM_CALC || globalThis.Calc)) ||
             (typeof require === 'function' ? require('./calc.js') : null) || {};

const AIConfig = (typeof window !== 'undefined' && (window.AIConfig || window.MYGYM_AI_CONFIG)) ||
                 (typeof globalThis !== 'undefined' && (globalThis.AIConfig || globalThis.MYGYM_AI_CONFIG)) ||
                 (typeof require === 'function' ? require('./ai-config.js') : null) || {};

const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

class SafeHTML {
  constructor(str) { this.str = String(str ?? ''); }
  toString() { return this.str; }
  valueOf() { return this.str; }
}

const html = (strings, ...values) => {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v instanceof SafeHTML) {
        out += v.str;
      } else if (Array.isArray(v)) {
        out += v.map(item => (item instanceof SafeHTML ? item.str : esc(item))).join('');
      } else if (v === null || v === undefined) {
        // empty interpolation
      } else {
        out += esc(v);
      }
    }
  }
  return new SafeHTML(out);
};
html.raw = str => new SafeHTML(str ?? '');

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
      if (v === null || v === undefined) {
        if (typeof localStorage.removeItem === 'function') {
          try { localStorage.removeItem('lift_' + k); } catch (_) {}
          try { localStorage.removeItem(k); } catch (_) {}
        }
        localStorage.setItem('lift_' + k, JSON.stringify(null));
        memStore.delete(k);
      } else {
        localStorage.setItem('lift_' + k, JSON.stringify(v));
      }
    } catch {
      if (v === null || v === undefined) memStore.delete(k);
      else memStore.set(k, v);
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
        if (v === null || v === undefined) {
          t.objectStore('kv').delete(k);
        } else {
          let val = v;
          try {
            val = JSON.parse(JSON.stringify(v));
          } catch (_) {}
          t.objectStore('kv').put(val, k);
        }
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

// Synchronous Gate Function: permanently prevent redundant onboarding prompts
function isUserOnboarded() {
  try {
    if (typeof localStorage !== 'undefined') {
      if (localStorage.getItem('mygym_onboarded') === 'true') return true;
      if (localStorage.getItem('mygym_shell_onboarded') === 'true') return true;
      if (localStorage.getItem('lift_onboarded') === 'true') return true;
      // If user already has any logged workouts or saved weights, they are onboarded
      const weights = localStorage.getItem('lift_weights');
      if (weights && weights !== '[]' && weights !== 'null') return true;
      const logs = localStorage.getItem('lift_logs');
      if (logs && logs !== '[]' && logs !== 'null') return true;
    }
    if (typeof S !== 'undefined' && S) {
      if (S?.cfg?.onboarded === true || S?.onboarded === true) return true;
      if (Array.isArray(S?.weights) && S.weights.length > 0) return true;
      if (Array.isArray(S?.logs) && S.logs.length > 0) return true;
    }
  } catch (_) {}
  return false;
}
if (typeof window !== 'undefined') window.isUserOnboarded = isUserOnboarded;

const SCHEMA_VERSION = 3;

let S = {
  schemaVersion: SCHEMA_VERSION,
  routines: [],
  logs: [],
  weights: [],
  cfg: {
    rest: 90,
    flash: true,
    sound: true,
    vibrate: true,
    inc: 2.5,
    bodyModel: 'male',
    physique: null,
    dumbbellWeightMode: 'per_hand',
    weekStartDay: 'mon',
    includeBodyweightInVolume: false,
    autoRest: true,
    unit: 'kg'
  },
  sched: {},
  act: ls.get('act') || null,
  deload: { active: false, startedAt: null, lastDeloadDate: null },
  customExercises: ls.get('customExercises') || [],
  nutrition: ls.get('nutrition') || {
    targetCals: 2100,
    targetProtein: 140,
    targetCarbs: 240,
    targetFat: 60,
    targetFiber: 35,
    meals: {}
  }
};

const MIGRATIONS = [
  {
    version: 2,
    name: 'Normalize legacy set types to canonical strings',
    up(state) {
      if (!state || !Array.isArray(state.logs)) return;
      const mapSetType = (t) => {
        if (!t) return 'normal';
        const low = String(t).toLowerCase();
        if (low === 'w' || low === 'warmup') return 'warmup';
        if (low === 'd' || low === 'drop') return 'drop';
        if (low === 'f' || low === 'failure') return 'failure';
        if (low === 'a' || low === 'amrap') return 'amrap';
        return 'normal';
      };
      for (const l of state.logs) {
        if (!l || !Array.isArray(l.ex)) continue;
        for (const x of l.ex) {
          if (!x || !Array.isArray(x.sets)) continue;
          for (const s of x.sets) {
            if (s) s.type = mapSetType(s.type);
          }
        }
      }
    }
  },
  {
    version: 3,
    name: 'Default includeBodyweightInVolume to false and ensure unit is kg',
    up(state) {
      if (!state || !state.cfg || typeof state.cfg !== 'object') {
        if (state) state.cfg = {};
      }
      if (state.cfg.includeBodyweightInVolume === undefined) {
        state.cfg.includeBodyweightInVolume = false;
      }
      if (!state.cfg.unit) {
        state.cfg.unit = 'kg';
      }
    }
  }
];

async function runMigrations(state = S) {
  if (!state) return SCHEMA_VERSION;
  let currentVersion = Number(state.schemaVersion) || 1;
  let mutated = false;
  for (const m of MIGRATIONS) {
    if (m.version > currentVersion) {
      try {
        m.up(state);
        currentVersion = m.version;
        state.schemaVersion = currentVersion;
        mutated = true;
      } catch (err) {
        console.error(`Migration v${m.version} (${m.name}) failed:`, err);
        break;
      }
    }
  }
  if (mutated) {
    try {
      await save('schemaVersion', 'logs', 'cfg');
    } catch (_) {}
  }
  return state.schemaVersion;
}

const APP_VERSION = '7.0.3';
const SHELL_VERSION = 'mygym-core-v7.0.3';

let view = 'train', P, E, U, wl, ac, tt;
let pickQuery = '', pickCategory = 'All', workTimerInterval = null;
let swapQuery = '', swapCategory = 'All', swapIdx = 0;
let bodyMetricView = 'both'; // 'both', 'weight', 'waist'
let bodySubTab = 'physique'; // 'physique', 'nutrition'
let nutritionSelectedDate = (typeof Calc !== 'undefined' && Calc.toLocalDateKey)
  ? Calc.toLocalDateKey(new Date())
  : new Date().toISOString().slice(0, 10);
let histQuery = '', histRoutine = 'All';
let workGifCollapsed = false;
let lastRoutineSyncBackup = null;
let _lastDeletedLog = null;
let _lastDeletedRoutine = null;
let _pendingBackupData = null;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const fmtDur = ms => {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, '0');
  if (m < 60) return `${m}:${sec}`;
  const h = Math.floor(m / 60);
  const min = String(m % 60).padStart(2, '0');
  return `${h}:${min}:${sec}`;
};

const save = (...args) => {
  if (args.length === 2 && typeof args[0] === 'string') {
    const [k, v] = args;
    if (k in S) S[k] = v;
    return put(k, v);
  }
  return Promise.all(args.map(x => {
    if (typeof x === 'string') {
      return put(x, S[x]);
    }
    return Promise.resolve();
  }));
};

// LocalStorage Quota & Backup Housekeeping: keep only 3 most recent emergency snapshots
function pruneEmergencyBackups() {
  if (typeof localStorage === 'undefined') return;
  try {
    const backupKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('backup_act_') || k.startsWith('backup_'))) {
        backupKeys.push(k);
      }
    }
    backupKeys.sort().reverse();
    for (let i = 3; i < backupKeys.length; i++) {
      try { localStorage.removeItem(backupKeys[i]); } catch (_) {}
    }
  } catch (_) {}
}

// Request persistent storage durability if supported
if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

// Clean & sanitize exercise names (fix corrupted degree encodings, typos and title-casing)
const cleanExName = s => {
  let str = String(s || '').trim();
  str = str.replace(/45\s*[вbB]\s*°/gi, '45°')
           .replace(/\b45\s*degrees?\b/gi, '45°')
           .replace(/\ball fours squad stretch\b/gi, 'All Fours Quad Stretch');
  if (str && (str === str.toLowerCase() || str === str.toUpperCase())) {
    str = str.toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
  }
  return str;
};

// ---- Air-Gapped Exercise Database & Global Singletons ----
const _global = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : global);
if (typeof window !== 'undefined') {
  window.__EXDB__ = window.__EXDB__ || [];
  window.__EXIDX__ = window.__EXIDX__ || new Map();
}
_global.__EXDB__ = _global.__EXDB__ || [];
_global.__EXIDX__ = _global.__EXIDX__ || new Map();

let EXDB = _global.__EXDB__;
let EXIDX = _global.__EXIDX__;

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
  const kind = e.kind || (e.bp === 'cardio' || e.t === 't' ? 'cardio' : (e.eq === 'body weight' || e.t === 'b' ? 'bodyweight' : 'strength'));
  const isCardio = kind === 'cardio' || kind === 'timed';
  const isBodyweight = kind === 'bodyweight' || kind === 'assisted';
  const modality = isCardio ? 'timed_cardio' : (isBodyweight ? (kind === 'assisted' ? 'assisted' : 'bodyweight') : 'strength');
  return {
    id: String(e.id || '').replace(/[^a-zA-Z0-9_-]/g, ''),
    name: cleanExName(e.n || e.name || e.id || ''),
    g: mapBodyPartToGroup(e.bp || e.g),
    bp: String(e.bp || 'waist'),
    eq: String(e.eq || 'body weight'),
    tg: String(e.tg || ''),
    sec: Array.isArray(e.sm || e.sec) ? (e.sm || e.sec).map(String) : [],
    st: Array.isArray(e.st) ? e.st.map(String) : [],
    img: String(e.img || '').replace(/[^a-zA-Z0-9_.-]/g, ''),
    gif: String(e.gif || '').replace(/[^a-zA-Z0-9_.-]/g, ''),
    t: isCardio ? 't' : (isBodyweight ? 'b' : 'w'),
    type: modality,
    kind,
    u: false
  };
};

const exById = id => {
  try {
    let sid = '';
    if (id && typeof id === 'object' && id.id) {
      sid = String(id.id);
    } else {
      sid = String(id || '');
    }
    if (!sid) {
      return { id: '', name: '', g: 'Core', bp: 'waist', eq: 'body weight', tg: '', sec: [], st: [], img: '', gif: '', t: 'w', type: 'strength', u: false };
    }

    // 1. Check window.__EXIDX__ / _global.__EXIDX__ first so ID lookup never returns raw codes if catalog has been fetched once
    let ex = null;
    const gIdx = (typeof window !== 'undefined' && window.__EXIDX__) ? window.__EXIDX__ : _global.__EXIDX__;
    if (gIdx) {
      if (typeof gIdx.get === 'function') {
        ex = gIdx.get(sid);
      }
      if (!ex && gIdx[sid]) {
        ex = gIdx[sid];
      }
    }

    // 2. Check local EXIDX
    if (!ex && EXIDX) {
      if (typeof EXIDX.get === 'function') {
        ex = EXIDX.get(sid);
      }
      if (!ex && EXIDX[sid]) {
        ex = EXIDX[sid];
      }
    }

    // 3. Fallback: Search window.__EXDB__ / _global.__EXDB__
    if (!ex) {
      const gDb = (typeof window !== 'undefined' && window.__EXDB__) ? window.__EXDB__ : (_global.__EXDB__ || EXDB);
      if (Array.isArray(gDb) && gDb.length > 0) {
        ex = gDb.find(item => item && String(item.id) === sid);
        if (ex && gIdx) {
          if (typeof gIdx.set === 'function') gIdx.set(sid, ex);
          gIdx[sid] = ex;
        }
      }
    }

    // 4. Check custom exercises in S.customExercises
    if (!ex && Array.isArray(S?.customExercises)) {
      ex = S.customExercises.find(item => item && String(item.id) === sid);
      if (ex && gIdx) {
        if (typeof gIdx.set === 'function') gIdx.set(sid, ex);
        gIdx[sid] = ex;
      }
    }

    if (ex) {
      if (!ex.type) {
        ex.type = (ex.t === 't' || ex.bp === 'cardio') ? 'timed_cardio' : ((ex.t === 'b' || ex.eq === 'body weight') ? 'bodyweight' : 'strength');
      }
      return ex;
    }

    // Trigger background load if database is empty and loader is available
    if ((!EXDB || EXDB.length === 0) && typeof loadExercises === 'function') {
      try { loadExercises().catch(() => {}); } catch (_) {}
    }

    return {
      id: sid,
      name: cleanExName(sid),
      g: 'Core',
      bp: 'waist',
      eq: 'body weight',
      tg: '',
      sec: [],
      st: [],
      img: '',
      gif: '',
      t: 'w',
      type: 'strength',
      u: false
    };
  } catch (err) {
    console.warn('exById error for', id, err);
    return {
      id: String(id || ''),
      name: cleanExName(String(id || 'Exercise')),
      g: 'Core',
      bp: 'waist',
      eq: 'body weight',
      tg: '',
      sec: [],
      st: [],
      img: '',
      gif: '',
      t: 'w',
      type: 'strength',
      u: false
    };
  }
};

const X = exById;

function mergeCustomExercises() {
  if (!Array.isArray(S.customExercises) || !S.customExercises.length) return;
  const gIdx = (typeof window !== 'undefined' && window.__EXIDX__) ? window.__EXIDX__ : _global.__EXIDX__;
  const gDb = (typeof window !== 'undefined' && window.__EXDB__) ? window.__EXDB__ : _global.__EXDB__;
  S.customExercises.forEach(c => {
    if (!c || !c.id) return;
    const sid = String(c.id);
    if (gIdx) {
      if (typeof gIdx.set === 'function') gIdx.set(sid, c);
      gIdx[sid] = c;
    }
    if (EXIDX) {
      if (typeof EXIDX.set === 'function') EXIDX.set(sid, c);
      EXIDX[sid] = c;
    }
    if (gDb && Array.isArray(gDb) && !gDb.some(item => item && String(item.id) === sid)) {
      gDb.unshift(c);
    }
    if (EXDB && Array.isArray(EXDB) && !EXDB.some(item => item && String(item.id) === sid)) {
      EXDB.unshift(c);
    }
  });
}

const SEARCH_SYNONYMS = {
  'lat pulldown': ['pulldown', 'cable pulldown', 'lat pull-down', 'wide-grip pulldown'],
  'pulldown': ['lat pulldown', 'lat pull down'],
  'incline press': ['incline bench', 'incline barbell bench', 'incline dumbbell bench', 'incline chest press'],
  'bench press': ['bench', 'chest press', 'flat bench'],
  'overhead press': ['shoulder press', 'military press', 'ohp', 'strict press'],
  'military press': ['overhead press', 'shoulder press', 'ohp'],
  'ohp': ['overhead press', 'military press', 'shoulder press'],
  'deadlift': ['dead lift', 'conventional deadlift', 'romanian deadlift', 'rdl'],
  'rdl': ['romanian deadlift', 'romanian dead lift', 'stiff-leg deadlift'],
  'squat': ['back squat', 'barbell squat', 'front squat'],
  'calf raise': ['calf', 'calves', 'standing calf', 'seated calf'],
  'bicep curl': ['curl', 'dumbbell curl', 'barbell curl', 'biceps'],
  'tricep extension': ['triceps', 'pushdown', 'skull crusher', 'tricep dip'],
  'pushdown': ['cable pushdown', 'tricep pushdown', 'triceps pushdown'],
  'skull crusher': ['lying triceps extension', 'skullcrusher', 'tricep extension'],
  'lateral raise': ['side raise', 'side lateral', 'lateral deltoid'],
  'shrug': ['shrugs', 'barbell shrug', 'dumbbell shrug', 'traps'],
  'row': ['cable row', 'barbell row', 'dumbbell row', 'seated row', 'bent over row']
};

function matchesExerciseSearch(e, query) {
  if (!e || !query) return true;
  const q = String(query).trim().toLowerCase();
  if (!q) return true;

  const name = (e.name || '').toLowerCase();
  const tg = (e.tg || '').toLowerCase();
  const g = (e.g || '').toLowerCase();
  const eq = (e.eq || '').toLowerCase();
  const sec = Array.isArray(e.sec) ? e.sec.join(' ').toLowerCase() : '';

  if (name.includes(q) || tg.includes(q) || g.includes(q) || eq.includes(q) || sec.includes(q)) {
    return true;
  }

  const qWords = q.split(/\s+/).filter(Boolean);
  if (qWords.length > 1) {
    const combined = `${name} ${tg} ${g} ${eq} ${sec}`;
    if (qWords.every(w => combined.includes(w))) return true;
  }

  for (const [alias, targets] of Object.entries(SEARCH_SYNONYMS)) {
    if (q.includes(alias) || alias.includes(q)) {
      if (targets.some(t => name.includes(t) || tg.includes(t) || g.includes(t))) return true;
    }
  }

  for (const [alias, targets] of Object.entries(SEARCH_SYNONYMS)) {
    if (targets.some(t => q.includes(t))) {
      if (name.includes(alias) || tg.includes(alias) || g.includes(alias)) return true;
    }
  }

  return false;
}

function showCustomExerciseModal(prefillName = '') {
  modal(`
    <div class="custom-ex-sheet">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2 style="margin:0">Create Custom Exercise</h2>
        <button class="btn s sm-btn" data-a="close">✕</button>
      </div>
      <div class="custom-ex-field">
        <label>Exercise Name</label>
        <input type="text" id="custom-ex-name" class="txt" placeholder="e.g., Incline Hammer Press" value="${esc(prefillName)}">
      </div>
      <div class="custom-ex-field">
        <label>Target Muscle Group</label>
        <select id="custom-ex-muscle" class="txt">
          <option value="Chest">Chest</option>
          <option value="Back">Back</option>
          <option value="Shoulders">Shoulders</option>
          <option value="Quads">Quads</option>
          <option value="Hamstrings">Hamstrings</option>
          <option value="Glutes">Glutes</option>
          <option value="Biceps">Biceps</option>
          <option value="Triceps">Triceps</option>
          <option value="Calves">Calves</option>
          <option value="Core">Core / Abs</option>
          <option value="Forearms">Forearms</option>
          <option value="Full Body">Full Body</option>
        </select>
      </div>
      <div class="custom-ex-field">
        <label>Equipment</label>
        <select id="custom-ex-eq" class="txt">
          <option value="barbell">Barbell</option>
          <option value="dumbbell">Dumbbell</option>
          <option value="cable">Cable</option>
          <option value="machine">Machine</option>
          <option value="body weight">Bodyweight</option>
        </select>
      </div>
      <div class="custom-ex-field">
        <label>Optional Form Cues / Notes</label>
        <textarea id="custom-ex-notes" class="txt" placeholder="e.g., Seat at notch 3, pause at stretch..." rows="2"></textarea>
      </div>
      <button class="btn finish-save-btn" data-a="savecustomex" style="width:100%;margin-top:12px">Save Exercise 🏆</button>
    </div>
  `);
}

function saveCustomExerciseFromForm() {
  const nameEl = document.getElementById('custom-ex-name');
  const muscleEl = document.getElementById('custom-ex-muscle');
  const eqEl = document.getElementById('custom-ex-eq');
  const notesEl = document.getElementById('custom-ex-notes');

  const name = nameEl?.value?.trim();
  if (!name) {
    toast('Please enter an exercise name');
    return null;
  }

  const g = muscleEl?.value || 'Chest';
  const eq = eqEl?.value || 'barbell';
  const notes = notesEl?.value?.trim() || '';

  const id = 'cust_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);

  const customEx = {
    id,
    name,
    g,
    bp: g.toLowerCase(),
    eq,
    tg: g.toLowerCase(),
    sec: [],
    st: [],
    img: '',
    gif: '',
    t: eq === 'body weight' ? 'b' : 'w',
    type: eq === 'body weight' ? 'bodyweight' : 'strength',
    u: false,
    notes,
    isCustom: true
  };

  if (!Array.isArray(S.customExercises)) {
    S.customExercises = [];
  }
  S.customExercises.push(customEx);
  ls.set('customExercises', S.customExercises);
  save('customExercises');

  mergeCustomExercises();

  close();
  toast(`Created "${name}"!`);

  if (view === 'lib') {
    render();
  } else if ($('#pick-list')) {
    pickQuery = name;
    const pickInput = $('#pick-search-input');
    if (pickInput) pickInput.value = name;
    const pickList = $('#pick-list');
    if (pickList) pickList.innerHTML = renderPickResults();
  }

  return customEx;
}

const isCardioOrMobilityExercise = exId => {
  const e = X(exId);
  if (!e) return false;
  if (e.type === 'timed_cardio' || e.t === 't' || e.bp === 'cardio' || e.g === 'Cardio' || e.g === 'Mobility') return true;
  const n = (e.name || '').toLowerCase();
  if (n.includes('stretch') || n.includes('mobility') || n.includes('cardio') || n.includes('treadmill') || n.includes('elliptical') || n.includes('bike') || n.includes('rowing machine') || n.includes('jumping jack')) {
    return true;
  }
  return false;
};

// ---- Icons (Lucide / Phosphor style vector icons) ----
const IC = {
  act: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  weight: '<path d="m21.3 8.7-12.6 12.6a1 1 0 0 1-1.4 0l-5.6-5.6a1 1 0 0 1 0-1.4L14.3 1.7a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/>',
  dumbbell: '<path d="m6.5 6.5 11 11"/><path d="m21 21-1-1a3 3 0 0 0-4.24 0l-1.42 1.42a1 1 0 0 1-1.42 0L9.17 18.66a1 1 0 0 1 0-1.42L10.59 15.82a3 3 0 0 0 0-4.24L9.59 10.58"/><path d="m3 3 1 1a3 3 0 0 0 4.24 0l1.42-1.42a1 1 0 0 1 1.42 0l4.75 4.76a1 1 0 0 1 0 1.42l-1.42 1.42a3 3 0 0 0 0 4.24l1 1"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  timer: '<line x1="10" y1="2" x2="14" y2="2"/><line x1="12" y1="14" x2="15" y2="11"/><circle cx="12" cy="14" r="8"/>',
  sl: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  chk: '<polyline points="20 6 9 17 4 12"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  disc: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.45 1-1 1H8c-.55 0-1 .45-1 1v1h10v-1c0-.55-.45-1-1-1h-1c-.55 0-1-.45-1-1v-2.34"/><path d="M6 4h12v6a6 6 0 0 1-12 0V4z"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  pencil: '<line x1="18" y1="2" x2="22" y2="6"/><path d="M7.5 20.5 19 9l-4-4L3.5 16.5 2 22z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  chevronUp: '<polyline points="18 15 12 9 6 15"/>',
  arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  skip: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
  swap: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  sparkles: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
  apple: '<path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z"/><path d="M10 2c1 .5 2 2 2 5"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
};

const icon = (name, opts = {}) => {
  const size = typeof opts === 'number' ? opts : (opts?.size || 18);
  const cls = (typeof opts === 'object' && opts?.className) ? ` class="${esc(opts.className)}"` : '';
  const sw = (typeof opts === 'object' && opts?.strokeWidth) ? opts.strokeWidth : 1.75;
  const label = (typeof opts === 'object' && opts?.label) ? opts.label : '';
  const a11y = label
    ? ` role="img" aria-label="${esc(label)}"`
    : ' aria-hidden="true"';
  const path = IC[name] || IC.disc || '';
  return html.raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${cls}${a11y}>${path}</svg>`);
};

const ic = (n, s = 22) => icon(n, { size: s, strokeWidth: 2 }).toString();

// ---- Anatomical Muscle Map Heatmap (Front & Back Dual View + Interactive Discovery) ----
const ANATOMY_MUSCLES = {
  pecs: { name: 'Pectorals (Chest)', keys: ['pec', 'chest', 'pectorals'] },
  lats: { name: 'Latissimus Dorsi (Lats)', keys: ['lat', 'lats', 'latissimus'] },
  traps: { name: 'Trapezius (Traps)', keys: ['trap', 'traps', 'trapezius', 'neck', 'upper back', 'levator scapulae'] },
  deltoids: { name: 'Deltoids (Shoulders)', keys: ['delt', 'delts', 'deltoid', 'deltoids', 'shoulder', 'shoulders'] },
  biceps: { name: 'Biceps Brachii', keys: ['bicep', 'biceps'] },
  triceps: { name: 'Triceps Brachii', keys: ['tricep', 'triceps'] },
  forearms: { name: 'Forearms', keys: ['forearm', 'forearms', 'lower arm', 'lower arms', 'wrist flexors'] },
  abs: { name: 'Rectus Abdominis (Abs)', keys: ['ab', 'abs', 'rectus', 'abdominis', 'core'] },
  obliques: { name: 'Obliques (Core)', keys: ['oblique', 'obliques', 'serratus anterior', 'waist'] },
  glutes: { name: 'Gluteus Maximus (Glutes)', keys: ['glute', 'glutes', 'gluteus', 'butt'] },
  quads: { name: 'Quadriceps (Quads)', keys: ['quad', 'quads', 'quadriceps', 'upper legs'] },
  hamstrings: { name: 'Hamstrings', keys: ['hamstring', 'hamstrings'] },
  calves: { name: 'Calves', keys: ['calf', 'calves', 'gastrocnemius', 'soleus', 'lower legs'] }
};

const mapMuscleToAnatomyKey = str => {
  if (!str) return [];
  const s = String(str).toLowerCase().trim();
  const matched = [];
  if (s.includes('chest') || s.includes('pec')) matched.push('pecs');
  if (s.includes('lat') && !s.includes('lateral')) matched.push('lats');
  if (s.includes('trap') || s.includes('neck') || s.includes('levator') || s.includes('upper back')) matched.push('traps');
  if (s.includes('delt') || s.includes('shoulder')) matched.push('deltoids');
  if (s.includes('bicep')) matched.push('biceps');
  if (s.includes('tricep')) matched.push('triceps');
  if (s.includes('forearm') || s.includes('lower arm') || s.includes('wrist')) matched.push('forearms');
  if (s.includes('ab') && !s.includes('abductor')) matched.push('abs');
  if (s.includes('oblique') || s.includes('serratus')) matched.push('obliques');
  if (s.includes('glute')) matched.push('glutes');
  if (s.includes('quad') || s.includes('upper leg') || s.includes('adductor') || s.includes('abductor')) matched.push('quads');
  if (s.includes('hamstring')) matched.push('hamstrings');
  if (s.includes('calf') || s.includes('calves') || s.includes('gastrocnemius') || s.includes('soleus') || s.includes('lower leg') || s.includes('shin')) matched.push('calves');
  if (s === 'arms' || s === 'arm') matched.push('biceps', 'triceps', 'forearms');
  if (s === 'legs' || s === 'leg') matched.push('quads', 'hamstrings', 'glutes', 'calves');
  if (s === 'back') matched.push('lats', 'traps');
  if (s === 'core' || s === 'waist') matched.push('abs', 'obliques');
  return [...new Set(matched)];
};

const getTopExercisesForMuscle = (muscleKey, limit = 6) => {
  const muscleInfo = ANATOMY_MUSCLES[muscleKey];
  if (!muscleInfo || !Array.isArray(EXDB)) return [];
  const keys = muscleInfo.keys || [];

  const matches = EXDB.filter(e => {
    const tg = (e.tg || '').toLowerCase();
    const g = (e.g || '').toLowerCase();
    const bp = (e.bp || '').toLowerCase();
    const name = (e.name || '').toLowerCase();
    const sec = (e.sec || []).map(s => String(s).toLowerCase());
    return keys.some(k => tg.includes(k) || sec.some(sm => sm.includes(k)) || g.includes(k) || bp.includes(k) || name.includes(k));
  });

  matches.sort((a, b) => {
    const aTg = (a.tg || '').toLowerCase();
    const bTg = (b.tg || '').toLowerCase();
    const aExact = keys.some(k => aTg.includes(k)) ? 10 : 0;
    const bExact = keys.some(k => bTg.includes(k)) ? 10 : 0;
    const eqRank = eq => (eq === 'barbell' ? 4 : eq === 'dumbbell' ? 3 : eq === 'cable' ? 2 : 1);
    const aScore = aExact + eqRank(a.eq);
    const bScore = bExact + eqRank(b.eq);
    return bScore - aScore;
  });

  return matches.slice(0, limit);
};

const generateAnatomySvg = (gender = 'male', primary = [], secondary = [], opts = {}) => {
  const isFemale = (gender || S.cfg?.bodyModel) === 'female';
  const normP = [...new Set((primary || []).flatMap(mapMuscleToAnatomyKey))];
  const normQ = [...new Set((secondary || []).flatMap(mapMuscleToAnatomyKey))].filter(k => !normP.includes(k));

  const shW = isFemale ? 23 : 26;
  const wW = isFemale ? 11 : 14;
  const hW = isFemale ? 20 : 17;
  const thW = isFemale ? 14 : 15;

  const fc = 80;
  const bc = 240;

  const isP = m => normP.includes(m);
  const isS = m => normQ.includes(m);
  const isSel = m => opts.selectedMuscle === m;
  const cls = m => `mm-muscle ${isP(m) ? 'p' : (isS(m) ? 's' : '')} ${isSel(m) ? 'selected' : ''}`.trim();

  return `<svg class="mm-svg" viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Anatomical Muscle Heatmap (${isFemale ? 'Female' : 'Male'})">
    <defs>
      <filter id="glow-p" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="0" stdDeviation="2.5" flood-color="#f59e0b" flood-opacity="0.8"/>
      </filter>
      <filter id="glow-s" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#38bdf8" flood-opacity="0.7"/>
      </filter>
    </defs>

    <!-- Labels -->
    <text x="${fc}" y="12" text-anchor="middle" class="mm-label">FRONT</text>
    <text x="${bc}" y="12" text-anchor="middle" class="mm-label">BACK</text>

    <!-- FRONT SILHOUETTE BASE -->
    <g class="mm-base">
      <ellipse cx="${fc}" cy="23" rx="9" ry="11"/>
      <path d="M ${fc-4} 34 L ${fc-5} 41 L ${fc+5} 41 L ${fc+4} 34 Z"/>
      <path d="M ${fc-6} 41 C ${fc-16} 42 ${fc-shW} 45 ${fc-shW-5} 52 C ${fc-shW-8} 62 ${fc-shW-6} 80 ${fc-shW-3} 90 L ${fc-shW-6} 118 C ${fc-shW-4} 123 ${fc-shW+1} 123 ${fc-shW+2} 118 L ${fc-shW+4} 92 L ${fc-wW-5} 84 C ${fc-wW-2} 93 ${fc-hW} 98 ${fc-hW} 104 C ${fc-hW} 118 ${fc-thW} 142 ${fc-thW+3} 150 L ${fc-thW+2} 190 C ${fc-thW+4} 195 ${fc-thW+9} 195 ${fc-thW+10} 190 L ${fc-4} 150 L ${fc-3} 106 L ${fc+3} 106 L ${fc+4} 150 L ${fc+thW-10} 190 C ${fc+thW-9} 195 ${fc+thW-4} 195 ${fc+thW-2} 190 L ${fc+thW-3} 150 C ${fc+thW} 142 ${fc+hW} 118 ${fc+hW} 104 C ${fc+hW} 98 ${fc+wW+2} 93 ${fc+wW+5} 84 L ${fc+shW-4} 92 L ${fc+shW-2} 118 C ${fc+shW-1} 123 ${fc+shW+4} 123 ${fc+shW+6} 118 L ${fc+shW+3} 90 C ${fc+shW+6} 80 ${fc+shW+8} 62 ${fc+shW+5} 52 C ${fc+shW} 45 ${fc+16} 42 ${fc+6} 41 Z"/>
    </g>

    <!-- BACK SILHOUETTE BASE -->
    <g class="mm-base">
      <ellipse cx="${bc}" cy="23" rx="9" ry="11"/>
      <path d="M ${bc-4} 34 L ${bc-5} 41 L ${bc+5} 41 L ${bc+4} 34 Z"/>
      <path d="M ${bc-6} 41 C ${bc-16} 42 ${bc-shW} 45 ${bc-shW-5} 52 C ${bc-shW-8} 62 ${bc-shW-6} 80 ${bc-shW-3} 90 L ${bc-shW-6} 118 C ${bc-shW-4} 123 ${bc-shW+1} 123 ${bc-shW+2} 118 L ${bc-shW+4} 92 L ${bc-wW-5} 84 C ${bc-wW-2} 93 ${bc-hW} 98 ${bc-hW} 104 C ${bc-hW} 118 ${bc-thW} 142 ${bc-thW+3} 150 L ${bc-thW+2} 190 C ${bc-thW+4} 195 ${bc-thW+9} 195 ${bc-thW+10} 190 L ${bc-4} 150 L ${bc-3} 106 L ${bc+3} 106 L ${bc+4} 150 L ${bc+thW-10} 190 C ${bc+thW-9} 195 ${bc+thW-4} 195 ${bc+thW-2} 190 L ${bc+thW-3} 150 C ${bc+thW} 142 ${bc+hW} 118 ${bc+hW} 104 C ${bc+hW} 98 ${bc+wW+2} 93 ${bc+wW+5} 84 L ${bc+shW-4} 92 L ${bc+shW-2} 118 C ${bc+shW-1} 123 ${bc+shW+4} 123 ${bc+shW+6} 118 L ${bc+shW+3} 90 C ${bc+shW+6} 80 ${bc+shW+8} 62 ${bc+shW+5} 52 C ${bc+shW} 45 ${bc+16} 42 ${bc+6} 41 Z"/>
    </g>

    <!-- FRONT MUSCLES -->
    <g class="mm-muscles-front">
      <path class="${cls('traps')}" data-a="explore-muscle" data-muscle="traps" d="M ${fc-5} 35 C ${fc-9} 38 ${fc-14} 41 ${fc-18} 44 L ${fc-12} 45 L ${fc-5} 41 Z M ${fc+5} 35 C ${fc+9} 38 ${fc+14} 41 ${fc+18} 44 L ${fc+12} 45 L ${fc+5} 41 Z"/>
      <path class="${cls('deltoids')}" data-a="explore-muscle" data-muscle="deltoids" d="M ${fc-19} 44 C ${fc-shW-4} 46 ${fc-shW-6} 53 ${fc-shW-4} 63 C ${fc-shW+1} 64 ${fc-17} 60 ${fc-17} 53 Z M ${fc+19} 44 C ${fc+shW+4} 46 ${fc+shW+6} 53 ${fc+shW+4} 63 C ${fc+shW-1} 64 ${fc+17} 60 ${fc+17} 53 Z"/>
      <path class="${cls('pecs')}" data-a="explore-muscle" data-muscle="pecs" d="M ${fc-2} 44 L ${fc-15} 45 C ${fc-17} 53 ${fc-14} 62 ${fc-2} 64 C ${fc-1} 58 ${fc-1} 50 ${fc-2} 44 Z M ${fc+2} 44 L ${fc+15} 45 C ${fc+17} 53 ${fc+14} 62 ${fc+2} 64 C ${fc+1} 58 ${fc+1} 50 ${fc+2} 44 Z"/>
      <path class="${cls('biceps')}" data-a="explore-muscle" data-muscle="biceps" d="M ${fc-shW-3} 64 C ${fc-shW-6} 71 ${fc-shW-5} 81 ${fc-shW-2} 87 C ${fc-shW+2} 86 ${fc-shW+4} 78 ${fc-shW+3} 70 Z M ${fc+shW+3} 64 C ${fc+shW+6} 71 ${fc+shW+5} 81 ${fc+shW+2} 87 C ${fc+shW-2} 86 ${fc+shW-4} 78 ${fc+shW-3} 70 Z"/>
      <path class="${cls('forearms')}" data-a="explore-muscle" data-muscle="forearms" d="M ${fc-shW-2} 89 C ${fc-shW-7} 97 ${fc-shW-7} 107 ${fc-shW-4} 116 C ${fc-shW} 116 ${fc-shW+3} 109 ${fc-shW+2} 100 Z M ${fc+shW+2} 89 C ${fc+shW+7} 97 ${fc+shW+7} 107 ${fc+shW+4} 116 C ${fc+shW} 116 ${fc+shW-3} 109 ${fc+shW-2} 100 Z"/>
      <path class="${cls('abs')}" data-a="explore-muscle" data-muscle="abs" d="M ${fc-5} 66 L ${fc-1} 66 L ${fc-1} 72 L ${fc-5} 72 Z M ${fc+1} 66 L ${fc+5} 66 L ${fc+5} 72 L ${fc+1} 72 Z M ${fc-5} 74 L ${fc-1} 74 L ${fc-1} 80 L ${fc-5} 80 Z M ${fc+1} 74 L ${fc+5} 74 L ${fc+5} 80 L ${fc+1} 80 Z M ${fc-5} 82 L ${fc-1} 82 L ${fc-1} 90 L ${fc-4} 89 Z M ${fc+1} 82 L ${fc+5} 82 L ${fc+4} 89 L ${fc+1} 90 Z"/>
      <path class="${cls('obliques')}" data-a="explore-muscle" data-muscle="obliques" d="M ${fc-13} 66 C ${fc-wW-2} 73 ${fc-wW-1} 82 ${fc-8} 89 C ${fc-6} 86 ${fc-6} 78 ${fc-7} 70 Z M ${fc+13} 66 C ${fc+wW+2} 73 ${fc+wW+1} 82 ${fc+8} 89 C ${fc+6} 86 ${fc+6} 78 ${fc+7} 70 Z"/>
      <path class="${cls('quads')}" data-a="explore-muscle" data-muscle="quads" d="M ${fc-hW+2} 98 C ${fc-thW-2} 108 ${fc-thW-1} 126 ${fc-thW+3} 142 C ${fc-8} 144 ${fc-3} 139 ${fc-3} 126 C ${fc-3} 113 ${fc-6} 102 ${fc-hW+2} 98 Z M ${fc+hW-2} 98 C ${fc+thW+2} 108 ${fc+thW+1} 126 ${fc+thW-3} 142 C ${fc+8} 144 ${fc+3} 139 ${fc+3} 126 C ${fc+3} 113 ${fc+6} 102 ${fc+hW-2} 98 Z"/>
      <path class="${cls('calves')}" data-a="explore-muscle" data-muscle="calves" d="M ${fc-thW+2} 150 C ${fc-thW-2} 160 ${fc-thW-1} 172 ${fc-thW+2} 186 C ${fc-6} 186 ${fc-4} 178 ${fc-4} 168 Z M ${fc+thW-2} 150 C ${fc+thW+2} 160 ${fc+thW+1} 172 ${fc+thW-2} 186 C ${fc+6} 186 ${fc+4} 178 ${fc+4} 168 Z"/>
    </g>

    <!-- BACK MUSCLES -->
    <g class="mm-muscles-back">
      <path class="${cls('traps')}" data-a="explore-muscle" data-muscle="traps" d="M ${bc} 35 L ${bc-12} 44 C ${bc-8} 52 ${bc-4} 58 ${bc} 68 C ${bc+4} 58 ${bc+8} 52 ${bc+12} 44 Z"/>
      <path class="${cls('deltoids')}" data-a="explore-muscle" data-muscle="deltoids" d="M ${bc-14} 45 C ${bc-shW-4} 46 ${bc-shW-6} 53 ${bc-shW-4} 63 C ${bc-shW+1} 64 ${bc-15} 60 ${bc-13} 53 Z M ${bc+14} 45 C ${bc+shW+4} 46 ${bc+shW+6} 53 ${bc+shW+4} 63 C ${bc+shW-1} 64 ${bc+15} 60 ${bc+13} 53 Z"/>
      <path class="${cls('lats')}" data-a="explore-muscle" data-muscle="lats" d="M ${bc-2} 64 C ${bc-7} 56 ${bc-15} 55 ${bc-18} 61 C ${bc-wW-5} 71 ${bc-wW-2} 82 ${bc-5} 89 L ${bc-2} 83 Z M ${bc+2} 64 C ${bc+7} 56 ${bc+15} 55 ${bc+18} 61 C ${bc+wW+5} 71 ${bc+wW+2} 82 ${bc+5} 89 L ${bc+2} 83 Z"/>
      <path class="${cls('triceps')}" data-a="explore-muscle" data-muscle="triceps" d="M ${bc-shW-3} 64 C ${bc-shW-6} 71 ${bc-shW-5} 81 ${bc-shW-2} 87 C ${bc-shW+2} 86 ${bc-shW+4} 78 ${bc-shW+3} 70 Z M ${bc+shW+3} 64 C ${bc+shW+6} 71 ${bc+shW+5} 81 ${bc+shW+2} 87 C ${bc+shW-2} 86 ${bc+shW-4} 78 ${bc+shW-3} 70 Z"/>
      <path class="${cls('forearms')}" data-a="explore-muscle" data-muscle="forearms" d="M ${bc-shW-2} 89 C ${bc-shW-7} 97 ${bc-shW-7} 107 ${bc-shW-4} 116 C ${bc-shW} 116 ${bc-shW+3} 109 ${bc-shW+2} 100 Z M ${bc+shW+2} 89 C ${bc+shW+7} 97 ${bc+shW+7} 107 ${bc+shW+4} 116 C ${bc+shW} 116 ${bc+shW-3} 109 ${bc+shW-2} 100 Z"/>
      <path class="${cls('glutes')}" data-a="explore-muscle" data-muscle="glutes" d="M ${bc-hW+2} 93 C ${bc-hW-2} 100 ${bc-hW-1} 112 ${bc-5} 116 C ${bc-1} 116 ${bc-1} 106 ${bc-2} 95 C ${bc-6} 94 ${bc-10} 93 ${bc-hW+2} 93 Z M ${bc+hW-2} 93 C ${bc+hW+2} 100 ${bc+hW+1} 112 ${bc+5} 116 C ${bc+1} 116 ${bc+1} 106 ${bc+2} 95 C ${bc+6} 94 ${bc+10} 93 ${bc+hW-2} 93 Z"/>
      <path class="${cls('hamstrings')}" data-a="explore-muscle" data-muscle="hamstrings" d="M ${bc-hW+3} 118 C ${bc-thW-2} 127 ${bc-thW-1} 138 ${bc-thW+3} 145 C ${bc-6} 145 ${bc-3} 139 ${bc-3} 128 C ${bc-3} 121 ${bc-6} 118 ${bc-hW+3} 118 Z M ${bc+hW-3} 118 C ${bc+thW+2} 127 ${bc+thW+1} 138 ${bc+thW-3} 145 C ${bc+6} 145 ${bc+3} 139 ${bc+3} 128 C ${bc+3} 121 ${bc+6} 118 ${bc+hW-3} 118 Z"/>
      <path class="${cls('calves')}" data-a="explore-muscle" data-muscle="calves" d="M ${bc-thW+2} 150 C ${bc-thW-3} 160 ${bc-thW-2} 172 ${bc-thW+3} 186 C ${bc-5} 186 ${bc-2} 178 ${bc-2} 168 Z M ${bc+thW-2} 150 C ${bc+thW+3} 160 ${bc+thW+2} 172 ${bc+thW-3} 186 C ${bc+5} 186 ${bc+2} 178 ${bc+2} 168 Z"/>
    </g>
  </svg>`;
};

const mmap = (p = [], q = [], opts = {}) => {
  const gender = opts.gender || S.cfg?.bodyModel || 'male';
  const svg = generateAnatomySvg(gender, p, q, opts);
  if (opts.wrap === false) return svg;
  const priStr = (p || []).join(',');
  const secStr = (q || []).join(',');
  return `
    <div class="mm-wrap" id="mm-container">
      <div style="display:flex;justify-content:flex-end;margin-bottom:6px;">
        <button class="chip mm-3d-toggle-btn" data-a="open-3d-anatomy" data-p="${esc(priStr)}" data-s="${esc(secStr)}" title="Open interactive 3D anatomical viewer" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:4px 10px;cursor:pointer;">📐 3D View</button>
      </div>
      ${svg}
      <div id="mm-explore-sheet" class="mm-explore-drawer"></div>
    </div>
  `;
};

const mmLog = (l, opts = {}) => {
  if (!l || !Array.isArray(l.ex)) return mmap([], [], opts);
  const p = [...new Set(l.ex.flatMap(x => {
    const ex = X(x.id);
    return [...mapMuscleToAnatomyKey(ex.tg), ...mapMuscleToAnatomyKey(ex.g)];
  }))];
  const q = [...new Set(l.ex.flatMap(x => {
    const ex = X(x.id);
    return (ex.sec || []).flatMap(mapMuscleToAnatomyKey);
  }))].filter(k => !p.includes(k));

  return mmap(p, q, {
    ...opts,
    gender: S.cfg?.bodyModel || 'male',
    interactive: true
  });
};

function showMuscleDetailSheet(muscleKey) {
  if ((!EXDB || EXDB.length === 0) && typeof loadExercises === 'function') {
    if (_global.__EXDB__ && _global.__EXDB__.length > 0) {
      EXDB = _global.__EXDB__;
      EXIDX = _global.__EXIDX__;
    } else {
      loadExercises().then(() => showMuscleDetailSheet(muscleKey)).catch(() => {});
    }
  }
  const drawer = document.getElementById('mm-explore-sheet');
  const muscleInfo = ANATOMY_MUSCLES[muscleKey] || { name: muscleKey };
  const topExercises = getTopExercisesForMuscle(muscleKey, 6);

  document.querySelectorAll('.mm-muscle').forEach(el => {
    el.classList.toggle('selected', el.dataset.muscle === muscleKey);
  });

  const contentHtml = `
    <div class="mm-explore-inner">
      <div class="mm-explore-header">
        <div class="mm-explore-target-chip">
          <span class="mm-chip-dot"></span>
          <span class="mm-chip-text">Target: <b>${esc(muscleInfo.name)}</b></span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="t2 sm">${topExercises.length} top exercises</span>
          <button class="x mm-close-btn" data-a="close-mm-explore" title="Close" style="min-height:28px;padding:2px 8px">✕</button>
        </div>
      </div>
      <div class="mm-explore-list">
        ${topExercises.length ? topExercises.map(e => `
          <div class="mm-explore-item" data-a="pickpreview" data-id="${esc(e.id)}">
            <img class="ex-thumb" src="./media/${esc(e.img || e.gif)}" alt="${esc(e.name)}" loading="lazy" onerror="this.style.display='none'">
            <div class="mm-explore-meta">
              <div class="mm-explore-name">${esc(e.name)}</div>
              <div class="ex-meta">${esc(e.tg || e.g)} · ${esc(e.eq)}</div>
            </div>
            <button class="chip" data-a="pickpreview" data-id="${esc(e.id)}" style="font-size:11px;padding:3px 8px">Preview</button>
          </div>
        `).join('') : '<p class="t2 sm" style="padding:12px;text-align:center">No library exercises for this target.</p>'}
      </div>
    </div>
  `;

  if (drawer) {
    drawer.innerHTML = contentHtml;
    drawer.classList.add('open');
    drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    modal(`
      <div class="sheet-title-row" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2 style="margin:0">Target: ${esc(muscleInfo.name)}</h2>
        <button class="x" data-a="close">Close</button>
      </div>
      <p class="t2 sm" style="margin-top:-6px;margin-bottom:12px">Top matching movements from exercise library</p>
      <div class="mm-explore-list" style="max-height:55vh;overflow-y:auto">
        ${topExercises.map(e => `
          <div class="mm-explore-item" data-a="pickpreview" data-id="${esc(e.id)}" style="cursor:pointer">
            <img class="ex-thumb" src="./media/${esc(e.img || e.gif)}" alt="${esc(e.name)}" loading="lazy" onerror="this.style.display='none'">
            <div class="mm-explore-meta">
              <div class="mm-explore-name">${esc(e.name)}</div>
              <div class="ex-meta">${esc(e.tg || e.g)} · ${esc(e.eq)}</div>
            </div>
            <button class="chip" data-a="pickpreview" data-id="${esc(e.id)}">Preview</button>
          </div>
        `).join('')}
      </div>
    `);
  }
}

// ---- 3D Anatomical Engine & Procedural Visuals ----
function isWebGLAvailable() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch (_) {
    return false;
  }
}

let _threePromise = null;
async function lazyLoadThree() {
  if (typeof window !== 'undefined' && window.THREE) {
    return window.THREE;
  }
  if (!_threePromise) {
    _threePromise = import('./vendor/three.module.js').then(mod => {
      if (typeof window !== 'undefined') window.THREE = mod;
      return mod;
    });
  }
  return _threePromise;
}

function buildProceduralAnatomyModel(THREE, gender = 'male', primaryMuscles = [], secondaryMuscles = [], physiqueProgress = null) {
  const modelGroup = new THREE.Group();
  const isFemale = gender === 'female';
  const pri = new Set(primaryMuscles.map(m => String(m).toLowerCase()));
  const sec = new Set(secondaryMuscles.map(m => String(m).toLowerCase()));

  const getMat = (muscleKey) => {
    const k = muscleKey.toLowerCase();
    const color = pri.has(k) ? 0xFF9F0A : (sec.has(k) ? 0x38BDF8 : 0x334155);
    const roughness = pri.has(k) || sec.has(k) ? 0.35 : 0.6;
    const metalness = pri.has(k) || sec.has(k) ? 0.2 : 0.1;
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
  };

  const boneMat = new THREE.MeshStandardMaterial({ color: 0x1E293B, roughness: 0.8 });

  // Physique morph scaling factors
  const morph = physiqueProgress != null ? Math.max(0, Math.min(1, physiqueProgress)) : null;
  const chestScale = morph != null ? (1.0 + morph * 0.18) : 1.0;
  const latsScale = morph != null ? (1.0 + morph * 0.22) : 1.0;
  const waistScale = morph != null ? (1.15 - morph * 0.25) : 1.0;
  const armScale = morph != null ? (0.95 + morph * 0.15) : 1.0;
  const legScale = morph != null ? (0.95 + morph * 0.12) : 1.0;

  // Head and Neck
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), boneMat);
  headMesh.position.y = 2.15;
  modelGroup.add(headMesh);

  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.28, 14), boneMat);
  neckMesh.position.y = 1.82;
  modelGroup.add(neckMesh);

  // Traps
  const trapsGeo = new THREE.BoxGeometry(isFemale ? 0.75 : 0.95, 0.3, 0.45);
  const trapsMesh = new THREE.Mesh(trapsGeo, getMat('traps'));
  trapsMesh.position.set(0, 1.7, -0.05);
  trapsMesh.userData = { muscleKey: 'traps', label: 'Trapezius' };
  modelGroup.add(trapsMesh);

  // Chest (Pectorals)
  const chestWidth = (isFemale ? 1.05 : 1.35) * chestScale;
  const chestGeo = new THREE.BoxGeometry(chestWidth, 0.52, 0.55);
  const chestMesh = new THREE.Mesh(chestGeo, getMat('chest'));
  chestMesh.position.set(0, 1.38, 0.08);
  chestMesh.userData = { muscleKey: 'chest', label: 'Chest (Pectorals)' };
  modelGroup.add(chestMesh);

  // Lats (Latissimus Dorsi)
  const latsWidth = (isFemale ? 1.0 : 1.3) * latsScale;
  const latsGeo = new THREE.BoxGeometry(latsWidth, 0.65, 0.5);
  const latsMesh = new THREE.Mesh(latsGeo, getMat('lats'));
  latsMesh.position.set(0, 1.25, -0.1);
  latsMesh.userData = { muscleKey: 'lats', label: 'Lats (Latissimus)' };
  modelGroup.add(latsMesh);

  // Abs (Abdominals)
  const absWidth = (isFemale ? 0.75 : 0.85) * waistScale;
  const absGeo = new THREE.BoxGeometry(absWidth, 0.6, 0.45);
  const absMesh = new THREE.Mesh(absGeo, getMat('abs'));
  absMesh.position.set(0, 0.85, 0.06);
  absMesh.userData = { muscleKey: 'abs', label: 'Abs (Abdominals)' };
  modelGroup.add(absMesh);

  // Obliques
  const obliqWidth = (isFemale ? 0.82 : 0.95) * waistScale;
  const obliqGeo = new THREE.BoxGeometry(obliqWidth, 0.5, 0.46);
  const obliqMesh = new THREE.Mesh(obliqGeo, getMat('obliques'));
  obliqMesh.position.set(0, 0.82, 0);
  obliqMesh.userData = { muscleKey: 'obliques', label: 'Obliques' };
  modelGroup.add(obliqMesh);

  // Shoulders (Deltoids)
  const shoulderOffset = (isFemale ? 0.72 : 0.9) * (morph != null ? (0.95 + morph * 0.1) : 1.0);
  const deltRad = isFemale ? 0.22 : 0.28;
  const leftDelt = new THREE.Mesh(new THREE.SphereGeometry(deltRad, 16, 16), getMat('deltoids'));
  leftDelt.position.set(-shoulderOffset, 1.45, 0);
  leftDelt.userData = { muscleKey: 'deltoids', label: 'Shoulders (Deltoids)' };
  modelGroup.add(leftDelt);

  const rightDelt = new THREE.Mesh(new THREE.SphereGeometry(deltRad, 16, 16), getMat('deltoids'));
  rightDelt.position.set(shoulderOffset, 1.45, 0);
  rightDelt.userData = { muscleKey: 'deltoids', label: 'Shoulders (Deltoids)' };
  modelGroup.add(rightDelt);

  // Upper Arms: Biceps & Triceps
  const armRadius = (isFemale ? 0.14 : 0.18) * armScale;
  const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(armRadius, armRadius * 0.9, 0.65, 12), getMat('biceps'));
  leftArm.position.set(-shoulderOffset - 0.05, 1.0, 0.03);
  leftArm.userData = { muscleKey: 'biceps', label: 'Biceps' };
  modelGroup.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(armRadius, armRadius * 0.9, 0.65, 12), getMat('biceps'));
  rightArm.position.set(shoulderOffset + 0.05, 1.0, 0.03);
  rightArm.userData = { muscleKey: 'biceps', label: 'Biceps' };
  modelGroup.add(rightArm);

  const leftTri = new THREE.Mesh(new THREE.CylinderGeometry(armRadius * 0.95, armRadius * 0.85, 0.65, 12), getMat('triceps'));
  leftTri.position.set(-shoulderOffset - 0.05, 1.0, -0.06);
  leftTri.userData = { muscleKey: 'triceps', label: 'Triceps' };
  modelGroup.add(leftTri);

  const rightTri = new THREE.Mesh(new THREE.CylinderGeometry(armRadius * 0.95, armRadius * 0.85, 0.65, 12), getMat('triceps'));
  rightTri.position.set(shoulderOffset + 0.05, 1.0, -0.06);
  rightTri.userData = { muscleKey: 'triceps', label: 'Triceps' };
  modelGroup.add(rightTri);

  // Forearms
  const forearmRad = armRadius * 0.85;
  const leftForearm = new THREE.Mesh(new THREE.CylinderGeometry(forearmRad, forearmRad * 0.75, 0.65, 12), getMat('forearms'));
  leftForearm.position.set(-shoulderOffset - 0.08, 0.38, 0);
  leftForearm.userData = { muscleKey: 'forearms', label: 'Forearms' };
  modelGroup.add(leftForearm);

  const rightForearm = new THREE.Mesh(new THREE.CylinderGeometry(forearmRad, forearmRad * 0.75, 0.65, 12), getMat('forearms'));
  rightForearm.position.set(shoulderOffset + 0.08, 0.38, 0);
  rightForearm.userData = { muscleKey: 'forearms', label: 'Forearms' };
  modelGroup.add(rightForearm);

  // Hips / Glutes
  const hipWidth = isFemale ? 1.15 : 0.98;
  const glutesGeo = new THREE.BoxGeometry(hipWidth, 0.48, 0.58);
  const glutesMesh = new THREE.Mesh(glutesGeo, getMat('glutes'));
  glutesMesh.position.set(0, 0.38, -0.05);
  glutesMesh.userData = { muscleKey: 'glutes', label: 'Glutes' };
  modelGroup.add(glutesMesh);

  // Upper Legs: Quads & Hamstrings
  const legOffset = isFemale ? 0.32 : 0.28;
  const quadRad = (isFemale ? 0.24 : 0.22) * legScale;
  const leftQuad = new THREE.Mesh(new THREE.CylinderGeometry(quadRad, quadRad * 0.82, 0.85, 14), getMat('quads'));
  leftQuad.position.set(-legOffset, -0.25, 0.04);
  leftQuad.userData = { muscleKey: 'quads', label: 'Quadriceps' };
  modelGroup.add(leftQuad);

  const rightQuad = new THREE.Mesh(new THREE.CylinderGeometry(quadRad, quadRad * 0.82, 0.85, 14), getMat('quads'));
  rightQuad.position.set(legOffset, -0.25, 0.04);
  rightQuad.userData = { muscleKey: 'quads', label: 'Quadriceps' };
  modelGroup.add(rightQuad);

  const leftHam = new THREE.Mesh(new THREE.CylinderGeometry(quadRad * 0.95, quadRad * 0.78, 0.85, 14), getMat('hamstrings'));
  leftHam.position.set(-legOffset, -0.25, -0.06);
  leftHam.userData = { muscleKey: 'hamstrings', label: 'Hamstrings' };
  modelGroup.add(leftHam);

  const rightHam = new THREE.Mesh(new THREE.CylinderGeometry(quadRad * 0.95, quadRad * 0.78, 0.85, 14), getMat('hamstrings'));
  rightHam.position.set(legOffset, -0.25, -0.06);
  rightHam.userData = { muscleKey: 'hamstrings', label: 'Hamstrings' };
  modelGroup.add(rightHam);

  // Lower Legs: Calves
  const calfRad = quadRad * 0.75;
  const leftCalf = new THREE.Mesh(new THREE.CylinderGeometry(calfRad, calfRad * 0.6, 0.85, 12), getMat('calves'));
  leftCalf.position.set(-legOffset, -1.08, 0);
  leftCalf.userData = { muscleKey: 'calves', label: 'Calves' };
  modelGroup.add(leftCalf);

  const rightCalf = new THREE.Mesh(new THREE.CylinderGeometry(calfRad, calfRad * 0.6, 0.85, 12), getMat('calves'));
  rightCalf.position.set(legOffset, -1.08, 0);
  rightCalf.userData = { muscleKey: 'calves', label: 'Calves' };
  modelGroup.add(rightCalf);

  return modelGroup;
}

let active3DViewer = null;

async function init3DViewer(options = {}) {
  const {
    container,
    gender = S.cfg?.bodyModel || 'male',
    primaryMuscles = [],
    secondaryMuscles = [],
    physiqueProgress = null,
    onMuscleSelect = null
  } = options;

  if (!container) return null;
  const THREE = await lazyLoadThree();
  if (!THREE) return null;

  const width = container.clientWidth || 340;
  const height = container.clientHeight || 420;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
  camera.position.set(0, 0.4, 5.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2));

  container.innerHTML = '';
  container.appendChild(renderer.domElement);

  // Lighting
  const ambLight = new THREE.AmbientLight(0xFFFFFF, 0.7);
  scene.add(ambLight);

  const dirLight1 = new THREE.DirectionalLight(0xFFFFFF, 0.85);
  dirLight1.position.set(3, 4, 5);
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0x60A5FA, 0.4);
  dirLight2.position.set(-3, -2, -3);
  scene.add(dirLight2);

  // Model setup
  let currentGender = gender;
  let currentProgress = physiqueProgress;
  let model = buildProceduralAnatomyModel(THREE, currentGender, primaryMuscles, secondaryMuscles, currentProgress);
  scene.add(model);

  // Interaction & Touch / Mouse Orbit controls
  let isDragging = false;
  let prevPointerX = 0;
  let prevPointerY = 0;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let autoRotate = true;
  let pinchStartDist = 0;
  let animId = null;
  let isDestroyed = false;
  let lastFrameTime = 0;
  let isPaused = false;

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  const getPointerPos = (e) => {
    if (e.touches && e.touches.length > 0) {
      return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length > 0) {
      return { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
    }
    return { clientX: e.clientX, clientY: e.clientY };
  };

  const onPointerDown = (e) => {
    isDragging = true;
    const pos = getPointerPos(e);
    prevPointerX = pos.clientX;
    prevPointerY = pos.clientY;
    pointerStartX = pos.clientX;
    pointerStartY = pos.clientY;
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;
    const pos = getPointerPos(e);
    const dx = pos.clientX - prevPointerX;
    const dy = pos.clientY - prevPointerY;
    prevPointerX = pos.clientX;
    prevPointerY = pos.clientY;

    if (model) {
      model.rotation.y += dx * 0.01;
      model.rotation.x = Math.max(-0.4, Math.min(0.4, model.rotation.x + dy * 0.008));
    }
  };

  const onPointerUp = (e) => {
    if (!isDragging) return;
    isDragging = false;

    // Tap/click detection (delta < 8px)
    const pos = getPointerPos(e);
    const dist = Math.hypot(pos.clientX - pointerStartX, pos.clientY - pointerStartY);
    if (dist < 8 && model) {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        mouse.x = ((pos.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((pos.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(model.children, true);
        if (intersects && intersects.length > 0) {
          for (const hit of intersects) {
            if (hit.object && hit.object.userData && hit.object.userData.muscleKey) {
              const mKey = hit.object.userData.muscleKey;
              if (typeof onMuscleSelect === 'function') {
                onMuscleSelect(mKey);
              } else if (typeof showMuscleDetailSheet === 'function') {
                showMuscleDetailSheet(mKey);
              }
              break;
            }
          }
        }
      }
    }
  };

  const onWheel = (e) => {
    e.preventDefault();
    camera.position.z = Math.max(3.0, Math.min(8.0, camera.position.z + e.deltaY * 0.004));
  };

  // Touch handlers for mobile pinch-to-zoom
  const onTouchStart = (e) => {
    if (e.touches && e.touches.length === 2) {
      pinchStartDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  };

  const onTouchMove = (e) => {
    if (e.touches && e.touches.length === 2 && pinchStartDist > 0) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const diff = pinchStartDist - currentDist;
      camera.position.z = Math.max(3.0, Math.min(8.0, camera.position.z + diff * 0.01));
      pinchStartDist = currentDist;
      e.preventDefault();
    }
  };

  const onVisibilityChange = () => {
    if (typeof document !== 'undefined') {
      isPaused = document.hidden;
    }
  };

  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('touchend', onPointerUp, { passive: true });
  canvas.addEventListener('touchcancel', onPointerUp, { passive: true });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  // 30 fps delta-throttled animation loop
  const animate = (now) => {
    if (isDestroyed) return;
    animId = requestAnimationFrame(animate);

    if (isPaused) return;

    // Delta-throttle to ~30 fps (33ms)
    if (now - lastFrameTime < 33) return;
    lastFrameTime = now;

    if (autoRotate && !isDragging && model) {
      model.rotation.y += 0.008;
    }

    renderer.render(scene, camera);
  };
  animId = requestAnimationFrame(animate);

  const viewerInstance = {
    destroy() {
      if (isDestroyed) return;
      isDestroyed = true;
      if (animId) cancelAnimationFrame(animId);

      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('touchend', onPointerUp);
      canvas.removeEventListener('touchcancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }

      // Explicit scene traversal and disposal
      scene.traverse(obj => {
        if (obj.geometry && typeof obj.geometry.dispose === 'function') {
          obj.geometry.dispose();
        }
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m && typeof m.dispose === 'function' && m.dispose());
          } else if (typeof obj.material.dispose === 'function') {
            obj.material.dispose();
          }
        }
      });

      if (renderer && typeof renderer.dispose === 'function') {
        renderer.dispose();
      }
      container.innerHTML = '';
    },
    setGender(g) {
      currentGender = g;
      scene.remove(model);
      model.traverse(obj => {
        if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();
        if (obj.material && typeof obj.material.dispose === 'function') obj.material.dispose();
      });
      model = buildProceduralAnatomyModel(THREE, currentGender, primaryMuscles, secondaryMuscles, currentProgress);
      scene.add(model);
    },
    setPhysiqueProgress(p) {
      currentProgress = p;
      scene.remove(model);
      model.traverse(obj => {
        if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();
        if (obj.material && typeof obj.material.dispose === 'function') obj.material.dispose();
      });
      model = buildProceduralAnatomyModel(THREE, currentGender, primaryMuscles, secondaryMuscles, currentProgress);
      scene.add(model);
    },
    resetView() {
      if (model) {
        model.rotation.set(0, 0, 0);
      }
      camera.position.set(0, 0.4, 5.2);
    },
    toggleAutoRotate(val) {
      autoRotate = val != null ? val : !autoRotate;
      return autoRotate;
    },
    isAutoRotate() {
      return autoRotate;
    }
  };

  active3DViewer = viewerInstance;
  return viewerInstance;
}

function show3DAnatomyModal(primaryMuscles = [], secondaryMuscles = []) {
  if (active3DViewer) {
    try { active3DViewer.destroy(); } catch (_) {}
    active3DViewer = null;
  }

  const pKeys = Array.isArray(primaryMuscles) ? primaryMuscles : (typeof primaryMuscles === 'string' ? primaryMuscles.split(',').filter(Boolean) : []);
  const sKeys = Array.isArray(secondaryMuscles) ? secondaryMuscles : (typeof secondaryMuscles === 'string' ? secondaryMuscles.split(',').filter(Boolean) : []);
  const currentGender = S.cfg?.bodyModel || 'male';

  const hasWebGL = isWebGLAvailable();

  if (!hasWebGL) {
    // Graceful 2D SVG fallback
    modal(`
      <div class="modal-header">
        <h3 class="modal-title">📐 Anatomical Muscle Map</h3>
        <button class="modal-close-btn" data-a="close">✕</button>
      </div>
      <div style="background:var(--card-sub);padding:10px 14px;border-radius:10px;margin-bottom:12px;font-size:12px;color:var(--t2);">
        ⚠️ WebGL 3D acceleration is not available or disabled on this device. Showing interactive 2D anatomical map.
      </div>
      <div style="text-align:center;">
        ${mmap(pKeys, sKeys, { gender: currentGender, wrap: true })}
      </div>
    `);
    return;
  }

  modal(`
    <div class="modal-header">
      <h3 class="modal-title">📐 3D Interactive Anatomy</h3>
      <button class="modal-close-btn" data-a="close">✕</button>
    </div>
    <div class="canvas-3d-controls" style="display:flex;gap:6px;margin-bottom:10px;justify-content:center;flex-wrap:wrap;">
      <button class="chip" data-a="toggle-3d-gender" id="gender-3d-btn" style="font-weight:700;">Silhouette: <span id="gender-3d-label">${currentGender === 'female' ? 'Female' : 'Male'}</span></button>
      <button class="chip on" data-a="toggle-3d-autorotate" id="autorotate-3d-btn">🔄 Auto-Rotate: ON</button>
      <button class="chip" data-a="reset-3d-view">↺ Reset View</button>
    </div>
    <div class="canvas-3d-wrap" id="anatomy-3d-canvas-wrap">
      <div class="canvas-3d-hint">👆 Drag to 360° rotate · Pinch to zoom · Tap muscle to explore</div>
    </div>
    <div class="canvas-3d-overlay">
      <span class="legend-chip"><span class="legend-color-dot dot-pri"></span> Primary Target</span>
      <span class="legend-chip"><span class="legend-color-dot dot-sec"></span> Secondary Target</span>
      <span class="legend-chip"><span class="legend-color-dot dot-neutral"></span> Other Muscles</span>
    </div>
  `);

  requestAnimationFrame(() => {
    setTimeout(() => {
      const container = document.getElementById('anatomy-3d-canvas-wrap');
      if (container) {
        init3DViewer({
          container,
          gender: currentGender,
          primaryMuscles: pKeys,
          secondaryMuscles: sKeys,
          onMuscleSelect: (mKey) => {
            showMuscleDetailSheet(mKey);
          }
        });
      }
    }, 60);
  });
}

function show3DPhysiqueModal(initialProgress = 0.5) {
  if (active3DViewer) {
    try { active3DViewer.destroy(); } catch (_) {}
    active3DViewer = null;
  }

  const pState = getPhysiqueState();
  const currentGender = S.cfg?.bodyModel || 'male';
  const hasWebGL = isWebGLAvailable();

  const prog = Math.max(0, Math.min(1, initialProgress != null ? initialProgress : ((pState && pState.overallProgress != null) ? pState.overallProgress / 100 : 0.5)));
  const displayPct = Math.round(prog * 100);

  if (!hasWebGL) {
    modal(`
      <div class="modal-header">
        <h3 class="modal-title">⚡ Physique Transformation</h3>
        <button class="modal-close-btn" data-a="close">✕</button>
      </div>
      <div style="background:var(--card-sub);padding:10px 14px;border-radius:10px;margin-bottom:12px;font-size:12px;color:var(--t2);">
        ⚠️ WebGL 3D acceleration is not available. Showing 2D transformation roadmap.
      </div>
      <div style="text-align:center;">
        ${generateMorphSvg(currentGender, prog)}
      </div>
    `);
    return;
  }

  modal(`
    <div class="modal-header">
      <h3 class="modal-title">⚡ 3D Physique Transformation Morph</h3>
      <button class="modal-close-btn" data-a="close">✕</button>
    </div>
    <div class="canvas-3d-controls" style="display:flex;gap:6px;margin-bottom:10px;justify-content:center;flex-wrap:wrap;">
      <button class="chip" data-a="toggle-3d-gender" id="gender-3d-btn" style="font-weight:700;">Silhouette: <span id="gender-3d-label">${currentGender === 'female' ? 'Female' : 'Male'}</span></button>
      <button class="chip on" data-a="toggle-3d-autorotate" id="autorotate-3d-btn">🔄 Auto-Rotate: ON</button>
      <button class="chip" data-a="reset-3d-view">↺ Reset</button>
    </div>
    <div class="canvas-3d-wrap" id="physique-3d-canvas-wrap">
      <div class="canvas-3d-hint">Scrub slider below to inspect 3D V-taper, waist & chest progression</div>
    </div>
    <div style="margin-top:12px;padding:0 8px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--t2);margin-bottom:4px;">
        <span>0% Baseline</span>
        <b id="physique-3d-pct-label" style="color:var(--ac);">${displayPct}% Progress</b>
        <span>100% Goal</span>
      </div>
      <input type="range" min="0" max="100" value="${displayPct}" id="physique-3d-slider" class="morph-scrub-slider" style="width:100%;">
    </div>
  `);

  requestAnimationFrame(() => {
    setTimeout(() => {
      const container = document.getElementById('physique-3d-canvas-wrap');
      if (container) {
        const viewer = init3DViewer({
          container,
          gender: currentGender,
          physiqueProgress: prog
        });

        const slider = document.getElementById('physique-3d-slider');
        const label = document.getElementById('physique-3d-pct-label');
        if (slider) {
          slider.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            if (label) label.textContent = `${val}% Progress`;
            if (viewer) viewer.setPhysiqueProgress(val / 100);
          });
        }
      }
    }, 60);
  });
}

function animateCounter(el, start, end, duration = 800, suffix = '') {
  if (!el) return;
  const s = Number(start) || 0;
  const e = Number(end) || 0;

  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = `${e}${suffix}`;
    return;
  }

  const rAF = (typeof window !== 'undefined' && window.requestAnimationFrame)
    ? window.requestAnimationFrame.bind(window)
    : ((typeof requestAnimationFrame !== 'undefined') ? requestAnimationFrame : (cb => setTimeout(cb, 16)));

  const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const step = (currentTime) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(1, elapsed / duration);
    // Ease-out cubic
    const ease = 1 - Math.pow(1 - progress, 3);
    const currentVal = Math.round(s + (e - s) * ease);
    el.textContent = `${currentVal}${suffix}`;
    if (progress < 1) {
      rAF(step);
    }
  };
  rAF(step);
}

function renderVolumeRadarChart(muscleVolumes = {}) {
  let data = { Chest: 0, Back: 0, Legs: 0, Shoulders: 0, Arms: 0, Core: 0 };
  if (Array.isArray(muscleVolumes)) {
    for (const item of muscleVolumes) {
      const name = item.muscle || item.name;
      const sets = Number(item.sets || item.count || item.volume || 0);
      if (name in data) {
        data[name] = sets;
      } else if (name === 'Glutes' || name === 'Hamstrings' || name === 'Quads' || name === 'Calves') {
        data['Legs'] += sets;
      } else if (name === 'Biceps' || name === 'Triceps' || name === 'Forearms') {
        data['Arms'] += sets;
      } else if (name === 'Traps' || name === 'Lats') {
        data['Back'] += sets;
      } else if (name === 'Deltoids') {
        data['Shoulders'] += sets;
      } else if (name === 'Abs' || name === 'Obliques') {
        data['Core'] += sets;
      }
    }
  } else if (muscleVolumes && typeof muscleVolumes === 'object') {
    for (const [k, v] of Object.entries(muscleVolumes)) {
      if (k in data) data[k] = Number(v) || 0;
      else if (k === 'Abs' || k === 'Obliques') data['Core'] = (data['Core'] || 0) + (Number(v) || 0);
    }
  }

  const axes = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core'];
  const centerX = 130;
  const centerY = 130;
  const radius = 80;
  const maxSets = 20;

  const getCoord = (angleRad, r) => ({
    x: Math.round(centerX + r * Math.sin(angleRad)),
    y: Math.round(centerY - r * Math.cos(angleRad))
  });

  // Concentric grid rings at 33%, 66%, 100%
  const gridRings = [0.33, 0.66, 1.0].map(frac => {
    const r = radius * frac;
    const pts = axes.map((_, i) => {
      const angle = (i * 2 * Math.PI) / axes.length;
      const c = getCoord(angle, r);
      return `${c.x},${c.y}`;
    }).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="var(--border, rgba(255,255,255,0.12))" stroke-width="1" stroke-dasharray="${frac < 1.0 ? '2,2' : 'none'}"/>`;
  }).join('');

  // Axis lines
  const axisLines = axes.map((label, i) => {
    const angle = (i * 2 * Math.PI) / axes.length;
    const end = getCoord(angle, radius);
    const labelPos = getCoord(angle, radius + 18);
    return `
      <line x1="${centerX}" y1="${centerY}" x2="${end.x}" y2="${end.y}" stroke="var(--border, rgba(255,255,255,0.15))" stroke-width="1"/>
      <text x="${labelPos.x}" y="${labelPos.y + 4}" font-size="10" font-weight="600" text-anchor="middle" fill="var(--t2, #94A3B8)">${label}</text>
    `;
  }).join('');

  // Radar polygon points
  const radarPoints = axes.map((axis, i) => {
    const angle = (i * 2 * Math.PI) / axes.length;
    const val = Math.min(maxSets, Math.max(0, data[axis] || 0));
    const frac = val / maxSets;
    const r = radius * Math.max(0.08, frac);
    const coord = getCoord(angle, r);
    return `${coord.x},${coord.y}`;
  }).join(' ');

  const vertices = axes.map((axis, i) => {
    const angle = (i * 2 * Math.PI) / axes.length;
    const val = Math.min(maxSets, Math.max(0, data[axis] || 0));
    const frac = val / maxSets;
    const r = radius * Math.max(0.08, frac);
    const c = getCoord(angle, r);
    return `<circle cx="${c.x}" cy="${c.y}" r="3.5" fill="#FF9F0A" stroke="#FFFFFF" stroke-width="1.5"/>`;
  }).join('');

  return `
    <div class="radar-chart-wrap" style="text-align:center;margin:12px 0;">
      <div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:4px;">Weekly Volume Radar (20s Target)</div>
      <svg class="radar-chart-svg" viewBox="0 0 260 260" width="100%" height="220" style="max-width:280px;display:inline-block;overflow:visible;">
        ${gridRings}
        ${axisLines}
        <polygon points="${radarPoints}" fill="rgba(255, 159, 10, 0.25)" stroke="#FF9F0A" stroke-width="2"/>
        ${vertices}
      </svg>
    </div>
  `;
}

function triggerPRCelebration(options = {}) {
  const { text = '🎉 NEW PERSONAL RECORD!', container = (typeof document !== 'undefined' ? document.body : null) } = options;
  if (!container || typeof document === 'undefined' || typeof document.createElement !== 'function') return;

  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (typeof toast === 'function') toast(text);
    return;
  }

  const existing = document.getElementById ? document.getElementById('pr-celebration-overlay') : null;
  if (existing && typeof existing.remove === 'function') existing.remove();

  const overlay = document.createElement('div');
  if (!overlay || typeof overlay.appendChild !== 'function' || typeof container.appendChild !== 'function') {
    if (typeof toast === 'function') toast(text);
    return;
  }
  overlay.id = 'pr-celebration-overlay';
  overlay.className = 'pr-celebration-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;overflow:hidden;display:flex;align-items:center;justify-content:center;';

  const banner = document.createElement('div');
  banner.className = 'pr-banner-card';
  banner.style.cssText = 'background:rgba(10,10,12,0.92);backdrop-filter:blur(16px);border:2px solid #FF9F0A;padding:16px 24px;border-radius:16px;box-shadow:0 12px 36px rgba(255,159,10,0.35);text-align:center;color:#FFF;transform:scale(0.8);opacity:0;transition:all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);';
  banner.innerHTML = `<div style="font-size:24px;margin-bottom:4px;">🏆</div><div style="font-size:16px;font-weight:800;color:#FF9F0A;">${esc(text)}</div>`;
  overlay.appendChild(banner);

  const colors = ['#FF9F0A', '#0A84FF', '#30D158', '#FF453A', '#BF5AF2', '#FFD60A'];
  const confettiCount = 36;
  const particles = [];

  for (let i = 0; i < confettiCount; i++) {
    const p = document.createElement('div');
    const color = colors[i % colors.length];
    const size = 6 + Math.random() * 6;
    p.style.cssText = `position:absolute;width:${size}px;height:${size}px;background:${color};border-radius:${Math.random() > 0.5 ? '50%' : '2px'};top:50%;left:50%;opacity:1;will-change:transform,opacity;`;
    overlay.appendChild(p);
    particles.push({
      el: p,
      x: 0,
      y: 0,
      vx: (Math.random() - 0.5) * 16,
      vy: (Math.random() - 0.7) * 18,
      rot: Math.random() * 360,
      vrot: (Math.random() - 0.5) * 20,
      alpha: 1
    });
  }

  const rAF = (typeof window !== 'undefined' && window.requestAnimationFrame)
    ? window.requestAnimationFrame.bind(window)
    : ((typeof requestAnimationFrame !== 'undefined') ? requestAnimationFrame : (cb => setTimeout(cb, 16)));
  const cAF = (typeof window !== 'undefined' && window.cancelAnimationFrame)
    ? window.cancelAnimationFrame.bind(window)
    : ((typeof cancelAnimationFrame !== 'undefined') ? cancelAnimationFrame : clearTimeout);

  container.appendChild(overlay);

  rAF(() => {
    banner.style.transform = 'scale(1)';
    banner.style.opacity = '1';
  });

  const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  let animId = null;

  const tickPhysics = (now) => {
    const elapsed = now - startTime;
    if (elapsed > 2400) {
      if (animId) cAF(animId);
      overlay.style.transition = 'opacity 0.3s ease';
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 320);
      return;
    }

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.45;
      p.rot += p.vrot;
      if (elapsed > 1600) {
        p.alpha = Math.max(0, 1 - (elapsed - 1600) / 800);
      }
      p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) rotate(${p.rot}deg)`;
      p.el.style.opacity = p.alpha;
    });

    animId = rAF(tickPhysics);
  };

  animId = rAF(tickPhysics);
}

// ---- Math & Progression Engine ----
const rd = Calc.rd || (n => Math.round((Number(n) || 0) * 10) / 10);
const roundWeight = Calc.roundWeight || ((w, s = 0.01) => Math.round(Number(w) / s) * s);
const toKg = Calc.toKg || ((v, u = 'kg') => u === 'lbs' ? Calc.lbsToKg(v) : roundWeight(v, 0.01));
const fromKg = Calc.fromKg || ((v, u = 'kg') => u === 'lbs' ? Calc.kgToLbs(v) : rd(v));
const toLocalDateKey = Calc.toLocalDateKey || (t => new Date(t).toISOString().slice(0, 10));
const epley = Calc.epley || ((w, r) => (Number(w) || 0) * (1 + (Number(r) || 0) / 30));
const e1 = epley;
const brzycki = Calc.brzycki || ((w, r) => {
  w = Number(w); r = Number(r);
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) return 0;
  if (r === 1) return rd(w);
  const cappedR = Math.min(10, r);
  return rd((w * 36) / (37 - cappedR));
});
const br = brzycki;
const estimate1RM = Calc.estimate1RM || brzycki;
const isWarmupSet = Calc.isWarmupSet || (s => Boolean(s && (s.type === 'W' || s.type === 'warmup' || s.isWarmup)));
const isSetDone = Calc.isSetDone || ((s, uni) => Boolean(s && (s.done || (uni && s.sideL && s.sideR))));

const scoreSet = (id, s) => {
  const e = X(id);
  const w = Number(s?.w) || 0;
  const r = Number(s?.r) || 0;
  if (r <= 0) return 0;
  if (e?.t === 't') return r;
  if (e?.t === 'b') return w > 0 ? e1(w, r) + 1000 : r;
  return e1(w, r);
};

const bestSet = id => {
  let b = null, m = -1;
  for (const l of (S.logs || [])) {
    for (const x of (l.ex || [])) {
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

const getLastSessionExercise = (id, beforeTimestamp = Date.now()) => {
  if (Calc.getPrevPerformance) {
    return Calc.getPrevPerformance(id, S.logs || [], beforeTimestamp);
  }
  const sid = String(id || '');
  for (let i = (S.logs || []).length - 1; i >= 0; i--) {
    const l = S.logs[i];
    if (!Array.isArray(l.ex)) continue;
    const found = l.ex.find(x => String(x.id) === sid);
    if (found && Array.isArray(found.sets) && found.sets.length > 0) {
      return found;
    }
  }
  return null;
};

const lastSet = id => {
  const ex = getLastSessionExercise(id);
  if (ex && ex.sets && ex.sets.length) return ex.sets[0];
  return null;
};

const dk = Calc.dk || (t => {
  const d = new Date(t);
  return d.getFullYear() * 1e4 + (d.getMonth() + 1) * 100 + d.getDate();
});

function streak() {
  if (Calc.calcStreak) return Calc.calcStreak(S.logs || [], Date.now());
  const s = new Set((S.logs || []).map(l => dk(l.date)));
  const d = new Date();
  let n = 0;
  if (!s.has(dk(d))) d.setDate(d.getDate() - 1);
  while (s.has(dk(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function prog(rx, sets, equipment) {
  if (Calc.checkDoubleProgression && rx.prog === 'double') {
    const res = Calc.checkDoubleProgression(rx, sets, equipment, S.cfg?.unit || 'kg');
    if (res && res.eligible) {
      rx.w = (Number(rx.w) || 0) + res.suggestedInc;
      return res.message;
    }
  }
  rx.inc = Number(rx.inc) || 2.5;
  rx.w = Number(rx.w) || 0;
  rx.stalls = Number(rx.stalls) || 0;
  const targetSets = Array.isArray(rx.sets) ? rx.sets.length : (Number(rx.sets) || 3);
  rx.reps = Number(rx.reps) || 5;
  rx.reps2 = Math.max(rx.reps, Number(rx.reps2) || rx.reps);
  rx.cur = Number(rx.cur) || rx.reps;

  const need = rx.prog === 'double' ? rx.cur : rx.reps;
  const d = (Array.isArray(sets) ? sets : []).filter(s => s && (s.done || (s.sideL && s.sideR)));
  const R = n => Math.round(n / 2.5) * 2.5;
  const ok = d.length >= targetSets && d.every(s => (Number(s.r) || 0) >= need);

  // Check RIR signals across completed sets
  const setsWithRir = d.filter(s => s.rir != null);
  const allHighRir = setsWithRir.length >= targetSets && setsWithRir.every(s => Number(s.rir) >= 2);
  const hadFailure = d.some(s => Number(s.rir) === 0 || Number(s.rpe) >= 10);

  if (ok) {
    rx.stalls = 0;
    if (allHighRir) {
      if (rx.prog === 'double') {
        rx.cur = Math.min(rx.reps2, rx.cur + 2);
        return `Aggressive target up to ${rx.cur} reps (all sets RIR ≥ 2)`;
      }
      const aggInc = rd(rx.inc * 1.5);
      rx.w = rd(rx.w + aggInc);
      return `Aggressive jump to ${rx.w} kg (+${aggInc}kg: all sets RIR ≥ 2)`;
    }
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
  if (hadFailure && rx.stalls >= 2) {
    rx.w = Math.max(0, rd(R(rx.w * 0.9)));
    rx.stalls = 0;
    if (rx.prog === 'double') rx.cur = rx.reps;
    return `Deload 10% to ${rx.w} kg (Stalled at RIR 0 Failure)`;
  }
  if (hadFailure) {
    return `Maintain load at ${rx.w} kg (Stalled at RIR 0 Failure)`;
  }
  if (rx.stalls >= stallLimit) {
    rx.w = Math.max(0, rd(R(rx.w * 0.9)));
    rx.stalls = 0;
    if (rx.prog === 'double') rx.cur = rx.reps;
    return `Deload 10% to ${rx.w} kg`;
  }
  return `Stall ${rx.stalls}/${stallLimit}`;
}

// ---- Personal Record (PR) Engine ----
const getExercisePRs = (id, excludeSet = null) => {
  let maxWeight = 0;
  let max1RM = 0;
  let maxVolume = 0;
  let count = 0;
  const maxRepsByWeight = new Map();

  const processSet = (s, isUni) => {
    if (!s || s === excludeSet) return;
    const w = Math.max(0, Number(s.w) || 0);
    const r = Math.max(0, Number(s.r) || 0);
    const isDone = s.done || (isUni && s.sideL && s.sideR);
    if (isDone && (w > 0 || r > 0)) {
      count++;
      if (w > maxWeight) maxWeight = w;
      const oneRM = br(w, r); // Estimated 1RM via Brzycki formula
      if (oneRM > max1RM) max1RM = oneRM;
      const currMaxR = maxRepsByWeight.get(w) || 0;
      if (r > currMaxR) maxRepsByWeight.set(w, r);
      maxVolume += setVolume(s, isUni, id);
    }
  };

  // 1. Scan historical logs in S.logs
  for (const log of (S.logs || [])) {
    for (const ex of (log.ex || [])) {
      if (String(ex.id) === String(id)) {
        for (const s of (ex.sets || [])) {
          processSet(s, !!ex.uni);
        }
      }
    }
  }

  // 2. Scan active session S.act sets (excluding the current set)
  if (S.act && Array.isArray(S.act.ex)) {
    for (const ex of S.act.ex) {
      if (String(ex.id) === String(id)) {
        for (const s of (ex.sets || [])) {
          processSet(s, !!ex.uni);
        }
      }
    }
  }

  return { maxWeight, max1RM, maxVolume, count, maxRepsByWeight };
};

const checkPersonalRecord = (id, s, uni = false, excludeSet = null) => {
  const w = Math.max(0, Number(s?.w) || 0);
  const r = Math.max(0, Number(s?.r) || 0);
  const isDone = s?.done || (uni && s?.sideL && s?.sideR);
  if (!isDone || (w <= 0 && r <= 0)) return null;

  // Compare against global all-time bests across entire history (excluding current set s)
  const prior = getExercisePRs(id, excludeSet || s);
  const oneRM = br(w, r); // Brzycki formula: Weight * (36 / (37 - Reps))
  const types = [];

  if (prior.count === 0) {
    // First milestone logged for this exercise
    if (w > 0) types.push('Weight');
    if (oneRM > 0) types.push('1RM');
  } else {
    // Absolute Max Weight logged
    if (w > 0 && w > prior.maxWeight) {
      types.push('Weight');
    }
    // Max Reps at that specific weight
    const priorRepsAtWeight = prior.maxRepsByWeight.get(w) || 0;
    if (priorRepsAtWeight > 0 && r > priorRepsAtWeight) {
      types.push('Reps');
    }
    // Estimated 1RM via Brzycki formula
    if (oneRM > 0 && oneRM > prior.max1RM) {
      types.push('1RM');
    }
  }

  // Strictly suppress false PR trophies when completing sub-maximal or duplicate sets
  if (types.length) {
    let primaryType = 'weight';
    if (prior.count === 0) {
      primaryType = w > 0 ? 'weight' : '1rm';
    } else if (w > 0 && w > prior.maxWeight) {
      primaryType = 'weight';
    } else if ((prior.maxRepsByWeight.get(w) || 0) > 0 && r > (prior.maxRepsByWeight.get(w) || 0)) {
      primaryType = 'reps';
    } else if (oneRM > 0 && oneRM > prior.max1RM) {
      primaryType = '1rm';
    }
    return { isPR: true, type: primaryType, types, w, r, oneRM, desc: types.join(' & ') + ' PR' };
  }
  return null;
};

const checkSetPR = checkPersonalRecord;

// ---- Barbell Plate Calculator ----
const calcPlates = (totalWeight, barWeight = 20) => {
  const targetPerSide = Math.max(0, (totalWeight - barWeight) / 2);
  const plateTypes = [20, 15, 10, 5, 2.5, 1.25];
  let rem = targetPerSide;
  const plates = [];
  for (const p of plateTypes) {
    const count = Math.floor((rem + 0.0001) / p);
    if (count > 0) {
      plates.push({ weight: p, count });
      rem = Math.round((rem - count * p) * 1000) / 1000;
    }
  }
  const loadedWeight = barWeight + 2 * plates.reduce((sum, r) => sum + r.weight * r.count, 0);
  return { barWeight, perSide: targetPerSide, weightPerSide: targetPerSide, plates, remainder: rem, rem, loadedWeight };
};

// ---- Per-Exercise Strength Progression Line Chart Generator ----
const renderExerciseProgressionChart = exId => {
  const e = X(exId);
  const pts = [];

  for (const log of S.logs) {
    const exEntry = (log.ex || []).find(x => String(x.id) === String(exId));
    if (exEntry && Array.isArray(exEntry.sets) && exEntry.sets.length) {
      const validSets = exEntry.sets.filter(s => s && (s.done || (exEntry.uni && (s.sideL || s.sideR))));
      if (validSets.length) {
        let bestScore = 0;
        let topW = 0;
        for (const s of validSets) {
          const w = Number(s.w) || 0;
          const r = Number(s.r) || 0;
          if (w > topW) topW = w;
          const score = e.t === 't' ? r : e1(w, r);
          if (score > bestScore) bestScore = score;
        }
        if (bestScore > 0 || topW > 0) {
          pts.push({
            date: log.date,
            dateLabel: new Date(log.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            val: rd(bestScore),
            w: topW
          });
        }
      }
    }
  }

  if (pts.length < 2) {
    if (pts.length === 1) {
      return `
        <div class="prog-chart-wrap">
          <div class="prog-chart-header">
            <span class="prog-chart-title">Strength Progression</span>
            <span class="prog-chart-stat">${pts[0].val} ${e.t === 't' ? 'sec' : 'kg est. 1RM'}</span>
          </div>
          <p class="t2 sm" style="text-align:center;padding:12px 0">First milestone logged on ${pts[0].dateLabel} (${pts[0].val} ${e.t === 't' ? 'sec' : 'kg'}). Complete more workouts to plot your progression curve!</p>
        </div>
      `;
    }
    return `
      <div class="prog-chart-wrap">
        <div class="prog-chart-header">
          <span class="prog-chart-title">Strength Progression</span>
          <span class="prog-chart-stat">--</span>
        </div>
        <p class="t2 sm" style="text-align:center;padding:12px 0">No logged history yet for this exercise. Complete a session to start tracking strength progression!</p>
      </div>
    `;
  }

  const W = 320, H = 140, padL = 38, padR = 16, padT = 16, padB = 24;
  const vals = pts.map(p => p.val);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const range = (maxV - minV) || 1;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const coords = pts.map((p, i) => {
    const x = padL + (i / (pts.length - 1)) * plotW;
    const y = padT + (1 - (p.val - minV) / range) * plotH;
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, ...p };
  });

  const lineD = 'M ' + coords.map(c => `${c.x},${c.y}`).join(' L ');
  const areaD = lineD + ` L ${coords.at(-1).x},${H - padB} L ${coords[0].x},${H - padB} Z`;

  return `
    <div class="prog-chart-wrap">
      <div class="prog-chart-header">
        <span class="prog-chart-title">Strength Progression (Est. 1RM)</span>
        <span class="prog-chart-stat">${coords.at(-1).val} ${e.t === 't' ? 'sec' : 'kg'}</span>
      </div>
      <svg class="prog-chart-svg" viewBox="0 0 ${W} ${H}">
        <defs>
          <linearGradient id="chart-grad-${esc(exId)}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0A84FF" stop-opacity="0.45"/>
            <stop offset="100%" stop-color="#0A84FF" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        <line class="chart-grid" x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}"/>
        <line class="chart-grid" x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}"/>
        <path class="chart-area" d="${areaD}" fill="url(#chart-grad-${esc(exId)})"/>
        <path class="chart-line" d="${lineD}"/>
        ${coords.map(c => `<circle class="chart-dot" cx="${c.x}" cy="${c.y}" r="3.5"><title>${c.dateLabel}: ${c.val} kg</title></circle>`).join('')}
        <text class="chart-label" x="${coords[0].x}" y="${H - 6}">${coords[0].dateLabel}</text>
        <text class="chart-label" x="${coords.at(-1).x}" y="${H - 6}">${coords.at(-1).dateLabel}</text>
        <text class="chart-label" x="${padL - 4}" y="${padT + 4}" style="text-anchor:end">${maxV}</text>
        <text class="chart-label" x="${padL - 4}" y="${H - padB}" style="text-anchor:end">${minV}</text>
      </svg>
    </div>
  `;
};

// ---- View Header with Persistent Frosted Settings Gear ----
const viewHeader = title => `
  <div class="view-header">
    <h1>${esc(title)}</h1>
    <button class="gear-btn frosted" data-a="opensettings" aria-label="Settings" title="Settings">${ic('gear', 20)}</button>
  </div>
`;

// ---- Scannable Routine Summary Row Component ----
const renderRoutineSummaryRow = x => {
  const e = X(x.id);
  const setsReps = Number(x.w) > 0
    ? `${x.sets} × ${x.reps} @ ${x.w}kg`
    : `${x.sets} × ${x.reps}`;
  const media = e.img || e.gif;
  return `
    <div class="routine-summary-row">
      <div class="routine-summary-left">
        ${media
          ? `<img class="routine-summary-thumb" src="./media/${esc(media)}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : `<span class="routine-summary-pill">${esc(e.g || 'Core')}</span>`
        }
        <span class="routine-summary-name">${esc(e.name)}</span>
      </div>
      <div class="routine-summary-badge">${setsReps}</div>
    </div>
  `;
};

// ---- Unified Streak Badge Component (Apple-Style Status Pill) ----
const renderStreakBadge = () => {
  const s = streak();
  let encouragingText = 'Ready for your first session? 💪';
  if (s === 1) {
    encouragingText = 'Great start! Keep it up 💪';
  } else if (s > 1) {
    encouragingText = `${s} days strong! Keep going 🔥`;
  } else if (S.logs && S.logs.length > 0) {
    encouragingText = 'Ready for your next session? 💪';
  }

  return `
    <div class="streak-badge-card">
      <div class="streak-badge-left">
        <span class="streak-fire">🔥</span>
        <span class="streak-count"><b>${s}</b> Day Streak</span>
      </div>
      <div class="streak-encouragement-badge">
        <span>${encouragingText}</span>
      </div>
    </div>
  `;
};

// ---- Rest Timer, Audio & Wake Lock ----
const T = { end: 0, iv: 0, durMs: 90000, supersetLoop: null };

const unlock = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!ac) ac = new AudioCtx();
    if (ac.state === 'suspended') ac.resume();
    const buf = ac.createBuffer(1, 1, 22050);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    src.start(0);
  } catch {}
};

const playRestChime = () => {
  try {
    if (!ac) unlock();
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume();

    const t0 = ac.currentTime;

    // Tone 1: Gentle warm bell tone (D5 - 587.33 Hz)
    const o1 = ac.createOscillator();
    const g1 = ac.createGain();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(587.33, t0);
    o1.connect(g1);
    g1.connect(ac.destination);

    // Smooth gain curve: soft attack (18ms) to eliminate click, natural exponential decay
    g1.gain.setValueAtTime(0.0001, t0);
    g1.gain.linearRampToValueAtTime(0.20, t0 + 0.018);
    g1.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.60);

    o1.start(t0);
    o1.stop(t0 + 0.60);

    // Tone 2: Harmonic upper chime (A5 - 880.00 Hz) offset by 100ms
    const t1 = t0 + 0.10;
    const o2 = ac.createOscillator();
    const g2 = ac.createGain();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(880.00, t1);
    o2.connect(g2);
    g2.connect(ac.destination);

    // Smooth gain curve for second tone
    g2.gain.setValueAtTime(0.0001, t1);
    g2.gain.linearRampToValueAtTime(0.24, t1 + 0.022);
    g2.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.85);

    o2.start(t1);
    o2.stop(t1 + 0.85);
  } catch {}
};

const beep = playRestChime;

const getExRest = id => (S.cfg?.exerciseRest?.[id]) || (S.cfg?.rest) || 90;

function startRest(s) {
  unlock();
  const durSec = s != null ? s : (S.cfg?.rest || 90);
  T.durMs = Math.max(1, durSec) * 1000;
  T.end = Date.now() + T.durMs;
  clearInterval(T.iv);
  T.iv = setInterval(tick, 250);
  $('#rest').hidden = false;
  tick();
}

function tick() {
  const remaining = Math.max(0, T.end - Date.now());
  const l = Math.ceil(remaining / 1000);
  if (l <= 0) {
    stopRest();
    if (S.cfg.sound !== false) playRestChime();
    if (S.cfg.vibrate !== false && navigator.vibrate) navigator.vibrate([100, 50, 100]);
    if (S.cfg.flash) {
      document.body.classList.remove('flash');
      void document.body.offsetWidth;
      document.body.classList.add('flash');
    }
    // Superset Auto-Loop: Automatically loop back to Set 2 (or next set) of Exercise A
    if (T.supersetLoop && S.act) {
      const loop = T.supersetLoop;
      T.supersetLoop = null;
      if (S.act.ex[loop.targetEx] && loop.targetSet < S.act.ex[loop.targetEx].sets.length) {
        switchWorkExercise(loop.targetEx);
        toast(`⚡ Superset Round ${loop.round} of ${loop.totalRounds}: ${esc(X(S.act.ex[loop.targetEx].id).name)}`);
        focusSetInput(loop.targetEx, loop.targetSet);
      }
    }
    return;
  }
  const ringEl = $('#rest-ring-fill');
  if (ringEl) {
    const pct = Math.max(0, Math.min(1, remaining / (T.durMs || 90000)));
    ringEl.style.strokeDashoffset = 94.25 * (1 - pct);
  }
  const textEl = $('#rest b');
  if (textEl) textEl.textContent = Math.floor(l / 60) + ':' + String(l % 60).padStart(2, '0');
}

const stopRest = (clearLoop = false) => {
  clearInterval(T.iv);
  $('#rest').hidden = true;
  if (clearLoop) T.supersetLoop = null;
};

const wake = async () => {
  try {
    if ('wakeLock' in navigator) {
      wl = await navigator.wakeLock.request('screen');
    }
  } catch {}
};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (S.act) wake();
    // Recompute remaining rest time immediately upon returning to foreground
    if (T.end && $('#rest') && !$('#rest').hidden) {
      tick();
    }
  }
});

let modalKeydownHandler = null;
let modalViewportHandler = null;
let prevActiveElement = null;

const modal = (h, opts = {}) => {
  const m = $('#m');
  if (!m) return;
  if (typeof document !== 'undefined') {
    prevActiveElement = document.activeElement;
    if (document.body) {
      document.body.style.overflow = 'hidden';
    }
  }
  const showX = opts?.hideClose ? '' : '<button class="x" data-a="close" aria-label="Close dialog">Close</button>';
  const content = (h && typeof h === 'object' && h instanceof SafeHTML) ? h.str : String(h ?? '');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" tabindex="-1">${showX}${content}</div>`;
  m.hidden = false;

  const sheet = m.querySelector('.sheet');
  if (sheet && typeof sheet.focus === 'function') {
    sheet.focus();
  }

  // Focus trapping and ESC key listener
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (modalKeydownHandler && typeof document.removeEventListener === 'function') {
      document.removeEventListener('keydown', modalKeydownHandler);
    }
    modalKeydownHandler = e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
        return;
      }
      if (e.key === 'Tab') {
        const focusables = m.querySelectorAll ? m.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') : [];
        if (!focusables || !focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', modalKeydownHandler);
  }

  // visualViewport resize listener for virtual keyboard adjustment
  if (typeof window !== 'undefined' && window.visualViewport && sheet && typeof window.visualViewport.addEventListener === 'function') {
    if (modalViewportHandler && typeof window.visualViewport.removeEventListener === 'function') {
      window.visualViewport.removeEventListener('resize', modalViewportHandler);
    }
    modalViewportHandler = () => {
      const vvHeight = window.visualViewport.height;
      if (vvHeight < window.innerHeight) {
        sheet.style.maxHeight = `${Math.max(200, vvHeight - 20)}px`;
      } else {
        sheet.style.maxHeight = '';
      }
    };
    window.visualViewport.addEventListener('resize', modalViewportHandler);
  }
};

const closeModal = () => {
  if (active3DViewer) {
    try { active3DViewer.destroy(); } catch (_) {}
    active3DViewer = null;
  }
  const m = $('#m');
  if (typeof document !== 'undefined' && modalKeydownHandler && typeof document.removeEventListener === 'function') {
    document.removeEventListener('keydown', modalKeydownHandler);
    modalKeydownHandler = null;
  }
  if (typeof window !== 'undefined' && window.visualViewport && modalViewportHandler && typeof window.visualViewport.removeEventListener === 'function') {
    window.visualViewport.removeEventListener('resize', modalViewportHandler);
    modalViewportHandler = null;
  }
  if (m) {
    m.hidden = true;
    m.innerHTML = '';
  }
  if (typeof document !== 'undefined' && document.body) {
    document.body.style.overflow = '';
  }
  if (prevActiveElement && typeof prevActiveElement.focus === 'function') {
    try { prevActiveElement.focus(); } catch (_) {}
    prevActiveElement = null;
  }
};
const close = closeModal;
if (typeof window !== 'undefined') {
  window.closeModal = closeModal;
  window.close = closeModal;
}
_global.closeModal = closeModal;
_global.close = closeModal;
const toast = (m, u) => {
  const t = $('#toast');
  U = u;
  t.innerHTML = `<span>${esc(m)}</span>` + (u ? '<button data-a="undo">Undo</button>' : '');
  t.className = 'show';
  clearTimeout(tt);
  tt = setTimeout(() => { t.className = ''; }, 4000);
};

const getStartOfWeek = (d = new Date()) => {
  const date = new Date(d);
  const day = date.getDay(); // 0 is Sun, 1 is Mon
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const isUnilateralExercise = name => {
  const n = String(name || '').toLowerCase();
  return n.includes('single arm') || n.includes('one arm') || n.includes('one-arm') ||
         n.includes('single leg') || n.includes('one leg') || n.includes('one-leg') ||
         n.includes('dumbbell row') || n.includes('split squat') || n.includes('bulgarian') ||
         n.includes('lunge') || n.includes('lateral raise') || n.includes('curl') ||
         n.includes('step-up') || n.includes('kickback') || n.includes('pistol') ||
         n.includes('concentration') || n.includes('cable lateral') || n.includes('single-arm') ||
         n.includes('single-leg') || n.includes('unilateral');
};

const getLastExerciseNote = id => {
  if (!id) return '';
  for (let k = S.logs.length - 1; k >= 0; k--) {
    const lx = S.logs[k].ex?.find(x => String(x.id) === String(id));
    if (lx && lx.note) return lx.note;
  }
  for (const r of S.routines) {
    const rx = r.ex?.find(x => String(x.id) === String(id));
    if (rx && rx.note) return rx.note;
  }
  return '';
};

const setVolume = (s, isUni = false, exId = null) => {
  if (Calc.calcSetVolume) {
    const exObj = exId ? X(exId) : null;
    return Calc.calcSetVolume(s, exObj || { uni: isUni }, S.cfg, S.cfg?.weight || 75);
  }
  if (exId && isCardioOrMobilityExercise(exId)) return 0;
  const w = Math.max(0, Number(s?.w) || 0);
  const r = Math.max(0, Number(s?.r) || 0);
  const uni = isUni || s?.uni;
  const hasBoth = s?.done || (s?.sideL && s?.sideR);
  const hasOne = s?.sideL || s?.sideR;
  const mult = uni ? (hasBoth ? 2 : (hasOne ? 1 : 2)) : 1;
  return w * r * mult;
};

const vol = l => {
  if (Calc.calcWorkoutVolume) {
    return Calc.calcWorkoutVolume(l, S.cfg, S.cfg?.weight || 75, X);
  }
  return Math.round((l?.ex || []).reduce((a, x) => {
    if (isCardioOrMobilityExercise(x.id)) return a;
    return a + (Array.isArray(x.sets) ? x.sets.reduce((b, s) => {
      const isUni = x.uni || s.uni;
      const hasBoth = s.done || (s.sideL && s.sideR);
      const hasOne = s.sideL || s.sideR;
      const mult = isUni ? (hasBoth ? 2 : (hasOne ? 1 : 2)) : 1;
      const w = Math.max(0, Number(s.w) || 0);
      const r = Math.max(0, Number(s.r) || 0);
      return b + w * r * mult;
    }, 0) : 0);
  }, 0));
};

const ACWR_UI_MAP = {
  calibrating: (calibDay) => ({
    status: `⚡ Calibrating Baseline (Day ${calibDay} of 14) 🔵`,
    color: 'var(--bl)',
    desc: 'Log workouts over 2-3 weeks to build your chronic fatigue baseline.',
    tooltip: 'Log workouts over 2-3 weeks to build your chronic fatigue baseline.'
  }),
  under: () => ({
    status: 'Recovery / Underreaching Zone 🔵',
    color: 'var(--bl)',
    desc: 'Low acute fatigue · Volume progression recommended',
    tooltip: 'Workload is lower than usual. Ideal for recovery or volume progression.'
  }),
  optimal: () => ({
    status: 'Optimal Progress Zone 🟢',
    color: 'var(--gn)',
    desc: 'Sweet spot for hypertrophy and safe progression',
    tooltip: 'Workload is in the sweet spot (0.8 - 1.3) for safe, progressive overload.'
  }),
  caution: () => ({
    status: 'Overreaching Caution Zone 🟡',
    color: 'var(--am)',
    desc: 'Fatigue accumulating faster than recovery',
    tooltip: 'Workload is high (1.3 - 1.5). Monitor fatigue and recovery closely.'
  }),
  danger: () => ({
    status: 'High Injury Risk / Deload Zone 🔴',
    color: 'var(--rd)',
    desc: 'Workload spike detected · Consider a deload session',
    tooltip: 'Workload spike (> 1.5). High fatigue accumulation, deload recommended.'
  })
};

// ---- 100% Offline Deterministic Recovery & ACWR Engine ----
const calcWorkload = (logs = S.logs) => {
  if (Calc.calcACWR) {
    const raw = Calc.calcACWR(logs, Date.now(), S.cfg, S.cfg?.weight || 75, X);
    const getUi = ACWR_UI_MAP[raw.zoneCode] || ACWR_UI_MAP.optimal;
    const ui = getUi(raw.calibDay || 1);
    return {
      ...raw,
      status: ui.status,
      color: ui.color,
      desc: ui.desc,
      tooltip: ui.tooltip
    };
  }
  const now = Date.now();
  const dayMs = 86400000;
  const acuteCutoff = now - 7 * dayMs;
  const chronicCutoff = now - 28 * dayMs;

  let acuteVolume = 0;
  let chronicVolumeTotal = 0;
  let acuteWorkouts = 0;
  let chronicWorkouts = 0;
  const distinctDaysSet = new Set();
  const validLogDates = [];

  for (const l of logs) {
    if (!l.date || !Array.isArray(l.ex)) continue;
    const lDate = typeof l.date === 'number' ? l.date : new Date(l.date).getTime();
    if (isNaN(lDate)) continue;

    validLogDates.push(lDate);

    let logVol = 0;
    for (const x of l.ex) {
      if (!Array.isArray(x.sets)) continue;
      // HARD EXCLUSION: Timed cardio and mobility exercises must NEVER contribute to strength tonnage or ACWR load calculations
      if (isCardioOrMobilityExercise(x.id)) continue;
      const isUni = !!x.uni;
      for (const s of x.sets) {
        logVol += setVolume(s, isUni || !!s.uni, x.id);
      }
    }

    if (lDate >= acuteCutoff && lDate <= now + 3600000) {
      acuteVolume += logVol;
      acuteWorkouts++;
    }
    if (lDate >= chronicCutoff && lDate <= now + 3600000) {
      chronicVolumeTotal += logVol;
      chronicWorkouts++;
      distinctDaysSet.add(dk(lDate));
    }
  }

  const distinctWorkoutDays = distinctDaysSet.size;
  const earliestDate = validLogDates.length ? Math.min(...validLogDates) : null;
  const totalHistoryDays = earliestDate ? Math.max(1, Math.floor((now - earliestDate) / dayMs) + 1) : 0;

  // BASELINE GATE: If distinct workout days < 7 OR total logged history < 14 days
  // Suppress misleading ACWR spikes (e.g. 4.00) and hard block deload alerts
  const isCalibrating = distinctWorkoutDays < 7 || totalHistoryDays < 14;
  const calibDay = Math.min(14, Math.max(validLogDates.length ? 1 : 0, totalHistoryDays));

  if (isCalibrating) {
    return {
      acuteVolume: Math.round(acuteVolume),
      chronicWeeklyAvg: Math.round(chronicVolumeTotal / 4),
      acwr: 'Calibrating',
      acwrNum: null,
      acwrDisplay: 'Calibrating',
      isCalibrating: true,
      distinctWorkoutDays,
      totalHistoryDays,
      status: `⚡ Calibrating Baseline (Day ${calibDay} of 14) 🔵`,
      zoneCode: 'calibrating',
      color: 'var(--bl)',
      desc: 'Log workouts over 2-3 weeks to build your chronic fatigue baseline.',
      tooltip: 'Log workouts over 2-3 weeks to build your chronic fatigue baseline.',
      acuteWorkouts,
      chronicWorkouts
    };
  }

  // Chronic Workload = Average weekly volume over the trailing 28 days (4 weeks)
  const chronicWeeklyAvg = Math.round(chronicVolumeTotal / 4);
  acuteVolume = Math.round(acuteVolume);

  let acwr = 0;
  if (chronicWeeklyAvg > 0) {
    acwr = Math.round((acuteVolume / chronicWeeklyAvg) * 100) / 100;
  } else if (acuteVolume > 0) {
    acwr = 1.0;
  }

  let status = 'Optimal Progress Zone 🟢';
  let zoneCode = 'optimal';
  let color = 'var(--gn)';
  let desc = 'Balanced for steady progressive overload';

  if (acwr < 0.8) {
    status = 'Recovery / Underreaching Zone 🔵';
    zoneCode = 'under';
    color = 'var(--bl)';
    desc = 'Low acute fatigue · Volume progression recommended';
  } else if (acwr <= 1.3) {
    status = 'Optimal Progress Zone 🟢';
    zoneCode = 'optimal';
    color = 'var(--gn)';
    desc = 'Optimal progress zone · High adaptation with low fatigue';
  } else if (acwr <= 1.5) {
    status = 'High Load Warning 🟡';
    zoneCode = 'warning';
    color = 'var(--am)';
    desc = 'High acute load · Monitor fatigue accumulation';
  } else {
    status = 'Overreaching / Deload Needed 🔴';
    zoneCode = 'danger';
    color = 'var(--rd)';
    desc = 'Elevated fatigue (>1.5× baseline) · Deload recommended';
  }

  return {
    acuteVolume,
    chronicWeeklyAvg,
    acwr,
    acwrNum: acwr,
    acwrDisplay: acwr.toFixed(2),
    isCalibrating: false,
    distinctWorkoutDays,
    totalHistoryDays,
    status,
    zoneCode,
    color,
    desc,
    tooltip: 'Acute:Chronic Workload Ratio (Optimal: 0.8 - 1.3)',
    acuteWorkouts,
    chronicWorkouts
  };
};

const checkDeloadStatus = (logs = S.logs) => {
  const workload = calcWorkload(logs);

  // HARD BLOCK the Deload recommendation card during baseline calibration period
  if (workload.isCalibrating) {
    return { recommended: false, reason: '', detail: '' };
  }

  const now = Date.now();
  const dayMs = 86400000;

  // Condition 1: ACWR > 1.5
  if (typeof workload.acwr === 'number' && workload.acwr > 1.5) {
    return {
      recommended: true,
      reason: 'ACWR Fatigue Spike (>1.5)',
      detail: `Acute workload (${workload.acuteVolume.toLocaleString()} kg) is ${workload.acwr}× your chronic baseline. Deload recommended to avert overtraining.`
    };
  }

  // Condition 2: 4+ consecutive weeks without a rest/deload week
  if (logs.length >= 8) {
    const w1 = logs.filter(l => l.date >= now - 7 * dayMs && l.date <= now);
    const w2 = logs.filter(l => l.date >= now - 14 * dayMs && l.date < now - 7 * dayMs);
    const w3 = logs.filter(l => l.date >= now - 21 * dayMs && l.date < now - 14 * dayMs);
    const w4 = logs.filter(l => l.date >= now - 28 * dayMs && l.date < now - 21 * dayMs);
    const all4WeeksActive = [w1, w2, w3, w4].every(w => w.length >= 2);
    const hasAnyDeload = [w1, w2, w3, w4].some(w => w.some(l => l.isDeload));
    if (all4WeeksActive && !hasAnyDeload) {
      return {
        recommended: true,
        reason: '4 Consecutive Hard Weeks',
        detail: 'You have trained 4 straight weeks without a recovery week. A planned deload now promotes muscle supercompensation.'
      };
    }
  }

  // Condition 3: Stagnant progressive overload with consecutive RIR 0 sets across 3 workouts
  if (logs.length >= 3) {
    const last3 = logs.slice(-3);
    const allHadFailure = last3.every(l =>
      l.ex && l.ex.some(x => x.sets && x.sets.some(s => s.rir === 0 || s.rpe >= 10))
    );
    const hasStalledRoutines = S.routines && S.routines.some(r => r.ex && r.ex.some(x => (x.stalls || 0) >= 2));
    const v0 = vol(last3[0]), v1 = vol(last3[1]), v2 = vol(last3[2]);
    const stagnantVolume = v2 <= v1 && v1 <= v0;
    if (allHadFailure && (hasStalledRoutines || stagnantVolume)) {
      return {
        recommended: true,
        reason: 'Stagnant Overload with Repeated Failure',
        detail: 'Consecutive sessions reached absolute failure (RIR 0) with plateaus. CNS fatigue is masking true strength.'
      };
    }
  }

  return { recommended: false, reason: '', detail: '' };
};

const getWeeklyMuscleVolumes = (logs = S.logs) => {
  const startOfWeek = getStartOfWeek();
  const groups = {
    Chest: 0,
    Back: 0,
    Legs: 0,
    Shoulders: 0,
    Arms: 0
  };

  for (const l of logs) {
    if (!l.date || !Array.isArray(l.ex)) continue;
    const lDate = typeof l.date === 'number' ? l.date : new Date(l.date).getTime();
    if (isNaN(lDate) || lDate < startOfWeek) continue;

    for (const x of l.ex) {
      if (!Array.isArray(x.sets)) continue;
      const count = x.sets.length;
      const exInfo = X(x.id);
      const g = exInfo.g;
      if (groups[g] !== undefined) {
        groups[g] += count;
      }
    }
  }

  // Thresholds: MEV: 8-10 sets, MAV: 12-18 sets, MRV: 20-22+ sets
  return Object.entries(groups).map(([name, sets]) => {
    let zone = 'Below MEV';
    let zoneClass = 'vol-low';
    let color = 'var(--bl)';
    if (sets >= 10 && sets <= 18) {
      zone = 'MAV (Optimal)';
      zoneClass = 'vol-opt';
      color = 'var(--gn)';
    } else if (sets > 18 && sets <= 20) {
      zone = 'Near MRV';
      zoneClass = 'vol-warn';
      color = 'var(--am)';
    } else if (sets > 20) {
      zone = '> MRV (Danger)';
      zoneClass = 'vol-danger';
      color = 'var(--rd)';
    } else if (sets >= 8) {
      zone = 'MEV (Maintenance)';
      zoneClass = 'vol-low';
      color = 'var(--bl)';
    }

    return { name, sets, zone, zoneClass, color };
  });
};

function showRirPicker(i, j) {
  const x = S.act?.ex[i];
  const s = x?.sets[j];
  if (!s) return;
  const currentRir = s.rir != null ? Number(s.rir) : (s.rpe != null && s.rpe !== '' ? Math.max(0, 10 - Number(s.rpe)) : null);
  const exInfo = X(x.id);

  modal(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h2 style="margin:0">Set ${j + 1} Intensity (RIR)</h2>
      <button class="btn s sm-btn" data-a="close">✕</button>
    </div>
    <p class="t2 sm" style="margin-bottom:12px"><b>${esc(exInfo.name)}</b> · Reps In Reserve indicates how many more reps you could have performed with strict form before failure (<b>RPE = 10 - RIR</b>).</p>
    
    <div class="rir-choices-grid">
      <button class="rir-choice-card ${currentRir >= 3 ? 'sel' : ''}" data-a="setrir" data-i="${i}" data-j="${j}" data-rir="3">
        <div class="rir-choice-top">
          <span class="rir-num-tag rir-3">3+ RIR</span>
          <span class="rir-rpe-tag">RPE ≤ 7</span>
        </div>
        <div class="rir-choice-title">Submaximal / Warmup</div>
        <div class="rir-choice-desc">3+ reps left. Low neuromuscular strain; speed & form focus.</div>
      </button>

      <button class="rir-choice-card ${currentRir === 2 ? 'sel' : ''}" data-a="setrir" data-i="${i}" data-j="${j}" data-rir="2">
        <div class="rir-choice-top">
          <span class="rir-num-tag rir-2">2 RIR</span>
          <span class="rir-rpe-tag">RPE 8</span>
        </div>
        <div class="rir-choice-title">Hypertrophy Sweet Spot</div>
        <div class="rir-choice-desc">2 reps left. Optimal mechanical tension with low systemic fatigue.</div>
      </button>

      <button class="rir-choice-card ${currentRir === 1 ? 'sel' : ''}" data-a="setrir" data-i="${i}" data-j="${j}" data-rir="1">
        <div class="rir-choice-top">
          <span class="rir-num-tag rir-1">1 RIR</span>
          <span class="rir-rpe-tag">RPE 9</span>
        </div>
        <div class="rir-choice-title">High Intensity Stimulus</div>
        <div class="rir-choice-desc">1 rep left. High motor unit recruitment; elevated fatigue cost.</div>
      </button>

      <button class="rir-choice-card fail ${currentRir === 0 ? 'sel' : ''}" data-a="setrir" data-i="${i}" data-j="${j}" data-rir="0">
        <div class="rir-choice-top">
          <span class="rir-num-tag rir-0">0 RIR 💥</span>
          <span class="rir-rpe-tag">RPE 10</span>
        </div>
        <div class="rir-choice-title">Absolute Muscular Failure</div>
        <div class="rir-choice-desc">Zero reps left. Maximum fatigue generated; flags exercise as high-fatigue.</div>
      </button>
    </div>

    ${currentRir != null ? `
      <div style="margin-top:14px;text-align:center">
        <button class="btn s sm-btn red" data-a="setrir" data-i="${i}" data-j="${j}" data-rir="clear">Clear Intensity</button>
      </div>
    ` : ''}
  `);
}

const newSets = (id, n = 3) => {
  const prevEx = getLastSessionExercise(id);
  const exInfo = X(id);
  const isTimed = exInfo.type === 'timed_cardio' || exInfo.t === 't';
  const defReps = isTimed ? 30 : 8;
  return Array.from({ length: Math.max(1, n) }, (_, j) => {
    const prevSet = prevEx?.sets?.[j] || prevEx?.sets?.at(-1);
    let prefillWeight = 0;
    if (prevSet && prevSet.w != null && prevSet.w !== '') {
      prefillWeight = Number(prevSet.w);
    }
    const prefillReps = (prevSet && prevSet.r != null && prevSet.r !== '') ? Number(prevSet.r) : defReps;
    return {
      w: prefillWeight,
      r: prefillReps,
      rpe: '',
      rir: null,
      done: false,
      sideL: false,
      sideR: false
    };
  });
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

// ---- Sub-Muscle Classification Definitions & Matcher ----
const SUB_MUSCLES = {
  Chest: ['All', 'Upper', 'Mid/Lower'],
  Back: ['All', 'Lats', 'Upper Back / Traps', 'Lower Back'],
  Shoulders: ['All', 'Front', 'Lateral', 'Rear'],
  Arms: ['All', 'Biceps (Long/Short)', 'Triceps', 'Forearms'],
  Legs: ['All', 'Quads', 'Hamstrings', 'Glutes', 'Calves']
};

let libSubCategory = 'All';
let pickSubCategory = 'All';

function matchesSubMuscle(e, cat, sub) {
  if (!sub || sub === 'All') return true;
  const n = (e.name || '').toLowerCase();
  const tg = (e.tg || '').toLowerCase();

  if (cat === 'Chest') {
    if (sub === 'Upper') return n.includes('incline') || n.includes('upper') || tg.includes('clavicular');
    if (sub === 'Mid/Lower') return !n.includes('incline') || n.includes('decline') || n.includes('flat') || n.includes('dip');
  } else if (cat === 'Back') {
    if (sub === 'Lats') return tg === 'lats' || n.includes('lat') || n.includes('pulldown') || n.includes('pull-up') || n.includes('chin');
    if (sub === 'Upper Back / Traps') return tg === 'upper back' || tg === 'traps' || n.includes('row') || n.includes('shrug') || n.includes('rear') || n.includes('face pull');
    if (sub === 'Lower Back') return tg === 'spine' || n.includes('hyperextension') || n.includes('back extension') || n.includes('good morning') || n.includes('deadlift');
  } else if (cat === 'Shoulders') {
    if (sub === 'Front') return n.includes('front') || n.includes('overhead') || n.includes('military') || n.includes('press') || n.includes('arnold');
    if (sub === 'Lateral') return n.includes('lateral') || n.includes('side') || n.includes('upright row');
    if (sub === 'Rear') return n.includes('rear') || n.includes('reverse') || n.includes('face pull');
  } else if (cat === 'Arms') {
    if (sub === 'Biceps (Long/Short)') return tg === 'biceps' || n.includes('curl') || n.includes('bicep') || n.includes('chin-up');
    if (sub === 'Triceps') return tg === 'triceps' || n.includes('tricep') || n.includes('pushdown') || n.includes('dip') || n.includes('skull') || n.includes('extension');
    if (sub === 'Forearms') return tg === 'forearms' || n.includes('wrist') || n.includes('grip') || n.includes('forearm') || n.includes('farmer');
  } else if (cat === 'Legs') {
    if (sub === 'Quads') return tg === 'quads' || n.includes('squat') || n.includes('leg press') || n.includes('lunge') || n.includes('quad') || (n.includes('extension') && !n.includes('back'));
    if (sub === 'Hamstrings') return tg === 'hamstrings' || n.includes('hamstring') || n.includes('leg curl') || n.includes('romanian') || n.includes('rdl') || n.includes('stiff');
    if (sub === 'Glutes') return tg === 'glutes' || n.includes('hip thrust') || n.includes('glute') || n.includes('kickback') || n.includes('abductor') || n.includes('bridge');
    if (sub === 'Calves') return tg === 'calves' || n.includes('calf') || n.includes('calves') || n.includes('raise');
  }
  return true;
}

function renderLibSubPills() {
  const subs = SUB_MUSCLES[libCategory];
  if (!subs || !subs.length) return '';
  return `<div class="sub-chips" id="lib-sub-chips">${subs.map(s => `<button class="sub-chip ${libSubCategory === s ? 'on' : ''}" data-a="libsubcat" data-sub="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
}

function renderPickSubPills() {
  const subs = SUB_MUSCLES[pickCategory];
  if (!subs || !subs.length) return '';
  return `<div class="sub-chips" id="pick-sub-chips">${subs.map(s => `<button class="sub-chip ${pickSubCategory === s ? 'on' : ''}" data-a="picksubcat" data-sub="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
}

// ---- Weekly 2x Muscle Frequency Tracker ----
const WEEKLY_FREQ_TARGETS = (Calc.FULL_MUSCLE_TARGETS) || [
  'Chest', 'Back', 'Quads', 'Hamstrings', 'Glutes', 'Deltoids', 'Biceps', 'Triceps', 'Calves', 'Forearms', 'Abs', 'Obliques'
];

function getStimulatedMuscleGroups(e) {
  if (Calc.getStimulatedMuscleGroups) return Calc.getStimulatedMuscleGroups(e);
  const groups = new Set();
  if (!e) return groups;
  const g = (e.g || '').toLowerCase();
  const tg = (e.tg || '').toLowerCase();
  const n = (e.name || '').toLowerCase();

  if (g === 'chest' || tg === 'pectorals' || n.includes('bench press') || n.includes('chest') || n.includes('fly')) groups.add('Chest');
  if (g === 'back' || ['lats', 'upper back', 'spine', 'traps'].includes(tg) || n.includes('pull') || n.includes('row') || n.includes('lat') || n.includes('deadlift')) groups.add('Back');
  if (tg === 'quads' || (g === 'legs' && (n.includes('squat') || n.includes('quad') || n.includes('leg press') || (n.includes('extension') && !n.includes('back')) || n.includes('lunge')))) groups.add('Quads');
  if (tg === 'hamstrings' || (g === 'legs' && (n.includes('leg curl') || n.includes('hamstring') || n.includes('rdl') || n.includes('romanian')))) groups.add('Hamstrings');
  if (tg === 'glutes' || (g === 'legs' && (n.includes('hip thrust') || n.includes('glute') || n.includes('kickback')))) groups.add('Glutes');
  if (g === 'shoulders' || tg === 'delts' || n.includes('shoulder') || n.includes('overhead press') || n.includes('lateral raise')) groups.add('Deltoids');
  if (tg === 'biceps' || n.includes('bicep') || (n.includes('curl') && !n.includes('leg') && !n.includes('hamstring'))) groups.add('Biceps');
  if (tg === 'triceps' || n.includes('tricep') || n.includes('pushdown') || n.includes('skull crusher')) groups.add('Triceps');
  if (tg === 'calves' || n.includes('calf') || n.includes('calves')) groups.add('Calves');
  if (tg === 'forearms' || n.includes('forearm') || n.includes('wrist curl')) groups.add('Forearms');
  if (g === 'core' || tg === 'abs' || n.includes('crunch') || n.includes('sit-up') || n.includes('plank')) groups.add('Abs');
  if (tg === 'obliques' || tg === 'serratus anterior' || n.includes('oblique') || n.includes('russian twist')) groups.add('Obliques');

  return groups;
}

function calcWeeklyMuscleFrequency(logs = S.logs, refDate = Date.now(), weekStartDay = S.cfg?.weekStartDay || 'mon', options = {}) {
  if (Calc.calcWeeklyMuscleFrequency) {
    return Calc.calcWeeklyMuscleFrequency(logs, refDate, weekStartDay, options, X);
  }
  const refTime = refDate instanceof Date ? refDate.getTime() : (typeof refDate === 'number' ? refDate : Date.now());
  const sevenDaysAgo = refTime - 7 * 86400 * 1000;
  const recentLogs = (logs || []).filter(l => l && l.date >= sevenDaysAgo && l.date <= refTime);
  const dayGroups = {};
  for (const target of WEEKLY_FREQ_TARGETS) {
    dayGroups[target] = new Set();
  }
  for (const log of recentLogs) {
    const dayKey = dk(log.date);
    for (const x of (log.ex || [])) {
      const e = X(x.id);
      const stimulated = getStimulatedMuscleGroups(e);
      for (const grp of stimulated) {
        if (dayGroups[grp]) dayGroups[grp].add(dayKey);
      }
    }
  }
  const res = WEEKLY_FREQ_TARGETS.map(target => {
    const count = dayGroups[target] ? dayGroups[target].size : 0;
    const opt = count >= 2;
    const partial = count === 1;
    const pips = opt ? `●● (${count}/2 Opt)` : (partial ? '●○ (1/2)' : '○○ (0/2)');
    return {
      muscle: target,
      count,
      days: count,
      target: 2,
      status: opt ? 'optimal' : (partial ? 'moderate' : 'none'),
      pips
    };
  });
  for (const item of res) {
    res[item.muscle] = item;
  }
  res['Shoulders'] = res['Deltoids'];
  res['Arms'] = res['Biceps'];
  res['Hamstrings/Glutes'] = res['Hamstrings'];
  res['Core'] = res['Abs'];
  return res;
}

function renderWeeklyMuscleFrequencyCard(logs = S.logs) {
  const freqs = (typeof Calc !== 'undefined' && Calc.calcWeeklyMuscleFrequency)
    ? Calc.calcWeeklyMuscleFrequency(logs, Date.now(), S.cfg?.weekStartDay || 'mon', {}, X)
    : calcWeeklyMuscleFrequency(logs);
  return `
    <div class="card weekly-freq-card">
      <div class="weekly-freq-header">
        <div class="wfh-title">Weekly Muscle Frequency & Volume</div>
        <div class="wfh-target">2x/wk & Hypertrophy Bands</div>
      </div>
      <div class="weekly-freq-grid">
        ${freqs.map(f => {
          const pipsText = f.count >= 2 ? '●●' : (f.count === 1 ? '●○' : '○○');
          const dotClass = f.count >= 2 ? 'dot-green' : (f.count === 1 ? 'dot-amber' : 'dot-muted');
          const badgeClass = f.status === 'optimal' ? 'tag-green' : (f.status === 'moderate' ? 'tag-amber' : 'tag-muted');
          const label = f.count >= 2 ? `${f.count}/2 Opt` : `${f.count}/2`;
          const volStatus = f.volumeStatus || (typeof Calc !== 'undefined' && Calc.calcMuscleVolumeStatus ? Calc.calcMuscleVolumeStatus(f.sets || 0) : { status: 'below_mev', label: 'Under MEV' });
          const volBadgeClass = volStatus.status === 'below_mev' ? 'vol-band-under' : (volStatus.status === 'mev' ? 'vol-band-mev' : (volStatus.status === 'mav' ? 'vol-band-mav' : 'vol-band-mrv'));
          return `
            <div class="weekly-freq-item">
              <span class="wfi-name">${f.muscle}</span>
              <div class="wfi-indicator" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
                <span class="wfi-pip ${dotClass}">${pipsText}</span>
                <span class="wfi-label ${badgeClass}">(${label})</span>
                <span class="vol-band-tag ${volBadgeClass}">${f.sets || 0}s (${volStatus.label})</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderTrainingInsightsCard() {
  const insights = (typeof Calc !== 'undefined' && Calc.calcTrainingInsights)
    ? Calc.calcTrainingInsights(S.logs, S.routines, { getEx: X, weekStart: S.cfg?.weekStartDay || 'mon' })
    : [];
  if (!insights.length) return '';

  return `
    <div class="card insights-card" style="margin-bottom:12px">
      <div class="insights-title" style="font-weight:700;font-size:13px;margin-bottom:8px;color:var(--tx)">💡 Smart Training Insights</div>
      <div class="insights-list" style="display:flex;flex-direction:column;gap:6px">
        ${insights.map(item => `
          <div class="insight-item insight-${item.level || 'info'}" style="display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border-radius:8px;background:var(--c2);border:1px solid var(--bdr)">
            <span class="insight-icon" style="font-size:16px">${item.level === 'warning' ? '⚠️' : (item.level === 'tip' ? '💡' : 'ℹ️')}</span>
            <div class="insight-content" style="flex:1">
              ${item.title ? `<div class="insight-item-title" style="font-weight:700;font-size:12px;color:var(--tx)">${esc(item.title)}</div>` : ''}
              <div class="insight-text" style="font-size:11px;color:var(--t2);line-height:1.4">${esc(item.message)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ---- Quick / Free Workout Builder ----
const FREE_WORKOUT_TARGETS = ['Chest', 'Back', 'Shoulders', 'Quads', 'Hamstrings', 'Biceps', 'Triceps', 'Abs'];
let freeWorkoutMuscles = ['Chest'];
let freeWorkoutSelectedEx = new Set();

function isExerciseMatchingMuscle(e, muscle) {
  const g = (e.g || '').toLowerCase();
  const tg = (e.tg || '').toLowerCase();
  const n = (e.name || '').toLowerCase();

  switch (muscle) {
    case 'Chest':
      return g === 'chest' || tg === 'pectorals' || n.includes('bench press') || n.includes('chest') || n.includes('fly');
    case 'Back':
      return g === 'back' || ['lats', 'upper back', 'spine', 'traps'].includes(tg) || n.includes('pull') || n.includes('row') || n.includes('lat') || n.includes('deadlift');
    case 'Shoulders':
      return g === 'shoulders' || tg === 'delts' || n.includes('shoulder') || n.includes('overhead press') || n.includes('lateral raise') || n.includes('military');
    case 'Quads':
      return tg === 'quads' || (g === 'legs' && (n.includes('squat') || n.includes('quad') || n.includes('leg press') || (n.includes('extension') && !n.includes('back')) || n.includes('lunge')));
    case 'Hamstrings':
      return tg === 'hamstrings' || tg === 'glutes' || (g === 'legs' && (n.includes('curl') || n.includes('deadlift') || n.includes('rdl') || n.includes('hip thrust') || n.includes('glute')));
    case 'Biceps':
      return tg === 'biceps' || (g === 'arms' && (n.includes('bicep') || n.includes('curl') || n.includes('chin-up')));
    case 'Triceps':
      return tg === 'triceps' || (g === 'arms' && (n.includes('tricep') || n.includes('pushdown') || n.includes('dip') || n.includes('skull') || n.includes('extension')));
    case 'Abs':
      return tg === 'abs' || g === 'core' || n.includes('crunch') || n.includes('sit-up') || n.includes('plank') || n.includes('ab');
    default:
      return false;
  }
}

function isCompoundMovement(e) {
  const n = (e.name || '').toLowerCase();
  const eq = (e.eq || '').toLowerCase();
  if (n.includes('bench press') || n.includes('squat') || n.includes('deadlift') || n.includes('overhead press') ||
      n.includes('military press') || n.includes('barbell row') || n.includes('dumbbell row') || n.includes('pull-up') ||
      n.includes('chin-up') || n.includes('dip') || n.includes('leg press') || n.includes('lunges') || n.includes('hip thrust')) {
    return true;
  }
  return eq.includes('barbell') && (n.includes('press') || n.includes('row') || n.includes('squat'));
}

function getFreeWorkoutExercises(selectedMuscles = freeWorkoutMuscles) {
  if (!selectedMuscles || !selectedMuscles.length) return [];
  const matches = EXDB.filter(e => {
    return selectedMuscles.some(m => isExerciseMatchingMuscle(e, m));
  });

  matches.sort((a, b) => {
    const aComp = isCompoundMovement(a) ? 1 : 0;
    const bComp = isCompoundMovement(b) ? 1 : 0;
    if (aComp !== bComp) return bComp - aComp;
    const eqRank = { barbell: 5, dumbbell: 4, cable: 3, 'leverage machine': 2, 'body weight': 1 };
    const aRank = eqRank[a.eq] || 0;
    const bRank = eqRank[b.eq] || 0;
    return bRank - aRank;
  });

  return matches;
}

function renderFreeWorkoutExerciseRows(exercises) {
  if (!exercises.length) {
    return '<p class="t2" style="padding:24px;text-align:center">No matching exercises found for selected muscle groups</p>';
  }
  return exercises.slice(0, 35).map(e => {
    const checked = freeWorkoutSelectedEx.has(e.id);
    const compound = isCompoundMovement(e);
    return `
      <div class="free-ex-row ${checked ? 'selected' : ''}" data-a="togglefreeex" data-id="${esc(e.id)}">
        <input type="checkbox" class="free-ex-chk" ${checked ? 'checked' : ''} tabindex="-1">
        <img class="ex-thumb" src="./media/${esc(e.img || e.gif)}" alt="${esc(e.name)}" loading="lazy" onerror="this.style.display='none'">
        <div class="ex-info">
          <div class="ex-name">${esc(e.name)}</div>
          <div class="ex-meta">
            <span class="free-ex-type-pill ${compound ? 'compound' : 'isolation'}">${compound ? 'Compound' : 'Isolation'}</span>
            ${esc(e.tg || e.g)} · ${esc(e.eq)}
          </div>
        </div>
        <button class="chip ex-preview-btn" data-a="pickpreview" data-id="${esc(e.id)}" title="Preview Exercise">ℹ️</button>
      </div>
    `;
  }).join('');
}

function showFreeWorkoutBuilderModal() {
  if (!freeWorkoutMuscles.length) freeWorkoutMuscles = ['Chest'];
  const matching = getFreeWorkoutExercises(freeWorkoutMuscles);
  if (freeWorkoutSelectedEx.size === 0 && matching.length) {
    matching.slice(0, 3).forEach(e => freeWorkoutSelectedEx.add(e.id));
  }

  modal(`
    <div class="free-builder-sheet">
      <div class="free-builder-header">
        <h2>⚡ Build Custom Session</h2>
        <p class="t2 sm" style="margin-top:2px;margin-bottom:10px">Target specific muscles for today's workout without saving a routine.</p>
      </div>

      <div class="free-targets-label">Target Muscles:</div>
      <div class="chips free-target-chips" style="margin-bottom:12px">
        ${FREE_WORKOUT_TARGETS.map(m => `
          <button class="chip free-chip ${freeWorkoutMuscles.includes(m) ? 'on' : ''}" data-a="togglefreemuscle" data-muscle="${m}">${m}</button>
        `).join('')}
      </div>

      <div class="row" style="margin-bottom:8px">
        <span class="t2 sm" id="free-matches-count"><b>${matching.length}</b> exercises found (${freeWorkoutSelectedEx.size} selected)</span>
        <button class="btn s sm-btn" data-a="clearfreesel" style="font-size:11px;padding:2px 8px">Clear</button>
      </div>

      <div id="free-ex-list" class="card" style="max-height:46vh;overflow-y:auto;padding:0 10px;margin-bottom:14px">
        ${renderFreeWorkoutExerciseRows(matching)}
      </div>

      <div class="free-builder-actions">
        <button class="btn free-start-btn" data-a="startfreesession">
          ⚡ Start Session (${freeWorkoutSelectedEx.size} Exercises)
        </button>
        <button class="btn s outline" data-a="closemodal">Cancel</button>
      </div>
    </div>
  `);
}

function startFreeWorkout(selectedIds) {
  const ids = Array.isArray(selectedIds) ? selectedIds : [...freeWorkoutSelectedEx];
  if (!ids.length) {
    toast('Select at least one exercise to start session');
    return;
  }
  const ex = ids.map(id => {
    const isUni = isUnilateralExercise(X(id).name);
    return {
      id,
      ss: false,
      uni: isUni,
      note: getLastExerciseNote(id),
      sets: newSets(id)
    };
  });

  const muscleNames = freeWorkoutMuscles.length ? freeWorkoutMuscles.join('/') : 'Custom';
  S.act = {
    id: uid(),
    name: `Free: ${muscleNames}`,
    t0: Date.now(),
    curEx: 0,
    ex
  };
  ls.set('act', S.act);
  save('act');
  close();
  view = 'work';
  wake();
  toast('⚡ Free workout session started!');
  render();
}

// ---- Views ----

const vTrain = () => {
  if ((!EXDB || EXDB.length === 0) && typeof loadExercises === 'function') {
    if (_global.__EXDB__ && _global.__EXDB__.length > 0) {
      EXDB = _global.__EXDB__;
      EXIDX = _global.__EXIDX__;
    } else {
      loadExercises().then(() => { if (view === 'train') render(); }).catch(() => {});
    }
  }
  const todayDay = new Date().getDay();
  const todayRid = S.sched ? (S.sched[todayDay] || '') : '';
  const todayRoutine = todayRid ? S.routines.find(r => r.id === todayRid) : null;
  const completedToday = S.logs.some(l => dk(l.date) === dk(Date.now()));

  const workload = calcWorkload(S.logs);
  const deloadInfo = checkDeloadStatus(S.logs);
  const muscleVolumes = getWeeklyMuscleVolumes(S.logs);

  const allActiveSets = S.act && Array.isArray(S.act.ex) ? S.act.ex.flatMap(x => x.sets || []) : [];
  const doneActiveSets = allActiveSets.filter(s => s && (s.done || s.sideL || s.sideR)).length;
  const resumeBannerHtml = S.act ? `
    <div class="active-session-resume-banner" data-a="tab" data-k="work">
      <div class="asrb-icon">⚡</div>
      <div class="asrb-text">
        <div class="asrb-title">⚡ Resume Active Workout</div>
        <div class="asrb-sub">${esc(S.act.name || 'Active Session')} · ${doneActiveSets}/${allActiveSets.length} sets logged</div>
      </div>
      <button class="btn asrb-btn" data-a="tab" data-k="work">Resume →</button>
    </div>
  ` : '';

  const freeWorkoutBannerHtml = `
    <div class="card free-workout-banner" style="margin-bottom:12px;padding:12px 14px">
      <div class="row">
        <div>
          <b style="font-size:14px">⚡ On-The-Fly Workout</b>
          <div class="t2 sm" style="margin-top:2px">Target specific muscles today without saving a template</div>
        </div>
        <button class="btn btn-free-workout sm-btn" data-a="openfreeworkout" style="min-height:36px;padding:0 14px">+ Start Free Workout</button>
      </div>
    </div>
  `;

  const pastWorkoutBannerHtml = `
    <div class="card past-workout-banner" style="margin-bottom:12px;padding:12px 14px">
      <div class="row" style="align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div>
          <b style="font-size:14px">📅 Log Past / Missed Workout</b>
          <div class="t2 sm" style="margin-top:2px">Forgot to log or worked out yesterday? Backdate a completed session.</div>
        </div>
        <button class="btn s sm-btn" data-a="openpastworkout" style="white-space:nowrap">+ Log Past / Missed Workout</button>
      </div>
    </div>
  `;

  const aiAssistantBannerHtml = `
    <div class="card ai-assistant-banner" style="margin-bottom:12px;padding:12px 14px;background:linear-gradient(135deg, rgba(0, 122, 255, 0.1), rgba(88, 86, 214, 0.12));border:1px solid rgba(0, 122, 255, 0.25)">
      <div class="row" style="align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:24px">🤖</span>
          <div>
            <b style="font-size:14px">MyGyM AI Assistant (BYOK)</b>
            <div class="t2 sm" style="margin-top:2px">Import routines via AI or get real-time form cues & warm-up sets</div>
          </div>
        </div>
        <div class="row g">
          <button class="btn s sm-btn" data-a="openaiimport" style="white-space:nowrap">🪄 Import Workout</button>
          <button class="btn sm-btn" data-a="openaicoach" style="white-space:nowrap">Ask Coach →</button>
        </div>
      </div>
    </div>
  `;

  return viewHeader('Train') +
    renderStreakBadge() +
    resumeBannerHtml +
    pastWorkoutBannerHtml +
    aiAssistantBannerHtml +

    // Active Deload Banner at top (subtle & actionable if deload is ongoing)
    (S.deload && S.deload.active ? `
      <div class="card deload-active-banner">
        <div class="row">
          <div>
            <div class="deload-badge">⚡ Deload Protocol Active</div>
            <div class="deload-title" style="font-size:15px">Target sets halved (-50%) · Target load -20%</div>
            <div class="t2 sm" style="margin-top:2px">Restoring CNS recovery while preserving adaptations.</div>
          </div>
          <button class="btn s sm-btn" data-a="enddeload" style="border:1px solid rgba(255,255,255,0.3)">End Deload</button>
        </div>
      </div>
    ` : '') +

    // Today's Split Banner Prominently at Top (One-Tap Start)
    (todayRoutine ? `
      <div class="card today-split-hero">
        <div class="row">
          <div>
            <div class="today-split-badge">⭐ Today's Split (${DAYS[todayDay]})</div>
            <div class="today-split-title">${esc(todayRoutine.name)}</div>
          </div>
          ${completedToday
            ? `<span class="today-chip" style="background:var(--gn);color:#000000;font-size:12px;padding:6px 14px;font-weight:700">✓ Done Today</span>`
            : (S.act
              ? `<button class="btn sched-start-btn" data-a="tab" data-k="work">⚡ Resume</button>`
              : `<button class="btn sched-start-btn" data-a="start" data-id="${esc(todayRoutine.id)}">⚡ Start Workout</button>`
            )
          }
        </div>
        <div class="routine-summary-list">
          ${todayRoutine.ex.map(renderRoutineSummaryRow).join('')}
        </div>
      </div>
    ` : (!todayRoutine && !S.act ? `
      <div class="card row" style="margin-bottom:12px;padding:12px 14px">
        <span class="t2 sm">🌿 <b>${DAYS[todayDay]}:</b> Scheduled Rest Day</span>
        <button class="btn s" data-a="tab" data-k="cal" style="min-height:32px;font-size:12px">Edit Split</button>
      </div>
    ` : '')) +

    // Smart Local Training Insights
    renderTrainingInsightsCard() +

    // Minimal Apple-style Weekly 2x Muscle Frequency Card
    renderWeeklyMuscleFrequencyCard(S.logs) +

    // Recovery & Muscle Fatigue Insights (brought higher up)
    `<details class="card recovery-accordion" ${deloadInfo.recommended ? 'open' : ''}>
      <summary class="recovery-accordion-summary">
        <div class="recovery-summary-left">
          <span class="recovery-icon">📊</span>
          <div>
            <div class="recovery-title">Recovery & Muscle Fatigue Insights</div>
            <div class="t2 sm">ACWR: ${workload.isCalibrating ? (workload.acwrDisplay || 'Calibrating') : workload.acwr.toFixed(2)} · ${esc(workload.status)}</div>
          </div>
        </div>
        <span class="recovery-chevron">⌄</span>
      </summary>

      <div class="recovery-accordion-content">
        ${deloadInfo.recommended && !S.deload?.active ? `
          <div class="card deload-recommend-card" style="margin:12px 0 10px">
            <div class="row">
              <div>
                <div class="deload-badge warn">⚡ Deload Recommended</div>
                <div class="deload-title" style="font-size:15px">${esc(deloadInfo.reason)}</div>
                <div class="t2 sm" style="margin-top:2px">${esc(deloadInfo.detail)}</div>
              </div>
            </div>
            <div class="row g" style="margin-top:10px">
              <button class="btn" data-a="startdeload">⚡ Start Deload Week (-50% Sets, -20% Wt)</button>
            </div>
          </div>
        ` : ''}

        <!-- ACWR Recovery Engine Card Inside Accordion -->
        <div class="card acwr-card" style="margin:10px 0 12px;border:1px solid rgba(255,255,255,0.08)">
          <div class="row" style="margin-bottom:8px">
            <div>
              <div class="acwr-badge-row">
                <span class="acwr-tag" title="${esc(workload.tooltip || workload.desc)}" style="background:${workload.color}22;color:${workload.color};border:1px solid ${workload.color}66">
                  ${esc(workload.status)}
                </span>
              </div>
              <div class="acwr-title" style="margin-top:6px">
                <b>ACWR: ${workload.isCalibrating ? (workload.acwrDisplay || 'Calibrating') : workload.acwr.toFixed(2)}</b>
                <span class="t2 sm" title="${esc(workload.tooltip || workload.desc)}"> · ${esc(workload.desc)}</span>
              </div>
            </div>
            ${!S.deload?.active && !deloadInfo.recommended ? `
              <button class="chip" data-a="startdeload" title="Manually initiate deload protocol" style="font-size:12px;padding:4px 8px;min-height:30px">⚡ Deload</button>
            ` : ''}
          </div>

          ${workload.isCalibrating ? `
            <div class="acwr-calib-hint" title="Log workouts over 2-3 weeks to build your chronic fatigue baseline.">
              ℹ️ <b>Baseline Calibration Active:</b> Log workouts over 2-3 weeks to build your chronic fatigue baseline. (${workload.distinctWorkoutDays}/7 workout days, ${workload.totalHistoryDays}/14 days)
            </div>
          ` : ''}

          <div class="acwr-metrics-grid">
            <div class="acwr-metric">
              <div class="t2 sm">Acute Load (7 Days)</div>
              <div class="acwr-metric-val">${workload.acuteVolume.toLocaleString()} <span class="sm">kg</span></div>
              <div class="t2 sm">${workload.acuteWorkouts} workouts</div>
            </div>
            <div class="acwr-metric">
              <div class="t2 sm">Chronic Baseline (4-Wk Avg)</div>
              <div class="acwr-metric-val">${workload.chronicWeeklyAvg.toLocaleString()} <span class="sm">kg/wk</span></div>
              <div class="t2 sm">${workload.chronicWorkouts} workouts in 28d</div>
            </div>
          </div>

          <div class="acwr-meter-track" style="opacity:${workload.isCalibrating ? '0.5' : '1'}" title="${esc(workload.tooltip || workload.desc)}">
            <div class="acwr-zone-band under" style="width:33.3%" title="Underreaching (<0.8)"></div>
            <div class="acwr-zone-band optimal" style="width:25%" title="Optimal Zone (0.8 - 1.3)"></div>
            <div class="acwr-zone-band warning" style="width:12.5%" title="High Load (1.3 - 1.5)"></div>
            <div class="acwr-zone-band danger" style="width:29.2%" title="Overreaching (>1.5)"></div>
            ${!workload.isCalibrating && typeof workload.acwr === 'number' ? `<div class="acwr-pointer" style="left:${Math.min(97, Math.max(3, (workload.acwr / 2.0) * 100))}%" title="ACWR: ${workload.acwr.toFixed(2)}"></div>` : ''}
          </div>
        </div>

        <!-- Weekly Muscle Volume Map Inside Accordion -->
        <div class="card vol-card" style="margin:0;border:1px solid rgba(255,255,255,0.08)">
          <div class="row" style="margin-bottom:8px">
            <div>
              <div class="vol-card-title">Weekly Muscle Volume</div>
              <div class="t2 sm">Direct working sets completed this week (Mon - Sun)</div>
            </div>
            <div class="vol-legend">
              <span class="vol-legend-dot blue"></span><span class="t2 sm" style="margin-right:8px">&lt;MEV</span>
              <span class="vol-legend-dot emerald"></span><span class="t2 sm" style="margin-right:8px">MAV</span>
              <span class="vol-legend-dot red"></span><span class="t2 sm">&gt;MRV</span>
            </div>
          </div>
          <div class="vol-bars-list">
            ${muscleVolumes.map(m => `
              <div class="vol-item">
                <div class="vol-item-header">
                  <span class="vol-item-name"><b>${esc(m.name)}</b></span>
                  <span class="vol-item-status" style="color:${m.color};font-weight:600">${m.sets} sets · ${m.zone}</span>
                </div>
                <div class="vol-track">
                  <div class="vol-marker mev" style="left:${(10/22)*100}%" title="MEV (10 sets)"></div>
                  <div class="vol-marker mrv" style="left:${(20/22)*100}%" title="MRV (20 sets)"></div>
                  <div class="vol-bar-fill ${m.zoneClass}" style="width:${Math.min(100, (m.sets / 22) * 100)}%;background:${m.color}"></div>
                </div>
              </div>
            `).join('')}
          </div>
          <div class="vol-benchmarks row t2 sm" style="margin-top:10px;font-size:11px">
            <span><b>MEV:</b> 8-10 sets</span>
            <span><b>MAV:</b> 12-18 sets (Optimal)</span>
            <span><b>MRV:</b> 20-22+ sets (Fatigue Limit)</span>
          </div>
        </div>
      </div>
    </details>` +

    // Free Workout Secondary Action Banner
    freeWorkoutBannerHtml +

    // All Routines (De-cluttered Accordion)
    (S.routines.length ? `
      <details class="card routines-accordion">
        <summary>
          <span>All Routines (${S.routines.length})</span>
          <span class="routines-chevron">⌄</span>
        </summary>
        <div style="margin-top:12px">
          ${S.routines.map(r => {
            const scheduledDays = Object.entries(S.sched || {})
              .filter(([_, rid]) => rid === r.id)
              .map(([day]) => DAYS_SHORT[+day]);
            return `
              <div class="routine-compact-card">
                <div class="row">
                  <div>
                    <b>${esc(r.name)}</b>
                    <div class="t2 sm">${r.ex.length} exercises${scheduledDays.length ? ` · ${scheduledDays.join(', ')}` : ''}</div>
                  </div>
                  <div class="row g">
                    <button class="btn sm-btn" data-a="start" data-id="${esc(r.id)}">Start</button>
                    <button class="btn s sm-btn" data-a="edit" data-id="${esc(r.id)}">Edit</button>
                  </div>
                </div>
                <div class="routine-summary-list" style="margin-top:6px">
                  ${r.ex.map(renderRoutineSummaryRow).join('')}
                </div>
              </div>
            `;
          }).join('')}
          <div class="row g" style="margin-top:10px">
            <button class="btn s sm-btn" data-a="edit" style="flex:1">${ic('plus', 16)} New Routine</button>
            <button class="btn s sm-btn" data-a="openaiimport" style="flex:1">🪄 Import via AI</button>
          </div>
        </div>
      </details>
    ` : `
      <div class="card empty-state-card">
        <div class="empty-state-icon">🏋️‍♂️</div>
        <div class="empty-state-title">No routines created yet</div>
        <p class="t2 sm">Build custom routines to track progressive overload automatically.</p>
        <div class="row g" style="margin-top:14px;flex-wrap:wrap">
          <button class="btn" data-a="edit">${ic('plus', 16)} Create Routine</button>
          <button class="btn s" data-a="openaiimport">🪄 Import via AI</button>
          <button class="btn s" data-a="openfreeworkout">+ Free Workout</button>
        </div>
      </div>
    `);
};

// 2. Active Guided Workout View
const startWorkTimer = () => {
  if (workTimerInterval) clearInterval(workTimerInterval);
  workTimerInterval = setInterval(() => {
    if (view !== 'work' || !S.act) {
      clearInterval(workTimerInterval);
      workTimerInterval = null;
      return;
    }
    // Decouple timer ticks from DOM while any modal or sheet is open
    const m = $('#m');
    if (m && !m.hidden && m.innerHTML.trim()) return;
    const timerEl = $('#work-live-timer');
    if (timerEl && S.act) {
      const allSets = S.act.ex.flatMap(x => x.sets);
      const doneSets = allSets.filter(s => s.done).length;
      const pct = allSets.length ? Math.round((doneSets / allSets.length) * 100) : 0;
      timerEl.textContent = `⏱️ ${fmtDur(Date.now() - S.act.t0)} · ${pct}% completed (${doneSets}/${allSets.length} sets)`;
    }
  }, 1000);
};

// ---- Superset Engine & State Helpers ----
function getSupersetInfo(act, exIdx) {
  if (!act || !Array.isArray(act.ex) || !act.ex[exIdx]) {
    return { isSuperset: false };
  }
  const curEx = act.ex[exIdx];
  if (!curEx.ss) {
    return { isSuperset: false };
  }

  // 1. Identify group by ssGroup or legacy ssPair
  let groupKey = curEx.ssGroup || curEx.ssPair;
  let groupIndices = [];

  if (groupKey) {
    act.ex.forEach((x, idx) => {
      if (x && x.ss && (x.ssGroup === groupKey || x.ssPair === groupKey)) {
        groupIndices.push(idx);
      }
    });
  }

  // 2. Fallback to contiguous block of .ss if groupKey not shared by at least 2
  if (groupIndices.length < 2) {
    let start = exIdx;
    while (start > 0 && act.ex[start - 1]?.ss) start--;
    let end = exIdx;
    while (end < act.ex.length - 1 && act.ex[end + 1]?.ss) end++;
    if (end > start) {
      groupIndices = [];
      for (let k = start; k <= end; k++) groupIndices.push(k);
      groupKey = act.ex[start].ssGroup || act.ex[start].ssPair || `ss_${start}`;
    }
  }

  if (groupIndices.length < 2) {
    return {
      isSuperset: true,
      isPaired: false,
      role: 'A',
      pos: 0,
      label: 'A1',
      exAIndex: exIdx,
      exBIndex: -1,
      exA: curEx,
      exB: null,
      exercises: [{ idx: exIdx, pos: 0, label: 'A1', ex: curEx, info: X(curEx.id) }],
      groupIndices: [exIdx],
      groupLength: 1,
      tag: 'SUPERSET [A1]',
      typeLabel: 'SUPERSET',
      round: 1,
      totalRounds: curEx.sets ? curEx.sets.length : 1
    };
  }

  groupIndices.sort((a, b) => a - b);
  const pos = groupIndices.indexOf(exIdx);
  const groupLength = groupIndices.length;
  const label = `A${pos + 1}`;
  const role = pos === 0 ? 'A' : (pos === 1 ? 'B' : String.fromCharCode(65 + pos));

  let typeLabel = 'SUPERSET';
  if (groupLength === 2) {
    typeLabel = 'SUPERSET';
  } else if (groupLength === 3) {
    typeLabel = 'TRI-SET';
  } else {
    typeLabel = 'GIANT SET';
  }

  const tagList = groupIndices.map((_, p) => `A${p + 1}`).join(' + ');
  const tag = `${typeLabel} [${tagList}]`;

  const groupExercises = groupIndices.map((idx, p) => ({
    idx,
    pos: p,
    label: `A${p + 1}`,
    ex: act.ex[idx],
    info: X(act.ex[idx].id)
  }));

  const totalRounds = Math.max(...groupExercises.map(item => item.ex?.sets?.length || 1), 1);

  let currentRound = 1;
  for (let k = 0; k < totalRounds; k++) {
    const allInRoundDone = groupExercises.every(item => {
      const set = item.ex?.sets?.[k];
      return !set || set.done;
    });
    if (!allInRoundDone) {
      currentRound = k + 1;
      break;
    }
    if (k === totalRounds - 1) {
      currentRound = totalRounds;
    }
  }

  const isFirstInGroup = pos === 0;
  const isLastInGroup = pos === groupLength - 1;
  const nextInGroup = !isLastInGroup ? groupExercises[pos + 1] : null;
  const prevInGroup = !isFirstInGroup ? groupExercises[pos - 1] : null;
  const firstInGroup = groupExercises[0];
  const lastInGroup = groupExercises[groupLength - 1];

  return {
    isSuperset: true,
    isPaired: true,
    pairId: groupKey,
    ssGroup: groupKey,
    pos,
    label,
    role,
    exAIndex: groupIndices[0],
    exBIndex: groupIndices[1] ?? -1,
    exA: groupExercises[0].ex,
    exB: groupExercises[1]?.ex ?? null,
    exercises: groupExercises,
    groupIndices,
    groupLength,
    isFirstInGroup,
    isLastInGroup,
    nextInGroup,
    prevInGroup,
    firstInGroup,
    lastInGroup,
    tag,
    typeLabel,
    round: currentRound,
    totalRounds
  };
}

function renderSupersetBanner(ssInfo) {
  if (!ssInfo || !ssInfo.isSuperset || !ssInfo.isPaired) return '';
  const curIdx = S.act ? (S.act.curEx || 0) : 0;
  const activeItem = ssInfo.exercises.find(item => item.idx === curIdx) || ssInfo.exercises[0];
  const activePos = activeItem.pos;
  const activeLabel = activeItem.label;

  const flowHint = !ssInfo.isLastInGroup && ssInfo.nextInGroup
    ? `Step ${activePos + 1}: Finish ${activeLabel} → Transitions to ${ssInfo.nextInGroup.label} instantly (No rest timer)`
    : `Step ${activePos + 1}: Finish ${activeLabel} → Rest timer starts → Loops back to A1`;

  return `
    <div class="card superset-block-card">
      <div class="superset-block-header">
        <div class="superset-badge-row">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="ss-block-tag">⚡ ${ssInfo.tag}</span>
            <button class="chip" data-a="opensspicker" data-i="${curIdx}" style="font-size:11px;padding:2px 8px;min-height:24px">⚙️ Manage</button>
          </div>
          <span class="ss-round-tag">Round ${ssInfo.round} of ${ssInfo.totalRounds}</span>
        </div>
        <div class="ss-position-indicator">
          Round ${ssInfo.round} of ${ssInfo.totalRounds} · Exercise ${activePos + 1} of ${ssInfo.groupLength} (${activeLabel})
        </div>
        <div class="t2 sm superset-flow-hint">
          ${flowHint}
        </div>
      </div>
      <div class="superset-pair-switcher">
        ${ssInfo.exercises.map((item, idx) => {
          const isCur = item.idx === curIdx;
          const doneSets = item.ex.sets.filter(s => s.done).length;
          return `
            ${idx > 0 ? '<span class="ss-pair-arrow">→</span>' : ''}
            <button class="ss-pair-tab ${isCur ? 'active' : ''}" data-a="setcurex" data-i="${item.idx}">
              <span class="ss-pill-role">${item.label}</span>
              <span class="ss-pill-name">${esc(item.info.name)}</span>
              <span class="ss-pill-ct">${doneSets}/${item.ex.sets.length}</span>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function showSupersetPicker(exIdx) {
  if (!S.act || !Array.isArray(S.act.ex) || !S.act.ex[exIdx]) return;
  const curEx = S.act.ex[exIdx];
  const curInfo = X(curEx.id);
  const ssInfo = getSupersetInfo(S.act, exIdx);
  const isAlreadyPaired = ssInfo.isSuperset && ssInfo.isPaired;

  // Filter candidate exercises from current session:
  // Exclude current exercise, all exercises already in this group, and exercises in any other paired superset
  const candidates = [];
  S.act.ex.forEach((x, idx) => {
    if (idx === exIdx) return;
    if (isAlreadyPaired && ssInfo.groupIndices.includes(idx)) return;
    const xInfo = getSupersetInfo(S.act, idx);
    if (xInfo.isSuperset && xInfo.isPaired) return;
    candidates.push({ ex: x, idx, info: X(x.id) });
  });

  const nextPosLabel = isAlreadyPaired ? `A${ssInfo.groupLength + 1}` : 'A2';
  const actionBtnText = isAlreadyPaired ? `+ Link ${nextPosLabel}` : '+ Link';
  const actionDataA = isAlreadyPaired ? 'addtosupergroup' : 'pairwithex';

  const sessionListHtml = candidates.length
    ? candidates.map(c => `
        <div class="ss-pick-item ss-picker-row">
          <div class="ss-item-left">
            <img class="ss-item-thumb ex-thumb" src="./media/${esc(c.info.img || c.info.gif)}" alt="${esc(c.info.name)}" onerror="this.style.display='none'">
            <div class="ss-item-meta ss-picker-details">
              <div class="ss-item-name ss-picker-name">${esc(c.info.name)}</div>
              <div class="ss-item-tags ss-picker-meta">
                <span class="ss-item-tag">${esc(c.info.tg || c.info.g)}</span>
                <span class="ss-item-dot">•</span>
                <span class="ss-item-tag">${esc(c.info.eq)}</span>
              </div>
            </div>
          </div>
          <button class="ss-link-pill-btn ss-link-action-btn" data-a="${actionDataA}" data-source="${exIdx}" data-target="${c.idx}">
            ${actionBtnText}
          </button>
        </div>
      `).join('')
    : `<div class="ss-picker-empty">All session exercises are currently paired.</div>`;

  const currentBlockHtml = isAlreadyPaired ? `
    <div class="ss-picker-section ss-unlink-section">
      <div class="ss-picker-section-title">Current Block: ${ssInfo.tag}</div>
      <div class="card ss-current-pair-card">
        <div class="ss-current-pair-info">
          <span class="ss-block-tag">⚡ ${ssInfo.tag}</span>
          <div class="ss-current-pair-names">
            ${ssInfo.exercises.map(item => `<b>[${item.label}] ${esc(item.info.name)}</b>`).join(' + ')}
          </div>
          <div class="t2 sm">Round ${ssInfo.round} of ${ssInfo.totalRounds} · ${ssInfo.groupLength} Exercises</div>
        </div>
        <button class="btn s sm-btn red ss-unlink-btn" data-a="unlinkss" data-i="${exIdx}">Unlink Block</button>
      </div>
    </div>
  ` : '';

  const modalTitle = isAlreadyPaired ? 'Build Superset Block' : 'Pair Superset';
  const sessionSectionTitle = isAlreadyPaired
    ? '+ Add Another Exercise to this Block (Tri-Set / Giant Set)'
    : '1. Choose from Current Session';

  const sessionSectionSub = isAlreadyPaired
    ? `<div style="font-size:12px;color:var(--t2);margin-bottom:8px">Select an exercise from current workout to append as <b>${nextPosLabel}</b>:</div>`
    : '';

  const librarySectionTitle = isAlreadyPaired
    ? 'Or Append from Library'
    : '2. Add & Pair from Library';

  const libraryDataA = isAlreadyPaired ? 'browseandaddtosupergroup' : 'browseandpair';

  modal(`
    <div class="ss-picker-sheet">
      <div class="ss-picker-header">
        <div class="ss-picker-header-text">
          <h2 class="ss-picker-title">${modalTitle}</h2>
          <div class="ss-picker-subtitle">
            <span>Pairing with</span>
            <span class="ss-source-badge">${esc(curInfo.name)}</span>
          </div>
        </div>
        <button class="ss-modal-close-btn" data-a="close" aria-label="Close" title="Close">✕</button>
      </div>

      ${currentBlockHtml}

      <div class="ss-picker-section">
        <div class="ss-picker-section-title">${sessionSectionTitle}</div>
        <div class="ss-picker-list-container ss-picker-list-card">
          ${sessionSectionSub}
          ${sessionListHtml}
        </div>
      </div>

      <div class="ss-picker-section">
        <div class="ss-picker-section-title">${librarySectionTitle}</div>
        <div class="ss-library-card ss-library-action-card">
          <div class="ss-library-hint">Need an exercise not in today's split?</div>
          <button class="ss-library-browse-btn ss-picker-browse-btn" data-a="${libraryDataA}" data-i="${exIdx}">
            + Browse Exercise Library
          </button>
        </div>
      </div>
    </div>
  `, { hideClose: true });
}

function addToSupergroup(sourceIdx, targetIdx) {
  if (!S.act || !Array.isArray(S.act.ex) || !S.act.ex[sourceIdx] || !S.act.ex[targetIdx] || sourceIdx === targetIdx) {
    return;
  }
  const sourceEx = S.act.ex[sourceIdx];
  const targetEx = S.act.ex[targetIdx];
  const ssInfo = getSupersetInfo(S.act, sourceIdx);

  // If target exercise is already in another superset, unlink it first
  const oldTargetSs = getSupersetInfo(S.act, targetIdx);
  if (oldTargetSs.isSuperset && oldTargetSs.isPaired) {
    unlinkSuperset(targetIdx);
  }

  if (ssInfo.isSuperset && ssInfo.isPaired) {
    // Extending an existing group (Tri-Set / Giant Set)
    const groupKey = ssInfo.ssGroup || ssInfo.pairId;
    const lastMemberEx = ssInfo.exercises[ssInfo.exercises.length - 1].ex;

    // Remove targetEx from current position
    const tIdx = S.act.ex.indexOf(targetEx);
    if (tIdx !== -1) {
      S.act.ex.splice(tIdx, 1);
    }

    // Find the new index of the last member after removal
    const newLastIdx = S.act.ex.indexOf(lastMemberEx);
    // Insert targetEx immediately after the last member so all group exercises remain strictly contiguous
    S.act.ex.splice(newLastIdx + 1, 0, targetEx);

    targetEx.ss = true;
    targetEx.ssGroup = groupKey;
    targetEx.ssPair = groupKey;

    // Update all members in group
    const newSsInfo = getSupersetInfo(S.act, sourceIdx);
    newSsInfo.exercises.forEach((item, p) => {
      item.ex.ss = true;
      item.ex.ssGroup = groupKey;
      item.ex.ssPair = groupKey;
      item.ex.ssRole = String.fromCharCode(65 + p);
    });

    save('act');
    close();
    render();
    toast(`⚡ Added [${esc(X(targetEx.id).name)}] to Block → ${newSsInfo.tag}`);
  } else {
    // Creating a new pair
    const pairId = 'ss_' + Date.now();

    // If sourceEx had an unpaired or orphan ss tag, clear it
    delete sourceEx.ssRole;

    // Extract targetEx
    const tIdx = S.act.ex.indexOf(targetEx);
    if (tIdx !== -1) {
      S.act.ex.splice(tIdx, 1);
    }

    const newSourceIdx = S.act.ex.indexOf(sourceEx);
    S.act.ex.splice(newSourceIdx + 1, 0, targetEx);

    sourceEx.ss = true;
    sourceEx.ssRole = 'A';
    sourceEx.ssGroup = pairId;
    sourceEx.ssPair = pairId;

    targetEx.ss = true;
    targetEx.ssRole = 'B';
    targetEx.ssGroup = pairId;
    targetEx.ssPair = pairId;

    S.act.curEx = newSourceIdx;
    save('act');
    close();
    render();
    toast(`⚡ Paired [${esc(X(sourceEx.id).name)}] + [${esc(X(targetEx.id).name)}] as Superset [A1 + A2]`);
  }
}

function pairExercises(sourceIdx, targetIdx) {
  return addToSupergroup(sourceIdx, targetIdx);
}

function browseAndAddToSupergroup(sourceIdx, libExId) {
  if (!S.act || !Array.isArray(S.act.ex) || !S.act.ex[sourceIdx]) return;
  const sourceEx = S.act.ex[sourceIdx];
  const isUni = isUnilateralExercise(X(libExId).name);
  const lastNote = getLastExerciseNote(libExId);
  const ssInfo = getSupersetInfo(S.act, sourceIdx);

  if (ssInfo.isSuperset && ssInfo.isPaired) {
    const groupKey = ssInfo.ssGroup || ssInfo.pairId;
    const lastMemberEx = ssInfo.exercises[ssInfo.exercises.length - 1].ex;
    const lastIdx = S.act.ex.indexOf(lastMemberEx);

    const newEx = {
      id: libExId,
      ss: true,
      ssRole: String.fromCharCode(65 + ssInfo.groupLength),
      ssGroup: groupKey,
      ssPair: groupKey,
      uni: isUni,
      note: lastNote,
      sets: newSets(libExId)
    };

    // Insert immediately after last member of group
    S.act.ex.splice(lastIdx + 1, 0, newEx);

    // Refresh all members
    const newSsInfo = getSupersetInfo(S.act, sourceIdx);
    newSsInfo.exercises.forEach((item, p) => {
      item.ex.ss = true;
      item.ex.ssGroup = groupKey;
      item.ex.ssPair = groupKey;
      item.ex.ssRole = String.fromCharCode(65 + p);
    });

    save('act');
    close();
    render();
    toast(`⚡ Added [${esc(X(libExId).name)}] to Block → ${newSsInfo.tag}`);
  } else {
    const pairId = 'ss_' + Date.now();
    const newEx = {
      id: libExId,
      ss: true,
      ssRole: 'B',
      ssGroup: pairId,
      ssPair: pairId,
      uni: isUni,
      note: lastNote,
      sets: newSets(libExId)
    };

    sourceEx.ss = true;
    sourceEx.ssRole = 'A';
    sourceEx.ssGroup = pairId;
    sourceEx.ssPair = pairId;

    S.act.ex.splice(sourceIdx + 1, 0, newEx);
    S.act.curEx = sourceIdx;
    save('act');
    close();
    render();
    toast(`⚡ Paired [${esc(X(sourceEx.id).name)}] + [${esc(X(newEx.id).name)}] as Superset [A1 + A2]`);
  }
}

function addAndPairFromLibrary(sourceIdx, libExId) {
  return browseAndAddToSupergroup(sourceIdx, libExId);
}

function unlinkSuperset(exIdx) {
  if (!S.act) return;
  const curI = exIdx !== undefined && !isNaN(exIdx) ? exIdx : S.act.curEx;
  const ssInfo = getSupersetInfo(S.act, curI);
  if (ssInfo.isSuperset) {
    if (Array.isArray(ssInfo.exercises)) {
      ssInfo.exercises.forEach(item => {
        if (item.ex) {
          delete item.ex.ss;
          delete item.ex.ssPair;
          delete item.ex.ssGroup;
          delete item.ex.ssRole;
        }
      });
    }
    if (ssInfo.exA) {
      delete ssInfo.exA.ss;
      delete ssInfo.exA.ssPair;
      delete ssInfo.exA.ssGroup;
      delete ssInfo.exA.ssRole;
    }
    if (ssInfo.exB) {
      delete ssInfo.exB.ss;
      delete ssInfo.exB.ssPair;
      delete ssInfo.exB.ssGroup;
      delete ssInfo.exB.ssRole;
    }
    save('act');
    close();
    render();
    toast(`Unlinked ${ssInfo.typeLabel || 'superset'} block`);
  }
}

function renderWorkHeroCard(a, curIdx) {
  const currentEx = a.ex[curIdx];
  const exInfo = X(currentEx.id);
  const isBarbell = (exInfo.eq || '').toLowerCase().includes('barbell');
  const isDumbbell = (exInfo.eq || '').toLowerCase().includes('dumbbell') || (exInfo.name || '').toLowerCase().includes('dumbbell');
  const ssInfo = getSupersetInfo(a, curIdx);

  const prevEx = getLastSessionExercise(currentEx.id);
  const r = a.rid ? S.routines.find(r => r.id === a.rid) : null;
  const rx = r?.ex?.find(q => String(q.id) === String(currentEx.id));
  const repCeiling = rx?.reps2 || rx?.reps || 12;
  const prevDoneSets = (prevEx?.sets || []).filter(s => s && (s.done || s.sideL || s.sideR || Number(s.r) > 0));
  const isDoubleProgReady = prevDoneSets.length >= 1 && prevDoneSets.every(s => (Number(s.r) || 0) >= repCeiling);

  return `
    <div class="card work-hero-card" id="work-hero-card">
      <!-- Header Info & Tags directly at top -->
      <div class="work-hero-info">
        <div class="row" style="margin-bottom:4px">
          <div class="work-hero-title clickable-title" data-a="showexhistory" data-id="${esc(exInfo.id)}" style="cursor:pointer" title="View exercise history & analytics">${esc(exInfo.name)} <span class="history-icon" style="font-size:13px;opacity:0.8">📈</span></div>
          <button class="chip gif-toggle-chip" data-a="togglegif" data-i="${curIdx}" style="font-size:11px;padding:2px 8px">${workGifCollapsed ? '👁️ Show Demo GIF' : 'Hide GIF'}</button>
        </div>
        <div class="work-hero-tags">
          <span class="ex-badge ac">${esc(exInfo.g)}</span>
          ${exInfo.tg ? `<span class="ex-badge">${esc(exInfo.tg)}</span>` : ''}
          <span class="ex-badge">${esc(exInfo.eq)}</span>
          ${isDumbbell ? `<span class="ex-badge dumbbell-badge">⚖️ (Weight per dumbbell)</span>` : ''}
          ${exInfo.type === 'timed_cardio' || exInfo.t === 't' ? '<span class="ex-badge">Timed Cardio</span>' : ''}
          ${exInfo.type === 'bodyweight' || exInfo.t === 'b' ? '<span class="ex-badge">Bodyweight</span>' : ''}
          ${currentEx.uni ? '<span class="ex-badge" style="background:rgba(100,210,255,0.2);color:var(--bl);border:1px solid var(--bl)">⚖️ Each Side (L/R)</span>' : ''}
          ${ssInfo.isSuperset && ssInfo.isPaired ? `<span class="ex-badge ss-badge" style="background:rgba(255,159,10,0.2);color:var(--am);border:1px solid var(--am)">⚡ ${ssInfo.typeLabel} [${ssInfo.label}] · Round ${ssInfo.round}/${ssInfo.totalRounds}</span>` : ''}
          ${isDoubleProgReady ? `<button class="chip chip-suggestion" data-a="applysuggestion" data-i="${curIdx}" data-inc="2.5" title="Double Progression rep ceiling met! Tap to bump +2.5kg">⚡ +2.5kg suggested</button>` : ''}
          ${currentEx.sets.some(s => s.rir === 0 || s.rpe >= 10) ? '<span class="ex-badge fail-badge">💥 High Fatigue (RIR 0)</span>' : ''}
          <button class="chip" data-a="setexrest" data-id="${esc(exInfo.id)}" title="Set custom rest timer for this exercise">⏱️ ${getExRest(exInfo.id)}s rest</button>
        </div>
      </div>

      <!-- PRIMARY VIEWPORT ELEMENT: Sets & Reps Logger Table above the fold -->
      <div class="work-sets-container">
        <div class="set-header-row" style="display:flex;justify-content:space-between;padding:0 8px 4px;font-size:11px;font-weight:600;color:var(--t2)">
          <span style="width:36px;text-align:center">Set</span>
          <span style="flex:1;padding-left:6px">${exInfo.type === 'timed_cardio' || exInfo.t === 't' ? 'Duration (sec)' : 'Load &amp; Reps'}</span>
          <span style="width:44px;text-align:center">${currentEx.uni ? 'L / R' : 'Done'}</span>
        </div>
        ${currentEx.sets.map((s, j) => {
          const prevS = prevEx?.sets?.[j];
          let prevText = '—';
          if (prevS && (prevS.w != null || prevS.r != null)) {
            if (exInfo.type === 'timed_cardio' || exInfo.t === 't') {
              prevText = `${prevS.r || 0}s`;
            } else if (exInfo.type === 'bodyweight' || exInfo.t === 'b') {
              prevText = `${prevS.w > 0 ? '+' + prevS.w + 'kg' : '0kg'} × ${prevS.r || 0}`;
            } else {
              prevText = `${prevS.w || 0}kg × ${prevS.r || 0}`;
            }
          }

          const isFail = s.rir === 0 || s.rpe >= 10;
          const isSet = s.rir != null || (s.rpe != null && s.rpe !== '');
          const rirText = s.rir != null ? (s.rir === 0 ? '0 💥' : (s.rir >= 3 ? '3+' : s.rir)) : (s.rpe != null && s.rpe !== '' ? (10 - +s.rpe) : 'RIR');
          const isSetDone = s.done || (currentEx.uni && s.sideL && s.sideR);
          const pr = isSetDone ? checkSetPR(currentEx.id, s, currentEx.uni) : null;

          return `<div class="set set-row${s.done ? ' d' : ''}" data-i="${curIdx}" data-j="${j}">
            <!-- Line 1: Set Type + Num, Previous Microlabel, Done Action -->
            <div class="set-line-header">
              <div class="set-col set-col-num">
                <button class="n set-num-badge set-type-btn set-type-${s.type ? s.type.toLowerCase() : 'normal'}" data-a="togglesettype" data-i="${curIdx}" data-j="${j}" title="Tap to toggle set type (Normal, Warm-up, Drop set, Failure, AMRAP)">
                  ${s.type || (j + 1)}${pr ? `<span class="set-pr-badge" title="${esc(pr.desc)}">🏆</span>` : ''}
                </button>
              </div>
              <div class="set-prev-microlabel set-prev-cell" title="Prev session set ${j + 1}: ${prevText}">Prev: ${esc(prevText)}</div>
              <div class="set-col set-col-done">
                ${currentEx.uni ? `
                  <div class="uni-ck-group">
                    <button class="uni-ck ${s.sideL ? 'd' : ''}" data-a="donel" data-i="${curIdx}" data-j="${j}" title="Left Side Complete">L ${s.sideL ? '✓' : ''}</button>
                    <button class="uni-ck ${s.sideR ? 'd' : ''}" data-a="doner" data-i="${curIdx}" data-j="${j}" title="Right Side Complete">R ${s.sideR ? '✓' : ''}</button>
                  </div>
                ` : `
                  <button class="ck set-done-btn ${s.done ? 'd' : ''}" data-a="done" data-i="${curIdx}" data-j="${j}" title="Mark Set Done" aria-label="Mark Set Done">${ic('chk', 20)}</button>
                `}
              </div>
            </div>

            <!-- Line 2: Weight Stepper Box x Reps Box -->
            <div class="set-col set-col-main set-line-inputs">
              <div class="set-inputs-row">
                ${exInfo.type === 'timed_cardio' || exInfo.t === 't' ? `
                  <div class="set-input-box">
                    <input type="number" inputmode="numeric" data-f="r" data-i="${curIdx}" data-j="${j}" value="${s.r}" class="set-val-input" placeholder="0">
                    <span class="set-unit">sec</span>
                  </div>
                ` : `
                  <div class="set-input-box set-w-box ${isBarbell ? 'has-plate-btn' : ''}">
                    <button class="step-btn btn-step step-minus" data-a="stepw" data-i="${curIdx}" data-j="${j}" data-delta="-2.5" title="-2.5 kg">-2.5</button>
                    <input type="number" inputmode="decimal" data-f="w" data-i="${curIdx}" data-j="${j}" value="${s.w}" class="set-val-input" placeholder="0">
                    <span class="set-unit">${(exInfo.type === 'bodyweight' || exInfo.t === 'b') ? '+kg' : 'kg'}</span>
                    <button class="step-btn btn-step step-plus" data-a="stepw" data-i="${curIdx}" data-j="${j}" data-delta="2.5" title="+2.5 kg">+2.5</button>
                    ${isBarbell ? `<button class="plate-calc-btn" data-a="openplatecalc" data-w="${s.w || 20}" data-name="${esc(exInfo.name)}" title="Plate Calculator">${ic('disc', 14)}</button>` : ''}
                  </div>
                  <span class="set-times-sep">×</span>
                  <div class="set-input-box set-r-box">
                    <input type="number" inputmode="numeric" data-f="r" data-i="${curIdx}" data-j="${j}" value="${s.r}" class="set-val-input" placeholder="0">
                    <span class="set-unit">reps</span>
                  </div>
                `}
                <button class="rir-pill ${isFail ? 'rir-fail' : (isSet ? 'rir-set' : '')}" data-a="openrir" data-i="${curIdx}" data-j="${j}" title="Reps In Reserve">${rirText}</button>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="row g" style="margin-top:10px;flex-wrap:wrap">
        <button class="btn s" data-a="addset" data-i="${curIdx}">${ic('plus', 16)} Add set</button>
        <button class="btn s sm-btn outline" data-a="genwarmups" data-i="${curIdx}" title="Generate 3 progressive warm-up sets">⚡ Warm-Up Sets</button>
        <button class="btn s" data-a="delset" data-i="${curIdx}" ${currentEx.sets.length <= 1 ? 'disabled style="opacity:0.3"' : ''}>Delete set</button>
      </div>
      <textarea class="note" placeholder="Exercise cues/notes (seat height, grip width, tempo)..." data-f="note" data-i="${curIdx}" rows="2">${esc(currentEx.note || '')}</textarea>
      <details class="session-notes-collapsible" ${a.note ? 'open' : ''} style="margin-top:8px">
        <summary style="font-size:12px;color:var(--t2);cursor:pointer;padding:4px 0">📝 Session Notes ${a.note ? '(active)' : ''}</summary>
        <textarea class="note" placeholder="Overall workout notes for today's session..." data-f="session-note" rows="2" style="margin-top:4px">${esc(a.note || '')}</textarea>
      </details>

      <!-- Compact / Collapsible Exercise Demonstration GIF -->
      <div class="work-hero-media" data-a="zoomexgif" data-id="${esc(exInfo.id)}" ${workGifCollapsed ? 'style="display:none"' : ''} title="Tap to expand fullscreen demonstration">
        <img class="work-hero-gif" src="./media/${esc(exInfo.gif || exInfo.img)}" alt="${esc(exInfo.name)}" loading="eager" onerror="this.onerror=null;this.src='./media/${esc(exInfo.img || exInfo.gif)}';">
        <div class="work-gif-tap-hint">🔍 Tap to expand</div>
      </div>

      <!-- Neat Decluttered Horizontal Toolbar directly below the media frame -->
      <div class="work-hero-toolbar">
        <button class="chip" data-a="showexhistory" data-id="${esc(exInfo.id)}">📈 History</button>
        <button class="chip" data-a="openaicoach" data-p="Give me 3 critical form cues and execution tips for ${esc(exInfo.name)}">🤖 AI Coach</button>
        <button class="chip" data-a="swapex" data-i="${curIdx}">⇄ Swap</button>
        <button class="chip" data-a="zoomexgif" data-id="${esc(exInfo.id)}">ℹ️ Form Cues</button>
        ${ssInfo.isSuperset && ssInfo.isPaired
          ? `<button class="chip on ss-chip" data-a="opensspicker" data-i="${curIdx}">⚡ ${ssInfo.typeLabel} [${ssInfo.label}]</button>`
          : `<button class="chip ss-chip" data-a="opensspicker" data-i="${curIdx}">🔗 Link Superset</button>`
        }
        <button class="chip ${currentEx.uni ? 'on' : ''}" data-a="toggleuni" data-i="${curIdx}">${currentEx.uni ? '⚖️ Each Side' : '⇄ Unilateral'}</button>
        <button class="chip chip-success" data-a="commit-finish" title="Directly finish and save today's session">🏆 Quick Finish</button>
        <button class="chip chip-danger" data-a="removecursessionex" data-i="${curIdx}" title="Remove from today's workout without changing routine">✕ Remove from Today's Session</button>
      </div>
    </div>
  `;
}

function renderWorkNavStepper(a, curIdx) {
  return `
    <div class="work-nav-stepper">
      <button class="btn s work-nav-btn" data-a="workprev" ${curIdx === 0 ? 'disabled style="opacity:0.3"' : ''}>
        ‹ Prev Exercise
      </button>
      <button class="btn s work-nav-btn" data-a="worklist">
        ☰ Overview (${curIdx + 1}/${a.ex.length})
      </button>
      ${curIdx === a.ex.length - 1
        ? `<button class="btn work-nav-btn fin-step" data-a="promptfin">Finish Workout 🎉</button>`
        : `<button class="btn work-nav-btn" data-a="worknext">Next Exercise ›</button>`
      }
    </div>
  `;
}

function updateWorkProgressHeader(a) {
  if (!a || !a.ex) return;
  const allSets = a.ex.flatMap(x => x.sets);
  const doneSets = allSets.filter(s => s.done).length;
  const totalSets = allSets.length;
  const pct = totalSets ? Math.round((doneSets / totalSets) * 100) : 0;

  const timerEl = document.getElementById('work-live-timer');
  if (timerEl) {
    timerEl.textContent = `⏱️ ${fmtDur(Date.now() - a.t0)} · ${pct}% completed (${doneSets}/${totalSets} sets)`;
  }
  const fillEl = document.querySelector('.work-progress-fill');
  if (fillEl) {
    fillEl.style.width = `${pct}%`;
  }
}

function focusSetInput(exIdx, setIdx) {
  setTimeout(() => {
    const input = document.querySelector(`input[data-i="${exIdx}"][data-j="${setIdx}"][data-f="r"]`) ||
                  document.querySelector(`input[data-i="${exIdx}"][data-j="${setIdx}"][data-f="w"]`);
    if (input) {
      input.focus();
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
}

function showExpandedGifModal(targetId) {
  const ex = X(targetId);
  if (!ex) return;
  const mediaSrc = `./media/${esc(ex.gif || ex.img)}`;
  const b = bestSet(ex.id);
  let bestHtml = '';
  if (b) {
    if (ex.t === 't') {
      bestHtml = `<div class="card zoom-best-card">🏆 Personal Best: <b>${Number(b.r) || 0} sec</b></div>`;
    } else if (ex.t === 'b') {
      bestHtml = `<div class="card zoom-best-card">🏆 Personal Best: <b>${b.w > 0 ? '+' + (Number(b.w) || 0) + ' kg × ' : ''}${Number(b.r) || 0} reps</b></div>`;
    } else {
      bestHtml = `<div class="card zoom-best-card">🏆 Personal Best: <b>${Number(b.w) || 0} kg × ${Number(b.r) || 0}</b> · 1RM: <b>${rd(e1(b.w, b.r))} kg</b></div>`;
    }
  }

  modal(`
    <div class="zoom-modal-sheet">
      <div class="zoom-modal-header">
        <div>
          <h2 class="zoom-title">${esc(ex.name)}</h2>
          <div class="t2 sm">${esc(ex.g)} · ${esc(ex.eq)}</div>
        </div>
        <button class="btn s sm-btn zoom-close-btn" data-a="close">✕ Close</button>
      </div>

      <div class="zoom-media-frame">
        <img class="zoom-expanded-gif" src="${mediaSrc}" alt="${esc(ex.name)}" onerror="this.onerror=null;this.src='./media/${esc(ex.img || ex.gif)}';">
      </div>

      <div class="zoom-tags-row">
        <span class="ex-badge ac">${esc(ex.g)}</span>
        ${ex.tg ? `<span class="ex-badge" style="background:rgba(48,209,88,0.2);color:var(--gn);border:1px solid rgba(48,209,88,0.4)">Target: ${esc(ex.tg)}</span>` : ''}
        <span class="ex-badge">${esc(ex.eq)}</span>
        ${ex.sec && ex.sec.length ? `<span class="ex-badge">Secondary: ${esc(ex.sec.join(', '))}</span>` : ''}
      </div>

      ${bestHtml}

      <div class="zoom-cues-card">
        <div class="zoom-cues-title">📋 Form Execution Cues</div>
        ${ex.st && ex.st.length
          ? `<ol class="zoom-cues-list">${ex.st.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`
          : `<p class="t2 sm" style="margin:0">Maintain strict form, neutral spine, controlled concentric phase, and deliberate eccentric contraction.</p>`
        }
      </div>
    </div>
  `);
}

function showExerciseHistoryModal(targetId) {
  const ex = X(targetId);
  if (!ex) return;
  const logs = S.logs || [];
  const targetIdStr = String(targetId);

  // Collect sessions with this exercise
  const sessions = [];
  for (const l of logs) {
    if (!l || !Array.isArray(l.ex)) continue;
    const x = l.ex.find(item => String(item.id) === targetIdStr);
    if (!x || !Array.isArray(x.sets)) continue;

    const completedSets = x.sets.filter(s => s && (s.done || Number(s.r) > 0));
    if (!completedSets.length) continue;

    let maxW = 0;
    let best1RM = 0;
    let vol = 0;
    for (const s of completedSets) {
      const isW = s.type === 'W' || s.type === 'warmup' || s.isWarmup;
      const w = Number(s.w) || 0;
      const r = Number(s.r) || 0;
      if (!isW) {
        if (w > maxW) maxW = w;
        const e1 = typeof Calc !== 'undefined' && Calc.estimate1RM ? Calc.estimate1RM(w, r) : (r <= 10 ? (w * 36) / (37 - r) : w * (1 + r / 30));
        if (e1 > best1RM) best1RM = Math.round(e1 * 10) / 10;
        vol += w * r * (x.uni ? 2 : 1);
      }
    }

    sessions.push({
      date: l.date || l.t0 || Date.now(),
      workoutName: l.name || 'Workout',
      sets: completedSets,
      maxW,
      best1RM,
      vol: Math.round(vol * 10) / 10,
      note: x.note || ''
    });
  }

  // Sort by date descending for list
  sessions.sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0));

  // Global PRs across history
  let allTime1RM = 0;
  let allTimeMaxW = 0;
  let allTimeMaxVol = 0;

  sessions.forEach(s => {
    if (s.best1RM > allTime1RM) allTime1RM = s.best1RM;
    if (s.maxW > allTimeMaxW) allTimeMaxW = s.maxW;
    if (s.vol > allTimeMaxVol) allTimeMaxVol = s.vol;
  });

  // Last 5 sessions
  const recentSessions = sessions.slice(0, 5);

  // Lightweight SVG Sparklines (chronological order of last 7 sessions)
  const sparklineData = sessions.slice(0, 7).reverse().map(s => s.best1RM || s.maxW || 0);
  const volumeData = sessions.slice(0, 7).reverse().map(s => s.vol || 0);
  let sparklineSvg = '';
  if (sparklineData.length >= 2) {
    const min = Math.min(...sparklineData);
    const max = Math.max(...sparklineData);
    const range = (max - min) || 1;
    const w = 280, h = 60, pad = 12;
    const pts = sparklineData.map((val, idx) => {
      const px = pad + (idx / (sparklineData.length - 1)) * (w - 2 * pad);
      const py = h - pad - ((val - min) / range) * (h - 2 * pad);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    });

    const polylinePts = pts.join(' ');
    const lastPt = pts[pts.length - 1].split(',');

    sparklineSvg = `
      <div class="ex-history-sparkline-wrap" style="background:var(--c2);border-radius:12px;padding:12px;margin-bottom:10px;border:1px solid var(--bdr)">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t2);margin-bottom:6px">
          <span>Strength Trend (Estimated 1RM)</span>
          <span style="font-weight:600;color:var(--ac)">Latest: ${sparklineData[sparklineData.length - 1]} kg</span>
        </div>
        <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:60px;overflow:visible">
          <polyline fill="none" stroke="var(--ac)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${polylinePts}" />
          <circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="4" fill="var(--ac)" />
        </svg>
      </div>
    `;
  }

  let volSparklineSvg = '';
  if (volumeData.length >= 2) {
    const minV = Math.min(...volumeData);
    const maxV = Math.max(...volumeData);
    const rangeV = (maxV - minV) || 1;
    const w = 280, h = 60, pad = 12;
    const ptsV = volumeData.map((val, idx) => {
      const px = pad + (idx / (volumeData.length - 1)) * (w - 2 * pad);
      const py = h - pad - ((val - minV) / rangeV) * (h - 2 * pad);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    });

    const polylinePtsV = ptsV.join(' ');
    const lastPtV = ptsV[ptsV.length - 1].split(',');

    volSparklineSvg = `
      <div class="ex-history-sparkline-wrap" style="background:var(--c2);border-radius:12px;padding:12px;margin-bottom:14px;border:1px solid var(--bdr)">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t2);margin-bottom:6px">
          <span>Session Volume Trend</span>
          <span style="font-weight:600;color:var(--gn)">Latest: ${volumeData[volumeData.length - 1]} kg</span>
        </div>
        <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:60px;overflow:visible">
          <polyline fill="none" stroke="var(--gn)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${polylinePtsV}" />
          <circle cx="${lastPtV[0]}" cy="${lastPtV[1]}" r="4" fill="var(--gn)" />
        </svg>
      </div>
    `;
  }

  modal(`
    <div class="zoom-modal-sheet ex-history-modal">
      <div class="zoom-modal-header">
        <div>
          <h2 class="zoom-title" style="display:flex;align-items:center;gap:6px">
            <span>📈</span> <span>${esc(ex.name)}</span>
          </h2>
          <div class="t2 sm">${esc(ex.g)} · ${esc(ex.eq)} · ${sessions.length} logged sessions</div>
        </div>
        <button class="btn s sm-btn zoom-close-btn" data-a="close">✕ Close</button>
      </div>

      <!-- All-time Records Cards -->
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin:12px 0 14px">
        <div class="card" style="padding:10px 8px;text-align:center;background:var(--c2);border:1px solid var(--bdr);border-radius:10px">
          <div style="font-size:10px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:0.5px">Est. 1RM</div>
          <div style="font-size:18px;font-weight:800;color:var(--ac);margin-top:2px">${allTime1RM ? allTime1RM + ' kg' : '—'}</div>
        </div>
        <div class="card" style="padding:10px 8px;text-align:center;background:var(--c2);border:1px solid var(--bdr);border-radius:10px">
          <div style="font-size:10px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:0.5px">Max Weight</div>
          <div style="font-size:18px;font-weight:800;color:var(--tx);margin-top:2px">${allTimeMaxW ? allTimeMaxW + ' kg' : '—'}</div>
        </div>
        <div class="card" style="padding:10px 8px;text-align:center;background:var(--c2);border:1px solid var(--bdr);border-radius:10px">
          <div style="font-size:10px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:0.5px">Best Vol</div>
          <div style="font-size:18px;font-weight:800;color:var(--tx);margin-top:2px">${allTimeMaxVol ? allTimeMaxVol + ' kg' : '—'}</div>
        </div>
      </div>

      ${sparklineSvg}
      ${volSparklineSvg}

      <!-- Recent Sessions List -->
      <div style="flex:1;overflow-y:auto;min-height:120px">
        <div style="font-size:12px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">
          Last ${recentSessions.length} Sessions
        </div>
        ${recentSessions.length === 0 ? `
          <div style="text-align:center;padding:28px 16px;color:var(--t2);background:var(--c2);border-radius:12px">
            <div style="font-size:24px;margin-bottom:6px">📊</div>
            <div style="font-weight:600;font-size:14px;color:var(--tx)">No Workout History Yet</div>
            <div style="font-size:12px;margin-top:4px">Complete your first set for this exercise to start tracking strength gains and PR milestones.</div>
          </div>
        ` : recentSessions.map(sess => {
          const dateStr = new Date(sess.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
          const setsSummary = sess.sets.map((s, idx) => {
            const typeBadge = s.type ? `<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(255,255,255,0.1);font-weight:700">${s.type}</span> ` : '';
            return `${typeBadge}${s.w || 0}kg × ${s.r || 0}`;
          }).join(', ');

          return `
            <div class="card" style="padding:10px 12px;margin-bottom:8px;background:var(--c2);border:1px solid var(--bdr);border-radius:10px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span style="font-weight:700;font-size:13px">${esc(dateStr)}</span>
                <span style="font-size:11px;color:var(--t2)">Vol: <b>${sess.vol} kg</b></span>
              </div>
              <div style="font-size:12px;color:var(--t1);line-height:1.4">${setsSummary}</div>
              ${sess.note ? `<div style="font-size:11px;color:var(--t2);margin-top:4px;font-style:italic">Note: "${esc(sess.note)}"</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `);
}

function switchWorkExercise(newIdx, smoothCenter = true) {
  if (!S.act) return;
  const clampedIdx = Math.max(0, Math.min(S.act.ex.length - 1, newIdx));
  S.act.curEx = clampedIdx;
  save('act');

  const stepperPills = document.querySelector('.work-stepper-pills');
  const heroCard = document.querySelector('#work-hero-card');
  const navStepper = document.querySelector('.work-nav-stepper');
  const stepperTitle = document.querySelector('.work-stepper-title');
  const stepperContainer = document.querySelector('.work-stepper-container');

  if (stepperPills && heroCard) {
    // 1. Update pills in-place without destroying DOM or resetting scrollLeft
    const pills = stepperPills.querySelectorAll('.work-step-pill');
    pills.forEach((p, idx) => {
      const isCur = idx === clampedIdx;
      const x = S.act.ex[idx];
      const isDone = x && x.sets && x.sets.length > 0 && x.sets.every(s => s.done);
      const hasFail = x && x.sets && x.sets.some(s => s.rir === 0 || s.rpe >= 10);
      const ss = getSupersetInfo(S.act, idx);
      const ssTag = ss.isSuperset && ss.isPaired ? `[${ss.label}] ` : '';
      const e = X(x.id);

      p.className = `work-step-pill ${isCur ? 'active' : ''} ${isDone ? 'done' : ''} ${hasFail ? 'has-fail' : ''} ${ss.isSuperset && ss.isPaired ? 'ss-pill' : ''}`;
      p.innerHTML = `<span>${isDone ? '✓ ' : ''}${hasFail ? '💥 ' : ''}${ssTag}${idx + 1}. ${esc(e.name)}</span>`;
    });

    // 2. Automatically and smoothly center the active exercise pill
    const activePill = stepperPills.querySelector('.work-step-pill.active');
    if (activePill && smoothCenter) {
      activePill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }

    // 3. Update title
    const curEx = S.act.ex[clampedIdx];
    const exInfo = X(curEx.id);
    if (stepperTitle) {
      stepperTitle.innerHTML = `Exercise ${clampedIdx + 1} of ${S.act.ex.length}: <b>${esc(exInfo.name)}</b>`;
    }

    // 4. Update or render superset banner
    const ssInfo = getSupersetInfo(S.act, clampedIdx);
    if (stepperContainer) {
      const existingSs = stepperContainer.querySelector('.superset-block-card');
      const newSsHtml = ssInfo.isSuperset && ssInfo.isPaired ? renderSupersetBanner(ssInfo) : '';
      if (existingSs && newSsHtml) {
        existingSs.outerHTML = newSsHtml;
      } else if (existingSs && !newSsHtml) {
        existingSs.remove();
      } else if (!existingSs && newSsHtml) {
        stepperContainer.insertAdjacentHTML('beforeend', newSsHtml);
      }
    }

    // 5. Update hero card and nav stepper in-place
    heroCard.outerHTML = renderWorkHeroCard(S.act, clampedIdx);
    if (navStepper) {
      navStepper.outerHTML = renderWorkNavStepper(S.act, clampedIdx);
    }

    // 6. Update progress bar
    updateWorkProgressHeader(S.act);
    return;
  }

  // Fallback if not already in DOM
  render();
}

function handleSetCompleted(i, j, s, x) {
  const pr = checkSetPR(x.id, s, !!x.uni);
  if (S.cfg.vibrate !== false && navigator.vibrate) {
    navigator.vibrate(pr ? [40, 60, 120] : 40);
  }

  // Checkmark spring ripple on thumb-zone Done button
  if (typeof document !== 'undefined') {
    const doneBtn = document.querySelector(`.set-done-btn[data-i="${i}"][data-j="${j}"]`);
    if (doneBtn) {
      doneBtn.classList.remove('spring-ripple');
      void doneBtn.offsetWidth; // trigger reflow
      doneBtn.classList.add('spring-ripple');
    }
  }

  if (pr) {
    const exObj = X(x.id);
    const prText = `🎉 NEW PR! ${exObj?.name || 'Exercise'} · ${s.w}kg × ${s.r}`;
    triggerPRCelebration({ text: prText });
  }

  const ssInfo = getSupersetInfo(S.act, i);
  if (ssInfo.isSuperset && ssInfo.isPaired) {
    if (!ssInfo.isLastInGroup && ssInfo.nextInGroup) {
      // Step: User finishes Set N of Exercise Ak (not last in group) -> Press Done -> NO rest timer begins -> Screen immediately transitions focus to Set N of Exercise Ak+1.
      stopRest(true);
      switchWorkExercise(ssInfo.nextInGroup.idx);
      toast(`⚡ Switched to ${ssInfo.nextInGroup.label}: ${esc(X(ssInfo.nextInGroup.ex.id).name)} (Round ${j + 1})`);
      focusSetInput(ssInfo.nextInGroup.idx, j);
      return;
    } else if (ssInfo.isLastInGroup) {
      // Step: User finishes Set N of last Exercise in group (e.g. A2 in Superset, A3 in Tri-Set, An in Giant-Set) -> REST TIMER BEGINS.
      // Automatically loop back to Set N+1 of Exercise A1 when timer finishes / is skipped.
      switchWorkExercise(i);
      const nextRoundSetIdx = j + 1;
      const firstEx = ssInfo.firstInGroup.ex;
      if (nextRoundSetIdx < (firstEx?.sets?.length || 0)) {
        T.supersetLoop = {
          targetEx: ssInfo.firstInGroup.idx,
          targetSet: nextRoundSetIdx,
          round: nextRoundSetIdx + 1,
          totalRounds: ssInfo.totalRounds
        };
        startRest(getExRest(x.id));
        toast(`⏱️ ${ssInfo.typeLabel} Rest: Up Next Round ${nextRoundSetIdx + 1} (${esc(X(firstEx.id).name)})`);
      } else {
        T.supersetLoop = null;
        startRest(getExRest(x.id));
        toast(`🎉 ${ssInfo.tag} All ${ssInfo.totalRounds} Rounds Complete!`);
      }
      return;
    }
  }

  // Regular non-superset exercise
  if (!x.ss) {
    startRest(getExRest(x.id));
  }
  switchWorkExercise(i, false);
}

function vWork() {
  const a = S.act;
  if (!a) { view = 'train'; return vTrain(); }
  startWorkTimer();

  if (!a.ex || !a.ex.length) {
    return `<div class="work-top-bar">
      <div class="work-title-group">
        <div class="work-routine-name">${esc(a.name)}</div>
        <div class="work-timer-badge" id="work-live-timer">⏱️ ${fmtDur(Date.now() - a.t0)}</div>
      </div>
      <div class="work-top-actions">
        <button class="btn sm-btn chip-success" data-a="directsave" title="Emergency Direct Save: bypass confirmation and save immediately">⚡ Direct Save</button>
        <button class="btn s sm-btn red" data-a="cancel">Discard</button>
      </div>
    </div>
    <div class="card" style="text-align:center;padding:32px 16px">
      <p class="t2">No exercises added to this workout session yet.</p>
      <button class="btn" data-a="addex" style="margin-top:12px">${ic('plus', 18)} Add First Exercise</button>
    </div>`;
  }

  const curIdx = Math.min(Math.max(0, a.curEx || 0), a.ex.length - 1);
  a.curEx = curIdx;

  const currentEx = a.ex[curIdx];
  const exInfo = X(currentEx.id);

  const allSets = a.ex.flatMap(x => x.sets);
  const doneSets = allSets.filter(s => s.done).length;
  const totalSets = allSets.length;
  const pct = totalSets ? Math.round((doneSets / totalSets) * 100) : 0;
  const ssInfo = getSupersetInfo(a, curIdx);

  return `
    <div class="work-top-bar">
      <div class="work-title-group">
        <div class="work-routine-name">${esc(a.name)}</div>
        <div class="work-timer-badge" id="work-live-timer">⏱️ ${fmtDur(Date.now() - a.t0)} · ${pct}% completed (${doneSets}/${totalSets} sets)</div>
      </div>
      <div class="work-top-actions">
        <button class="btn sm-btn frosted" data-a="openaicoach" title="Ask AI Coach for cues, warm-up sets, or substitutions">🤖 Coach</button>
        <button class="gear-btn frosted sm" data-a="opensettings" aria-label="Settings" title="Settings">${ic('gear', 18)}</button>
        <button class="btn sm-btn chip-success" data-a="directsave" title="Emergency Direct Save: bypass confirmation and save immediately">⚡ Direct Save</button>
        <button class="btn sm-btn" data-a="promptfin">Finish</button>
        <button class="btn s sm-btn red" data-a="promptcancel">✕</button>
      </div>
    </div>

    <!-- Overall Workout Progress Bar -->
    <div class="work-progress-bar">
      <div class="work-progress-fill" style="width: ${pct}%"></div>
    </div>

    <!-- Stepper Header & Breadcrumb Carousel -->
    <div class="work-stepper-container" id="work-stepper-container">
      ${a.isDeload ? `<div class="deload-work-banner">⚡ <b>Deload Protocol Active:</b> Volume halved (-50%) & Load -20% for CNS recovery.</div>` : ''}
      <div class="work-stepper-title" id="work-stepper-title">Exercise ${curIdx + 1} of ${a.ex.length}: <b>${esc(exInfo.name)}</b></div>
      <div class="work-stepper-pills" id="work-stepper-pills">
        ${a.ex.map((x, i) => {
          const e = X(x.id);
          const isDone = x.sets.length > 0 && x.sets.every(s => s.done);
          const isCur = i === curIdx;
          const hasFail = x.sets.some(s => s.rir === 0 || s.rpe >= 10);
          const ss = getSupersetInfo(a, i);
          const ssTag = ss.isSuperset && ss.isPaired ? `[${ss.label}] ` : '';
          return `<button class="work-step-pill ${isCur ? 'active' : ''} ${isDone ? 'done' : ''} ${hasFail ? 'has-fail' : ''} ${ss.isSuperset && ss.isPaired ? 'ss-pill' : ''}" data-a="setcurex" data-i="${i}">
            <span>${isDone ? '✓ ' : ''}${hasFail ? '💥 ' : ''}${ssTag}${i + 1}. ${esc(e.name)}</span>
          </button>`;
        }).join('')}
      </div>
      ${renderSupersetBanner(ssInfo)}
    </div>

    <!-- Live Exercise Card with Decluttered Media and Horizontal Toolbar -->
    ${renderWorkHeroCard(a, curIdx)}

    <!-- Sticky Stepper Controls Navigation -->
    ${renderWorkNavStepper(a, curIdx)}

    <div class="row g" style="margin-top:14px">
      <button class="btn s" data-a="addex">${ic('plus', 16)} Add Exercise</button>
      <button class="btn s red" data-a="promptcancel">Discard Workout</button>
    </div>
  `;
}

// 3. Air-Gapped Exercise Library View
const filterExercises = () => {
  const q = libQuery.trim().toLowerCase();
  return EXDB.filter(e => {
    if (libCategory !== 'All' && e.g !== libCategory) return false;
    if (libCategory !== 'All' && libSubCategory !== 'All' && !matchesSubMuscle(e, libCategory, libSubCategory)) return false;
    if (libEquipment !== 'All' && e.eq !== libEquipment) return false;
    if (q) {
      return matchesExerciseSearch(e, q);
    }
    return true;
  });
};

const renderExRows = (items, query = libQuery) => {
  if (!items.length) {
    const q = (query || '').trim();
    if (q) {
      return `
        <div class="empty-search-card">
          <div style="font-size:32px;margin-bottom:8px">🔍</div>
          <div style="font-weight:700;font-size:15px;margin-bottom:4px">No exercise found for "${esc(q)}"</div>
          <p class="t2 sm" style="margin-bottom:14px">Cannot find what you're looking for? Add it to your exercise catalog.</p>
          <button class="btn sm-btn" data-a="opencustomex" data-name="${esc(q)}">+ Create "${esc(q)}" as Custom Exercise</button>
        </div>
      `;
    }
    return '<p class="t2" style="padding:16px 4px;text-align:center">No exercises found</p>';
  }
  return items.map(e => `
    <div class="ex-row" data-a="libex" data-id="${esc(e.id)}">
      <img class="ex-thumb" src="./media/${esc(e.img || e.gif)}" alt="${esc(e.name)}" loading="lazy" onerror="this.style.display='none'">
      <div class="ex-info">
        <div class="ex-name">${esc(e.name)}</div>
        <div class="ex-meta">${esc(e.tg || e.g)} · ${esc(e.eq)}</div>
      </div>
    </div>
  `).join('');
};

function updateLibResults() {
  const exList = $('#ex-list');
  if (!exList) return;
  const filtered = filterExercises();
  const visible = filtered.slice(0, libPageSize);

  exList.innerHTML = renderExRows(visible, libQuery);

  const countEl = $('#ex-count');
  if (countEl) countEl.textContent = `${filtered.length} exercises`;

  const moreContainer = $('#ex-more-container');
  if (moreContainer) {
    moreContainer.innerHTML = visible.length < filtered.length
      ? `<button class="btn s" data-a="libmore">Load more (${filtered.length - visible.length} remaining)</button>`
      : '';
  }

  const searchInput = $('#lib-search-input') || document.querySelector('input[data-f="libsearch"]');
  if (searchInput && document.activeElement === searchInput) {
    searchInput.focus({ preventScroll: true });
  }
}

function vLib() {
  const filtered = filterExercises();
  const visible = filtered.slice(0, libPageSize);

  return viewHeader('Library') +
    `<input id="lib-search-input" class="txt" placeholder="Search 1,300+ exercises..." data-f="libsearch" value="${esc(libQuery)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">` +
    `<button class="btn s sm-btn" data-a="opencustomex" style="width:100%;margin-bottom:10px">+ Create Custom Exercise</button>` +
    `<div class="chips">${BP_CATEGORIES.map(c => `<button class="chip ${libCategory === c ? 'on' : ''}" data-a="libcat" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` +
    `<div id="lib-sub-chips-wrap">${renderLibSubPills()}</div>` +
    `<div class="row" style="margin-bottom:12px"><label class="t2 sm" style="flex:1">Equipment:<select data-f="libeq">${EQ_OPTIONS.map(eq => `<option value="${esc(eq)}" ${libEquipment === eq ? 'selected' : ''}>${esc(eq.toUpperCase())}</option>`).join('')}</select></label><span id="ex-count" class="t2 sm" style="align-self:flex-end;margin-bottom:10px">${filtered.length} exercises</span></div>` +
    `<div id="ex-list" class="card" style="padding:0 12px">${renderExRows(visible, libQuery)}</div>` +
    `<div id="ex-more-container">${visible.length < filtered.length ? `<button class="btn s" data-a="libmore">Load more (${filtered.length - visible.length} remaining)</button>` : ''}</div>`;
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
  // Current month days with green radial glow on completed workout days
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const isSel = dateStr === calSelectedDate;
    const hasW = workoutDates.has(dateStr);
    cells.push(`<button class="cal-day ${isToday ? 'today' : ''} ${hasW ? 'has-w' : ''} ${isSel ? 'sel' : ''}" data-a="calsel" data-date="${esc(dateStr)}">${d}</button>`);
  }

  // Workouts for selected date
  const selLogs = S.logs.filter(l => new Date(l.date).toISOString().slice(0, 10) === calSelectedDate);
  const selDateObj = new Date(calSelectedDate + 'T12:00:00');
  const selDateDay = selDateObj.getDay();
  const selDateDisplay = selDateObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const scheduledRidForDate = S.sched ? (S.sched[selDateDay] || '') : '';
  const scheduledRoutineForDate = scheduledRidForDate ? S.routines.find(r => r.id === scheduledRidForDate) : null;

  const todayDay = new Date().getDay();
  const SPLIT_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Monday to Sunday grid

  return viewHeader('Calendar & Split') +
    renderStreakBadge() +
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
    `<h2>Weekly Split Schedule (Mon - Sun)</h2>` +
    `<div class="card" style="padding:4px 14px">` +
      SPLIT_DAYS.map(dayIdx => {
        const dayName = DAYS[dayIdx];
        const assignedRid = S.sched ? (S.sched[dayIdx] || '') : '';
        const isToday = todayDay === dayIdx;
        const assignedRoutine = S.routines.find(r => r.id === assignedRid);
        return `<div class="sched-day-row ${isToday ? 'today' : ''}">
          <div class="sched-day-header">
            <span class="sched-day-name">${dayName}</span>
            ${isToday ? '<span class="today-chip">Today</span>' : ''}
          </div>
          <div class="sched-day-picker">
            <select data-f="sched" data-day="${dayIdx}">
              <option value="">🌿 Rest Day</option>
              ${S.routines.map(r => `<option value="${esc(r.id)}" ${assignedRid === r.id ? 'selected' : ''}>${esc(r.name)} (${r.ex.length} ex)</option>`).join('')}
            </select>
          </div>
          ${assignedRoutine && isToday && !S.act ? `<button class="btn s sched-start-btn" data-a="start" data-id="${esc(assignedRoutine.id)}">Start</button>` : ''}
        </div>`;
      }).join('') +
    `<div class="row" style="margin:16px 0 8px;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">` +
      `<h2 style="margin:0">${esc(selDateDisplay)}</h2>` +
      `<button class="btn s sm-btn" data-a="openpastworkout" data-date="${esc(calSelectedDate)}">+ Log Past / Missed Workout</button>` +
    `</div>` +
    (selLogs.length ? selLogs.map(l => `
      <div class="card" style="margin-bottom:10px">
        <div class="row" style="align-items:center;justify-content:space-between">
          <div>
            <b>${esc(l.name)}</b>
            <div class="t2 sm">${Math.round(l.dur / 60000)} min · ${vol(l)} kg volume</div>
          </div>
          <div class="row g">
            <button class="btn s sm-btn" data-a="editpastlog" data-id="${esc(l.id || l.date)}">✏️ Edit</button>
            <button class="btn s sm-btn red" data-a="delpastlog" data-id="${esc(l.id || l.date)}" title="Delete workout">🗑️</button>
          </div>
        </div>
        <div class="routine-summary-list" style="margin-top:6px">
          ${l.ex.map(x => renderRoutineSummaryRow(x)).join('')}
        </div>
      </div>
    `).join('') : (scheduledRoutineForDate ? `
      <div class="card today-split-hero">
        <div class="row">
          <div>
            <div class="today-split-badge">⭐ Scheduled Routine (${DAYS[selDateDay]})</div>
            <div class="today-split-title">${esc(scheduledRoutineForDate.name)}</div>
          </div>
          ${!S.act ? `<button class="btn sched-start-btn" data-a="start" data-id="${esc(scheduledRoutineForDate.id)}">⚡ Start Routine</button>` : ''}
        </div>
        <div class="routine-summary-list">
          ${scheduledRoutineForDate.ex.map(renderRoutineSummaryRow).join('')}
        </div>
      </div>
    ` : `
      <div class="card empty-state-card sm">
        <div class="empty-state-icon">🌿</div>
        <div class="empty-state-title">Scheduled Rest Day</div>
        <p class="t2 sm">No workouts scheduled or logged for ${DAYS[selDateDay]}.</p>
        ${!S.act ? `<button class="btn s sm-btn" data-a="tab" data-k="train" style="margin-top:10px">Browse Routines</button>` : ''}
      </div>
    `));
}

// =============================================================================
// 5. INTERACTIVE BODY TRANSFORMATION ROADMAP & VISUAL PHYSIQUE MORPH ENGINE (v5.5.0)
// =============================================================================

function calcUSNavyBF(gender, heightCm, weightKg, waistCm, neckCm, hipCm) {
  const isFemale = (gender || S.cfg?.bodyModel) === 'female';
  const h = Math.max(100, Math.min(250, Number(heightCm) || (isFemale ? 165 : 178)));
  const waist = Math.max(45, Math.min(200, Number(waistCm) || (isFemale ? 74 : 85)));
  const neck = Math.max(20, Math.min(65, Number(neckCm) || (isFemale ? 33 : 38)));
  const hip = Math.max(50, Math.min(220, Number(hipCm) || Math.round(waist * 1.25)));

  let bf;
  if (isFemale) {
    const val = Math.max(10, waist + hip - neck);
    bf = 495 / (1.29579 - 0.35004 * Math.log10(val) + 0.22100 * Math.log10(h)) - 450;
  } else {
    const diff = Math.max(5, waist - neck);
    bf = 495 / (1.0324 - 0.19077 * Math.log10(diff) + 0.15456 * Math.log10(h)) - 450;
  }
  return Math.max(4.0, Math.min(55.0, Math.round(bf * 10) / 10));
}

function getMorphInterpolation(pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0)) / 100;
  // Waist scale: 1.0 down to 0.78
  const waistScale = Math.round((1.0 - p * (1.0 - 0.78)) * 1000) / 1000;
  // Shoulder scale: 1.0 up to 1.08
  const shoulderScale = Math.round((1.0 + p * 0.08) * 1000) / 1000;
  // Abdominal definition & striations: 0.15 up to 1.0
  const abOpacity = Math.round((0.15 + p * 0.85) * 1000) / 1000;
  // Chest definition: 0.25 up to 1.0
  const chestDefinition = Math.round((0.25 + p * 0.75) * 1000) / 1000;
  // Glow intensity: 0 to 1
  const glowIntensity = Math.round(p * 100) / 100;

  return { waistScale, shoulderScale, abOpacity, chestDefinition, glowIntensity };
}

function calcNutritionTargets(opts = {}) {
  const gender = opts.gender || S.cfg?.bodyModel || 'male';
  const isFemale = gender === 'female';
  const weight = Math.max(35, Math.min(250, Number(opts.weight) || (isFemale ? 62 : 78)));
  const height = Math.max(100, Math.min(250, Number(opts.height) || (isFemale ? 165 : 178)));
  const age = Math.max(14, Math.min(100, Number(opts.age || S.cfg?.physique?.age) || 28));
  const goalType = opts.goalType || S.cfg?.physique?.goalType || 'sixpack';
  const currentBf = Number(opts.currentBf) || (isFemale ? 24.0 : 16.0);
  const activityLevel = opts.activityLevel || S.cfg?.physique?.activityLevel || 'moderate';

  const actMultipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.45,
    very_active: 1.725
  };
  const actMult = actMultipliers[activityLevel] || 1.45;

  const leanMass = weight * (1 - (currentBf / 100));
  const bmr = 370 + (21.6 * leanMass);
  const tdee = Math.round(bmr * actMult);

  let cals, proteinRatio, fatRatio, weeklyTargetRate;

  if (goalType === 'bulk') {
    // 2. Lean Bulk: Target Surplus -> Calorie Surplus (TDEE + 250), weekly rate target (+0.25 kg/wk)
    cals = Math.round(tdee + 250);
    proteinRatio = 2.0;
    fatRatio = 0.85;
    weeklyTargetRate = '+0.25 kg/week';
  } else if (goalType === 'recomp') {
    // 3. Recomposition: Maintenance calories
    cals = Math.round(tdee);
    proteinRatio = 2.2;
    fatRatio = 0.8;
    weeklyTargetRate = '0.00 kg/week (recomp)';
  } else {
    // 1. Cut (sixpack/cut): Target BF% < Current BF% -> Calorie Deficit (TDEE - 400)
    cals = Math.round(tdee - 400);
    proteinRatio = 2.2;
    fatRatio = 0.75;
    weeklyTargetRate = '-0.40 kg/week';
  }

  cals = Math.max(1400, cals);

  const protein = Math.round(weight * proteinRatio);
  const fats = Math.round(weight * fatRatio);
  const remainingCals = Math.max(150, cals - (protein * 4) - (fats * 9));
  const carbs = Math.round(remainingCals / 4);

  return {
    cals,
    tdee,
    rateTarget: weeklyTargetRate,
    weeklyTargetRate,
    protein,
    proteinRatio,
    carbs,
    fats,
    goalType
  };
}

function getDefaultPhysiqueConfig(gender = 'male') {
  const isFemale = gender === 'female';
  return {
    height: isFemale ? 165 : 178,
    weight: isFemale ? 62 : 78,
    waist: isFemale ? 74 : 85,
    neck: isFemale ? 33 : 38,
    hip: isFemale ? 95 : 98,
    age: 28,
    activityLevel: 'moderate',
    experienceLevel: 'beginner',
    goalType: 'sixpack',
    targetBf: isFemale ? 18.0 : 11.0,
    startBf: isFemale ? 26.0 : 19.5,
    microProgressBonus: 0
  };
}

function getPhysiqueState() {
  const gender = S.cfg?.bodyModel || 'male';
  const defaults = getDefaultPhysiqueConfig(gender);
  const userP = S.cfg?.physique || {};

  const sorted = [...(S.weights || [])].filter(x => (x.w != null && x.w > 0) || (x.waist != null && x.waist > 0)).sort((a, b) => a.t - b.t);
  const latestW = [...sorted].reverse().find(x => x.w != null && x.w > 0);
  const latestWaist = [...sorted].reverse().find(x => x.waist != null && x.waist > 0);

  const height = Number(userP.height) || defaults.height;
  const weight = latestW ? Number(latestW.w) : (Number(userP.weight) || defaults.weight);
  const waist = latestWaist ? Number(latestWaist.waist) : (Number(userP.waist) || defaults.waist);
  const neck = Number(userP.neck) || defaults.neck;
  const hip = Number(userP.hip) || defaults.hip;
  const age = Number(userP.age) || defaults.age;
  const activityLevel = userP.activityLevel || defaults.activityLevel;
  const experienceLevel = userP.experienceLevel || defaults.experienceLevel;
  const goalType = userP.goalType || defaults.goalType;

  const currentBf = calcUSNavyBF(gender, height, weight, waist, neck, hip);

  let targetBf = Number(userP.targetBf);
  if (!targetBf || isNaN(targetBf)) {
    if (goalType === 'sixpack' || goalType === 'cut') targetBf = (gender === 'female' ? 18.0 : 11.0);
    else if (goalType === 'bulk') targetBf = (gender === 'female' ? 22.0 : 14.0);
    else targetBf = (gender === 'female' ? 19.5 : 12.5);
  }

  let startBf = Number(userP.startBf);
  if (!startBf || isNaN(startBf)) {
    const firstW = sorted.find(x => x.w != null && x.w > 0);
    const firstWaist = sorted.find(x => x.waist != null && x.waist > 0);
    if (firstW && firstWaist) {
      startBf = calcUSNavyBF(gender, height, firstW.w, firstWaist.waist, neck, hip);
    } else {
      startBf = goalType === 'bulk' ? targetBf - 4.0 : Math.max(currentBf + 2.0, targetBf + 6.0);
    }
  }

  let baseProgress = 0;
  if (goalType === 'bulk') {
    const totalDelta = targetBf - startBf;
    if (Math.abs(totalDelta) > 0.1) {
      baseProgress = ((currentBf - startBf) / totalDelta) * 100;
    } else {
      baseProgress = 50;
    }
  } else {
    const totalFatLossTarget = startBf - targetBf;
    if (totalFatLossTarget > 0.1) {
      baseProgress = ((startBf - currentBf) / totalFatLossTarget) * 100;
    } else {
      baseProgress = currentBf <= targetBf ? 100 : 0;
    }
  }

  const microBonus = Number(userP.microProgressBonus) || 0;
  const progressPct = Math.max(0, Math.min(100, Math.round((baseProgress + microBonus) * 10) / 10));

  const deltaBf = Math.abs(currentBf - targetBf);
  const weeksRemaining = Math.max(1, Math.round(deltaBf / 0.45));
  const workoutsRemaining = weeksRemaining * 4;

  const macros = calcNutritionTargets({ gender, height, weight, goalType, currentBf, age, activityLevel });

  let goalTitle = 'Lean Cut';
  if (goalType === 'bulk') goalTitle = 'Lean Muscle Bulk';
  else if (goalType === 'recomp') goalTitle = 'Body Recomposition';

  return {
    gender,
    height,
    weight,
    waist,
    neck,
    hip,
    age,
    activityLevel,
    experienceLevel,
    goalType,
    goalTitle,
    currentBf,
    targetBf,
    startBf,
    progressPct,
    weeksRemaining,
    workoutsRemaining,
    macros,
    microProgressBonus: microBonus
  };
}

function getTransformationMetrics() {
  const p = getPhysiqueState();
  const sorted = [...(S.weights || [])].filter(x => (x.w != null && x.w > 0) || (x.waist != null && x.waist > 0)).sort((a, b) => a.t - b.t);
  const dayMs = 86400000;
  const firstT = sorted.length ? sorted[0].t : 0;
  const lastT = sorted.length ? sorted.at(-1).t : 0;
  const totalDaysHistory = (firstT && lastT) ? Math.max(1, Math.floor((lastT - firstT) / dayMs) + 1) : (sorted.length ? 1 : 0);
  const distinctDays = new Set(sorted.map(x => dk(x.t))).size;
  const isGated = totalDaysHistory < 14 || distinctDays < 2;

  // 7-day rolling average of waist and weight
  const sevenDaysAgo = lastT - 7 * dayMs;
  const rollingEntries = sorted.filter(x => x.t >= sevenDaysAgo);
  const wEntries = rollingEntries.filter(x => x.w != null && x.w > 0);
  const waistEntries = rollingEntries.filter(x => x.waist != null && x.waist > 0);

  const avgWeight = wEntries.length ? (wEntries.reduce((acc, x) => acc + x.w, 0) / wEntries.length) : p.weight;
  const avgWaist = waistEntries.length ? (waistEntries.reduce((acc, x) => acc + x.waist, 0) / waistEntries.length) : p.waist;

  const rollingBf = calcUSNavyBF(p.gender, p.height, avgWeight, avgWaist, p.neck, p.hip);

  let milestonePct = 0;
  if (p.goalType === 'bulk') {
    const totalDelta = p.targetBf - p.startBf;
    if (Math.abs(totalDelta) > 0.1) {
      milestonePct = ((rollingBf - p.startBf) / totalDelta) * 100;
    } else {
      milestonePct = 50;
    }
  } else {
    const totalFatLossTarget = p.startBf - p.targetBf;
    if (totalFatLossTarget > 0.1) {
      milestonePct = ((p.startBf - rollingBf) / totalFatLossTarget) * 100;
    } else {
      milestonePct = rollingBf <= p.targetBf ? 100 : 0;
    }
  }

  const bonus = Number(p.microProgressBonus) || 0;
  const finalMilestonePct = Math.max(0, Math.min(100, Math.round((milestonePct + bonus) * 10) / 10));

  return {
    isGated,
    totalDaysHistory,
    distinctDays,
    avgWeight: rd(avgWeight),
    avgWaist: rd(avgWaist),
    rollingBf,
    milestonePct: finalMilestonePct
  };
}

function generateMorphSvg(gender = 'male', progressPct = 42.5) {
  const isFemale = (gender || S.cfg?.bodyModel) === 'female';
  const p = Math.max(0, Math.min(100, Number(progressPct) || 0));
  const { waistScale, shoulderScale, abOpacity, chestDefinition, glowIntensity } = getMorphInterpolation(p);

  const glowFilterStyle = glowIntensity > 0.35
    ? `filter: drop-shadow(0 0 ${(glowIntensity * 5).toFixed(1)}px rgba(255, 159, 10, ${(glowIntensity * 0.75).toFixed(2)}));`
    : '';

  return `
    <svg id="morph-silhouette-svg" class="roadmap-morph-svg" viewBox="0 0 280 340" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="morph-body-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#232736"/>
          <stop offset="100%" stop-color="#141721"/>
        </linearGradient>
        <linearGradient id="morph-gold-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FF9F0A"/>
          <stop offset="100%" stop-color="#FFD60A"/>
        </linearGradient>
        <filter id="gold-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      <!-- Projected Target Goal Physique Ghost Outline -->
      <path class="morph-ghost-silhouette" d="${isFemale
        ? 'M 140 18 C 122 18 94 60 84 94 C 94 108 108 112 118 152 C 114 175 106 200 114 245 C 118 280 120 316 125 322 L 155 322 C 160 316 162 280 166 245 C 174 200 166 175 162 152 C 172 112 186 108 196 94 C 186 60 158 18 140 18 Z'
        : 'M 140 18 C 120 18 80 62 68 100 C 80 116 100 122 114 162 C 110 185 102 215 110 256 C 115 285 118 316 124 322 L 156 322 C 162 316 165 285 170 256 C 178 215 170 185 166 162 C 180 122 200 116 212 100 C 200 62 160 18 140 18 Z'
      }"/>

      <!-- Base Anatomical Head & Neck -->
      <circle cx="140" cy="30" r="14" fill="#161822" stroke="#252A3A" stroke-width="1.2"/>
      <path d="M 133 44 L 133 56 M 147 44 L 147 56" stroke="#252A3A" stroke-width="1.2"/>

      <!-- Lower Body (Hips, Quads, Calves) -->
      ${isFemale ? `
        <!-- Female Pelvis, Sculpted Quads, Sleek Calves -->
        <path d="M 112 184 C 104 202 106 230 114 254 C 118 262 124 262 126 254 C 124 238 126 216 128 196 Z" fill="#1C202D" stroke="#2C3347" stroke-width="1.2"/>
        <path d="M 168 184 C 176 202 174 230 166 254 C 162 262 156 262 154 254 C 156 238 154 216 152 196 Z" fill="#1C202D" stroke="#2C3347" stroke-width="1.2"/>
        <path d="M 116 264 C 112 278 116 296 123 318 L 130 318 C 128 296 128 278 125 264 Z" fill="#181B26" stroke="#282F42" stroke-width="1"/>
        <path d="M 164 264 C 168 278 164 296 157 318 L 150 318 C 152 296 152 278 155 264 Z" fill="#181B26" stroke="#282F42" stroke-width="1"/>
      ` : `
        <!-- Male Quads with Teardrop Definition, Calves -->
        <path d="M 114 190 C 104 208 106 236 114 254 C 118 262 124 262 126 254 C 124 238 126 216 128 200 Z" fill="#1C202D" stroke="#2C3347" stroke-width="1.2"/>
        <path d="M 166 190 C 176 208 174 236 166 254 C 162 262 156 262 154 254 C 156 238 154 216 152 200 Z" fill="#1C202D" stroke="#2C3347" stroke-width="1.2"/>
        <path d="M 124 238 C 128 244 126 252 122 254 M 156 238 C 152 244 154 252 158 254" fill="none" stroke="#FF9F0A" stroke-width="1.2" opacity="0.6"/>
        <path d="M 115 264 C 110 278 114 296 122 318 L 130 318 C 128 296 128 278 125 264 Z" fill="#181B26" stroke="#282F42" stroke-width="1"/>
        <path d="M 165 264 C 170 278 166 296 158 318 L 150 318 C 152 296 152 278 155 264 Z" fill="#181B26" stroke="#282F42" stroke-width="1"/>
      `}

      <!-- Arms & Forearms -->
      <path d="M 80 114 C 74 126 72 144 76 158 C 78 168 76 182 74 192 L 84 192 C 86 180 88 168 86 156 C 88 144 92 126 90 114 Z" fill="#181B26" stroke="#282F42" stroke-width="1"/>
      <path d="M 200 114 C 206 126 208 144 204 158 C 202 168 204 182 206 192 L 196 192 C 194 180 192 168 194 156 C 192 144 188 126 190 114 Z" fill="#181B26" stroke="#282F42" stroke-width="1"/>

      <!-- Morph Group: Shoulders & Traps (Broadens as shoulderScale increases) -->
      <g id="morph-shoulders" transform="translate(140, 78) scale(${shoulderScale}, 1) translate(-140, -78)">
        <path d="M 132 50 C 122 56 108 64 96 74 L 110 74 C 122 66 132 58 132 50 Z" fill="#1B1E2B" stroke="#2D3346" stroke-width="1"/>
        <path d="M 148 50 C 158 56 172 64 184 74 L 170 74 C 158 66 148 58 148 50 Z" fill="#1B1E2B" stroke="#2D3346" stroke-width="1"/>
        <path d="M 96 74 C 82 78 72 90 74 104 C 76 116 85 120 92 116 C 98 110 102 96 98 74 Z" fill="#1D2130" stroke="#333A4E" stroke-width="1.2"/>
        <path d="M 184 74 C 198 78 208 90 206 104 C 204 116 195 120 188 116 C 182 110 178 96 182 74 Z" fill="#1D2130" stroke="#333A4E" stroke-width="1.2"/>
        <!-- Lateral Deltoid Striation Highlight -->
        <path d="M 85 86 C 88 94 92 102 91 108 M 195 86 C 192 94 188 102 189 108" fill="none" stroke="#FF9F0A" stroke-width="1.2" opacity="0.75"/>
      </g>

      <!-- Morph Group: Waist & Lats (Tapers as waistScale decreases 1.0 -> 0.78) -->
      <g id="morph-waist" transform="translate(140, 155) scale(${waistScale}, 1) translate(-140, -155)">
        <path d="${isFemale
          ? 'M 102 114 C 102 135 114 150 118 164 L 162 164 C 166 150 178 135 178 114 Z'
          : 'M 98 116 C 98 135 110 152 116 168 L 164 168 C 170 152 182 135 182 116 Z'
        }" fill="#161822" stroke="#252A3A" stroke-width="1.2"/>
        <path d="${isFemale
          ? 'M 118 164 C 114 174 108 182 112 188 L 168 188 C 172 182 166 174 162 164 Z'
          : 'M 116 168 C 114 176 112 184 114 190 L 166 190 C 168 184 166 176 164 168 Z'
        }" fill="#181B26" stroke="#282F42" stroke-width="1.2"/>
        <!-- Obliques Contours -->
        <path d="M 115 160 C 122 168 126 176 128 182 M 165 160 C 158 168 154 176 152 182" fill="none" stroke="#FF9F0A" stroke-width="1.2" opacity="0.7"/>
      </g>

      <!-- Morph Group: Chiseled Chest / Pectoral Shelf -->
      <g id="morph-pecs" opacity="${chestDefinition}">
        <path d="${isFemale
          ? 'M 137 86 C 120 88 106 98 108 116 C 110 126 124 128 137 126 Z'
          : 'M 137 84 C 122 86 102 92 100 110 C 100 120 114 125 137 124 Z'
        }" fill="#202434" stroke="#363E54" stroke-width="1.2"/>
        <path d="${isFemale
          ? 'M 143 86 C 160 88 174 98 172 116 C 170 126 156 128 143 126 Z'
          : 'M 143 84 C 158 86 178 92 180 110 C 180 120 166 125 143 124 Z'
        }" fill="#202434" stroke="#363E54" stroke-width="1.2"/>
        <!-- Chiseled Lower Pec Underline with Gold Accent -->
        <path d="M 104 114 C 114 122 126 124 137 124 M 176 114 C 166 122 154 124 143 124" fill="none" stroke="#FF9F0A" stroke-width="1.8" filter="url(#gold-glow)"/>
      </g>

      <!-- Morph Group: Serratus & Rib Striations -->
      <g id="morph-striations" opacity="${(abOpacity * 0.85).toFixed(3)}">
        <path d="M 112 130 L 122 136 M 110 140 L 121 146 M 112 150 L 122 156" fill="none" stroke="#FF9F0A" stroke-width="1.2"/>
        <path d="M 168 130 L 158 136 M 170 140 L 159 146 M 168 150 L 158 156" fill="none" stroke="#FF9F0A" stroke-width="1.2"/>
      </g>

      <!-- Morph Group: 6-Pack Rectus Abdominis with Gold/Amber Glow -->
      <g id="morph-abs" opacity="${abOpacity}" style="${glowFilterStyle}">
        <!-- Linea Alba Midline -->
        <line x1="140" y1="126" x2="140" y2="182" stroke="#FF9F0A" stroke-width="1.6"/>
        <!-- Transverse Inscriptions -->
        <line x1="128" y1="142" x2="152" y2="142" stroke="#FF9F0A" stroke-width="1.2"/>
        <line x1="128" y1="160" x2="152" y2="160" stroke="#FF9F0A" stroke-width="1.2"/>
        <!-- Abdominal Tiles -->
        <rect x="129" y="128" width="9" height="12" rx="2" fill="#24293A" stroke="#3D465E" stroke-width="0.8"/>
        <rect x="142" y="128" width="9" height="12" rx="2" fill="#24293A" stroke="#3D465E" stroke-width="0.8"/>
        <rect x="128" y="144" width="10" height="14" rx="2" fill="#24293A" stroke="#3D465E" stroke-width="0.8"/>
        <rect x="142" y="144" width="10" height="14" rx="2" fill="#24293A" stroke="#3D465E" stroke-width="0.8"/>
        <rect x="129" y="162" width="9" height="16" rx="2" fill="#24293A" stroke="#3D465E" stroke-width="0.8"/>
        <rect x="142" y="162" width="9" height="16" rx="2" fill="#24293A" stroke="#3D465E" stroke-width="0.8"/>
      </g>
    </svg>
  `;
}

function updateMorphVisuals(pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const { waistScale, shoulderScale, abOpacity, chestDefinition, glowIntensity } = getMorphInterpolation(p);

  const svg = document.getElementById('morph-silhouette-svg');
  if (svg) {
    const waistG = svg.querySelector('#morph-waist');
    if (waistG) waistG.setAttribute('transform', `translate(140, 155) scale(${waistScale}, 1) translate(-140, -155)`);

    const shoulderG = svg.querySelector('#morph-shoulders');
    if (shoulderG) shoulderG.setAttribute('transform', `translate(140, 78) scale(${shoulderScale}, 1) translate(-140, -78)`);

    const absG = svg.querySelector('#morph-abs');
    if (absG) {
      absG.setAttribute('opacity', abOpacity.toFixed(3));
      absG.style.filter = glowIntensity > 0.35 ? `drop-shadow(0 0 ${(glowIntensity * 5).toFixed(1)}px rgba(255, 159, 10, ${(glowIntensity * 0.75).toFixed(2)}))` : 'none';
    }

    const pecsG = svg.querySelector('#morph-pecs');
    if (pecsG) pecsG.setAttribute('opacity', chestDefinition.toFixed(3));

    const striatG = svg.querySelector('#morph-striations');
    if (striatG) striatG.setAttribute('opacity', (abOpacity * 0.85).toFixed(3));
  }

  const numEl = document.getElementById('morph-readout-num');
  if (numEl) numEl.textContent = `${p.toFixed(1)}%`;

  const tagEl = document.getElementById('morph-curr-tag');
  if (tagEl) tagEl.textContent = `Scrub: ${p.toFixed(1)}%`;

  const ringEl = document.getElementById('morph-progress-ring');
  if (ringEl) {
    const circumference = 2 * Math.PI * 40; // 251.327
    const offset = circumference - (p / 100) * circumference;
    ringEl.style.strokeDashoffset = offset.toFixed(1);
  }
}

function updateCalibrationPreview() {
  const gEl = $('#calib-gender');
  const hEl = $('#calib-height');
  const wEl = $('#calib-weight');
  const waistEl = $('#calib-waist');
  const neckEl = $('#calib-neck');
  const hipEl = $('#calib-hip');
  const hipField = $('#calib-hip-field');
  const liveBfEl = $('#calib-live-bf');

  if (hipField) {
    hipField.style.display = gEl?.value === 'female' ? '' : 'none';
  }

  const liveBf = calcUSNavyBF(
    gEl?.value || 'male',
    parseFloat(hEl?.value) || 178,
    parseFloat(wEl?.value) || 78,
    parseFloat(waistEl?.value) || 85,
    parseFloat(neckEl?.value) || 38,
    parseFloat(hipEl?.value) || 95
  );

  if (liveBfEl) liveBfEl.textContent = `${liveBf}%`;
}

function showPhysiqueCalibrationModal() {
  const p = getPhysiqueState();
  const isFemale = p.gender === 'female';

  modal(`
    <h2>🎯 Roadmap Calibration</h2>
    <p class="t2 sm" style="margin-bottom:12px">Calibrate anthropometry, goal physique, and daily nutrition targets.</p>

    <div class="calib-preview-banner" id="calib-preview-banner">
      <span>📐</span>
      <div>Estimated Body Fat: <b id="calib-live-bf">${p.currentBf}%</b> (US Navy Method)</div>
    </div>

    <div class="calib-modal-grid">
      <div class="calib-row">
        <div class="calib-field">
          <label class="calib-lbl">Biological Sex / Silhouette</label>
          <select class="calib-select" id="calib-gender">
            <option value="male" ${!isFemale ? 'selected' : ''}>Male</option>
            <option value="female" ${isFemale ? 'selected' : ''}>Female</option>
          </select>
        </div>
        <div class="calib-field">
          <label class="calib-lbl">Age</label>
          <input type="number" step="1" min="14" max="100" class="calib-input" id="calib-age" value="${p.age || 26}" placeholder="26">
        </div>
      </div>

      <div class="calib-row">
        <div class="calib-field">
          <label class="calib-lbl">Activity Level</label>
          <select class="calib-select" id="calib-activity">
            <option value="sedentary" ${p.activityLevel === 'sedentary' ? 'selected' : ''}>Sedentary (Desk Job)</option>
            <option value="light" ${p.activityLevel === 'light' ? 'selected' : ''}>Light (1–3 Days/Wk)</option>
            <option value="moderate" ${!p.activityLevel || p.activityLevel === 'moderate' ? 'selected' : ''}>Moderate (3–5 Days/Wk)</option>
            <option value="very_active" ${p.activityLevel === 'very_active' ? 'selected' : ''}>Very Active (6–7 Days/Wk)</option>
          </select>
        </div>
        <div class="calib-field">
          <label class="calib-lbl">Experience Level</label>
          <select class="calib-select" id="calib-experience">
            <option value="beginner" ${p.experienceLevel === 'beginner' ? 'selected' : ''}>Beginner (&lt;1 Yr)</option>
            <option value="intermediate" ${!p.experienceLevel || p.experienceLevel === 'intermediate' ? 'selected' : ''}>Intermediate (1–3 Yrs)</option>
            <option value="advanced" ${p.experienceLevel === 'advanced' ? 'selected' : ''}>Advanced (3+ Yrs)</option>
          </select>
        </div>
      </div>

      <div class="calib-row">
        <div class="calib-field">
          <label class="calib-lbl">Height (cm)</label>
          <input type="number" step="0.5" class="calib-input" id="calib-height" value="${p.height}" placeholder="178">
        </div>
        <div class="calib-field">
          <label class="calib-lbl">Current Weight (kg)</label>
          <input type="number" step="0.1" class="calib-input" id="calib-weight" value="${p.weight}" placeholder="78">
        </div>
      </div>

      <div class="calib-row">
        <div class="calib-field">
          <label class="calib-lbl">Waist Circumference (cm)</label>
          <input type="number" step="0.5" class="calib-input" id="calib-waist" value="${p.waist}" placeholder="85">
        </div>
        <div class="calib-field">
          <label class="calib-lbl">Neck (cm)</label>
          <input type="number" step="0.5" class="calib-input" id="calib-neck" value="${p.neck}" placeholder="38">
        </div>
      </div>

      <div class="calib-field" id="calib-hip-field" style="${isFemale ? '' : 'display:none'}">
        <label class="calib-lbl">Hip Circumference (cm)</label>
        <input type="number" step="0.5" class="calib-input" id="calib-hip" value="${p.hip}" placeholder="95">
      </div>

      <div class="calib-field">
        <label class="calib-lbl">Physique Goal Architecture</label>
        <select class="calib-select" id="calib-goal">
          <option value="sixpack" ${p.goalType === 'sixpack' || p.goalType === 'cut' ? 'selected' : ''}>🔥 Cut (Calorie Deficit: TDEE - 400 kcal)</option>
          <option value="bulk" ${p.goalType === 'bulk' ? 'selected' : ''}>💪 Lean Bulk (Calorie Surplus: TDEE + 250 kcal, +0.25 kg/wk target)</option>
          <option value="recomp" ${p.goalType === 'recomp' ? 'selected' : ''}>⚡ Recomposition (Maintenance: TDEE)</option>
        </select>
      </div>

      <div class="calib-field">
        <label class="calib-lbl">Target Body Fat (%)</label>
        <input type="number" step="0.5" class="calib-input" id="calib-target-bf" value="${p.targetBf}" placeholder="11.0">
      </div>
    </div>

    <button class="btn" data-a="savecalibration">Save & Recalculate Roadmap 🚀</button>
  `);
}

function renderTransformationRoadmapCard() {
  const p = getPhysiqueState();
  const trans = getTransformationMetrics();

  const goalBadgeText = p.goalType === 'sixpack' || p.goalType === 'cut'
    ? `TARGET: CUT (${p.targetBf}% BF · DEFICIT)`
    : (p.goalType === 'bulk'
        ? `TARGET: LEAN BULK (${p.targetBf}% BF · +0.25kg/wk SURPLUS)`
        : `TARGET: RECOMPOSITION (${p.targetBf}% BF · MAINTENANCE)`);

  const circumference = 2 * Math.PI * 40; // 251.327
  const displayPct = trans.isGated ? p.progressPct : trans.milestonePct;
  const strokeOffset = circumference - (displayPct / 100) * circumference;

  const svgMorph = generateMorphSvg(p.gender, displayPct);

  return `
    <div class="roadmap-card">
      <div class="roadmap-header">
        <div class="roadmap-goal-badge">
          <span>🎯</span> ${esc(goalBadgeText)}
        </div>
        <button class="roadmap-calib-btn" data-a="opencalibration">🎯 Update Goal & Measurements</button>
      </div>

      <div class="roadmap-visual-box">
        <div class="roadmap-svg-wrap">
          ${svgMorph}
        </div>

        <div class="morph-slider-container">
          <div class="morph-slider-labels">
            <span class="slider-marker start">0% Start (${p.startBf}%)</span>
            <span class="slider-marker current" id="morph-curr-tag">Current: ${displayPct}%</span>
            <span class="slider-marker goal">100% Goal (${p.targetBf}%)</span>
          </div>
          <input type="range" min="0" max="100" step="0.5" value="${displayPct}" id="morph-scrub-input" class="morph-scrub-slider" data-a="morph-scrub">
          <div class="morph-slider-actions">
            <button class="chip morph-reset-btn" data-a="resetmorph" data-pct="${displayPct}">↺ Snap to Current (${displayPct}%)</button>
            <button class="chip" data-a="open-3d-physique" style="font-weight:700;margin-left:6px;">📐 3D Morph</button>
          </div>
        </div>
      </div>

      <div class="roadmap-gauge-card ${trans.isGated ? 'gated' : ''}">
        <div class="roadmap-gauge-ring-wrap">
          <svg class="roadmap-gauge-svg" viewBox="0 0 96 96">
            <defs>
              <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#0A84FF"/>
                <stop offset="100%" stop-color="#FF9F0A"/>
              </linearGradient>
            </defs>
            <circle class="roadmap-gauge-bg" cx="48" cy="48" r="40"/>
            <circle class="roadmap-gauge-fill" id="morph-progress-ring" cx="48" cy="48" r="40"
              stroke-dasharray="${circumference.toFixed(1)}"
              stroke-dashoffset="${trans.isGated ? circumference.toFixed(1) : strokeOffset.toFixed(1)}"
              style="${trans.isGated ? 'display:none;' : ''}"/>
          </svg>
          <div class="gauge-center-text">
            <div class="gauge-pct" id="morph-readout-num">${trans.isGated ? '🔒' : trans.milestonePct + '%'}</div>
            <div class="gauge-sub">MILESTONE</div>
          </div>
        </div>
        <div class="roadmap-milestone-box">
          <div class="roadmap-milestone-title">Transformation Milestone</div>
          <div class="roadmap-milestone-sub">
            ${trans.isGated
              ? `Requires at least 14 days of body history (${trans.totalDaysHistory}d logged). Derived from 7-day rolling averages of waist and weight rather than daily water fluctuations.`
              : `Milestone derived from 7-day rolling averages (${trans.avgWeight}kg, ${trans.avgWaist}cm). ~${p.weeksRemaining} wks remaining (~${p.workoutsRemaining} workouts).`
            }
          </div>
        </div>
      </div>

      <div class="fuel-blueprint-card">
        <div class="fuel-blueprint-header">
          <div class="fuel-title">🥗 Daily Fuel Blueprint</div>
          <div class="fuel-tag">${esc(p.goalTitle)} Targets</div>
        </div>
        <div class="fuel-grid">
          <div class="fuel-col">
            <div class="fuel-val">${p.macros.cals.toLocaleString()}</div>
            <div class="fuel-unit">kcal</div>
            <div class="fuel-lbl">Calories</div>
          </div>
          <div class="fuel-col">
            <div class="fuel-val">${p.macros.protein}g</div>
            <div class="fuel-unit">${p.macros.proteinRatio}g/kg</div>
            <div class="fuel-lbl">Protein</div>
          </div>
          <div class="fuel-col">
            <div class="fuel-val">${p.macros.carbs}g</div>
            <div class="fuel-unit">Carbs</div>
            <div class="fuel-lbl">Fuel</div>
          </div>
          <div class="fuel-col">
            <div class="fuel-val">${p.macros.fats}g</div>
            <div class="fuel-unit">Fats</div>
            <div class="fuel-lbl">Healthy Fats</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function getAchievementsData(logs = S.logs) {
  const totalVolume = logs.reduce((acc, l) => acc + vol(l), 0);
  const curStreak = streak();
  const totalLogs = logs.length;
  const hasPR = logs.some(l => l.ex && l.ex.some(x => x.sets && x.sets.some(s => s.isPR || s.pr)));

  return [
    {
      id: 'first_workout',
      title: 'First Workout Logged',
      icon: '🥇',
      desc: 'Complete and save your first training session',
      unlocked: totalLogs >= 1,
      progress: `${Math.min(1, totalLogs)}/1`
    },
    {
      id: 'consistency_streak',
      title: 'Consistency Streak (3 Days)',
      icon: '🔥',
      desc: 'Maintain a 3-day workout consistency streak',
      unlocked: curStreak >= 3,
      progress: `${curStreak}/3 days`
    },
    {
      id: 'tonnage_titan',
      title: 'Tonnage Titan (10,000 kg)',
      icon: '🏋️‍♂️',
      desc: 'Accumulate 10,000 kg in total training volume',
      unlocked: totalVolume >= 10000,
      progress: `${Math.round(totalVolume).toLocaleString()} / 10,000 kg`
    },
    {
      id: 'pr_crusher',
      title: 'PR Crusher',
      icon: '🏆',
      desc: 'Shatter personal records and push beyond limits',
      unlocked: hasPR || totalLogs >= 5,
      progress: hasPR || totalLogs >= 5 ? 'Unlocked' : `${totalLogs}/5 sessions`
    }
  ];
}

function renderAchievementsCard(logs = S.logs) {
  const items = getAchievementsData(logs);
  const unlockedCount = items.filter(x => x.unlocked).length;

  return `
    <div class="card achievements-card">
      <div class="row">
        <b>🏆 Achievements & Badges</b>
        <span class="today-chip" style="font-size:11px">${unlockedCount}/${items.length} Unlocked</span>
      </div>
      <div class="achievements-grid">
        ${items.map(a => `
          <div class="achievement-badge ${a.unlocked ? 'unlocked' : ''}">
            <div class="achievement-icon">${a.icon}</div>
            <div>
              <div class="achievement-title">${esc(a.title)}</div>
              <div class="achievement-desc">${esc(a.progress)} · ${a.unlocked ? 'Unlocked ✓' : 'Locked'}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ---- Daily Nutrition & Scientific Calorie Engine (v6.2.0) ----
function formatNutritionDateDisplay(dateKey) {
  const todayKey = (typeof Calc !== 'undefined' && Calc.toLocalDateKey)
    ? Calc.toLocalDateKey(new Date())
    : new Date().toISOString().slice(0, 10);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yestKey = (typeof Calc !== 'undefined' && Calc.toLocalDateKey)
    ? Calc.toLocalDateKey(yesterday)
    : yesterday.toISOString().slice(0, 10);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomKey = (typeof Calc !== 'undefined' && Calc.toLocalDateKey)
    ? Calc.toLocalDateKey(tomorrow)
    : tomorrow.toISOString().slice(0, 10);

  const [y, m, d] = dateKey.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const formatted = dateObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  if (dateKey === todayKey) return `Today · ${formatted}`;
  if (dateKey === yestKey) return `Yesterday · ${formatted}`;
  if (dateKey === tomKey) return `Tomorrow · ${formatted}`;
  return formatted;
}

function getNutritionData(dateKey = nutritionSelectedDate) {
  if (!S.nutrition || typeof S.nutrition !== 'object') {
    S.nutrition = {
      targetCals: 2100,
      targetProtein: 140,
      targetCarbs: 240,
      targetFat: 60,
      targetFiber: 35,
      meals: {}
    };
  }
  if (!S.nutrition.meals) S.nutrition.meals = {};
  if (!S.nutrition.meals[dateKey]) {
    S.nutrition.meals[dateKey] = {
      breakfast: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
      lunch: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
      dinner: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
      snacks: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    };
  }
  const dayMeals = S.nutrition.meals[dateKey];
  ['breakfast', 'lunch', 'dinner', 'snacks'].forEach(m => {
    if (!dayMeals[m]) {
      dayMeals[m] = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    }
  });

  const targetCals = Math.max(500, Number(S.nutrition.targetCals) || 2100);
  const targetProtein = Math.max(10, Number(S.nutrition.targetProtein) || 140);
  const targetCarbs = Math.max(10, Number(S.nutrition.targetCarbs) || 240);
  const targetFat = Math.max(10, Number(S.nutrition.targetFat) || 60);
  const targetFiber = Math.max(5, Number(S.nutrition.targetFiber) || 35);

  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  ['breakfast', 'lunch', 'dinner', 'snacks'].forEach(m => {
    const meal = dayMeals[m];
    totals.calories += Number(meal.calories) || 0;
    totals.protein += Number(meal.protein) || 0;
    totals.carbs += Number(meal.carbs) || 0;
    totals.fat += Number(meal.fat) || 0;
    totals.fiber += Number(meal.fiber) || 0;
  });
  totals.calories = Math.round(totals.calories);
  totals.protein = Math.round(totals.protein);
  totals.carbs = Math.round(totals.carbs);
  totals.fat = Math.round(totals.fat);
  totals.fiber = Math.round(totals.fiber);

  return {
    dateKey,
    dayMeals,
    targets: { targetCals, targetProtein, targetCarbs, targetFat, targetFiber },
    totals
  };
}

function changeNutritionDate(deltaDays) {
  const [y, m, d] = (nutritionSelectedDate || '').split('-').map(Number);
  const cur = (y && m && d) ? new Date(y, m - 1, d) : new Date();
  cur.setDate(cur.getDate() + deltaDays);
  nutritionSelectedDate = (typeof Calc !== 'undefined' && Calc.toLocalDateKey)
    ? Calc.toLocalDateKey(cur)
    : cur.toISOString().slice(0, 10);
  render();
}

function resetNutritionDateToToday() {
  nutritionSelectedDate = (typeof Calc !== 'undefined' && Calc.toLocalDateKey)
    ? Calc.toLocalDateKey(new Date())
    : new Date().toISOString().slice(0, 10);
  render();
}

function renderNutritionPreviewCard() {
  const todayKey = (typeof Calc !== 'undefined' && Calc.toLocalDateKey)
    ? Calc.toLocalDateKey(new Date())
    : new Date().toISOString().slice(0, 10);
  const data = getNutritionData(todayKey);
  const { targets, totals } = data;
  const pct = targets.targetCals > 0 ? Math.round((totals.calories / targets.targetCals) * 100) : 0;

  return `
    <div class="card" style="margin-bottom:14px;padding:12px 14px;cursor:pointer" data-a="body-subtab" data-tab="nutrition">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:22px">🥗</span>
          <div>
            <div style="font-weight:700;font-size:14px">Daily Nutrition & Macros</div>
            <div class="t2 sm" style="margin-top:2px">
              ${totals.calories} / ${targets.targetCals} kcal (${pct}%) · ${totals.protein}g Protein
            </div>
          </div>
        </div>
        <span class="chip" style="color:var(--ac);font-weight:600;font-size:12px">Track Food ›</span>
      </div>
    </div>
  `;
}

function renderNutritionDashboard() {
  const data = getNutritionData(nutritionSelectedDate);
  const { dateKey, dayMeals, targets, totals } = data;
  const todayKey = (typeof Calc !== 'undefined' && Calc.toLocalDateKey)
    ? Calc.toLocalDateKey(new Date())
    : new Date().toISOString().slice(0, 10);

  const ratio = targets.targetCals > 0 ? (totals.calories / targets.targetCals) : 0;
  let statusColor = 'var(--ac)';
  let statusBadge = '';

  if (ratio > 1.0) {
    statusColor = '#FF453A';
    statusBadge = `<span class="chip" style="color:#FF453A;background:rgba(255,69,58,0.15);font-weight:700">⚠️ Exceeded Limit (+${totals.calories - targets.targetCals} kcal)</span>`;
  } else if (ratio >= 0.95 && ratio <= 1.05) {
    statusColor = '#30D158';
    statusBadge = `<span class="chip" style="color:#30D158;background:rgba(48,209,88,0.15);font-weight:700">✓ Target Met (±5%)</span>`;
  } else {
    statusColor = 'var(--ac)';
    const remaining = Math.max(0, targets.targetCals - totals.calories);
    statusBadge = `<span class="chip" style="color:var(--ac);background:rgba(10,132,255,0.15);font-weight:700">${remaining} kcal remaining</span>`;
  }

  const fillPct = Math.min(100, Math.round(ratio * 100));

  const pPct = targets.targetProtein > 0 ? Math.min(100, Math.round((totals.protein / targets.targetProtein) * 100)) : 0;
  const cPct = targets.targetCarbs > 0 ? Math.min(100, Math.round((totals.carbs / targets.targetCarbs) * 100)) : 0;
  const fPct = targets.targetFat > 0 ? Math.min(100, Math.round((totals.fat / targets.targetFat) * 100)) : 0;
  const fibPct = targets.targetFiber > 0 ? Math.min(100, Math.round((totals.fiber / targets.targetFiber) * 100)) : 0;

  const mealDefs = [
    { key: 'breakfast', name: 'Breakfast', icon: '🍳' },
    { key: 'lunch', name: 'Lunch', icon: '🥗' },
    { key: 'dinner', name: 'Dinner', icon: '🍲' },
    { key: 'snacks', name: 'Snacks', icon: '🍎' }
  ];

  return `
    <div class="nutrition-dashboard">
      <!-- Day Switcher -->
      <div class="nutrition-day-switcher">
        <button class="chip" data-a="prev-nutrition-day" style="min-height:36px;min-width:44px">‹ Prev Day</button>
        <div style="text-align:center">
          <div class="nutrition-date-label">${formatNutritionDateDisplay(dateKey)}</div>
          ${dateKey !== todayKey ? `<button class="chip" data-a="today-nutrition-day" style="font-size:11px;min-height:22px;padding:2px 8px;margin-top:2px">Today</button>` : ''}
        </div>
        <button class="chip" data-a="next-nutrition-day" style="min-height:36px;min-width:44px">Next Day ›</button>
      </div>

      <!-- Main Calorie Visualizer with Circular Reactive Ring -->
      <div class="nutrition-calorie-card">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px">
          <div class="calorie-ring-wrap" style="position:relative;width:110px;height:110px;flex:0 0 110px;display:flex;align-items:center;justify-content:center">
            <svg class="calorie-ring-svg" viewBox="0 0 120 120" style="width:100%;height:100%;transform:rotate(-90deg)">
              <circle class="calorie-ring-bg" cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="10"></circle>
              <circle class="calorie-ring-fill" cx="60" cy="60" r="50" fill="none" stroke="${statusColor}" stroke-width="10" stroke-linecap="round" stroke-dasharray="314.16" stroke-dashoffset="${Math.max(0, 314.16 - (314.16 * Math.min(1, ratio)))}" style="transition:stroke-dashoffset 0.4s ease"></circle>
            </svg>
            <div class="calorie-ring-content" style="position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
              <span class="calorie-ring-val" style="font-size:18px;font-weight:800;color:${statusColor}">${totals.calories}</span>
              <span class="calorie-ring-lbl" style="font-size:10px;color:var(--t2)">kcal</span>
            </div>
          </div>

          <div style="flex:1;min-width:180px">
            <div class="nutrition-cals-header" style="margin-bottom:8px">
              <div>
                <span class="nutrition-cals-num" style="color:${statusColor};font-size:24px;font-weight:800">${totals.calories}</span>
                <span class="nutrition-cals-target" style="font-size:14px;color:var(--t2)">/ ${targets.targetCals} kcal</span>
              </div>
              <button class="chip" data-a="open-nutrition-targets" style="font-weight:600">🎯 Adjust</button>
            </div>

            <div class="nutrition-progress-track" style="margin-bottom:8px">
              <div class="nutrition-progress-bar" style="width:${fillPct}%;background:${statusColor}"></div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px">
              <span class="t2">${fillPct}% daily target</span>
              ${statusBadge}
            </div>
          </div>
        </div>
      </div>

      <!-- 4 Compact Macro Linear Progress Bars -->
      <div class="macro-grid">
        <div class="macro-card">
          <div class="macro-label-row">
            <span class="macro-label">Protein</span>
            <span class="macro-val">${totals.protein} / ${targets.targetProtein}g</span>
          </div>
          <div class="macro-track">
            <div class="macro-fill" style="width:${pPct}%;background:#FF9F0A"></div>
          </div>
        </div>

        <div class="macro-card">
          <div class="macro-label-row">
            <span class="macro-label">Carbs</span>
            <span class="macro-val">${totals.carbs} / ${targets.targetCarbs}g</span>
          </div>
          <div class="macro-track">
            <div class="macro-fill" style="width:${cPct}%;background:#0A84FF"></div>
          </div>
        </div>

        <div class="macro-card">
          <div class="macro-label-row">
            <span class="macro-label">Fat</span>
            <span class="macro-val">${totals.fat} / ${targets.targetFat}g</span>
          </div>
          <div class="macro-track">
            <div class="macro-fill" style="width:${fPct}%;background:#FF375F"></div>
          </div>
        </div>

        <div class="macro-card">
          <div class="macro-label-row">
            <span class="macro-label">Fiber</span>
            <span class="macro-val">${totals.fiber} / ${targets.targetFiber}g</span>
          </div>
          <div class="macro-track">
            <div class="macro-fill" style="width:${fibPct}%;background:#30D158"></div>
          </div>
        </div>
      </div>

      <!-- 4 Modular Meal Cards -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
        <h3 style="margin:0;font-size:16px;font-weight:700">Meals & Snacks</h3>
        <span class="t2 sm">Tap to quick-add or edit</span>
      </div>

      <div class="meal-cards-container">
        ${mealDefs.map(m => {
          const meal = dayMeals[m.key] || { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
          const hasFood = meal.calories > 0 || meal.protein > 0;
          return `
            <div class="meal-card" data-a="open-meal-modal" data-meal="${m.key}">
              <div class="meal-info">
                <div class="meal-title-row">
                  <span>${m.icon} ${esc(m.name)}</span>
                </div>
                <div class="meal-macros-row">
                  ${hasFood ? `P: ${meal.protein}g · C: ${meal.carbs}g · F: ${meal.fat}g · Fib: ${meal.fiber}g` : 'No food logged yet'}
                </div>
              </div>
              <div class="meal-cals-badge">
                <div class="meal-cals-val">${meal.calories} kcal</div>
                <span class="chip" style="font-size:11px;min-height:24px;padding:2px 8px">${hasFood ? '✏️ Edit' : '+ Add'}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function showMealModal(mealKey) {
  const dateKey = nutritionSelectedDate;
  const data = getNutritionData(dateKey);
  const meal = data.dayMeals[mealKey] || { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const mealNames = {
    breakfast: { title: 'Breakfast', icon: '🍳' },
    lunch: { title: 'Lunch', icon: '🥗' },
    dinner: { title: 'Dinner', icon: '🍲' },
    snacks: { title: 'Snacks', icon: '🍎' }
  };
  const mInfo = mealNames[mealKey] || { title: mealKey, icon: '🍽️' };

  modal(`
    <div class="confirm-sheet" style="text-align:left">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2 style="margin:0">${mInfo.icon} Log ${esc(mInfo.title)}</h2>
        <span class="chip">${formatNutritionDateDisplay(dateKey)}</span>
      </div>

      <div class="nutrition-input-group">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <label class="nutrition-input-label" for="meal-cals-input" style="margin:0">Calories (kcal)</label>
          <button class="chip" data-a="autocalc-meal-cals" style="font-size:11px;min-height:22px;padding:2px 8px">⚡ Auto-calc from Macros</button>
        </div>
        <input id="meal-cals-input" class="nutrition-input" type="number" inputmode="decimal" placeholder="e.g. 550" value="${meal.calories > 0 ? meal.calories : ''}">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="nutrition-input-group">
          <label class="nutrition-input-label" for="meal-protein-input">Protein (g)</label>
          <input id="meal-protein-input" class="nutrition-input" type="number" inputmode="decimal" placeholder="e.g. 40" value="${meal.protein > 0 ? meal.protein : ''}">
        </div>
        <div class="nutrition-input-group">
          <label class="nutrition-input-label" for="meal-carbs-input">Carbs (g)</label>
          <input id="meal-carbs-input" class="nutrition-input" type="number" inputmode="decimal" placeholder="e.g. 55" value="${meal.carbs > 0 ? meal.carbs : ''}">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="nutrition-input-group">
          <label class="nutrition-input-label" for="meal-fat-input">Fat (g)</label>
          <input id="meal-fat-input" class="nutrition-input" type="number" inputmode="decimal" placeholder="e.g. 15" value="${meal.fat > 0 ? meal.fat : ''}">
        </div>
        <div class="nutrition-input-group">
          <label class="nutrition-input-label" for="meal-fiber-input">Fiber (g)</label>
          <input id="meal-fiber-input" class="nutrition-input" type="number" inputmode="decimal" placeholder="e.g. 8" value="${meal.fiber > 0 ? meal.fiber : ''}">
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn" data-a="save-meal" data-meal="${esc(mealKey)}" style="flex:2">💾 Save Meal</button>
        ${meal.calories > 0 || meal.protein > 0 ? `<button class="btn s red" data-a="clear-meal" data-meal="${esc(mealKey)}" style="flex:1">🗑️ Clear</button>` : ''}
        <button class="btn s" data-a="closemodal" style="flex:1">Cancel</button>
      </div>
    </div>
  `);
}

function saveMealFromModal(mealKey) {
  const dateKey = nutritionSelectedDate;
  const calsEl = $('#meal-cals-input');
  const protEl = $('#meal-protein-input');
  const carbEl = $('#meal-carbs-input');
  const fatEl = $('#meal-fat-input');
  const fibEl = $('#meal-fiber-input');

  const p = Math.max(0, parseFloat(protEl?.value) || 0);
  const c = Math.max(0, parseFloat(carbEl?.value) || 0);
  const f = Math.max(0, parseFloat(fatEl?.value) || 0);
  const fib = Math.max(0, parseFloat(fibEl?.value) || 0);

  let cals = parseFloat(calsEl?.value);
  if (isNaN(cals) || cals <= 0) {
    if (p > 0 || c > 0 || f > 0) {
      cals = Math.round(p * 4 + c * 4 + f * 9);
    } else {
      cals = 0;
    }
  } else {
    cals = Math.round(cals);
  }

  if (!S.nutrition) S.nutrition = { targetCals: 2100, targetProtein: 140, targetCarbs: 240, targetFat: 60, targetFiber: 35, meals: {} };
  if (!S.nutrition.meals) S.nutrition.meals = {};
  if (!S.nutrition.meals[dateKey]) {
    S.nutrition.meals[dateKey] = {
      breakfast: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
      lunch: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
      dinner: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
      snacks: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    };
  }

  S.nutrition.meals[dateKey][mealKey] = {
    calories: cals,
    protein: Math.round(p * 10) / 10,
    carbs: Math.round(c * 10) / 10,
    fat: Math.round(f * 10) / 10,
    fiber: Math.round(fib * 10) / 10
  };

  save('nutrition', S.nutrition);
  closeModal();
  toast('Meal logged ✓');
  render();
}

function clearMealFromModal(mealKey) {
  const dateKey = nutritionSelectedDate;
  if (S.nutrition?.meals?.[dateKey]?.[mealKey]) {
    S.nutrition.meals[dateKey][mealKey] = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    save('nutrition', S.nutrition);
  }
  closeModal();
  toast('Meal cleared');
  render();
}

function autocalcMealCals() {
  const protEl = $('#meal-protein-input');
  const carbEl = $('#meal-carbs-input');
  const fatEl = $('#meal-fat-input');
  const calsEl = $('#meal-cals-input');

  const p = Math.max(0, parseFloat(protEl?.value) || 0);
  const c = Math.max(0, parseFloat(carbEl?.value) || 0);
  const f = Math.max(0, parseFloat(fatEl?.value) || 0);

  const estimated = Math.round(p * 4 + c * 4 + f * 9);
  if (calsEl) {
    calsEl.value = estimated > 0 ? estimated : '';
  }
}

function showNutritionTargetsModal() {
  if (!S.nutrition) S.nutrition = { targetCals: 2100, targetProtein: 140, targetCarbs: 240, targetFat: 60, targetFiber: 35, meals: {} };
  const n = S.nutrition;

  modal(`
    <div class="confirm-sheet" style="text-align:left">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2 style="margin:0">🎯 Daily Macro Targets</h2>
        <button class="x" data-a="closemodal">${ic('x', 20)}</button>
      </div>

      <div class="nutrition-input-group">
        <label class="nutrition-input-label" for="target-cals-input">Daily Calorie Target (kcal)</label>
        <input id="target-cals-input" class="nutrition-input" type="number" inputmode="decimal" value="${n.targetCals || 2100}">
      </div>

      <div style="display:flex;gap:6px;margin-bottom:14px">
        <button class="chip" data-a="preset-target-deficit" style="flex:1">Deficit (-20%)</button>
        <button class="chip" data-a="preset-target-maint" style="flex:1">Maintenance</button>
        <button class="chip" data-a="preset-target-surplus" style="flex:1">Surplus (+10%)</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="nutrition-input-group">
          <label class="nutrition-input-label" for="target-protein-input">Protein (g)</label>
          <input id="target-protein-input" class="nutrition-input" type="number" inputmode="decimal" value="${n.targetProtein || 140}">
        </div>
        <div class="nutrition-input-group">
          <label class="nutrition-input-label" for="target-carbs-input">Carbs (g)</label>
          <input id="target-carbs-input" class="nutrition-input" type="number" inputmode="decimal" value="${n.targetCarbs || 240}">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="nutrition-input-group">
          <label class="nutrition-input-label" for="target-fat-input">Fat (g)</label>
          <input id="target-fat-input" class="nutrition-input" type="number" inputmode="decimal" value="${n.targetFat || 60}">
        </div>
        <div class="nutrition-input-group">
          <label class="nutrition-input-label" for="target-fiber-input">Fiber (g)</label>
          <input id="target-fiber-input" class="nutrition-input" type="number" inputmode="decimal" value="${n.targetFiber || 35}">
        </div>
      </div>

      <button class="btn" data-a="save-nutrition-targets" style="margin-top:14px;width:100%">💾 Save Macro Targets</button>
    </div>
  `);
}

function saveNutritionTargetsFromModal() {
  const calsEl = $('#target-cals-input');
  const protEl = $('#target-protein-input');
  const carbEl = $('#target-carbs-input');
  const fatEl = $('#target-fat-input');
  const fibEl = $('#target-fiber-input');

  if (!S.nutrition) S.nutrition = { targetCals: 2100, targetProtein: 140, targetCarbs: 240, targetFat: 60, targetFiber: 35, meals: {} };
  S.nutrition.targetCals = Math.max(500, Math.min(10000, parseInt(calsEl?.value, 10) || 2100));
  S.nutrition.targetProtein = Math.max(10, Math.min(1000, parseInt(protEl?.value, 10) || 140));
  S.nutrition.targetCarbs = Math.max(0, Math.min(1500, parseInt(carbEl?.value, 10) || 240));
  S.nutrition.targetFat = Math.max(5, Math.min(500, parseInt(fatEl?.value, 10) || 60));
  S.nutrition.targetFiber = Math.max(5, Math.min(200, parseInt(fibEl?.value, 10) || 35));

  save('nutrition', S.nutrition);
  closeModal();
  toast('Macro targets saved ✓');
  render();
}

function applyMacroPreset(type) {
  let baseTdee = 2200;
  let weightKg = 75;
  if (typeof getPhysiqueState === 'function') {
    const p = getPhysiqueState();
    if (p.weight) weightKg = p.weight;
    if (Calc.calcTDEE && Calc.calcBMR) {
      const bmrRes = Calc.calcBMR(p.gender, p.weight, p.height, p.age);
      if (bmrRes && typeof bmrRes === 'object' && bmrRes.status === 'needs_profile') {
        toast('⚠️ Profile setup needed: please enter height, weight, and age in Profile');
        showPhysiqueCalibrationModal();
        return;
      }
      const bmr = typeof bmrRes === 'number' ? bmrRes : bmrRes?.bmr;
      const tdeeRes = Calc.calcTDEE(bmr, p.activityLevel);
      if (tdeeRes && typeof tdeeRes === 'object' && tdeeRes.status === 'needs_profile') {
        toast('⚠️ Profile setup needed: please enter height, weight, and age in Profile');
        showPhysiqueCalibrationModal();
        return;
      }
      baseTdee = typeof tdeeRes === 'number' ? tdeeRes : (tdeeRes?.tdee || 2200);
    }
  }

  let targetCals = baseTdee;
  if (type === 'deficit') targetCals = Math.round(baseTdee * 0.8);
  else if (type === 'surplus') targetCals = Math.round(baseTdee * 1.1);
  else targetCals = Math.round(baseTdee);

  let p = Math.round(weightKg * 2.0); // 2g per kg
  let f = Math.round((targetCals * 0.25) / 9); // 25% calories from fat
  let c = Math.max(0, Math.round((targetCals - (p * 4) - (f * 9)) / 4));
  let fib = Math.max(25, Math.round((targetCals / 1000) * 14)); // 14g fiber per 1000 kcal

  const calsEl = $('#target-cals-input');
  const protEl = $('#target-protein-input');
  const carbEl = $('#target-carbs-input');
  const fatEl = $('#target-fat-input');
  const fibEl = $('#target-fiber-input');

  if (calsEl) calsEl.value = targetCals;
  if (protEl) protEl.value = p;
  if (carbEl) carbEl.value = c;
  if (fatEl) fatEl.value = f;
  if (fibEl) fibEl.value = fib;
}

function vBody() {
  const p = getPhysiqueState();
  const subtabHeader = `
    <div class="segmented-control" style="margin:6px 0 14px">
      <button class="seg-btn ${bodySubTab === 'physique' ? 'active' : ''}" data-a="body-subtab" data-tab="physique">⚡ Physique & Roadmap</button>
      <button class="seg-btn ${bodySubTab === 'nutrition' ? 'active' : ''}" data-a="body-subtab" data-tab="nutrition">🥗 Daily Nutrition</button>
    </div>
  `;

  if (bodySubTab === 'nutrition') {
    return viewHeader('Body & Nutrition') + subtabHeader + renderNutritionDashboard();
  }

  const nutritionPreviewHtml = renderNutritionPreviewCard();
  const roadmapHtml = renderTransformationRoadmapCard();
  const sorted = [...S.weights].sort((a, b) => a.t - b.t);
  const weightsArr = sorted.filter(x => x.w != null && x.w > 0).map(x => x.w);
  const waistsArr = sorted.filter(x => x.waist != null && x.waist > 0).map(x => x.waist);

  const latestW = weightsArr.length ? weightsArr.at(-1) : null;
  const latestWaist = waistsArr.length ? waistsArr.at(-1) : null;

  const minW = weightsArr.length ? Math.min(...weightsArr) : 0;
  const maxW = weightsArr.length ? Math.max(...weightsArr) : 0;

  const minWaist = waistsArr.length ? Math.min(...waistsArr) : 0;
  const maxWaist = waistsArr.length ? Math.max(...waistsArr) : 0;

  const firstW = weightsArr.length ? weightsArr[0] : null;
  const firstWaist = waistsArr.length ? waistsArr[0] : null;

  const diffW = (latestW != null && firstW != null && weightsArr.length > 1) ? rd(latestW - firstW) : null;
  const diffWaist = (latestWaist != null && firstWaist != null && waistsArr.length > 1) ? rd(latestWaist - firstWaist) : null;
  const isBulk = p.goalType === 'bulk';

  const todayStr = new Date().toISOString().slice(0, 10);

  // Build SVG Chart
  let chartSvg = '';
  const W = 340, H = 180, pad = 28;

  if (bodyMetricView === 'weight') {
    const wEntries = sorted.filter(x => x.w != null && x.w > 0);
    if (wEntries.length >= 2) {
      const rangeW = (maxW - minW) || 1;
      const getX = (i, total) => pad + (i / (total - 1)) * (W - 2 * pad);
      const getY = val => H - pad - ((val - minW) / rangeW) * (H - 2 * pad);

      const points = wEntries.map((d, i) => `${getX(i, wEntries.length)},${getY(d.w)}`);
      const pathD = `M ` + points.join(' L ');
      const areaD = `${pathD} L ${getX(wEntries.length - 1, wEntries.length)},${H - pad} L ${pad},${H - pad} Z`;

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
          <text x="${pad}" y="${pad - 8}" fill="var(--t2)" font-size="10">${maxW.toFixed(1)} kg</text>
          <text x="${pad}" y="${H - pad + 16}" fill="var(--t2)" font-size="10">${minW.toFixed(1)} kg</text>
          <path d="${areaD}" fill="url(#wg)"/>
          <path d="${pathD}" fill="none" stroke="var(--ac)" stroke-width="2.5" stroke-linecap="round"/>
          ${wEntries.map((d, i) => `<circle cx="${getX(i, wEntries.length)}" cy="${getY(d.w)}" r="3.5" fill="#FFFFFF" stroke="var(--ac)" stroke-width="2"/>`).join('')}
        </svg>
      `;
    }
  } else if (bodyMetricView === 'waist') {
    const waistEntries = sorted.filter(x => x.waist != null && x.waist > 0);
    if (waistEntries.length >= 2) {
      const rangeWaist = (maxWaist - minWaist) || 1;
      const getX = (i, total) => pad + (i / (total - 1)) * (W - 2 * pad);
      const getY = val => H - pad - ((val - minWaist) / rangeWaist) * (H - 2 * pad);

      const points = waistEntries.map((d, i) => `${getX(i, waistEntries.length)},${getY(d.waist)}`);
      const pathD = `M ` + points.join(' L ');
      const areaD = `${pathD} L ${getX(waistEntries.length - 1, waistEntries.length)},${H - pad} L ${pad},${H - pad} Z`;

      chartSvg = `
        <svg class="svg-chart" viewBox="0 0 ${W} ${H}">
          <defs>
            <linearGradient id="waistg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#30D158" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="#30D158" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--bd)" stroke-width="1"/>
          <line x1="${pad}" y1="${pad}" x2="${W - pad}" y2="${pad}" stroke="var(--bd)" stroke-width="0.5" stroke-dasharray="4"/>
          <text x="${pad}" y="${pad - 8}" fill="var(--t2)" font-size="10">${maxWaist.toFixed(1)} cm</text>
          <text x="${pad}" y="${H - pad + 16}" fill="var(--t2)" font-size="10">${minWaist.toFixed(1)} cm</text>
          <path d="${areaD}" fill="url(#waistg)"/>
          <path d="${pathD}" fill="none" stroke="var(--gn)" stroke-width="2.5" stroke-linecap="round"/>
          ${waistEntries.map((d, i) => `<circle cx="${getX(i, waistEntries.length)}" cy="${getY(d.waist)}" r="3.5" fill="#FFFFFF" stroke="var(--gn)" stroke-width="2"/>`).join('')}
        </svg>
      `;
    }
  } else {
    // Both Overlay View
    if (sorted.length >= 2) {
      const rangeW = (maxW - minW) || 1;
      const rangeWaist = (maxWaist - minWaist) || 1;
      const getX = (i, total) => pad + (i / (total - 1)) * (W - 2 * pad);

      const wPoints = [];
      const waistPoints = [];

      sorted.forEach((d, i) => {
        const x = getX(i, sorted.length);
        if (d.w != null && d.w > 0) {
          const y = H - pad - ((d.w - minW) / rangeW) * (H - 2 * pad);
          wPoints.push({ x, y, val: d.w });
        }
        if (d.waist != null && d.waist > 0) {
          const y = H - pad - ((d.waist - minWaist) / rangeWaist) * (H - 2 * pad);
          waistPoints.push({ x, y, val: d.waist });
        }
      });

      const wPath = wPoints.length >= 2 ? `M ` + wPoints.map(p => `${p.x},${p.y}`).join(' L ') : '';
      const waistPath = waistPoints.length >= 2 ? `M ` + waistPoints.map(p => `${p.x},${p.y}`).join(' L ') : '';

      chartSvg = `
        <svg class="svg-chart" viewBox="0 0 ${W} ${H}">
          <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--bd)" stroke-width="1"/>
          <line x1="${pad}" y1="${pad}" x2="${W - pad}" y2="${pad}" stroke="var(--bd)" stroke-width="0.5" stroke-dasharray="4"/>
          <text x="${pad}" y="${pad - 8}" fill="var(--ac)" font-size="10">Weight: ${maxW ? maxW.toFixed(1) + 'kg' : ''}</text>
          <text x="${W - pad}" y="${pad - 8}" fill="var(--gn)" font-size="10" text-anchor="end">Waist: ${maxWaist ? maxWaist.toFixed(1) + 'cm' : ''}</text>
          ${wPath ? `<path d="${wPath}" fill="none" stroke="var(--ac)" stroke-width="2.5" stroke-linecap="round"/>` : ''}
          ${waistPath ? `<path d="${waistPath}" fill="none" stroke="var(--gn)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="3 3"/>` : ''}
          ${wPoints.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#FFFFFF" stroke="var(--ac)" stroke-width="2"/>`).join('')}
          ${waistPoints.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#FFFFFF" stroke="var(--gn)" stroke-width="2"/>`).join('')}
        </svg>
      `;
    }
  }

  const netWeightClass = diffW != null ? (isBulk ? (diffW > 0 ? 'text-green' : (diffW < 0 ? 'text-orange' : '')) : (diffW < 0 ? 'text-green' : (diffW > 0 ? 'text-orange' : ''))) : '';

  const weeklyFreqs = (typeof Calc !== 'undefined' && Calc.calcWeeklyMuscleFrequency)
    ? Calc.calcWeeklyMuscleFrequency(S.logs, Date.now(), S.cfg?.weekStartDay || 'mon', {}, X)
    : calcWeeklyMuscleFrequency(S.logs);

  return viewHeader('Body & Nutrition') +
    subtabHeader +
    nutritionPreviewHtml +
    roadmapHtml +
    renderAchievementsCard(S.logs) +
    renderWeeklyMuscleFrequencyCard(S.logs) +
    renderVolumeRadarChart(weeklyFreqs) +
    `<h2>Measurement Trends</h2>` +
    `<div class="stat-grid">` +
      `<div class="stat-box"><div class="stat-val">${latestW != null ? latestW.toFixed(1) + ' kg' : '--'}</div><div class="stat-lbl">Weight</div></div>` +
      `<div class="stat-box"><div class="stat-val">${latestWaist != null ? latestWaist.toFixed(1) + ' cm' : '--'}</div><div class="stat-lbl">Waist</div></div>` +
      `<div class="stat-box"><div class="stat-val ${netWeightClass}">${diffW != null ? (diffW > 0 ? '+' + diffW : diffW) + ' kg' : '--'}</div><div class="stat-lbl">Net Weight</div></div>` +
      `<div class="stat-box"><div class="stat-val">${diffWaist != null ? (diffWaist > 0 ? '+' + diffWaist : diffWaist) + ' cm' : '--'}</div><div class="stat-lbl">Net Waist</div></div>` +
    `</div>` +
    `<div class="card">` +
      `<div class="row"><b>Trend Chart</b></div>` +
      `<div class="chips chart-toggle-chips">` +
        `<button class="chip ${bodyMetricView === 'both' ? 'on' : ''}" data-a="setwv" data-v="both">Both (Overlay)</button>` +
        `<button class="chip ${bodyMetricView === 'weight' ? 'on' : ''}" data-a="setwv" data-v="weight">Weight (kg)</button>` +
        `<button class="chip ${bodyMetricView === 'waist' ? 'on' : ''}" data-a="setwv" data-v="waist">Waist (cm)</button>` +
      `</div>` +
      `<div class="dual-chart-legend">` +
        `<span class="legend-item"><span class="legend-dot w"></span> Weight (${latestW != null ? latestW.toFixed(1) + ' kg' : '--'})</span>` +
        `<span class="legend-item"><span class="legend-dot waist"></span> Waist (${latestWaist != null ? latestWaist.toFixed(1) + ' cm' : '--'})</span>` +
      `</div>` +
      (chartSvg || '<p class="t2 sm" style="margin:20px 0;text-align:center">Log at least 2 entries to display trend chart.</p>') +
    `</div>` +
    `<h2>Log Measurements</h2>` +
    `<div class="card">` +
      `<div class="meas-inputs" style="display:grid;grid-template-columns:repeat(2, 1fr);gap:8px">` +
        `<input type="number" step="0.1" inputmode="decimal" id="wt-input" placeholder="Weight (kg)">` +
        `<input type="number" step="0.5" inputmode="decimal" id="waist-input" placeholder="Waist (cm)">` +
        `<input type="number" step="0.5" inputmode="decimal" id="neck-input" placeholder="Neck (cm)">` +
        `<input type="number" step="0.5" inputmode="decimal" id="chest-input" placeholder="Chest (cm)">` +
        `<input type="number" step="0.5" inputmode="decimal" id="arms-input" placeholder="Arms (cm)">` +
        `<input type="number" step="0.5" inputmode="decimal" id="hips-input" placeholder="Hips (cm)">` +
      `</div>` +
      `<div class="row" style="margin-top:8px">` +
        `<input type="date" id="wt-date" value="${esc(todayStr)}" style="flex:1">` +
        `<button class="btn" data-a="logweight" style="width:auto;flex:1;margin:0">Save Entry</button>` +
      `</div>` +
    `</div>` +
    `<h2>Progress Photos 📸</h2>` +
    `<div class="card" style="padding:14px">` +
      `<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px">` +
        `<div class="t2 sm">Stored locally on your device in offline storage.</div>` +
        `<label class="btn s sm-btn" style="cursor:pointer;margin:0">` +
          `📷 Add Photo` +
          `<input type="file" id="progress-photo-picker" accept="image/*" style="display:none">` +
        `</label>` +
      `</div>` +
      `<div id="progress-photos-gallery" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(80px, 1fr));gap:8px">` +
        `${(S.photos || []).map((ph, idx) => `
          <div style="position:relative;border-radius:8px;overflow:hidden;aspect-ratio:1;background:var(--c2)">
            <img src="${esc(ph.data)}" alt="Progress ${esc(ph.date)}" style="width:100%;height:100%;object-fit:cover">
            <button class="chip" data-a="delphoto" data-idx="${idx}" style="position:absolute;top:2px;right:2px;padding:1px 4px;font-size:9px;background:rgba(0,0,0,0.6);color:#fff">✕</button>
          </div>
        `).join('')}` +
        `${!(S.photos && S.photos.length) ? '<div class="t2 sm" style="grid-column:1/-1;text-align:center;padding:12px 0">No progress photos saved yet.</div>' : ''}` +
      `</div>` +
    `</div>` +
    `<h2>Measurement History</h2>` +
    `<div class="card" style="padding:0 14px">` +
      (sorted.length ? [...sorted].reverse().map((item, idx, arr) => {
        const prev = arr[idx + 1];
        let diffWHtml = '';
        if (prev && item.w != null && prev.w != null) {
          const d = rd(item.w - prev.w);
          if (d > 0) diffWHtml = `<span class="diff-tag up ${isBulk ? 'bulk-pos' : ''}">+${d} kg</span>`;
          else if (d < 0) diffWHtml = `<span class="diff-tag down ${isBulk ? 'bulk-neg' : ''}">${d} kg</span>`;
          else diffWHtml = `<span class="diff-tag same">0 kg</span>`;
        }
        let diffWaistHtml = '';
        if (prev && item.waist != null && prev.waist != null) {
          const d = rd(item.waist - prev.waist);
          if (d > 0) diffWaistHtml = `<span class="diff-tag up">+${d} cm</span>`;
          else if (d < 0) diffWaistHtml = `<span class="diff-tag down">${d} cm</span>`;
          else diffWaistHtml = `<span class="diff-tag same">0 cm</span>`;
        }

        return `
          <div class="weight-row">
            <div>
              <div class="weight-val">
                ${item.w != null ? `${Number(item.w).toFixed(1)} kg` : ''}
                ${item.w != null && item.waist != null ? ' · ' : ''}
                ${item.waist != null ? `<span style="color:var(--gn)">${Number(item.waist).toFixed(1)} cm</span>` : ''}
              </div>
              <div class="t2 sm">${esc(item.date)}</div>
            </div>
            <div class="row" style="gap:6px">
              ${diffWHtml}
              ${diffWaistHtml}
              <button class="x" data-a="delweight" data-id="${esc(item.id)}">${ic('trash', 18)}</button>
            </div>
          </div>
        `;
      }).join('') : '<p class="t2 sm" style="padding:14px 0">No measurement entries logged yet.</p>') +
    `</div>`;
}

const vWeight = vBody;

// 6. History View (Strictly Dedicated to Past Workout Logs)
const vHist = () => {
  if ((!EXDB || EXDB.length === 0) && typeof loadExercises === 'function') {
    if (_global.__EXDB__ && _global.__EXDB__.length > 0) {
      EXDB = _global.__EXDB__;
      EXIDX = _global.__EXIDX__;
    } else {
      loadExercises().then(() => { if (view === 'hist') render(); }).catch(() => {});
    }
  }
  const q = (histQuery || '').trim().toLowerCase();
  const uniqueRoutines = ['All', ...new Set(S.logs.map(l => l.name).filter(Boolean))];

  const filteredLogs = [...S.logs].reverse().filter(l => {
    if (histRoutine !== 'All' && l.name !== histRoutine) return false;
    if (q) {
      const matchName = (l.name || '').toLowerCase().includes(q);
      const matchDate = new Date(l.date).toLocaleDateString().toLowerCase().includes(q);
      const matchEx = (l.ex || []).some(x => X(x.id).name.toLowerCase().includes(q));
      return matchName || matchDate || matchEx;
    }
    return true;
  });

  return viewHeader('History') +
    (S.logs.length ? `
      <input id="hist-search-input" class="txt" placeholder="Search past workouts or exercises..." data-f="histsearch" value="${esc(histQuery)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" style="margin-bottom:8px">
      ${uniqueRoutines.length > 2 ? `
        <div class="chips" style="margin:4px 0 12px">
          ${uniqueRoutines.map(r => `<button class="chip ${histRoutine === r ? 'on' : ''}" data-a="histroutine" data-r="${esc(r)}">${esc(r)}</button>`).join('')}
        </div>
      ` : ''}
      <div class="row" style="margin-bottom:8px">
        <span class="t2 sm">${filteredLogs.length} ${filteredLogs.length === 1 ? 'workout' : 'workouts'} logged</span>
        ${q || histRoutine !== 'All' ? `<button class="chip" data-a="clearhistfilter" style="font-size:11px;min-height:28px;padding:0 8px">Clear Filter</button>` : ''}
      </div>
      ${filteredLogs.length ? filteredLogs.map(l => {
        const dateStr = new Date(l.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        const durMin = Math.round(l.dur / 60000);
        const volume = vol(l);
        return `
          <button class="card" data-a="hist" data-id="${esc(l.id)}" style="margin-bottom:10px">
            <div class="row">
              <b>${esc(l.name)}</b>
              <span class="t2 sm">${dateStr}</span>
            </div>
            <div class="t2 sm" style="margin-top:4px">
              ⏱️ ${durMin} min · 📦 ${volume} kg volume · 🏋️ ${l.ex.length} exercises${l.burn?.totalBurn ? ` · 🔥 ${l.burn.totalBurn} kcal` : ''}
            </div>
            <div class="routine-summary-list" style="margin-top:8px">
              ${l.ex.slice(0, 3).map(x => `
                <div class="routine-summary-row" style="pointer-events:none">
                  <span class="routine-summary-name">${esc(X(x.id).name)}</span>
                  <span class="routine-summary-badge">${x.sets.length} sets</span>
                </div>
              `).join('')}
              ${l.ex.length > 3 ? `<span class="t2 sm" style="margin-top:2px;display:block">+${l.ex.length - 3} more exercises</span>` : ''}
            </div>
          </button>
        `;
      }).join('') : `<p class="t2 sm" style="text-align:center;padding:24px 0">No workouts match your search.</p>`}
    ` : `
      <div class="card empty-state-card">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-title">No workouts logged yet</div>
        <p class="t2 sm">Every journey begins with a single rep. Complete your first workout to view your logs, PRs, and volume progression.</p>
        <button class="btn" data-a="tab" data-k="train" style="margin-top:14px">Start Workout 🚀</button>
      </div>
    `);
};

function render() {
  // If EXDB is empty or undefined, sync from singleton or trigger loadExercises() immediately before painting DOM
  if ((!EXDB || EXDB.length === 0) && typeof loadExercises === 'function') {
    if (_global.__EXDB__ && _global.__EXDB__.length > 0) {
      EXDB = _global.__EXDB__;
      EXIDX = _global.__EXIDX__;
    } else {
      loadExercises().then(() => {
        const activeContainer = $('#v');
        if (activeContainer) render();
      }).catch(err => console.warn('loadExercises trigger in render failed:', err));
    }
  }

  const v = $('#v');
  if (!v) return;
  const y = v.scrollTop;
  const oldStepper = document.querySelector('.work-stepper-pills');
  const savedStepperScroll = oldStepper ? oldStepper.scrollLeft : null;

  v.innerHTML = ({
    train: vTrain,
    work: vWork,
    lib: vLib,
    cal: vCal,
    weight: vBody,
    body: vBody,
    hist: vHist
  })[view]();
  v.scrollTop = y;

  const newStepper = document.querySelector('.work-stepper-pills');
  if (newStepper) {
    if (savedStepperScroll != null && savedStepperScroll > 0) {
      newStepper.scrollLeft = savedStepperScroll;
    }
    const activePill = newStepper.querySelector('.work-step-pill.active');
    if (activePill) {
      activePill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  $('#tabs').innerHTML = [
    ['train', 'act', 'Train'],
    ['lib', 'list', 'Library'],
    ['cal', 'cal', 'Calendar'],
    ['weight', 'weight', 'Body'],
    ['hist', 'clock', 'History']
  ].map(([k, i, t]) => `<button data-a="tab" data-k="${k}" class="${view === k || (view === 'work' && k === 'train') ? 'on' : ''}">${ic(i)}<span>${t}</span></button>`).join('');
}

// ---- Science Jargon Micro-Sheets ----
function showJargonSheet(term) {
  const glossary = {
    rir: {
      title: 'RIR (Reps in Reserve)',
      badge: 'Intensity Metric',
      desc: 'Reps in Reserve (RIR) indicates how many more clean repetitions you could have performed before reaching muscular failure.',
      bullets: [
        '<b>RIR 0:</b> Muscular failure. Zero additional reps possible. Highest fatigue and neurological strain.',
        '<b>RIR 1–2:</b> The Hypertrophy Sweet Spot. Stimulates full motor unit recruitment while ensuring sustainable systemic recovery.',
        '<b>RIR 3+:</b> Sub-maximal intensity. Best suited for warm-up sets, technique priming, or active deload phases.'
      ]
    },
    'double-progression': {
      title: 'Double Progression',
      badge: 'Progression Protocol',
      desc: 'A gold-standard evidence-based progression system where you progress volume (repetitions) before advancing load (weight).',
      bullets: [
        '<b>Phase 1 (Volume):</b> Pick a rep bracket (e.g. 8–12 reps). Keep weight constant and build repetitions across all sets.',
        '<b>Phase 2 (Milestone):</b> When you successfully hit the upper rep ceiling (e.g. 12 reps) on ALL prescribed sets...',
        '<b>Phase 3 (Load):</b> Increase weight (+2.5 kg) and reset repetitions back to the lower floor (8 reps).'
      ]
    },
    volume: {
      title: 'MEV / MAV / MRV Volume Landmarks',
      badge: 'Hypertrophy Landmarks',
      desc: 'Scientific landmarks for weekly working set volume per muscle group (Renaissance Periodization):',
      bullets: [
        '<b>MEV (Minimum Effective Volume):</b> ~6–10 weekly sets. Minimum workload required to stimulate noticeable muscular adaptations.',
        '<b>MAV (Maximum Adaptive Volume):</b> ~12–18 weekly sets. The optimal zone where you achieve the highest rate of muscle hypertrophy.',
        '<b>MRV (Maximum Recoverable Volume):</b> ~20–25+ weekly sets. Volume ceiling beyond which fatigue accumulates faster than recovery, causing negative returns.'
      ]
    },
    acwr: {
      title: 'ACWR (Acute:Chronic Workload Ratio)',
      badge: 'Fatigue & Recovery Engine',
      desc: 'Compares your acute fatigue (past 7 days volume) against your chronic capacity baseline (rolling 28 days volume).',
      bullets: [
        '<b>0.8 – 1.3 (Sweet Spot):</b> Optimal training stimulus with minimal risk of overtraining or soft-tissue injury.',
        '<b>1.3 – 1.5 (Elevated Fatigue):</b> Training load is ramping quickly. Monitor sleep, nutrition, and joint fatigue closely.',
        '<b>&gt; 1.5 (Danger Spike):</b> Rapid unmanaged volume spike. Triggers automatic deload recommendations to prevent systemic overtraining.'
      ]
    }
  };

  const item = glossary[term] || glossary.rir;
  modal(`
    <div class="jargon-sheet">
      <div class="jargon-sheet-badge">${esc(item.badge)}</div>
      <h2 style="margin:6px 0 10px">${esc(item.title)}</h2>
      <p class="t2" style="font-size:14px;line-height:1.5;margin-bottom:14px">${esc(item.desc)}</p>
      <div class="jargon-bullets">
        ${item.bullets.map(b => `<div class="jargon-bullet-item">${b}</div>`).join('')}
      </div>
      <button class="btn s" data-a="closemodal" style="margin-top:16px;width:100%">Got It 👍</button>
    </div>
  `);
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
    ${renderExerciseProgressionChart(ex.id)}
    ${ex.st && ex.st.length ? `<b>Instructions:</b><ol class="ex-steps">${ex.st.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${S.act ? `<button class="btn" data-a="addextoworkout" data-id="${esc(ex.id)}">Add to Active Workout</button>` : ''}
  `);
}

// ---- Exercise Picker Modal & Inspection Preview ----
let currentPickerTitle = 'Add Exercise';

const renderPickResults = () => {
  const q = (pickQuery || '').trim().toLowerCase();
  const filtered = EXDB.filter(e => {
    if (pickCategory !== 'All' && e.g !== pickCategory) return false;
    if (pickCategory !== 'All' && pickSubCategory !== 'All' && !matchesSubMuscle(e, pickCategory, pickSubCategory)) return false;
    if (q) {
      return matchesExerciseSearch(e, q);
    }
    return true;
  }).slice(0, 50);

  if (!filtered.length) {
    if (q) {
      return `
        <div class="empty-search-card">
          <div style="font-size:32px;margin-bottom:8px">🔍</div>
          <div style="font-weight:700;font-size:15px;margin-bottom:4px">No exercise found for "${esc(pickQuery.trim())}"</div>
          <p class="t2 sm" style="margin-bottom:14px">Create this exercise now and add it to your selection.</p>
          <button class="btn sm-btn" data-a="opencustomex" data-name="${esc(pickQuery.trim())}">+ Create "${esc(pickQuery.trim())}" as Custom Exercise</button>
        </div>
      `;
    }
    return '<p class="t2" style="padding:24px;text-align:center">No exercises found</p>';
  }

  return filtered.map(e => `
    <div class="ex-row pick-ex-row" data-id="${esc(e.id)}">
      <div class="ex-row-tap-preview" data-a="pickpreview" data-id="${esc(e.id)}">
        <img class="ex-thumb" src="./media/${esc(e.img || e.gif)}" alt="${esc(e.name)}" loading="lazy" onerror="this.style.display='none'">
        <div class="ex-info">
          <div class="ex-name">${esc(e.name)}</div>
          <div class="ex-meta">${esc(e.tg || e.g)} · ${esc(e.eq)}</div>
        </div>
      </div>
      <div class="ex-row-actions">
        <button class="chip ex-preview-btn" data-a="pickpreview" data-id="${esc(e.id)}" title="Preview Exercise">ℹ️ Preview</button>
        <button class="chip on ex-add-btn" data-a="pick" data-id="${esc(e.id)}" title="Add Exercise">+ Add</button>
      </div>
    </div>
  `).join('');
};

function showExercisePicker(title = 'Add Exercise') {
  currentPickerTitle = title;
  pickQuery = '';
  pickCategory = 'All';
  pickSubCategory = 'All';
  modal(`<h2>${esc(title)}</h2>
    <input id="pick-search-input" class="txt" placeholder="Search 1,300+ exercises..." data-f="picksearch" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
    <button class="btn s sm-btn" data-a="opencustomex" style="width:100%;margin-bottom:10px">+ Create Custom Exercise</button>
    <div class="chips" style="margin-bottom:8px">
      ${BP_CATEGORIES.map(c => `<button class="chip ${pickCategory === c ? 'on' : ''}" data-a="pickcat" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>
    <div id="pick-sub-chips-wrap">${renderPickSubPills()}</div>
    <div id="pick-list" class="card" style="max-height:55vh;overflow-y:auto;padding:0 12px">
      ${renderPickResults()}
    </div>
  `);
}

function showExercisePickerPreview(id) {
  const ex = X(id);
  if (!ex) return;

  let actionLabel = '+ Add to Workout';
  const titleLower = (currentPickerTitle || '').toLowerCase();
  if (titleLower.includes('routine')) {
    actionLabel = '+ Add to Routine';
  } else if (titleLower.includes('superset') || titleLower.includes('add as') || titleLower.includes('a2') || titleLower.includes('a3')) {
    actionLabel = '+ Add to Superset';
  } else if (S.act) {
    actionLabel = '+ Add to Workout';
  } else {
    actionLabel = '+ Add to Routine';
  }

  const mediaSrc = `./media/${esc(ex.gif || ex.img)}`;
  const secMuscles = ex.sec && ex.sec.length ? ex.sec.join(', ') : '';

  modal(`
    <div class="picker-preview-sheet">
      <div class="picker-preview-header">
        <h2 class="picker-preview-title">${esc(ex.name)}</h2>
        <div class="picker-preview-badges">
          <span class="ex-badge ac">${esc(ex.g)}</span>
          <span class="ex-badge">${esc(ex.eq)}</span>
          ${ex.tg ? `<span class="ex-badge tg">Target: ${esc(ex.tg)}</span>` : ''}
        </div>
        ${secMuscles ? `<div class="picker-preview-secondary t2 sm" style="margin-top:6px">Secondary: <b>${esc(secMuscles)}</b></div>` : ''}
      </div>

      <div class="picker-preview-media">
        <img class="picker-preview-gif" src="${mediaSrc}" alt="${esc(ex.name)}" onerror="this.style.display='none'">
      </div>

      <div class="picker-preview-cues-card card">
        <div class="picker-preview-cues-title">Step-by-Step Form Execution Cues</div>
        ${ex.st && ex.st.length ? `
          <ol class="ex-steps picker-preview-steps">
            ${ex.st.map(s => `<li>${esc(s)}</li>`).join('')}
          </ol>
        ` : `
          <p class="t2 sm" style="font-style:italic;margin:6px 0">Maintain core brace, smooth eccentric control, and full active range of motion.</p>
        `}
      </div>

      <div class="picker-preview-actions">
        <button class="btn btn-primary picker-preview-add-btn" data-a="pick" data-id="${esc(ex.id)}">${actionLabel}</button>
        <button class="btn s outline picker-preview-back-btn" data-a="backtopicker">← Back to Exercise Picker</button>
      </div>
    </div>
  `);
}

// ---- In-Session Exercise Swap Modal ----
const renderSwapResults = () => {
  const curEx = S.act?.ex[swapIdx];
  if (!curEx) return '<p class="t2" style="padding:16px;text-align:center">No active exercise</p>';
  const curInfo = X(curEx.id);
  const q = (swapQuery || '').trim().toLowerCase();

  const filtered = EXDB.filter(e => {
    if (String(e.id) === String(curEx.id)) return false;
    if (swapCategory !== 'All' && e.g !== swapCategory) return false;
    if (q) {
      return e.name.toLowerCase().includes(q) || e.tg.toLowerCase().includes(q) || e.eq.toLowerCase().includes(q);
    }
    return true;
  });

  // Sort: prioritize exercises that share the same target muscle group
  filtered.sort((a, b) => {
    const aMatch = a.tg && curInfo.tg && a.tg.toLowerCase() === curInfo.tg.toLowerCase() ? 1 : 0;
    const bMatch = b.tg && curInfo.tg && b.tg.toLowerCase() === curInfo.tg.toLowerCase() ? 1 : 0;
    return bMatch - aMatch;
  });

  const visible = filtered.slice(0, 40);

  if (!visible.length) {
    return '<p class="t2" style="padding:24px;text-align:center">No alternative exercises found</p>';
  }

  return visible.map(e => {
    const sameTg = e.tg && curInfo.tg && e.tg.toLowerCase() === curInfo.tg.toLowerCase();
    return `
      <div class="swap-row" data-a="doswap" data-id="${esc(e.id)}">
        <img class="ex-thumb" src="./media/${esc(e.img || e.gif)}" alt="${esc(e.name)}" loading="lazy" onerror="this.style.display='none'">
        <div style="flex:1;min-width:0">
          <div class="ex-name" style="display:flex;align-items:center;flex-wrap:wrap">
            <span>${esc(e.name)}</span>
            ${sameTg ? '<span class="swap-badge-match">Same Target</span>' : ''}
          </div>
          <div class="ex-meta">${esc(e.tg || e.g)} · ${esc(e.eq)}</div>
        </div>
        <button class="chip on" style="pointer-events:none">Swap ⇄</button>
      </div>
    `;
  }).join('');
};

function showSwapModal(idx) {
  if (!S.act || !S.act.ex[idx]) return;
  swapIdx = idx;
  const curEx = S.act.ex[idx];
  const exInfo = X(curEx.id);
  swapCategory = exInfo.g;
  swapQuery = '';

  const r = S.act.rid ? S.routines.find(r => r.id === S.act.rid) : null;

  modal(`
    <h2>⇄ Swap "${esc(exInfo.name)}"</h2>
    <p class="t2 sm" style="margin-top:-6px;margin-bottom:12px">Choose a replacement movement for this session.</p>
    ${r ? `
      <label class="swap-perm-box">
        <span class="sm">
          <b>Update routine permanently</b><br>
          <span class="t2">Replaces in "${esc(r.name)}" for future workouts</span>
        </span>
        <input type="checkbox" id="swap-perm-check">
      </label>
    ` : ''}
    <input id="swap-search-input" class="txt" placeholder="Search 1,300+ replacements..." data-f="swapsearch" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
    <div class="chips" style="margin-bottom:8px">
      ${BP_CATEGORIES.map(c => `<button class="chip ${swapCategory === c ? 'on' : ''}" data-a="swapcat" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>
    <div id="swap-list" class="card" style="max-height:50vh;overflow-y:auto;padding:0 12px">
      ${renderSwapResults()}
    </div>
  `);
}

// ---- Routine Editor Form Synchronizer ----
function syncEFromForm() {
  if (!E) return;
  const nameInp = document.querySelector('input[data-e="name"]');
  if (nameInp) E.name = nameInp.value;
  if (!E.ex) return;
  E.ex.forEach((x, i) => {
    const sInp = document.querySelector(`input[data-e="sets"][data-i="${i}"]`);
    const rInp = document.querySelector(`input[data-e="reps"][data-i="${i}"]`);
    const r2Inp = document.querySelector(`input[data-e="reps2"][data-i="${i}"]`);
    const wInp = document.querySelector(`input[data-e="w"][data-i="${i}"]`);
    const incInp = document.querySelector(`input[data-e="inc"][data-i="${i}"]`);
    const pSel = document.querySelector(`select[data-e="prog"][data-i="${i}"]`);
    const noteInp = document.querySelector(`input[data-e="note"][data-i="${i}"]`);

    if (sInp) x.sets = parseInt(sInp.value, 10) || x.sets;
    if (rInp) x.reps = parseInt(rInp.value, 10) || x.reps;
    if (r2Inp) x.reps2 = parseInt(r2Inp.value, 10) || x.reps2;
    if (wInp) x.w = Math.max(0, parseFloat(wInp.value) || 0);
    if (incInp) x.inc = Math.max(0.25, parseFloat(incInp.value) || 2.5);
    if (pSel) x.prog = pSel.value;
    if (noteInp) x.note = noteInp.value;
  });
}

// ---- Routine Editor ----
function showE() {
  modal(`<h2>${E.isNew ? 'New' : 'Edit'} routine</h2>
    <input class="txt" data-e="name" placeholder="Routine name (e.g. Upper Body)" value="${esc(E.name)}">
    <div style="margin:12px 0 6px" class="t2 sm"><b>Exercises in Routine (${E.ex.length}):</b></div>` +
    (E.ex.length ? E.ex.map((x, i) => {
      const ex = X(x.id);
      return `<div class="card routine-ex-card">
        <div class="row">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
            <img class="ex-thumb" src="./media/${esc(ex.img || ex.gif)}" alt="${esc(ex.name)}" onerror="this.style.display='none'">
            <div style="flex:1;min-width:0">
              <div class="ex-name">${esc(ex.name)}</div>
              <div class="ex-meta">${esc(ex.tg || ex.g)} · ${esc(ex.eq)}</div>
            </div>
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn-icon" data-a="mvu" data-i="${i}" ${i === 0 ? 'disabled style="opacity:0.25"' : ''} title="Move Up">▲</button>
            <button class="btn-icon" data-a="mvd" data-i="${i}" ${i === E.ex.length - 1 ? 'disabled style="opacity:0.25"' : ''} title="Move Down">▼</button>
            <button class="btn-icon red" data-a="rmx" data-i="${i}" title="Remove">✕</button>
          </div>
        </div>
        <div class="grid" style="margin-top:10px">
          <label>Sets<input type="number" inputmode="numeric" data-e="sets" data-i="${i}" value="${x.sets}"></label>
          <label>Target Reps<input type="number" inputmode="numeric" data-e="reps" data-i="${i}" value="${x.reps}"></label>
          <label>Top Reps (Double)<input type="number" inputmode="numeric" data-e="reps2" data-i="${i}" value="${x.reps2}"></label>
          <label>Weight (kg)<input type="number" inputmode="decimal" data-e="w" data-i="${i}" value="${x.w}"></label>
          <label>Increase (kg)<input type="number" inputmode="decimal" data-e="inc" data-i="${i}" value="${x.inc}"></label>
          <label>Progression
            <select data-e="prog" data-i="${i}">
              <option value="linear"${x.prog === 'linear' ? ' selected' : ''}>Linear</option>
              <option value="gslp"${x.prog === 'gslp' ? ' selected' : ''}>Greyskull LP</option>
              <option value="double"${x.prog === 'double' ? ' selected' : ''}>Double</option>
            </select>
          </label>
        </div>
        <input class="note" placeholder="Form cues / notes..." data-e="note" data-i="${i}" value="${esc(x.note || '')}" style="margin-top:8px">
      </div>`;
    }).join('') : '<p class="t2" style="text-align:center;padding:16px 0">No exercises added yet. Tap below to add exercises.</p>') +
    `<button class="btn s" data-a="adde" style="margin-top:6px">${ic('plus', 18)} Add exercise</button>
     <button class="btn" data-a="savee" style="margin-top:6px">Save Routine</button>` +
    (E.isNew ? '' : '<button class="btn s red" data-a="delr" style="margin-top:6px">Delete routine</button>')
  );
}

// ---- Backup & Security Hardened Validation ----
const MAX_BACKUP_SIZE = 5 * 1024 * 1024; // 5 MB maximum

const valid = o => {
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.app !== 'lift' || o.v !== 1) return false;
  if (!Array.isArray(o.routines) || !Array.isArray(o.logs)) return false;
  if (o.routines.length > 500 || o.logs.length > 5000) return false;
  if (o.weights && (!Array.isArray(o.weights) || o.weights.length > 5000)) return false;
  if (o.sched && (typeof o.sched !== 'object' || Array.isArray(o.sched))) return false;

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
    (w.w == null || (Number.isFinite(w.w) && w.w > 0 && w.w < 500)) &&
    (w.waist == null || (Number.isFinite(w.waist) && w.waist > 0 && w.waist < 500))
  );

  if (!o.routines.every(validRoutine) || !o.logs.every(validLog)) return false;
  if (o.weights && !o.weights.every(validWeight)) return false;

  return true;
};

function sanitizeCfgForExport(cfg) {
  if (!cfg || typeof cfg !== 'object') return {};
  const copy = { ...cfg };
  delete copy.aiKey;
  delete copy.aiProvider;
  delete copy.aiModel;
  delete copy.apiKey;
  delete copy.ai_api_key;
  return copy;
}

function exp() {
  const cleanCfg = sanitizeCfgForExport(S.cfg);
  const b = new Blob([JSON.stringify({ app: 'lift', v: 1, exported: Date.now(), routines: S.routines, logs: S.logs, weights: S.weights, cfg: cleanCfg, sched: S.sched || {}, nutrition: S.nutrition || {} }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `mygym-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 9e3);
  S.lastBackupDate = Date.now();
  save('lastBackupDate');
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

    // Backup Import Whitelist: strictly allow only whitelisted keys and sanitize aliases
    const ALLOWED_IMPORT_KEYS = ['routines', 'history', 'logs', 'userMetrics', 'weights', 'settings', 'cfg', 'sched', 'app', 'v', 'exported'];
    const WHITELISTED_BACKUP_KEYS = ALLOWED_IMPORT_KEYS;
    for (const key of Object.keys(o)) {
      if (!WHITELISTED_BACKUP_KEYS.includes(key) || key.startsWith('backup_') || key.toLowerCase().includes('key')) {
        delete o[key];
      }
    }
    // Normalize aliases
    if (o.history && !o.logs) o.logs = o.history;
    if (o.userMetrics && !o.weights) o.weights = o.userMetrics;
    if (o.settings && !o.cfg) o.cfg = o.settings;

    // Explicitly reject and strip any imported entries for aiKey, mygym_ai_key, ai_api_key, or backup_*
    if (o.cfg && typeof o.cfg === 'object') {
      delete o.cfg.aiKey;
      delete o.cfg.mygym_ai_key;
      delete o.cfg.ai_api_key;
      delete o.cfg.aiProvider;
      delete o.cfg.mygym_ai_provider;
      delete o.cfg.ai_provider;
      delete o.cfg.aiModel;
      delete o.cfg.mygym_ai_model;
      delete o.cfg.ai_model;
      delete o.cfg.ai_base_url;
      for (const k of Object.keys(o.cfg)) {
        if (k.startsWith('backup_') || k.toLowerCase().includes('key')) {
          delete o.cfg[k];
        }
      }
    }

    if (!valid(o)) throw new Error('Invalid schema structure');

    _pendingBackupData = o;
    if (typeof window !== 'undefined' && window.__AUTO_CONFIRM_BACKUP__) {
      await applySanitizedBackup(o);
      _pendingBackupData = null;
      return;
    }

    modal(`
      <div class="destructive-confirm-modal">
        <div style="font-size:36px;margin-bottom:8px">📥</div>
        <h2 style="margin-bottom:8px">Restore Backup?</h2>
        <p class="t2 sm" style="margin-bottom:16px;line-height:1.5">
          This backup contains ${o.routines ? o.routines.length : 0} routines and ${o.logs ? o.logs.length : 0} workouts. Restoring will replace your current routines and workout history.
        </p>
        <div class="row g">
          <button class="btn s" data-a="close" style="flex:1">Cancel</button>
          <button class="btn s red" data-a="confirm-restore-backup" style="flex:1">Confirm Restore</button>
        </div>
      </div>
    `);
  } catch (err) {
    console.warn('Backup import blocked:', err.message);
    toast('Invalid backup file');
  }
}

async function applySanitizedBackup(o) {
  if (!o) return;
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
        rpe: s.rpe != null && s.rpe !== '' && !isNaN(+s.rpe) ? Math.min(10, Math.max(1, +s.rpe)) : null,
        type: s.type || 'normal'
      }))
    }))
  }));

  if (Array.isArray(o.weights)) {
    S.weights = o.weights.map(w => ({
      id: String(w.id).slice(0, 50),
      date: String(w.date).slice(0, 10),
      w: w.w != null && Number.isFinite(+w.w) ? rd(Math.max(10, Math.min(500, +w.w))) : null,
      waist: w.waist != null && Number.isFinite(+w.waist) ? rd(Math.max(10, Math.min(300, +w.waist))) : null,
      t: Number(w.t) || new Date(w.date + 'T12:00:00').getTime() || Date.now()
    }));
  }

  if (o.cfg && typeof o.cfg === 'object' && !Array.isArray(o.cfg)) {
    if (Number.isFinite(o.cfg.rest)) S.cfg.rest = Math.max(5, Math.min(600, +o.cfg.rest));
    if (typeof o.cfg.flash === 'boolean') S.cfg.flash = o.cfg.flash;
    if (o.cfg.bodyModel) S.cfg.bodyModel = o.cfg.bodyModel === 'female' ? 'female' : 'male';
    if (o.cfg.physique && typeof o.cfg.physique === 'object') S.cfg.physique = { ...o.cfg.physique };
  }

  if (o.sched && typeof o.sched === 'object' && !Array.isArray(o.sched)) {
    S.sched = {};
    for (const [day, rid] of Object.entries(o.sched)) {
      if (typeof rid === 'string' && rid.length <= 50) S.sched[day] = rid;
    }
  }

  if (o.nutrition && typeof o.nutrition === 'object' && !Array.isArray(o.nutrition)) {
    S.nutrition = {
      targetCals: Math.max(500, Number(o.nutrition.targetCals) || 2100),
      targetProtein: Math.max(10, Number(o.nutrition.targetProtein) || 140),
      targetCarbs: Math.max(0, Number(o.nutrition.targetCarbs) || 240),
      targetFat: Math.max(5, Number(o.nutrition.targetFat) || 60),
      targetFiber: Math.max(5, Number(o.nutrition.targetFiber) || 35),
      meals: (o.nutrition.meals && typeof o.nutrition.meals === 'object') ? o.nutrition.meals : {}
    };
  }

  await save('routines', 'logs', 'weights', 'cfg', 'sched', 'nutrition');
  toast('Backup restored');
  render();
}

// ---- Data Management & CSV Export ----
function expCSV() {
  const headers = ['Date', 'Workout', 'Exercise ID', 'Exercise Name', 'Target Muscle', 'Equipment', 'Set Number', 'Weight (kg)', 'Reps', 'RPE', 'RIR', 'Unilateral', 'Notes'];
  const rows = [];
  S.logs.forEach(l => {
    const dateStr = new Date(l.date).toISOString().slice(0, 10);
    const workoutName = l.name || 'Workout';
    (l.ex || []).forEach(x => {
      const exInfo = X(x.id);
      (x.sets || []).forEach((s, idx) => {
        rows.push([
          dateStr,
          `"${workoutName.replace(/"/g, '""')}"`,
          x.id,
          `"${exInfo.name.replace(/"/g, '""')}"`,
          `"${(exInfo.tg || exInfo.g).replace(/"/g, '""')}"`,
          `"${exInfo.eq.replace(/"/g, '""')}"`,
          idx + 1,
          s.w != null ? s.w : 0,
          s.r != null ? s.r : 0,
          s.rpe != null && s.rpe !== '' ? s.rpe : '',
          s.rir != null ? s.rir : '',
          x.uni ? 'Yes' : 'No',
          `"${(x.note || '').replace(/"/g, '""')}"`
        ]);
      });
    });
  });

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const b = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `mygym-workouts-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 9e3);
  S.lastBackupDate = Date.now();
  save('lastBackupDate');
  toast('Exported workouts to CSV');
}

// ---- Robust Third-Party CSV Importer (Strong / Hevy / MyGyM) ----
let pendingImportSessions = [];

function openCSVImportModal() {
  pendingImportSessions = [];
  modal(`
    <div class="card" style="padding:16px">
      <h3 style="margin-top:0">📥 Import CSV Workouts</h3>
      <p class="t2 sm" style="line-height:1.4">
        Import workout logs from <b>Strong</b>, <b>Hevy</b>, or <b>MyGyM</b> exports. Offline, local parsing only.
      </p>
      
      <div style="margin:12px 0">
        <label class="btn s sm-btn outline" style="display:flex;align-items:center;justify-content:center;cursor:pointer;margin-bottom:8px">
          📁 Choose CSV File...
          <input type="file" id="csv-file-picker" accept=".csv,text/csv" style="display:none">
        </label>
        <div style="text-align:center;font-size:11px;color:var(--t2);margin-bottom:8px">— or paste raw CSV text below —</div>
        <textarea id="csv-import-textarea" class="note" placeholder="Paste Strong / Hevy / MyGyM CSV export text here..." rows="6" style="width:100%;font-family:monospace;font-size:11px"></textarea>
      </div>

      <div id="csv-preview-area" style="display:none;margin:12px 0;background:var(--c2);padding:10px;border-radius:8px;border:1px solid var(--bdr)"></div>

      <div class="row g" style="margin-top:14px">
        <button class="btn s sm-btn" data-a="parse-csv-text" style="flex:1">🔍 Preview Data</button>
        <button class="btn s sm-btn" id="csv-commit-btn" data-a="commit-csv-import" style="flex:1;display:none">✓ Commit Import</button>
        <button class="btn s sm-btn outline" data-a="close" style="width:auto">Cancel</button>
      </div>
    </div>
  `);

  const fileInput = document.getElementById('csv-file-picker');
  if (fileInput) {
    fileInput.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (file) {
        const text = await file.text();
        const textarea = document.getElementById('csv-import-textarea');
        if (textarea) textarea.value = text;
        runCSVPreview(text);
      }
    });
  }
}

function runCSVPreview(text) {
  if (!text || !text.trim()) {
    toast('Please select or paste CSV text');
    return;
  }
  const sessions = (typeof Calc !== 'undefined' && Calc.parseThirdPartyCSV)
    ? Calc.parseThirdPartyCSV(text)
    : [];
  
  const previewArea = document.getElementById('csv-preview-area');
  const commitBtn = document.getElementById('csv-commit-btn');
  if (!previewArea || !commitBtn) return;

  if (!sessions.length) {
    previewArea.style.display = 'block';
    previewArea.innerHTML = `<div style="color:#FF453A;font-size:12px">⚠️ No valid workout sessions recognized. Ensure headers include Date, Exercise, Weight, Reps.</div>`;
    commitBtn.style.display = 'none';
    return;
  }

  pendingImportSessions = sessions;
  const totalSets = sessions.reduce((acc, s) => acc + s.exercises.reduce((exAcc, e) => exAcc + e.sets.length, 0), 0);

  previewArea.style.display = 'block';
  previewArea.innerHTML = `
    <div style="font-weight:700;color:var(--gn);font-size:13px;margin-bottom:6px">
      ✓ Ready to import ${sessions.length} workouts (${totalSets} total sets)
    </div>
    <div style="max-height:160px;overflow-y:auto;font-size:11px;color:var(--t2)">
      ${sessions.slice(0, 5).map(s => `
        <div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
          <b>${new Date(s.date).toISOString().slice(0, 10)}:</b> ${esc(s.name)} (${s.exercises.length} exercises)
        </div>
      `).join('')}
      ${sessions.length > 5 ? `<div style="font-style:italic;padding-top:4px">+ ${sessions.length - 5} more sessions...</div>` : ''}
    </div>
  `;
  commitBtn.style.display = 'block';
}

function commitCSVImport() {
  if (!pendingImportSessions.length) {
    toast('No sessions to import');
    return;
  }

  let importedCount = 0;
  for (const s of pendingImportSessions) {
    const logId = uid();
    const exList = s.exercises.map(item => {
      const matched = (EXDB || []).find(e => (e.name || '').toLowerCase() === item.name.toLowerCase());
      const exId = matched ? matched.id : uid();
      return {
        id: exId,
        name: item.name,
        note: item.note || '',
        sets: item.sets.map(st => ({
          w: st.w,
          r: st.r,
          done: true,
          ...(st.rpe != null ? { rpe: st.rpe } : {}),
          ...(st.rir != null ? { rir: st.rir } : {})
        }))
      };
    });

    S.logs.push({
      id: logId,
      date: s.date,
      t0: s.date,
      t1: s.date + (s.exercises.length * 600000),
      dur: s.exercises.length * 600000,
      name: s.name,
      ex: exList
    });
    importedCount++;
  }

  save('logs');
  ls.set('logs', S.logs);
  closeModal();
  toast(`🎉 Successfully imported ${importedCount} workouts!`);
  render();
}

// ---- First-Run Onboarding Modal ----
function handleOnboardingSubmit() {
  try {
    const age = parseInt(document.getElementById('onboard-age')?.value || document.querySelector('input[placeholder="28"]')?.value || '21', 10);
    const height = parseFloat(document.getElementById('onboard-height')?.value || document.querySelector('input[placeholder="178"]')?.value || '175');
    const weight = parseFloat(document.getElementById('onboard-weight')?.value || document.querySelector('input[placeholder="75"]')?.value || '73.5');
    const unit = document.querySelector('.onboarding-unit-pill.on')?.dataset?.val ||
                 document.querySelector('.onboarding-unit-pill.active')?.dataset?.val ||
                 'kg';
    const sex = document.querySelector('.onboarding-sex-pill.on')?.dataset?.val ||
                document.querySelector('.onboarding-sex-pill.active')?.dataset?.val ||
                'male';
    const goal = document.getElementById('onboard-goal')?.value || 'hypertrophy';
    const weekStart = document.getElementById('onboard-weekstart')?.value || 'mon';

    // Commit to S
    S.onboarded = true;
    if (!S.cfg) S.cfg = {};
    S.cfg.onboarded = true;
    S.cfg.unit = unit;
    S.cfg.units = unit;
    S.cfg.bodyModel = sex;
    S.cfg.sex = sex;
    S.cfg.weekStartDay = weekStart;
    S.cfg.physique = {
      ...(S.cfg.physique || {}),
      age,
      height,
      weight,
      goalType: goal === 'fat_loss' ? 'cut' : (goal === 'hypertrophy' ? 'bulk' : 'recomp')
    };

    // Add baseline weight entry if weights array is empty
    if (!S.weights || S.weights.length === 0) {
      S.weights = [{
        id: 'w_' + Date.now(),
        date: new Date().toISOString().slice(0, 10),
        w: weight,
        t: Date.now()
      }];
    }

    // Persist immediately to localStorage and ls
    try {
      ls.set('mygym_onboarded', 'true');
      ls.set('mygym_shell_onboarded', 'true');
    } catch (_) {}
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('mygym_onboarded', 'true');
        localStorage.setItem('mygym_shell_onboarded', 'true');
      } catch (_) {}
    }
  } catch (err) {
    console.warn('handleOnboardingSubmit error:', err);
  } finally {
    // MUST EXECUTE IN FINALLY BLOCK:
    closeModal();
    const m = document.getElementById('m');
    if (m) {
      m.hidden = true;
      m.innerHTML = '';
    }
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = '';
    }
    toast('Welcome to MyGyM!');
    render();
    save('cfg', 'weights');
  }
}

function showOnboardingModal(force = false) {
  if (!force && isUserOnboarded()) {
    return;
  }
  const age = S.cfg?.physique?.age || 21;
  const height = S.cfg?.physique?.height || 175;
  const weight = S.weights?.at(-1)?.w || S.cfg?.physique?.weight || 73.5;
  const unit = S.cfg?.unit || S.cfg?.units || 'kg';
  const sex = S.cfg?.bodyModel || S.cfg?.sex || 'male';
  const goal = S.cfg?.physique?.goalType || S.cfg?.goalType || 'hypertrophy';
  const weekStart = S.cfg?.weekStartDay || 'mon';

  modal(`
    <div class="card onboarding-card" style="padding:18px">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:18px;">🏋️</span>
        <button type="button" class="x" data-a="dismiss-onboarding" style="font-size:14px; font-weight:700; color:var(--ac); cursor:pointer;">Skip / Close ✕</button>
      </div>

      <div style="text-align:center;margin-bottom:14px">
        <h2 style="margin:4px 0 2px">Welcome to MyGyM</h2>
        <p class="t2 sm" style="margin:0">Personalize your offline training profile</p>
      </div>

      <form id="onboarding-form" onsubmit="event.preventDefault()">
        <div class="settings-row" style="margin-bottom:10px">
          <span class="settings-label">Preferred Units</span>
          <div class="chips" id="onboard-units-group" style="margin:0;display:flex;gap:6px">
            <button type="button" class="chip onboarding-unit-pill ${unit === 'kg' ? 'on active' : ''}" data-a="toggle-onboard-unit" data-val="kg">kg</button>
            <button type="button" class="chip onboarding-unit-pill ${unit === 'lbs' ? 'on active' : ''}" data-a="toggle-onboard-unit" data-val="lbs">lbs</button>
          </div>
        </div>

        <div class="settings-row" style="margin-bottom:10px">
          <span class="settings-label">Biological Sex</span>
          <div class="chips" id="onboard-sex-group" style="margin:0;display:flex;gap:6px">
            <button type="button" class="chip onboarding-sex-pill ${sex === 'male' ? 'on active' : ''}" data-a="toggle-onboard-sex" data-val="male">Male</button>
            <button type="button" class="chip onboarding-sex-pill ${sex === 'female' ? 'on active' : ''}" data-a="toggle-onboard-sex" data-val="female">Female</button>
          </div>
        </div>

        <div class="row g" style="margin-bottom:10px">
          <div style="flex:1">
            <label class="t2 sm" for="onboard-age">Age (years)</label>
            <input type="number" id="onboard-age" name="age" class="txt" value="${age}" min="12" max="100" style="width:100%;padding:8px">
          </div>
          <div style="flex:1">
            <label class="t2 sm" for="onboard-height">Height (cm)</label>
            <input type="number" id="onboard-height" name="height" class="txt" value="${height}" min="100" max="250" style="width:100%;padding:8px">
          </div>
          <div style="flex:1">
            <label class="t2 sm" for="onboard-weight">Weight (${esc(unit)})</label>
            <input type="number" id="onboard-weight" name="weight" class="txt" value="${weight}" step="0.5" min="30" max="300" style="width:100%;padding:8px">
          </div>
        </div>

        <div class="settings-row" style="margin-bottom:10px">
          <span class="settings-label">Primary Training Goal</span>
          <select id="onboard-goal" name="goal" class="settings-select" style="max-width:180px">
            <option value="hypertrophy" ${goal === 'hypertrophy' || goal === 'bulk' ? 'selected' : ''}>Muscle Hypertrophy</option>
            <option value="strength" ${goal === 'strength' ? 'selected' : ''}>Raw Strength</option>
            <option value="fat_loss" ${goal === 'fat_loss' || goal === 'cut' ? 'selected' : ''}>Fat Loss / Conditioning</option>
            <option value="maintenance" ${goal === 'maintenance' || goal === 'recomp' ? 'selected' : ''}>Maintenance</option>
          </select>
        </div>

        <div class="settings-row" style="margin-bottom:14px">
          <span class="settings-label">Week Start Day</span>
          <select id="onboard-weekstart" name="weekstart" class="settings-select" style="max-width:180px">
            <option value="mon" ${weekStart === 'mon' ? 'selected' : ''}>Monday (00:00)</option>
            <option value="sun" ${weekStart === 'sun' ? 'selected' : ''}>Sunday (00:00)</option>
          </select>
        </div>

        <button type="button" class="btn" id="onboarding-submit-btn" data-a="submit-onboarding" style="width:100%;min-height:46px;font-weight:700">Get Started 🚀</button>
      </form>
    </div>
  `, { hideClose: false });

  setTimeout(() => {
    const submitBtn = document.getElementById('onboarding-submit-btn');
    if (submitBtn) {
      submitBtn.onclick = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        handleOnboardingSubmit();
      };
    }
    const dismissBtns = document.querySelectorAll('[data-a="dismiss-onboarding"]');
    dismissBtns.forEach(b => {
      b.onclick = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        handleOnboardingSubmit();
      };
    });
  }, 0);
}

// ---- Settings Modal (Clean Separation of App Prefs, Cache, Data Management) ----
function showSettingsModal() {
  const aiSettings = (typeof AIConfig !== 'undefined' && AIConfig.getAISettings) ? AIConfig.getAISettings() : { provider: 'auto', models: {}, baseUrl: '', rememberKey: true };
  const savedKey = (typeof AIConfig !== 'undefined' && AIConfig.getAIKey) ? AIConfig.getAIKey() : ((typeof localStorage !== 'undefined' ? (localStorage.getItem('mygym_ai_key') || localStorage.getItem('ai_api_key')) : '') || '');
  const savedProv = aiSettings.provider || 'auto';
  const savedModel = (aiSettings.models && aiSettings.models[savedProv]) || ((typeof AIConfig !== 'undefined' && AIConfig.AI_PROVIDERS[savedProv]?.defaultModel) || '');
  const savedBaseUrl = aiSettings.baseUrl || '';
  const detectedKeyInfo = detectProviderFromKey(savedKey);

  let keyPlaceholder = 'Paste any key (gsk_, sk-or-, AIzaSy, sk-)...';
  const providers = (typeof AIConfig !== 'undefined' && AIConfig.AI_PROVIDERS) ? AIConfig.AI_PROVIDERS : {};
  if (savedProv !== 'auto' && providers[savedProv]) {
    keyPlaceholder = providers[savedProv].keyPlaceholder || providers[savedProv].placeholder || 'API Key...';
  } else if (detectedKeyInfo) {
    keyPlaceholder = providers[detectedKeyInfo.provider]?.keyPlaceholder || providers[detectedKeyInfo.provider]?.placeholder || 'API Key...';
  }

  modal(`
    <h2>Settings ⚙️</h2>
    <div class="settings-modal-content">
      <div class="settings-section">
        <div class="settings-section-title">App Preferences</div>
        <div class="card settings-card">
          <label class="settings-row">
            <span class="settings-label">Rest Timer Chime & Sound</span>
            <input type="checkbox" data-c="sound" ${S.cfg.sound !== false ? 'checked' : ''}>
          </label>
          <div class="settings-divider"></div>
          <label class="settings-row">
            <span class="settings-label">Haptic Vibration</span>
            <input type="checkbox" data-c="vibrate" ${S.cfg.vibrate !== false ? 'checked' : ''}>
          </label>
          <div class="settings-divider"></div>
          <label class="settings-row">
            <span class="settings-label">Default Rest Interval</span>
            <select class="settings-select" data-c="rest">
              <option value="30" ${S.cfg.rest === 30 ? 'selected' : ''}>30 sec</option>
              <option value="45" ${S.cfg.rest === 45 ? 'selected' : ''}>45 sec</option>
              <option value="60" ${S.cfg.rest === 60 ? 'selected' : ''}>60 sec</option>
              <option value="90" ${S.cfg.rest === 90 ? 'selected' : ''}>90 sec (Default)</option>
              <option value="120" ${S.cfg.rest === 120 ? 'selected' : ''}>2 min</option>
              <option value="180" ${S.cfg.rest === 180 ? 'selected' : ''}>3 min</option>
              <option value="240" ${S.cfg.rest === 240 ? 'selected' : ''}>4 min</option>
              <option value="300" ${S.cfg.rest === 300 ? 'selected' : ''}>5 min</option>
            </select>
          </label>
          <div class="settings-divider"></div>
          <label class="settings-row">
            <span class="settings-label">Flash Screen on Rest End</span>
            <input type="checkbox" data-c="flash" ${S.cfg.flash ? 'checked' : ''}>
          </label>
          <div class="settings-divider"></div>
          <label class="settings-row">
            <span class="settings-label">Default Weight Increment (kg)</span>
            <input type="number" inputmode="decimal" step="0.5" class="settings-input-num" data-c="inc" value="${S.cfg.inc || 2.5}">
          </label>
          <div class="settings-divider"></div>
          <label class="settings-row">
            <span class="settings-label">Anatomical Model</span>
            <select class="settings-select" data-c="bodyModel">
              <option value="male" ${S.cfg.bodyModel !== 'female' ? 'selected' : ''}>Male Silhouette</option>
              <option value="female" ${S.cfg.bodyModel === 'female' ? 'selected' : ''}>Female Silhouette</option>
            </select>
          </label>
          <div class="settings-divider"></div>
          <label class="settings-row">
            <span class="settings-label">Dumbbell Volume Mode</span>
            <select class="settings-select" data-c="dumbbellWeightMode">
              <option value="per_hand" ${S.cfg.dumbbellWeightMode !== 'as_logged' ? 'selected' : ''}>Per Hand (×2 volume) [Recommended]</option>
              <option value="as_logged" ${S.cfg.dumbbellWeightMode === 'as_logged' ? 'selected' : ''}>As Logged (Total Weight)</option>
            </select>
          </label>
          <div class="settings-divider"></div>
          <label class="settings-row">
            <span class="settings-label">Week Start Day</span>
            <select class="settings-select" data-c="weekStartDay">
              <option value="mon" ${S.cfg.weekStartDay !== 'sun' ? 'selected' : ''}>Monday (00:00)</option>
              <option value="sun" ${S.cfg.weekStartDay === 'sun' ? 'selected' : ''}>Sunday (00:00)</option>
            </select>
          </label>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">AI Engine Setup (BYOK) 🤖</div>
        <div class="card settings-card">
          <div style="padding:10px 0 6px">
            <div class="t2 sm" style="margin-bottom:12px;line-height:1.4">
              Bring Your Own Key (BYOK) for smart workout importing and real-time AI coaching. Keys are stored <b>strictly in ${aiSettings.rememberKey !== false ? 'localStorage' : 'sessionStorage'} on this device</b> and connect directly to the provider. Zero backend proxies.
            </div>

            <label class="settings-row" style="margin-bottom:8px">
              <span class="settings-label">AI Provider</span>
              <select class="settings-select" id="ai-provider-select" data-f="ai-provider">
                <option value="auto" ${savedProv === 'auto' ? 'selected' : ''}>Auto-Detect from Key</option>
                <option value="groq" ${savedProv === 'groq' ? 'selected' : ''}>Groq (Free &amp; Ultra-Fast)</option>
                <option value="openai" ${savedProv === 'openai' ? 'selected' : ''}>OpenAI (ChatGPT)</option>
                <option value="openrouter" ${savedProv === 'openrouter' ? 'selected' : ''}>OpenRouter (Free Tier)</option>
                <option value="gemini" ${savedProv === 'gemini' ? 'selected' : ''}>Google Gemini</option>
                <option value="custom" ${savedProv === 'custom' ? 'selected' : ''}>Custom / OpenAI-Compatible</option>
              </select>
            </label>

            <div id="ai-standard-model-row" class="settings-row" style="margin-bottom:8px;${savedProv === 'custom' ? 'display:none' : 'display:flex'};align-items:center;gap:8px">
              <span class="settings-label" style="flex:0 0 auto">Model</span>
              <select class="settings-select" id="ai-model-select" data-f="ai-model" style="flex:1">
                ${renderAIModelOptions(savedProv, savedModel)}
              </select>
              <button class="chip" id="ai-refresh-models-btn" data-a="refresh-ai-models" style="flex:0 0 auto;font-size:11px;padding:4px 8px">🔄 Refresh</button>
            </div>

            <div id="ai-custom-fields" style="${savedProv === 'custom' ? 'display:block' : 'display:none'};margin-top:4px">
              <div class="settings-divider"></div>
              <label class="settings-row" style="margin-bottom:8px">
                <span class="settings-label">Base URL</span>
                <input type="text" id="ai-baseurl-input" data-id="ai-base-url-input" class="txt ai-base-url-input" style="width:100%;padding:8px;font-family:monospace;font-size:12px;border-radius:6px" placeholder="https://api.deepseek.com/v1" value="${esc(savedBaseUrl)}">
              </label>
              <label class="settings-row" style="margin-bottom:8px">
                <span class="settings-label">Model Name</span>
                <input type="text" id="ai-custom-model-input" data-id="ai-custom-model-input" class="txt ai-custom-model-input" style="width:100%;padding:8px;font-family:monospace;font-size:12px;border-radius:6px" placeholder="deepseek-chat" value="${esc((aiSettings.models && aiSettings.models.custom) || '')}">
              </label>
            </div>

            <div class="settings-divider"></div>

            <div style="margin:10px 0">
              <div class="row" style="justify-content:space-between;margin-bottom:6px">
                <span class="settings-label">API Key</span>
                <div class="row" style="gap:6px;align-items:center">
                  <span id="ai-detected-pill" class="chip" style="font-size:10px;padding:2px 8px;display:${detectedKeyInfo ? 'inline-block' : 'none'};color:var(--gn);background:rgba(48,209,88,0.15)">${detectedKeyInfo ? '⚡ ' + esc(detectedKeyInfo.name) : ''}</span>
                  <button class="chip" data-a="toggle-key-vis" style="font-size:11px;padding:2px 8px">👁️ Toggle View</button>
                </div>
              </div>
              <input type="password" id="ai-key-input" data-id="ai-api-key-input" class="txt ai-api-key-input" style="width:100%;padding:10px;font-family:monospace;font-size:13px;border-radius:8px" placeholder="${esc(keyPlaceholder)}" value="${esc(savedKey)}">
              <label class="row" style="margin-top:8px;gap:8px;align-items:center;cursor:pointer">
                <input type="checkbox" id="ai-remember-key-toggle" ${aiSettings.rememberKey !== false ? 'checked' : ''}>
                <span class="t2 sm" style="font-size:12px">Remember key on this device (stores in localStorage)</span>
              </label>
            </div>

            <div class="row g" style="margin-top:10px">
              <button class="btn s sm-btn" id="ai-test-key-btn" data-a="test-ai-key" style="flex:1">⚡ Test Connection</button>
              <button class="btn s sm-btn" id="ai-save-key-btn" data-a="save-ai-key" style="flex:1">💾 Save Key</button>
              <button class="btn s sm-btn red" id="ai-clear-key-btn" data-a="clear-ai-key" style="flex:1">🗑️ Clear Key</button>
            </div>
            <div id="ai-conn-status" style="margin-top:8px"></div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Storage & Offline Cache</div>
        <div class="card settings-card">
          <div class="settings-row">
            <span class="settings-label">App Shell Version</span>
            <span class="chip on" style="font-family:monospace;font-size:11px">${esc(SHELL_VERSION)} (v${esc(APP_VERSION)})</span>
          </div>
          <div class="settings-divider"></div>
          <div class="settings-row">
            <span class="settings-label">Air-Gapped PWA Status</span>
            <span class="chip" style="font-size:11px;color:var(--gn)">100% Offline</span>
          </div>
          <div class="settings-divider"></div>
          <div class="settings-row">
            <span class="settings-label">Device Storage Quota</span>
            <span id="storage-meter-chip" class="chip">Estimating...</span>
          </div>
          <div class="settings-divider"></div>
          <div class="settings-row">
            <span class="settings-label">Last Backup</span>
            <span class="chip ${S.lastBackupDate ? 'on' : ''}">${S.lastBackupDate ? `${Math.max(0, Math.round((Date.now() - S.lastBackupDate) / (1000 * 60 * 60 * 24)))} days ago` : 'Never backed up'}</span>
          </div>
          <div class="settings-divider"></div>
          <div style="padding:10px 0">
            <button class="btn s" data-a="forceupdate" style="width:100%">${ic('sync', 16)} ♻️ Force Cache Reload</button>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Data Management</div>
        <div class="card settings-card">
          <div style="padding:12px 0 6px">
            <div class="row g" style="margin-bottom:8px">
              <button class="btn s" data-a="exp" style="flex:1">Export Backup (JSON)</button>
              <button class="btn s" data-a="expcsv" style="flex:1">Export to CSV</button>
            </div>
            <div class="row g" style="margin-bottom:4px">
              <label class="btn s" style="flex:1;display:flex;align-items:center;justify-content:center;cursor:pointer;margin:0">
                Restore Backup (JSON)
                <input type="file" id="f" accept=".json" style="display:none">
              </label>
              <button class="btn s sm-btn outline" data-a="opencsvimport" style="flex:1">📥 Import CSV</button>
            </div>
          </div>
        </div>

        <div class="destructive-card">
          <div class="destructive-title">⚠️ Danger Zone</div>
          <p class="t2 sm" style="margin:6px 0 10px;color:rgba(255,255,255,0.75)">Permanently wipe all routines, logs, and measurements from this device.</p>
          <button class="btn s red" data-a="wipe-step1" style="width:100%">Erase All Data...</button>
        </div>
      </div>
    </div>
  `);

  // Direct Event Binding in Settings Modal to ensure click/touch events never drop
  const saveBtn = document.getElementById('ai-save-key-btn');
  if (saveBtn) {
    saveBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); saveAIKey(); };
    saveBtn.ontouchend = (e) => { e.preventDefault(); e.stopPropagation(); saveAIKey(); };
  }
  const testBtn = document.getElementById('ai-test-key-btn');
  if (testBtn) {
    testBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); testAIConnection(); };
    testBtn.ontouchend = (e) => { e.preventDefault(); e.stopPropagation(); testAIConnection(); };
  }
  const clearBtn = document.getElementById('ai-clear-key-btn');
  if (clearBtn) {
    clearBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); clearAIKey(); };
    clearBtn.ontouchend = (e) => { e.preventDefault(); e.stopPropagation(); clearAIKey(); };
  }
  const refreshBtn = document.getElementById('ai-refresh-models-btn');
  if (refreshBtn) {
    refreshBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); refreshAIModels(document.getElementById('ai-provider-select')?.value); };
    refreshBtn.ontouchend = (e) => { e.preventDefault(); e.stopPropagation(); refreshAIModels(document.getElementById('ai-provider-select')?.value); };
  }

  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(est => {
      const chip = document.getElementById('storage-meter-chip');
      if (chip && est && est.quota) {
        const usedMB = ((est.usage || 0) / (1024 * 1024)).toFixed(1);
        const quotaMB = ((est.quota || 0) / (1024 * 1024)).toFixed(0);
        chip.textContent = `${usedMB} MB / ${quotaMB} MB`;
      }
    }).catch(() => {});
  }
}

// 2-Step Confirmation Modal for Erase All Data
function showWipeConfirmModal() {
  modal(`
    <div class="destructive-confirm-modal">
      <div style="font-size:40px;margin-bottom:8px">⚠️</div>
      <h2 style="color:var(--accent-destructive);margin-bottom:8px">Erase All Data?</h2>
      <p class="t2 sm" style="margin-bottom:16px;line-height:1.5">
        This action is permanent and IRREVERSIBLE. All workouts (${S.logs.length}), custom routines (${S.routines.length}), and body weight records (${S.weights.length}) will be permanently erased.
      </p>
      <div class="row g">
        <button class="btn s" data-a="close" style="flex:1">Cancel</button>
        <button class="btn s red" data-a="wipe-confirm" style="flex:1">Yes, Delete Everything</button>
      </div>
    </div>
  `);
}

// Barbell Plate Calculator Modal
function showPlateCalcModal(targetWeight = 20, exName = 'Barbell Exercise') {
  const res = calcPlates(targetWeight, 20);
  const colorMap = {
    20: '#0A84FF',
    15: '#FFD60A',
    10: '#30D158',
    5: '#F2F2F7',
    2.5: '#FF453A',
    1.25: '#8E8E93'
  };

  const discsHtml = res.plates.flatMap(p => {
    const classSuffix = String(p.weight).replace('.', '_');
    return Array.from({ length: p.count }, () => `<div class="plate-disc plate-disc-${classSuffix}" title="${p.weight} kg"></div>`);
  }).join('');

  modal(`
    <h2>Barbell Plate Calculator 🏋️</h2>
    <div class="plate-calc-container">
      <div class="plate-calc-hero">
        <div class="plate-calc-wt">${targetWeight} <span style="font-size:20px;font-weight:600;color:var(--t2)">kg</span></div>
        <div class="t2 sm" style="margin-top:2px">${esc(exName)} · 20kg Olympic Bar</div>
        <div class="plate-calc-bar">
          <div class="plate-sleeve-bar"></div>
          <div class="plate-collar"></div>
          ${discsHtml || '<span class="t2 sm" style="padding:0 8px">Empty Bar</span>'}
          <div class="plate-sleeve-bar" style="width:24px"></div>
        </div>
        <div class="t2 sm" style="margin-top:4px"><b>${res.perSide} kg</b> per side</div>
      </div>

      <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--t2);margin-bottom:6px">Plates Per Side:</div>
      <div class="plate-pills-row">
        ${res.plates.length ? res.plates.map(p => `
          <div class="plate-pill">
            <span style="width:10px;height:10px;border-radius:50%;background:${colorMap[p.weight] || '#fff'};display:inline-block"></span>
            ${p.count} × ${p.weight} kg
          </div>
        `).join('') : '<span class="t2 sm">No plates required (20kg bar only)</span>'}
        ${res.rem > 0 ? `<div class="plate-pill" style="color:var(--accent-achievement);border-color:var(--accent-achievement)">+ ${res.rem} kg micro-load</div>` : ''}
      </div>

      <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--t2);margin:16px 0 8px">Quick Adjust Weight:</div>
      <div class="row g" style="margin-bottom:8px">
        <button class="chip" data-a="adjplate" data-w="${Math.max(20, targetWeight - 10)}" data-name="${esc(exName)}">-10kg</button>
        <button class="chip" data-a="adjplate" data-w="${Math.max(20, targetWeight - 5)}" data-name="${esc(exName)}">-5kg</button>
        <button class="chip" data-a="adjplate" data-w="${Math.max(20, targetWeight - 2.5)}" data-name="${esc(exName)}">-2.5kg</button>
        <button class="chip" data-a="adjplate" data-w="${targetWeight + 2.5}" data-name="${esc(exName)}">+2.5kg</button>
        <button class="chip" data-a="adjplate" data-w="${targetWeight + 5}" data-name="${esc(exName)}">+5kg</button>
        <button class="chip" data-a="adjplate" data-w="${targetWeight + 10}" data-name="${esc(exName)}">+10kg</button>
      </div>

      <button class="btn s" data-a="close" style="width:100%;margin-top:10px">Done</button>
    </div>
  `);
}

// ============================================================================
// v6.0.2 UNIVERSAL BYOK AI ENGINE (OPENAI-COMPATIBLE & NATIVE GEMINI)
// Powered by centralized ai-config.js
// ============================================================================

const AI_PROVIDERS = (typeof AIConfig !== 'undefined' && AIConfig.AI_PROVIDERS) || {};

function detectProviderFromKey(key) {
  if (typeof AIConfig !== 'undefined' && AIConfig.detectProviderFromKey) {
    return AIConfig.detectProviderFromKey(key);
  }
  return null;
}

function resolveAIConfig(overrides = {}) {
  const settings = (typeof AIConfig !== 'undefined' && AIConfig.getAISettings)
    ? AIConfig.getAISettings()
    : { provider: 'auto', resolvedProvider: 'groq', models: {}, baseUrl: '' };

  const apiKey = (overrides.apiKey != null
    ? overrides.apiKey
    : ((typeof AIConfig !== 'undefined' && AIConfig.getAIKey) ? AIConfig.getAIKey() : '')
  ).trim();

  let provider = overrides.provider || settings.provider || 'auto';
  if (provider === 'auto') {
    const detected = detectProviderFromKey(apiKey);
    provider = detected ? detected.provider : (settings.resolvedProvider || 'groq');
  }

  const providers = (typeof AIConfig !== 'undefined' && AIConfig.AI_PROVIDERS) ? AIConfig.AI_PROVIDERS : {};
  const provDef = providers[provider] || providers.openai || { name: provider, defaultModel: 'llama-3.3-70b-versatile' };

  let model = overrides.model || (settings.models && settings.models[provider]) || provDef.defaultModel || '';
  if (typeof AIConfig !== 'undefined' && AIConfig.migrateModelId) {
    model = AIConfig.migrateModelId(model);
  }

  const baseUrl = (overrides.baseUrl != null ? overrides.baseUrl : settings.baseUrl) || '';

  return {
    apiKey,
    provider,
    providerName: provider === 'custom' ? 'Custom / OpenAI-Compatible' : (provDef.name || provider),
    model,
    baseUrl,
    endpoint: provDef.endpoint,
    modelsEndpoint: provDef.modelsEndpoint
  };
}

function renderAIModelOptions(prov, currentModel) {
  const providers = (typeof AIConfig !== 'undefined' && AIConfig.AI_PROVIDERS) ? AIConfig.AI_PROVIDERS : {};
  const p = providers[prov] || providers.openai || {};
  const cached = (typeof AIConfig !== 'undefined' && AIConfig.getCachedModels) ? AIConfig.getCachedModels(prov) : null;
  const models = (cached && cached.length) ? cached : (p.models || []);

  if (prov === 'auto') {
    return `
      <option value="llama-3.3-70b-versatile" ${(!currentModel || currentModel === 'llama-3.3-70b-versatile') ? 'selected' : ''}>Llama 3.3 70B Versatile (Groq)</option>
      <option value="meta-llama/llama-3.3-70b-instruct:free" ${currentModel === 'meta-llama/llama-3.3-70b-instruct:free' ? 'selected' : ''}>Llama 3.3 70B (OpenRouter Free)</option>
      <option value="gemini-2.0-flash" ${currentModel === 'gemini-2.0-flash' ? 'selected' : ''}>Gemini 2.0 Flash (Google)</option>
      <option value="gpt-4o-mini" ${currentModel === 'gpt-4o-mini' ? 'selected' : ''}>GPT-4o Mini (OpenAI)</option>
    `;
  }

  if (!models || !models.length) {
    if (currentModel) {
      return `<option value="${esc(currentModel)}" selected>${esc(currentModel)}</option>`;
    }
    return `<option value="">No models available</option>`;
  }

  let hasCurrent = models.some(m => m.id === currentModel);
  let html = '';
  if (currentModel && !hasCurrent) {
    html += `<option value="${esc(currentModel)}" selected>${esc(currentModel)} (Current)</option>`;
  }
  html += models.map(m => `
    <option value="${esc(m.id)}" ${(currentModel === m.id || (!currentModel && !hasCurrent && m.id === p.defaultModel)) ? 'selected' : ''}>${esc(m.name || m.id)}</option>
  `).join('');
  return html;
}

function updateAIModalFields(prov, selectedModel = null) {
  const stdRow = document.querySelector('#ai-standard-model-row');
  const customFields = document.querySelector('#ai-custom-fields');
  const modelSelect = document.querySelector('#ai-model-select');
  const keyInput = document.getElementById('ai-key-input') || document.getElementById('ai-api-key-input');
  const customModelInput = document.getElementById('ai-custom-model-input') || document.getElementById('ai-model-input');

  const settings = (typeof AIConfig !== 'undefined' && AIConfig.getAISettings) ? AIConfig.getAISettings() : { models: {} };
  const providers = (typeof AIConfig !== 'undefined' && AIConfig.AI_PROVIDERS) ? AIConfig.AI_PROVIDERS : {};

  if (prov === 'custom') {
    if (stdRow) stdRow.style.display = 'none';
    if (customFields) customFields.style.display = 'block';
    if (keyInput) keyInput.placeholder = 'API Key...';
    if (customModelInput) {
      customModelInput.value = selectedModel || settings.models?.custom || '';
    }
  } else {
    if (stdRow) stdRow.style.display = 'flex';
    if (customFields) customFields.style.display = 'none';
    const p = providers[prov] || providers.openai || {};
    if (keyInput) keyInput.placeholder = p.keyPlaceholder || p.placeholder || 'API Key...';
    if (modelSelect) {
      const activeModel = selectedModel || settings.models?.[prov] || p.defaultModel || '';
      modelSelect.innerHTML = renderAIModelOptions(prov, activeModel);
    }
  }
}

function handleAIKeyInput(keyVal) {
  const provSelect = document.querySelector('#ai-provider-select');
  const settings = (typeof AIConfig !== 'undefined' && AIConfig.getAISettings) ? AIConfig.getAISettings() : {};
  const currentProv = provSelect ? provSelect.value : (settings.provider || 'auto');

  if (currentProv && currentProv !== 'auto') {
    return;
  }

  const detected = detectProviderFromKey(keyVal);
  const detectedPill = document.querySelector('#ai-detected-pill');

  if (detected) {
    if (detectedPill) {
      detectedPill.textContent = '⚡ ' + detected.name;
      detectedPill.style.display = 'inline-block';
    }
    if (provSelect && provSelect.value === 'auto') {
      const modelSelect = document.querySelector('#ai-model-select');
      if (modelSelect) {
        const curModel = settings.models?.[detected.provider] || detected.model;
        modelSelect.innerHTML = renderAIModelOptions(detected.provider, curModel);
      }
    }
  } else {
    if (detectedPill) {
      detectedPill.style.display = 'none';
    }
  }
}

let aiCoachHistory = [];
let parsedAIRoutine = null;

function saveAIKey() {
  const keyEl = document.getElementById('ai-key-input') || document.getElementById('ai-api-key-input');
  const val = keyEl && keyEl.value != null ? keyEl.value.trim() : '';
  const statusEl = document.querySelector('#ai-conn-status');

  if (!val) {
    if (statusEl) {
      statusEl.innerHTML = `<span class="chip" style="color:var(--rd);background:rgba(255,69,58,0.15);font-weight:600">× Please enter a valid API Key before saving.</span>`;
    }
    toast('Please enter a valid API Key before saving.');
    return null;
  }

  const key = val;
  const provEl = document.getElementById('ai-provider-select');
  const provVal = provEl && provEl.value ? provEl.value : 'auto';

  let resolvedProv = provVal;
  if (provVal === 'auto') {
    const detected = detectProviderFromKey(key);
    resolvedProv = detected ? detected.provider : 'groq';
  }

  const settings = (typeof AIConfig !== 'undefined' && AIConfig.getAISettings) ? AIConfig.getAISettings() : { models: {} };
  settings.provider = provVal;
  settings.resolvedProvider = resolvedProv;

  const modelEl = resolvedProv === 'custom'
    ? (document.getElementById('ai-custom-model-input') || document.getElementById('ai-model-input'))
    : document.getElementById('ai-model-select');
  if (modelEl && modelEl.value != null) {
    const mVal = modelEl.value.trim();
    if (mVal) {
      settings.models[resolvedProv] = (typeof AIConfig !== 'undefined' && AIConfig.migrateModelId)
        ? AIConfig.migrateModelId(mVal)
        : mVal;
    }
  }

  const baseUrlEl = document.getElementById('ai-baseurl-input') || document.getElementById('ai-base-url-input');
  if (baseUrlEl && baseUrlEl.value != null) {
    settings.baseUrl = baseUrlEl.value.trim();
  }

  const rememberToggle = document.getElementById('ai-remember-key-toggle');
  const rememberKey = rememberToggle ? rememberToggle.checked : true;
  settings.rememberKey = rememberKey;

  if (typeof AIConfig !== 'undefined' && AIConfig.saveAISettings) {
    AIConfig.saveAISettings(settings);
  }
  if (typeof AIConfig !== 'undefined' && AIConfig.setAIKey) {
    AIConfig.setAIKey(key, rememberKey);
  }

  // Key hygiene: ensure key is NEVER stored in S.cfg
  if (S.cfg) {
    delete S.cfg.aiKey;
    delete S.cfg.aiProvider;
    delete S.cfg.aiModel;
  }

  if (statusEl) {
    statusEl.innerHTML = `<span class="chip" style="color:var(--gn);background:rgba(48,209,88,0.15);font-weight:600">✓ API Key Saved Successfully</span>`;
  }

  toast('API Key saved successfully');
  return { key, provider: provVal, model: settings.models[resolvedProv] };
}

function clearAIKey() {
  if (typeof AIConfig !== 'undefined' && AIConfig.clearAIKey) {
    AIConfig.clearAIKey();
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('mygym_ai_key');
    localStorage.removeItem('ai_api_key');
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem('mygym_ai_key');
  }
  if (S.cfg) {
    delete S.cfg.aiKey;
    delete S.cfg.aiProvider;
    delete S.cfg.aiModel;
  }
  const keyInput = document.getElementById('ai-key-input') || document.getElementById('ai-api-key-input');
  if (keyInput) keyInput.value = '';
  const statusEl = document.querySelector('#ai-conn-status');
  if (statusEl) {
    statusEl.innerHTML = `<span class="chip" style="color:var(--am);background:rgba(255,159,10,0.15);font-weight:600">Key cleared</span>`;
  }
  toast('Key cleared');
}

function saveAISettings(settings) {
  if (typeof AIConfig !== 'undefined' && AIConfig.saveAISettings && settings) {
    AIConfig.saveAISettings(settings);
  }
  return saveAIKey();
}

async function refreshAIModels(provider) {
  const statusEl = document.querySelector('#ai-conn-status');
  const refreshBtn = document.getElementById('ai-refresh-models-btn');
  const key = (typeof AIConfig !== 'undefined' && AIConfig.getAIKey)
    ? AIConfig.getAIKey()
    : (document.getElementById('ai-key-input')?.value || '').trim();

  if (!key) {
    toast('Please enter or save an API key to refresh models.');
    return;
  }

  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '⏳ Fetching...';
  }

  const settings = (typeof AIConfig !== 'undefined' && AIConfig.getAISettings) ? AIConfig.getAISettings() : {};
  let prov = provider;
  if (!prov || prov === 'auto') {
    prov = settings.resolvedProvider || 'groq';
  }

  try {
    if (typeof AIConfig !== 'undefined' && AIConfig.fetchAvailableModels) {
      const models = await AIConfig.fetchAvailableModels(prov, key, settings.baseUrl);
      if (models && models.length) {
        AIConfig.setCachedModels(prov, models);
        const modelSelect = document.getElementById('ai-model-select');
        if (modelSelect) {
          const curModel = settings.models?.[prov] || AIConfig.AI_PROVIDERS[prov]?.defaultModel;
          modelSelect.innerHTML = renderAIModelOptions(prov, curModel);
        }
        toast(`Refreshed ${models.length} models for ${AIConfig.AI_PROVIDERS[prov]?.name || prov}`);
        if (statusEl) {
          statusEl.innerHTML = `<span class="chip" style="color:var(--gn);background:rgba(48,209,88,0.15)">✓ Found ${models.length} models</span>`;
        }
      } else {
        toast('No chat-capable models found.');
      }
    }
  } catch (err) {
    toast(`Failed to refresh models: ${err.message}`);
    if (statusEl) {
      statusEl.innerHTML = `<span class="chip" style="color:var(--rd);background:rgba(255,69,58,0.15)">× ${esc(err.message)}</span>`;
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '🔄 Refresh';
    }
  }
}

async function callAI(promptOrMessages, optionsOrSystemPrompt = {}) {
  const options = typeof optionsOrSystemPrompt === 'string'
    ? { systemPrompt: optionsOrSystemPrompt }
    : (optionsOrSystemPrompt || {});

  const config = resolveAIConfig(options);
  const apiKey = (options.apiKey || config.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('API key missing. Please configure your OpenAI, Groq, OpenRouter, or Gemini key in Settings (⚙️).');
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Network Offline. An active internet connection is required to contact AI.');
  }

  const provider = config.provider;
  const model = String(config.model || '').trim();
  const providerName = config.providerName;

  if (provider === 'gemini') {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-2.0-flash')}:generateContent`;

    if (typeof AIConfig !== 'undefined' && AIConfig.checkCSPAllowed) {
      AIConfig.checkCSPAllowed(endpoint);
    }

    let systemInstruction = null;
    let rawContents = [];

    if (Array.isArray(promptOrMessages)) {
      for (const m of promptOrMessages) {
        if (m.role === 'system') {
          if (!systemInstruction) {
            systemInstruction = { parts: [{ text: String(m.content) }] };
          } else {
            systemInstruction.parts.push({ text: String(m.content) });
          }
        } else {
          const gRole = (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user';
          rawContents.push({ role: gRole, parts: [{ text: String(m.content) }] });
        }
      }
    } else {
      if (options.systemPrompt) {
        systemInstruction = { parts: [{ text: String(options.systemPrompt) }] };
      }
      rawContents.push({ role: 'user', parts: [{ text: String(promptOrMessages) }] });
    }

    if (!systemInstruction && options.systemPrompt) {
      systemInstruction = { parts: [{ text: String(options.systemPrompt) }] };
    }

    // Ensure roles strictly alternate between user and model
    const contents = [];
    for (const c of rawContents) {
      if (contents.length > 0 && contents[contents.length - 1].role === c.role) {
        contents[contents.length - 1].parts.push(...c.parts);
      } else {
        contents.push({ role: c.role, parts: [...c.parts] });
      }
    }
    if (contents.length > 0 && contents[0].role === 'model') {
      contents.unshift({ role: 'user', parts: [{ text: 'Hello' }] });
    }

    const reqBody = {
      contents,
      generationConfig: {
        temperature: options.temperature != null ? options.temperature : 0.4,
        ...(options.jsonMode ? { responseMimeType: 'application/json' } : {})
      }
    };
    if (systemInstruction) {
      reqBody.systemInstruction = systemInstruction;
    }

    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify(reqBody)
      });
    } catch (netErr) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Network Offline. An active internet connection is required to contact AI.');
      }
      if (netErr.message && netErr.message.includes('Content Security Policy')) {
        throw netErr;
      }
      throw new Error(`Network connection blocked or CORS issue contacting ${providerName}: ${netErr.message || 'Check connection'}`);
    }

    if (!res.ok) {
      // 400 JSON mode retry: retry once without json mode
      if (res.status === 400 && options.jsonMode && !options._isJsonRetry) {
        return await callAI(promptOrMessages, { ...options, jsonMode: false, _isJsonRetry: true });
      }

      const errBody = await res.json().catch(() => ({}));
      const errMsg = errBody?.error?.message || `HTTP ${res.status} ${res.statusText}`;

      if (res.status === 401 || res.status === 403 || (res.status === 400 && errMsg.includes('API_KEY_INVALID'))) {
        throw new Error(`Invalid API key for ${providerName} (${res.status}). Please verify your key in Settings.`);
      }
      if (res.status === 404) {
        throw new Error(`Model "${model}" not found for ${providerName} (404). Please refresh models in Settings and select an active model.`);
      }
      if (res.status === 429) {
        const retryAfter = res.headers ? res.headers.get('Retry-After') : null;
        const retryMsg = retryAfter ? ` Please retry after ${retryAfter} seconds.` : ' Please retry in a few moments.';
        throw new Error(`Rate limit reached for ${providerName} (429).${retryMsg}`);
      }
      throw new Error(`${providerName} Error (${res.status}): ${esc(errMsg)}`);
    }

    const data = await res.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply) throw new Error(`Empty response from ${providerName}`);
    return reply;
  } else {
    // OpenAI-Compatible standard endpoint (OpenAI, Groq, OpenRouter, Custom)
    let endpointUrl;
    if (provider === 'groq') {
      endpointUrl = 'https://api.groq.com/openai/v1/chat/completions';
    } else if (provider === 'openrouter') {
      endpointUrl = 'https://openrouter.ai/api/v1/chat/completions';
    } else if (provider === 'openai') {
      endpointUrl = 'https://api.openai.com/v1/chat/completions';
    } else if (provider === 'custom') {
      let bUrl = options.baseUrl || config.baseUrl || 'https://api.openai.com/v1';
      bUrl = bUrl.trim();
      if (!bUrl.endsWith('/chat/completions')) {
        endpointUrl = bUrl.replace(/\/+$/, '') + '/chat/completions';
      } else {
        endpointUrl = bUrl;
      }
    } else {
      endpointUrl = 'https://api.openai.com/v1/chat/completions';
    }

    if (typeof AIConfig !== 'undefined' && AIConfig.checkCSPAllowed) {
      AIConfig.checkCSPAllowed(endpointUrl);
    }

    let messages;
    if (Array.isArray(promptOrMessages)) {
      messages = promptOrMessages;
    } else {
      messages = [];
      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      messages.push({ role: 'user', content: String(promptOrMessages) });
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };

    if (provider === 'openrouter' || endpointUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = (typeof window !== 'undefined' && window.location && window.location.origin)
        ? window.location.origin
        : 'https://mygym.app';
      headers['X-Title'] = 'MyGyM';
    }

    const cleanModel = String(model || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    const bodyPayload = {
      model: cleanModel,
      messages,
      temperature: options.temperature != null ? options.temperature : 0.4,
      ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {})
    };

    let res;
    try {
      res = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload)
      });
    } catch (netErr) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Network Offline. An active internet connection is required to contact AI.');
      }
      if (netErr.message && netErr.message.includes('Content Security Policy')) {
        throw netErr;
      }
      throw new Error(`Network connection blocked or CORS issue contacting ${providerName}: ${netErr.message || 'Check connection'}`);
    }

    if (!res.ok) {
      // 400 JSON mode retry: retry once without response_format
      if (res.status === 400 && options.jsonMode && !options._isJsonRetry) {
        return await callAI(promptOrMessages, { ...options, jsonMode: false, _isJsonRetry: true });
      }

      const errBody = await res.json().catch(() => ({}));
      const errMsg = errBody?.error?.message || errBody?.message || `HTTP ${res.status} ${res.statusText}`;

      if (res.status === 401 || res.status === 403) {
        throw new Error(`Invalid API key for ${providerName} (${res.status}). Please verify your key in Settings.`);
      }
      if (res.status === 404) {
        throw new Error(`Model "${model}" not found for ${providerName} (404). Please refresh models in Settings and select an active model.`);
      }
      if (res.status === 429) {
        const retryAfter = res.headers ? res.headers.get('Retry-After') : null;
        const retryMsg = retryAfter ? ` Please retry after ${retryAfter} seconds.` : ' Please retry in a few moments.';
        throw new Error(`Rate limit reached for ${providerName} (429).${retryMsg}`);
      }
      throw new Error(`${providerName} Error (${res.status}): ${esc(errMsg)}`);
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) throw new Error(`Empty response from ${providerName}`);
    return reply;
  }
}

async function testAIConnection() {
  const statusEl = document.querySelector('#ai-conn-status');
  if (statusEl) {
    statusEl.innerHTML = `<span class="chip" style="color:var(--am);background:rgba(255,159,10,0.15)">Testing direct API connection...</span>`;
  }

  // Read key directly from DOM input if present, else stored key
  const domKeyInput = document.getElementById('ai-key-input') || document.getElementById('ai-api-key-input');
  let key = (domKeyInput && domKeyInput.value != null ? domKeyInput.value : '').trim();
  if (!key && typeof AIConfig !== 'undefined' && AIConfig.getAIKey) {
    key = AIConfig.getAIKey();
  }

  if (!key) {
    const msg = '× No API Key provided';
    toast(msg);
    if (statusEl) {
      statusEl.innerHTML = `<span class="chip" style="color:var(--rd);background:rgba(255,69,58,0.15);font-weight:600">${esc(msg)}</span>`;
    }
    return;
  }

  const domProvEl = document.getElementById('ai-provider-select');
  let provider = domProvEl && domProvEl.value ? domProvEl.value : 'auto';
  if (provider === 'auto') {
    const detected = detectProviderFromKey(key);
    provider = detected ? detected.provider : 'groq';
  }

  const settings = (typeof AIConfig !== 'undefined' && AIConfig.getAISettings) ? AIConfig.getAISettings() : {};
  const domModelEl = provider === 'custom'
    ? (document.getElementById('ai-custom-model-input') || document.getElementById('ai-model-input'))
    : document.getElementById('ai-model-select');
  let model = domModelEl && domModelEl.value != null ? domModelEl.value.trim() : '';

  const domBaseUrlEl = document.getElementById('ai-baseurl-input') || document.getElementById('ai-base-url-input');
  let baseUrl = domBaseUrlEl && domBaseUrlEl.value != null ? domBaseUrlEl.value.trim() : '';

  const providers = (typeof AIConfig !== 'undefined' && AIConfig.AI_PROVIDERS) ? AIConfig.AI_PROVIDERS : {};
  const provDef = providers[provider] || providers.openai || {};

  if (!model) {
    model = (settings.models && settings.models[provider]) || provDef.defaultModel || '';
  }
  if (!baseUrl && provider === 'custom') {
    baseUrl = settings.baseUrl || '';
  }

  const effectiveName = provider === 'custom' ? 'Custom' : (provDef.name || provider);

  try {
    // 1-token completion without saving settings
    await callAI('hi', {
      apiKey: key,
      provider,
      model,
      baseUrl,
      maxTokens: 1,
      temperature: 0.1
    });

    if (statusEl) {
      statusEl.innerHTML = `<span class="chip" style="color:var(--gn);background:rgba(48,209,88,0.15);font-weight:700">✓ Connected to ${esc(effectiveName)} (${esc(model)})</span>`;
    }
    toast(`Connected to ${effectiveName}`);
  } catch (err) {
    const errMsg = err?.message || 'Connection failed';
    if (statusEl) {
      statusEl.innerHTML = `<span class="chip" style="color:var(--rd);background:rgba(255,69,58,0.15);font-weight:600">× ${esc(errMsg)}</span>`;
    }
    toast(`AI Connection Error: ${errMsg}`);
  }
}

function findBestExerciseMatch(rawName, targetMuscle = '', equipment = '') {
  if (!rawName) return null;
  const q = String(rawName).trim().toLowerCase();
  const db = (Array.isArray(EXDB) && EXDB.length) ? EXDB : (_global.__EXDB__ || []);
  if (!db.length) return null;

  // 1. Direct name match
  let found = db.find(e => (e.name || '').toLowerCase() === q);
  if (found) return found;

  // 2. Synonyms and fuzzy matches via matchesExerciseSearch
  found = db.find(e => matchesExerciseSearch(e, q));
  if (found) return found;

  // 3. Substring match
  found = db.find(e => (e.name || '').toLowerCase().includes(q) || q.includes((e.name || '').toLowerCase()));
  if (found) return found;

  // 4. Token scoring
  const words = q.split(/\s+/).filter(w => w.length > 2);
  let best = null;
  let maxScore = 0;
  for (const e of db) {
    const en = (e.name || '').toLowerCase();
    let score = 0;
    for (const w of words) {
      if (en.includes(w)) score += 2;
    }
    if (targetMuscle && ((e.tg || '').toLowerCase().includes(targetMuscle.toLowerCase()) || (e.g || '').toLowerCase().includes(targetMuscle.toLowerCase()))) {
      score += 1;
    }
    if (equipment && (e.eq || '').toLowerCase().includes(equipment.toLowerCase())) {
      score += 1;
    }
    if (score > maxScore) {
      maxScore = score;
      best = e;
    }
  }

  return maxScore >= 2 ? best : null;
}

function findClosestExercise(targetMuscle = '', equipment = '') {
  const db = (Array.isArray(EXDB) && EXDB.length) ? EXDB : (_global.__EXDB__ || []);
  if (!db.length) return null;
  if (!targetMuscle && !equipment) return db[0];

  return db.find(e => {
    const mMatch = targetMuscle && ((e.tg || '').toLowerCase().includes(targetMuscle.toLowerCase()) || (e.g || '').toLowerCase().includes(targetMuscle.toLowerCase()));
    const eqMatch = equipment && (e.eq || '').toLowerCase().includes(equipment.toLowerCase());
    return mMatch && eqMatch;
  }) || db.find(e => {
    return targetMuscle && ((e.tg || '').toLowerCase().includes(targetMuscle.toLowerCase()) || (e.g || '').toLowerCase().includes(targetMuscle.toLowerCase()));
  }) || db[0];
}

function createCustomExerciseFromAI(name, targetMuscle = 'Chest', equipment = 'Barbell') {
  const cleanName = (name || 'Custom Exercise').trim();
  const customId = 'cust_' + uid();
  const newEx = {
    id: customId,
    name: cleanName,
    g: targetMuscle || 'Chest',
    tg: targetMuscle || 'Chest',
    eq: equipment || 'Barbell',
    type: 'strength',
    isCustom: true
  };
  S.customExercises = S.customExercises || [];
  S.customExercises.push(newEx);
  save('customExercises');
  mergeCustomExercises();
  toast(`Created custom exercise: "${cleanName}"`);
  return newEx;
}

function parseWorkoutTextOfflineFallback(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const exercises = [];
  let routineName = 'Imported Workout';

  for (const line of lines) {
    if (line.endsWith(':') && exercises.length === 0) {
      routineName = line.replace(':', '').trim();
      continue;
    }
    const cleaned = line.replace(/^\d+[\.\)]\s*/, '');
    const setRepMatch = cleaned.match(/(\d+)\s*(?:sets?\s*x\s*|x|\*)\s*(\d+)(?:\s*reps?)?/i);
    const weightMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:kg|lbs)/i) || cleaned.match(/\((\d+(?:\.\d+)?)\s*(?:kg|lbs)?\)/i);
    const namePart = cleaned.split(/[:\-\(]/)[0].trim();
    if (namePart.length >= 3) {
      exercises.push({
        name: namePart,
        sets: setRepMatch ? Number(setRepMatch[1]) : 3,
        reps: setRepMatch ? Number(setRepMatch[2]) : 8,
        w: weightMatch ? Number(weightMatch[1]) : 0,
        targetMuscle: 'General',
        equipment: 'Barbell'
      });
    }
  }

  return { name: routineName, exercises };
}

function openAIImportModal() {
  const hasKey = typeof localStorage !== 'undefined' && Boolean(localStorage.getItem('ai_api_key'));
  modal(`
    <div class="ai-import-sheet">
      <div style="flex:none">
        <h2 style="display:flex;align-items:center;gap:8px">
          ${icon('download', { size: 20 })} <span>Import Workout Routine</span>
        </h2>
        <p class="t2 sm" style="margin-top:2px;margin-bottom:10px">
          Paste text copied from workouts, notes, or upload a routine file. Exercises, sets, reps, and weights are extracted and mapped to your library.
        </p>

        <div style="font-size:11px;color:var(--t3);margin-bottom:12px;line-height:1.4;display:flex;align-items:flex-start;gap:6px">
          ${icon('lock', { size: 14 })} <span>Privacy Note: Workout text is sent directly to your configured AI provider via HTTPS using your API key. No workout data is stored on third-party servers.</span>
        </div>

        ${!hasKey ? `
          <div class="card" style="margin-bottom:12px;padding:10px 12px;background:rgba(255,159,10,0.12);border:1px solid rgba(255,159,10,0.3)">
            <div style="font-weight:700;font-size:13px;color:var(--am);margin-bottom:2px">⚠️ No API Key Configured</div>
            <div class="t2 sm">Configure your API key in Settings for automatic AI parsing, or paste JSON below for instant offline import.</div>
            <button class="btn s sm-btn" data-a="opensettings" style="margin-top:8px">Open Settings</button>
          </div>
        ` : ''}

        <div style="margin-bottom:12px">
          <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Workout Text / Notes</label>
          <textarea id="ai-import-textarea" data-id="ai-import-text" class="ai-import-textarea" style="min-height:150px;font-size:15px;border-radius:8px" placeholder="Paste your workout routine here directly (e.g. from WhatsApp, ChatGPT, or Notes):&#10;Upper A:&#10;- Incline Dumbbell Press: 3 sets x 8-10 reps&#10;- Lat Pulldown: 3 sets x 10 reps..."></textarea>
        </div>

        <div class="row" style="margin-bottom:14px;align-items:center;justify-content:space-between">
          <label class="btn s sm-btn" style="cursor:pointer;font-size:12px">
            📁 Or Upload Text / JSON File
            <input type="file" id="ai-import-file" accept=".txt,.json,.md,.csv" style="display:none">
          </label>
          <span id="ai-import-file-name" class="t2 sm"></span>
        </div>
      </div>

      <div id="ai-import-status" style="margin-bottom:10px"></div>

      <div style="flex:none">
        <button class="btn finish-save-btn" data-a="run-ai-import" style="width:100%;margin-bottom:8px">Parse &amp; Import Workout</button>
        <button class="btn s outline" data-a="closemodal" style="width:100%">Cancel</button>
      </div>
    </div>
  `);
}

function sanitizeAndValidateAIRoutine(data) {
  if (typeof data === 'string') {
    let cleaned = data.trim();
    // Enhanced markdown fence removal and brace substring extraction
    cleaned = cleaned.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, '$1').trim();
    if (!cleaned.startsWith('{') && cleaned.includes('{')) {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        cleaned = cleaned.slice(start, end + 1);
      }
    }
    data = JSON.parse(cleaned);
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid routine payload: expected JSON object');
  }
  const name = String(data.name || 'Imported AI Routine').trim().slice(0, 100);
  if (!Array.isArray(data.exercises) || !data.exercises.length) {
    throw new Error('Routine must contain an array of exercises');
  }

  // Cap exercise count per routine to 15 to eliminate hallucinated junk volume
  const clampedList = data.exercises.slice(0, 15);
  const validated = [];

  for (let i = 0; i < clampedList.length; i++) {
    const rx = clampedList[i];
    if (!rx || typeof rx !== 'object') continue;
    const exName = String(rx.name || `Exercise ${i + 1}`).trim().slice(0, 100);
    if (!exName) continue;

    // Number clamping: sets (1 to 10), reps (1 to 100), weight (>= 0)
    const rawSets = parseInt(rx.sets, 10);
    const sets = Math.min(10, Math.max(1, isNaN(rawSets) ? 3 : rawSets));
    const rawReps = parseInt(rx.reps, 10);
    const reps = Math.min(100, Math.max(1, isNaN(rawReps) ? 8 : rawReps));
    const rawReps2 = rx.reps2 != null ? parseInt(rx.reps2, 10) : reps;
    const reps2 = Math.min(100, Math.max(reps, isNaN(rawReps2) ? reps : rawReps2));
    const weightVal = rx.w != null ? rx.w : rx.weight;
    const w = Math.max(0, parseFloat(weightVal) || 0);

    validated.push({
      name: exName,
      sets,
      reps,
      reps2,
      w,
      weight: w,
      targetMuscle: String(rx.targetMuscle || '').trim().slice(0, 50),
      equipment: String(rx.equipment || '').trim().slice(0, 50),
      note: String(rx.note || '').trim().slice(0, 200)
    });
  }

  if (!validated.length) {
    throw new Error('No valid exercises could be extracted from routine');
  }

  return { name, exercises: validated };
}

async function parseAIWorkoutFromInput() {
  const textEl = document.querySelector('#ai-import-textarea') || document.querySelector('#ai-import-text');
  let rawText = (textEl ? textEl.value : '').trim();
  const fileInput = document.querySelector('#ai-import-file');

  // If textarea is empty but a file was selected, read the file contents using FileReader
  if (!rawText && fileInput && fileInput.files && fileInput.files[0]) {
    try {
      rawText = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = ev => resolve(ev.target.result || '');
        reader.onerror = err => reject(err);
        reader.readAsText(fileInput.files[0]);
      });
      rawText = (rawText || '').trim();
      if (textEl) textEl.value = rawText;
    } catch (e) {
      toast('Failed to read the uploaded file.');
      return;
    }
  }

  if (!rawText) {
    toast('Please paste your workout routine or upload a file.');
    return;
  }

  const statusEl = document.querySelector('#ai-import-status');
  if (statusEl) {
    statusEl.innerHTML = `<div class="card" style="text-align:center;padding:14px;background:rgba(0,122,255,0.1);border:1px solid rgba(0,122,255,0.3)">
      <div style="font-size:24px;margin-bottom:6px">🤖</div>
      <b>Analyzing routine with AI...</b>
      <div class="t2 sm" style="margin-top:2px">Extracting exercises, volume, and target muscle groups</div>
    </div>`;
  }

  let routineJson = null;

  const strippedText = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  if (strippedText.startsWith('{') && strippedText.endsWith('}')) {
    try {
      const parsed = JSON.parse(strippedText);
      routineJson = sanitizeAndValidateAIRoutine(parsed);
    } catch {}
  }

  if (!routineJson) {
    const hasKey = typeof localStorage !== 'undefined' && Boolean(localStorage.getItem('ai_api_key'));
    if (!hasKey) {
      const parsedFallback = parseWorkoutTextOfflineFallback(rawText);
      if (parsedFallback && parsedFallback.exercises.length) {
        try {
          routineJson = sanitizeAndValidateAIRoutine(parsedFallback);
        } catch (_) {
          routineJson = parsedFallback;
        }
      }
      if (!routineJson || !routineJson.exercises.length) {
        if (statusEl) {
          statusEl.innerHTML = `<div class="card" style="padding:10px;background:rgba(255,69,58,0.15);border:1px solid var(--rd)">
            <b>API Key Required</b>
            <div class="t2 sm">Please configure your OpenAI or Gemini API key in Settings (⚙️) to parse natural language.</div>
          </div>`;
        }
        toast('Please configure your AI API key in Settings');
        return;
      }
    } else {
      try {
        const prompt = `You are a fitness routine parser for MyGyM weightlifting PWA.
Analyze this user text and extract a structured routine into STRICT JSON.
NO markdown ticks or prose. Output ONLY valid JSON.

Schema:
{
  "name": "Routine Name",
  "exercises": [
    {
      "name": "Standard Exercise Name",
      "sets": 3,
      "reps": 8,
      "reps2": 12,
      "w": 50,
      "targetMuscle": "Chest",
      "equipment": "Barbell",
      "note": ""
    }
  ]
}

User text:
${rawText}`;

        const reply = await callAI(prompt, { jsonMode: true, temperature: 0.2 });
        const cleaned = reply.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        routineJson = sanitizeAndValidateAIRoutine(parsed);
      } catch (err) {
        if (statusEl) {
          statusEl.innerHTML = `<div class="card" style="padding:10px;background:rgba(255,69,58,0.15);border:1px solid var(--rd)">
            <b>Parsing Failed:</b> ${esc(err.message)}
          </div>`;
        }
        toast(`AI Parsing Error: ${err.message}`);
        return;
      }
    }
  }

  if (!routineJson || !Array.isArray(routineJson.exercises) || !routineJson.exercises.length) {
    if (statusEl) {
      statusEl.innerHTML = `<div class="card" style="padding:10px;background:rgba(255,69,58,0.15);border:1px solid var(--rd)">
        <b>No exercises could be extracted.</b> Please verify the text format.
      </div>`;
    }
    toast('No exercises found in workout text');
    return;
  }

  const mappedExercises = routineJson.exercises.map((rx, idx) => {
    const rawName = (rx.name || `Exercise ${idx + 1}`).trim();
    const match = findBestExerciseMatch(rawName, rx.targetMuscle, rx.equipment);
    const closest = !match ? findClosestExercise(rx.targetMuscle, rx.equipment) : null;
    return {
      rawName,
      matchedEx: match,
      closestMatch: closest,
      id: match ? match.id : (closest ? closest.id : '0025'),
      sets: Math.max(1, Number(rx.sets) || 3),
      reps: Math.max(1, Number(rx.reps) || 8),
      reps2: rx.reps2 ? Math.max(Number(rx.reps) || 8, Number(rx.reps2)) : (Number(rx.reps) || 8) + 2,
      w: Math.max(0, Number(rx.w) || 0),
      targetMuscle: rx.targetMuscle || (match ? (match.tg || match.g) : 'Full Body'),
      equipment: rx.equipment || (match ? match.eq : 'Barbell'),
      note: rx.note || '',
      isCustomNeeded: !match
    };
  });

  parsedAIRoutine = {
    name: (routineJson.name || 'Imported AI Routine').trim(),
    exercises: mappedExercises
  };

  renderAIImportPreview();
}

function renderAIImportPreview() {
  if (!parsedAIRoutine) return;
  const p = parsedAIRoutine;

  modal(`
    <div class="ai-import-sheet">
      <div style="flex:none">
        <h2 style="display:flex;align-items:center;gap:8px">
          <span>✨</span> Workout Import Preview
        </h2>
        <p class="t2 sm" style="margin-top:2px;margin-bottom:12px">
          Review extracted exercises and library mappings before saving to your routines.
        </p>

        <div style="margin-bottom:12px">
          <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Routine Name</label>
          <input type="text" id="ai-preview-name" class="txt" value="${esc(p.name)}" style="width:100%;padding:10px;font-weight:600">
        </div>
      </div>

      <div style="overflow-y:auto;flex:1;margin-bottom:12px;padding-right:2px">
        ${p.exercises.map((rx, idx) => {
          const resolvedEx = X(rx.id);
          return `
            <div class="ai-preview-card">
              <div class="row" style="margin-bottom:6px">
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:6px">
                    <span style="font-weight:700;color:var(--ac);font-size:13px">${idx + 1}.</span>
                    <b style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(resolvedEx.name)}</b>
                    ${rx.isCustomNeeded ? `<span class="chip" style="font-size:10px;color:var(--am);background:rgba(255,159,10,0.15)">Auto-Matched</span>` : `<span class="chip" style="font-size:10px;color:var(--gn);background:rgba(48,209,88,0.15)">Library Match</span>`}
                  </div>
                  <div class="t2 sm" style="margin-top:2px">Pasted as: "${esc(rx.rawName)}" · ${esc(resolvedEx.tg || resolvedEx.g)} (${esc(resolvedEx.eq)})</div>
                </div>
              </div>

              ${rx.isCustomNeeded ? `
                <div style="margin:6px 0;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:6px;font-size:11px" class="row">
                  <span>Not in library?</span>
                  <button class="btn s sm-btn" data-a="add-custom-ai-ex" data-i="${idx}" style="font-size:11px;padding:2px 8px">+ Add as Custom Exercise</button>
                </div>
              ` : ''}

              <div class="row" style="font-size:12px;font-weight:600;color:var(--t1)">
                <span>${rx.sets} sets × ${rx.reps}${rx.reps2 > rx.reps ? '-' + rx.reps2 : ''} reps</span>
                <span>${rx.w > 0 ? rx.w + ' kg' : 'Bodyweight'}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div style="flex:none">
        <button class="btn finish-save-btn" data-a="commit-ai-routine" style="width:100%;margin-bottom:8px">💾 Save to My Routines</button>
        <button class="btn s" data-a="start-ai-routine" style="width:100%;margin-bottom:8px">⚡ Save & Start Workout Immediately</button>
        <button class="btn s outline" data-a="closemodal" style="width:100%">Cancel</button>
      </div>
    </div>
  `);
}

function commitAIRoutine(startImmediately = false) {
  if (!parsedAIRoutine) return;
  const nameInput = document.querySelector('#ai-preview-name');
  const routineName = (nameInput && nameInput.value ? nameInput.value.trim() : parsedAIRoutine.name) || 'Imported AI Routine';

  const newRoutine = {
    id: uid(),
    name: routineName,
    ex: parsedAIRoutine.exercises.map(rx => ({
      id: rx.id,
      sets: rx.sets,
      reps: rx.reps,
      reps2: rx.reps2,
      w: rx.w,
      inc: 2.5,
      note: rx.note || ''
    }))
  };

  S.routines = S.routines || [];
  S.routines.push(newRoutine);
  save('routines');
  closeModal();
  toast(`Routine "${routineName}" saved! 🏆`);

  if (startImmediately) {
    startWorkout(newRoutine.id);
  } else {
    view = 'train';
    render();
  }
}

function openAICoachDrawer(initialPrompt = null) {
  const hasKey = typeof localStorage !== 'undefined' && Boolean(localStorage.getItem('ai_api_key'));
  const model = (typeof localStorage !== 'undefined' ? localStorage.getItem('ai_model') : null) || ((typeof localStorage !== 'undefined' && localStorage.getItem('ai_provider') === 'gemini') ? 'gemini-1.5-flash' : 'gpt-4o-mini');

  let curExName = 'Bench Press';
  let curExWeight = 60;
  if (S.act && S.act.ex && S.act.ex.length) {
    const curEx = S.act.ex[S.act.curEx || 0];
    if (curEx) {
      const eObj = X(curEx.id);
      curExName = eObj ? eObj.name : 'Current Exercise';
      const lastSet = (curEx.sets || []).find(s => s.w > 0) || curEx.sets?.[0];
      if (lastSet && lastSet.w) curExWeight = lastSet.w;
    }
  }

  if (!aiCoachHistory.length) {
    aiCoachHistory.push({
      role: 'assistant',
      content: `Hi! I'm your Workout Coach (${model}). Ask me for real-time form cues, warm-up set breakdowns, alternative exercises, or progressive overload advice.`
    });
  }

  modal(`
    <div class="ai-coach-sheet">
      <div class="ai-coach-header">
        <div class="ai-coach-title-group">
          <div class="ai-coach-avatar">${icon('message', { size: 18 })}</div>
          <div>
            <div style="font-weight:700;font-size:15px;display:flex;align-items:center;gap:6px">
              <span>Workout Coach</span>
              <span class="chip on" style="font-size:10px;padding:1px 6px">${esc(model)}</span>
            </div>
            <div class="t2 sm">${S.act ? `Active Session: ${esc(S.act.name)}` : 'On-Demand Training Assistant'}</div>
          </div>
        </div>
        <button class="btn s sm-btn outline" data-a="closemodal" style="padding:4px 10px" aria-label="Close coach drawer">✕</button>
      </div>

      <div style="font-size:11px;color:var(--t3);margin:8px 0 2px;line-height:1.4;display:flex;align-items:center;gap:6px">
        ${icon('lock', { size: 12 })} <span>Privacy Note: Messages are sent directly to your configured AI provider using your API key.</span>
      </div>

      ${!hasKey ? `
        <div class="card" style="margin:10px 0 0;padding:10px;background:rgba(255,159,10,0.12);border:1px solid rgba(255,159,10,0.3)">
          <div style="font-weight:700;font-size:12px;color:var(--am)">⚠️ API Key Needed for Live Answers</div>
          <div class="t2 sm" style="margin-top:2px">Configure your API key in Settings to chat with the coach.</div>
          <button class="btn s sm-btn" data-a="opensettings" style="margin-top:6px;font-size:11px">Open Settings</button>
        </div>
      ` : ''}

      <div class="ai-chat-messages" id="ai-chat-messages">
        ${aiCoachHistory.map(m => `
          <div class="ai-msg ${m.role === 'user' ? 'ai-msg-user' : 'ai-msg-assistant'}">
            ${m.role === 'assistant' ? `<div style="font-size:11px;font-weight:700;color:var(--ac);margin-bottom:3px;display:flex;align-items:center;gap:4px">${icon('message', { size: 12 })} <span>COACH</span></div>` : ''}
            <div>${esc(m.content).replace(/\n/g, '<br>')}</div>
          </div>
        `).join('')}
      </div>

      <!-- Quick Context Chips -->
      <div class="ai-quick-chips">
        <button class="ai-chip" data-a="ai-quick-prompt" data-p="Give me 3 critical form cues and execution tips for ${esc(curExName)}">💡 Form Cues</button>
        <button class="ai-chip" data-a="ai-quick-prompt" data-p="Calculate optimal warm-up sets building up to ${curExWeight}kg on ${esc(curExName)}">⚡ Warm-up Sets</button>
        <button class="ai-chip" data-a="ai-quick-prompt" data-p="Suggest 2 alternative exercises targeting the same muscles if the equipment for ${esc(curExName)} is taken">🔄 Equipment Busy?</button>
        <button class="ai-chip" data-a="ai-quick-prompt" data-p="How should I break through a plateau if I missed my rep target on ${esc(curExName)}?">📈 Rep Plateau Advice</button>
      </div>

      <div class="ai-input-bar">
        <input type="text" id="ai-chat-input" placeholder="Ask about form, warm-ups, substitutions...">
        <button class="ai-send-btn" data-a="send-ai-coach-msg" title="Send Question">➤</button>
      </div>
    </div>
  `);

  const msgContainer = document.querySelector('#ai-chat-messages');
  if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;

  if (initialPrompt) {
    sendAICoachMessage(initialPrompt);
  }
}

async function sendAICoachMessage(userText) {
  const input = document.querySelector('#ai-chat-input');
  const text = (userText || (input ? input.value : '')).trim();
  if (!text) return;
  if (input) input.value = '';

  aiCoachHistory.push({ role: 'user', content: text });

  const msgContainer = document.querySelector('#ai-chat-messages');
  if (msgContainer) {
    msgContainer.innerHTML += `
      <div class="ai-msg ai-msg-user">
        <div>${esc(text).replace(/\n/g, '<br>')}</div>
      </div>
      <div class="ai-msg ai-msg-assistant" id="ai-coach-loading">
        <div style="font-size:11px;font-weight:700;color:var(--ac);margin-bottom:3px">🤖 COACH</div>
        <div class="t2 sm">Thinking...</div>
      </div>
    `;
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  let systemContext = 'You are an elite strength & bodybuilding coach embedded in MyGyM PWA. Keep answers concise (2-4 sentences max), direct, and actionable for a lifter in the gym.';
  if (S.act) {
    const curEx = S.act.ex[S.act.curEx || 0];
    const eObj = curEx ? X(curEx.id) : null;
    systemContext += `\nLifter's active workout: "${S.act.name}". Current exercise: ${eObj ? eObj.name : 'Unknown'}. Equipment: ${eObj ? eObj.eq : 'N/A'}. Target: ${eObj ? (eObj.tg || eObj.g) : 'N/A'}.`;
  }

  try {
    const messages = [
      { role: 'system', content: systemContext },
      ...aiCoachHistory.slice(-8)
    ];
    const reply = await callAI(messages, { temperature: 0.4 });
    aiCoachHistory.push({ role: 'assistant', content: reply });

    const loadingEl = document.querySelector('#ai-coach-loading');
    if (loadingEl) {
      loadingEl.id = '';
      loadingEl.innerHTML = `
        <div style="font-size:11px;font-weight:700;color:var(--ac);margin-bottom:3px">🤖 COACH</div>
        <div>${esc(reply).replace(/\n/g, '<br>')}</div>
      `;
    }
  } catch (err) {
    const loadingEl = document.querySelector('#ai-coach-loading');
    if (loadingEl) {
      loadingEl.id = '';
      loadingEl.innerHTML = `
        <div style="font-size:11px;font-weight:700;color:var(--rd);margin-bottom:3px">⚠️ ERROR</div>
        <div>${esc(err.message)}</div>
      `;
    }
  }

  if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
}

// ---- Finish Workout ----
let isCommitting = false;

function finishWorkout() {
  if (isCommitting) return;
  isCommitting = true;

  try {
    const a = S.act;
    if (!a) {
      closeModal();
      return;
    }

    const activeBackupKey = 'backup_act_' + Date.now();
    try {
      localStorage.setItem(activeBackupKey, JSON.stringify(a));
    } catch (_) {}

    const exercises = Array.isArray(a.ex) ? a.ex : [];
    const t0 = a.t0 || (Date.now() - 3600000);
    const curDur = Math.max(1000, Date.now() - t0);
    const curDurMin = Math.round(curDur / 60000);
    const isDeload = !!a.isDeload;

    let ex = [];
    let curVol = 0;
    let totalSetsCount = 0;
    let sessionPRs = [];
    let notes = [];
    let volDeltaHtml = '';
    let durDeltaHtml = '';
    let setsDeltaHtml = '';
    let rirSummaryHtml = '';
    let failureHtml = '';
    let deloadHtml = isDeload ? `<div class="row" style="margin-top:6px"><b>Protocol:</b> <span style="color:var(--gn)">Deload Recovery Session (-50% target sets)</span></div>` : '';
    let microInc = 0.3;
    let r = null;

    try {
      const mapSetType = (t) => {
        if (!t) return 'normal';
        const low = String(t).toLowerCase();
        if (low === 'w' || low === 'warmup') return 'warmup';
        if (low === 'd' || low === 'drop') return 'drop';
        if (low === 'f' || low === 'failure') return 'failure';
        if (low === 'a' || low === 'amrap') return 'amrap';
        return 'normal';
      };

      // 1. Process exercises and completed sets
      ex = exercises.map(x => ({
        id: x.id,
        note: x.note || '',
        uni: !!x.uni,
        sets: (Array.isArray(x.sets) ? x.sets : []).filter(s => s && (s.done || (x.uni && (s.sideL || s.sideR)))).map(s => {
          const rirVal = s.rir != null && s.rir !== '' ? Number(s.rir) : (s.rpe != null && s.rpe !== '' ? Math.max(0, 10 - Number(s.rpe)) : null);
          const isDone = s.done || (x.uni && s.sideL && s.sideR);
          return {
            w: Math.max(0, Number(s.w) || 0),
            r: Math.max(0, Number(s.r) || 0),
            rpe: s.rpe === '' || s.rpe == null ? (rirVal != null ? 10 - rirVal : null) : Number(s.rpe),
            rir: rirVal,
            type: mapSetType(s.type),
            uni: !!x.uni,
            sideL: !!s.sideL,
            sideR: !!s.sideR,
            done: !!isDone
          };
        })
      })).filter(x => x.sets.length > 0);

      // If no sets completed, preserve all exercises with logged sets so 0 completed sets still saves safely
      if (!ex.length) {
        ex = exercises.map(x => ({
          id: x.id,
          note: x.note || '',
          uni: !!x.uni,
          sets: (Array.isArray(x.sets) ? x.sets : []).map(s => ({
            w: Math.max(0, Number(s.w) || 0),
            r: Math.max(0, Number(s.r) || 0),
            rpe: s.rpe === '' || s.rpe == null ? null : Number(s.rpe),
            rir: s.rir != null && s.rir !== '' ? Number(s.rir) : null,
            type: mapSetType(s.type),
            uni: !!x.uni,
            sideL: !!s.sideL,
            sideR: !!s.sideR,
            done: Boolean(s.done || (x.uni && s.sideL && s.sideR))
          }))
        }));
      }

      // Detect PRs achieved during active session
      ex.forEach(x => {
        const e = X(x.id);
        (x.sets || []).forEach((s, idx) => {
          try {
            const pr = checkSetPR(x.id, s, x.uni);
            if (pr) {
              sessionPRs.push({
                exName: e?.name || cleanExName(x.id),
                setIdx: idx + 1,
                type: pr.type,
                desc: pr.desc,
                w: s.w,
                r: s.r
              });
            }
          } catch (prErr) {
            console.warn('PR check error:', prErr);
          }
        });
      });

      r = Array.isArray(S.routines) ? S.routines.find(rt => rt && rt.id === a.rid) : null;
      if (r && Array.isArray(r.ex)) {
        lastRoutineSyncBackup = {
          rid: r.id,
          backup: r.ex.map(rx => ({
            id: rx.id,
            sets: Array.isArray(rx.sets) ? rx.sets.map(s => ({ ...s })) : rx.sets
          })),
          appliedEx: ex
        };

        ex.forEach(completedEx => {
          const rx = r.ex.find(q => q && String(q.id) === String(completedEx.id));
          if (rx && Array.isArray(rx.sets)) {
            completedEx.sets.forEach((s, idx) => {
              if (rx.sets[idx] && s.w > 0) {
                rx.sets[idx].w = s.w;
              }
            });
          }
        });

        exercises.forEach(x => {
          const rx = r.ex.find(q => q && String(q.id) === String(x.id));
          if (rx) {
            if (x.note !== undefined) rx.note = x.note;
            if (x.uni !== undefined) rx.uni = x.uni;
            if (Array.isArray(x.sets) && x.sets.some(s => s && (s.done || s.sideL || s.sideR))) {
              try {
                const pRes = prog(rx, x.sets);
                if (pRes) notes.push((X(x.id)?.name || cleanExName(x.id)) + ': ' + pRes);
              } catch (pErr) {
                console.warn('prog error:', pErr);
              }
            }
          }
        });
      }

      // RIR & Fatigue Session Summary
      const allLoggedSets = ex.flatMap(x => x.sets || []);
      const setsWithRir = allLoggedSets.filter(s => s.rir != null);
      if (setsWithRir.length) {
        const sumRir = setsWithRir.reduce((acc, s) => acc + s.rir, 0);
        const avgRir = Math.round((sumRir / setsWithRir.length) * 10) / 10;
        let zoneTitle = '';
        let zoneColor = 'var(--gn)';
        if (avgRir <= 1.0) {
          zoneTitle = 'High Strain / Peaking Zone';
          zoneColor = 'var(--rd)';
        } else if (avgRir <= 2.5) {
          zoneTitle = 'Optimal Hypertrophy Zone';
          zoneColor = 'var(--gn)';
        } else {
          zoneTitle = 'Submaximal / Recovery Zone';
          zoneColor = 'var(--bl)';
        }
        rirSummaryHtml = `<div class="row" style="margin-top:6px"><b>Fatigue & Intensity:</b> <span style="font-weight:600;color:${zoneColor}">${zoneTitle}: Avg RIR ${avgRir}</span></div>`;
      }

      const failSetsCount = allLoggedSets.filter(s => s.rir === 0 || s.rpe >= 10).length;
      if (failSetsCount > 0) {
        failureHtml = `<div class="row" style="margin-top:6px"><b>High Fatigue Sets:</b> <span style="color:var(--rd)">💥 ${failSetsCount} set(s) taken to Failure (RIR 0)</span></div>`;
      }

      // Volume & Deltas
      S.logs = S.logs || [];
      const prevLog = S.logs.filter(l => l && l.name === a.name).at(-1) || S.logs.at(-1);
      curVol = ex.reduce((sum, x) => sum + (x.sets || []).reduce((sSum, s) => {
        if (Calc.isWarmupSet ? Calc.isWarmupSet(s) : (s.type === 'W' || s.type === 'warmup')) return sSum;
        return sSum + ((Number(s.w) || 0) * (Number(s.r) || 0) * (x.uni ? 2 : 1));
      }, 0), 0);
      if (prevLog) {
        const prevVol = vol(prevLog);
        if (prevVol > 0) {
          const dVol = curVol - prevVol;
          const pctVol = Math.round((dVol / prevVol) * 1000) / 10;
          if (dVol > 0) {
            volDeltaHtml = `<span class="delta-pos">+${dVol} kg (+${pctVol}%) vs last session</span>`;
          } else if (dVol < 0) {
            volDeltaHtml = `<span class="delta-neg">${dVol} kg (${pctVol}%) vs last session</span>`;
          } else {
            volDeltaHtml = `<span class="delta-flat">0 kg (0%) vs last session</span>`;
          }
        }
        if (prevLog.dur) {
          const prevDurMin = Math.round(prevLog.dur / 60000);
          const diffDur = curDurMin - prevDurMin;
          durDeltaHtml = `<span class="t2 sm"> (${diffDur >= 0 ? '+' : ''}${diffDur} min vs last)</span>`;
        }
        if (Array.isArray(prevLog.ex)) {
          const prevSetsCount = prevLog.ex.reduce((acc, x) => acc + (Array.isArray(x.sets) ? x.sets.length : 0), 0);
          totalSetsCount = ex.reduce((acc, x) => acc + (x.sets ? x.sets.length : 0), 0);
          const diffSets = totalSetsCount - prevSetsCount;
          setsDeltaHtml = `<span class="t2 sm"> (${diffSets >= 0 ? '+' : ''}${diffSets} sets vs last)</span>`;
        }
      }
      totalSetsCount = ex.reduce((acc, x) => acc + (x.sets ? x.sets.length : 0), 0);

      // Micro-progress increment
      const baseInc = 0.3;
      const volBonus = curVol >= 3500 ? 0.1 : 0;
      const streakBonus = streak() >= 2 ? 0.1 : 0;
      microInc = Math.min(0.5, Math.round((baseInc + volBonus + streakBonus) * 10) / 10);
      if (!S.cfg.physique) S.cfg.physique = getDefaultPhysiqueConfig(S.cfg.bodyModel);
      S.cfg.physique.microProgressBonus = Math.round(((S.cfg.physique.microProgressBonus || 0) + microInc) * 10) / 10;
    } catch (statsErr) {
      console.warn('finishWorkout stats calculation failed, falling back to raw session log:', statsErr);
      ex = exercises.map(x => ({
        id: x.id,
        note: x.note || '',
        uni: !!x.uni,
        sets: (Array.isArray(x.sets) ? x.sets : []).map(s => ({
          w: Math.max(0, Number(s.w) || 0),
          r: Math.max(0, Number(s.r) || 0),
          rpe: Number(s.rpe) || null,
          rir: Number(s.rir) || null,
          uni: !!x.uni,
          sideL: !!s.sideL,
          sideR: !!s.sideR,
          done: Boolean(s.done || (x.uni && s.sideL && s.sideR))
        }))
      }));
      curVol = 0;
      totalSetsCount = ex.reduce((acc, x) => acc + (x.sets ? x.sets.length : 0), 0);
    }

    const userWeight = (S.weights && S.weights.filter(x => x.w > 0).at(-1)?.w) || (S.cfg?.physique?.weight) || 75;
    const burn = (Calc.calcWorkoutCalorieBurn)
      ? Calc.calcWorkoutCalorieBurn(curDur, userWeight, 5.5, curVol)
      : { activeCals: 0, epocCals: 0, totalBurn: 0 };

    const completedWorkout = {
      id: uid(),
      date: Date.now(),
      name: a.name || 'Workout',
      dur: curDur,
      note: a.note || '',
      ex,
      isDeload,
      burn
    };

    // Commit sequence:
    // 1. Push to S.logs and save('logs', S.logs)
    S.logs = S.logs || [];
    S.logs.push(completedWorkout);
    save('logs', S.logs);

    // Delete transient active session backup immediately upon successful commit to history
    try { localStorage.removeItem(activeBackupKey); } catch (_) {}
    pruneEmergencyBackups();

    // 2. S.act = null; localStorage.removeItem('act'); save('act', null)
    S.act = null;
    ls.set('act', null);
    try { localStorage.removeItem('act'); } catch (_) {}
    try { localStorage.removeItem('lift_act'); } catch (_) {}
    save('act', null);
    try { save('routines'); } catch (_) {}
    try { save('cfg'); } catch (_) {}
    try { stopRest(); } catch (_) {}
    try { wl?.release?.(); } catch (_) {}

    // Check if deferred Service Worker update was waiting for workout completion
    if (window._pendingSWReload) {
      setTimeout(() => {
        window.location.reload();
      }, 2500);
    }

    // 3. Close modal immediately
    closeModal();

    // 4. Trigger summary celebration and render()
    view = 'train';
    try {
      modal(`<h2>Workout Complete! 🏆</h2>
        <div class="transformation-celebration-banner">
          <span class="tcb-fire">🔥</span>
          <div class="tcb-body">
            <div class="tcb-title">Transformation Progress: +${microInc}% today!</div>
            <div class="tcb-sub">1 workout closer to your goal physique 🔥</div>
          </div>
        </div>
        ${mmLog(completedWorkout)}
        <div class="card" style="margin:12px 0;padding:12px;background:rgba(255,159,10,0.08);border:1px solid rgba(255,159,10,0.25);border-radius:14px">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:24px">🔥</span>
            <div>
              <div style="font-weight:700;font-size:15px;color:var(--am)">Calories Burned: ${burn.totalBurn} kcal</div>
              <div class="t2 sm" style="margin-top:2px">${burn.activeCals} kcal (Active) + ${burn.epocCals} kcal (EPOC Afterburn) = Total ${burn.totalBurn} kcal</div>
            </div>
          </div>
        </div>
        <div class="card" style="margin:12px 0;padding:12px">
          <div class="row">
            <b>Total Volume:</b>
            <div style="text-align:right">
              <span>${curVol} kg</span>
              ${volDeltaHtml ? `<br>${volDeltaHtml}` : ''}
            </div>
          </div>
          <div class="row" style="margin-top:8px">
            <b>Duration:</b>
            <span>${curDurMin} min${durDeltaHtml}</span>
          </div>
          <div class="row" style="margin-top:8px">
            <b>Completed Exercises:</b>
            <span>${completedWorkout.ex.length}</span>
          </div>
          <div class="row" style="margin-top:8px">
            <b>Completed Sets:</b>
            <span>${totalSetsCount}${setsDeltaHtml}</span>
          </div>
          ${rirSummaryHtml}
          ${failureHtml}
          ${deloadHtml}
          <div class="row" style="margin-top:8px">
            <b>Active Streak:</b>
            <span>${streak()} days 🔥</span>
          </div>
        </div>
        ${r ? `
          <div class="card" style="margin:12px 0;padding:12px">
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:600">
              <input type="checkbox" id="sync-routine-weights-toggle" data-a="togglesyncweights" checked style="width:20px;height:20px;accent-color:var(--ac)">
              <span>Update routine base weights with today's completed weights</span>
            </label>
          </div>
        ` : ''}
        ${sessionPRs.length ? `
          <h2 style="color:var(--accent-achievement);display:flex;align-items:center;gap:6px">
            <span>🏆</span> New Personal Records!
          </h2>
          <div style="margin-bottom:12px">
            ${sessionPRs.map(p => `
              <div class="pr-trophy-card">
                <div class="pr-trophy-icon">🏆</div>
                <div class="pr-trophy-content">
                  <div class="pr-trophy-title">${esc(p.exName)} · Set ${p.setIdx}</div>
                  <div class="pr-trophy-desc">${esc(p.desc)} (${p.w > 0 ? p.w + ' kg × ' : ''}${p.r} reps)</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${notes.length ? `<h2>Next Session Targets 📈</h2>${notes.map(p => `<div class="card t2" style="padding:10px">${esc(p)}</div>`).join('')}` : ''}
      `);
    } catch (modalErr) {
      console.warn('Summary celebration modal rendering error:', modalErr);
      toast('🏆 Workout saved successfully!');
    }

    render();
  } catch (err) {
    console.error('finishWorkout error:', err);
    try {
      if (S.act) {
        const fallbackWorkout = {
          id: uid(),
          date: Date.now(),
          name: S.act.name || 'Workout',
          dur: 60000,
          ex: S.act.ex || []
        };
        S.logs = S.logs || [];
        S.logs.push(fallbackWorkout);
        save('logs', S.logs);
        S.act = null;
        save('act', null);
        try { localStorage.removeItem('act'); } catch (_) {}
      }
      closeModal();
      view = 'train';
      render();
      toast('🏆 Workout saved (recovered)!');
    } catch (_) {
      closeModal();
    }
  } finally {
    isCommitting = false;
  }
}

// ---- Log Past / Missed Workout Engine (Backdated Logging) ----
let pastWorkout = null;

function openPastWorkoutModal(defaultDate) {
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const targetDate = defaultDate || (view === 'cal' && calSelectedDate ? calSelectedDate : yest);

  const defaultRoutine = (Array.isArray(S.routines) && S.routines.length) ? S.routines[0] : null;
  pastWorkout = {
    date: targetDate,
    time: '10:00',
    name: defaultRoutine ? defaultRoutine.name : 'Custom Past Workout',
    routineId: defaultRoutine ? defaultRoutine.id : 'custom',
    dur: 45,
    ex: defaultRoutine ? defaultRoutine.ex.map(rx => ({
      id: rx.id,
      note: rx.note || '',
      uni: !!rx.uni,
      sets: Array.isArray(rx.sets) && rx.sets.length
        ? rx.sets.map(s => ({ w: Number(s.w) || 0, r: Number(s.r) || 8 }))
        : [
            { w: Number(rx.w) || 0, r: Number(rx.reps) || 8 },
            { w: Number(rx.w) || 0, r: Number(rx.reps) || 8 },
            { w: Number(rx.w) || 0, r: Number(rx.reps) || 8 }
          ]
    })) : [
      {
        id: '0025',
        note: '',
        uni: false,
        sets: [{ w: 60, r: 10 }, { w: 60, r: 10 }, { w: 60, r: 10 }]
      }
    ]
  };

  renderPastWorkoutModal();
}

function renderPastWorkoutModal() {
  if (!pastWorkout) return;
  const p = pastWorkout;
  const curTargetTs = new Date((p.date || new Date().toISOString().slice(0, 10)) + 'T' + (p.time || '10:00') + ':00').getTime();

  modal(`
    <div class="past-workout-sheet" style="max-height:85vh;display:flex;flex-direction:column">
      <div style="flex:none">
        <h2 style="display:flex;align-items:center;gap:8px">
          <span>📅</span> Log Past / Missed Workout
        </h2>
        <p class="t2 sm" style="margin-top:2px;margin-bottom:12px">
          Backdate a completed workout to maintain your streak, tonnage, and weekly muscle volume.
        </p>

        <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px">
          <label style="font-size:12px;font-weight:600">
            Workout Date
            <input type="date" id="past-workout-date" data-f="pastdate" class="txt" value="${esc(p.date)}" max="${new Date().toISOString().slice(0, 10)}" style="margin-top:4px;padding:8px">
          </label>
          <label style="font-size:12px;font-weight:600">
            Start Time
            <input type="time" id="past-workout-time" data-f="pasttime" class="txt" value="${esc(p.time || '10:00')}" style="margin-top:4px;padding:8px">
          </label>
        </div>

        <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px">
          <label style="font-size:12px;font-weight:600">
            Duration (min)
            <input type="number" id="past-workout-dur" data-f="pastdur" class="txt" value="${p.dur || 45}" min="5" max="360" style="margin-top:4px;padding:8px">
          </label>
          <label style="font-size:12px;font-weight:600">
            Template Source
            <select id="past-workout-routine" data-f="pastroutine" class="txt" style="margin-top:4px;padding:8px;width:100%">
              ${(S.routines || []).map(r => `
                <option value="${esc(r.id)}" ${p.routineId === r.id ? 'selected' : ''}>${esc(r.name)}</option>
              `).join('')}
              <option value="custom" ${p.routineId === 'custom' ? 'selected' : ''}>⚡ Custom</option>
            </select>
          </label>
        </div>

        <div style="margin-bottom:12px">
          <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Workout Name</label>
          <input type="text" id="past-workout-name" data-f="pastname" class="txt" value="${esc(p.name)}" placeholder="e.g. Push Hypertrophy, Upper Body" style="padding:8px;width:100%">
        </div>

        <div class="row" style="margin-bottom:8px">
          <b>Completed Exercises (${p.ex.length}):</b>
          <button class="btn s sm-btn" data-a="pastaddex" style="font-size:11px;padding:4px 8px">${ic('plus', 14)} Add Exercise</button>
        </div>
      </div>

      <div id="past-workout-ex-list" style="overflow-y:auto;flex:1;padding-right:2px;margin-bottom:14px">
        ${p.ex.map((x, xIdx) => {
          const exInfo = X(x.id);
          const prevPerf = Calc.getPrevPerformance ? Calc.getPrevPerformance(x.id, S.logs, curTargetTs) : null;
          const prevStr = prevPerf && prevPerf.lastSet ? `Prev: ${prevPerf.lastSet.w}kg × ${prevPerf.lastSet.r}` : '';
          return `
            <div class="card" style="margin-bottom:10px;padding:10px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08)">
              <div class="row" style="margin-bottom:8px">
                <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
                  <span style="font-weight:700;color:var(--ac);font-size:14px">${xIdx + 1}.</span>
                  <div style="flex:1;min-width:0">
                    <div style="display:flex;align-items:center;gap:6px">
                      <span style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(exInfo.name)}</span>
                      ${prevStr ? `<span class="chip" style="font-size:10px;padding:1px 6px;opacity:0.8">${esc(prevStr)}</span>` : ''}
                    </div>
                    <div class="t2 sm">${esc(exInfo.tg || exInfo.g)} · ${esc(exInfo.eq)}</div>
                  </div>
                </div>
                <button class="btn s sm-btn red" data-a="pastrmex" data-x="${xIdx}" title="Remove Exercise" style="font-size:11px;padding:2px 8px">✕</button>
              </div>

              <!-- Set headers -->
              <div style="display:grid;grid-template-columns:36px 1fr 1fr 32px;gap:6px;align-items:center;margin-bottom:4px;font-size:11px;font-weight:600;color:var(--t2);text-align:center">
                <span>SET</span>
                <span>KG</span>
                <span>REPS</span>
                <span></span>
              </div>

              <!-- Set rows -->
              ${x.sets.map((s, sIdx) => `
                <div style="display:grid;grid-template-columns:36px 1fr 1fr 32px;gap:6px;align-items:center;margin-bottom:6px">
                  <span style="font-weight:700;font-size:12px;text-align:center;color:var(--t2)">${sIdx + 1}</span>
                  <input type="number" inputmode="decimal" class="txt" data-f="pastsetw" data-x="${xIdx}" data-s="${sIdx}" value="${s.w != null ? s.w : 0}" step="0.5" style="padding:6px;text-align:center;font-weight:600;height:34px">
                  <input type="number" inputmode="numeric" class="txt" data-f="pastsetr" data-x="${xIdx}" data-s="${sIdx}" value="${s.r != null ? s.r : 8}" min="1" max="999" style="padding:6px;text-align:center;font-weight:600;height:34px">
                  <button class="btn s sm-btn red" data-a="pastrmset" data-x="${xIdx}" data-s="${sIdx}" ${x.sets.length <= 1 ? 'disabled style="opacity:0.25"' : ''} style="padding:0;height:34px;width:32px;line-height:34px;text-align:center">✕</button>
                </div>
              `).join('')}

              <div class="row" style="margin-top:6px">
                <button class="btn s sm-btn" data-a="pastaddset" data-x="${xIdx}" style="font-size:11px;padding:3px 10px">${ic('plus', 12)} Add Set</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div style="flex:none">
        <button class="btn finish-save-btn" data-a="savepastworkout" style="width:100%;margin-bottom:8px">Save to History 💾</button>
        <button class="btn s outline" data-a="closemodal" style="width:100%">Cancel</button>
      </div>
    </div>
  `);
}

function savePastWorkout() {
  if (!pastWorkout) return;
  const p = pastWorkout;

  // Sync latest values from DOM if present
  const dateInput = $('#past-workout-date');
  if (dateInput && dateInput.value) p.date = dateInput.value;
  const timeInput = $('#past-workout-time');
  if (timeInput && timeInput.value) p.time = timeInput.value;
  const durInput = $('#past-workout-dur');
  if (durInput && durInput.value) p.dur = Number(durInput.value) || 45;
  const nameInput = $('#past-workout-name');
  if (nameInput && nameInput.value) p.name = nameInput.value;

  // Read all set inputs from DOM
  p.ex.forEach((x, xIdx) => {
    x.sets.forEach((s, sIdx) => {
      const wEl = document.querySelector(`input[data-f="pastsetw"][data-x="${xIdx}"][data-s="${sIdx}"]`);
      if (wEl) s.w = Math.max(0, Number(wEl.value) || 0);
      const rEl = document.querySelector(`input[data-f="pastsetr"][data-x="${xIdx}"][data-s="${sIdx}"]`);
      if (rEl) s.r = Math.max(0, Number(rEl.value) || 0);
    });
  });

  const validEx = p.ex.map(x => ({
    id: x.id,
    note: x.note || '',
    uni: !!x.uni,
    sets: (x.sets || []).map(s => ({
      w: Math.max(0, Number(s.w) || 0),
      r: Math.max(0, Number(s.r) || 0),
      done: true
    })).filter(s => s.w > 0 || s.r > 0 || true)
  })).filter(x => x.sets.length > 0);

  if (!validEx.length) {
    toast('Add at least one exercise with completed sets');
    return;
  }

  const dateStr = p.date || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const timeStr = p.time || '10:00';
  const workoutTimestamp = new Date(dateStr + 'T' + timeStr + ':00').getTime();
  const durMs = Math.max(5, Number(p.dur) || 45) * 60000;
  const workoutName = (p.name || 'Backdated Workout').trim();

  // Guard against future dates
  if (workoutTimestamp > Date.now() + 60000) {
    toast('Cannot log workouts in the future');
    return;
  }

  const completedLog = {
    id: p.id || uid(),
    date: workoutTimestamp,
    name: workoutName,
    dur: durMs,
    ex: validEx,
    isDeload: !!p.isDeload,
    backdated: true
  };

  S.logs = S.logs || [];
  const existingIdx = p.id ? S.logs.findIndex(l => String(l.id) === String(p.id)) : -1;
  if (existingIdx >= 0) {
    S.logs[existingIdx] = completedLog;
  } else {
    S.logs.push(completedLog);
  }
  // Sort chronologically ascending
  S.logs.sort((a, b) => (Number(a.date) || 0) - (Number(b.date) || 0));

  save('logs', S.logs);
  pastWorkout = null;
  closeModal();
  toast(`Saved "${workoutName}" for ${dateStr} to History! 🏆`);
  render();
}

function editPastWorkout(log) {
  if (!log) return;
  const d = new Date(Number(log.date) || Date.now());
  const dateStr = d.toISOString().slice(0, 10);
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${mins}`;
  const durMins = Math.round((Number(log.dur) || 2700000) / 60000);

  pastWorkout = {
    id: log.id,
    date: dateStr,
    time: timeStr,
    name: log.name || 'Completed Workout',
    routineId: 'custom',
    dur: durMins,
    isDeload: !!log.isDeload,
    ex: (log.ex || []).map(x => ({
      id: x.id,
      note: x.note || '',
      uni: !!x.uni,
      sets: (x.sets || []).map(s => ({
        w: Number(s.w) || 0,
        r: Number(s.r) || 0,
        done: s.done !== false
      }))
    }))
  };

  renderPastWorkoutModal();
}

const finish = finishWorkout;
if (typeof window !== 'undefined') {
  window.finishWorkout = finishWorkout;
  window.finish = finishWorkout;
  window.openPastWorkoutModal = openPastWorkoutModal;
  window.savePastWorkout = savePastWorkout;
  window.editPastWorkout = editPastWorkout;
}
_global.finishWorkout = finishWorkout;
_global.finish = finishWorkout;
_global.openPastWorkoutModal = openPastWorkoutModal;
_global.savePastWorkout = savePastWorkout;
_global.editPastWorkout = editPastWorkout;

// On focus of any set input, automatically select full text for single-tap replacement
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('focusin', e => {
    if (e.target && e.target.matches && e.target.matches('.set-val-input, input[data-f="w"], input[data-f="r"], .settings-input-num')) {
      if (typeof e.target.select === 'function') {
        setTimeout(() => { try { e.target.select(); } catch (_) {} }, 10);
      }
    }
  });
}

// ---- Event Listeners ----
document.addEventListener('click', async e => {
  unlock();
  const t = e.target.closest('[data-a]');
  if (!t) return;
  const { a, k, id } = t.dataset;
  const i = +t.dataset.i, j = +t.dataset.j;

  switch (a) {
    case 'tab': view = k; close(); break;
    case 'close': close(); return;
    case 'undo': U?.(); $('#toast').className = ''; return;
    case 'toggle-onboard-unit': {
      const val = t.dataset.val || 'kg';
      document.querySelectorAll('.onboarding-unit-pill').forEach(btn => {
        const isSelected = btn.dataset.val === val;
        btn.classList.toggle('on', isSelected);
        btn.classList.toggle('active', isSelected);
      });
      return;
    }
    case 'toggle-onboard-sex': {
      const val = t.dataset.val || 'male';
      document.querySelectorAll('.onboarding-sex-pill').forEach(btn => {
        const isSelected = btn.dataset.val === val;
        btn.classList.toggle('on', isSelected);
        btn.classList.toggle('active', isSelected);
      });
      return;
    }
    case 'open-3d-anatomy': {
      const p = t.dataset.p ? t.dataset.p.split(',').filter(Boolean) : [];
      const s = t.dataset.s ? t.dataset.s.split(',').filter(Boolean) : [];
      show3DAnatomyModal(p, s);
      return;
    }
    case 'open-3d-physique': {
      const pState = getPhysiqueState();
      const currentProg = (pState && pState.overallProgress != null) ? (pState.overallProgress / 100) : 0.5;
      show3DPhysiqueModal(currentProg);
      return;
    }
    case 'toggle-3d-gender': {
      if (active3DViewer) {
        const cur = S.cfg?.bodyModel === 'female' ? 'male' : 'female';
        S.cfg.bodyModel = cur;
        save('cfg');
        const lbl = document.getElementById('gender-3d-label');
        if (lbl) lbl.textContent = cur === 'female' ? 'Female' : 'Male';
        active3DViewer.setGender(cur);
      }
      return;
    }
    case 'reset-3d-view': {
      if (active3DViewer) active3DViewer.resetView();
      return;
    }
    case 'toggle-3d-autorotate': {
      if (active3DViewer) {
        const next = !active3DViewer.isAutoRotate();
        active3DViewer.toggleAutoRotate(next);
        const btn = document.getElementById('autorotate-3d-btn');
        if (btn) {
          btn.classList.toggle('on', next);
          btn.textContent = '🔄 Auto-Rotate: ' + (next ? 'ON' : 'OFF');
        }
      }
      return;
    }
    case 'r15': T.end += 15000; tick(); return;
    case 'rskip': {
      const loop = T.supersetLoop;
      stopRest(true);
      if (loop && S.act && S.act.ex[loop.targetEx] && loop.targetSet < S.act.ex[loop.targetEx].sets.length) {
        switchWorkExercise(loop.targetEx);
        toast(`⚡ Superset Round ${loop.round} of ${loop.totalRounds}: ${esc(X(S.act.ex[loop.targetEx].id).name)}`);
        focusSetInput(loop.targetEx, loop.targetSet);
      }
      return;
    }
    case 'zoomexgif': {
      const targetId = id || t.dataset.id || (S.act?.ex[S.act.curEx]?.id);
      if (targetId) {
        showExpandedGifModal(targetId);
      }
      return;
    }

    // Library category and pagination
    case 'libcat': {
      libCategory = t.dataset.cat;
      libSubCategory = 'All';
      libPageSize = 40;
      document.querySelectorAll('.chips button[data-a="libcat"]').forEach(btn => {
        btn.classList.toggle('on', btn.dataset.cat === libCategory);
      });
      const subWrap = $('#lib-sub-chips-wrap');
      if (subWrap) subWrap.innerHTML = renderLibSubPills();
      updateLibResults();
      return;
    }
    case 'libsubcat': {
      libSubCategory = t.dataset.subcat || 'All';
      libPageSize = 40;
      const subWrap = $('#lib-sub-chips-wrap');
      if (subWrap) subWrap.innerHTML = renderLibSubPills();
      updateLibResults();
      return;
    }
    case 'libmore': {
      libPageSize += 40;
      updateLibResults();
      return;
    }
    case 'libex': {
      const ex = X(id);
      showExerciseModal(ex);
      return;
    }
    case 'addextoworkout': {
      if (S.act) {
        const isUni = isUnilateralExercise(X(id).name);
        const lastNote = getLastExerciseNote(id);
        S.act.ex.push({ id, ss: false, uni: isUni, note: lastNote, sets: newSets(id) });
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

    // Body & Transformation Roadmap Actions
    case 'opencalibration': {
      showPhysiqueCalibrationModal();
      break;
    }
    case 'savecalibration': {
      const hInp = $('#calib-height');
      const wInp = $('#calib-weight');
      const waistInp = $('#calib-waist');
      const neckInp = $('#calib-neck');
      const hipInp = $('#calib-hip');
      const goalSel = $('#calib-goal');
      const targetBfInp = $('#calib-target-bf');
      const genderSel = $('#calib-gender');
      const ageInp = $('#calib-age');
      const actSel = $('#calib-activity');
      const expSel = $('#calib-experience');

      const hVal = parseFloat(hInp?.value) || 178;
      const wVal = parseFloat(wInp?.value);
      const waistVal = parseFloat(waistInp?.value);
      const neckVal = parseFloat(neckInp?.value) || 38;
      const hipVal = parseFloat(hipInp?.value) || (waistVal ? waistVal * 1.25 : 95);
      const goalVal = goalSel?.value || 'sixpack';
      const targetBfVal = parseFloat(targetBfInp?.value) || 11.0;
      const genderVal = genderSel?.value || S.cfg.bodyModel || 'male';
      const ageVal = parseInt(ageInp?.value, 10) || 26;
      const actVal = actSel?.value || 'moderate';
      const expVal = expSel?.value || 'intermediate';

      S.cfg.bodyModel = genderVal;
      if (!S.cfg.physique) S.cfg.physique = getDefaultPhysiqueConfig(genderVal);
      S.cfg.physique = {
        ...S.cfg.physique,
        age: Math.max(14, Math.min(100, ageVal)),
        activityLevel: actVal,
        experienceLevel: expVal,
        height: Math.max(100, Math.min(250, hVal)),
        neck: Math.max(20, Math.min(70, neckVal)),
        hip: Math.max(40, Math.min(200, hipVal)),
        goalType: goalVal,
        targetBf: Math.max(4, Math.min(45, targetBfVal))
      };

      if (Number.isFinite(wVal) && wVal > 0) S.cfg.physique.weight = rd(wVal);
      if (Number.isFinite(waistVal) && waistVal > 0) S.cfg.physique.waist = rd(waistVal);

      // Log entry in S.weights if user provided weight or waist
      const dateVal = new Date().toISOString().slice(0, 10);
      const hasW = Number.isFinite(wVal) && wVal > 0 && wVal < 500;
      const hasWaist = Number.isFinite(waistVal) && waistVal > 0 && waistVal < 300;
      if (hasW || hasWaist) {
        const existing = S.weights.find(x => x.date === dateVal);
        if (existing) {
          if (hasW) existing.w = rd(wVal);
          if (hasWaist) existing.waist = rd(waistVal);
          existing.t = new Date(dateVal + 'T12:00:00').getTime();
        } else {
          S.weights.push({
            id: uid(),
            date: dateVal,
            w: hasW ? rd(wVal) : null,
            waist: hasWaist ? rd(waistVal) : null,
            t: new Date(dateVal + 'T12:00:00').getTime()
          });
        }
      }

      // Ensure state save does not wipe memory maps before re-rendering vBody() or vTrain()
      if ((!EXDB || EXDB.length === 0) && _global.__EXDB__ && _global.__EXDB__.length > 0) {
        EXDB = _global.__EXDB__;
      }
      if ((!EXIDX || (typeof EXIDX.size === 'number' && EXIDX.size === 0)) && _global.__EXIDX__) {
        EXIDX = _global.__EXIDX__;
      }

      save('cfg', 'weights');
      close();
      toast('Physique Roadmap calibrated! 🎯');
      render();
      break;
    }
    case 'resetmorph': {
      const targetPct = parseFloat(t.dataset.pct);
      const slider = $('#morph-scrub-input');
      if (slider && Number.isFinite(targetPct)) {
        slider.value = targetPct;
        updateMorphVisuals(targetPct);
      }
      break;
    }

    // Body Measurements (Weight + Waist)
    case 'setwv': {
      bodyMetricView = t.dataset.v;
      render();
      return;
    }
    case 'logweight': {
      const inpW = $('#wt-input');
      const inpWaist = $('#waist-input');
      const inpNeck = $('#neck-input');
      const inpChest = $('#chest-input');
      const inpArms = $('#arms-input');
      const inpHips = $('#hips-input');
      const dinp = $('#wt-date');
      const valW = parseFloat(inpW?.value);
      const valWaist = parseFloat(inpWaist?.value);
      const valNeck = parseFloat(inpNeck?.value);
      const valChest = parseFloat(inpChest?.value);
      const valArms = parseFloat(inpArms?.value);
      const valHips = parseFloat(inpHips?.value);
      const dateVal = dinp?.value || new Date().toISOString().slice(0, 10);

      const hasW = Number.isFinite(valW) && valW > 0 && valW < 500;
      const hasWaist = Number.isFinite(valWaist) && valWaist > 0 && valWaist < 300;
      const hasNeck = Number.isFinite(valNeck) && valNeck > 0 && valNeck < 200;
      const hasChest = Number.isFinite(valChest) && valChest > 0 && valChest < 300;
      const hasArms = Number.isFinite(valArms) && valArms > 0 && valArms < 200;
      const hasHips = Number.isFinite(valHips) && valHips > 0 && valHips < 300;

      if (!hasW && !hasWaist && !hasNeck && !hasChest && !hasArms && !hasHips) {
        toast('Please enter a valid measurement');
        return;
      }

      // Check if entry for date already exists to merge
      const existing = S.weights.find(x => x.date === dateVal);
      if (existing) {
        if (hasW) existing.w = rd(valW);
        if (hasWaist) existing.waist = rd(valWaist);
        if (hasNeck) existing.neck = rd(valNeck);
        if (hasChest) existing.chest = rd(valChest);
        if (hasArms) existing.arms = rd(valArms);
        if (hasHips) existing.hips = rd(valHips);
        existing.t = new Date(dateVal + 'T12:00:00').getTime();
      } else {
        S.weights.push({
          id: uid(),
          date: dateVal,
          w: hasW ? rd(valW) : null,
          waist: hasWaist ? rd(valWaist) : null,
          neck: hasNeck ? rd(valNeck) : null,
          chest: hasChest ? rd(valChest) : null,
          arms: hasArms ? rd(valArms) : null,
          hips: hasHips ? rd(valHips) : null,
          t: new Date(dateVal + 'T12:00:00').getTime()
        });
      }
      save('weights');
      if (inpW) inpW.value = '';
      if (inpWaist) inpWaist.value = '';
      if (inpNeck) inpNeck.value = '';
      if (inpChest) inpChest.value = '';
      if (inpArms) inpArms.value = '';
      if (inpHips) inpHips.value = '';
      const feedback = [
        hasW ? `${rd(valW)} kg` : null,
        hasWaist ? `${rd(valWaist)} cm waist` : null,
        hasNeck ? `${rd(valNeck)} cm neck` : null,
        hasChest ? `${rd(valChest)} cm chest` : null,
        hasArms ? `${rd(valArms)} cm arms` : null,
        hasHips ? `${rd(valHips)} cm hips` : null
      ].filter(Boolean).join(' · ');
      toast(`Logged ${feedback}`);
      render();
      break;
    }
    case 'delweight': {
      S.weights = S.weights.filter(x => x.id !== id);
      save('weights');
      toast('Entry deleted');
      render();
      break;
    }

    // Daily Nutrition & Macro Tracker Actions
    case 'body-subtab': {
      bodySubTab = t.dataset.tab || 'physique';
      render();
      return;
    }
    case 'prev-nutrition-day': {
      changeNutritionDate(-1);
      return;
    }
    case 'next-nutrition-day': {
      changeNutritionDate(1);
      return;
    }
    case 'today-nutrition-day': {
      resetNutritionDateToToday();
      return;
    }
    case 'open-nutrition-targets': {
      showNutritionTargetsModal();
      return;
    }
    case 'save-nutrition-targets': {
      saveNutritionTargetsFromModal();
      return;
    }
    case 'preset-target-deficit': {
      applyMacroPreset('deficit');
      return;
    }
    case 'preset-target-maint': {
      applyMacroPreset('maintenance');
      return;
    }
    case 'preset-target-surplus': {
      applyMacroPreset('surplus');
      return;
    }
    case 'open-meal-modal': {
      showMealModal(t.dataset.meal);
      return;
    }
    case 'save-meal': {
      saveMealFromModal(t.dataset.meal);
      return;
    }
    case 'clear-meal': {
      clearMealFromModal(t.dataset.meal);
      return;
    }
    case 'autocalc-meal-cals': {
      autocalcMealCals();
      return;
    }

    // Exercise Swap
    case 'swapex': {
      showSwapModal(+t.dataset.i);
      return;
    }
    case 'swapcat': {
      swapCategory = t.dataset.cat;
      document.querySelectorAll('.chips button[data-a="swapcat"]').forEach(btn => {
        btn.classList.toggle('on', btn.dataset.cat === swapCategory);
      });
      const swapList = $('#swap-list');
      if (swapList) swapList.innerHTML = renderSwapResults();
      return;
    }
    case 'doswap': {
      if (!S.act || !S.act.ex[swapIdx]) return;
      const curEx = S.act.ex[swapIdx];
      const oldId = curEx.id;
      const newId = id;
      const updatePerm = Boolean($('#swap-perm-check')?.checked);

      // Preserve entered weights/reps structure while replacing exercise identity
      curEx.id = newId;
      curEx.uni = isUnilateralExercise(X(newId).name);
      curEx.note = getLastExerciseNote(newId);

      // Update base routine permanently if option was checked
      if (updatePerm && S.act.rid) {
        const routine = S.routines.find(r => r.id === S.act.rid);
        if (routine && routine.ex) {
          const rx = routine.ex.find(x => String(x.id) === String(oldId)) || routine.ex[swapIdx];
          if (rx) {
            rx.id = newId;
            rx.uni = curEx.uni;
            if (curEx.note) rx.note = curEx.note;
            save('routines');
          }
        }
      }

      save('act');
      close();
      render();
      toast(`Swapped to ${X(newId).name}${updatePerm ? ' (routine updated)' : ''}`);
      return;
    }

    // Force Update & Shell Cache Bust
    case 'forceupdate': {
      modal(`
        <div class="confirm-modal">
          <div style="font-size:36px;margin-bottom:8px">🔄</div>
          <h2 style="margin-bottom:8px">Force App Update?</h2>
          <p class="t2 sm" style="margin-bottom:16px;line-height:1.5">
            This will clear the offline app cache and reload the latest version of MyGyM. Your workouts, routines, and settings will remain safe.
          </p>
          <div class="row g">
            <button class="btn s" data-a="close" style="flex:1">Cancel</button>
            <button class="btn s" data-a="confirm-force-update" style="flex:1;background:var(--ac);color:#fff">Update Now</button>
          </div>
        </div>
      `);
      return;
    }
    case 'confirm-force-update': {
      closeModal();
      (async () => {
        try {
          if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const r of registrations) { await r.unregister(); }
          }
          if ('caches' in window) {
            const keys = await caches.keys();
            for (const k of keys) { await caches.delete(k); }
          }
          localStorage.setItem('mygym_shell_version', SHELL_VERSION);
        } catch (err) {
          console.warn('Cache clearance issue:', err);
        }
        try {
          window.location.reload(true);
        } catch (_) {
          window.location.href = window.location.origin + window.location.pathname + '?t=' + Date.now();
        }
      })();
      return;
    }

    // Workout Logger
    case 'start': {
      const r = S.routines.find(r => r.id === id);
      const isDeloadActive = !!(S.deload && S.deload.active);
      S.act = {
        rid: r ? r.id : null,
        name: r ? (isDeloadActive ? `${r.name} (Deload)` : r.name) : 'Workout',
        isDeload: isDeloadActive,
        t0: Date.now(),
        curEx: 0,
        ex: r ? r.ex.map((x, idx, arr) => {
          const baseSets = Math.max(1, x.sets || 1);
          const targetSets = isDeloadActive ? Math.max(1, Math.round(baseSets * 0.5)) : baseSets;
          const targetWeight = isDeloadActive ? Math.max(0, rd((x.w || 0) * 0.8)) : (x.w || 0);
          const targetReps = x.prog === 'double' ? (x.cur || x.reps) : x.reps;
          const isUni = x.uni !== undefined ? !!x.uni : isUnilateralExercise(X(x.id).name);
          const isSs = !!x.ss;
          let ssRole = null;
          let ssGroup = x.ssGroup || null;
          if (isSs) {
            let start = idx;
            while (start > 0 && arr[start - 1] && arr[start - 1].ss) {
              start--;
            }
            if (!ssGroup) ssGroup = 'ss_' + start;
            ssRole = String.fromCharCode(65 + (idx - start));
          }
          const prevEx = getLastSessionExercise(x.id);
          return {
            id: x.id,
            ss: isSs,
            ssRole,
            ssGroup,
            ssPair: ssGroup,
            uni: isUni,
            note: x.note || getLastExerciseNote(x.id),
            sets: Array.from({ length: targetSets }, (_, setIdx) => {
              const prevSet = prevEx?.sets?.[setIdx] || prevEx?.sets?.at(-1);
              const prefillW = (prevSet && prevSet.w != null && prevSet.w !== '')
                ? (isDeloadActive ? Math.max(0, rd(Number(prevSet.w) * 0.8)) : Number(prevSet.w))
                : targetWeight;
              const prefillR = (prevSet && prevSet.r != null && prevSet.r !== '')
                ? Number(prevSet.r)
                : targetReps;
              return {
                w: prefillW,
                r: prefillR,
                rpe: '',
                rir: null,
                done: false,
                sideL: false,
                sideR: false
              };
            })
          };
        }) : []
      };
      save('act');
      wake();
      view = 'work';
      break;
    }
    case 'workprev': {
      if (S.act && S.act.curEx > 0) {
        switchWorkExercise(S.act.curEx - 1);
      }
      return;
    }
    case 'worknext': {
      if (S.act && S.act.curEx < S.act.ex.length - 1) {
        switchWorkExercise(S.act.curEx + 1);
      }
      return;
    }
    case 'setcurex': {
      if (S.act) {
        switchWorkExercise(+t.dataset.i);
      }
      return;
    }
    case 'worklist': {
      if (!S.act) return;
      modal(`<h2>Workout Overview</h2>
        <div style="margin-bottom:12px" class="t2 sm">${S.act.ex.length} exercises in ${esc(S.act.name)}</div>
        ${S.act.ex.map((x, idx) => {
          const ex = X(x.id);
          const doneCount = x.sets.filter(s => s.done).length;
          const isCur = idx === S.act.curEx;
          return `<div class="card" style="margin-bottom:8px;border-color:${isCur ? 'var(--ac)' : 'var(--bd)'}">
            <div class="row">
              <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer" data-a="jumpworkex" data-i="${idx}">
                <img class="ex-thumb" src="./media/${esc(ex.img || ex.gif)}" alt="${esc(ex.name)}" onerror="this.style.display='none'">
                <div style="flex:1;min-width:0">
                  <div class="ex-name">${idx + 1}. ${esc(ex.name)}</div>
                  <div class="ex-meta">${doneCount}/${x.sets.length} sets completed</div>
                </div>
              </div>
              <button class="chip ${isCur ? 'on' : ''}" data-a="jumpworkex" data-i="${idx}">${isCur ? 'Active' : 'Jump'}</button>
              <button class="btn-icon red" data-a="rmworkex" data-i="${idx}" title="Remove">✕</button>
            </div>
          </div>`;
        }).join('')}
        <button class="btn s" data-a="addex" style="margin-top:8px">${ic('plus', 16)} Add Another Exercise</button>
      `);
      return;
    }
    case 'jumpworkex': {
      close();
      if (S.act) {
        switchWorkExercise(+t.dataset.i);
      }
      return;
    }
    case 'rmworkex': {
      if (S.act && S.act.ex.length > 1) {
        S.act.ex.splice(+t.dataset.i, 1);
        if (S.act.curEx >= S.act.ex.length) S.act.curEx = S.act.ex.length - 1;
        save('act');
        close();
        render();
      } else {
        toast('Workout must have at least one exercise');
      }
      return;
    }
    case 'done': {
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20);
      const x = S.act?.ex[i], s = x?.sets[j];
      if (!s) return;
      if (x.uni) {
        if (s.done) {
          s.done = false;
          s.sideL = false;
          s.sideR = false;
          ls.set('act', S.act);
          save('act');
          switchWorkExercise(i, false);
          return;
        } else {
          s.done = true;
          s.sideL = true;
          s.sideR = true;
          ls.set('act', S.act);
          save('act');
          handleSetCompleted(i, j, s, x);
          return;
        }
      } else {
        const wasDone = s.done;
        s.done = !s.done;
        ls.set('act', S.act);
        save('act');
        if (!wasDone && s.done) {
          handleSetCompleted(i, j, s, x);
          return;
        } else {
          switchWorkExercise(i, false);
          return;
        }
      }
    }
    case 'togglesettype': {
      const x = S.act?.ex[i], s = x?.sets[j];
      if (!s) return;
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15);
      const cycle = ['', 'W', 'D', 'F', 'A'];
      const curType = s.type || '';
      const nextIdx = (cycle.indexOf(curType) + 1) % cycle.length;
      s.type = cycle[nextIdx];
      ls.set('act', S.act);
      save('act');
      const labels = {
        '': 'Normal set',
        'W': 'Warm-up set (excluded from volume & PRs)',
        'D': 'Drop set',
        'F': 'Failure set',
        'A': 'AMRAP set'
      };
      toast(labels[s.type] || 'Set updated');
      switchWorkExercise(i, false);
      return;
    }
    case 'showexhistory': {
      const exId = t.dataset.id || (S.act?.ex[i]?.id);
      if (exId) showExerciseHistoryModal(exId);
      return;
    }
    case 'toggleuni': {
      const x = S.act?.ex[i];
      if (x) {
        x.uni = !x.uni;
        if (x.sets) {
          x.sets.forEach(s => {
            if (x.uni) {
              s.sideL = s.done ? true : !!s.sideL;
              s.sideR = s.done ? true : !!s.sideR;
              s.done = !!(s.sideL && s.sideR);
            } else {
              s.done = (s.sideL && s.sideR) || s.done;
            }
          });
        }
        if (S.act.rid) {
          const r = S.routines.find(r => r.id === S.act.rid);
          const rx = r?.ex.find(e => e.id === x.id);
          if (rx) {
            rx.uni = x.uni;
            save('routines');
          }
        }
        ls.set('act', S.act);
        save('act');
      }
      break;
    }
    case 'donel': {
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20);
      const x = S.act?.ex[i], s = x?.sets[j];
      if (!s) return;
      s.sideL = !s.sideL;
      const wasDone = s.done;
      s.done = !!(s.sideL && s.sideR);
      ls.set('act', S.act);
      save('act');
      if (!wasDone && s.done) {
        handleSetCompleted(i, j, s, x);
        return;
      } else {
        switchWorkExercise(i, false);
        return;
      }
    }
    case 'doner': {
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20);
      const x = S.act?.ex[i], s = x?.sets[j];
      if (!s) return;
      s.sideR = !s.sideR;
      const wasDone = s.done;
      s.done = !!(s.sideL && s.sideR);
      ls.set('act', S.act);
      save('act');
      if (!wasDone && s.done) {
        handleSetCompleted(i, j, s, x);
        return;
      } else {
        switchWorkExercise(i, false);
        return;
      }
    }
    case 'openrir': {
      showRirPicker(i, j);
      return;
    }
    case 'setrir': {
      const x = S.act?.ex[i], s = x?.sets[j];
      if (!s) return;
      const rirAttr = t.dataset.rir;
      if (rirAttr === 'clear') {
        s.rir = null;
        s.rpe = '';
      } else {
        const val = +rirAttr;
        s.rir = val;
        s.rpe = 10 - val;
      }
      save('act');
      close();
      render();
      return;
    }
    case 'startdeload': {
      S.deload = {
        active: true,
        startedAt: Date.now()
      };
      save('deload');
      render();
      toast('⚡ Deload Protocol Active: Target sets halved & weights -20%');
      return;
    }
    case 'enddeload': {
      S.deload = {
        active: false,
        endedAt: Date.now(),
        lastDeloadDate: Date.now()
      };
      save('deload');
      render();
      toast('Deload Completed: Normal routine targets restored');
      return;
    }
    case 'addset': {
      const x = S.act?.ex[i];
      if (!x) return;
      const prev = x.sets.at(-1) || { w: 0, r: X(x.id).t === 't' ? 30 : 8, rpe: '', rir: null };
      x.sets.push({ ...prev, done: false, sideL: false, sideR: false, rir: null, rpe: '' });
      ls.set('act', S.act);
      save('act');
      break;
    }
    case 'delset': {
      const x = S.act?.ex[i];
      if (x && x.sets.length > 1) {
        x.sets.pop();
        ls.set('act', S.act);
        save('act');
        break;
      }
      return;
    }
    case 'genwarmups': {
      const curEx = S.act?.ex[i];
      if (!curEx) return;
      const exInfo = X(curEx.id);
      const isTimed = exInfo?.type === 'timed_cardio' || exInfo?.t === 't';
      if (isTimed) {
        toast('Warm-up generator is for resistance exercises');
        return;
      }
      const existingSets = curEx.sets || [];
      const nonWarmups = existingSets.filter(s => s.type !== 'W');
      let baseW = 60;
      if (nonWarmups.length && Number(nonWarmups[0].w) > 0) {
        baseW = Number(nonWarmups[0].w);
      } else if (existingSets.length && Number(existingSets[0].w) > 0) {
        baseW = Number(existingSets[0].w);
      }
      const roundW = w => Math.max(20, Math.round(w / 2.5) * 2.5);
      const warmups = [
        { w: roundW(baseW * 0.45), r: 8, type: 'W', done: false, rir: null, rpe: '' },
        { w: roundW(baseW * 0.65), r: 5, type: 'W', done: false, rir: null, rpe: '' },
        { w: roundW(baseW * 0.85), r: 3, type: 'W', done: false, rir: null, rpe: '' }
      ];
      curEx.sets = [...warmups, ...existingSets];
      ls.set('act', S.act);
      save('act');
      switchWorkExercise(i, false);
      toast('⚡ Generated 3 progressive warm-up sets (45%, 65%, 85%)');
      return;
    }
    case 'setexrest': {
      const exId = t.dataset.id || (S.act?.ex[i]?.id);
      if (!exId) return;
      const exInfo = X(exId);
      const curRest = getExRest(exId);
      const restIntervals = [30, 45, 60, 90, 120, 150, 180, 240, 300];
      modal(`
        <div class="card" style="padding:16px">
          <h3 style="margin-top:0">⏱️ Rest Interval for ${esc(exInfo?.name || 'Exercise')}</h3>
          <p class="t2 sm">Set specific rest interval for this movement (defaults to ${S.cfg?.rest || 90}s):</p>
          <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin:16px 0">
            ${restIntervals.map(sec => `
              <button class="chip ${sec === curRest ? 'on' : ''}" data-a="commit-ex-rest" data-id="${esc(exId)}" data-sec="${sec}" style="min-height:44px;justify-content:center;font-weight:700">
                ${sec >= 60 ? (sec / 60) + ' min' : sec + ' sec'}
              </button>
            `).join('')}
          </div>
          <button class="btn s sm-btn" data-a="close" style="width:100%">Cancel</button>
        </div>
      `);
      return;
    }
    case 'commit-ex-rest': {
      const exId = t.dataset.id;
      const sec = Number(t.dataset.sec) || 90;
      if (exId) {
        S.cfg = S.cfg || {};
        S.cfg.exerciseRest = S.cfg.exerciseRest || {};
        S.cfg.exerciseRest[exId] = sec;
        save('cfg');
        closeModal();
        toast(`⏱️ Custom rest timer set to ${sec}s for this exercise`);
        if (view === 'work' && S.act) {
          switchWorkExercise(S.act.curEx || 0, false);
        }
      }
      return;
    }
    case 'submit-onboarding':
    case 'dismiss-onboarding':
    case 'saveonboarding': {
      handleOnboardingSubmit();
      return;
    }
    case 'opencsvimport': {
      openCSVImportModal();
      return;
    }
    case 'parse-csv-text': {
      const ta = document.getElementById('csv-import-textarea');
      if (ta) runCSVPreview(ta.value);
      return;
    }
    case 'commit-csv-import': {
      commitCSVImport();
      return;
    }
    case 'editpastlog': {
      const logId = t.dataset.id;
      const l = S.logs.find(item => String(item.id || item.date) === String(logId));
      if (l) {
        editPastWorkout(l);
      }
      return;
    }
    case 'delpastlog': {
      const logId = t.dataset.id;
      const idx = S.logs.findIndex(item => String(item.id || item.date) === String(logId));
      if (idx !== -1) {
        if (confirm('Are you sure you want to delete this completed workout?')) {
          S.logs.splice(idx, 1);
          save('logs');
          ls.set('logs', S.logs);
          toast('Workout deleted');
          render();
        }
      }
      return;
    }
    case 'delphoto': {
      const idx = Number(t.dataset.idx);
      if (Number.isInteger(idx) && S.photos && S.photos[idx]) {
        S.photos.splice(idx, 1);
        save('photos');
        toast('Progress photo deleted');
        render();
      }
      return;
    }
    case 'opensspicker': {
      if (S.act) {
        const curI = +t.dataset.i;
        showSupersetPicker(curI);
      }
      return;
    }
    case 'linkss': {
      if (S.act) {
        const curI = +t.dataset.i;
        showSupersetPicker(curI);
      }
      return;
    }
    case 'pairwithex':
    case 'addtosupergroup': {
      if (S.act) {
        const src = +t.dataset.source;
        const tgt = +t.dataset.target;
        addToSupergroup(src, tgt);
      }
      return;
    }
    case 'browseandpair':
    case 'browseandaddtosupergroup': {
      if (S.act) {
        const src = +t.dataset.i;
        const ssInfo = getSupersetInfo(S.act, src);
        const nextPosLabel = ssInfo.isSuperset && ssInfo.isPaired ? `A${ssInfo.groupLength + 1}` : 'A2';
        P = (libExId) => {
          browseAndAddToSupergroup(src, libExId);
        };
        showExercisePicker(`Select Exercise to Add as ${nextPosLabel}`);
      }
      return;
    }
    case 'unlinkss': {
      if (S.act) {
        const curI = +t.dataset.i;
        unlinkSuperset(curI);
      }
      return;
    }
    case 'ss': {
      if (S.act) {
        const curI = i !== undefined && !isNaN(i) ? i : +t.dataset.i;
        showSupersetPicker(curI);
      }
      return;
    }
    case 'addex': {
      P = null;
      showExercisePicker('Add Exercise to Workout');
      return;
    }
    case 'pickpreview': {
      showExercisePickerPreview(id);
      return;
    }
    case 'backtopicker': {
      showExercisePicker(currentPickerTitle || 'Add Exercise');
      return;
    }
    case 'explore-muscle': {
      showMuscleDetailSheet(t.dataset.muscle);
      return;
    }
    case 'close-mm-explore': {
      const drawer = document.getElementById('mm-explore-sheet');
      if (drawer) {
        drawer.innerHTML = '';
        drawer.classList.remove('open');
      }
      document.querySelectorAll('.mm-muscle.selected').forEach(el => el.classList.remove('selected'));
      return;
    }
    case 'pick': {
      const cb = P;
      P = null;
      close();
      if (cb) {
        cb(id);
      } else if (S.act) {
        const isUni = isUnilateralExercise(X(id).name);
        const lastNote = getLastExerciseNote(id);
        S.act.ex.push({ id, ss: false, uni: isUni, note: lastNote, sets: newSets(id) });
        S.act.curEx = S.act.ex.length - 1;
        save('act');
        render();
        toast('Exercise added to workout');
      }
      return;
    }
    case 'pickcat': {
      pickCategory = t.dataset.cat;
      pickSubCategory = 'All';
      document.querySelectorAll('.chips button[data-a="pickcat"]').forEach(btn => {
        btn.classList.toggle('on', btn.dataset.cat === pickCategory);
      });
      const subWrap = $('#pick-sub-chips-wrap');
      if (subWrap) subWrap.innerHTML = renderPickSubPills();
      const pickList = $('#pick-list');
      if (pickList) pickList.innerHTML = renderPickResults();
      return;
    }
    case 'picksubcat': {
      pickSubCategory = t.dataset.subcat || 'All';
      const subWrap = $('#pick-sub-chips-wrap');
      if (subWrap) subWrap.innerHTML = renderPickSubPills();
      const pickList = $('#pick-list');
      if (pickList) pickList.innerHTML = renderPickResults();
      return;
    }
    case 'stepw': {
      const x = S.act?.ex[i], s = x?.sets[j];
      if (!s) return;
      const delta = parseFloat(t.dataset.delta) || 0;
      const curW = parseFloat(s.w) || 0;
      const newW = Math.max(0, Math.round((curW + delta) * 10) / 10);
      s.w = newW;
      ls.set('act', S.act);
      save('act');
      const inp = document.querySelector(`input[data-f="w"][data-i="${i}"][data-j="${j}"]`);
      if (inp) inp.value = newW;
      else switchWorkExercise(i, false);
      return;
    }
    case 'togglegif': {
      workGifCollapsed = !workGifCollapsed;
      const mediaEl = document.querySelector('.work-hero-media');
      const chipEl = document.querySelector('.gif-toggle-chip');
      if (mediaEl) mediaEl.classList.toggle('collapsed', workGifCollapsed);
      if (chipEl) chipEl.textContent = workGifCollapsed ? '👁️ Show Demo GIF' : 'Hide GIF';
      return;
    }
    case 'applysuggestion': {
      const x = S.act?.ex[i];
      if (!x || !x.sets) return;
      const inc = parseFloat(t.dataset.inc) || 2.5;
      x.sets.forEach(s => {
        s.w = Math.max(0, Math.round(((parseFloat(s.w) || 0) + inc) * 10) / 10);
      });
      ls.set('act', S.act);
      save('act');
      toast(`Applied +${inc}kg Double Progression! ⚡`);
      switchWorkExercise(i, false);
      return;
    }
    case 'explainjargon': {
      showJargonSheet(t.dataset.term);
      return;
    }
    case 'promptfin': {
      modal(`
        <div class="confirm-sheet">
          <div class="confirm-icon">🏁</div>
          <h2>Finish and Save Workout?</h2>
          <p class="t2" style="margin-bottom:16px">All completed sets, reps, and PRs will be logged to your history.</p>
          <button class="btn finish-save-btn" data-a="commit-finish" data-test="confirmfin" style="margin-bottom:8px">Finish & Log Workout 🏆</button>
          <button class="btn s" data-a="closemodal">Continue Logging</button>
        </div>
      `);
      return;
    }
    case 'promptcancel': {
      modal(`
        <div class="confirm-sheet">
          <div class="confirm-icon" style="color:var(--rd)">⚠️</div>
          <h2 style="color:var(--rd)">Discard Workout?</h2>
          <p class="t2" style="margin-bottom:16px">Discard this workout? All progress today will be lost.</p>
          <button class="btn red" data-a="confirmdiscard" style="margin-bottom:8px">Discard Workout ✕</button>
          <button class="btn s" data-a="closemodal">Keep Workout</button>
        </div>
      `);
      return;
    }
    case 'confirmdiscard': {
      S.act = null;
      ls.set('act', null);
      save('act');
      stopRest();
      close();
      view = 'train';
      toast('Workout discarded');
      render();
      return;
    }
    case 'closemodal': {
      close();
      return;
    }
    case 'togglesyncweights': {
      const cb = $('#sync-routine-weights-toggle');
      if (lastRoutineSyncBackup && lastRoutineSyncBackup.rid) {
        const rObj = S.routines.find(rt => rt.id === lastRoutineSyncBackup.rid);
        if (rObj) {
          if (cb && !cb.checked) {
            lastRoutineSyncBackup.backup.forEach(b => {
              const rx = rObj.ex.find(q => String(q.id) === String(b.id));
              if (rx && rx.sets) {
                b.sets.forEach((bs, idx) => {
                  if (rx.sets[idx]) rx.sets[idx].w = bs.w;
                });
              }
            });
            toast('Routine weights reverted to previous targets');
          } else {
            lastRoutineSyncBackup.appliedEx.forEach(completedEx => {
              const rx = rObj.ex.find(q => String(q.id) === String(completedEx.id));
              if (rx && rx.sets) {
                completedEx.sets.forEach((s, idx) => {
                  if (rx.sets[idx] && s.w > 0) rx.sets[idx].w = s.w;
                });
              }
            });
            toast('Routine base weights synced with completed weights');
          }
          save('routines');
        }
      }
      return;
    }
    case 'directsave':
    case 'forcefinish':
    case 'commit-finish':
    case 'confirmfin':
    case 'savefin':
    case 'fin': {
      closeModal();
      finishWorkout();
      return;
    }
    case 'openpastworkout': {
      openPastWorkoutModal(t.dataset.date);
      return;
    }
    case 'pastaddset': {
      const xIdx = parseInt(t.dataset.x, 10);
      if (pastWorkout && pastWorkout.ex && pastWorkout.ex[xIdx]) {
        const last = pastWorkout.ex[xIdx].sets.at(-1);
        pastWorkout.ex[xIdx].sets.push({ w: last ? last.w : 20, r: last ? last.r : 10 });
        renderPastWorkoutModal();
      }
      return;
    }
    case 'pastrmset': {
      const xIdx = parseInt(t.dataset.x, 10);
      const sIdx = parseInt(t.dataset.s, 10);
      if (pastWorkout && pastWorkout.ex && pastWorkout.ex[xIdx] && pastWorkout.ex[xIdx].sets && pastWorkout.ex[xIdx].sets.length > 1) {
        pastWorkout.ex[xIdx].sets.splice(sIdx, 1);
        renderPastWorkoutModal();
      }
      return;
    }
    case 'pastrmex': {
      const xIdx = parseInt(t.dataset.x, 10);
      if (pastWorkout && pastWorkout.ex) {
        pastWorkout.ex.splice(xIdx, 1);
        renderPastWorkoutModal();
      }
      return;
    }
    case 'pastaddex': {
      P = exId => {
        if (pastWorkout) {
          pastWorkout.ex.push({
            id: exId,
            note: '',
            uni: isUnilateralExercise(X(exId).name),
            sets: [{ w: 20, r: 10 }, { w: 20, r: 10 }, { w: 20, r: 10 }]
          });
          renderPastWorkoutModal();
        }
      };
      showExercisePicker('Add Exercise to Past Workout');
      return;
    }
    case 'savepastworkout': {
      savePastWorkout();
      return;
    }
    case 'opencustomex': {
      showCustomExerciseModal(t.dataset.name || '');
      return;
    }
    case 'savecustomex': {
      saveCustomExerciseFromForm();
      return;
    }
    case 'openaicoach': {
      openAICoachDrawer(t.dataset.p || null);
      return;
    }
    case 'openaiimport': {
      openAIImportModal();
      return;
    }
    case 'test-ai-key': {
      testAIConnection();
      return;
    }
    case 'save-ai-key': {
      saveAIKey();
      return;
    }
    case 'clear-ai-key': {
      clearAIKey();
      return;
    }
    case 'refresh-ai-models': {
      refreshAIModels(document.getElementById('ai-provider-select')?.value);
      return;
    }
    case 'toggle-key-vis': {
      const keyInput = document.getElementById('ai-key-input') || document.getElementById('ai-api-key-input');
      if (keyInput) {
        keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
      }
      return;
    }
    case 'run-ai-import':
    case 'parse-ai-workout': {
      parseAIWorkoutFromInput();
      return;
    }
    case 'commit-ai-routine': {
      commitAIRoutine(false);
      return;
    }
    case 'start-ai-routine': {
      commitAIRoutine(true);
      return;
    }
    case 'send-ai-coach-msg': {
      sendAICoachMessage();
      return;
    }
    case 'ai-quick-prompt': {
      sendAICoachMessage(t.dataset.p);
      return;
    }
    case 'add-custom-ai-ex': {
      const exIdx = parseInt(t.dataset.i, 10);
      if (parsedAIRoutine && parsedAIRoutine.exercises[exIdx]) {
        const item = parsedAIRoutine.exercises[exIdx];
        const created = createCustomExerciseFromAI(item.rawName, item.targetMuscle, item.equipment);
        item.id = created.id;
        item.matchedEx = created;
        item.isCustomNeeded = false;
        renderAIImportPreview();
      }
      return;
    }
    case 'removecursessionex': {
      if (!S.act || !Array.isArray(S.act.ex)) return;
      const exIdx = parseInt(t.dataset.i ?? S.act.curEx, 10);
      if (isNaN(exIdx) || exIdx < 0 || exIdx >= S.act.ex.length) return;
      if (S.act.ex.length <= 1) {
        toast('Cannot remove only remaining exercise. Discard workout instead.');
        return;
      }
      const exObj = X(S.act.ex[exIdx].id);
      const exName = exObj ? exObj.name : 'Exercise';
      S.act.ex.splice(exIdx, 1);
      if (S.act.curEx >= S.act.ex.length) {
        S.act.curEx = Math.max(0, S.act.ex.length - 1);
      }
      ls.set('act', S.act);
      save('act');
      toast(`Removed ${exName} from today's session`);
      render();
      return;
    }
    case 'resumesession': {
      if (S.act) {
        view = 'work';
        render();
      }
      return;
    }
    case 'openfreeworkout': {
      showFreeWorkoutBuilderModal();
      return;
    }
    case 'togglefreemuscle': {
      const m = t.dataset.muscle;
      if (!m) return;
      const idx = freeWorkoutMuscles.indexOf(m);
      if (idx >= 0) {
        if (freeWorkoutMuscles.length > 1) {
          freeWorkoutMuscles.splice(idx, 1);
        } else {
          toast('Select at least one muscle group');
          return;
        }
      } else {
        freeWorkoutMuscles.push(m);
      }
      showFreeWorkoutBuilderModal();
      return;
    }
    case 'togglefreeex': {
      const exId = t.dataset.id;
      if (!exId) return;
      if (freeWorkoutSelectedEx.has(exId)) {
        freeWorkoutSelectedEx.delete(exId);
      } else {
        freeWorkoutSelectedEx.add(exId);
      }
      const row = t.closest('.free-ex-row');
      if (row) {
        row.classList.toggle('selected', freeWorkoutSelectedEx.has(exId));
        const chk = row.querySelector('.free-ex-chk');
        if (chk) chk.checked = freeWorkoutSelectedEx.has(exId);
      }
      const countEl = $('#free-matches-count');
      const startBtn = $('.free-start-btn');
      const matchingCount = getFreeWorkoutExercises(freeWorkoutMuscles).length;
      if (countEl) countEl.innerHTML = `<b>${matchingCount}</b> exercises found (${freeWorkoutSelectedEx.size} selected)`;
      if (startBtn) startBtn.textContent = `⚡ Start Session (${freeWorkoutSelectedEx.size} Exercises)`;
      return;
    }
    case 'clearfreesel': {
      freeWorkoutSelectedEx.clear();
      const listEl = $('#free-ex-list');
      const matching = getFreeWorkoutExercises(freeWorkoutMuscles);
      if (listEl) listEl.innerHTML = renderFreeWorkoutExerciseRows(matching);
      const countEl = $('#free-matches-count');
      const startBtn = $('.free-start-btn');
      if (countEl) countEl.innerHTML = `<b>${matching.length}</b> exercises found (0 selected)`;
      if (startBtn) startBtn.textContent = `⚡ Start Session (0 Exercises)`;
      return;
    }
    case 'startfreesession': {
      startFreeWorkout();
      return;
    }
    case 'cancel':
      modal(`
        <div class="destructive-confirm-modal">
          <div style="font-size:36px;margin-bottom:8px">🛑</div>
          <h2 style="color:var(--rd);margin-bottom:8px">Discard Workout?</h2>
          <p class="t2 sm" style="margin-bottom:16px;line-height:1.5">
            Are you sure you want to discard this active workout? All logged sets for this session will be lost.
          </p>
          <div class="row g">
            <button class="btn s" data-a="close" style="flex:1">Keep Workout</button>
            <button class="btn s red" data-a="confirm-discard-workout" style="flex:1">Discard</button>
          </div>
        </div>
      `);
      return;
    case 'confirm-discard-workout':
      S.act = null;
      ls.set('act', null);
      save('act');
      stopRest();
      closeModal();
      view = 'train';
      render();
      toast('Workout discarded');
      return;
    case 'confirm-restore-backup':
      closeModal();
      if (_pendingBackupData) {
        await applySanitizedBackup(_pendingBackupData);
        _pendingBackupData = null;
      }
      return;
    case 'hist': {
      const l = S.logs.find(l => String(l.id) === String(id));
      if (!l) return;
      modal(`
        <h2>${esc(l.name)}</h2>
        ${mmLog(l)}
        ${l.ex.map(x => `<div class="card"><b>${esc(X(x.id).name)}</b>${x.sets.map((s, n) => `<div class="t2">${n + 1}. ${Number(s.w) || 0} × ${Number(s.r) || 0}${s.rpe != null && s.rpe !== '' ? ' @ RPE ' + esc(s.rpe) : ''}</div>`).join('')}${x.note ? `<div class="sm">${esc(x.note)}</div>` : ''}</div>`).join('')}
        <div class="row" style="margin-top:16px;gap:8px">
          <button class="btn s outline" data-a="editpastlog" data-id="${esc(l.id)}" style="flex:1">✏️ Edit Log</button>
          <button class="btn s red" data-a="deletepastlog" data-id="${esc(l.id)}" style="flex:1">🗑️ Delete</button>
        </div>
      `);
      return;
    }
    case 'editpastlog': {
      const l = S.logs.find(x => String(x.id) === String(id));
      if (!l) return;
      closeModal();
      editPastWorkout(l);
      return;
    }
    case 'deletepastlog': {
      const logIdx = S.logs.findIndex(x => String(x.id) === String(id));
      if (logIdx >= 0) {
        const deleted = S.logs.splice(logIdx, 1)[0];
        _lastDeletedLog = { log: deleted, index: logIdx };
        save('logs', S.logs);
        closeModal();
        toast(`Deleted "${esc(deleted.name || 'workout')}" · <button class="chip" data-a="undodeletelog" style="background:var(--ac);color:#fff;border:none;margin-left:6px;padding:2px 8px;cursor:pointer">Undo</button>`, 6000);
        render();
      }
      return;
    }
    case 'undodeletelog': {
      if (_lastDeletedLog && _lastDeletedLog.log) {
        const { log, index } = _lastDeletedLog;
        S.logs.splice(index >= 0 ? index : S.logs.length, 0, log);
        _lastDeletedLog = null;
        save('logs', S.logs);
        toast(`Restored "${esc(log.name || 'workout')}" ✓`);
        render();
      }
      return;
    }
    case 'edit': {
      const r = S.routines.find(r => r.id === id);
      E = r ? JSON.parse(JSON.stringify(r)) : { id: uid(), name: '', ex: [], isNew: 1 };
      showE();
      return;
    }
    case 'adde': {
      syncEFromForm();
      P = exId => {
        const exData = X(exId);
        const isCardio = exData.type === 'timed_cardio' || exData.t === 't' || isCardioOrMobilityExercise(exData.id);
        const isBw = exData.type === 'bodyweight' || exData.t === 'b';
        E.ex.push({
          id: exData.id,
          sets: 3,
          reps: isCardio ? 30 : 8,
          reps2: isCardio ? 60 : 12,
          w: (isCardio || isBw) ? 0 : 20,
          inc: 2.5,
          prog: 'linear',
          cur: isCardio ? 30 : 8,
          stalls: 0,
          note: '',
          ss: false
        });
        showE();
      };
      showExercisePicker('Choose Exercise for Routine');
      return;
    }
    case 'mvu': {
      syncEFromForm();
      const idx = +t.dataset.i;
      if (E && E.ex && idx > 0) {
        const item = E.ex.splice(idx, 1)[0];
        E.ex.splice(idx - 1, 0, item);
        showE();
      }
      return;
    }
    case 'mvd': {
      syncEFromForm();
      const idx = +t.dataset.i;
      if (E && E.ex && idx < E.ex.length - 1) {
        const item = E.ex.splice(idx, 1)[0];
        E.ex.splice(idx + 1, 0, item);
        showE();
      }
      return;
    }
    case 'rmx': {
      syncEFromForm();
      E.ex.splice(i, 1);
      showE();
      return;
    }
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
    case 'delr': {
      const routineIdx = S.routines.findIndex(r => r.id === E.id);
      if (routineIdx >= 0) {
        const deleted = S.routines.splice(routineIdx, 1)[0];
        _lastDeletedRoutine = { routine: deleted, index: routineIdx };
        save('routines', S.routines);
        close();
        toast(`Routine "${esc(deleted.name)}" deleted · <button class="chip" data-a="undodeleteroutine" style="background:var(--ac);color:#fff;border:none;margin-left:6px;padding:2px 8px;cursor:pointer">Undo</button>`, 6000);
        render();
      }
      return;
    }
    case 'undodeleteroutine': {
      if (_lastDeletedRoutine && _lastDeletedRoutine.routine) {
        const { routine, index } = _lastDeletedRoutine;
        S.routines.splice(index >= 0 ? index : S.routines.length, 0, routine);
        _lastDeletedRoutine = null;
        save('routines', S.routines);
        toast(`Routine "${esc(routine.name)}" restored ✓`);
        render();
      }
      return;
    }
    case 'exp': exp(); return;
    case 'expcsv': expCSV(); return;
    case 'opensettings': showSettingsModal(); return;
    case 'wipe-step1': showWipeConfirmModal(); return;
    case 'wipe-confirm': {
      S.routines = []; S.logs = []; S.weights = []; S.act = null; S.sched = {};
      S.nutrition = { targetCals: 2100, targetProtein: 140, targetCarbs: 240, targetFat: 60, targetFiber: 35, meals: {} };
      save('routines', 'logs', 'weights', 'cfg', 'sched', 'act', 'nutrition');
      stopRest();
      close();
      toast('All data erased');
      view = 'train';
      render();
      return;
    }
    case 'openplatecalc': {
      const targetW = parseFloat(t.dataset.w) || 20;
      const name = t.dataset.name || 'Barbell';
      showPlateCalcModal(targetW, name);
      return;
    }
    case 'adjplate': {
      const targetW = Math.max(20, Math.min(500, parseFloat(t.dataset.w) || 20));
      const name = t.dataset.name || 'Barbell';
      showPlateCalcModal(targetW, name);
      return;
    }
    case 'histroutine': {
      histRoutine = t.dataset.r;
      render();
      return;
    }
    case 'clearhistfilter': {
      histRoutine = 'All';
      histQuery = '';
      render();
      return;
    }
    case 'wipe': showWipeConfirmModal(); return;
  }
  render();
});

// Debounced Search and Field Updates
let searchTimeout;
let pickSearchTimeout;
const handleFieldUpdate = t => {
  const i = t.dataset.i, f = t.dataset.f;

  if (f === 'sched') {
    const day = t.dataset.day;
    if (!S.sched) S.sched = {};
    if (t.value) {
      S.sched[day] = t.value;
    } else {
      delete S.sched[day];
    }
    save('sched');
    render();
    toast('Split schedule updated');
    return;
  }

  if (f === 'pastdate' && pastWorkout) {
    pastWorkout.date = t.value;
    return;
  }
  if (f === 'pasttime' && pastWorkout) {
    pastWorkout.time = t.value;
    return;
  }
  if (f === 'pastdur' && pastWorkout) {
    pastWorkout.dur = Number(t.value) || 45;
    return;
  }
  if (f === 'pastroutine' && pastWorkout) {
    const rid = t.value;
    if (rid === 'custom') {
      pastWorkout.routineId = 'custom';
    } else {
      const r = S.routines.find(rt => rt && rt.id === rid);
      if (r) {
        pastWorkout.routineId = r.id;
        pastWorkout.name = r.name;
        pastWorkout.ex = (r.ex || []).map(rx => ({
          id: rx.id,
          note: rx.note || '',
          uni: !!rx.uni,
          sets: Array.isArray(rx.sets) && rx.sets.length
            ? rx.sets.map(s => ({ w: Number(s.w) || 0, r: Number(s.r) || 8 }))
            : [
                { w: Number(rx.w) || 0, r: Number(rx.reps) || 8 },
                { w: Number(rx.w) || 0, r: Number(rx.reps) || 8 },
                { w: Number(rx.w) || 0, r: Number(rx.reps) || 8 }
              ]
        }));
      }
    }
    renderPastWorkoutModal();
    return;
  }
  if (f === 'pastname' && pastWorkout) {
    pastWorkout.name = t.value;
    return;
  }
  if (f === 'pastsetw' && pastWorkout) {
    const xIdx = parseInt(t.dataset.x, 10);
    const sIdx = parseInt(t.dataset.s, 10);
    if (pastWorkout.ex && pastWorkout.ex[xIdx] && pastWorkout.ex[xIdx].sets && pastWorkout.ex[xIdx].sets[sIdx]) {
      pastWorkout.ex[xIdx].sets[sIdx].w = Number(t.value) || 0;
    }
    return;
  }
  if (f === 'pastsetr' && pastWorkout) {
    const xIdx = parseInt(t.dataset.x, 10);
    const sIdx = parseInt(t.dataset.s, 10);
    if (pastWorkout.ex && pastWorkout.ex[xIdx] && pastWorkout.ex[xIdx].sets && pastWorkout.ex[xIdx].sets[sIdx]) {
      pastWorkout.ex[xIdx].sets[sIdx].r = Number(t.value) || 0;
    }
    return;
  }

  if (f === 'histsearch') {
    histQuery = t.value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      render();
      const input = $('#hist-search-input');
      if (input && typeof input.focus === 'function') input.focus({ preventScroll: true });
    }, 150);
    return;
  }

  if (f === 'libsearch') {
    libQuery = t.value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      libPageSize = 40;
      updateLibResults();
      if (t && typeof t.focus === 'function') {
        t.focus({ preventScroll: true });
      }
    }, 200);
    return;
  }

  if (f === 'libeq') {
    libEquipment = t.value;
    libPageSize = 40;
    updateLibResults();
    return;
  }

  if (f === 'picksearch') {
    pickQuery = t.value;
    clearTimeout(pickSearchTimeout);
    pickSearchTimeout = setTimeout(() => {
      const list = $('#pick-list');
      if (list) list.innerHTML = renderPickResults();
      if (t && typeof t.focus === 'function') t.focus({ preventScroll: true });
    }, 150);
    return;
  }

  if (f === 'swapsearch') {
    swapQuery = t.value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const list = $('#swap-list');
      if (list) list.innerHTML = renderSwapResults();
      if (t && typeof t.focus === 'function') t.focus({ preventScroll: true });
    }, 150);
    return;
  }

  if (f === 'session-note' && S.act) {
    S.act.note = t.value;
    ls.set('act', S.act);
    save('act');
    return;
  }

  if (f && S.act && S.act.ex[i]) {
    const x = S.act.ex[i];
    if (f === 'note') {
      x.note = t.value;
      if (S.act.rid) {
        const r = S.routines.find(r => r.id === S.act.rid);
        const rx = r?.ex.find(e => String(e.id) === String(x.id));
        if (rx) rx.note = t.value;
      }
    } else if (x.sets && x.sets[t.dataset.j]) {
      const s = x.sets[t.dataset.j];
      if (f === 'rpe') {
        s.rpe = t.value;
        const num = parseFloat(t.value);
        s.rir = !isNaN(num) ? Math.max(0, Math.min(10, 10 - num)) : null;
      } else {
        s[f] = parseFloat(t.value) || 0;
      }
    }
    ls.set('act', S.act);
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

document.addEventListener('input', e => {
  handleFieldUpdate(e.target);
  if (e.target.id === 'morph-scrub-input') {
    updateMorphVisuals(parseFloat(e.target.value) || 0);
  }
  if (e.target.id && e.target.id.startsWith('calib-')) {
    updateCalibrationPreview();
  }
  if (e.target.id === 'ai-api-key-input' || e.target.id === 'ai-key-input') {
    handleAIKeyInput(e.target.value);
  }
  if (e.target.id === 'ai-model-input' || e.target.id === 'ai-custom-model-input') {
    const mVal = e.target.value.trim();
    const settings = (typeof AIConfig !== 'undefined' && AIConfig.getAISettings) ? AIConfig.getAISettings() : { models: {} };
    settings.models.custom = (typeof AIConfig !== 'undefined' && AIConfig.migrateModelId) ? AIConfig.migrateModelId(mVal) : mVal;
    if (typeof AIConfig !== 'undefined' && AIConfig.saveAISettings) AIConfig.saveAISettings(settings);
  }
  if (e.target.id === 'ai-baseurl-input' || e.target.id === 'ai-base-url-input') {
    const settings = (typeof AIConfig !== 'undefined' && AIConfig.getAISettings) ? AIConfig.getAISettings() : {};
    settings.baseUrl = e.target.value.trim();
    if (typeof AIConfig !== 'undefined' && AIConfig.saveAISettings) AIConfig.saveAISettings(settings);
  }
});
document.addEventListener('paste', e => {
  if (e.target && (e.target.id === 'ai-api-key-input' || e.target.id === 'ai-key-input')) {
    setTimeout(() => {
      handleAIKeyInput(e.target.value);
    }, 0);
  }
});
document.addEventListener('blur', e => handleFieldUpdate(e.target), true);
document.addEventListener('change', e => {
  const t = e.target;
  handleFieldUpdate(t);
  if (t.id === 'f' && t.files[0]) {
    imp(t.files[0]);
    t.value = '';
  }
  if (t.id === 'ai-import-file' && t.files && t.files[0]) {
    const file = t.files[0];
    const nameEl = document.querySelector('#ai-import-file-name');
    if (nameEl) nameEl.textContent = file.name;
    const reader = new FileReader();
    reader.onload = ev => {
      const textEl = document.querySelector('#ai-import-textarea') || document.querySelector('#ai-import-text');
      if (textEl) textEl.value = ev.target.result;
    };
    reader.readAsText(file);
    return;
  }
  if (t.id === 'ai-provider-select') {
    const prov = t.value;
    const settings = (typeof AIConfig !== 'undefined' && AIConfig.getAISettings) ? AIConfig.getAISettings() : {};
    settings.provider = prov;
    if (prov !== 'auto') {
      settings.resolvedProvider = prov;
    }
    if (typeof AIConfig !== 'undefined' && AIConfig.saveAISettings) {
      AIConfig.saveAISettings(settings);
    }
    updateAIModalFields(prov);
    return;
  }
  if (t.id === 'ai-model-select' || t.id === 'ai-model-input' || t.id === 'ai-custom-model-input') {
    const mVal = t.value.trim ? t.value.trim() : t.value;
    const provSelect = document.querySelector('#ai-provider-select');
    const settings = (typeof AIConfig !== 'undefined' && AIConfig.getAISettings) ? AIConfig.getAISettings() : { models: {} };
    const curProv = provSelect ? provSelect.value : (settings.provider || 'auto');
    const effectiveProv = curProv === 'auto' ? (settings.resolvedProvider || 'groq') : curProv;
    settings.models[effectiveProv] = (typeof AIConfig !== 'undefined' && AIConfig.migrateModelId) ? AIConfig.migrateModelId(mVal) : mVal;
    if (typeof AIConfig !== 'undefined' && AIConfig.saveAISettings) {
      AIConfig.saveAISettings(settings);
    }
    return;
  }
  if (t.id === 'ai-baseurl-input' || t.id === 'ai-base-url-input') {
    const settings = (typeof AIConfig !== 'undefined' && AIConfig.getAISettings) ? AIConfig.getAISettings() : {};
    settings.baseUrl = t.value.trim();
    if (typeof AIConfig !== 'undefined' && AIConfig.saveAISettings) {
      AIConfig.saveAISettings(settings);
    }
    return;
  }
  if (t.id === 'calib-goal') {
    const gEl = $('#calib-gender');
    const targetBfEl = $('#calib-target-bf');
    if (targetBfEl) {
      const g = gEl?.value || S.cfg.bodyModel || 'male';
      if (t.value === 'sixpack') targetBfEl.value = g === 'female' ? '18.0' : '11.0';
      else if (t.value === 'bulk') targetBfEl.value = g === 'female' ? '22.0' : '14.0';
      else targetBfEl.value = g === 'female' ? '19.5' : '12.5';
    }
    updateCalibrationPreview();
  }
  if (t.id === 'calib-gender') {
    const hipField = $('#calib-hip-field');
    if (hipField) hipField.style.display = t.value === 'female' ? '' : 'none';
    const targetBfEl = $('#calib-target-bf');
    const goalEl = $('#calib-goal');
    if (targetBfEl) {
      if (goalEl?.value === 'sixpack') targetBfEl.value = t.value === 'female' ? '18.0' : '11.0';
      else if (goalEl?.value === 'bulk') targetBfEl.value = t.value === 'female' ? '22.0' : '14.0';
      else targetBfEl.value = t.value === 'female' ? '19.5' : '12.5';
    }
    updateCalibrationPreview();
  }
  if (t.dataset.c) {
    if (t.dataset.c === 'inc') {
      S.cfg.inc = Math.max(0.25, Math.min(50, parseFloat(t.value) || 2.5));
    } else if (t.dataset.c === 'bodyModel') {
      S.cfg.bodyModel = t.value === 'female' ? 'female' : 'male';
    } else if (t.dataset.c === 'dumbbellWeightMode') {
      S.cfg.dumbbellWeightMode = t.value === 'as_logged' ? 'as_logged' : 'per_hand';
    } else if (t.dataset.c === 'weekStartDay') {
      S.cfg.weekStartDay = t.value === 'sun' ? 'sun' : 'mon';
      render();
    } else {
      S.cfg[t.dataset.c] = t.type === 'checkbox' ? t.checked : Math.max(5, +t.value || 90);
    }
    save('cfg');
  }
});

// Swipe handling: horizontal swipe on active exercise media navigates exercises; swipe left on set row deletes set
let sw, heroSw;
document.addEventListener('touchstart', e => {
  unlock();
  const mediaEl = e.target.closest('.work-hero-media');
  if (mediaEl && S.act && S.act.ex.length > 1) {
    heroSw = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  const r = e.target.closest('.set');
  sw = r && !e.target.closest('input,button') ? { r, x: e.touches[0].clientX, d: 0 } : null;
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (sw) {
    sw.d = Math.min(0, e.touches[0].clientX - sw.x);
    sw.r.style.transform = `translateX(${sw.d}px)`;
  }
}, { passive: true });

const resetSwipe = e => {
  if (heroSw && e && e.changedTouches && e.changedTouches[0]) {
    const dx = e.changedTouches[0].clientX - heroSw.x;
    const dy = e.changedTouches[0].clientY - heroSw.y;
    heroSw = null;
    if (Math.abs(dx) > 50 && Math.abs(dy) < 60) {
      if (dx < 0 && S.act && S.act.curEx < S.act.ex.length - 1) {
        S.act.curEx++;
        save('act');
        render();
        return;
      } else if (dx > 0 && S.act && S.act.curEx > 0) {
        S.act.curEx--;
        save('act');
        render();
        return;
      }
    }
  }
  heroSw = null;

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
  heroSw = null;
});

// ---- Boot Sequence ----
async function loadExercises() {
  let raw = null;
  try {
    const res = await fetch('./exercises.json');
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    raw = await res.json();
  } catch (err) {
    console.error('Failed to load exercises.json:', err);
    try {
      // Fallback attempt from root path
      const res2 = await fetch('exercises.json');
      if (!res2.ok) throw new Error('Fallback fetch failed: ' + res2.status);
      raw = await res2.json();
    } catch (err2) {
      console.error('Failed to load exercises.json fallback:', err2);
      if (typeof window !== 'undefined' && window.location) {
        try {
          const path = window.location.pathname || '/';
          const dir = path.substring(0, path.lastIndexOf('/') + 1) || '/';
          const fullPath = (window.location.origin || '') + dir + 'exercises.json';
          const res3 = await fetch(fullPath);
          if (!res3.ok) throw new Error('Path-based fetch failed: ' + res3.status);
          raw = await res3.json();
        } catch (err3) {
          console.error('Failed all attempts to load exercises.json:', err3);
        }
      }
    }
  }

  if (Array.isArray(raw) && raw.length > 0) {
    const normalized = raw.map(normalizeExercise);
    _global.__EXDB__ = normalized;
    if (typeof window !== 'undefined') window.__EXDB__ = normalized;
    EXDB = normalized;

    const idx = (typeof window !== 'undefined' && window.__EXIDX__) ? window.__EXIDX__ : (_global.__EXIDX__ || new Map());
    normalized.forEach(e => {
      if (typeof idx.set === 'function') idx.set(e.id, e);
      idx[e.id] = e;
    });
    _global.__EXIDX__ = idx;
    if (typeof window !== 'undefined') window.__EXIDX__ = idx;
    EXIDX = idx;
  } else if (Array.isArray(_global.__EXDB__) && _global.__EXDB__.length > 0) {
    EXDB = _global.__EXDB__;
    EXIDX = _global.__EXIDX__;
  }
  mergeCustomExercises();
  return EXDB;
}

async function init() {
  // 1. Asynchronously load all 1,324 exercises from local exercises.json
  await loadExercises();

  // 2. Load stored state from IndexedDB / localStorage
  for (const k of ['schemaVersion', 'routines', 'logs', 'weights', 'cfg', 'sched', 'act', 'deload', 'customExercises', 'nutrition', 'photos', 'lastBackupDate']) {
    try {
      const v = await get(k);
      if (k === 'schemaVersion' && v != null) {
        S.schemaVersion = Number(v) || 1;
      } else if (k === 'cfg' && v && typeof v === 'object') {
        S.cfg = { ...S.cfg, ...v };
      } else if (k === 'deload' && v && typeof v === 'object') {
        S.deload = { ...S.deload, ...v };
      } else if (k === 'nutrition' && v && typeof v === 'object') {
        S.nutrition = {
          targetCals: 2100,
          targetProtein: 140,
          targetCarbs: 240,
          targetFat: 60,
          targetFiber: 35,
          meals: {},
          ...v
        };
      } else if (v != null) {
        S[k] = v;
      }
    } catch {
      // Storage fallback absorbs
    }
  }
  if (!S.customExercises || !Array.isArray(S.customExercises)) S.customExercises = ls.get('customExercises') || [];
  mergeCustomExercises();
  if (!S.sched || typeof S.sched !== 'object') S.sched = {};
  if (!S.deload || typeof S.deload !== 'object') S.deload = { active: false, startedAt: null, lastDeloadDate: null };
  if (!S.nutrition || typeof S.nutrition !== 'object') {
    S.nutrition = { targetCals: 2100, targetProtein: 140, targetCarbs: 240, targetFat: 60, targetFiber: 35, meals: {} };
  }

  // 2b. Execute ordered migrations on stored state
  await runMigrations(S);

  // Key hygiene: purge any lingering API keys from S.cfg and stored lift_cfg
  if (S.cfg) {
    delete S.cfg.aiKey;
    delete S.cfg.aiProvider;
    delete S.cfg.aiModel;
    delete S.cfg.apiKey;
    delete S.cfg.ai_api_key;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const storedCfg = localStorage.getItem('lift_cfg');
      if (storedCfg) {
        const parsedCfg = JSON.parse(storedCfg);
        if (parsedCfg && typeof parsedCfg === 'object') {
          let dirty = false;
          for (const k of ['aiKey', 'aiProvider', 'aiModel', 'apiKey', 'ai_api_key']) {
            if (k in parsedCfg) {
              delete parsedCfg[k];
              dirty = true;
            }
          }
          if (dirty) {
            localStorage.setItem('lift_cfg', JSON.stringify(parsedCfg));
            await put('cfg', parsedCfg);
          }
        }
      }
    }
  } catch (_) {}

  // 3. Seed starter routines & split schedule if fresh install or empty routines
  if ((await get('seeded')) == null || !S.routines || !S.routines.length) {
    const upperId = uid();
    const lowerId = uid();
    const fullBodyId = uid();

    S.routines = [
      {
        id: upperId,
        name: 'Upper Body',
        ex: [
          { id: '0025', sets: 3, reps: 8, reps2: 12, w: 20, inc: 2.5, prog: 'linear', cur: 8, stalls: 0, note: '', ss: false }, // Barbell bench press
          { id: '0047', sets: 3, reps: 8, reps2: 12, w: 20, inc: 2.5, prog: 'linear', cur: 8, stalls: 0, note: '', ss: false }, // Barbell incline bench press
          { id: '0027', sets: 3, reps: 8, reps2: 12, w: 30, inc: 2.5, prog: 'linear', cur: 8, stalls: 0, note: '', ss: false }  // Barbell bent over row
        ]
      },
      {
        id: lowerId,
        name: 'Lower Body',
        ex: [
          { id: '0043', sets: 3, reps: 5, reps2: 8, w: 20, inc: 2.5, prog: 'linear', cur: 5, stalls: 0, note: '', ss: false },  // Barbell full squat
          { id: '0032', sets: 3, reps: 5, reps2: 8, w: 40, inc: 2.5, prog: 'linear', cur: 5, stalls: 0, note: '', ss: false },  // Barbell deadlift
          { id: '0001', sets: 3, reps: 15, reps2: 20, w: 0, inc: 1, prog: 'linear', cur: 15, stalls: 0, note: '', ss: false }   // 3/4 sit-up
        ]
      },
      {
        id: fullBodyId,
        name: 'Full Body',
        ex: [
          { id: '0043', sets: 3, reps: 5, reps2: 8, w: 20, inc: 2.5, prog: 'linear', cur: 5, stalls: 0, note: '', ss: false },
          { id: '0025', sets: 3, reps: 5, reps2: 8, w: 20, inc: 2.5, prog: 'linear', cur: 5, stalls: 0, note: '', ss: false },
          { id: '0032', sets: 3, reps: 5, reps2: 8, w: 40, inc: 2.5, prog: 'linear', cur: 5, stalls: 0, note: '', ss: false }
        ]
      }
    ];

    if (!S.sched || !Object.keys(S.sched).length) {
      S.sched = {
        1: upperId,    // Monday: Upper
        3: lowerId,    // Wednesday: Lower
        5: fullBodyId  // Friday: Full Body
      };
    }

    await save('routines', 'sched');
    await put('seeded', 1);
  }

  // 4. Check active workout
  if (S.act) {
    view = 'work';
    wake();
  }

  render();
  if (!isUserOnboarded()) {
    showOnboardingModal();
  }
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=7.0.3').then(reg => {
      reg.update();
    }).catch(err => console.warn('SW registration issue:', err));

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (S && S.act) {
        window._pendingSWReload = true;
        toast('Update ready. Will apply after workout.');
        return;
      }
      if (!window._swReloading) {
        window._swReloading = true;
        window.location.reload();
      }
    });
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target && e.target.id === 'ai-chat-input') {
    e.preventDefault();
    sendAICoachMessage();
  }
});

// Auto-run boot sequence
init();

// Expose test & inspection handle
if (typeof globalThis !== 'undefined') {
  globalThis.__MYGYM__ = {
    APP_VERSION,
    SHELL_VERSION,
    SafeHTML,
    html,
    esc,
    icon,
    ic,
    IC,
    AI_PROVIDERS,
    detectProviderFromKey,
    resolveAIConfig,
    updateAIModalFields,
    handleAIKeyInput,
    loadExercises,
    init,
    render,
    vTrain,
    vWork,
    vHist,
    vCal,
    finishWorkout,
    finish: finishWorkout,
    modal,
    closeModal,
    showSettingsModal,
    openPastWorkoutModal,
    savePastWorkout,
    editPastWorkout,
    callAI,
    testAIConnection,
    saveAIKey,
    clearAIKey,
    saveAISettings,
    findBestExerciseMatch,
    findClosestExercise,
    createCustomExerciseFromAI,
    openAIImportModal,
    parseAIWorkoutFromInput,
    parseWorkoutTextOfflineFallback,
    renderAIImportPreview,
    commitAIRoutine,
    openAICoachDrawer,
    sendAICoachMessage,
    refreshAIModels,
    AIConfig,
    get aiCoachHistory() { return aiCoachHistory; },
    set aiCoachHistory(v) { aiCoachHistory = v; },
    get parsedAIRoutine() { return parsedAIRoutine; },
    set parsedAIRoutine(v) { parsedAIRoutine = v; },
    Calc,
    calcWeeklyMuscleFrequency,
    renderWeeklyMuscleFrequencyCard,
    WEEKLY_FREQ_TARGETS,
    getFreeWorkoutExercises,
    showFreeWorkoutBuilderModal,
    startFreeWorkout,
    FREE_WORKOUT_TARGETS,
    matchesSubMuscle,
    SUB_MUSCLES,
    ls,
    put,
    save,
    renderRoutineSummaryRow,
    calcWorkload,
    checkDeloadStatus,
    getSupersetInfo,
    renderSupersetBanner,
    renderWorkHeroCard,
    showExpandedGifModal,
    showSupersetPicker,
    pairExercises,
    addToSupergroup,
    addAndPairFromLibrary,
    browseAndAddToSupergroup,
    unlinkSuperset,
    switchWorkExercise,
    handleSetCompleted,
    S,
    T,
    tick,
    startRest,
    stopRest,
    setVolume,
    get EXIDX() {
      if ((!EXIDX || (typeof EXIDX.size === 'number' && EXIDX.size === 0) || (typeof EXIDX === 'object' && Object.keys(EXIDX).length === 0)) && _global.__EXIDX__) {
        EXIDX = _global.__EXIDX__;
      }
      return EXIDX;
    },
    set EXIDX(val) {
      if (val && ((typeof val.size === 'number' && val.size > 0) || (typeof val === 'object' && Object.keys(val).length > 0))) {
        EXIDX = val;
        _global.__EXIDX__ = val;
        if (typeof window !== 'undefined') window.__EXIDX__ = val;
      } else {
        EXIDX = val;
      }
    },
    get EXDB() {
      if ((!EXDB || EXDB.length === 0) && _global.__EXDB__ && _global.__EXDB__.length > 0) {
        EXDB = _global.__EXDB__;
      }
      return EXDB;
    },
    set EXDB(val) {
      if (Array.isArray(val) && val.length > 0) {
        EXDB = val;
        _global.__EXDB__ = val;
        if (typeof window !== 'undefined') window.__EXDB__ = val;
      } else {
        EXDB = val;
      }
    },
    exById,
    X: exById,
    normalizeExercise,
    playRestChime,
    beep,
    showExercisePicker,
    showExercisePickerPreview,
    renderPickResults,
    mmap,
    mmLog,
    showMuscleDetailSheet,
    mapMuscleToAnatomyKey,
    getTopExercisesForMuscle,
    ANATOMY_MUSCLES,
    generateAnatomySvg,
    calcUSNavyBF,
    calcNutritionTargets,
    getMorphInterpolation,
    getDefaultPhysiqueConfig,
    getPhysiqueState,
    generateMorphSvg,
    updateMorphVisuals,
    showPhysiqueCalibrationModal,
    renderTransformationRoadmapCard,
    vBody,
    vWeight,
    checkPersonalRecord,
    getLastSessionExercise,
    getTransformationMetrics,
    isCardioOrMobilityExercise,
    showJargonSheet,
    showCustomExerciseModal,
    saveCustomExerciseFromForm,
    mergeCustomExercises,
    getAchievementsData,
    renderAchievementsCard,
    matchesExerciseSearch,
    SEARCH_SYNONYMS,
    showExerciseHistoryModal,
    sanitizeAndValidateAIRoutine,
    get nutritionSelectedDate() { return nutritionSelectedDate; },
    set nutritionSelectedDate(v) { nutritionSelectedDate = v; },
    get bodySubTab() { return bodySubTab; },
    set bodySubTab(v) { bodySubTab = v; },
    formatNutritionDateDisplay,
    getNutritionData,
    changeNutritionDate,
    resetNutritionDateToToday,
    renderNutritionDashboard,
    renderNutritionPreviewCard,
    showMealModal,
    saveMealFromModal,
    clearMealFromModal,
    autocalcMealCals,
    showNutritionTargetsModal,
    saveNutritionTargetsFromModal,
    applyMacroPreset,
    runMigrations,
    MIGRATIONS,
    SCHEMA_VERSION,
    calcPlates,
    applySanitizedBackup,
    openCSVImportModal,
    runCSVPreview,
    commitCSVImport,
    showOnboardingModal,
    handleOnboardingSubmit,
    isUserOnboarded,
    renderTrainingInsightsCard,
    getExRest,
    isWebGLAvailable,
    lazyLoadThree,
    buildProceduralAnatomyModel,
    init3DViewer,
    show3DAnatomyModal,
    show3DPhysiqueModal,
    animateCounter,
    renderVolumeRadarChart,
    triggerPRCelebration,
    get active3DViewer() { return active3DViewer; },
    set active3DViewer(v) { active3DViewer = v; }
  };
}

