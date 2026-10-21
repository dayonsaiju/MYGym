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
  cfg: { rest: 90, flash: true, sound: true, vibrate: true, inc: 2.5, bodyModel: 'male', physique: null },
  sched: {},
  act: null,
  deload: { active: false, startedAt: null, lastDeloadDate: null }
};

const APP_VERSION = '5.6.0';
const SHELL_VERSION = 'mygym-core-v5.6.0-reviewed';

let view = 'train', P, E, U, wl, ac, tt;
let pickQuery = '', pickCategory = 'All', workTimerInterval = null;
let swapQuery = '', swapCategory = 'All', swapIdx = 0;
let bodyMetricView = 'both'; // 'both', 'weight', 'waist'
let histQuery = '', histRoutine = 'All';
let workGifCollapsed = false;
let lastRoutineSyncBackup = null;
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

const save = (...k) => Promise.all(k.map(x => put(x, S[x])));

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
  const isCardio = e.bp === 'cardio' || e.t === 't';
  const isBodyweight = e.eq === 'body weight' || e.t === 'b';
  const modality = isCardio ? 'timed_cardio' : (isBodyweight ? 'bodyweight' : 'strength');
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
    u: false
  };
};

const X = id => {
  const sid = String(id || '');
  if (EXIDX[sid]) {
    const ex = EXIDX[sid];
    if (!ex.type) {
      ex.type = (ex.t === 't' || ex.bp === 'cardio') ? 'timed_cardio' : ((ex.t === 'b' || ex.eq === 'body weight') ? 'bodyweight' : 'strength');
    }
    return ex;
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
};

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

// ---- Icons ----
const IC = {
  act: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  weight: '<path d="m21.3 8.7-12.6 12.6a1 1 0 0 1-1.4 0l-5.6-5.6a1 1 0 0 1 0-1.4L14.3 1.7a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  sl: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  chk: '<polyline points="20 6 9 17 4 12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  disc: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>'
};
const ic = (n, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[n] || ''}</svg>`;

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
  return `
    <div class="mm-wrap" id="mm-container">
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

const getLastSessionExercise = id => {
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
  const d = sets.filter(s => s && (s.done || (s.sideL && s.sideR)));
  const R = n => Math.round(n / 2.5) * 2.5;
  const ok = d.length >= rx.sets && d.every(s => (Number(s.r) || 0) >= need);

  // Check RIR signals across completed sets
  const setsWithRir = d.filter(s => s.rir != null);
  const allHighRir = setsWithRir.length >= rx.sets && setsWithRir.every(s => Number(s.rir) >= 2);
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

function startRest(s) {
  unlock();
  T.durMs = Math.max(1, s) * 1000;
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
  if (S.act && document.visibilityState === 'visible') wake();
});

const modal = (h, opts = {}) => {
  const showX = opts?.hideClose ? '' : '<button class="x" data-a="close">Close</button>';
  $('#m').innerHTML = `<div class="sheet">${showX}${h}</div>`;
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
  if (exId && isCardioOrMobilityExercise(exId)) return 0;
  const w = Math.max(0, Number(s?.w) || 0);
  const r = Math.max(0, Number(s?.r) || 0);
  const uni = isUni || s?.uni;
  const hasBoth = s?.done || (s?.sideL && s?.sideR);
  const hasOne = s?.sideL || s?.sideR;
  const mult = uni ? (hasBoth ? 2 : (hasOne ? 1 : 2)) : 1;
  return w * r * mult;
};

const vol = l => Math.round((l?.ex || []).reduce((a, x) => {
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

// ---- 100% Offline Deterministic Recovery & ACWR Engine ----
const calcWorkload = (logs = S.logs) => {
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

// ---- Views ----

// 1. Train View
const vTrain = () => {
  const todayDay = new Date().getDay();
  const todayRid = S.sched ? (S.sched[todayDay] || '') : '';
  const todayRoutine = todayRid ? S.routines.find(r => r.id === todayRid) : null;
  const completedToday = S.logs.some(l => dk(l.date) === dk(Date.now()));

  const workload = calcWorkload(S.logs);
  const deloadInfo = checkDeloadStatus(S.logs);
  const muscleVolumes = getWeeklyMuscleVolumes(S.logs);

  return viewHeader('Train') +
    renderStreakBadge() +
    (S.act ? `<button class="btn" data-a="tab" data-k="work" style="margin-bottom:12px">⚡ Resume Workout: ${esc(S.act.name)}</button>` : '') +

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
    (todayRoutine && !S.act ? `
      <div class="card today-split-hero">
        <div class="row">
          <div>
            <div class="today-split-badge">⭐ Today's Split (${DAYS[todayDay]})</div>
            <div class="today-split-title">${esc(todayRoutine.name)}</div>
          </div>
          ${completedToday
            ? `<span class="today-chip" style="background:var(--gn);color:#000000;font-size:12px;padding:6px 14px;font-weight:700">✓ Done Today</span>`
            : `<button class="btn sched-start-btn" data-a="start" data-id="${esc(todayRoutine.id)}">⚡ Start Workout</button>`
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

    // Main Content: Routines Prominently Visible Without Massive Scrolling
    '<h2>Routines</h2>' +
    (S.routines.length ? S.routines.map(r => {
      const scheduledDays = Object.entries(S.sched || {})
        .filter(([_, rid]) => rid === r.id)
        .map(([day]) => DAYS_SHORT[+day]);
      return `<div class="card" style="margin-bottom:10px">
        <div class="row">
          <b>${esc(r.name)}</b>
          <span class="t2 sm">${r.ex.length} exercises</span>
        </div>
        ${scheduledDays.length ? `<div style="margin:4px 0"><span class="today-chip" style="font-size:10px;padding:2px 6px">${scheduledDays.join(', ')}</span></div>` : ''}
        <div class="routine-summary-list">
          ${r.ex.map(renderRoutineSummaryRow).join('')}
        </div>
        <div class="row g" style="margin-top:10px">
          <button class="btn" data-a="start" data-id="${esc(r.id)}">Start</button>
          <button class="btn s" data-a="edit" data-id="${esc(r.id)}">Edit</button>
        </div>
      </div>`;
    }).join('') : `
      <div class="card empty-state-card">
        <div class="empty-state-icon">🏋️‍♂️</div>
        <div class="empty-state-title">No routines created yet</div>
        <p class="t2 sm">Build custom routines to track progressive overload automatically.</p>
        <div class="row g" style="margin-top:14px">
          <button class="btn" data-a="edit">${ic('plus', 16)} Create Routine</button>
          <button class="btn s" data-a="start">Quick Empty Workout</button>
        </div>
      </div>
    `) +
    (S.routines.length ? `
      <div class="row g" style="margin-top:8px;margin-bottom:8px">
        <button class="btn s" data-a="edit">${ic('plus', 18)} New routine</button>
        <button class="btn s" data-a="start">Empty workout</button>
      </div>
    ` : '') +

    // Bottom of Train Tab: Clean Collapsible Recovery & Muscle Fatigue Insights
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
    </details>`;
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
          <div class="work-hero-title">${esc(exInfo.name)}</div>
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
        </div>
      </div>

      <!-- PRIMARY VIEWPORT ELEMENT: Sets & Reps Logger Table above the fold -->
      <div class="work-sets-container">
        <div class="set-header-row">
          <span style="width:34px;text-align:center">Set</span>
          <span class="set-prev-hdr" style="width:78px;text-align:center">Prev</span>
          <span style="flex:1.2;text-align:center">${exInfo.type === 'timed_cardio' || exInfo.t === 't' ? 'Duration' : 'Weight (kg)'}</span>
          <span style="flex:1;text-align:center">${exInfo.type === 'timed_cardio' || exInfo.t === 't' ? 'Target (s)' : 'Reps'}</span>
          <span style="width:58px;text-align:center">RIR <button class="jargon-micro-btn" data-a="explainjargon" data-term="rir" title="Explain RIR">?</button></span>
          <span style="width:${currentEx.uni ? '84px' : '40px'};text-align:center">${currentEx.uni ? 'L / R' : 'Done'}</span>
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

          const r = (f, v, u) => {
            if (f === 'w' && exInfo.type !== 'timed_cardio' && exInfo.t !== 't') {
              return `<div class="set-input-wrap has-steppers ${isBarbell ? 'has-plate-btn' : ''}">
                <button class="step-btn step-minus" data-a="stepw" data-i="${curIdx}" data-j="${j}" data-delta="-2.5" title="-2.5 kg">-2.5</button>
                <input type="number" inputmode="decimal" data-f="w" data-i="${curIdx}" data-j="${j}" value="${v}">
                <span class="u">${u}</span>
                <button class="step-btn step-plus" data-a="stepw" data-i="${curIdx}" data-j="${j}" data-delta="2.5" title="+2.5 kg">+2.5</button>
                ${isBarbell ? `<button class="plate-calc-btn" data-a="openplatecalc" data-w="${s.w || 20}" data-name="${esc(exInfo.name)}" title="Plate Calculator">${ic('disc', 14)}</button>` : ''}
              </div>`;
            }
            return `<div class="set-input-wrap">
              <input type="number" inputmode="${f === 'r' ? 'numeric' : 'decimal'}" data-f="${f}" data-i="${curIdx}" data-j="${j}" value="${v}">
              <span class="u">${u}</span>
            </div>`;
          };

          const isFail = s.rir === 0 || s.rpe >= 10;
          const isSet = s.rir != null || (s.rpe != null && s.rpe !== '');
          const rirText = s.rir != null ? (s.rir === 0 ? '0 💥' : (s.rir >= 3 ? '3+' : s.rir)) : (s.rpe != null && s.rpe !== '' ? (10 - +s.rpe) : 'RIR');
          const isSetDone = s.done || (currentEx.uni && s.sideL && s.sideR);
          const pr = isSetDone ? checkSetPR(currentEx.id, s, currentEx.uni) : null;

          return `<div class="set ${s.done ? 'd' : ''}" data-i="${curIdx}" data-j="${j}">
            <button class="n" data-a="done" data-i="${curIdx}" data-j="${j}">
              ${j + 1}${pr ? `<span class="set-pr-badge" title="${pr.desc}">🏆 PR!</span>` : ''}
            </button>
            <span class="set-prev-cell" title="Prev session set ${j + 1}: ${prevText}">Prev: ${esc(prevText)}</span>
            ${exInfo.type === 'timed_cardio' || exInfo.t === 't' ? '' : r('w', s.w, (exInfo.type === 'bodyweight' || exInfo.t === 'b') ? '+kg' : 'kg')}
            ${r('r', s.r, (exInfo.type === 'timed_cardio' || exInfo.t === 't') ? 'sec' : 'reps')}
            <button class="rir-pill ${isFail ? 'rir-fail' : (isSet ? 'rir-set' : '')}" data-a="openrir" data-i="${curIdx}" data-j="${j}" title="Reps In Reserve / Intensity">${rirText}</button>
            ${currentEx.uni ? `
              <div class="uni-ck-group">
                <button class="uni-ck ${s.sideL ? 'd' : ''}" data-a="donel" data-i="${curIdx}" data-j="${j}" title="Left Side Complete">L ${s.sideL ? '✓' : ''}</button>
                <button class="uni-ck ${s.sideR ? 'd' : ''}" data-a="doner" data-i="${curIdx}" data-j="${j}" title="Right Side Complete">R ${s.sideR ? '✓' : ''}</button>
              </div>
            ` : `
              <button class="ck ${s.done ? 'd' : ''}" data-a="done" data-i="${curIdx}" data-j="${j}">${ic('chk', 18)}</button>
            `}
          </div>`;
        }).join('')}
      </div>

      <div class="row g" style="margin-top:10px">
        <button class="btn s" data-a="addset" data-i="${curIdx}">${ic('plus', 16)} Add set</button>
        <button class="btn s" data-a="delset" data-i="${curIdx}" ${currentEx.sets.length <= 1 ? 'disabled style="opacity:0.3"' : ''}>Delete set</button>
      </div>
      <textarea class="note" placeholder="Exercise cues/notes (seat height, grip width, tempo)..." data-f="note" data-i="${curIdx}" rows="2">${esc(currentEx.note || '')}</textarea>

      <!-- Compact / Collapsible Exercise Demonstration GIF -->
      <div class="work-hero-media" data-a="zoomexgif" data-id="${esc(exInfo.id)}" ${workGifCollapsed ? 'style="display:none"' : ''} title="Tap to expand fullscreen demonstration">
        <img class="work-hero-gif" src="./media/${esc(exInfo.gif || exInfo.img)}" alt="${esc(exInfo.name)}" loading="eager" onerror="this.onerror=null;this.src='./media/${esc(exInfo.img || exInfo.gif)}';">
        <div class="work-gif-tap-hint">🔍 Tap to expand</div>
      </div>

      <!-- Neat Decluttered Horizontal Toolbar directly below the media frame -->
      <div class="work-hero-toolbar">
        <button class="chip" data-a="swapex" data-i="${curIdx}">⇄ Swap</button>
        <button class="chip" data-a="zoomexgif" data-id="${esc(exInfo.id)}">ℹ️ Form Cues</button>
        ${ssInfo.isSuperset && ssInfo.isPaired
          ? `<button class="chip on ss-chip" data-a="opensspicker" data-i="${curIdx}">⚡ ${ssInfo.typeLabel} [${ssInfo.label}]</button>`
          : `<button class="chip ss-chip" data-a="opensspicker" data-i="${curIdx}">🔗 Link Superset</button>`
        }
        <button class="chip ${currentEx.uni ? 'on' : ''}" data-a="toggleuni" data-i="${curIdx}">${currentEx.uni ? '⚖️ Each Side' : '⇄ Unilateral'}</button>
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
        startRest(S.cfg.rest);
        toast(`⏱️ ${ssInfo.typeLabel} Rest: Up Next Round ${nextRoundSetIdx + 1} (${esc(X(firstEx.id).name)})`);
      } else {
        T.supersetLoop = null;
        startRest(S.cfg.rest);
        toast(`🎉 ${ssInfo.tag} All ${ssInfo.totalRounds} Rounds Complete!`);
      }
      return;
    }
  }

  // Regular non-superset exercise
  if (!x.ss) {
    startRest(S.cfg.rest);
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
        <button class="gear-btn frosted sm" data-a="opensettings" aria-label="Settings" title="Settings">${ic('gear', 18)}</button>
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

const renderExRows = items => {
  if (!items.length) {
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

  exList.innerHTML = renderExRows(visible);

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
    `<div class="chips">${BP_CATEGORIES.map(c => `<button class="chip ${libCategory === c ? 'on' : ''}" data-a="libcat" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` +
    `<div class="row" style="margin-bottom:12px"><label class="t2 sm" style="flex:1">Equipment:<select data-f="libeq">${EQ_OPTIONS.map(eq => `<option value="${esc(eq)}" ${libEquipment === eq ? 'selected' : ''}>${esc(eq.toUpperCase())}</option>`).join('')}</select></label><span id="ex-count" class="t2 sm" style="align-self:flex-end;margin-bottom:10px">${filtered.length} exercises</span></div>` +
    `<div id="ex-list" class="card" style="padding:0 12px">${renderExRows(visible)}</div>` +
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
    `</div>` +
    `<h2>${esc(selDateDisplay)}</h2>` +
    (selLogs.length ? selLogs.map(l => `
      <div class="card">
        <div class="row"><b>${esc(l.name)}</b><span class="t2 sm">${Math.round(l.dur / 60000)} min · ${vol(l)} kg volume</span></div>
        <div class="routine-summary-list">
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

function vBody() {
  const p = getPhysiqueState();
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

  return viewHeader('Body & Transformation') +
    roadmapHtml +
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
      `<div class="meas-inputs">` +
        `<input type="number" step="0.1" inputmode="decimal" id="wt-input" placeholder="Weight (kg)">` +
        `<input type="number" step="0.5" inputmode="decimal" id="waist-input" placeholder="Waist (cm)">` +
      `</div>` +
      `<div class="row" style="margin-top:8px">` +
        `<input type="date" id="wt-date" value="${esc(todayStr)}" style="flex:1">` +
        `<button class="btn" data-a="logweight" style="width:auto;flex:1;margin:0">Save Entry</button>` +
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
              ⏱️ ${durMin} min · 📦 ${volume} kg volume · 🏋️ ${l.ex.length} exercises
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
  const v = $('#v'), y = v.scrollTop;
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
    if (q) {
      return e.name.toLowerCase().includes(q) || e.tg.toLowerCase().includes(q) || e.eq.toLowerCase().includes(q);
    }
    return true;
  }).slice(0, 50);

  if (!filtered.length) {
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
  modal(`<h2>${esc(title)}</h2>
    <input id="pick-search-input" class="txt" placeholder="Search 1,300+ exercises..." data-f="picksearch" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
    <div class="chips" style="margin-bottom:8px">
      ${BP_CATEGORIES.map(c => `<button class="chip ${pickCategory === c ? 'on' : ''}" data-a="pickcat" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>
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

function exp() {
  const b = new Blob([JSON.stringify({ app: 'lift', v: 1, exported: Date.now(), routines: S.routines, logs: S.logs, weights: S.weights, cfg: S.cfg, sched: S.sched || {} }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `mygym-backup-${new Date().toISOString().slice(0, 10)}.json`;
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

    await save('routines', 'logs', 'weights', 'cfg', 'sched');
    toast('Backup restored');
    render();
  } catch (err) {
    console.warn('Backup import blocked:', err.message);
    toast('Invalid backup file');
  }
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
  toast('Exported workouts to CSV');
}

// ---- Settings Modal (Clean Separation of App Prefs, Cache, Data Management) ----
function showSettingsModal() {
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
          <div style="padding:10px 0">
            <button class="btn s" data-a="forceupdate" style="width:100%">${ic('sync', 16)} Force Cache Reload</button>
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
            <label class="btn s" style="display:flex;align-items:center;justify-content:center;cursor:pointer;margin-bottom:4px">
              Restore Backup (JSON)
              <input type="file" id="f" accept=".json" style="display:none">
            </label>
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

// ---- Finish Workout ----
function finish() {
  const a = S.act;
  if (!a) return;
  const ex = a.ex.map(x => ({
    id: x.id,
    note: x.note || '',
    uni: !!x.uni,
    sets: x.sets.filter(s => s.done || (x.uni && (s.sideL || s.sideR))).map(s => {
      const rirVal = s.rir != null && s.rir !== '' ? Number(s.rir) : (s.rpe != null && s.rpe !== '' ? Math.max(0, 10 - Number(s.rpe)) : null);
      const isDone = s.done || (x.uni && s.sideL && s.sideR);
      return {
        w: Number(s.w) || 0,
        r: Number(s.r) || 0,
        rpe: s.rpe === '' || s.rpe == null ? (rirVal != null ? 10 - rirVal : null) : Number(s.rpe),
        rir: rirVal,
        uni: !!x.uni,
        sideL: !!s.sideL,
        sideR: !!s.sideR,
        done: !!isDone
      };
    })
  })).filter(x => x.sets.length);

  if (!ex.length) return toast('Complete at least one set first');

  // Detect PRs achieved during active session
  const sessionPRs = [];
  ex.forEach(x => {
    const e = X(x.id);
    x.sets.forEach((s, idx) => {
      const pr = checkSetPR(x.id, s, x.uni);
      if (pr) {
        sessionPRs.push({
          exName: e.name,
          setIdx: idx + 1,
          type: pr.type,
          desc: pr.desc,
          w: s.w,
          r: s.r
        });
      }
    });
  });

  const r = S.routines.find(r => r.id === a.rid);
  const notes = [];
  if (r) {
    lastRoutineSyncBackup = {
      rid: r.id,
      backup: r.ex.map(rx => ({
        id: rx.id,
        sets: (rx.sets || []).map(s => ({ ...s }))
      })),
      appliedEx: ex
    };

    // By default (checked), update routine base weights with today's completed weights
    ex.forEach(completedEx => {
      const rx = r.ex.find(q => String(q.id) === String(completedEx.id));
      if (rx && rx.sets) {
        completedEx.sets.forEach((s, idx) => {
          if (rx.sets[idx] && s.w > 0) {
            rx.sets[idx].w = s.w;
          }
        });
      }
    });

    a.ex.forEach(x => {
      const rx = r.ex.find(q => String(q.id) === String(x.id));
      if (rx) {
        if (x.note !== undefined) rx.note = x.note;
        if (x.uni !== undefined) rx.uni = x.uni;
        if (x.sets.some(s => s.done || s.sideL || s.sideR)) notes.push(X(x.id).name + ': ' + prog(rx, x.sets));
      }
    });
  }

  // RIR & Fatigue Session Summary
  const allLoggedSets = ex.flatMap(x => x.sets);
  const setsWithRir = allLoggedSets.filter(s => s.rir != null);
  let rirSummaryHtml = '';
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
  const failureHtml = failSetsCount > 0 ? `<div class="row" style="margin-top:6px"><b>High Fatigue Sets:</b> <span style="color:var(--rd)">💥 ${failSetsCount} set(s) taken to Failure (RIR 0)</span></div>` : '';

  const isDeload = !!a.isDeload;
  const deloadHtml = isDeload ? `<div class="row" style="margin-top:6px"><b>Protocol:</b> <span style="color:var(--gn)">Deload Recovery Session (-50% target sets)</span></div>` : '';

  // Compare vs Last Session of same routine or previous log
  const prevLog = S.logs.filter(l => l.name === a.name).at(-1) || S.logs.at(-1);
  const curVol = ex.reduce((sum, x) => sum + x.sets.reduce((sSum, s) => sSum + (s.w * s.r * (x.uni ? 2 : 1)), 0), 0);
  let volDeltaHtml = '';
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
  }

  const curDurMin = Math.round((Date.now() - a.t0) / 60000);
  let durDeltaHtml = '';
  if (prevLog && prevLog.dur) {
    const prevDurMin = Math.round(prevLog.dur / 60000);
    const diffDur = curDurMin - prevDurMin;
    durDeltaHtml = `<span class="t2 sm"> (${diffDur >= 0 ? '+' : ''}${diffDur} min vs last)</span>`;
  }

  const totalSetsCount = ex.reduce((acc, x) => acc + x.sets.length, 0);
  let setsDeltaHtml = '';
  if (prevLog) {
    const prevSetsCount = prevLog.ex.reduce((acc, x) => acc + x.sets.length, 0);
    const diffSets = totalSetsCount - prevSetsCount;
    setsDeltaHtml = `<span class="t2 sm"> (${diffSets >= 0 ? '+' : ''}${diffSets} sets vs last)</span>`;
  }

  const log = { id: uid(), date: Date.now(), name: a.name, dur: Date.now() - a.t0, ex, isDeload };
  S.logs.push(log);
  S.act = null;

  // Calculate micro-progress increment (+0.3% to +0.5% based on workout volume and consistency)
  const baseInc = 0.3;
  const volBonus = curVol >= 3500 ? 0.1 : 0;
  const streakBonus = streak() >= 2 ? 0.1 : 0;
  const microInc = Math.min(0.5, Math.round((baseInc + volBonus + streakBonus) * 10) / 10);

  if (!S.cfg.physique) S.cfg.physique = getDefaultPhysiqueConfig(S.cfg.bodyModel);
  S.cfg.physique.microProgressBonus = Math.round(((S.cfg.physique.microProgressBonus || 0) + microInc) * 10) / 10;

  save('logs', 'act', 'routines', 'cfg');
  stopRest();
  wl?.release?.();

  modal(`<h2>Workout Complete! 🏆</h2>
    <div class="transformation-celebration-banner">
      <span class="tcb-fire">🔥</span>
      <div class="tcb-body">
        <div class="tcb-title">Transformation Progress: +${microInc}% today!</div>
        <div class="tcb-sub">1 workout closer to your goal physique 🔥</div>
      </div>
    </div>
    ${mmLog(log)}
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
        <span>${log.ex.length}</span>
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
      libPageSize = 40;
      document.querySelectorAll('.chips button[data-a="libcat"]').forEach(btn => {
        btn.classList.toggle('on', btn.dataset.cat === libCategory);
      });
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
      const dinp = $('#wt-date');
      const valW = parseFloat(inpW?.value);
      const valWaist = parseFloat(inpWaist?.value);
      const dateVal = dinp?.value || new Date().toISOString().slice(0, 10);

      const hasW = Number.isFinite(valW) && valW > 0 && valW < 500;
      const hasWaist = Number.isFinite(valWaist) && valWaist > 0 && valWaist < 300;

      if (!hasW && !hasWaist) {
        toast('Please enter a valid weight or waist size');
        return;
      }

      // Check if entry for date already exists to merge
      const existing = S.weights.find(x => x.date === dateVal);
      if (existing) {
        if (hasW) existing.w = rd(valW);
        if (hasWaist) existing.waist = rd(valWaist);
        existing.t = new Date(dateVal + 'T12:00:00').getTime();
      } else {
        S.weights.push({
          id: uid(),
          date: dateVal,
          w: hasW ? rd(valW) : null,
          waist: hasWaist ? rd(valWaist) : null,
          t: new Date(dateVal + 'T12:00:00').getTime()
        });
      }
      save('weights');
      if (inpW) inpW.value = '';
      if (inpWaist) inpWaist.value = '';
      const feedback = [
        hasW ? `${rd(valW)} kg` : null,
        hasWaist ? `${rd(valWaist)} cm waist` : null
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
      if (confirm('Clear local app shell cache and force reload latest version?')) {
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
          window.location.href = window.location.origin + window.location.pathname + '?t=' + Date.now();
        })();
      }
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
      const x = S.act?.ex[i], s = x?.sets[j];
      if (!s) return;
      if (x.uni) {
        if (s.done) {
          s.done = false;
          s.sideL = false;
          s.sideR = false;
          save('act');
          switchWorkExercise(i, false);
          return;
        } else {
          s.done = true;
          s.sideL = true;
          s.sideR = true;
          save('act');
          handleSetCompleted(i, j, s, x);
          return;
        }
      } else {
        const wasDone = s.done;
        s.done = !s.done;
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
        save('act');
      }
      break;
    }
    case 'donel': {
      const x = S.act?.ex[i], s = x?.sets[j];
      if (!s) return;
      s.sideL = !s.sideL;
      const wasDone = s.done;
      s.done = !!(s.sideL && s.sideR);
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
      const x = S.act?.ex[i], s = x?.sets[j];
      if (!s) return;
      s.sideR = !s.sideR;
      const wasDone = s.done;
      s.done = !!(s.sideL && s.sideR);
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
      save('act');
      break;
    }
    case 'delset': {
      const x = S.act?.ex[i];
      if (x && x.sets.length > 1) {
        x.sets.pop();
        save('act');
        break;
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
      document.querySelectorAll('.chips button[data-a="pickcat"]').forEach(btn => {
        btn.classList.toggle('on', btn.dataset.cat === pickCategory);
      });
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
          <button class="btn" data-a="fin" style="margin-bottom:8px">Finish & Log Workout 🏆</button>
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
    case 'delr': if (confirm('Delete this routine?')) { S.routines = S.routines.filter(r => r.id !== E.id); save('routines'); close(); break; } return;
    case 'exp': exp(); return;
    case 'expcsv': expCSV(); return;
    case 'opensettings': showSettingsModal(); return;
    case 'wipe-step1': showWipeConfirmModal(); return;
    case 'wipe-confirm': {
      S.routines = []; S.logs = []; S.weights = []; S.act = null; S.sched = {};
      save('routines', 'logs', 'weights', 'cfg', 'sched', 'act');
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
});
document.addEventListener('blur', e => handleFieldUpdate(e.target), true);
document.addEventListener('change', e => {
  const t = e.target;
  handleFieldUpdate(t);
  if (t.id === 'f' && t.files[0]) {
    imp(t.files[0]);
    t.value = '';
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
    EXDB = raw.map(normalizeExercise);
    EXIDX = {};
    EXDB.forEach(e => { EXIDX[e.id] = e; });
  }
  return EXDB;
}

async function init() {
  // 1. Asynchronously load all 1,324 exercises from local exercises.json
  await loadExercises();

  // 2. Load stored state from IndexedDB / localStorage
  for (const k of ['routines', 'logs', 'weights', 'cfg', 'sched', 'act', 'deload']) {
    try {
      const v = await get(k);
      if (k === 'cfg' && v && typeof v === 'object') {
        S.cfg = { ...S.cfg, ...v };
      } else if (k === 'deload' && v && typeof v === 'object') {
        S.deload = { ...S.deload, ...v };
      } else if (v != null) {
        S[k] = v;
      }
    } catch {
      // Storage fallback absorbs
    }
  }
  if (!S.sched || typeof S.sched !== 'object') S.sched = {};
  if (!S.deload || typeof S.deload !== 'object') S.deload = { active: false, startedAt: null, lastDeloadDate: null };

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
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=5.6.0').then(reg => {
      reg.update();
    }).catch(err => console.warn('SW registration issue:', err));

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!window._swReloading) {
        window._swReloading = true;
        window.location.reload();
      }
    });
  }
}

// Auto-run boot sequence
init();

// Expose test & inspection handle
if (typeof globalThis !== 'undefined') {
  globalThis.__MYGYM__ = {
    APP_VERSION,
    SHELL_VERSION,
    loadExercises,
    init,
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
    EXIDX,
    get EXDB() { return EXDB; },
    set EXDB(val) { EXDB = val; },
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
    showJargonSheet
  };
}

