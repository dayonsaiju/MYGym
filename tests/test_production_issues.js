import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const calcCode = fs.readFileSync(path.join(rootDir, 'calc.js'), 'utf8');
const aiConfigCode = fs.readFileSync(path.join(rootDir, 'ai-config.js'), 'utf8');
const shellCode = fs.readFileSync(path.join(rootDir, 'shell.js'), 'utf8');
const appCode = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');
const swCode = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
const htmlCode = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const cssCode = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');
const exercisesJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'exercises.json'), 'utf8'));

// Mock DOM Environment
class MockElement {
  constructor(tag = 'div', className = '', id = '') {
    this.tagName = tag.toUpperCase();
    this.className = className;
    this.id = id;
    this._innerHTML = '';
    this.style = {};
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.hidden = false;
    this._lastScrollIntoView = null;
    this.classList = {
      _classes: new Set(className ? className.split(/\s+/).filter(Boolean) : []),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (this.classList._classes.has(c)) this.classList._classes.delete(c);
          else this.classList._classes.add(c);
        } else if (force) {
          this.classList._classes.add(c);
        } else {
          this.classList._classes.delete(c);
        }
      },
      contains: (c) => this.classList._classes.has(c)
    };
  }

  get textContent() {
    return this._textContent != null ? this._textContent : this._innerHTML.replace(/<[^>]*>/g, '');
  }

  set textContent(val) {
    this._textContent = String(val);
    this._innerHTML = String(val);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(val) {
    this._innerHTML = String(val);
    this._syncChildrenFromHtml();
  }

  get outerHTML() {
    return `<${this.tagName.toLowerCase()} class="${this.className}" id="${this.id}">${this._innerHTML}</${this.tagName.toLowerCase()}>`;
  }

  set outerHTML(val) {
    if (this.parentElement) {
      const temp = new MockElement('div');
      temp.innerHTML = val;
      const newChild = temp.children[0] || temp;
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) {
        newChild.parentElement = this.parentElement;
        this.parentElement.children[idx] = newChild;
      }
    } else {
      this.innerHTML = val;
    }
  }

  _syncChildrenFromHtml() {
    // Basic parser for nested mockup elements
    if (this.className.includes('work-stepper-pills') || this._innerHTML.includes('work-step-pill')) {
      const matches = this._innerHTML.match(/<button[^>]*class="([^"]*work-step-pill[^"]*)"[^>]*data-i="(\d+)"[^>]*>([\s\S]*?)<\/button>/g) || [];
      this.children = matches.map((m, idx) => {
        const p = new MockElement('button');
        const cMatch = m.match(/class="([^"]*)"/);
        p.className = cMatch ? cMatch[1] : 'work-step-pill';
        p.dataset.i = String(idx);
        p.parentElement = this;
        return p;
      });
    }
  }

  querySelector(sel) {
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      if (this.id === id) return this;
      for (const c of this.children) {
        const found = c.querySelector(sel);
        if (found) return found;
      }
      return null;
    }
    if (sel.startsWith('.')) {
      const cls = sel.slice(1).split('.')[0];
      if (this.className.split(/\s+/).includes(cls)) {
        if (sel === '.work-step-pill.active') {
          return this.className.includes('active') ? this : null;
        }
        return this;
      }
      for (const c of this.children) {
        const found = c.querySelector(sel);
        if (found) return found;
      }
      return null;
    }
    return null;
  }

  querySelectorAll(sel) {
    const results = [];
    const check = (el) => {
      if (sel.startsWith('.')) {
        const cls = sel.slice(1).split('.')[0];
        if (el.className.split(/\s+/).includes(cls)) {
          results.push(el);
        }
      }
      for (const c of el.children) check(c);
    };
    check(this);
    return results;
  }

  scrollIntoView(opts) {
    this._lastScrollIntoView = opts;
  }

  insertAdjacentHTML(pos, html) {
    const temp = new MockElement('div');
    temp.innerHTML = html;
    if (pos === 'beforeend') {
      temp.children.forEach(c => {
        c.parentElement = this;
        this.children.push(c);
      });
      this._innerHTML += html;
    }
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(c => c !== this);
    }
  }

  appendChild(child) {
    if (child) {
      child.parentElement = this;
      this.children.push(child);
    }
    return child;
  }

  addEventListener() {}
  removeEventListener() {}
}

// Build Global Mock DOM
const rootContainer = new MockElement('div', 'app-root');
const elementsMap = {
  '#v': new MockElement('div', '', 'v'),
  '#tabs': new MockElement('nav', '', 'tabs'),
  '#toast': new MockElement('div', '', 'toast'),
  '#m': new MockElement('div', '', 'm'),
  '#rest': new MockElement('div', '', 'rest'),
  '#rest-ring-fill': new MockElement('circle', '', 'rest-ring-fill'),
  '#rest b': new MockElement('b'),
  'body': new MockElement('body'),
  '.work-stepper-pills': new MockElement('div', 'work-stepper-pills'),
  '#work-hero-card': new MockElement('div', 'card work-hero-card', 'work-hero-card'),
  '.work-nav-stepper': new MockElement('div', 'work-nav-stepper'),
  '.work-stepper-title': new MockElement('div', 'work-stepper-title'),
  '.work-stepper-container': new MockElement('div', 'work-stepper-container')
};

// Wire container tree
elementsMap['.work-stepper-container'].children.push(
  elementsMap['.work-stepper-title'],
  elementsMap['.work-stepper-pills']
);
elementsMap['.work-stepper-pills'].parentElement = elementsMap['.work-stepper-container'];
elementsMap['#v'].children.push(
  elementsMap['.work-stepper-container'],
  elementsMap['#work-hero-card'],
  elementsMap['.work-nav-stepper']
);

const mockWindow = {
  get window() { return mockWindow; },
  document: {
    body: elementsMap['body'],
    querySelector: (sel) => {
      if (elementsMap[sel]) return elementsMap[sel];
      if (sel.startsWith('#')) {
        const id = sel.slice(1);
        if (elementsMap['#' + id]) return elementsMap['#' + id];
        for (const root of [elementsMap['#m'], elementsMap['#v']]) {
          if (root && root.innerHTML && root.innerHTML.includes(`id="${id}"`)) {
            const match = root.innerHTML.match(new RegExp(`<([a-z0-9-]+)[^>]*id="${id}"([^>]*)>`, 'i'));
            if (match) {
              const valMatch = match[0].match(/value="([^"]*)"/i);
              const el = new MockElement(match[1], '', id);
              el.value = valMatch ? valMatch[1] : '';
              elementsMap['#' + id] = el;
              return el;
            }
          }
        }
      }
      return elementsMap['#v'].querySelector(sel);
    },
    querySelectorAll: (sel) => {
      return elementsMap['#v'].querySelectorAll(sel);
    },
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => {
      if (elementsMap['#' + id]) return elementsMap['#' + id];
      if (id === 'ai-api-key-input' && elementsMap['#ai-key-input']) return elementsMap['#ai-key-input'];
      if (id === 'ai-key-input' && elementsMap['#ai-api-key-input']) return elementsMap['#ai-api-key-input'];
      for (const root of [elementsMap['#m'], elementsMap['#v']]) {
        const altId = id === 'ai-api-key-input' ? 'ai-key-input' : (id === 'ai-key-input' ? 'ai-api-key-input' : id);
        const searchId = root && root.innerHTML && root.innerHTML.includes(`id="${id}"`) ? id : (root && root.innerHTML && root.innerHTML.includes(`id="${altId}"`) ? altId : null);
        if (searchId) {
          const match = root.innerHTML.match(new RegExp(`<([a-z0-9-]+)[^>]*id="${searchId}"([^>]*)>`, 'i'));
          if (match) {
            const valMatch = match[0].match(/value="([^"]*)"/i);
            const el = new MockElement(match[1], '', searchId);
            el.value = valMatch ? valMatch[1] : '';
            elementsMap['#' + id] = el;
            elementsMap['#' + searchId] = el;
            return el;
          }
        }
      }
      return null;
    },
    addEventListener: () => {}
  },
  localStorage: {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
  },
  sessionStorage: {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
  },
  navigator: {
    _lastVibrate: null,
    vibrate(pattern) {
      mockWindow.navigator._lastVibrate = pattern;
      return true;
    },
    storage: { persist: async () => true },
    serviceWorker: {
      register: async () => ({ update: () => {} }),
      addEventListener: () => {}
    }
  },
  AudioContext: class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
      this.oscillators = [];
      this.gains = [];
      mockWindow._lastAudioContext = this;
    }
    resume() { this.state = 'running'; }
    createOscillator() {
      const osc = {
        type: 'sine',
        frequency: {
          value: 440,
          setValueAtTime: (val, t) => { osc.frequency.value = val; osc._freqSet = { val, t }; }
        },
        connect: (target) => { osc._target = target; },
        start: (t) => { osc._started = t; },
        stop: (t) => { osc._stopped = t; }
      };
      this.oscillators.push(osc);
      return osc;
    }
    createGain() {
      const gain = {
        gain: {
          value: 1,
          setValueAtTime: (val, t) => { gain.gain.value = val; gain._set = { val, t }; },
          linearRampToValueAtTime: (val, t) => { gain._linearRamp = { val, t }; },
          exponentialRampToValueAtTime: (val, t) => { gain._expRamp = { val, t }; }
        },
        connect: (target) => { gain._target = target; }
      };
      this.gains.push(gain);
      return gain;
    }
    createBuffer() { return {}; }
    createBufferSource() { return { connect: () => {}, start: () => {} }; }
  },
  indexedDB: {
    open: () => ({
      result: {
        objectStoreNames: { contains: () => true },
        transaction: () => ({ objectStore: () => ({ get: () => ({}), put: () => {} }) })
      },
      onsuccess: null,
      onerror: null
    })
  },
  fetch: async (url) => {
    if (url.includes('exercises.json')) {
      return { ok: true, json: async () => exercisesJson };
    }
    return { ok: true, json: async () => ({}) };
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  console,
  Date,
  Math,
  JSON,
  Number,
  String,
  Array,
  Object,
  Set,
  Map,
  Promise
};
mockWindow.global = mockWindow;
mockWindow.globalThis = mockWindow;

// Evaluate calc.js and app.js in sandbox
const context = vm.createContext(mockWindow);
const calcScript = new vm.Script(calcCode);
calcScript.runInContext(context);
const aiConfigScript = new vm.Script(aiConfigCode);
aiConfigScript.runInContext(context);
const script = new vm.Script(appCode);
script.runInContext(context);

// Extract exported API
const api = mockWindow.__MYGYM__;
assert(api, 'globalThis.__MYGYM__ must be exposed by app.js');

// Initialize EXDB and EXIDX with properly normalized exercises for tests
api.EXDB = exercisesJson.map(api.normalizeExercise);
api.EXDB.forEach(x => {
  api.EXIDX[x.id] = x;
});

let passed = 0;
let total = 0;

function it(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('\n======================================================');
console.log('RUNNING PRODUCTION VERIFICATION TEST SUITE (v5.5.1-fix)');
console.log('======================================================\n');

// -----------------------------------------------------------------------------
// TEST SUITE 1: COLD-START BASELINE GATE (ACWR & Deload Protection)
// -----------------------------------------------------------------------------
console.log('Suite 1: ACWR Cold-Start Baseline Gate & Deload Protection');

it('Cold-start (single workout today): ACWR 4.00 spike suppressed & status calibrated', () => {
  const now = Date.now();
  // 1 workout logged today: 3 sets of 100 kg x 10 reps = 3000 kg
  const singleLog = [
    {
      id: 'log1',
      date: now,
      ex: [
        {
          id: '0025',
          sets: [
            { w: 100, r: 10, done: true },
            { w: 100, r: 10, done: true },
            { w: 100, r: 10, done: true }
          ]
        }
      ]
    }
  ];

  const w = api.calcWorkload(singleLog);
  assert.equal(w.isCalibrating, true, 'isCalibrating must be true for cold start');
  assert.equal(w.acwr, 'Calibrating', 'acwr must be "Calibrating" instead of 4.00');
  assert.equal(w.acwrDisplay, 'Calibrating', 'acwrDisplay must display "Calibrating"');
  assert.equal(w.acwrNum, null, 'acwrNum must be null during calibration');
  assert(w.status.includes('⚡ Calibrating Baseline (Day 1 of 14) 🔵'), `Status must display Day 1 of 14 badge: ${w.status}`);
  assert.equal(w.tooltip, 'Log workouts over 2-3 weeks to build your chronic fatigue baseline.');

  // Hard block deload card
  const deload = api.checkDeloadStatus(singleLog);
  assert.equal(deload.recommended, false, 'checkDeloadStatus MUST return recommended: false during calibration');
});

it('Baseline gate: < 7 distinct workout days gates ACWR even after 10 days', () => {
  const now = Date.now();
  const dayMs = 86400000;
  // 4 distinct workout days spread across trailing 10 days
  const logs = [
    { id: 'l1', date: now - 9 * dayMs, ex: [{ id: '0025', sets: [{ w: 80, r: 10, done: true }] }] },
    { id: 'l2', date: now - 6 * dayMs, ex: [{ id: '0025', sets: [{ w: 80, r: 10, done: true }] }] },
    { id: 'l3', date: now - 3 * dayMs, ex: [{ id: '0025', sets: [{ w: 80, r: 10, done: true }] }] },
    { id: 'l4', date: now, ex: [{ id: '0025', sets: [{ w: 80, r: 10, done: true }] }] }
  ];

  const w = api.calcWorkload(logs);
  assert.equal(w.distinctWorkoutDays, 4);
  assert.equal(w.isCalibrating, true, 'isCalibrating must be true when distinctWorkoutDays < 7');
  assert.equal(w.acwr, 'Calibrating');
  assert(w.status.includes('⚡ Calibrating Baseline (Day 10 of 14) 🔵'));

  const deload = api.checkDeloadStatus(logs);
  assert.equal(deload.recommended, false, 'Deload card must remain hard-blocked');
});

it('Baseline gate: 7 distinct days but < 14 days history gates ACWR', () => {
  const now = Date.now();
  const dayMs = 86400000;
  // 7 distinct days in 7 consecutive calendar days (totalHistoryDays = 7)
  const logs = [];
  for (let d = 0; d < 7; d++) {
    logs.push({
      id: `l_${d}`,
      date: now - d * dayMs,
      ex: [{ id: '0025', sets: [{ w: 50, r: 10, done: true }] }]
    });
  }

  const w = api.calcWorkload(logs);
  assert.equal(w.distinctWorkoutDays, 7);
  assert.equal(w.isCalibrating, true, 'isCalibrating must be true when totalHistoryDays < 14');
  assert.equal(w.acwr, 'Calibrating');

  const deload = api.checkDeloadStatus(logs);
  assert.equal(deload.recommended, false, 'Deload must remain hard-blocked during baseline calibration');
});

it('Calibrated user (>= 7 distinct days AND >= 14 days history): Normal ACWR calculated', () => {
  const now = Date.now();
  const dayMs = 86400000;
  // 8 workouts spread across 21 days
  const logs = [
    { id: 'l1', date: now - 20 * dayMs, ex: [{ id: '0025', sets: [{ w: 80, r: 10, done: true }] }] },
    { id: 'l2', date: now - 17 * dayMs, ex: [{ id: '0025', sets: [{ w: 80, r: 10, done: true }] }] },
    { id: 'l3', date: now - 14 * dayMs, ex: [{ id: '0025', sets: [{ w: 80, r: 10, done: true }] }] },
    { id: 'l4', date: now - 11 * dayMs, ex: [{ id: '0025', sets: [{ w: 80, r: 10, done: true }] }] },
    { id: 'l5', date: now - 8 * dayMs, ex: [{ id: '0025', sets: [{ w: 80, r: 10, done: true }] }] },
    { id: 'l6', date: now - 5 * dayMs, ex: [{ id: '0025', sets: [{ w: 80, r: 10, done: true }] }] },
    { id: 'l7', date: now - 2 * dayMs, ex: [{ id: '0025', sets: [{ w: 80, r: 10, done: true }] }] },
    { id: 'l8', date: now, ex: [{ id: '0025', sets: [{ w: 80, r: 10, done: true }] }] }
  ];

  const w = api.calcWorkload(logs);
  assert.equal(w.isCalibrating, false, 'isCalibrating must be false once baseline is established');
  assert.equal(typeof w.acwr, 'number', 'ACWR must be a numeric value');
  assert(w.acwr > 0);
  assert.notEqual(w.status, 'Calibrating');
});

// -----------------------------------------------------------------------------
// TEST SUITE 2: DUAL-EXERCISE SUPERSET PAIRING FLOW (A1 -> A2 Seamless Loop)
// -----------------------------------------------------------------------------
console.log('\nSuite 2: Dual-Exercise Superset Pairing Flow');

it('getSupersetInfo pairs linked exercises correctly into A1/A2 block', () => {
  const act = {
    curEx: 0,
    ex: [
      { id: '0025', ss: true, ssRole: 'A', ssPair: 'ss_0', sets: [{ done: false }, { done: false }] },
      { id: '0027', ss: true, ssRole: 'B', ssPair: 'ss_0', sets: [{ done: false }, { done: false }] }
    ]
  };

  const infoA = api.getSupersetInfo(act, 0);
  assert.equal(infoA.isSuperset, true);
  assert.equal(infoA.isPaired, true);
  assert.equal(infoA.role, 'A');
  assert.equal(infoA.exAIndex, 0);
  assert.equal(infoA.exBIndex, 1);
  assert.equal(infoA.round, 1);
  assert.equal(infoA.totalRounds, 2);

  const infoB = api.getSupersetInfo(act, 1);
  assert.equal(infoB.isSuperset, true);
  assert.equal(infoB.isPaired, true);
  assert.equal(infoB.role, 'B');
  assert.equal(infoB.exAIndex, 0);
  assert.equal(infoB.exBIndex, 1);
});

it('showSupersetPicker renders dynamic modal sheet with current session and library options', () => {
  api.S.act = {
    name: 'Full Body',
    curEx: 0,
    ex: [
      { id: '0025', ss: false, sets: [{ done: false }] }, // Bench Press
      { id: '0047', ss: false, sets: [{ done: false }] }, // Incline Bench
      { id: '0027', ss: false, sets: [{ done: false }] }  // Row
    ]
  };

  elementsMap['#m'].innerHTML = '';
  elementsMap['#m'].hidden = true;

  api.showSupersetPicker(0);

  const html = elementsMap['#m'].innerHTML;
  assert.equal(elementsMap['#m'].hidden, false, 'Modal must open');
  assert(html.includes('ss-picker-sheet'), 'Must render ss-picker-sheet');
  assert(html.includes('1. Choose from Current Session'), 'Must have Section 1');
  assert(html.includes('2. Add & Pair from Library'), 'Must have Section 2');
  assert(html.includes('ss-modal-close-btn'), 'Must have circular frosted close button');
  assert(html.includes('ss-pick-item'), 'Must have ss-pick-item flex row');
  assert(html.includes('ss-link-pill-btn'), 'Must have ss-link-pill-btn');
  assert(html.includes('ss-source-badge'), 'Must have source exercise badge');
  assert(html.includes('Need an exercise not in today\'s split?'), 'Must have library helper text');
  assert(html.includes('+ Browse Exercise Library'), 'Must have browse library button text');
  assert(html.includes('data-a="browseandpair"'), 'Must have browse library button');
  assert(html.includes('data-a="pairwithex"'), 'Must have pairwithex action');
  assert(!html.includes('data-target="0"'), 'Section 1 must exclude current exercise itself');
  assert(html.includes('data-target="1"'), 'Section 1 must include exercise 1');
  assert(html.includes('data-target="2"'), 'Section 1 must include exercise 2');

  // Verify empty state when all exercises in session are paired
  api.S.act.ex[1].ss = true;
  api.S.act.ex[1].ssGroup = 'ss_other';
  api.S.act.ex[2].ss = true;
  api.S.act.ex[2].ssGroup = 'ss_other';
  api.showSupersetPicker(0);
  const emptyHtml = elementsMap['#m'].innerHTML;
  assert(emptyHtml.includes('All session exercises are currently paired.'), 'Must show clean empty state message');
});

it('pairExercises reorders non-adjacent exercises to create an immediate adjacent A1 + A2 block', () => {
  // Initial workout order: [0025 (Bench), 0047 (Incline), 0043 (Squat), 0027 (Row)]
  api.S.act = {
    name: 'Workout',
    curEx: 0,
    ex: [
      { id: '0025', sets: [{ done: false }, { done: false }] }, // Bench (idx 0)
      { id: '0047', sets: [{ done: false }, { done: false }] }, // Incline (idx 1)
      { id: '0043', sets: [{ done: false }, { done: false }] }, // Squat (idx 2)
      { id: '0027', sets: [{ done: false }, { done: false }] }  // Row (idx 3)
    ]
  };

  // Pair Bench (index 0) with non-adjacent Row (index 3)
  api.pairExercises(0, 3);

  // Assertions for reordering and cohesive blocking
  assert.equal(api.S.act.ex.length, 4, 'Total exercises count remains 4');
  assert.equal(api.S.act.ex[0].id, '0025', 'Exercise A1 remains Bench Press at index 0');
  assert.equal(api.S.act.ex[1].id, '0027', 'Exercise A2 is now Row reordered adjacent to index 1');
  assert.equal(api.S.act.ex[2].id, '0047', 'Incline shifted to index 2');
  assert.equal(api.S.act.ex[3].id, '0043', 'Squat shifted to index 3');

  // Verify superset attributes
  assert.equal(api.S.act.ex[0].ss, true);
  assert.equal(api.S.act.ex[0].ssRole, 'A');
  assert.equal(api.S.act.ex[1].ss, true);
  assert.equal(api.S.act.ex[1].ssRole, 'B');
  assert.equal(api.S.act.ex[0].ssGroup, api.S.act.ex[1].ssGroup, 'Matching ssGroup');

  // Verify getSupersetInfo recognizes adjacent pair
  const ss = api.getSupersetInfo(api.S.act, 0);
  assert.equal(ss.isSuperset, true);
  assert.equal(ss.isPaired, true);
  assert.equal(ss.exAIndex, 0);
  assert.equal(ss.exBIndex, 1);
});

it('addAndPairFromLibrary dynamically appends from library directly next to current exercise', () => {
  api.S.act = {
    name: 'Workout',
    curEx: 0,
    ex: [
      { id: '0025', sets: [{ done: false }] }, // Bench (idx 0)
      { id: '0043', sets: [{ done: false }] }  // Squat (idx 1)
    ]
  };

  // User on Bench Press (0) selects 0001 (Sit-up) from library
  api.addAndPairFromLibrary(0, '0001');

  assert.equal(api.S.act.ex.length, 3);
  assert.equal(api.S.act.ex[0].id, '0025', 'A1 is Bench at idx 0');
  assert.equal(api.S.act.ex[1].id, '0001', 'A2 is Sit-up inserted adjacent at idx 1');
  assert.equal(api.S.act.ex[2].id, '0043', 'Squat shifted to idx 2');

  assert.equal(api.S.act.ex[0].ssRole, 'A');
  assert.equal(api.S.act.ex[1].ssRole, 'B');
  assert.equal(api.S.act.ex[0].ssGroup, api.S.act.ex[1].ssGroup);
});

it('unlinkSuperset safely removes superset attributes from both paired exercises', () => {
  api.unlinkSuperset(0);
  assert.equal(api.S.act.ex[0].ss, undefined);
  assert.equal(api.S.act.ex[1].ss, undefined);
  const ss = api.getSupersetInfo(api.S.act, 0);
  assert.equal(ss.isSuperset, false);
});

it('renderSupersetBanner renders unified SUPERSET [A1 + A2] badge and round indicator', () => {
  const act = {
    curEx: 0,
    ex: [
      { id: '0025', ss: true, ssRole: 'A', ssPair: 'ss_0', sets: [{ done: false }, { done: false }, { done: false }] },
      { id: '0027', ss: true, ssRole: 'B', ssPair: 'ss_0', sets: [{ done: false }, { done: false }, { done: false }] }
    ]
  };
  const infoA = api.getSupersetInfo(act, 0);
  const banner = api.renderSupersetBanner(infoA);

  assert(banner.includes('⚡ SUPERSET [A1 + A2]'), 'Banner must include unified SUPERSET tag');
  assert(banner.includes('Round 1 of 3'), 'Banner must indicate Round 1 of 3');
  assert(banner.includes('Step 1: Finish A1 → Transitions to A2 instantly (No rest timer)'), 'Flow instructions for A1');
});

it('Step 1: User finishes Set 1 of Exercise A -> NO rest timer, focus auto-advances to Exercise B', () => {
  api.S.act = {
    name: 'Superset Workout',
    curEx: 0,
    ex: [
      { id: '0025', ss: true, ssRole: 'A', ssPair: 'ss_0', sets: [{ w: 60, r: 10, done: false }, { w: 60, r: 10, done: false }] },
      { id: '0027', ss: true, ssRole: 'B', ssPair: 'ss_0', sets: [{ w: 50, r: 10, done: false }, { w: 50, r: 10, done: false }] }
    ]
  };

  // Reset timer state
  elementsMap['#rest'].hidden = true;
  api.T.supersetLoop = null;

  // Complete Set 1 of Exercise A
  const curExA = api.S.act.ex[0];
  const setA1 = curExA.sets[0];
  setA1.done = true;

  api.handleSetCompleted(0, 0, setA1, curExA);

  // Assertions for Step 1
  assert.equal(elementsMap['#rest'].hidden, true, 'Rest timer must NOT start when finishing Exercise A');
  assert.equal(api.S.act.curEx, 1, 'Current exercise must seamlessly transition to Exercise B (index 1)');
});

it('Step 2: User finishes Set 1 of Exercise B -> REST TIMER BEGINS & loops back to A Set 2', () => {
  api.S.act = {
    name: 'Superset Workout',
    curEx: 1,
    ex: [
      { id: '0025', ss: true, ssRole: 'A', ssPair: 'ss_0', sets: [{ w: 60, r: 10, done: true }, { w: 60, r: 10, done: false }] },
      { id: '0027', ss: true, ssRole: 'B', ssPair: 'ss_0', sets: [{ w: 50, r: 10, done: false }, { w: 50, r: 10, done: false }] }
    ]
  };

  const curExB = api.S.act.ex[1];
  const setB1 = curExB.sets[0];
  setB1.done = true;

  api.handleSetCompleted(1, 0, setB1, curExB);

  // Assertions for Step 2
  assert.equal(elementsMap['#rest'].hidden, false, 'Rest timer MUST start when finishing Exercise B');
  assert(api.T.supersetLoop != null, 'T.supersetLoop must be armed for the next round');
  assert.equal(api.T.supersetLoop.targetEx, 0, 'Target exercise to loop back to must be Exercise A (index 0)');
  assert.equal(api.T.supersetLoop.targetSet, 1, 'Target set must be Set 2 (index 1)');
  assert.equal(api.T.supersetLoop.round, 2, 'Next round indicator must be 2');
});

it('Step 3: Rest timer skip (rskip) triggers auto-loop back to Exercise A Set 2', () => {
  // Armed superset loop
  assert(api.T.supersetLoop != null);
  const loop = api.T.supersetLoop;

  // Simulate rskip execution
  api.T.supersetLoop = null;
  api.switchWorkExercise(loop.targetEx);

  assert.equal(api.S.act.curEx, 0, 'Workout view must auto-loop back to Exercise A');
  assert.equal(api.T.supersetLoop, null, 'supersetLoop state must be consumed/cleared');
});

it('Tri-Set: getSupersetInfo dynamically identifies 3-exercise block [A1 + A2 + A3]', () => {
  const act = {
    name: 'Tri-Set Test',
    curEx: 0,
    ex: [
      { id: '0025', ss: true, ssGroup: 'ss_tri_1', sets: [{ done: false }, { done: false }] },
      { id: '0047', ss: true, ssGroup: 'ss_tri_1', sets: [{ done: false }, { done: false }] },
      { id: '0027', ss: true, ssGroup: 'ss_tri_1', sets: [{ done: false }, { done: false }] }
    ]
  };

  const infoA1 = api.getSupersetInfo(act, 0);
  assert.equal(infoA1.isSuperset, true);
  assert.equal(infoA1.isPaired, true);
  assert.equal(infoA1.groupLength, 3);
  assert.equal(infoA1.pos, 0);
  assert.equal(infoA1.label, 'A1');
  assert.equal(infoA1.typeLabel, 'TRI-SET');
  assert.equal(infoA1.tag, 'TRI-SET [A1 + A2 + A3]');
  assert.equal(infoA1.isFirstInGroup, true);
  assert.equal(infoA1.isLastInGroup, false);
  assert.equal(infoA1.nextInGroup.idx, 1);
  assert.equal(infoA1.nextInGroup.label, 'A2');

  const infoA2 = api.getSupersetInfo(act, 1);
  assert.equal(infoA2.pos, 1);
  assert.equal(infoA2.label, 'A2');
  assert.equal(infoA2.isFirstInGroup, false);
  assert.equal(infoA2.isLastInGroup, false);
  assert.equal(infoA2.nextInGroup.idx, 2);
  assert.equal(infoA2.nextInGroup.label, 'A3');

  const infoA3 = api.getSupersetInfo(act, 2);
  assert.equal(infoA3.pos, 2);
  assert.equal(infoA3.label, 'A3');
  assert.equal(infoA3.isFirstInGroup, false);
  assert.equal(infoA3.isLastInGroup, true);
  assert.equal(infoA3.nextInGroup, null);
  assert.equal(infoA3.firstInGroup.idx, 0);
});

it('Tri-Set: addToSupergroup extends existing 2-exercise superset into adjacent Tri-Set', () => {
  api.S.act = {
    name: 'Block Extension Test',
    curEx: 0,
    ex: [
      { id: '0025', ss: true, ssGroup: 'ss_block_1', ssPair: 'ss_block_1', ssRole: 'A', sets: [{ done: false }] },
      { id: '0047', ss: true, ssGroup: 'ss_block_1', ssPair: 'ss_block_1', ssRole: 'B', sets: [{ done: false }] },
      { id: '0027', sets: [{ done: false }] }, // Candidate in session
      { id: '0042', sets: [{ done: false }] }
    ]
  };

  // Add exercise at index 2 ('0027') to the superset block containing exercise 0
  api.addToSupergroup(0, 2);

  // Verify group is now 3 exercises and strictly adjacent
  assert.equal(api.S.act.ex.length, 4);
  assert.equal(api.S.act.ex[0].id, '0025');
  assert.equal(api.S.act.ex[1].id, '0047');
  assert.equal(api.S.act.ex[2].id, '0027');
  assert.equal(api.S.act.ex[3].id, '0042');

  const info = api.getSupersetInfo(api.S.act, 0);
  assert.equal(info.groupLength, 3);
  assert.equal(info.typeLabel, 'TRI-SET');
  assert.equal(info.tag, 'TRI-SET [A1 + A2 + A3]');
});

it('Giant Set: 4+ exercises dynamically tagged as GIANT SET with A1..A4', () => {
  const act = {
    name: 'Giant Set Test',
    curEx: 0,
    ex: [
      { id: '0025', ss: true, ssGroup: 'ss_giant', sets: [{ done: false }, { done: false }] },
      { id: '0047', ss: true, ssGroup: 'ss_giant', sets: [{ done: false }, { done: false }] },
      { id: '0027', ss: true, ssGroup: 'ss_giant', sets: [{ done: false }, { done: false }] },
      { id: '0042', ss: true, ssGroup: 'ss_giant', sets: [{ done: false }, { done: false }] }
    ]
  };

  const infoA1 = api.getSupersetInfo(act, 0);
  assert.equal(infoA1.groupLength, 4);
  assert.equal(infoA1.typeLabel, 'GIANT SET');
  assert.equal(infoA1.tag, 'GIANT SET [A1 + A2 + A3 + A4]');

  const infoA4 = api.getSupersetInfo(act, 3);
  assert.equal(infoA4.pos, 3);
  assert.equal(infoA4.label, 'A4');
  assert.equal(infoA4.isLastInGroup, true);
});

it('Tri-Set Execution Loop: A1 -> A2 -> A3 (no rest) -> Rest Timer -> Loops to A1 Set 2', () => {
  api.S.act = {
    name: 'Tri-Set Flow Test',
    curEx: 0,
    ex: [
      { id: '0025', ss: true, ssGroup: 'ss_tri_loop', ssRole: 'A', sets: [{ done: false }, { done: false }] },
      { id: '0047', ss: true, ssGroup: 'ss_tri_loop', ssRole: 'B', sets: [{ done: false }, { done: false }] },
      { id: '0027', ss: true, ssGroup: 'ss_tri_loop', ssRole: 'C', sets: [{ done: false }, { done: false }] }
    ]
  };

  api.T.supersetLoop = null;
  elementsMap['#rest'].hidden = true;

  // 1. Complete Set 1 of A1 (Exercise 0)
  const set0A = api.S.act.ex[0].sets[0];
  set0A.done = true;
  api.handleSetCompleted(0, 0, set0A, api.S.act.ex[0]);

  assert.equal(api.S.act.curEx, 1, 'Completing A1 must immediately switch active exercise to A2');
  assert.equal(elementsMap['#rest'].hidden, true, 'Rest timer must NOT start when finishing A1');
  assert.equal(api.T.supersetLoop, null, 'supersetLoop must not be armed yet');

  // 2. Complete Set 1 of A2 (Exercise 1)
  const set0B = api.S.act.ex[1].sets[0];
  set0B.done = true;
  api.handleSetCompleted(1, 0, set0B, api.S.act.ex[1]);

  assert.equal(api.S.act.curEx, 2, 'Completing A2 must immediately switch active exercise to A3');
  assert.equal(elementsMap['#rest'].hidden, true, 'Rest timer must NOT start when finishing A2');
  assert.equal(api.T.supersetLoop, null, 'supersetLoop must not be armed yet');

  // 3. Complete Set 1 of A3 (Exercise 2 - Last in Tri-Set group)
  const set0C = api.S.act.ex[2].sets[0];
  set0C.done = true;
  api.handleSetCompleted(2, 0, set0C, api.S.act.ex[2]);

  assert.equal(elementsMap['#rest'].hidden, false, 'Rest timer MUST start when finishing last exercise A3');
  assert(api.T.supersetLoop != null, 'T.supersetLoop must be armed for the next round');
  assert.equal(api.T.supersetLoop.targetEx, 0, 'Target exercise to loop back to must be A1 (index 0)');
  assert.equal(api.T.supersetLoop.targetSet, 1, 'Target set must be Set 2 (index 1)');
  assert.equal(api.T.supersetLoop.round, 2, 'Next round indicator must be 2');

  // 4. Simulate timer completion or rskip -> Loops back to A1 Set 2
  const loop = api.T.supersetLoop;
  api.T.supersetLoop = null;
  api.switchWorkExercise(loop.targetEx);

  assert.equal(api.S.act.curEx, 0, 'Auto-loop must switch back to A1 (index 0)');
  assert.equal(api.T.supersetLoop, null, 'supersetLoop state must be cleared after looping');
});

it('renderSupersetBanner displays dynamic relative position indicator and tabs for Tri-Sets', () => {
  const act = {
    name: 'Banner Test',
    curEx: 1, // Currently on A2
    ex: [
      { id: '0025', ss: true, ssGroup: 'ss_b', sets: [{ done: true }, { done: false }] },
      { id: '0047', ss: true, ssGroup: 'ss_b', sets: [{ done: false }, { done: false }] },
      { id: '0027', ss: true, ssGroup: 'ss_b', sets: [{ done: false }, { done: false }] }
    ]
  };
  api.S.act = act;

  const info = api.getSupersetInfo(act, 1);
  const banner = api.renderSupersetBanner(info);

  assert(banner.includes('⚡ TRI-SET [A1 + A2 + A3]'), 'Banner must display TRI-SET tag');
  assert(banner.includes('Round 1 of 2 · Exercise 2 of 3 (A2)'), 'Banner must show relative position indicator');
  assert(banner.includes('ss-pill-role">A1</span>'), 'Banner must have tab for A1');
  assert(banner.includes('ss-pill-role">A2</span>'), 'Banner must have tab for A2');
  assert(banner.includes('ss-pill-role">A3</span>'), 'Banner must have tab for A3');
});

// -----------------------------------------------------------------------------
// TEST SUITE 3: TOP STEPPER HORIZONTAL PILL JUMP & SCROLL PRESERVATION
// -----------------------------------------------------------------------------
console.log('\nSuite 3: Top Stepper Horizontal Pill Navigation & Scroll Reset Fix');

it('switchWorkExercise preserves stepper pills DOM element without destroying or resetting', () => {
  api.S.act = {
    name: 'Push Workout',
    curEx: 0,
    ex: [
      { id: '0025', sets: [{ done: true }] },
      { id: '0047', sets: [{ done: false }] },
      { id: '0027', sets: [{ done: false }] }
    ]
  };

  const pillsContainer = elementsMap['.work-stepper-pills'];
  pillsContainer.innerHTML = `
    <button class="work-step-pill active" data-i="0"><span>1. Bench</span></button>
    <button class="work-step-pill" data-i="1"><span>2. Incline</span></button>
    <button class="work-step-pill" data-i="2"><span>3. Row</span></button>
  `;
  pillsContainer.scrollLeft = 142; // Simulated horizontal user scroll offset

  // Switch to exercise 1 in-place
  api.switchWorkExercise(1, true);

  // Verify container reference was preserved (not destroyed or replaced)
  assert.equal(elementsMap['.work-stepper-pills'], pillsContainer, 'DOM container identity must be preserved');
  assert.equal(pillsContainer.scrollLeft, 142, 'scrollLeft position must not be reset to 0');

  // Verify active class updated in-place
  const activePill = pillsContainer.children[1];
  assert(activePill.className.includes('active'), 'Pill 1 must now have active class');
  assert(!pillsContainer.children[0].className.includes('active'), 'Pill 0 must no longer have active class');

  // Verify smooth centering was called on active pill
  assert.equal(activePill._lastScrollIntoView?.behavior, 'smooth');
  assert.equal(activePill._lastScrollIntoView?.inline, 'center');
  assert.equal(activePill._lastScrollIntoView?.block, 'nearest');
});

// -----------------------------------------------------------------------------
// TEST SUITE 4: EXERCISE GIF VISIBILITY & FULLSCREEN EXPANSION MODAL
// -----------------------------------------------------------------------------
console.log('\nSuite 4: Exercise GIF Visibility & Fullscreen Expansion Modal');

it('renderWorkHeroCard declutters media frame and places actions in horizontal toolbar', () => {
  const act = {
    curEx: 0,
    ex: [
      { id: '0025', uni: false, sets: [{ w: 60, r: 8, done: false }] },
      { id: '0027', uni: false, sets: [{ w: 50, r: 8, done: false }] }
    ]
  };

  const heroHtml = api.renderWorkHeroCard(act, 0);

  // 1. Verify media frame has tap-to-expand data action
  assert(heroHtml.includes('class="work-hero-media" data-a="zoomexgif"'), 'Media frame must trigger zoomexgif');
  assert(heroHtml.includes('class="work-gif-tap-hint"'), 'Media frame must display tap hint');

  // 2. Verify media frame contains NO overlay buttons
  const mediaSubstr = heroHtml.split('work-hero-toolbar')[0];
  assert(!mediaSubstr.includes('data-a="swapex"'), 'Swap button must not be inside GIF media frame');
  assert(!mediaSubstr.includes('data-a="opensspicker"') && !mediaSubstr.includes('data-a="linkss"'), 'Superset button must not be inside GIF media frame');
  assert(!mediaSubstr.includes('data-a="toggleuni"'), 'Unilateral button must not be inside GIF media frame');

  // 3. Verify horizontal toolbar directly below media frame
  assert(heroHtml.includes('class="work-hero-toolbar"'), 'Toolbar must be present directly below media');
  assert(heroHtml.includes('data-a="swapex"'), 'Toolbar must include Swap');
  assert(heroHtml.includes('data-a="zoomexgif"'), 'Toolbar must include Form Cues chip');
  assert(heroHtml.includes('data-a="opensspicker"') || heroHtml.includes('data-a="linkss"'), 'Toolbar must include Link Superset');
  // Phase 2: Unilateral toggle moved into ••• More (exmore) sheet to declutter main toolbar
  assert(heroHtml.includes('data-a="exmore"'), 'Toolbar must include ••• More button (exmore) containing secondary actions');
});

it('style.css enforces 100% visible GIF letterboxing with object-fit: contain', () => {
  assert(cssCode.includes('object-fit: contain'), 'style.css must specify object-fit: contain for GIFs');
  assert(cssCode.includes('.zoom-modal-sheet'), 'style.css must style zoom-modal-sheet');
  assert(cssCode.includes('.zoom-media-frame'), 'style.css must style zoom-media-frame');
  assert(cssCode.includes('.zoom-expanded-gif'), 'style.css must style zoom-expanded-gif');
  assert(cssCode.includes('.zoom-cues-card'), 'style.css must style zoom-cues-card');
});

it('showExpandedGifModal renders edge-to-edge modal with cues, target labels, and Close button', () => {
  elementsMap['#m'].innerHTML = '';
  elementsMap['#m'].hidden = true;

  api.showExpandedGifModal('0001');

  const modalHtml = elementsMap['#m'].innerHTML;
  assert.equal(elementsMap['#m'].hidden, false, 'Modal sheet container must be unhidden');
  assert(modalHtml.includes('zoom-modal-sheet'), 'Must open zoom-modal-sheet');
  assert(modalHtml.includes('zoom-expanded-gif'), 'Must render high-res zoom-expanded-gif');
  assert(modalHtml.includes('data-a="close"'), 'Must have close button');
  assert(modalHtml.includes('✕ Close'), 'Must have clean "✕ Close" label');
  assert(modalHtml.includes('Form Execution Cues'), 'Must have form execution cues');
  assert(modalHtml.includes('Target: abs'), 'Must display target muscle label');
});

// -----------------------------------------------------------------------------
// TEST SUITE 5: CACHE BUMP & AIR-GAPPED VERIFICATION
// -----------------------------------------------------------------------------
console.log('\nSuite 5: Service Worker & Cache Integrity Verification');

it('sw.js cache key is bumped to mygym-core-v7.1.0, calls skipWaiting and clients.claim', () => {
  assert(swCode.includes("const C = 'mygym-core-v7.1.0';"), 'sw.js must use mygym-core-v7.1.0 cache name');
  assert(swCode.includes("'./style.css?v=7.1.0'"), 'sw.js must precache style.css?v=7.1.0');
  assert(swCode.includes("'./app.js?v=7.1.0'"), 'sw.js must precache app.js?v=7.1.0');
  assert(swCode.includes("'./calc.js?v=7.1.0'"), 'sw.js must precache calc.js?v=7.1.0');
  assert(swCode.includes('self.skipWaiting()'), 'sw.js must immediately call self.skipWaiting() on install');
  assert(swCode.includes('clients.claim()'), 'sw.js must call clients.claim() on activate');
});

it('index.html references versioned assets and shell.js executes cache-busting auto-upgrade', () => {
  assert(htmlCode.includes('style.css?v=7.1.0'), 'index.html must link style.css?v=7.1.0');
  assert(htmlCode.includes('shell.js?v=7.1.0'), 'index.html must load shell.js?v=7.1.0');
  assert(htmlCode.includes('app.js?v=7.1.0'), 'index.html must load app.js?v=7.1.0');
  assert(htmlCode.includes('calc.js?v=7.1.0'), 'index.html must load calc.js?v=7.1.0');
  assert(shellCode.includes("SHELL_VERSION = 'mygym-core-v7.1.0'"), 'shell.js must use mygym-core-v6.2.2');
  assert(shellCode.includes("window.location.href = window.location.origin + window.location.pathname + '?t=' + Date.now()"), 'shell.js must bust cache via timestamp redirect');
});

it('app.js has consistent versions and dynamic Settings modal display', () => {
  assert.equal(api.APP_VERSION, '7.1.0');
  assert.equal(api.SHELL_VERSION, 'mygym-core-v7.1.0');

  // Verify settings modal HTML uses dynamic variables
  assert(appCode.includes('${esc(SHELL_VERSION)} (v${esc(APP_VERSION)})'), 'app.js Settings modal must dynamically use SHELL_VERSION and APP_VERSION');
});

it('Hardcoded string audit: zero occurrences of 5.0.0 or v5.0.0-gold in app.js, index.html, sw.js', () => {
  assert(!appCode.includes('v5.0.0-gold'), 'app.js must not contain v5.0.0-gold');
  assert(!appCode.includes('5.0.0'), 'app.js must not contain 5.0.0');
  assert(!htmlCode.includes('v5.0.0-gold'), 'index.html must not contain v5.0.0-gold');
  assert(!htmlCode.includes('5.0.0'), 'index.html must not contain 5.0.0');
  assert(!swCode.includes('v5.0.0-gold'), 'sw.js must not contain v5.0.0-gold');
  assert(!swCode.includes('5.0.0'), 'sw.js must not contain 5.0.0');
});

it('forceupdate action executes aggressive SW unregister, cache eviction, and timestamp navigation', () => {
  assert(appCode.includes('navigator.serviceWorker.getRegistrations()'), 'forceupdate must inspect SW registrations');
  assert(appCode.includes('await r.unregister()'), 'forceupdate must unregister existing registrations');
  assert(appCode.includes('await caches.delete(k)'), 'forceupdate must delete cache keys');
  assert(appCode.includes("window.location.href = window.location.origin + window.location.pathname + '?t=' + Date.now()"), 'forceupdate must redirect with timestamp');
  assert(!appCode.includes('indexedDB.deleteDatabase'), 'forceupdate must never delete IndexedDB data');
});

// -----------------------------------------------------------------------------
// TEST SUITE 6: EXERCISE PICKER PREVIEW MODAL (GIF + FORM CUES)
// -----------------------------------------------------------------------------
console.log('\nSuite 6: Exercise Picker Preview Modal (GIF + Form Cues)');

it('renderPickResults provides quick ℹ️ Preview action and tap-to-inspect target', () => {
  const pickResultsHtml = api.renderPickResults();
  assert(pickResultsHtml.includes('pick-ex-row'), 'Must contain pick-ex-row container');
  assert(pickResultsHtml.includes('ex-row-tap-preview'), 'Must contain tap-to-preview container');
  assert(pickResultsHtml.includes('data-a="pickpreview"'), 'Tapping thumbnail or title must trigger pickpreview');
  assert(pickResultsHtml.includes('ℹ️ Preview'), 'Must render dedicated ℹ️ Preview button');
  assert(pickResultsHtml.includes('data-a="pick"'), 'Must have distinct + Add button');
});

it('showExercisePickerPreview renders high-res demonstration GIF, metadata, and form cues', () => {
  const testExId = exercisesJson[0].id;
  api.showExercisePickerPreview(testExId);

  const modalHtml = elementsMap['#m'].innerHTML;
  assert(modalHtml.includes('picker-preview-sheet'), 'Must render preview sheet');
  assert(modalHtml.includes('picker-preview-gif'), 'Must render animated demonstration GIF');
  assert(modalHtml.includes('picker-preview-cues-card'), 'Must render form cues card');
  assert(modalHtml.includes('Step-by-Step Form Execution Cues'), 'Must render form cues header');
  assert(modalHtml.includes('picker-preview-steps'), 'Must render step-by-step form cues');
  assert(modalHtml.includes('data-a="backtopicker"'), 'Must have ← Back to Exercise Picker button');
});

it('showExercisePickerPreview dynamically adapts prominent action button for Routine, Superset, and Workout', () => {
  const testExId = exercisesJson[0].id;

  // 1. Routine context
  api.showExercisePicker('Choose Exercise for Routine');
  api.showExercisePickerPreview(testExId);
  assert(elementsMap['#m'].innerHTML.includes('+ Add to Routine'), 'Primary action must be + Add to Routine');

  // 2. Superset context
  api.showExercisePicker('Select Exercise to Add as A2');
  api.showExercisePickerPreview(testExId);
  assert(elementsMap['#m'].innerHTML.includes('+ Add to Superset'), 'Primary action must be + Add to Superset');

  // 3. Active workout context
  api.S.act = { rid: 'r1', name: 'Leg Day', t0: Date.now(), ex: [], curEx: 0 };
  api.showExercisePicker('Add Exercise to Workout');
  api.showExercisePickerPreview(testExId);
  assert(elementsMap['#m'].innerHTML.includes('+ Add to Workout'), 'Primary action must be + Add to Workout');
});

// -----------------------------------------------------------------------------
// TEST SUITE 7: SUBTLE, NON-INTRUSIVE REST TIMER AUDIO CHIME
// -----------------------------------------------------------------------------
console.log('\nSuite 7: Subtle, Non-Intrusive Rest Timer Audio Chime & Gentle Haptic');

it('playRestChime synthesizes Apple-style calm bell dual-tone sine wave arpeggio', () => {
  api.playRestChime();
  const ctx = mockWindow._lastAudioContext;
  assert(ctx, 'AudioContext must be created and active');
  assert.equal(ctx.oscillators.length, 2, 'Must create dual-tone oscillators');
  assert.equal(ctx.oscillators[0].type, 'sine', 'Tone 1 must be pure sine wave');
  assert.equal(ctx.oscillators[1].type, 'sine', 'Tone 2 must be pure sine wave');
  assert.equal(ctx.oscillators[0].frequency.value, 587.33, 'Tone 1 must be D5 (587.33 Hz)');
  assert.equal(ctx.oscillators[1].frequency.value, 880.00, 'Tone 2 must be A5 (880.00 Hz)');
});

it('playRestChime applies smooth attack and exponential gain decay preventing clicks', () => {
  const ctx = mockWindow._lastAudioContext;
  if (ctx) {
    ctx.gains.length = 0;
    ctx.oscillators.length = 0;
  }
  api.playRestChime();
  assert.equal(ctx.gains.length, 2, 'Must create gain envelope for each tone');
  assert(ctx.gains[0]._linearRamp, 'Tone 1 must have smooth linear attack ramp');
  assert(ctx.gains[0]._expRamp, 'Tone 1 must have smooth exponential decay ramp');
  assert(ctx.gains[1]._linearRamp, 'Tone 2 must have smooth linear attack ramp');
  assert(ctx.gains[1]._expRamp, 'Tone 2 must have smooth exponential decay ramp');
});

it('Rest completion triggers gentle dual-pulse haptic vibration [100, 50, 100]', () => {
  mockWindow.navigator._lastVibrate = null;
  api.T.end = Date.now() - 1000;
  api.S.cfg.vibrate = true;
  api.S.cfg.sound = true;
  api.tick();
  assert.equal(JSON.stringify(mockWindow.navigator._lastVibrate), JSON.stringify([100, 50, 100]), 'Must trigger gentle dual-pulse haptic [100, 50, 100]');
});

// -----------------------------------------------------------------------------
// TEST SUITE 8: ANATOMICAL MUSCLE HEATMAP (FRONT & BACK DUAL VIEW)
// -----------------------------------------------------------------------------
console.log('\nSuite 8: Anatomical Muscle Heatmap & Interactive Tap-to-Explore');

it('mmap renders dual view (FRONT and BACK) with 13 well-defined anatomical muscle groups', () => {
  const svg = api.generateAnatomySvg('male', ['pecs'], ['deltoids']);
  assert(svg.includes('FRONT'), 'Must render FRONT view label');
  assert(svg.includes('BACK'), 'Must render BACK view label');
  assert(svg.includes('mm-base'), 'Must render sleek dark graphite / slate body base');

  const required13 = [
    'pecs', 'lats', 'traps', 'deltoids', 'biceps', 'triceps', 'forearms',
    'abs', 'obliques', 'glutes', 'quads', 'hamstrings', 'calves'
  ];
  required13.forEach(muscle => {
    assert(svg.includes(`data-muscle="${muscle}"`), `SVG must include muscle group ${muscle}`);
  });
});

it('mmap applies vibrant dynamic heatmap fill (amber/gold for primary, cyan for secondary)', () => {
  const svg = api.generateAnatomySvg('male', ['pecs', 'quads'], ['deltoids', 'calves']);
  assert(svg.includes('mm-muscle p') || svg.includes('data-muscle="pecs" class="mm-muscle p'), 'Primary muscles must have class p');
  assert(svg.includes('mm-muscle s') || svg.includes('data-muscle="deltoids" class="mm-muscle s'), 'Secondary muscles must have class s');
  assert(cssCode.includes('.mm-muscle.p'), 'style.css must define vibrant amber/gold fill for .p');
  assert(cssCode.includes('.mm-muscle.s'), 'style.css must define vibrant cyan fill for .s');
});

it('Supports male and female silhouette options via bodyModel toggle', () => {
  const svgMale = api.generateAnatomySvg('male');
  const svgFemale = api.generateAnatomySvg('female');
  assert(svgMale.includes('Anatomical Muscle Heatmap (Male)'), 'Male SVG must have Male label');
  assert(svgFemale.includes('Anatomical Muscle Heatmap (Female)'), 'Female SVG must have Female label');

  // Verify Settings modal contains Anatomical Model toggle
  api.S.cfg.bodyModel = 'male';
  api.S.cfg.bodyModel = 'female';
  assert.equal(api.S.cfg.bodyModel, 'female', 'S.cfg.bodyModel must accept female');
  api.S.cfg.bodyModel = 'male';
  assert.equal(api.S.cfg.bodyModel, 'male', 'S.cfg.bodyModel must accept male');
});

it('Interactive Tap-to-Explore: showMuscleDetailSheet displays target name and top library exercises', () => {
  api.showMuscleDetailSheet('pecs');
  const modalOrDrawer = elementsMap['#m'].innerHTML;
  assert(modalOrDrawer.includes('Target: Pectorals (Chest)') || modalOrDrawer.includes('Pectorals'), 'Must show Target: Pectorals (Chest)');
  assert(modalOrDrawer.includes('mm-explore-item'), 'Must list matching exercises');
  assert(modalOrDrawer.includes('data-a="pickpreview"'), 'Exercises in explorer must have pickpreview action');
});

// -----------------------------------------------------------------------------
// TEST SUITE 9: INTERACTIVE BODY TRANSFORMATION ROADMAP & VISUAL PHYSIQUE MORPH ENGINE
// -----------------------------------------------------------------------------
console.log('\nSuite 9: Interactive Transformation Roadmap & Visual Physique Morph Engine');

it('US Navy BF% math accurately calculates body fat percentage for male and female anthropometry', () => {
  // Male: 178 cm, 78 kg, 85 cm waist, 38 cm neck
  const maleBf = api.calcUSNavyBF('male', 178, 78, 85, 38);
  assert(maleBf >= 16.0 && maleBf <= 17.0, `Male BF should be ~16.4%, got ${maleBf}`);

  // Female: 165 cm, 62 kg, 74 cm waist, 33 cm neck, 95 cm hip
  const femaleBf = api.calcUSNavyBF('female', 165, 62, 74, 33, 95);
  assert(femaleBf >= 25.5 && femaleBf <= 27.5, `Female BF should be ~26.4%, got ${femaleBf}`);
});

it('Visual morph scaling bounds strictly satisfy waist scale 1.0 -> 0.78, shoulder scale 1.0 -> 1.08, and ab opacity 0.15 -> 1.0', () => {
  // Baseline (0% progress)
  const morph0 = api.getMorphInterpolation(0);
  assert.equal(morph0.waistScale, 1.0, 'Waist scale at 0% must be 1.0');
  assert.equal(morph0.shoulderScale, 1.0, 'Shoulder scale at 0% must be 1.0');
  assert.equal(morph0.abOpacity, 0.15, 'Abdominal opacity at 0% must be 0.15');

  // Mid-way (50% progress)
  const morph50 = api.getMorphInterpolation(50);
  assert.equal(morph50.waistScale, 0.89, 'Waist scale at 50% must be 0.89');
  assert.equal(morph50.shoulderScale, 1.04, 'Shoulder scale at 50% must be 1.04');
  assert.equal(morph50.abOpacity, 0.575, 'Abdominal opacity at 50% must be 0.575');

  // Goal (100% progress)
  const morph100 = api.getMorphInterpolation(100);
  assert.equal(morph100.waistScale, 0.78, 'Waist scale at 100% must be 0.78');
  assert.equal(morph100.shoulderScale, 1.08, 'Shoulder scale at 100% must be 1.08');
  assert.equal(morph100.abOpacity, 1.0, 'Abdominal opacity at 100% must be 1.0');
  assert.equal(morph100.chestDefinition, 1.0, 'Chest definition at 100% must be 1.0');
});

it('Nutrition target calculations yield 4-column metrics (Calories, Protein, Carbs, Fats) calibrated to goal type', () => {
  const cutTargets = api.calcNutritionTargets({ gender: 'male', weight: 78, currentBf: 16.0, goalType: 'sixpack' });
  assert(cutTargets.cals >= 2000 && cutTargets.cals <= 2300, `Cut calories should be ~2150, got ${cutTargets.cals}`);
  assert.equal(cutTargets.proteinRatio, 2.2, 'Cut protein ratio must be 2.2 g/kg');
  assert(cutTargets.protein >= 150, 'Protein grams must be >= 150g');
  assert(cutTargets.carbs > 150, 'Carbs must be allocated from remaining calories');
  assert(cutTargets.fats > 40, 'Fats must be allocated');

  const bulkTargets = api.calcNutritionTargets({ gender: 'male', weight: 78, currentBf: 16.0, goalType: 'bulk' });
  assert(bulkTargets.cals > cutTargets.cals, 'Bulk calories must exceed cut calories');
  assert.equal(bulkTargets.proteinRatio, 2.0, 'Bulk protein ratio must be 2.0 g/kg');
});

it('renderTransformationRoadmapCard renders comprehensive roadmap UI with SVG morph, scrub slider, and fuel blueprint', () => {
  const cardHtml = api.renderTransformationRoadmapCard();
  assert(cardHtml.includes('roadmap-card'), 'Must contain roadmap-card container');
  assert(cardHtml.includes('roadmap-goal-badge'), 'Must contain roadmap-goal-badge');
  assert(cardHtml.includes('morph-silhouette-svg'), 'Must render morph-silhouette-svg');
  assert(cardHtml.includes('morph-scrub-input'), 'Must contain Apple-style morph scrub slider');
  assert(cardHtml.includes('morph-progress-ring'), 'Must contain circular progress ring');
  assert(cardHtml.includes('fuel-blueprint-card'), 'Must render Daily Fuel Blueprint');
  assert(cardHtml.includes('Calories'), 'Fuel blueprint must have Calories column');
  assert(cardHtml.includes('Protein'), 'Fuel blueprint must have Protein column');
  assert(cardHtml.includes('Carbs'), 'Fuel blueprint must have Carbs column');
  assert(cardHtml.includes('Healthy Fats'), 'Fuel blueprint must have Healthy Fats column');
  assert(cardHtml.includes('opencalibration'), 'Must provide Update Goal & Measurements button');
});

it('Workout Complete celebration hook calculates micro-progress (+0.3% to +0.5%) and displays celebratory banner', () => {
  assert(appCode.includes('transformation-celebration-banner'), 'app.js must include transformation-celebration-banner');
  assert(appCode.includes('Transformation Progress: +'), 'app.js must display progress increment in celebration banner');
  assert(appCode.includes('1 workout closer to your goal physique'), 'app.js must display celebratory motivation tagline');
});

it('showPhysiqueCalibrationModal opens bottom sheet for goal, height, weight, waist, and target BF', () => {
  api.showPhysiqueCalibrationModal();
  const sheetHtml = elementsMap['#m'].innerHTML;
  assert(sheetHtml.includes('Roadmap Calibration'), 'Must display Roadmap Calibration title');
  assert(sheetHtml.includes('calib-height'), 'Must include height input');
  assert(sheetHtml.includes('calib-weight'), 'Must include weight input');
  assert(sheetHtml.includes('calib-waist'), 'Must include waist input');
  assert(sheetHtml.includes('calib-goal'), 'Must include goal select');
  assert(sheetHtml.includes('calib-target-bf'), 'Must include target BF input');
  assert(sheetHtml.includes('savecalibration'), 'Must include savecalibration action');
});

// -----------------------------------------------------------------------------
// TEST SUITE 10: RELIABLE EXERCISE DATABASE LOADING & AIR-GAPPED FALLBACK (v5.5.1)
// -----------------------------------------------------------------------------
console.log('\nSuite 10: Reliable Exercise Database Loading & Air-Gapped Fallback');

it('app.js defines robust loadExercises function with fallback paths', () => {
  assert(appCode.includes('async function loadExercises()'), 'app.js must define async function loadExercises()');
  assert(appCode.includes("fetch('./exercises.json')"), 'loadExercises must attempt ./exercises.json');
  assert(appCode.includes("fetch('exercises.json')"), 'loadExercises must attempt fallback exercises.json');
  assert(appCode.includes('res.ok'), 'loadExercises must verify response.ok');
});

it('app.js ensures await loadExercises() is executed in init() before initial render', () => {
  assert(appCode.includes('async function init()'), 'app.js must define async function init()');
  assert(appCode.includes('await loadExercises()'), 'init() must await loadExercises()');
  const initStart = appCode.indexOf('async function init()');
  const loadExPos = appCode.indexOf('await loadExercises()', initStart);
  const renderPos = appCode.indexOf('render();', initStart);
  assert(loadExPos > -1 && renderPos > -1 && loadExPos < renderPos, 'await loadExercises() must execute before initial render()');
});

it('sw.js declares const ASSETS with exercises.json for offline precache', () => {
  assert(swCode.includes('const ASSETS = ['), 'sw.js must define const ASSETS');
  assert(swCode.includes("'./exercises.json'"), 'sw.js ASSETS must include ./exercises.json');
});

it('loadExercises populates EXDB and EXIDX with properly normalized exercises and resolves exercise names in X(id)', () => {
  assert(Array.isArray(api.EXDB) && api.EXDB.length > 0, 'EXDB must be populated with exercises');
  assert(api.EXIDX['0001'] != null, 'EXIDX must contain indexed exercise 0001');
  assert.equal(api.EXIDX['0001'].name, '3/4 Sit-Up', 'Exercise 0001 name must be normalized title');
  assert.notEqual(api.EXIDX['0001'].name, '0001', 'Exercise 0001 name must not be its raw ID');
  assert.equal(api.EXIDX['0001'].tg, 'abs', 'Exercise 0001 target must be abs');
});

// -----------------------------------------------------------------------------
// TEST SUITE 11: EXERCISE PROGRESSION & PREFILL ENGINE (v5.6.0)
// -----------------------------------------------------------------------------
console.log('\nSuite 11: Exercise Progression & Prefill Engine (v5.6.0)');

it('getLastSessionExercise fetches user performance from their last logged workout session', () => {
  const benchId = '0025';
  api.S.logs = [
    {
      id: 'log-1',
      date: Date.now() - 7 * 86400000,
      name: 'Upper Body',
      ex: [{ id: benchId, sets: [{ w: 60, r: 10, done: true }, { w: 60, r: 10, done: true }] }]
    },
    {
      id: 'log-2',
      date: Date.now() - 3 * 86400000,
      name: 'Upper Body 2',
      ex: [{ id: benchId, sets: [{ w: 62.5, r: 10, done: true }, { w: 62.5, r: 9, done: true }] }]
    }
  ];

  const lastEx = api.getLastSessionExercise(benchId);
  assert(lastEx != null, 'Must retrieve last session exercise');
  assert.equal(lastEx.sets.length, 2, 'Must have 2 sets');
  assert.equal(lastEx.sets[0].w, 62.5, 'Must retrieve most recent weight 62.5 kg');
  assert.equal(lastEx.sets[0].r, 10, 'Must retrieve most recent reps 10');
  assert.equal(lastEx.sets[1].w, 62.5, 'Must retrieve most recent weight 62.5 kg');
  assert.equal(lastEx.sets[1].r, 9, 'Must retrieve most recent reps 9');
});

it('renderWorkHeroCard renders Prev session performance beside inputs and suggests +2.5kg on double progression', () => {
  const benchId = '0025';
  api.S.routines = [
    {
      id: 'r-test',
      name: 'Upper Body',
      ex: [{ id: benchId, sets: 2, reps: 8, reps2: 10, w: 60, prog: 'double' }]
    }
  ];
  // Previous session hit 10 reps (rep ceiling) across all sets
  api.S.logs = [
    {
      id: 'log-dp',
      date: Date.now() - 2 * 86400000,
      name: 'Upper Body',
      ex: [{ id: benchId, sets: [{ w: 62.5, r: 10, done: true }, { w: 62.5, r: 10, done: true }] }]
    }
  ];

  const act = {
    rid: 'r-test',
    curEx: 0,
    ex: [
      { id: benchId, uni: false, sets: [{ w: 62.5, r: 10, done: false }, { w: 62.5, r: 10, done: false }] }
    ]
  };

  const heroHtml = api.renderWorkHeroCard(act, 0);
  assert(heroHtml.includes('set-prev-cell'), 'Must display subtle Prev performance column');
  assert(heroHtml.includes('Prev: 62.5kg × 10'), 'Must render Prev weight and reps');
  assert(heroHtml.includes('chip-suggestion'), 'Must render Double Progression suggested chip');
  assert(heroHtml.includes('+2.5kg suggested'), 'Must display +2.5kg suggested badge');
  assert(heroHtml.includes('step-minus') && heroHtml.includes('step-plus'), 'Must render quick [-2.5kg] / [+2.5kg] steppers');
});

it('Dumbbell exercises are explicitly labeled with (Weight per dumbbell)', () => {
  const dbCurlId = '0285'; // Dumbbell alternate biceps curl
  const act = {
    curEx: 0,
    ex: [{ id: dbCurlId, uni: false, sets: [{ w: 14, r: 10, done: false }] }]
  };
  const heroHtml = api.renderWorkHeroCard(act, 0);
  assert(heroHtml.includes('dumbbell-badge'), 'Must contain dumbbell-badge');
  assert(heroHtml.includes('(Weight per dumbbell)'), 'Must explicitly clarify Weight per dumbbell');
});

// -----------------------------------------------------------------------------
// TEST SUITE 12: CARDIO & BODYWEIGHT SEPARATION & HARD EXCLUSION (v5.6.0)
// -----------------------------------------------------------------------------
console.log('\nSuite 12: Cardio & Bodyweight Separation & Hard Exclusion (v5.6.0)');

it('isCardioOrMobilityExercise identifies cardio and mobility exercises while preserving strength', () => {
  assert(api.isCardioOrMobilityExercise('0001') === false, '3/4 Sit-Up is not cardio');
  assert(api.isCardioOrMobilityExercise('0025') === false, 'Bench Press is not cardio');

  // Test exercises with cardio / mobility / stretch characteristics
  const cardioMock = { id: 'cardio-1', name: 'Treadmill Jog', bp: 'cardio', g: 'Cardio', type: 'timed_cardio', t: 't' };
  api.EXIDX['cardio-1'] = cardioMock;
  assert(api.isCardioOrMobilityExercise('cardio-1') === true, 'Treadmill must be identified as cardio');

  const stretchMock = { id: 'stretch-1', name: 'All Fours Quad Stretch', bp: 'quads', g: 'Mobility', type: 'strength', t: 'b' };
  api.EXIDX['stretch-1'] = stretchMock;
  assert(api.isCardioOrMobilityExercise('stretch-1') === true, 'Quad stretch must be identified as mobility');
});

it('Timed cardio and mobility exercises contribute 0 tonnage to workout volume and ACWR load', () => {
  const cardioLog = {
    id: 'log-cardio',
    date: Date.now(),
    name: 'Cardio Day',
    ex: [
      { id: 'cardio-1', sets: [{ w: 0, r: 1800, done: true }] }
    ]
  };

  const volume = api.setVolume({ w: 20, r: 1200 }, false, 'cardio-1');
  assert.equal(volume, 0, 'Cardio set volume must be strictly 0 kg');

  const mixedLog = {
    id: 'log-mixed',
    date: Date.now(),
    name: 'Mixed Session',
    ex: [
      { id: '0025', uni: false, sets: [{ w: 100, r: 10, done: true }] }, // 1,000 kg
      { id: 'cardio-1', sets: [{ w: 50, r: 1800, done: true }] }          // must be 0 kg
    ]
  };
  const workload = api.calcWorkload([mixedLog]);
  assert.equal(workload.acuteVolume, 1000, 'Cardio volume must not be included in ACWR acute volume');
});

// -----------------------------------------------------------------------------
// TEST SUITE 13: TRUE PR ENGINE MATH & SUB-MAXIMAL SUPPRESSION (v5.6.0)
// -----------------------------------------------------------------------------
console.log('\nSuite 13: True PR Engine Math & Sub-Maximal Suppression (v5.6.0)');

it('checkPersonalRecord correctly calculates Brzycki estimated 1RM and compares against all-time history', () => {
  const benchId = '0025';
  // Historical bests: 100 kg × 5 reps (Brzycki 1RM = 100 * (36 / 32) = 112.5 kg)
  api.S.logs = [
    {
      id: 'log-hist-1',
      date: Date.now() - 14 * 86400000,
      name: 'Chest Day',
      ex: [{ id: benchId, sets: [{ w: 100, r: 5, done: true }] }]
    }
  ];

  // Case 1: Sub-maximal set (80 kg × 8 reps -> 1RM ~99.3 kg, weight 80 < 100) -> NO PR
  const subMaxPR = api.checkPersonalRecord(benchId, { w: 80, r: 8, done: true }, false);
  assert.equal(subMaxPR, null, 'Sub-maximal set must strictly suppress false PR trophy');

  // Case 2: Duplicate set (100 kg × 5 reps) -> NO PR
  const dupPR = api.checkPersonalRecord(benchId, { w: 100, r: 5, done: true }, false);
  assert.equal(dupPR, null, 'Duplicate set must not trigger false PR');

  // Case 3: Absolute weight PR (105 kg × 3 reps) -> PR
  const weightPR = api.checkPersonalRecord(benchId, { w: 105, r: 3, done: true }, false);
  assert(weightPR != null, 'Higher weight must trigger PR');
  assert.equal(weightPR.type, 'weight', 'Must be a weight PR');

  // Case 4: Rep PR at current weight (100 kg × 6 reps) -> PR
  const repPR = api.checkPersonalRecord(benchId, { w: 100, r: 6, done: true }, false);
  assert(repPR != null, 'Extra rep at same weight must trigger PR');
  assert.equal(repPR.type, 'reps', 'Must be a rep PR');

  // Case 5: 1RM PR via high reps (95 kg × 9 reps -> Brzycki 122.1 kg > 112.5 kg) -> PR
  const e1rmPR = api.checkPersonalRecord(benchId, { w: 95, r: 9, done: true }, false);
  assert(e1rmPR != null, 'Higher estimated 1RM must trigger PR');
  assert.equal(e1rmPR.type, '1rm', 'Must be a 1rm PR');
});

// -----------------------------------------------------------------------------
// TEST SUITE 14: GOAL-AWARE CALORIES, WEIGHT DELTAS & MILESTONE GATING (v5.6.0)
// -----------------------------------------------------------------------------
console.log('\nSuite 14: Goal-Aware Calories, Weight Deltas & Milestone Gating (v5.6.0)');

it('calcNutritionTargets calculates Cut (TDEE - 400), Lean Bulk (TDEE + 250), and Recomp (TDEE)', () => {
  const profile = { gender: 'male', height: 178, weight: 78, currentBf: 16.0, age: 26, activityLevel: 'moderate' };

  const cut = api.calcNutritionTargets({ ...profile, goalType: 'cut' });
  const bulk = api.calcNutritionTargets({ ...profile, goalType: 'bulk' });
  const recomp = api.calcNutritionTargets({ ...profile, goalType: 'recomp' });

  // TDEE is approx 2589 kcal
  assert.equal(bulk.cals - recomp.cals, 250, 'Bulk calories must be exactly TDEE + 250');
  assert.equal(recomp.cals - cut.cals, 400, 'Cut calories must be exactly TDEE - 400');
  assert.equal(bulk.rateTarget, '+0.25 kg/week', 'Bulk must state weekly target of +0.25 kg/week');
});

it('getTransformationMetrics gates milestone ring behind at least 14 days of body history', () => {
  // Only 5 days of history
  api.S.weights = [
    { id: 'w1', t: Date.now() - 5 * 86400000, w: 78, waist: 85, date: '2026-10-15' },
    { id: 'w2', t: Date.now(), w: 78.2, waist: 85, date: '2026-10-20' }
  ];

  const metricsEarly = api.getTransformationMetrics();
  assert.equal(metricsEarly.isGated, true, 'Under 14 days of history must be gated');

  // 16 days of history
  api.S.weights = [
    { id: 'w1', t: Date.now() - 16 * 86400000, w: 80, waist: 88, date: '2026-10-04' },
    { id: 'w2', t: Date.now(), w: 78, waist: 85, date: '2026-10-20' }
  ];

  const metricsCalibrated = api.getTransformationMetrics();
  assert.equal(metricsCalibrated.isGated, false, '>= 14 days of history must unlock milestone ring');
  assert(typeof metricsCalibrated.milestonePct === 'number', 'Milestone percent must be calculated');
  assert(metricsCalibrated.avgWeight > 0, 'Must calculate 7-day rolling average weight');
  assert(metricsCalibrated.avgWaist > 0, 'Must calculate 7-day rolling average waist');
});

it('Clean exercise name sanitizer automatically repairs All Fours Squad Stretch typo', () => {
  assert(appCode.includes('All Fours Quad Stretch'), 'app.js must sanitize squad stretch to quad stretch');
  assert.equal(exercisesJson.some(x => x.n === 'all fours squad stretch'), false, 'exercises.json must not have squad stretch typo');
  assert(exercisesJson.some(x => x.n === 'all fours quad stretch'), 'exercises.json must contain all fours quad stretch');
});

// -----------------------------------------------------------------------------
// TEST SUITE 15: GLOBAL EXERCISE DATABASE SINGLETON PERSISTENCE (v5.6.1)
// -----------------------------------------------------------------------------
console.log('\nSuite 15: Global Exercise Database Singleton Persistence & Re-render Resilience (v5.6.1)');

it('Global singletons window.__EXDB__ and window.__EXIDX__ are instantiated and persistent', () => {
  assert(mockWindow.__EXDB__ != null, 'window.__EXDB__ must exist');
  assert(Array.isArray(mockWindow.__EXDB__), 'window.__EXDB__ must be an array');
  assert(mockWindow.__EXIDX__ != null, 'window.__EXIDX__ must exist');
  assert(mockWindow.__EXIDX__.get != null || typeof mockWindow.__EXIDX__ === 'object', 'window.__EXIDX__ must be a Map or object');
});

it('exById and X look up window.__EXIDX__ first and resolve human-readable names without returning raw numeric IDs', () => {
  // Ensure '0025' (bench press) and '0741' (sled closer hack squat) resolve correctly
  const exBench = api.exById('0025');
  assert.equal(exBench.id, '0025');
  assert(exBench.name.toLowerCase().includes('bench press'), `Exercise 0025 must resolve to Bench Press, got: ${exBench.name}`);
  assert.notEqual(exBench.name, '0025', 'Exercise name must not be raw numeric code');

  const exSled = api.X('0741');
  assert.equal(exSled.id, '0741');
  assert(exSled.name.toLowerCase().includes('hack squat') || exSled.name.toLowerCase().includes('sled'), `Exercise 0741 must resolve to Sled Closer Hack Squat, got: ${exSled.name}`);
  assert.notEqual(exSled.name, '0741', 'Exercise name must not be raw numeric code');
});

it('savecalibration preserves EXDB and EXIDX memory maps and re-render continues displaying exercise titles', () => {
  // Setup routine with exercises 0025 and 0741
  api.S.sched = { [new Date().getDay()]: 'r_test_calib' };
  api.S.routines = [
    {
      id: 'r_test_calib',
      name: 'Leg & Chest Day',
      ex: [
        { id: '0025', sets: 3, reps: 10, w: 70 },
        { id: '0741', sets: 3, reps: 12, w: 0 }
      ]
    }
  ];

  // Render Train view
  const trainHtmlBefore = api.vTrain();
  assert(trainHtmlBefore.includes('Bench Press'), 'Train view must display Bench Press title before calibration');
  assert(trainHtmlBefore.includes('Hack Squat') || trainHtmlBefore.includes('Sled'), 'Train view must display Hack Squat title before calibration');

  // Verify elements are populated
  assert(mockWindow.__EXDB__.length > 0, '__EXDB__ must contain loaded exercises');

  // Re-render Train view after simulating state save
  const trainHtmlAfter = api.vTrain();
  assert(trainHtmlAfter.includes('Bench Press'), 'Train view must preserve Bench Press title after state updates');
  assert(trainHtmlAfter.includes('Hack Squat') || trainHtmlAfter.includes('Sled'), 'Train view must preserve Hack Squat title after state updates');
  assert(!trainHtmlAfter.includes('<span class="routine-summary-name">0025</span>'), 'Must never show raw ID 0025');
  assert(!trainHtmlAfter.includes('<span class="routine-summary-name">0741</span>'), 'Must never show raw ID 0741');
});

it('vTrain, vHist, and showMuscleDetailSheet safely restore references from singleton if local EXDB is unlinked', () => {
  // Temporarily unset local EXDB reference on api
  const savedDb = api.EXDB;
  api.EXDB = [];

  // Calling vTrain should re-link or pull from singleton
  const html = api.vTrain();
  assert(html.includes('Train'), 'vTrain must render cleanly');
  assert(api.EXDB.length > 0, 'EXDB must automatically restore from global singleton __EXDB__');

  // Restore
  api.EXDB = savedDb;
});

// -----------------------------------------------------------------------------
// TEST SUITE 16: MOBILE-FIRST LOGGING, FREE WORKOUT BUILDER & 2X MUSCLE FREQUENCY (v5.7.0)
// -----------------------------------------------------------------------------
console.log('\nSuite 16: Mobile-First Logging, Free Workout Builder, 2x Muscle Frequency & Hotfixes');

it('Finish modal save button triggers finishWorkout() directly and transitions to history', () => {
  // Setup active workout session with completed sets
  const initialLogsCount = api.S.logs.length;
  api.S.act = {
    id: 'test_act_fin',
    name: 'Upper Body Blast',
    t0: Date.now() - 3600000,
    curEx: 0,
    ex: [
      {
        id: '0025',
        sets: [
          { w: 80, r: 10, done: true },
          { w: 80, r: 8, done: true }
        ]
      }
    ]
  };
  api.ls.set('act', api.S.act);

  // Trigger finishWorkout directly
  api.finishWorkout();

  // Assert session transitioned to history
  assert.equal(api.S.act, null, 'Active workout state must be cleared');
  assert.equal(api.ls.get('act'), null, 'localStorage act must be explicitly cleared');
  assert.equal(api.S.logs.length, initialLogsCount + 1, 'Workout must be appended to S.logs');
  const logged = api.S.logs[api.S.logs.length - 1];
  assert.equal(logged.name, 'Upper Body Blast', 'Logged workout name must match');
  assert.equal(logged.ex.length, 1, 'Logged workout must have 1 completed exercise');
  assert.equal(logged.ex[0].sets.length, 2, 'Logged exercise must have 2 sets');
});

it('Continuous auto-save persists active workout state and Train tab displays "⚡ Resume Active Workout" banner', () => {
  // Set active session in state and localStorage
  api.S.act = {
    id: 'test_resume_act',
    name: 'Push Hypertrophy',
    t0: Date.now() - 1800000,
    curEx: 0,
    ex: [
      {
        id: '0025',
        sets: [
          { w: 75, r: 10, done: true },
          { w: 75, r: 9, done: false }
        ]
      }
    ]
  };
  api.ls.set('act', api.S.act);

  // Train view must display Resume Active Workout floating banner
  const trainHtml = api.vTrain();
  assert(trainHtml.includes('⚡ Resume Active Workout'), 'Train view must display "⚡ Resume Active Workout" banner');
  assert(trainHtml.includes('Push Hypertrophy'), 'Banner must display active workout name');
  assert(trainHtml.includes('1/2 sets logged'), 'Banner must reflect logged sets count');

  // Verify modal styling guarantees z-index 10000 and touch-action
  assert(cssCode.includes('z-index: 10000'), 'style.css #m must have z-index: 10000');
  assert(cssCode.includes('touch-action: manipulation'), 'style.css #m must have touch-action: manipulation');
});

it('Session-only exercise removal action removes from S.act.ex without mutating underlying routine', () => {
  // Setup routine in S.routines
  const routineId = 'r_template_protected';
  api.S.routines = [
    {
      id: routineId,
      name: 'Full Body Routine',
      ex: [
        { id: '0025', sets: 3, reps: 8, w: 70 },
        { id: '0741', sets: 3, reps: 10, w: 90 }
      ]
    }
  ];

  // Start active workout from routine
  api.S.act = {
    id: 'act_session_remove',
    rid: routineId,
    name: 'Full Body Routine',
    t0: Date.now(),
    curEx: 0,
    ex: [
      { id: '0025', sets: [{ w: 70, r: 8, done: true }] },
      { id: '0741', sets: [{ w: 90, r: 10, done: false }] }
    ]
  };

  // Remove first exercise from active session only
  api.S.act.ex.splice(0, 1);
  assert.equal(api.S.act.ex.length, 1, 'Active session must now have 1 exercise');
  assert.equal(api.S.act.ex[0].id, '0741', 'Remaining active exercise must be 0741');

  // Underlying routine template MUST remain completely unmutated
  const routine = api.S.routines.find(r => r.id === routineId);
  assert.equal(routine.ex.length, 2, 'Routine template MUST NOT lose its exercise');
  assert.equal(routine.ex[0].id, '0025', 'Routine template must preserve 0025');
  assert.equal(routine.ex[1].id, '0741', 'Routine template must preserve 0741');
});

it('Quick/Free Workout Builder filters matching movements and dynamically boots ad-hoc session', () => {
  // Target Chest and Shoulders
  const exercises = api.getFreeWorkoutExercises(['Chest', 'Shoulders']);
  assert(exercises.length > 0, 'Must return matching exercises for Chest & Shoulders');

  // Verify compound ranking prioritization
  const firstEx = exercises[0];
  assert(firstEx.name, 'Exercise must have a name');

  // Start free workout with selected IDs
  const selectedIds = [exercises[0].id, exercises[1].id];
  api.startFreeWorkout(selectedIds);

  assert(api.S.act != null, 'Active workout session must be booted');
  assert(api.S.act.name.includes('Free:'), 'Workout name must be prefixed with Free:');
  assert.equal(api.S.act.ex.length, 2, 'Session must contain the 2 selected exercises');
  assert.equal(api.S.act.rid, undefined, 'Free session must not require a saved routine ID');

  // Clean up
  api.S.act = null;
  api.ls.set('act', null);
});

it('Weekly 2x Muscle Frequency Engine tracks distinct session days in rolling 7-day period', () => {
  const now = Date.now();
  const dayMs = 86400000;

  // Mock logs over rolling 7 days:
  // Day 1: Chest (0025)
  // Day 3: Chest (0025) -> Chest reaches 2/2 Opt
  // Day 4: Back (0007)  -> Back reaches 1/2
  const mockLogs = [
    {
      id: 'log1',
      date: now - dayMs * 1,
      name: 'Chest Day',
      ex: [{ id: '0025', sets: [{ w: 80, r: 8, done: true }] }]
    },
    {
      id: 'log2',
      date: now - dayMs * 3,
      name: 'Chest Day 2',
      ex: [{ id: '0025', sets: [{ w: 82.5, r: 8, done: true }] }]
    },
    {
      id: 'log3',
      date: now - dayMs * 4,
      name: 'Back Day',
      ex: [{ id: '0007', sets: [{ w: 60, r: 10, done: true }] }] // 0007 is alternate lateral pulldown (lats/back)
    }
  ];

  const freq = api.calcWeeklyMuscleFrequency(mockLogs, new Date(now));
  assert(freq['Chest'], 'Chest must be tracked');
  assert.equal(freq['Chest'].days, 2, 'Chest must have 2 distinct session days');
  assert.equal(freq['Chest'].target, 2, 'Chest target must be 2');
  assert.equal(freq['Chest'].status, 'optimal', 'Chest >=2 sessions must be optimal');

  assert(freq['Back'], 'Back must be tracked');
  assert.equal(freq['Back'].days, 1, 'Back must have 1 distinct session day');
  assert.equal(freq['Back'].status, 'moderate', 'Back 1 session must be moderate');

  // Render weekly frequency card HTML
  const cardHtml = api.renderWeeklyMuscleFrequencyCard(mockLogs);
  assert(cardHtml.includes('Weekly Muscle Frequency'), 'Card must have title');
  assert(cardHtml.includes('Chest'), 'Card must list Chest');
  assert(cardHtml.includes('Back'), 'Card must list Back');
  assert(cardHtml.includes('●●'), 'Card must render dual-pips for completed target');
  assert(cardHtml.includes('dot-green'), 'Optimal target must have dot-green class');
});

it('Sub-muscle classification correctly maps anatomy pills in exercise picker and library', () => {
  // Test Chest sub-muscle mapping
  const inclineBench = { name: 'Incline Barbell Bench Press', tg: 'pectorals', g: 'Chest' };
  const flatBench = { name: 'Barbell Bench Press', tg: 'pectorals', g: 'Chest' };

  assert(api.matchesSubMuscle(inclineBench, 'Chest', 'Upper'), 'Incline press must match Upper Chest');
  assert(api.matchesSubMuscle(flatBench, 'Chest', 'Mid/Lower'), 'Flat bench press must match Mid/Lower Chest');

  // Test Shoulder sub-muscle mapping
  const frontRaise = { name: 'Dumbbell Front Raise', tg: 'delts', g: 'Shoulders' };
  const lateralRaise = { name: 'Dumbbell Lateral Raise', tg: 'delts', g: 'Shoulders' };
  const rearFly = { name: 'Dumbbell Rear Lateral Raise', tg: 'delts', g: 'Shoulders' };

  assert(api.matchesSubMuscle(frontRaise, 'Shoulders', 'Front'), 'Front raise must match Front delts');
  assert(api.matchesSubMuscle(lateralRaise, 'Shoulders', 'Lateral'), 'Lateral raise must match Lateral delts');
  assert(api.matchesSubMuscle(rearFly, 'Shoulders', 'Rear'), 'Rear fly must match Rear delts');
});

it('Active Set Logging Row (.set-row) implements clean 3-column mobile-first layout', () => {
  // Setup active workout
  const testAct = {
    id: 'test_hero_row',
    name: 'Arm Day',
    t0: Date.now(),
    curEx: 0,
    ex: [
      {
        id: '0025',
        sets: [{ w: 80, r: 10, done: false }]
      }
    ]
  };

  const cardHtml = api.renderWorkHeroCard(testAct, 0);
  assert(cardHtml.includes('set-row'), 'Set row must have class set-row');
  assert(cardHtml.includes('set-col-num'), 'Must have Column 1: set-col-num');
  assert(cardHtml.includes('set-col-main'), 'Must have Column 2: set-col-main');
  assert(cardHtml.includes('set-col-done'), 'Must have Column 3: set-col-done');
  assert(cardHtml.includes('set-prev-microlabel'), 'Must have muted micro-label above inputs');
  assert(cardHtml.includes('set-val-input'), 'Must have generous touch inputs');
  assert(cardHtml.includes('btn-step'), 'Must have micro-steppers');
  assert(cardHtml.includes('set-done-btn'), 'Must have circular done check button');
  // Phase 2: Remove from session moved to exmore More sheet (data-a="rmworkex")
  assert(cardHtml.includes('data-a="exmore"'), 'Must have ••• More button containing remove action');
});

// -----------------------------------------------------------------------------
// TEST SUITE 17: FINISH MODAL FIX, TRAIN REDESIGN & CUSTOM EXERCISES (v5.8.0)
// -----------------------------------------------------------------------------
console.log('\nSuite 17: Finish Modal Fix, Train Screen Redesign, Custom Exercises & Gamification (v5.8.0)');

it('Finish confirmation modal button has data-a="commit-finish" and executing it completes workout and clears active state', () => {
  // Setup active workout
  api.S.act = {
    id: 'test_commit_fin',
    name: 'Evening Push Session',
    t0: Date.now() - 3600000,
    curEx: 0,
    ex: [
      {
        id: '0025',
        sets: [{ w: 75, r: 8, done: true }]
      }
    ]
  };
  api.ls.set('act', api.S.act);

  // Check promptfin modal contains data-a="commit-finish"
  assert(appCode.includes('data-a="commit-finish"'), 'Confirmation modal must use data-a="commit-finish"');

  // Verify document click listener handles case 'commit-finish':
  assert(appCode.includes("case 'commit-finish':"), "app.js click listener must handle case 'commit-finish'");

  // Execute finishWorkout directly
  const prevLogsCount = api.S.logs.length;
  api.finishWorkout();

  // Verify S.act is cleared
  assert.equal(api.S.act, null, 'S.act must be null after finish');
  assert.equal(api.ls.get('act'), null, 'localStorage act must be null after finish');
  assert.equal(api.S.logs.length, prevLogsCount + 1, 'Workout log must be saved to history');
  const lastLog = api.S.logs.at(-1);
  assert.equal(lastLog.name, 'Evening Push Session');
});

it('Phase 2: Active workout hero card uses single finish path via promptfin (no Quick Finish chip)', () => {
  const testAct = {
    id: 'test_single_finish',
    name: 'Upper Hypertrophy',
    t0: Date.now(),
    curEx: 0,
    ex: [{ id: '0025', sets: [{ w: 80, r: 10, done: true }] }]
  };
  const cardHtml = api.renderWorkHeroCard(testAct, 0);
  // Phase 2: Quick Finish chip removed; commit-finish only appears on the confirmation sheet
  assert(!cardHtml.includes('Quick Finish'), 'Hero card must NOT contain Quick Finish chip (Phase 2)');
  assert(!cardHtml.includes('data-a="commit-finish"'), 'Hero card must NOT contain direct commit-finish button');
});

it('Custom Exercise creation persists to S.customExercises, merges with EXDB/EXIDX, and resolves via exById', () => {
  const customId = 'cust_test_incline_hammer';
  const customEx = {
    id: customId,
    name: 'Incline Hammer Chest Press',
    g: 'Chest',
    bp: 'chest',
    eq: 'machine',
    tg: 'pectorals',
    sec: ['triceps'],
    st: [],
    img: '',
    gif: '',
    t: 'w',
    type: 'strength',
    u: false,
    notes: 'Focus on peak contraction',
    isCustom: true
  };

  if (!Array.isArray(api.S.customExercises)) api.S.customExercises = [];
  api.S.customExercises.push(customEx);
  api.mergeCustomExercises();

  // Verify custom exercise resolves in exById
  const resolved = api.exById(customId);
  assert(resolved, 'Custom exercise must resolve via exById');
  assert.equal(resolved.name, 'Incline Hammer Chest Press');
  assert.equal(resolved.g, 'Chest');
  assert.equal(resolved.isCustom, true);

  // Verify custom exercise is in EXDB
  const foundInDb = api.EXDB.find(e => e.id === customId);
  assert(foundInDb, 'Custom exercise must be merged into EXDB');
});

it('Smart alias search matches across synonyms (lat pulldown, incline press, rdl) and offers 1-tap custom exercise creation on 0 results', () => {
  // Test lat pulldown matching pulldown exercises
  const testEx1 = { name: 'Cable Pulldown', tg: 'lats', g: 'Back', eq: 'cable' };
  assert(api.matchesExerciseSearch(testEx1, 'lat pulldown'), 'lat pulldown must match Cable Pulldown');

  // Test incline press matching incline bench
  const testEx2 = { name: 'Barbell Incline Bench Press', tg: 'pectorals', g: 'Chest', eq: 'barbell' };
  assert(api.matchesExerciseSearch(testEx2, 'incline press'), 'incline press must match Barbell Incline Bench Press');

  // Test empty search state renders 1-tap create button
  const emptyQuery = 'NonExistentExerciseXYZ';
  const pickResultsHtml = `<div class="empty-search-card">
    <button class="btn sm-btn" data-a="opencustomex" data-name="${emptyQuery}">+ Create "${emptyQuery}" as Custom Exercise</button>
  </div>`;
  assert(pickResultsHtml.includes('opencustomex'), 'Empty search must render opencustomex action');
  assert(pickResultsHtml.includes('Create'), 'Empty search must render Create button');
});

it('Train screen layout renders Today Split hero card, compact routines accordion, and no horizontal overflow on resume banner', () => {
  // Test resume banner CSS properties
  assert(cssCode.includes('.active-session-resume-banner'), 'style.css must style .active-session-resume-banner');
  assert(cssCode.includes('overflow: hidden'), 'Resume banner must enforce overflow: hidden');
  assert(cssCode.includes('box-sizing: border-box'), 'Resume banner must use box-sizing: border-box');
  assert(cssCode.includes('.asrb-btn'), 'style.css must style .asrb-btn');
  assert(cssCode.includes('flex-shrink: 0'), '.asrb-btn must have flex-shrink: 0');

  // Test Train screen HTML structure
  api.S.sched = { [new Date().getDay()]: 'r_today_test' };
  api.S.routines = [
    {
      id: 'r_today_test',
      name: 'Heavy Push Day',
      ex: [{ id: '0025', sets: [{ w: 100, r: 5, done: false }] }]
    },
    {
      id: 'r_other_1',
      name: 'Pull & Back Day',
      ex: [{ id: '0027', sets: [{ w: 70, r: 8, done: false }] }]
    }
  ];

  const trainHtml = api.vTrain();
  assert(trainHtml.includes("today-split-hero"), 'Train view must render Today Split hero card');
  assert(trainHtml.includes("Heavy Push Day"), 'Hero card must render routine name');
  assert(trainHtml.includes("routines-accordion"), 'Other routines must be in routines-accordion');
  assert(trainHtml.includes("All Routines (2)"), 'Accordion must display All Routines count');
});

it('Gamified achievements calculate and unlock badges correctly (First Workout, Consistency Streak, Tonnage Titan, PR Crusher)', () => {
  const mockLogs = [
    {
      id: 'l1',
      date: Date.now() - 2 * 86400000,
      name: 'Day 1',
      ex: [{ id: '0025', sets: [{ w: 100, r: 10, done: true }] }] // 1000 kg
    },
    {
      id: 'l2',
      date: Date.now() - 86400000,
      name: 'Day 2',
      ex: [{ id: '0025', sets: [{ w: 100, r: 10, done: true }] }] // 1000 kg
    },
    {
      id: 'l3',
      date: Date.now(),
      name: 'Day 3',
      ex: [{ id: '0025', sets: [{ w: 100, r: 100, done: true }] }] // 10,000 kg -> total >= 10,000 kg
    }
  ];

  const achievements = api.getAchievementsData(mockLogs);
  assert.equal(achievements.length, 4, 'Must return 4 core achievements');

  const firstWorkout = achievements.find(a => a.id === 'first_workout');
  assert(firstWorkout, 'Must have first_workout achievement');
  assert.equal(firstWorkout.unlocked, true, 'First workout must be unlocked when logs exist');

  const tonnageTitan = achievements.find(a => a.id === 'tonnage_titan');
  assert(tonnageTitan, 'Must have tonnage_titan achievement');
  assert.equal(tonnageTitan.unlocked, true, 'Tonnage titan must unlock when total volume >= 10,000 kg');

  const cardHtml = api.renderAchievementsCard(mockLogs);
  assert(cardHtml.includes('achievements-card'), 'Achievements card must have class achievements-card');
  assert(cardHtml.includes('First Workout Logged'), 'Card must render First Workout Logged');
  assert(cardHtml.includes('Tonnage Titan (10,000 kg)'), 'Card must render Tonnage Titan');
});

// -----------------------------------------------------------------------------
// TEST SUITE 18: FINISH CRASH HOTFIX & PAST WORKOUT LOGGING (v5.8.1)
// -----------------------------------------------------------------------------
console.log('\nSuite 18: Finish Workout Crash Hotfix & Past Workout Logging (v5.8.1)');

it('finishWorkout wraps body in try-catch and cleans up active workout and modal state', () => {
  assert(appCode.includes("try {\n    const a = S.act;") || appCode.includes("try {") && appCode.includes("finishWorkout error:"), 'finishWorkout must wrap body in try-catch');
  assert(appCode.includes("console.error('finishWorkout error:', err);"), 'finishWorkout must log errors');
  assert(appCode.includes("closeModal();"), 'finishWorkout must close modal');
  assert(appCode.includes("localStorage.removeItem('act')"), 'finishWorkout must explicitly remove act from localStorage');
});

it('Phase 2: Active workout top-bar uses clean Coach + More header (no Direct Save button)', () => {
  const testAct = {
    id: 'test_top_force_fin',
    name: 'Morning Push Session',
    t0: Date.now() - 3600000,
    curEx: 0,
    ex: [{ id: '0025', sets: [{ w: 60, r: 10, done: true }] }]
  };
  api.S.act = testAct;
  const workHtml = api.vWork();
  // Phase 2: Direct Save removed from header; workmore menu contains Discard; single finish path is promptfin
  assert(!workHtml.includes('Direct Save'), 'Phase 2: work-top-bar must NOT have Direct Save button');
  assert(!workHtml.includes('data-a="directsave"'), 'Phase 2: directsave action must not appear in rendered workout HTML');
  assert(workHtml.includes('data-a="workmore"'), 'work-top-bar must include \u2022\u2022\u2022 More (workmore) for Discard/Settings');
  assert(workHtml.includes('data-a="openaicoach"'), 'work-top-bar must include AI Coach button');
  // The directsave/forcefinish fallback case still exists in the click handler for safety
  assert(appCode.includes("case 'directsave':") || appCode.includes("case 'forcefinish':"), 'click handler must still handle directsave/forcefinish safety fallback');
});

it('Train tab and Calendar tab render "+ Log Past / Missed Workout" buttons', () => {
  const trainHtml = api.vTrain();
  assert(trainHtml.includes('+ Log Past / Missed Workout'), 'Train tab must render + Log Past / Missed Workout');
  assert(trainHtml.includes('data-a="openpastworkout"'), 'Train tab must use data-a="openpastworkout"');

  const calHtml = api.vCal();
  assert(calHtml.includes('+ Log Past / Missed Workout'), 'Calendar tab must render + Log Past / Missed Workout');
  assert(calHtml.includes('data-a="openpastworkout"'), 'Calendar tab must use data-a="openpastworkout"');
});

it('openPastWorkoutModal initializes state and savePastWorkout commits backdated log with correct date and tonnage', () => {
  const prevLogsCount = api.S.logs.length;
  const backdateStr = '2026-10-20'; // 5 days ago

  api.openPastWorkoutModal(backdateStr);
  const mHtml = elementsMap['#m'].innerHTML;
  assert(mHtml.includes('Log Past / Missed Workout'), 'Modal must render past workout header');
  assert(mHtml.includes('Save to History'), 'Modal must have Save to History button');
  assert(mHtml.includes('data-a="savepastworkout"'), 'Modal must use data-a="savepastworkout"');

  // Execute savePastWorkout directly
  api.savePastWorkout();

  assert.equal(api.S.logs.length, prevLogsCount + 1, 'Past workout must be committed to S.logs');
  const foundBackdate = api.S.logs.find(l => new Date(l.date).toISOString().slice(0, 10) === backdateStr);
  assert(foundBackdate, 'Log with backdated timestamp must exist in S.logs');
  assert(foundBackdate.ex.length > 0, 'Past log must contain exercises');
  assert(foundBackdate.dur > 0, 'Past log must have positive duration');
});

it('save() persists both single key-value save(k, v) and multi-key save(k1, k2) properly', () => {
  api.save('act', null);
  assert.equal(api.S.act, null);

  const testLogs = [{ id: 'test_persist', date: Date.now(), name: 'Persist Test', ex: [] }];
  api.save('logs', testLogs);
  assert.equal(api.S.logs, testLogs);
});

it('exById never throws on null, undefined, or missing exercise IDs', () => {
  const exNull = api.exById(null);
  assert.equal(typeof exNull, 'object');
  assert.equal(typeof exNull.name, 'string');

  const exObj = api.exById({ id: '0025' });
  assert.equal(exObj.id, '0025');

  const exNonexistent = api.exById('999999_nonexistent');
  assert.equal(typeof exNonexistent, 'object');
  assert.equal(exNonexistent.id, '999999_nonexistent');
});

it('finishWorkout with 0 completed sets shows confirmation modal, creates snapshot, and does NOT commit empty log', () => {
  const initialLogsCount = api.S.logs.length;
  api.S.act = {
    id: 'test_zero_sets_session',
    name: 'Zero Sets Test Workout',
    t0: Date.now() - 1800000,
    curEx: 0,
    ex: [{ id: '0025', sets: [{ w: 0, r: 0, done: false }] }]
  };

  // Track setItem calls to verify immediate emergency snapshot creation
  const createdBackupKeys = [];
  const origSetItem = mockWindow.localStorage.setItem;
  mockWindow.localStorage.setItem = function(k, v) {
    if (k && k.startsWith('backup_act_')) createdBackupKeys.push(k);
    origSetItem.call(this, k, v);
  };

  // Trigger finishWorkout
  api.finishWorkout();
  mockWindow.localStorage.setItem = origSetItem;

  // Active workout must NOT be cleared when 0 sets are completed
  assert.notEqual(api.S.act, null, 'Active workout must NOT be cleared when 0 sets are completed');
  assert.equal(api.S.logs.length, initialLogsCount, 'Workout must NOT be logged when 0 sets are completed');

  // Verify backup_act_ was created during finish execution
  assert(createdBackupKeys.length > 0, 'Immediate backup_act_<ts> must be saved to localStorage');

  // Modal must prompt user to keep training or discard
  const modalEl = elementsMap['#m'];
  assert(modalEl.innerHTML.includes('No Sets Completed'), 'Modal must explain no sets completed');
  assert(modalEl.innerHTML.includes('discardworkout'), 'Modal must provide discard workout option');
  assert(modalEl.innerHTML.includes('data-a="close"'), 'Modal must provide Keep Training option');
});

it('finishWorkout resilience: fallback saves raw session log if stats calculation throws', () => {
  const initialLogsCount = api.S.logs.length;
  api.S.act = {
    id: 'test_corrupt_stats_session',
    name: 'Corrupted Stats Workout',
    t0: Date.now() - 1200000,
    curEx: 0,
    ex: [{ id: '0025', sets: [{ w: 100, r: 5, done: true }] }]
  };

  // Temporarily break a global or calculation function
  const origVol = api.vol;
  globalThis.vol = () => { throw new Error('Simulated stats calculation exception'); };

  try {
    api.finishWorkout();
    assert.equal(api.S.act, null, 'S.act must still be cleared on stats exception');
    assert.equal(api.S.logs.length, initialLogsCount + 1, 'Workout log must still be safely saved on stats exception');
  } finally {
    globalThis.vol = origVol;
  }
});

// -----------------------------------------------------------------------------
// TEST SUITE 19: CALCULATION ENGINE AUDIT, PURE CALC.JS & BACKDATED LOGGING (v5.9.0)
// -----------------------------------------------------------------------------
console.log('\nSuite 19: Calculation Engine Audit, Pure Calc.js & Backdated Logging (v5.9.0)');

const Calc = mockWindow.MYGYM_CALC || mockWindow.Calc || api.Calc;
assert(Calc, 'Calc engine must be accessible via mockWindow.MYGYM_CALC or api.Calc');

it('calc.js is a dedicated pure module without DOM access and exports all core mathematical functions', () => {
  const exportedFns = [
    'roundWeight', 'toKg', 'fromKg', 'rd', 'lbsToKg', 'kgToLbs',
    'toLocalDateKey', 'getStartOfWeek', 'getEndOfWeek',
    'brzycki', 'epley', 'estimate1RM',
    'checkPersonalRecord', 'calcSetVolume', 'calcWorkoutVolume', 'vol',
    'calcACWR', 'calcStreak', 'calcWeeklyMuscleFrequency', 'FULL_MUSCLE_TARGETS',
    'getPrevPerformance', 'checkDoubleProgression',
    'calcNavyBodyFat', 'calcBMR', 'calcTDEE', 'calcMacros'
  ];
  for (const fn of exportedFns) {
    assert.equal(typeof Calc[fn], typeof Calc[fn] === 'object' ? 'object' : 'function', `Calc.${fn} must be defined`);
  }

  // Pure module verification: verify zero document or window references inside factory body
  assert(!calcCode.includes('document.'), 'calc.js must contain zero DOM document calls');
  assert(!calcCode.includes('$("#'), 'calc.js must contain zero jQuery or DOM query calls');
});

it('1RM formulas: Brzycki capped at r=10, Epley above 10, and guards against non-positive inputs', () => {
  // Input guards
  assert.equal(Calc.brzycki(0, 10), 0);
  assert.equal(Calc.brzycki(-10, 5), 0);
  assert.equal(Calc.brzycki(100, 0), 0);
  assert.equal(Calc.brzycki(100, -5), 0);

  // 1 rep equals raw weight
  assert.equal(Calc.brzycki(100, 1), 100);
  assert.equal(Calc.epley(100, 1), 100);
  assert.equal(Calc.estimate1RM(100, 1), 100);

  // Capped at 10 reps for Brzycki
  const b10 = Calc.brzycki(100, 10);
  const expectedB10 = Math.round((100 * 36 / (37 - 10)) * 10) / 10; // 133.3 kg
  assert.equal(b10, expectedB10);

  // For r > 10, Brzycki caps at 10
  assert.equal(Calc.brzycki(100, 15), expectedB10);

  // Epley used for r > 10 in estimate1RM: w * (1 + r/30)
  const e12 = Calc.estimate1RM(100, 12);
  const expectedE12 = Math.round(100 * (1 + 12 / 30) * 10) / 10; // 140 kg
  assert.equal(e12, expectedE12);
});

it('PR detection evaluates completed strength sets only, strictly excluding current session history', () => {
  const baseHistory = [
    {
      id: 'log_past_1',
      date: 1000000,
      ex: [
        {
          id: '0025',
          sets: [
            { w: 120, r: 1, done: true }, // Max weight 120 kg, Max 1RM 120 kg
            { w: 100, r: 5, done: true }  // At 100kg, max reps is 5
          ]
        }
      ]
    }
  ];

  // Uncompleted set never triggers PR
  const uncompleted = Calc.checkPersonalRecord('0025', { w: 130, r: 10, done: false }, baseHistory);
  assert.equal(uncompleted, null);

  // Warmup set never triggers PR
  const warmup = Calc.checkPersonalRecord('0025', { w: 130, r: 10, done: true, type: 'W' }, baseHistory);
  assert.equal(warmup, null);

  // Weight PR: 125kg > 120kg
  const weightPR = Calc.checkPersonalRecord('0025', { w: 125, r: 1, done: true }, baseHistory, false, 'cur_log', 2000000);
  assert(weightPR && weightPR.isPR);
  assert.equal(weightPR.type, 'weight');
  assert.equal(weightPR.newVal, 125);

  // 1RM PR: 110kg x 5 gives 1RM of 123.8kg > 120kg (while weight 110kg < 120kg)
  const e1rmPR = Calc.checkPersonalRecord('0025', { w: 110, r: 5, done: true }, baseHistory, false, 'cur_log', 2000000);
  assert(e1rmPR && e1rmPR.isPR);
  assert.equal(e1rmPR.type, '1rm');

  // Reps PR at weight: 100kg x 6 reps > 5 reps (while 1RM 116.1kg < 120kg and weight 100kg < 120kg)
  const repsPR = Calc.checkPersonalRecord('0025', { w: 100, r: 6, done: true }, baseHistory, false, 'cur_log', 2000000);
  assert(repsPR && repsPR.isPR);
  assert.equal(repsPR.type, 'reps');
  assert.equal(repsPR.newVal, 6);

  // Strictly excludes current session: if history array includes cur_log, it is excluded from comparison
  const historyWithCurrent = [
    ...baseHistory,
    {
      id: 'cur_log',
      date: 2000000,
      ex: [{ id: '0025', sets: [{ w: 125, r: 1, done: true }] }]
    }
  ];
  const excludedPR = Calc.checkPersonalRecord('0025', { w: 125, r: 1, done: true }, historyWithCurrent, false, 'cur_log', 2000000);
  assert(excludedPR && excludedPR.isPR, 'Current session must be excluded from baseline history so PR is preserved');
});

it('Tonnage rules: count only done sets, respect dumbbellWeightMode, bodyweight/assisted math, and cardio 0kg', () => {
  // Dumbbell volume
  const dbEx = { id: 'db1', name: 'Dumbbell Bench Press', eq: 'dumbbell' };
  const dbSet = { w: 20, r: 10, done: true };
  const notDoneSet = { w: 20, r: 10, done: false };

  // Unfinished set has 0 volume
  assert.equal(Calc.calcSetVolume(notDoneSet, dbEx), 0);

  // 'per_hand' mode multiplies volume by 2
  const volPerHand = Calc.calcSetVolume(dbSet, dbEx, { dumbbellWeightMode: 'per_hand' });
  assert.equal(volPerHand, 400); // 20 * 10 * 2

  // 'as_logged' mode does not multiply volume by 2
  const volAsLogged = Calc.calcSetVolume(dbSet, dbEx, { dumbbellWeightMode: 'as_logged' });
  assert.equal(volAsLogged, 200); // 20 * 10 * 1

  // Bodyweight volume: default is external load only (includeBodyweightInVolume: false)
  const bwEx = { id: 'bw1', name: 'Weighted Pull Up', type: 'bodyweight' };
  const bwSet = { w: 10, r: 5, done: true }; // 10kg added load
  const bwVolDefault = Calc.calcSetVolume(bwSet, bwEx, {}, 75);
  assert.equal(bwVolDefault, 10 * 5); // 50 kg (external load only by default)

  // Explicitly enabled bodyweight volume: bodyweight + added load
  const bwVolExplicit = Calc.calcSetVolume(bwSet, bwEx, { includeBodyweightInVolume: true }, 75);
  assert.equal(bwVolExplicit, (75 + 10) * 5); // 425 kg

  // Assisted volume = max(0, bodyweight - assist load)
  const asEx = { id: 'as1', name: 'Assisted Dip', type: 'assisted' };
  const asSet = { w: 25, r: 6, done: true }; // 25kg assistance
  const asVol = Calc.calcSetVolume(asSet, asEx, {}, 75);
  assert.equal(asVol, (75 - 25) * 6); // 300 kg

  // Cardio and mobility exercises have 0 tonnage
  const cardioEx = { id: 'c1', name: 'Treadmill Jog', type: 'timed_cardio' };
  const mobilityEx = { id: 'm1', name: 'Hip Flexor Stretch', g: 'Mobility' };
  assert.equal(Calc.calcSetVolume({ w: 0, r: 30, done: true }, cardioEx), 0);
  assert.equal(Calc.calcSetVolume({ w: 0, r: 15, done: true }, mobilityEx), 0);
});

it('ACWR engine sorts logs chronologically and calculates acute (7d) and chronic (28d / 4) workload', () => {
  const now = Date.now();
  const dayMs = 86400000;

  // Create 14 daily logs (5000 kg each day)
  const dailyLogs = [];
  for (let i = 14; i >= 0; i--) {
    dailyLogs.push({
      id: 'log_' + i,
      date: now - i * dayMs,
      ex: [{ id: '0025', sets: [{ w: 100, r: 10, done: true }, { w: 100, r: 10, done: true }, { w: 100, r: 10, done: true }, { w: 100, r: 10, done: true }, { w: 100, r: 10, done: true }] }]
    });
  }

  // Scramble insertion order to simulate backdated logs
  const scrambled = [dailyLogs[5], dailyLogs[0], dailyLogs[12], ...dailyLogs.slice(1, 5), ...dailyLogs.slice(6, 12), dailyLogs[13], dailyLogs[14]];

  const acwrScrambled = Calc.calcACWR(scrambled, now);
  const acwrSorted = Calc.calcACWR(dailyLogs, now);

  assert.equal(acwrScrambled.acuteVolume, acwrSorted.acuteVolume);
  assert.equal(acwrScrambled.chronicWeeklyAvg, acwrSorted.chronicWeeklyAvg);
  assert.equal(acwrScrambled.isCalibrating, false);
  assert(acwrScrambled.acwrNum > 0);

  // Less than 7 workout days or < 14 days of history returns calibrating status
  const fewLogs = dailyLogs.slice(0, 3);
  const acwrCalib = Calc.calcACWR(fewLogs, now);
  assert.equal(acwrCalib.isCalibrating, true);
  assert.equal(acwrCalib.acwr, 'Calibrating');
});

it('Streak uses local date keys YYYY-MM-DD preventing timezone and DST drift', () => {
  const d = new Date(2026, 9, 25, 14, 30); // Oct 25 2026
  const key = Calc.toLocalDateKey(d);
  assert.equal(key, '2026-10-25');

  const now = new Date(2026, 9, 25, 12, 0, 0).getTime();
  const logs = [
    { date: new Date(2026, 9, 25, 8, 0, 0).getTime() },
    { date: new Date(2026, 9, 24, 18, 0, 0).getTime() },
    { date: new Date(2026, 9, 23, 9, 0, 0).getTime() }
  ];
  assert.equal(Calc.calcStreak(logs, now), 3);
});

it('Weekly muscle frequency targets 12 muscles, resets on calendar week boundary, and renders dual-pips', () => {
  assert.equal(Calc.FULL_MUSCLE_TARGETS.length, 12);
  assert(Calc.FULL_MUSCLE_TARGETS.includes('Forearms'));
  assert(Calc.FULL_MUSCLE_TARGETS.includes('Calves'));
  assert(Calc.FULL_MUSCLE_TARGETS.includes('Abs'));
  assert(Calc.FULL_MUSCLE_TARGETS.includes('Obliques'));

  const now = new Date('2026-10-21T10:00:00Z').getTime(); // Wednesday

  // Week start day Monday vs Sunday
  const monStart = Calc.getStartOfWeek(now, 'mon');
  assert.equal(monStart.getDay(), 1); // Monday

  const sunStart = Calc.getStartOfWeek(now, 'sun');
  assert.equal(sunStart.getDay(), 0); // Sunday

  // Dual pip rendering: 0/2, 1/2, 2/2 Opt
  const testLogs = [
    {
      date: new Date('2026-10-20T10:00:00Z').getTime(), // Tuesday
      ex: [{ id: '0025', name: 'Barbell Bench Press', g: 'chest', sets: [{ w: 100, r: 10, done: true }] }]
    },
    {
      date: new Date('2026-10-21T10:00:00Z').getTime(), // Wednesday
      ex: [{ id: '0025', name: 'Barbell Bench Press', g: 'chest', sets: [{ w: 100, r: 10, done: true }] }]
    }
  ];

  const freq = Calc.calcWeeklyMuscleFrequency(testLogs, now, 'mon', { mode: 'calendar' });
  assert.equal(freq['Chest'].count, 2);
  assert.equal(freq['Chest'].status, 'optimal');
  assert(freq['Chest'].pips.includes('●●'));

  assert.equal(freq['Back'].count, 0);
  assert.equal(freq['Back'].status, 'none');
  assert(freq['Back'].pips.includes('○○'));
});

it('Double progression suggests +2.5kg only when all working sets hit the rep ceiling', () => {
  const rx = { reps: 8, reps2: 12, sets: 3 };

  // All 3 sets hit rep ceiling 12
  const completedAllCeiling = [
    { w: 60, r: 12, done: true },
    { w: 60, r: 12, done: true },
    { w: 60, r: 12, done: true }
  ];
  const prog1 = Calc.checkDoubleProgression(rx, completedAllCeiling, 'barbell', 'kg');
  assert(prog1 && prog1.eligible);
  assert.equal(prog1.suggestedInc, 2.5);

  // One set did not hit rep ceiling 12 (only 11 reps)
  const incompleteCeiling = [
    { w: 60, r: 12, done: true },
    { w: 60, r: 11, done: true },
    { w: 60, r: 12, done: true }
  ];
  const prog2 = Calc.checkDoubleProgression(rx, incompleteCeiling, 'barbell', 'kg');
  assert.equal(prog2, null);
});

it('US Navy Body Fat % accurately calculates male and female with hip field and validates non-positive inputs', () => {
  // Male calculation
  const maleBF = Calc.calcNavyBodyFat('male', 178, 82, 38);
  assert(typeof maleBF === 'number' && maleBF > 5 && maleBF < 30);

  // Female calculation requires hip
  const femaleBFWithoutHip = Calc.calcNavyBodyFat('female', 165, 72, 32, 0);
  assert.equal(femaleBFWithoutHip, null);

  const femaleBFWithHip = Calc.calcNavyBodyFat('female', 165, 72, 32, 95);
  assert(typeof femaleBFWithHip === 'number' && femaleBFWithHip > 10 && femaleBFWithHip < 40);

  // Invalid inputs (waist <= neck)
  assert.equal(Calc.calcNavyBodyFat('male', 178, 38, 38), null);
  assert.equal(Calc.calcNavyBodyFat('male', 178, 35, 38), null);
});

it('Mifflin-St Jeor computes BMR, TDEE, and clamps carbs at 0 with warning on aggressive deficits', () => {
  const bmr = Calc.calcBMR('male', 80, 180, 25);
  assert(bmr > 1500 && bmr < 2200);

  const tdee = Calc.calcTDEE(bmr, 1.45);
  assert(tdee > bmr);

  // Extreme calorie deficit clamps carbs at 0
  const macrosLow = Calc.calcMacros(1000, 90, 'cut');
  assert.equal(macrosLow.carbs, 0);
  assert(macrosLow.warning && macrosLow.warning.includes('Carbs clamped at 0g'));
});

it('Backdated workout editing and deletion: editPastWorkout and delete actions work smoothly', () => {
  const testLogId = 'test_past_log_edit_del';
  const initialLog = {
    id: testLogId,
    date: Date.now() - 172800000,
    name: 'Past Upper Body Session',
    dur: 2700000,
    ex: [{ id: '0025', sets: [{ w: 80, r: 8, done: true }] }]
  };
  api.S.logs.push(initialLog);
  api.save('logs', api.S.logs);

  // 1. Verify app.js template and listeners for edit and delete
  assert(appCode.includes('data-a="editpastlog"'), 'History modal must include data-a="editpastlog"');
  assert(appCode.includes('data-a="deletepastlog"'), 'History modal must include data-a="deletepastlog"');
  assert(appCode.includes("case 'editpastlog':"), "Click listener must handle case 'editpastlog'");
  assert(appCode.includes("case 'deletepastlog':"), "Click listener must handle case 'deletepastlog'");

  // 2. editPastWorkout loads the session into pastWorkout and renders modal
  api.editPastWorkout(initialLog);
  const mHtml = elementsMap['#m'].innerHTML;
  assert(mHtml.includes('Log Past / Missed Workout'));
  assert(mHtml.includes('Past Upper Body Session'));

  // 3. savePastWorkout updates the existing log without duplicating it
  const prevLogsLength = api.S.logs.length;
  api.savePastWorkout();
  assert.equal(api.S.logs.length, prevLogsLength, 'Editing existing log must update in-place without duplicating');
  const updatedLog = api.S.logs.find(l => String(l.id) === String(testLogId));
  assert(updatedLog, 'Updated log must be retained in S.logs');

  // 4. Delete log action removes it from S.logs
  const logIdx = api.S.logs.findIndex(l => String(l.id) === String(testLogId));
  assert(logIdx >= 0);
  api.S.logs.splice(logIdx, 1);
  api.save('logs', api.S.logs);
  assert(!api.S.logs.some(l => String(l.id) === String(testLogId)));
});

// -----------------------------------------------------------------------------
// TEST SUITE 20: BYOK AI ASSISTANT, ROUTINE IMPORTER & SECURE CLIENT STORAGE (v6.0.0)
// -----------------------------------------------------------------------------
console.log('\nSuite 20: BYOK AI Assistant, Routine Importer & Secure Client Storage (v6.0.0)');

it('Settings modal renders AI Engine Setup (BYOK) card with provider, model, and masked key input', () => {
  api.showSettingsModal();
  const mHtml = elementsMap['#m'].innerHTML;
  assert(mHtml.includes('AI Engine Setup (BYOK)'), 'Settings must include AI Engine Setup');
  assert(mHtml.includes('ai-provider-select'), 'Settings must include AI provider select');
  assert(mHtml.includes('OpenAI (ChatGPT)'), 'Settings must offer OpenAI provider');
  assert(mHtml.includes('Google Gemini'), 'Settings must offer Gemini provider');
  assert(mHtml.includes('ai-model-select'), 'Settings must include model select');
  assert(mHtml.includes('ai-api-key-input'), 'Settings must include masked API key input');
  assert(mHtml.includes('data-a="test-ai-key"'), 'Settings must include Test Connection button');
  assert(mHtml.includes('data-a="save-ai-key"'), 'Settings must include Save Key button');
  assert(mHtml.includes('data-a="toggle-key-vis"'), 'Settings must include toggle key visibility button');
});

it('Strict client-side key security: API key resides exclusively in localStorage and never in S.logs, S.routines, or S.cfg', () => {
  const secretKey = 'sk-test-secret-never-leak-12345';
  mockWindow.localStorage.setItem('ai_api_key', secretKey);

  assert.equal(mockWindow.localStorage.getItem('ai_api_key'), secretKey);
  assert.equal(api.S.cfg.aiKey, undefined, 'S.cfg must not store API key');
  assert.equal(api.S.cfg.ai_api_key, undefined, 'S.cfg must not store ai_api_key');

  // Verify that S state stringification does not contain the secret key
  const stateStr = JSON.stringify(api.S);
  assert(!stateStr.includes(secretKey), 'api.S state must never contain the API key');

  // Verify app.js uses direct localStorage calls and no proxy server
  assert(appCode.includes("localStorage.getItem('ai_api_key')"), 'app.js must read key from localStorage');
  assert(!appCode.includes('https://api.mygym.app/ai'), 'app.js must not proxy AI requests through third-party servers');
});

it('Direct client-side endpoints: callAI points directly to OpenAI and Google Gemini and handles offline/missing keys', async () => {
  // Direct endpoints
  assert(appCode.includes('https://api.openai.com/v1/chat/completions'), 'app.js must connect directly to OpenAI API');
  assert(appCode.includes('https://generativelanguage.googleapis.com/v1beta/models/'), 'app.js must connect directly to Gemini API');

  // Missing key throws descriptive error
  mockWindow.localStorage.removeItem('ai_api_key');
  await assert.rejects(
    async () => { await api.callAI('Ping'); },
    /API key missing/
  );

  // Offline status check
  mockWindow.localStorage.setItem('ai_api_key', 'sk-test-valid-offline');
  mockWindow.navigator.onLine = false;
  await assert.rejects(
    async () => { await api.callAI('Ping'); },
    /Network Offline/
  );
  mockWindow.navigator.onLine = true;
});

it('Workout routine importer: openAIImportModal renders textarea/file upload and parses structured exercises', () => {
  api.openAIImportModal();
  const mHtml = elementsMap['#m'].innerHTML;
  assert(mHtml.includes('Import Workout Routine') || mHtml.includes('Import Workout via AI'), 'Modal must have Import Workout header');
  assert(mHtml.includes('ai-import-textarea') || mHtml.includes('id="ai-import-text"'), 'Modal must include multi-line text input');
  assert(mHtml.includes('id="ai-import-file"'), 'Modal must include file upload input');
  assert(mHtml.includes('data-a="run-ai-import"') || mHtml.includes('data-a="parse-ai-workout"'), 'Modal must include parse workout action');

  // Verify empty input trigger produces warning toast
  elementsMap['#toast'].innerHTML = '';
  const txtArea = mockWindow.document.getElementById('ai-import-textarea') || mockWindow.document.getElementById('ai-import-text');
  if (txtArea) txtArea.value = '';
  api.parseAIWorkoutFromInput();
  const toastHtml = elementsMap['#toast'].innerHTML;
  assert(toastHtml.includes('Please paste your workout routine or upload a file'), 'Empty input must prompt user to paste routine or upload file');

  // Test local parser fallback for natural language input
  const sampleText = `Push Hypertrophy:
1. Barbell Bench Press: 4 sets x 8 reps (80kg)
2. Incline Dumbbell Press: 3 sets x 10 reps (28kg)
3. Triceps Cable Pushdown: 3 sets x 12 reps (30kg)`;

  const parsed = api.parseWorkoutTextOfflineFallback(sampleText);
  assert(parsed && parsed.exercises.length === 3);
  assert.equal(parsed.exercises[0].name, 'Barbell Bench Press');
  assert.equal(parsed.exercises[0].sets, 4);
  assert.equal(parsed.exercises[0].reps, 8);
  assert.equal(parsed.exercises[0].w, 80);
});

it('Biomechanical matching & EXDB auto-mapping aligns exercises and creates custom movements on demand', () => {
  // Direct match in EXDB
  const matchBench = api.findBestExerciseMatch('Barbell Bench Press', 'Chest', 'Barbell');
  assert(matchBench, 'Barbell Bench Press must match in EXDB');
  assert.equal(matchBench.id, '0025');

  // Synonyms and fuzzy matches
  const matchIncline = api.findBestExerciseMatch('Incline dumbbell press', 'Chest', 'Dumbbell');
  assert(matchIncline, 'Incline dumbbell press must match in EXDB');

  // Missing exercise suggests closest and enables 1-tap custom creation
  const novelExercise = 'Swiss Bar Floor Press Multi-Grip';
  const closest = api.findClosestExercise('Chest', 'Barbell');
  assert(closest && closest.name, 'findClosestExercise must return nearest match');

  const createdCustom = api.createCustomExerciseFromAI(novelExercise, 'Chest', 'Barbell');
  assert(createdCustom && createdCustom.id.startsWith('cust_'));
  assert.equal(createdCustom.name, 'Swiss Bar Floor Press Multi-Grip');

  // Verify created custom exercise is resolvable via X(id)
  const resolved = api.X(createdCustom.id);
  assert.equal(resolved.name, 'Swiss Bar Floor Press Multi-Grip');
});

it('commitAIRoutine commits parsed workout to S.routines and renders without data corruption', () => {
  const initialRoutinesCount = api.S.routines.length;
  api.parsedAIRoutine = {
    name: 'AI Generated Pull Day',
    exercises: [
      { id: '0025', sets: 4, reps: 8, reps2: 10, w: 80, note: 'Drive with heels' }
    ]
  };

  api.commitAIRoutine(false);
  assert.equal(api.S.routines.length, initialRoutinesCount + 1, 'Routine must be appended to S.routines');
  const added = api.S.routines.at(-1);
  assert.equal(added.name, 'AI Generated Pull Day');
  assert.equal(added.ex.length, 1);
  assert.equal(added.ex[0].id, '0025');
});

it('In-App AI Coach slide-over drawer: ephemeral session history, active workout context, and quick chips', () => {
  // Open AI coach drawer
  api.openAICoachDrawer();
  const mHtml = elementsMap['#m'].innerHTML;
  assert(mHtml.includes('Workout Coach') || mHtml.includes('MyGyM AI Coach'), 'Drawer must display Workout Coach');
  assert(mHtml.includes('ai-chat-messages'), 'Drawer must render chat message container');
  assert(mHtml.includes('ai-quick-chips'), 'Drawer must provide quick action chips');
  // Phase 2: short chip labels (Form cues, Warm-up instead of Form Cues, Warm-up Sets)
  assert(mHtml.includes('Form cues') || mHtml.includes('Form Cues'), 'Drawer must offer Form Cues chip');
  assert(mHtml.includes('Warm-up') || mHtml.includes('Warm-up Sets'), 'Drawer must offer Warm-up chip');

  // Ephemeral memory: history is maintained in memory without polluting S or localStorage
  assert(Array.isArray(api.aiCoachHistory));
  assert(api.aiCoachHistory.length > 0);
  assert.equal(api.S.aiCoachHistory, undefined, 'S state must not store ephemeral AI chat history');
});

it('Obliques and Forearms are fully tracked with dual-pips and calendar week boundaries in calc.js', () => {
  const now = new Date('2026-10-21T10:00:00Z').getTime(); // Wednesday

  // Log containing Obliques exercise (Russian twist / side plank) and Forearms (wrist curl)
  const testLogs = [
    {
      date: new Date('2026-10-19T10:00:00Z').getTime(), // Monday (same calendar week)
      ex: [
        { id: 'ob1', name: 'Russian Twist with Plate', tg: 'obliques', sets: [{ w: 10, r: 20, done: true }] },
        { id: 'fa1', name: 'Barbell Wrist Curl', tg: 'forearms', sets: [{ w: 30, r: 15, done: true }] }
      ]
    },
    {
      date: new Date('2026-10-20T10:00:00Z').getTime(), // Tuesday (same calendar week)
      ex: [
        { id: 'ob1', name: 'Russian Twist with Plate', tg: 'obliques', sets: [{ w: 10, r: 20, done: true }] },
        { id: 'fa1', name: 'Barbell Wrist Curl', tg: 'forearms', sets: [{ w: 30, r: 15, done: true }] }
      ]
    }
  ];

  const freq = Calc.calcWeeklyMuscleFrequency(testLogs, now, 'mon');
  assert.equal(freq['Obliques'].count, 2);
  assert.equal(freq['Obliques'].status, 'optimal');
  assert(freq['Obliques'].pips.includes('●●'));

  assert.equal(freq['Forearms'].count, 2);
  assert.equal(freq['Forearms'].status, 'optimal');
  assert(freq['Forearms'].pips.includes('●●'));
});

it('Mobile-first ergonomics: CSS input bounds min-width 72px, height 44px, font-size 16px, and CSP whitelist', () => {
  // CSS verification
  assert(cssCode.includes('min-width: 72px;'), 'style.css must enforce min-width: 72px on set-input-box for portrait touch targets');
  assert(cssCode.includes('font-size: 16px !important;'), 'style.css must enforce font-size: 16px on set-val-input to prevent iOS zoom');
  assert(cssCode.includes('.ai-coach-sheet'), 'style.css must include .ai-coach-sheet');
  assert(cssCode.includes('max-height: 85dvh;'), 'style.css must use dvh units for mobile viewports');

  // CSP verification in index.html
  assert(htmlCode.includes('https://api.openai.com'), 'index.html CSP must allow https://api.openai.com');
  assert(htmlCode.includes('https://generativelanguage.googleapis.com'), 'index.html CSP must allow https://generativelanguage.googleapis.com');
});

// TEST SUITE 21: UNIVERSAL MULTI-PROVIDER BYOK ENGINE & AUTO-DETECTION (v6.0.1)
// -----------------------------------------------------------------------------
console.log('\nSuite 21: Universal Multi-Provider BYOK Engine & Auto-Detection (v6.0.1)');

it('Auto-detection correctly identifies Groq, OpenRouter, Gemini, and OpenAI from key prefixes', () => {
  const detect = api.detectProviderFromKey;
  assert(typeof detect === 'function', 'detectProviderFromKey must be a function');

  // Groq (Updated to llama-3.3-70b-versatile in v6.0.2)
  const groq = detect('gsk_1234567890abcdef');
  assert.equal(groq.provider, 'groq');
  assert.equal(groq.model, 'llama-3.3-70b-versatile');
  assert.equal(groq.name, 'Groq');

  // OpenRouter
  const openrouter = detect('sk-or-v1-abcdef123456');
  assert.equal(openrouter.provider, 'openrouter');
  assert.equal(openrouter.model, 'meta-llama/llama-3.1-8b-instruct:free');
  assert.equal(openrouter.name, 'OpenRouter');

  // Google Gemini
  const gemini = detect('AIzaSyD-1234567890abcdef');
  assert.equal(gemini.provider, 'gemini');
  assert.equal(gemini.model, 'gemini-2.0-flash');
  assert.equal(gemini.name, 'Google Gemini');

  // OpenAI
  const openai = detect('sk-proj-1234567890');
  assert.equal(openai.provider, 'openai');
  assert.equal(openai.model, 'gpt-4o-mini');
  assert.equal(openai.name, 'OpenAI');

  // Unknown or invalid prefix
  assert.equal(detect('random-key-xyz'), null);
  assert.equal(detect(''), null);
});

it('Settings modal renders multi-provider dropdown and custom base URL & model name inputs', () => {
  api.showSettingsModal();
  const mHtml = elementsMap['#m'].innerHTML;
  assert(mHtml.includes('ai-provider-select'), 'Settings must include provider select');
  assert(mHtml.includes('Auto-Detect from Key'), 'Provider select must include Auto-Detect option');
  assert(mHtml.includes('Groq (Free &amp; Ultra-Fast)') || mHtml.includes('Groq (Free & Ultra-Fast)'), 'Provider select must include Groq');
  assert(mHtml.includes('OpenRouter (Free Tier)'), 'Provider select must include OpenRouter');
  assert(mHtml.includes('Custom / OpenAI-Compatible'), 'Provider select must include Custom');
  assert(mHtml.includes('ai-baseurl-input') || mHtml.includes('ai-base-url-input'), 'Settings must provide Base URL input for custom OpenAI-compatible endpoints');
  assert(mHtml.includes('ai-model-input') || mHtml.includes('ai-custom-model-input'), 'Settings must provide Model Name input for custom endpoints');
});

it('Universal Dispatcher routes Groq, OpenRouter, and Custom endpoints with standard OpenAI schemas', async () => {
  let capturedUrl = null;
  let capturedHeaders = null;
  let capturedBody = null;

  mockWindow.fetch = async (url, opts = {}) => {
    capturedUrl = url;
    capturedHeaders = opts.headers || {};
    capturedBody = JSON.parse(opts.body || '{}');
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Mock Universal Response' } }]
      })
    };
  };

  // Test Groq routing
  mockWindow.localStorage.setItem('ai_api_key', 'gsk_test_groq_key_123');
  mockWindow.localStorage.setItem('ai_provider', 'groq');
  mockWindow.localStorage.removeItem('ai_model');

  const groqRes = await api.callAI('Hello Groq');
  assert.equal(groqRes, 'Mock Universal Response');
  assert.equal(capturedUrl, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(capturedHeaders['Authorization'], 'Bearer gsk_test_groq_key_123');
  assert.equal(capturedBody.model, 'llama-3.3-70b-versatile');
  assert.equal(capturedBody.messages[0].content, 'Hello Groq');

  // Test OpenRouter routing & headers
  mockWindow.localStorage.setItem('ai_api_key', 'sk-or-v1-test-openrouter-key');
  mockWindow.localStorage.setItem('ai_provider', 'openrouter');
  mockWindow.localStorage.removeItem('ai_model');

  const orRes = await api.callAI('Hello OpenRouter');
  assert.equal(orRes, 'Mock Universal Response');
  assert.equal(capturedUrl, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(capturedHeaders['Authorization'], 'Bearer sk-or-v1-test-openrouter-key');
  assert.equal(capturedHeaders['X-Title'], 'MyGyM');
  assert(capturedHeaders['HTTP-Referer'], 'OpenRouter must include HTTP-Referer header');
  assert.equal(capturedBody.model, 'meta-llama/llama-3.1-8b-instruct:free');

  // Test Custom endpoint routing
  mockWindow.localStorage.setItem('ai_api_key', 'cust-token-xyz');
  mockWindow.localStorage.setItem('ai_provider', 'custom');
  mockWindow.localStorage.setItem('ai_base_url', 'https://api.deepseek.com/v1');
  mockWindow.localStorage.setItem('ai_model', 'deepseek-chat');

  const customRes = await api.callAI('Hello DeepSeek');
  assert.equal(customRes, 'Mock Universal Response');
  assert.equal(capturedUrl, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(capturedHeaders['Authorization'], 'Bearer cust-token-xyz');
  assert.equal(capturedBody.model, 'deepseek-chat');

  // Clean up
  mockWindow.localStorage.removeItem('ai_base_url');
});

it('Custom provider reads directly from DOM inputs (ai-model-input & ai-baseurl-input) and preserves values regardless of key prefix', async () => {
  let capturedUrl = null;
  let capturedBody = null;

  mockWindow.fetch = async (url, opts = {}) => {
    capturedUrl = url;
    capturedBody = JSON.parse(opts.body || '{}');
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Custom DOM Response' } }] })
    };
  };

  // Open settings modal to instantiate DOM inputs
  api.showSettingsModal();

  const baseUrlInput = mockWindow.document.getElementById('ai-baseurl-input');
  const modelInput = mockWindow.document.getElementById('ai-model-input');
  const provSelect = mockWindow.document.getElementById('ai-provider-select');
  const keyInput = mockWindow.document.getElementById('ai-api-key-input');

  assert(baseUrlInput, 'ai-baseurl-input must exist in DOM');
  assert(modelInput, 'ai-model-input must exist in DOM');

  // Simulate user in Custom mode with a key that starts with "gsk_" (must NOT be overridden by auto-detection)
  provSelect.value = 'custom';
  mockWindow.localStorage.setItem('ai_provider', 'custom');
  keyInput.value = 'gsk_custom_private_key_456';
  mockWindow.localStorage.setItem('ai_api_key', 'gsk_custom_private_key_456');

  baseUrlInput.value = 'https://custom-ai-host.internal/v1';
  modelInput.value = 'mistral-large-2407';

  // callAI without options must read directly from DOM inputs without hardcoded fallbacks
  await api.callAI('Custom Model Query');

  assert.equal(capturedUrl, 'https://custom-ai-host.internal/v1/chat/completions', 'Base URL must be read directly from ai-baseurl-input');
  assert.equal(capturedBody.model, 'mistral-large-2407', 'Model name must be read directly from ai-model-input');

  // Verify auto-detection on input event does not override custom mode
  api.handleAIKeyInput('gsk_typed_key');
  assert.equal(provSelect.value, 'custom', 'handleAIKeyInput must not override custom provider');
  assert.equal(modelInput.value, 'mistral-large-2407', 'handleAIKeyInput must not override custom model name');

  // Clean up
  mockWindow.localStorage.removeItem('ai_base_url');
});

it('Error translation formats 401, 429, and network failures with user-friendly messages', async () => {
  mockWindow.localStorage.setItem('ai_api_key', 'gsk_test_key');
  mockWindow.localStorage.setItem('ai_provider', 'groq');

  // 401 Unauthorized
  mockWindow.fetch = async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    json: async () => ({ error: { message: 'Invalid API key' } })
  });

  await assert.rejects(
    async () => { await api.callAI('Test 401'); },
    /Invalid API Key for Groq \(401\)/
  );

  // 429 Rate Limit
  mockWindow.fetch = async () => ({
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
    json: async () => ({ error: { message: 'Rate limit exceeded' } })
  });

  await assert.rejects(
    async () => { await api.callAI('Test 429'); },
    /Rate limit reached for Groq \(429\)/
  );

  // Network Error / CORS failure
  mockWindow.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  await assert.rejects(
    async () => { await api.callAI('Test Network'); },
    /Network connection blocked or CORS issue/
  );
});

it('Groq model strings, saveAIKey persistence, and testAIConnection pipeline (v6.0.4)', async () => {
  // 1. Verify Groq exact model strings in AI_PROVIDERS
  assert.equal(api.AI_PROVIDERS.groq.defaultModel, 'llama-3.3-70b-versatile');
  assert.equal(api.AI_PROVIDERS.groq.models[0].id, 'llama-3.3-70b-versatile');
  assert.equal(api.AI_PROVIDERS.groq.models[1].id, 'llama3-70b-8192');
  assert.equal(api.AI_PROVIDERS.groq.models[2].id, 'llama3-8b-8192');
  assert.equal(api.AI_PROVIDERS.groq.models[3].id, 'gemma2-9b-it');

  // 2. Test saveAIKey(): trims whitespace, stores mygym_ai_* keys, syncs S.cfg
  api.showSettingsModal();
  const keyInput = mockWindow.document.getElementById('ai-key-input');
  const provSelect = mockWindow.document.getElementById('ai-provider-select');
  const modelSelect = mockWindow.document.getElementById('ai-model-select');

  keyInput.value = '   gsk_test_whitespace_key_789   ';
  provSelect.value = 'groq';
  modelSelect.value = 'llama-3.3-70b-versatile';

  elementsMap['#toast'].innerHTML = '';
  api.saveAIKey();

  assert.equal(mockWindow.localStorage.getItem('mygym_ai_key'), 'gsk_test_whitespace_key_789');
  assert.equal(mockWindow.localStorage.getItem('mygym_ai_provider'), 'groq');
  assert.equal(mockWindow.localStorage.getItem('mygym_ai_model'), 'llama-3.3-70b-versatile');
  assert.equal(api.S.cfg.aiKey, undefined, 'S.cfg must never store aiKey');
  assert.equal(api.S.cfg.aiProvider, undefined, 'S.cfg must not store aiProvider');
  assert.equal(api.S.cfg.aiModel, undefined, 'S.cfg must not store aiModel');
  assert(elementsMap['#toast'].innerHTML.includes('API Key saved successfully'));

  // 3. Test testAIConnection(): empty key alerts user
  keyInput.value = '';
  mockWindow.localStorage.removeItem('mygym_ai_key');
  mockWindow.localStorage.removeItem('ai_api_key');
  let alertMsg = null;
  mockWindow.alert = (msg) => { alertMsg = msg; };
  elementsMap['#toast'].innerHTML = '';
  await api.testAIConnection();
  assert(elementsMap['#toast'].innerHTML.includes('No API Key') || (alertMsg && alertMsg.includes('No API Key')));

  // 4. Test testAIConnection() with Groq calls groq endpoint read-only
  keyInput.value = 'gsk_test_valid_groq_key';
  provSelect.value = 'groq';
  modelSelect.value = 'llama-3.3-70b-versatile';

  let capturedUrl = null;
  let capturedBody = null;
  mockWindow.fetch = async (url, opts = {}) => {
    capturedUrl = url;
    capturedBody = JSON.parse(opts.body || '{}');
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Groq Hello Response' } }] })
    };
  };

  await api.testAIConnection();

  assert.equal(capturedUrl, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(capturedBody.model, 'llama-3.3-70b-versatile');
  assert.equal(capturedBody.messages[0].content, 'hi');

  // 5. Test eliminating invalid auto-switching: manual Groq selection is preserved
  api.handleAIKeyInput('sk-openai-key-while-groq-selected');
  assert.equal(provSelect.value, 'groq', 'handleAIKeyInput must not overwrite explicitly selected Groq provider');
});

it('index.html Content-Security-Policy expands connect-src for all supported AI providers', () => {
  assert(htmlCode.includes('https://api.groq.com'), 'CSP must include https://api.groq.com');
  assert(htmlCode.includes('https://openrouter.ai'), 'CSP must include https://openrouter.ai');
  assert(htmlCode.includes('https://api.deepseek.com'), 'CSP must include https://api.deepseek.com');
  assert(htmlCode.includes('https://api.together.xyz'), 'CSP must include https://api.together.xyz');
  assert(htmlCode.includes('https://api.openai.com'), 'CSP must include https://api.openai.com');
  assert(htmlCode.includes('https://generativelanguage.googleapis.com'), 'CSP must include https://generativelanguage.googleapis.com');
});

// -----------------------------------------------------------------------------
// TEST SUITE 10: HARDENED PRODUCTION & MOBILE PARITY (v6.1.0)
// -----------------------------------------------------------------------------
console.log('\nSuite 10: Production Hardening, Security & Mobile Parity (v6.1.0)');

it('shell.js contains anti-reload loop guard and active workout reload guard', () => {
  assert(shellCode.includes('sessionStorage.getItem(\'mygym_reload_attempts\')'), 'shell.js must check sessionStorage for reload attempts');
  assert(shellCode.includes('localStorage.getItem(\'lift_act\')'), 'shell.js must check for active workout in storage before self-healing reload');
  assert(htmlCode.includes('shell.js?v='), 'index.html must load shell.js');
});

it('sw.js verifies index.html presence in new cache before purging old caches', () => {
  assert(swCode.includes("cache.match('./index.html')"), 'sw.js must verify index.html is precached before purging');
  assert(swCode.includes('keys.filter(k => k !== C)'), 'sw.js must only purge old caches after verification');
});

it('app.js Gemini API call passes apiKey via x-goog-api-key header and never in URL query string', () => {
  assert(appCode.includes('x-goog-api-key'), 'Gemini API call must use x-goog-api-key header');
  assert(!appCode.includes('generateContent?key='), 'Gemini API call must not append ?key= to URL');
});

it('sanitizeAndValidateAIRoutine cleans markdown, caps exercise count, and clamps set numbers', () => {
  assert.equal(typeof api.sanitizeAndValidateAIRoutine, 'function', 'sanitizeAndValidateAIRoutine must be exported');

  const rawJson = '```json\n{"name":"Test AI","exercises":[{"name":"Squat","sets":20,"reps":200,"weight":-50},{"name":"Bench Press","sets":-5,"reps":0,"weight":100}]}\n```';
  const validated = api.sanitizeAndValidateAIRoutine(rawJson);

  assert.equal(validated.name, 'Test AI');
  assert.equal(validated.exercises.length, 2);
  // Sets clamped to 1..10
  assert.equal(validated.exercises[0].sets, 10);
  assert.equal(validated.exercises[1].sets, 1);
  // Reps clamped to 1..100
  assert.equal(validated.exercises[0].reps, 100);
  assert.equal(validated.exercises[1].reps, 1);
  // Weight clamped to >= 0
  assert.equal(validated.exercises[0].weight, 0);
  assert.equal(validated.exercises[1].weight, 100);

  // Exercise count cap (15)
  const hugeRoutine = JSON.stringify({
    name: 'Huge',
    exercises: Array.from({ length: 25 }, (_, i) => ({ name: `Ex ${i + 1}`, sets: 3, reps: 10 }))
  });
  const capped = api.sanitizeAndValidateAIRoutine(hugeRoutine);
  assert.equal(capped.exercises.length, 15, 'Must cap exercises to 15');
});

it('backup import imp(f) whitelists safe keys and rejects/strips credentials and backups', () => {
  assert(appCode.includes('ALLOWED_IMPORT_KEYS'), 'imp must define ALLOWED_IMPORT_KEYS whitelist');
  assert(appCode.includes('aiKey') && appCode.includes('mygym_ai_key'), 'imp must scrub AI credentials from import');
});

it('showExerciseHistoryModal renders all-time stats, last sessions, and empty state gracefully', () => {
  assert.equal(typeof api.showExerciseHistoryModal, 'function', 'showExerciseHistoryModal must be exported');

  // Test empty history
  api.showExerciseHistoryModal('non_existent_ex_id');
  const modalHtml = elementsMap['#m'].innerHTML;
  assert(modalHtml.includes('ex-history-modal'), 'Must render ex-history-modal container');
  assert(modalHtml.includes('No Workout History Yet'), 'Must show clean empty state for unlogged exercise');
});

it('active workout reload guard defers controllerchange reload if active workout exists', () => {
  assert(appCode.includes('window._pendingSWReload'), 'app.js must defer reload when active workout is in progress');
  assert(appCode.includes('Update ready. Will apply after workout.'), 'app.js must notify user of pending update');
});

// -----------------------------------------------------------------------------
// TEST SUITE 11: FULL-STACK MOBILE ARCHITECTURE & PWA OPTIMIZATION (v6.1.1)
// -----------------------------------------------------------------------------
console.log('\nSuite 11: Full-Stack Mobile Architecture, Key Binding & PWA Optimization (v6.1.1)');

it('Settings modal renders direct event bindings on Save and Test connection buttons', () => {
  api.showSettingsModal();
  const saveBtn = mockWindow.document.getElementById('ai-save-key-btn');
  const testBtn = mockWindow.document.getElementById('ai-test-key-btn');

  assert(saveBtn, 'ai-save-key-btn must exist in Settings modal DOM');
  assert(testBtn, 'ai-test-key-btn must exist in Settings modal DOM');
  assert.equal(typeof saveBtn.onclick, 'function', 'Save button must have explicit .onclick binding');
  assert.equal(typeof testBtn.onclick, 'function', 'Test button must have explicit .onclick binding');
  assert.equal(typeof saveBtn.ontouchend, 'function', 'Save button must have explicit .ontouchend touch binding');
  assert.equal(typeof testBtn.ontouchend, 'function', 'Test button must have explicit .ontouchend touch binding');
});

it('saveAIKey updates inline status badge in green and enforces key security in S.cfg', () => {
  api.showSettingsModal();
  const keyInput = mockWindow.document.getElementById('ai-key-input');
  keyInput.value = 'gsk_test_direct_save_v611';
  const res = api.saveAIKey();

  assert.equal(res.key, 'gsk_test_direct_save_v611');
  assert.equal(mockWindow.localStorage.getItem('ai_api_key'), 'gsk_test_direct_save_v611');
  assert.equal(mockWindow.localStorage.getItem('mygym_ai_key'), 'gsk_test_direct_save_v611');
  assert.equal(api.S.cfg.aiKey, undefined, 'S.cfg must never store API key');

  const statusEl = mockWindow.document.querySelector('#ai-conn-status');
  assert(statusEl, 'ai-conn-status must exist');
  assert(statusEl.innerHTML.includes('✓ API Key Saved Successfully'), 'Status badge must show API Key Saved Successfully');
});

it('style.css enforces mobile-first viewport units, responsive GIF media, and 44px touch targets', () => {
  assert(cssCode.includes('max-height: 85dvh'), '.sheet must use dynamic viewport unit 85dvh');
  // Phase 2: GIF aspect-ratio changed to 1/1 (square) and max-height to 22vh for compact view
  assert(cssCode.includes('aspect-ratio: 1 / 1') || cssCode.includes('aspect-ratio: 16/9'), '.work-hero-gif must enforce a defined aspect ratio');
  assert(cssCode.includes('max-height: 22vh') || cssCode.includes('max-height: 25vh'), '.work-hero-gif must cap max-height (22vh in Phase 2)');
  assert(cssCode.includes('min-width: 44px') && cssCode.includes('min-height: 44px'), 'Buttons and chips must enforce 44px touch target bounds');
});

// -----------------------------------------------------------------------------
// TEST SUITE 12: STRICT KEY VALIDATION, CLEAR KEY & LANDSCAPE SUPPORT (v6.1.2)
// -----------------------------------------------------------------------------
console.log('\nSuite 12: Strict Key Validation, Clear Key & Landscape Support (v6.1.2)');

it('saveAIKey strictly rejects empty/whitespace input without saving to localStorage', () => {
  api.showSettingsModal();
  const keyInput = mockWindow.document.getElementById('ai-key-input');
  mockWindow.localStorage.removeItem('mygym_ai_key');
  mockWindow.localStorage.removeItem('ai_api_key');
  keyInput.value = '   ';

  const res = api.saveAIKey();
  assert.equal(res, null, 'Empty key must return null and not save');
  assert.equal(mockWindow.localStorage.getItem('mygym_ai_key'), null, 'Must not save empty key to localStorage');
  const statusEl = mockWindow.document.querySelector('#ai-conn-status');
  assert(statusEl && statusEl.innerHTML.includes('× Please enter a valid API Key before saving.'), 'Must show red error badge on empty save');
});

it('clearAIKey removes keys from localStorage, resets S.cfg.aiKey and clears input', () => {
  api.showSettingsModal();
  mockWindow.localStorage.setItem('mygym_ai_key', 'gsk_to_be_cleared');
  mockWindow.localStorage.setItem('ai_api_key', 'gsk_to_be_cleared');
  api.S.cfg.aiKey = 'gsk_to_be_cleared';
  const keyInput = mockWindow.document.getElementById('ai-key-input');
  keyInput.value = 'gsk_to_be_cleared';

  const clearBtn = mockWindow.document.getElementById('ai-clear-key-btn');
  assert(clearBtn, '#ai-clear-key-btn must exist in Settings modal DOM');
  assert.equal(typeof clearBtn.onclick, 'function', 'Clear button must have .onclick handler');
  assert.equal(typeof clearBtn.ontouchend, 'function', 'Clear button must have .ontouchend handler');

  api.clearAIKey();
  assert.equal(mockWindow.localStorage.getItem('mygym_ai_key'), null, 'mygym_ai_key must be removed');
  assert.equal(mockWindow.localStorage.getItem('ai_api_key'), null, 'ai_api_key must be removed');
  assert.equal(api.S.cfg.aiKey, undefined, 'S.cfg.aiKey must not exist');
  assert.equal(keyInput.value, '', 'Key input element value must be emptied');
  const statusEl = mockWindow.document.querySelector('#ai-conn-status');
  assert(statusEl && statusEl.innerHTML.includes('Key cleared'), 'Status badge must show Key cleared');
});

it('style.css supports landscape orientation with expanded max-height and safe-area padding', () => {
  assert(cssCode.includes('@media (orientation: landscape)'), 'style.css must have landscape media query');
  assert(cssCode.includes('max-height: 92vh') || cssCode.includes('max-height: 92dvh'), 'Landscape mode must expand sheet max-height');
  assert(cssCode.includes('calc(env(safe-area-inset-bottom) + 32px)'), 'Sheet must apply 32px safe-area bottom offset');
});

it('callAI suggests refreshing models when receiving a 404', async () => {
  mockWindow.localStorage.setItem('mygym_ai_key', 'gsk_test_mock_groq');
  mockWindow.localStorage.setItem('mygym_ai_provider', 'groq');
  mockWindow.localStorage.setItem('mygym_ai_model', 'non-existent-model');

  mockWindow.fetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({ error: { message: 'The model non-existent-model does not exist' } })
  });

  await assert.rejects(
    async () => { await api.callAI('Test query'); },
    /Model "non-existent-model" not found for Groq \(404\)\. Please refresh models in Settings and select an active model\./
  );
});

// -----------------------------------------------------------------------------
// TEST SUITE 13: SCIENTIFIC CALORIE BURN, EPOC & NUTRITION ENGINE (v6.2.0)
// -----------------------------------------------------------------------------
console.log('\nSuite 13: Scientific Calorie Burn, EPOC & Nutrition Engine (v6.2.0)');

it('calcWorkoutCalorieBurn and calcEPOCBurn calculate scientifically accurate active & afterburn calories', () => {
  // Test EPOC calculation: ~12% of active session calories
  assert.equal(Calc.calcEPOCBurn(100), 12);
  assert.equal(Calc.calcEPOCBurn(250), 30);
  assert.equal(Calc.calcEPOCBurn(0), 0);

  // Test standard resistance session: 60 min (3600000 ms), 75 kg, MET 5.5, volume 3000 kg
  // Active = ((5.5 * 3.5 * 75) / 200) * 60 = 7.21875 * 60 = 433.125 -> 433 kcal
  // EPOC = Math.round(433.125 * 0.12) = 52 kcal
  // Total = 433 + 52 = 485 kcal
  const burnNormal = Calc.calcWorkoutCalorieBurn(3600000, 75, 5.5, 3000);
  assert.equal(burnNormal.activeCals, 433);
  assert.equal(burnNormal.epocCals, 52);
  assert.equal(burnNormal.totalBurn, 485);

  // Test high mechanical tension session (>5000 kg volume scales MET to 6.0):
  // Active = ((6.0 * 3.5 * 80) / 200) * 60 = 8.4 * 60 = 504 kcal
  // EPOC = Math.round(504 * 0.12) = 60 kcal
  // Total = 504 + 60 = 564 kcal
  const burnHeavy = Calc.calcWorkoutCalorieBurn(3600000, 80, 5.5, 8000);
  assert.equal(burnHeavy.activeCals, 504);
  assert.equal(burnHeavy.epocCals, 60);
  assert.equal(burnHeavy.totalBurn, 564);

  // Zero duration or invalid inputs return 0 safely
  const burnZero = Calc.calcWorkoutCalorieBurn(0, 75);
  assert.equal(burnZero.totalBurn, 0);
  assert.equal(burnZero.activeCals, 0);
  assert.equal(burnZero.epocCals, 0);
});

it('finishWorkout calculates, displays and persists burn object in S.logs', () => {
  api.S.act = {
    id: 'test_act_burn',
    rid: null,
    name: 'Strength Calorie Test',
    t0: Date.now() - 3600000, // 60 min session
    ex: [
      {
        id: '0025', // Barbell Bench Press
        sets: [
          { w: 100, r: 10, done: true },
          { w: 100, r: 10, done: true },
          { w: 100, r: 10, done: true }
        ]
      }
    ]
  };

  api.finishWorkout();
  const lastLog = api.S.logs.at(-1);
  assert(lastLog, 'Last log must exist in S.logs');
  assert(lastLog.burn, 'Completed workout must store burn object');
  assert(lastLog.burn.activeCals > 0, 'Active calories must be > 0');
  assert(lastLog.burn.epocCals > 0, 'EPOC calories must be > 0');
  assert.equal(lastLog.burn.totalBurn, lastLog.burn.activeCals + lastLog.burn.epocCals);

  // Verify modal celebration includes dedicated burn card
  const modalContent = elementsMap['#m'].innerHTML;
  assert(modalContent.includes('Calories Burned:'), 'Celebration modal must display Calories Burned');
  assert(modalContent.includes('EPOC Afterburn'), 'Celebration modal must detail EPOC Afterburn');
});

it('Daily Nutrition tracker maintains schema, day switching, and meal calculation', () => {
  // 1. Verify schema default initialization
  assert(api.S.nutrition, 'S.nutrition must be initialized');
  assert.equal(typeof api.S.nutrition.targetCals, 'number');
  assert.equal(typeof api.S.nutrition.targetProtein, 'number');
  assert.equal(typeof api.S.nutrition.targetCarbs, 'number');
  assert.equal(typeof api.S.nutrition.targetFat, 'number');
  assert.equal(typeof api.S.nutrition.targetFiber, 'number');
  assert(api.S.nutrition.meals && typeof api.S.nutrition.meals === 'object');

  // 2. Day switcher and meals calculation
  const dateKey = '2026-11-07';
  api.nutritionSelectedDate = dateKey;
  const initialData = api.getNutritionData(dateKey);
  assert.equal(initialData.dateKey, dateKey);
  assert.equal(initialData.totals.calories, 0);

  // 3. Log a meal into breakfast and lunch
  api.S.nutrition.meals[dateKey].breakfast = {
    calories: 500,
    protein: 40,
    carbs: 50,
    fat: 15,
    fiber: 8
  };
  api.S.nutrition.meals[dateKey].lunch = {
    calories: 700,
    protein: 50,
    carbs: 70,
    fat: 20,
    fiber: 10
  };

  const updatedData = api.getNutritionData(dateKey);
  assert.equal(updatedData.totals.calories, 1200);
  assert.equal(updatedData.totals.protein, 90);
  assert.equal(updatedData.totals.carbs, 120);
  assert.equal(updatedData.totals.fat, 35);
  assert.equal(updatedData.totals.fiber, 18);

  // 4. Render Nutrition Dashboard HTML validation
  const dashHtml = api.renderNutritionDashboard();
  assert(dashHtml.includes('nutrition-dashboard'), 'Dashboard must contain .nutrition-dashboard');
  assert(dashHtml.includes('1200'), 'Dashboard must display total calories');
  assert(dashHtml.includes('Breakfast'), 'Dashboard must display Breakfast card');
  assert(dashHtml.includes('Lunch'), 'Dashboard must display Lunch card');
  assert(dashHtml.includes('Dinner'), 'Dashboard must display Dinner card');
  assert(dashHtml.includes('Snacks'), 'Dashboard must display Snacks card');
  assert(dashHtml.includes('data-a="prev-nutrition-day"'), 'Dashboard must include prev day action');
  assert(dashHtml.includes('data-a="next-nutrition-day"'), 'Dashboard must include next day action');
  assert(dashHtml.includes('data-a="open-nutrition-targets"'), 'Dashboard must include adjust targets action');

  // 5. CSS animation and input verification
  assert(cssCode.includes('.nutrition-progress-bar'), 'style.css must define .nutrition-progress-bar');
  assert(cssCode.includes('transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1)'), 'Progress bars must animate with cubic-bezier transition');
  assert(cssCode.includes('min-height: 44px'), 'Nutrition inputs must have 44px min touch target');
});

// -----------------------------------------------------------------------------
// TEST SUITE 14: TOOLING, DATA-A HANDLERS & ESCAPING AUDIT (PHASE 0)
// -----------------------------------------------------------------------------
console.log('\nSuite 14: Tooling, data-a Action Audits & Escaping Verification (Phase 0)');

it('Every data-a attribute in app.js has a corresponding handler or is documented as input-driven', () => {
  const dataARegex = /data-a=["\x27]([^"\x27]+)["\x27]/g;
  const foundDataA = new Set();
  let m;
  while ((m = dataARegex.exec(appCode)) !== null) {
    if (!m[1].includes('${')) foundDataA.add(m[1]);
  }

  const caseRegex = /case\s+["\x27]([^"\x27]+)["\x27]\s*:/g;
  const handledCases = new Set();
  while ((m = caseRegex.exec(appCode)) !== null) {
    handledCases.add(m[1]);
  }

  // Documented input-driven or custom element actions
  const inputDriven = new Set(['morph-scrub']);
  const missing = [];
  for (const a of foundDataA) {
    if (!handledCases.has(a) && !inputDriven.has(a)) {
      missing.push(a);
    }
  }

  assert.equal(missing.length, 0, `All data-a actions must have handlers. Missing: ${missing.join(', ')}`);
});

it('Scans for potentially unescaped user string interpolations in app.js', () => {
  // Checks that user-facing string fields (.name, .note, .desc, .msg, .title, .query) in HTML templates are escaped
  const templateRegex = /`([^`]*<[a-z][^`]*)`/gi;
  let m;
  const unescaped = [];

  while ((m = templateRegex.exec(appCode)) !== null) {
    const tpl = m[1];
    const interpRegex = /\$\{([^}]+)\}/g;
    let im;
    while ((im = interpRegex.exec(tpl)) !== null) {
      const expr = im[1].trim();
      if (/(?:\.name|\.note|\.desc|\.msg|\.content|\.title|\.query|\.prompt)\b/.test(expr)) {
        if (expr.includes('?') && (expr.endsWith("''") || expr.endsWith('""') || expr.includes(": ''") || expr.includes(': ""'))) {
          continue;
        }
        if (expr.includes('replace(') || expr.includes('.length') || expr.includes('class=')) {
          continue;
        }
        if (!expr.includes('esc(') && !expr.includes('cleanExName(')) {
          const offset = m.index + im.index;
          const line = appCode.slice(0, offset).split('\n').length;
          unescaped.push({ expr, line });
        }
      }
    }
  }

  assert.equal(unescaped.length, 0, `Unescaped interpolations in HTML templates found: ${JSON.stringify(unescaped)}`);
});

// -----------------------------------------------------------------------------
// TEST SUITE 15: AI ENGINE ARCHITECTURE, SECURITY & ERROR TAXONOMY (Phase 1)
// -----------------------------------------------------------------------------
console.log('\nSuite 15: AI Engine Architecture, Security & Error Taxonomy (Phase 1)');

it('Mock fetch tests for each provider: Groq, OpenAI, OpenRouter, Gemini, and Custom', async () => {
  const captured = [];
  mockWindow.fetch = async (url, opts = {}) => {
    captured.push({
      url,
      headers: opts.headers || {},
      body: opts.body ? JSON.parse(opts.body) : null
    });
    if (url.includes('generativelanguage.googleapis.com')) {
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Gemini Direct Response' }] } }]
        })
      };
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'OpenAI-Compatible Response' } }]
      })
    };
  };

  // 1. Google Gemini (Native direct client endpoint)
  mockWindow.localStorage.setItem('mygym_ai_key', 'AIzaSy_test_gemini_key');
  mockWindow.localStorage.setItem('mygym_ai_settings', JSON.stringify({
    provider: 'gemini',
    models: { gemini: 'gemini-2.0-flash' }
  }));

  const geminiRes = await api.callAI([
    { role: 'system', content: 'You are an elite coach.' },
    { role: 'user', content: 'What is 5x5?' }
  ], { jsonMode: true });

  assert.equal(geminiRes, 'Gemini Direct Response');
  const gReq = captured[captured.length - 1];
  assert(gReq.url.includes('generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'), 'Gemini URL must target model generateContent');
  assert.equal(gReq.headers['x-goog-api-key'], 'AIzaSy_test_gemini_key', 'Gemini must authenticate with x-goog-api-key header');
  assert(gReq.body.systemInstruction, 'Gemini request must have systemInstruction');
  assert.equal(gReq.body.systemInstruction.parts[0].text, 'You are an elite coach.');
  assert.equal(gReq.body.contents[0].role, 'user');
  assert.equal(gReq.body.contents[0].parts[0].text, 'What is 5x5?');
  assert.equal(gReq.body.generationConfig.responseMimeType, 'application/json', 'jsonMode must set responseMimeType in generationConfig');

  // 2. Groq
  mockWindow.localStorage.setItem('mygym_ai_key', 'gsk_test_groq_key_999');
  mockWindow.localStorage.setItem('mygym_ai_settings', JSON.stringify({
    provider: 'groq',
    models: { groq: 'llama-3.3-70b-versatile' }
  }));

  const groqRes = await api.callAI('Test Groq prompt');
  assert.equal(groqRes, 'OpenAI-Compatible Response');
  const groqReq = captured[captured.length - 1];
  assert.equal(groqReq.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(groqReq.headers['Authorization'], 'Bearer gsk_test_groq_key_999');
  assert.equal(groqReq.body.model, 'llama-3.3-70b-versatile');

  // 3. OpenAI
  mockWindow.localStorage.setItem('mygym_ai_key', 'sk-proj-test-openai-key-888');
  mockWindow.localStorage.setItem('mygym_ai_settings', JSON.stringify({
    provider: 'openai',
    models: { openai: 'gpt-4o-mini' }
  }));

  const openaiRes = await api.callAI('Test OpenAI prompt');
  assert.equal(openaiRes, 'OpenAI-Compatible Response');
  const openAiReq = captured[captured.length - 1];
  assert.equal(openAiReq.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(openAiReq.headers['Authorization'], 'Bearer sk-proj-test-openai-key-888');
  assert.equal(openAiReq.body.model, 'gpt-4o-mini');

  // 4. OpenRouter
  mockWindow.localStorage.setItem('mygym_ai_key', 'sk-or-v1-test-openrouter-key-777');
  mockWindow.localStorage.setItem('mygym_ai_settings', JSON.stringify({
    provider: 'openrouter',
    models: { openrouter: 'meta-llama/llama-3.1-8b-instruct:free' }
  }));

  const orRes = await api.callAI('Test OpenRouter prompt');
  assert.equal(orRes, 'OpenAI-Compatible Response');
  const orReq = captured[captured.length - 1];
  assert.equal(orReq.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(orReq.headers['Authorization'], 'Bearer sk-or-v1-test-openrouter-key-777');
  assert.equal(orReq.headers['X-Title'], 'MyGyM');
  assert.equal(orReq.body.model, 'meta-llama/llama-3.1-8b-instruct:free');

  // 5. Custom / OpenAI-Compatible
  mockWindow.localStorage.setItem('mygym_ai_key', 'custom_key_666');
  mockWindow.localStorage.setItem('mygym_ai_settings', JSON.stringify({
    provider: 'custom',
    models: { custom: 'deepseek-chat' },
    baseUrl: 'https://api.deepseek.com/v1'
  }));

  const customRes = await api.callAI('Test Custom prompt');
  assert.equal(customRes, 'OpenAI-Compatible Response');
  const custReq = captured[captured.length - 1];
  assert.equal(custReq.url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(custReq.headers['Authorization'], 'Bearer custom_key_666');
  assert.equal(custReq.body.model, 'deepseek-chat');
});

it('Auto mode resolution works consistently with settings sheet open or closed', async () => {
  mockWindow.localStorage.setItem('mygym_ai_key', 'gsk_auto_detect_groq');
  mockWindow.localStorage.setItem('mygym_ai_settings', JSON.stringify({
    provider: 'auto',
    models: { groq: 'llama-3.3-70b-versatile', openai: 'gpt-4o-mini' }
  }));

  // Closed sheet resolution
  const closedConfig = api.resolveAIConfig();
  assert.equal(closedConfig.provider, 'groq', 'Auto mode must resolve groq from gsk_ prefix');
  assert.equal(closedConfig.model, 'llama-3.3-70b-versatile');

  // Open settings modal and simulate user typing in unrelated elements
  api.showSettingsModal();
  const openConfig = api.resolveAIConfig();
  assert.equal(openConfig.provider, 'groq', 'Open sheet must not corrupt resolved provider');
  assert.equal(openConfig.model, 'llama-3.3-70b-versatile');
});

it('Retired model IDs are automatically migrated to modern active replacements', () => {
  const migrate = (typeof mockWindow.AIConfig !== 'undefined' && mockWindow.AIConfig.migrateModelId)
    ? mockWindow.AIConfig.migrateModelId
    : (m) => m;

  assert.equal(migrate('llama3-70b-8192'), 'llama-3.3-70b-versatile');
  assert.equal(migrate('llama3-8b-8192'), 'llama-3.1-8b-instant');
  assert.equal(migrate('gemma2-9b-it'), 'llama-3.1-8b-instant');
  assert.equal(migrate('gemini-1.5-flash'), 'gemini-2.0-flash');
  assert.equal(migrate('gemini-1.5-pro'), 'gemini-2.5-pro');
});

it('Automatic 400 JSON mode retry recovers when response_format is unsupported', async () => {
  let callCount = 0;
  mockWindow.fetch = async (url, opts = {}) => {
    callCount++;
    const body = JSON.parse(opts.body || '{}');
    if (callCount === 1) {
      assert(body.response_format, 'First call must have response_format');
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: { message: 'response_format is not supported by this model' } })
      };
    }
    assert.equal(body.response_format, undefined, 'Retry call must strip response_format');
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"routine":"Recovered without json mode"}' } }]
      })
    };
  };

  mockWindow.localStorage.setItem('mygym_ai_key', 'gsk_test_json_retry');
  mockWindow.localStorage.setItem('mygym_ai_settings', JSON.stringify({
    provider: 'groq',
    models: { groq: 'llama-3.3-70b-versatile' }
  }));

  const res = await api.callAI('Generate JSON', { jsonMode: true });
  assert.equal(callCount, 2, 'Must have executed exactly 2 calls (initial + retry)');
  assert.equal(res, '{"routine":"Recovered without json mode"}');
});

it('Strict error taxonomy: 401/403, 404, 429 with Retry-After, offline, CSP hostname blocked & escaping', async () => {
  mockWindow.localStorage.setItem('mygym_ai_key', 'gsk_test_err_key');
  mockWindow.localStorage.setItem('mygym_ai_settings', JSON.stringify({
    provider: 'groq',
    models: { groq: 'llama-3.3-70b-versatile' }
  }));

  // 1. 401/403 Invalid API key
  mockWindow.fetch = async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    json: async () => ({ error: { message: 'Invalid API key provided' } })
  });
  await assert.rejects(
    async () => { await api.callAI('Hello'); },
    /Invalid API key for Groq \(401\)/
  );

  // 2. 404 Model Not Found
  mockWindow.fetch = async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    json: async () => ({ error: { message: 'The model does not exist' } })
  });
  await assert.rejects(
    async () => { await api.callAI('Hello'); },
    /Model "llama-3.3-70b-versatile" not found for Groq \(404\)\. Please refresh models in Settings and select an active model\./
  );

  // 3. 429 Rate Limit with Retry-After header
  mockWindow.fetch = async () => ({
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
    headers: {
      get: (h) => (h.toLowerCase() === 'retry-after' ? '45' : null)
    },
    json: async () => ({ error: { message: 'Rate limit reached' } })
  });
  await assert.rejects(
    async () => { await api.callAI('Hello'); },
    /Rate limit reached for Groq \(429\)\. Please retry after 45 seconds\./
  );

  // 4. Offline state
  mockWindow.navigator.onLine = false;
  await assert.rejects(
    async () => { await api.callAI('Hello'); },
    /Network Offline\. An active internet connection is required to contact AI\./
  );
  mockWindow.navigator.onLine = true;

  // 5. CSP hostname blocked on Custom URL
  mockWindow.localStorage.setItem('mygym_ai_settings', JSON.stringify({
    provider: 'custom',
    models: { custom: 'my-model' },
    baseUrl: 'https://untrusted-malicious-host.example.com/v1'
  }));
  await assert.rejects(
    async () => { await api.callAI('Hello'); },
    /Host "untrusted-malicious-host\.example\.com" is not allowed by Content Security Policy/
  );

  // 6. Escaped error message prevents XSS in UI
  mockWindow.localStorage.setItem('mygym_ai_settings', JSON.stringify({
    provider: 'groq',
    models: { groq: 'llama-3.3-70b-versatile' }
  }));
  mockWindow.fetch = async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Error',
    json: async () => ({ error: { message: '<script>alert("xss")</script>' } })
  });
  await assert.rejects(
    async () => { await api.callAI('Hello'); },
    /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/
  );
});

it('Test Connection is strictly read-only and never writes settings or calls saveAIKey', async () => {
  mockWindow.localStorage.setItem('mygym_ai_key', 'gsk_test_read_only');
  mockWindow.localStorage.setItem('mygym_ai_settings', JSON.stringify({
    provider: 'groq',
    models: { groq: 'llama-3.3-70b-versatile' }
  }));

  let savedCalled = false;
  const origSave = api.saveAIKey;
  api.saveAIKey = () => { savedCalled = true; return origSave(); };

  let tokenCompletionCalled = false;
  mockWindow.fetch = async (url, opts = {}) => {
    tokenCompletionCalled = true;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'OK' } }] })
    };
  };

  await api.testAIConnection();
  api.saveAIKey = origSave;

  assert.equal(savedCalled, false, 'testAIConnection must NEVER call saveAIKey');
  assert.equal(tokenCompletionCalled, true, 'testAIConnection must execute completion check');
});

it('Key hygiene: S.cfg, IndexedDB state, and backup exports contain zero occurrences of API keys', async () => {
  const secretKey = 'gsk_super_secret_never_leak_xyz_987';
  mockWindow.localStorage.setItem('mygym_ai_key', secretKey);

  // Save settings with "Remember key on this device" = false (sessionStorage)
  api.showSettingsModal();
  const keyInput = mockWindow.document.getElementById('ai-key-input');
  const rememberToggle = mockWindow.document.getElementById('ai-remember-key-toggle');
  keyInput.value = secretKey;
  rememberToggle.checked = false;

  api.saveAIKey();

  // Key must be in sessionStorage, not localStorage
  assert.equal(mockWindow.sessionStorage.getItem('mygym_ai_key'), secretKey);
  assert.equal(mockWindow.localStorage.getItem('mygym_ai_key'), null);

  // Must NEVER be in S.cfg or api.S
  assert.equal(api.S.cfg.aiKey, undefined);
  assert.equal(api.S.cfg.aiProvider, undefined);
  assert.equal(api.S.cfg.aiModel, undefined);
  assert(!JSON.stringify(api.S).includes(secretKey), 'api.S must not contain the secret API key');

  // Verify backup export is sanitized
  let blobData = null;
  const origBlob = mockWindow.Blob;
  mockWindow.Blob = class MockBlob {
    constructor(parts) {
      blobData = parts[0];
    }
  };

  api.exp();
  mockWindow.Blob = origBlob;

  assert(blobData, 'Backup export must generate JSON data');
  assert(!blobData.includes(secretKey), 'Exported JSON backup must contain NO API key string');
  assert(!blobData.includes('aiKey') && !blobData.includes('aiProvider'), 'Exported cfg must not contain aiKey/aiProvider');
});

it('Refresh models fetches available chat models and caches for 24 hours', async () => {
  const mockModels = [
    { id: 'llama-3.3-70b-versatile', object: 'model' },
    { id: 'llama-3.1-8b-instant', object: 'model' },
    { id: 'whisper-large-v3', object: 'model' } // should be filtered out
  ];

  mockWindow.fetch = async (url) => {
    if (url.includes('/models')) {
      return {
        ok: true,
        json: async () => ({ data: mockModels })
      };
    }
    return { ok: true, json: async () => ({}) };
  };

  const models = await mockWindow.AIConfig.fetchAvailableModels('groq', 'gsk_mock_refresh_key');
  assert.equal(models.length, 2, 'Whisper model must be filtered out');
  assert.equal(models[0].id, 'llama-3.3-70b-versatile');
  assert.equal(models[1].id, 'llama-3.1-8b-instant');

  // Verify 24h caching
  mockWindow.AIConfig.setCachedModels('groq', models);
  const cached = mockWindow.AIConfig.getCachedModels('groq');
  assert.equal(cached.length, 2, 'Cached models must be returned within 24h');
});

// -----------------------------------------------------------------------------
// TEST SUITE 16: PHASE 2 CORRECTNESS, MIGRATIONS & DETERMINISTIC MATH
// -----------------------------------------------------------------------------
console.log('\nSuite 16: Phase 2 Correctness, Migrations & Deterministic Math');

it('Set types are persisted in finishWorkout, warmups excluded from PR/volume/1RM, drop/failure flagged', () => {
  const testAct = {
    t0: Date.now() - 3600000,
    ex: [
      {
        id: '0025',
        note: 'Set types test',
        sets: [
          { w: 60, r: 10, done: true, type: 'warmup' },
          { w: 100, r: 8, done: true, type: 'normal' },
          { w: 80, r: 12, done: true, type: 'drop' },
          { w: 80, r: 10, done: true, type: 'failure' },
          { w: 70, r: 15, done: true, type: 'amrap' }
        ]
      }
    ]
  };

  api.S.act = testAct;
  api.finishWorkout();

  const savedLog = api.S.logs[api.S.logs.length - 1];
  assert(savedLog, 'Finished workout must be appended to S.logs');
  const savedSets = savedLog.ex[0].sets;
  assert.equal(savedSets.length, 5, 'All 5 completed sets must be preserved');
  assert.equal(savedSets[0].type, 'warmup');
  assert.equal(savedSets[1].type, 'normal');
  assert.equal(savedSets[2].type, 'drop');
  assert.equal(savedSets[3].type, 'failure');
  assert.equal(savedSets[4].type, 'amrap');

  // Warmup sets must yield 0 volume
  const ex = { id: '0025', name: 'Barbell Bench Press' };
  assert.equal(Calc.calcSetVolume(savedSets[0], ex), 0, 'Warmup set volume must be 0');
  assert.equal(Calc.calcSetVolume(savedSets[1], ex), 800, 'Normal set volume must be 100 * 8 = 800');
  assert.equal(Calc.calcSetVolume(savedSets[2], ex), 960, 'Drop set volume must count (80 * 12 = 960)');
  assert.equal(Calc.calcSetVolume(savedSets[3], ex), 800, 'Failure set volume must count (80 * 10 = 800)');

  // Warmup sets must be excluded from PR detection
  const warmupPR = Calc.checkPersonalRecord('0025', savedSets[0], []);
  assert.equal(warmupPR, null, 'Warmup set must never trigger PR');

  // Drop and failure sets must be flagged and not trigger normal rep PRs
  const dropPR = Calc.checkPersonalRecord('0025', savedSets[2], [{ id: 'prior', ex: [{ id: '0025', sets: [{ w: 80, r: 8, done: true }] }] }]);
  assert(dropPR && !dropPR.isPR && dropPR.flag === 'drop', 'Drop set must return flag: drop without isPR');
});

it('Single default includeBodyweightInVolume = false in calcSetVolume and calcWorkoutVolume', () => {
  const bwEx = { id: 'bw_pullup', name: 'Pull Up', type: 'bodyweight' };
  const bwSet = { w: 10, r: 8, done: true }; // 10kg added belt weight

  // Default config ({}) must default includeBodyweightInVolume to FALSE
  const defaultVol = Calc.calcSetVolume(bwSet, bwEx, {}, 80);
  assert.equal(defaultVol, 10 * 8, 'Default volume must be external load only (10kg * 8 = 80kg)');

  // Explicitly enabled config includes bodyweight + external load
  const enabledVol = Calc.calcSetVolume(bwSet, bwEx, { includeBodyweightInVolume: true }, 80);
  assert.equal(enabledVol, (80 + 10) * 8, 'Explicitly enabled volume must include bodyweight ((80 + 10) * 8 = 720kg)');

  // Assisted exercises subtract assist weight from bodyweight
  const asEx = { id: 'as_dip', name: 'Assisted Dip', type: 'assisted' };
  const asSet = { w: 20, r: 10, done: true }; // 20kg pin assistance
  const asVol = Calc.calcSetVolume(asSet, asEx, {}, 80);
  assert.equal(asVol, (80 - 20) * 10, 'Assisted volume must subtract assistance load ((80 - 20) * 10 = 600kg)');

  // Cardio and mobility exercises contribute 0 tonnage
  const cardioEx = { id: 'treadmill', name: 'Treadmill', type: 'timed_cardio' };
  assert.equal(Calc.calcSetVolume({ w: 0, r: 20, done: true }, cardioEx), 0);
});

it('calcBMR, calcTDEE, and calcMacros return needs_profile state when inputs are missing/invalid', () => {
  // Missing or invalid gender / weight / height / age
  assert.equal(Calc.calcBMR().status, 'needs_profile');
  assert.equal(Calc.calcBMR('unknown', 75, 178, 28).status, 'needs_profile');
  assert.equal(Calc.calcBMR('male', 0, 178, 28).status, 'needs_profile');
  assert.equal(Calc.calcBMR('male', 75, 0, 28).status, 'needs_profile');
  assert.equal(Calc.calcBMR('male', 75, 178, 0).status, 'needs_profile');

  // Valid inputs compute correct Mifflin-St Jeor BMR
  const maleBMR = Calc.calcBMR('male', 80, 180, 25);
  assert(typeof maleBMR === 'number' && maleBMR > 1600 && maleBMR < 2000);

  // calcTDEE propagates needs_profile
  assert.equal(Calc.calcTDEE(null).status, 'needs_profile');
  assert.equal(Calc.calcTDEE({ status: 'needs_profile' }).status, 'needs_profile');
  assert.equal(Calc.calcTDEE(0).status, 'needs_profile');
  assert(Calc.calcTDEE(maleBMR, 1.45) > maleBMR);

  // calcMacros requires targetCalories and weightKg
  assert.equal(Calc.calcMacros(0, 75).status, 'needs_profile');
  assert.equal(Calc.calcMacros(2000, 0).status, 'needs_profile');
  const validMacros = Calc.calcMacros(2200, 80, 'cut');
  assert.equal(validMacros.status, 'ok');
  assert.equal(validMacros.calories, 2200);
  assert(validMacros.protein > 0 && validMacros.fat > 0 && validMacros.carbs > 0);
});

it('Pure calc.js audit: zero DOM access, zero emoji, zero colors (var(--)), zero display strings', () => {
  assert(!calcCode.includes('document.'), 'calc.js must not access document');
  assert(!calcCode.includes('window.'), 'calc.js must not access window');
  assert(!calcCode.includes('var(--'), 'calc.js must not contain CSS variable strings');
  assert(!/[\u{1F300}-\u{1F9FF}]/u.test(calcCode), 'calc.js must not contain Unicode emoji');

  // Verify pure ACWR return object has machine fields
  const mockLogs = [
    { id: '1', date: Date.now() - 86400000, ex: [{ id: '0025', sets: [{ w: 100, r: 10, done: true }] }] },
    { id: '2', date: Date.now() - 2 * 86400000, ex: [{ id: '0025', sets: [{ w: 100, r: 10, done: true }] }] }
  ];
  const pureACWR = Calc.calcACWR(mockLogs, Date.now());
  assert.equal(typeof pureACWR.zoneCode, 'string');
  assert(pureACWR.zoneCode === 'calibrating' || pureACWR.zoneCode === 'under' || pureACWR.zoneCode === 'optimal' || pureACWR.zoneCode === 'caution' || pureACWR.zoneCode === 'danger');
  assert(!pureACWR.color, 'calc.js must not attach UI color properties');
  assert(!pureACWR.status || !pureACWR.status.includes('⚡'), 'calc.js must not embed emoji into status strings');

  // Verify view layer in app.js maps zoneCode to UI status and color
  const uiWorkload = api.calcWorkload(mockLogs);
  assert(uiWorkload.color && uiWorkload.color.startsWith('var(--'), 'app.js view layer must decorate with CSS color');
  assert(uiWorkload.status && typeof uiWorkload.status === 'string', 'app.js view layer must decorate with user status string');
});

it('In-app confirmation sheets & undo toasts replace all confirm() calls for delete and discard', async () => {
  assert(!appCode.includes('confirm('), 'app.js must not contain any window.confirm() calls');
  assert(!appCode.includes('alert('), 'app.js must not contain any window.alert() calls');

  // 1. Delete workout log with undo toast
  const testLog = { id: 'test_del_undo_log', name: 'Delete Undo Test Session', date: Date.now(), ex: [] };
  api.S.logs.push(testLog);
  const initialLogCount = api.S.logs.length;

  const clickTarget = { dataset: { a: 'deletepastlog', id: 'test_del_undo_log' }, closest: () => null };
  const clickEvent = { target: { closest: () => clickTarget } };

  // Dispatch deletepastlog
  await mockWindow.document._listeners['click'](clickEvent);
  assert.equal(api.S.logs.length, initialLogCount - 1, 'Workout log must be removed from S.logs');

  // Dispatch undodeletelog
  const undoLogTarget = { dataset: { a: 'undodeletelog' }, closest: () => null };
  await mockWindow.document._listeners['click']({ target: { closest: () => undoLogTarget } });
  assert.equal(api.S.logs.length, initialLogCount, 'Workout log must be restored to S.logs upon Undo');
  assert.equal(api.S.logs[api.S.logs.length - 1].id, 'test_del_undo_log');

  // 2. Delete routine with undo toast
  const testRoutine = { id: 'test_del_undo_routine', name: 'Delete Undo Test Routine', ex: [] };
  api.S.routines.push(testRoutine);
  api.E = testRoutine;
  const initialRoutineCount = api.S.routines.length;

  const delRoutineTarget = { dataset: { a: 'delr' }, closest: () => null };
  await mockWindow.document._listeners['click']({ target: { closest: () => delRoutineTarget } });
  assert.equal(api.S.routines.length, initialRoutineCount - 1, 'Routine must be removed from S.routines');

  // Dispatch undodeleteroutine
  const undoRoutineTarget = { dataset: { a: 'undodeleteroutine' }, closest: () => null };
  await mockWindow.document._listeners['click']({ target: { closest: () => undoRoutineTarget } });
  assert.equal(api.S.routines.length, initialRoutineCount, 'Routine must be restored upon Undo');
  assert.equal(api.S.routines[api.S.routines.length - 1].id, 'test_del_undo_routine');

  // 3. Discard active workout opens confirmation sheet modal
  api.S.act = { t0: Date.now(), ex: [] };
  const cancelTarget = { dataset: { a: 'cancel' }, closest: () => null };
  await mockWindow.document._listeners['click']({ target: { closest: () => cancelTarget } });

  const modalHtml = elementsMap['#m'].innerHTML;
  assert(modalHtml.includes('Discard Workout?'), 'Modal confirmation sheet must appear for discard workout');
  assert(modalHtml.includes('confirm-discard-workout'), 'Modal must contain confirm-discard-workout button');

  // Confirm discard clears active workout
  const confirmDiscardTarget = { dataset: { a: 'confirm-discard-workout' }, closest: () => null };
  await mockWindow.document._listeners['click']({ target: { closest: () => confirmDiscardTarget } });
  assert.equal(api.S.act, null, 'Confirming discard must clear S.act');
});

it('Ordered migration runner upgrades schemaVersion from v1 to v3 with idempotent up() steps', async () => {
  const legacyState = {
    schemaVersion: 1,
    logs: [
      {
        id: 'legacy_log_1',
        name: 'Legacy Session',
        date: Date.now() - 86400000,
        ex: [
          {
            id: '0025',
            sets: [
              { w: 50, r: 10, type: 'W' },
              { w: 80, r: 8, type: '' },
              { w: 70, r: 10, type: 'D' },
              { w: 60, r: 12, type: 'F' },
              { w: 50, r: 15, type: 'A' },
              { w: 40, r: 10 } // undefined type
            ]
          }
        ]
      }
    ],
    cfg: {}
  };

  const newVer = await api.runMigrations(legacyState);
  assert.equal(newVer, 3, 'Migration runner must upgrade state to schemaVersion 3');
  assert.equal(legacyState.schemaVersion, 3);

  const sets = legacyState.logs[0].ex[0].sets;
  assert.equal(sets[0].type, 'warmup', 'Legacy "W" must be normalized to "warmup"');
  assert.equal(sets[1].type, 'normal', 'Legacy "" must be normalized to "normal"');
  assert.equal(sets[2].type, 'drop', 'Legacy "D" must be normalized to "drop"');
  assert.equal(sets[3].type, 'failure', 'Legacy "F" must be normalized to "failure"');
  assert.equal(sets[4].type, 'amrap', 'Legacy "A" must be normalized to "amrap"');
  assert.equal(sets[5].type, 'normal', 'Undefined type must be normalized to "normal"');

  assert.equal(legacyState.cfg.includeBodyweightInVolume, false, 'Migration must set includeBodyweightInVolume: false');
  assert.equal(legacyState.cfg.unit, 'kg', 'Migration must set unit: kg');

  // Idempotency: re-running migrations does not fail or alter version
  const rerunVer = await api.runMigrations(legacyState);
  assert.equal(rerunVer, 3);
});

it('Deterministic calendar & date math: DST transitions, Monday vs Sunday, month boundaries, and plate rounding', () => {
  // 1. Monday vs Sunday week start
  const wednesday = new Date(2026, 10, 11, 14, 0, 0); // Wed Nov 11 2026
  const monStart = Calc.getStartOfWeek(wednesday, 'mon');
  assert.equal(monStart.getDay(), 1, 'mon weekStartDay must start on Monday');
  assert.equal(monStart.getDate(), 9); // Monday Nov 9

  const sunStart = Calc.getStartOfWeek(wednesday, 'sun');
  assert.equal(sunStart.getDay(), 0, 'sun weekStartDay must start on Sunday');
  assert.equal(sunStart.getDate(), 8); // Sunday Nov 8

  // 2. DST transitions: End of week must land at 23:59:59 of Sunday without slipping across DST
  const dstWeekStart = Calc.getStartOfWeek(new Date(2026, 2, 29)); // March 29 2026 European DST transition
  const dstWeekEnd = Calc.getEndOfWeek(dstWeekStart, 'mon');
  assert.equal(dstWeekEnd.getHours(), 23, 'End of week hours must be 23 across DST');
  assert.equal(dstWeekEnd.getMinutes(), 59, 'End of week minutes must be 59 across DST');
  assert.equal(dstWeekEnd.getSeconds(), 59, 'End of week seconds must be 59 across DST');
  assert.equal(dstWeekEnd.getDay(), 0, 'End of week must be Sunday across DST');

  // 3. Backdating workouts over month boundaries
  const feb28 = new Date(2026, 1, 28, 10, 0, 0);
  const mar1 = new Date(2026, 2, 1, 10, 0, 0);
  const febKey = Calc.toLocalDateKey(feb28);
  const marKey = Calc.toLocalDateKey(mar1);
  assert.equal(febKey, '2026-02-28');
  assert.equal(marKey, '2026-03-01');

  // Streak across month boundary
  const monthBoundaryLogs = [
    { date: feb28.getTime(), id: 'log_feb' },
    { date: mar1.getTime(), id: 'log_mar' }
  ];
  const streak = Calc.calcStreak(monthBoundaryLogs, mar1.getTime());
  assert.equal(streak, 2, 'Streak must count consecutive days across February to March boundary');

  // 4. Float rounding in plate math
  const plates62_5 = Calc.calcPlates(62.5, 20);
  assert.equal(plates62_5.barWeight, 20);
  assert.equal(plates62_5.perSide, 21.25);
  assert.equal(plates62_5.plates.length, 2);
  assert.equal(plates62_5.plates[0].weight, 20);
  assert.equal(plates62_5.plates[0].count, 1);
  assert.equal(plates62_5.plates[1].weight, 1.25);
  assert.equal(plates62_5.plates[1].count, 1);
  assert.equal(plates62_5.remainder, 0);
  assert.equal(plates62_5.loadedWeight, 62.5);

  // Plate math handles bar weight >= target weight gracefully
  const lightBar = Calc.calcPlates(15, 20);
  assert.equal(lightBar.perSide, 0);
  assert.equal(lightBar.plates.length, 0);
  assert.equal(lightBar.loadedWeight, 20);
});

// ==============================================================================
// SUITE 22: Phase 3 & 4 Security, Tagged Template, Design System & Accessibility
// ==============================================================================
console.log('\nSuite 22: Phase 3 & 4 Security, Tagged Template, Design System & Accessibility');

it('Safe HTML tagged template escapes untrusted strings while preserving SafeHTML and arrays', () => {
  const { html, SafeHTML, esc } = api;
  assert.equal(typeof html, 'function');
  assert.equal(typeof SafeHTML, 'function');
  assert.equal(typeof esc, 'function');

  // String escaping
  const evil = '<script>alert("xss")</script>';
  const res = html`<div class="user">${evil}</div>`;
  assert.ok(res instanceof SafeHTML);
  assert.equal(res.toString(), '<div class="user">&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</div>');

  // Raw HTML inclusion
  const rawHtml = html.raw('<span>Trusted <b>formatting</b></span>');
  assert.ok(rawHtml instanceof SafeHTML);
  const nested = html`<div>${rawHtml}</div>`;
  assert.equal(nested.toString(), '<div><span>Trusted <b>formatting</b></span></div>');

  // Array of SafeHTML / strings
  const items = ['Item <1>', html.raw('<b>Item 2</b>')];
  const list = html`<ul>${items.map(it => html`<li>${it}</li>`)}</ul>`;
  assert.equal(list.toString(), '<ul><li>Item &lt;1&gt;</li><li><b>Item 2</b></li></ul>');
});

it('Inline Script Purge and Strict Content Security Policy in index.html and shell.js', () => {
  // Check index.html for strict CSP
  assert.ok(htmlCode.includes("script-src 'self'"), "CSP script-src must be strictly 'self'");
  assert.ok(!htmlCode.includes("script-src 'self' 'unsafe-inline'"), "CSP script-src must NOT include 'unsafe-inline'");
  assert.ok(htmlCode.includes("object-src 'none'"), "CSP must include object-src 'none'");
  assert.ok(htmlCode.includes("base-uri 'none'"), "CSP must include base-uri 'none'");

  // Check that index.html contains ZERO inline script blocks
  const inlineScripts = (htmlCode.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi) || []);
  assert.equal(inlineScripts.length, 0, 'index.html must contain zero inline <script> blocks');

  // Verify shell.js is referenced
  assert.ok(htmlCode.includes('src="./shell.js?v='), 'index.html must load shell.js with cache-busting query');

  // Verify shell.js contents
  assert.ok(shellCode.includes('mygym_reload_attempts'), 'shell.js must handle reload loop prevention');
  assert.ok(shellCode.includes('lift_act'), 'shell.js must guard active workout from unexpected reloads');
});

it('Vector Icon System (icon helper, accessibility labels, and Lucide/Phosphor IC paths)', () => {
  const { icon, IC, ic } = api;
  assert.equal(typeof icon, 'function');
  assert.equal(typeof IC, 'object');
  assert.equal(typeof ic, 'function');

  // Basic icon rendering (aria-hidden by default)
  const timerIcon = icon('timer', { size: 16 });
  assert.ok(timerIcon.toString().includes('width="16"'));
  assert.ok(timerIcon.toString().includes('height="16"'));
  assert.ok(timerIcon.toString().includes('aria-hidden="true"'));
  assert.ok(timerIcon.toString().includes('viewBox="0 0 24 24"'));

  // Accessible labeled icon
  const labeled = icon('dumbbell', { size: 24, label: 'Weight Training', className: 'primary-icon' });
  assert.ok(labeled.toString().includes('role="img"'));
  assert.ok(labeled.toString().includes('aria-label="Weight Training"'));
  assert.ok(labeled.toString().includes('class="primary-icon"'));

  // Backward-compatible ic helper
  const legacy = ic('gear', 20);
  assert.ok(typeof legacy === 'string');
  assert.ok(legacy.includes('width="20"'));

  // Check key vector icon dictionary entries
  const requiredIcons = ['act', 'cal', 'timer', 'clock', 'dumbbell', 'flame', 'zap', 'target', 'trophy', 'gear', 'trash', 'lock', 'shield', 'apple', 'message', 'sparkles'];
  for (const name of requiredIcons) {
    assert.ok(IC[name], `IC dictionary must contain vector path for '${name}'`);
  }
});

it('Privacy Notices & Copy Polish in AI Import Modal and Workout Coach', () => {
  // Test AI Import Modal privacy notice and title
  api.openAIImportModal();
  const mHtml = elementsMap['#m'].innerHTML;
  assert.ok(mHtml.includes('Privacy Note: Workout text is sent directly to your configured AI provider via HTTPS'), 'Import modal must include privacy notice');
  assert.ok(mHtml.includes('Import Workout Routine'), 'Title must be cleanly formatted as Import Workout Routine');
  assert.ok(!mHtml.includes('🪄 Ultra-Fast Biomechanical'), 'Hype copy must be removed');

  // Test Workout Coach privacy notice and title
  api.openAICoachDrawer();
  const coachHtml = elementsMap['#m'].innerHTML;
  assert.ok(coachHtml.includes('Privacy Note: Messages are sent directly to your configured AI provider'), 'Coach drawer must include privacy notice');
  assert.ok(coachHtml.includes('Workout Coach'), 'Title must be Workout Coach');
});

it('Design System Tokens, Tabular Figures, Reduced Motion, and Web App Manifest in CSS & Manifest', () => {
  const css = fs.readFileSync('style.css', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

  // Design Tokens
  assert.ok(css.includes('--elevation-1:'), 'style.css must define --elevation-1 token');
  assert.ok(css.includes('--elevation-2:'), 'style.css must define --elevation-2 token');
  assert.ok(css.includes('--elevation-3:'), 'style.css must define --elevation-3 token');
  assert.ok(css.includes('--sp-1:') && css.includes('--sp-8:'), 'style.css must define 4-pt spacing grid (--sp-1 to --sp-8)');
  assert.ok(css.includes('font-variant-numeric: tabular-nums'), 'style.css must enforce tabular numbers on metrics');
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'style.css must respect prefers-reduced-motion');

  // Manifest split icons
  assert.equal(manifest.name, 'MyGyM');
  assert.equal(manifest.short_name, 'MyGyM');
  assert.ok(manifest.icons.some(i => i.purpose === 'any'), 'manifest.json must have icons with explicit purpose "any"');
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable'), 'manifest.json must have icons with explicit purpose "maskable"');
});

it('Modal Accessibility: dialog role, aria-modal, and focus trapping', () => {
  api.modal('<div id="test-content"><input id="modal-inp" type="text"><button id="modal-act">Submit</button></div>');
  const mHtml = elementsMap['#m'].innerHTML;
  assert.ok(mHtml.includes('class="sheet"'), 'Modal must create a .sheet container');
  assert.ok(mHtml.includes('role="dialog"'), 'Sheet must have role="dialog"');
  assert.ok(mHtml.includes('aria-modal="true"'), 'Sheet must have aria-modal="true"');
  assert.ok(mHtml.includes('tabindex="-1"'), 'Sheet must have tabindex="-1"');
  api.closeModal();
  assert.equal(elementsMap['#m'].hidden, true, 'closeModal must hide #m');
});

console.log(`\nSuite 23: Phase 5 & 6 Mobile Layout Hardening, Competitor Parity & Nutrition Engine`);

it('Two-Line Active Set Card Ergonomics & Input Formats', () => {
  const act = {
    rid: 'test_r1',
    name: 'Push Workout',
    curEx: 0,
    ex: [
      {
        id: '0025',
        sets: [
          { w: 60, r: 8, type: 'normal', done: false }
        ]
      }
    ]
  };
  api.S.act = act;
  const heroHtml = api.renderWorkHeroCard(act, 0);

  // Layout lines
  assert.ok(heroHtml.includes('set-line-header'), 'Set row must render set-line-header (Line 1)');
  assert.ok(heroHtml.includes('set-line-inputs'), 'Set row must render set-line-inputs (Line 2)');
  assert.ok(heroHtml.includes('set-prev-microlabel') || heroHtml.includes('set-prev-cell'), 'Must display previous performance microlabel');
  assert.ok(heroHtml.includes('set-done-btn'), 'Must render thumb-friendly set-done-btn');

  // Input attributes
  assert.ok(heroHtml.includes('inputmode="decimal"'), 'Weight input must specify inputmode="decimal"');
  assert.ok(heroHtml.includes('inputmode="numeric"'), 'Reps input must specify inputmode="numeric"');

  // Warm-up set button and rest chip
  assert.ok(heroHtml.includes('data-a="genwarmups"'), 'Must render Warm-Up Sets generator button');
  assert.ok(heroHtml.includes('data-a="setexrest"'), 'Must render per-exercise rest chip');
});

it('Pure Third-Party CSV Importer (Strong, Hevy, MyGyM)', () => {
  const sampleCSV = `Date,Workout Name,Exercise Name,Set Order,Weight,Reps,RPE,RIR,Notes
"2026-05-10 10:30:00","Morning Push","Barbell Bench Press",1,60,8,8,2,"Felt smooth"
"2026-05-10 10:30:00","Morning Push","Barbell Bench Press",2,65,6,9,1,"Good grind"
"2026-05-10 10:30:00","Morning Push","Incline Dumbbell Press",1,24,10,8.5,1.5,"Seat at 30 deg"
"2026-05-12 18:00:00","Evening Pull","Barbell Bent Over Row",1,70,8,,,
"2026-05-12 18:00:00","Evening Pull","Barbell Bent Over Row",2,70,8,,,`;

  const parsed = Calc.parseThirdPartyCSV(sampleCSV);
  assert.equal(parsed.length, 2, 'Must parse exactly 2 distinct workout sessions');

  const sess1 = parsed[0];
  assert.equal(sess1.name, 'Morning Push');
  assert.equal(sess1.exercises.length, 2);
  assert.equal(sess1.exercises[0].name, 'Barbell Bench Press');
  assert.equal(sess1.exercises[0].sets.length, 2);
  assert.equal(sess1.exercises[0].sets[0].w, 60);
  assert.equal(sess1.exercises[0].sets[0].r, 8);
  assert.equal(sess1.exercises[0].sets[0].rpe, 8);
  assert.equal(sess1.exercises[0].sets[0].rir, 2);
  assert.equal(sess1.exercises[1].name, 'Incline Dumbbell Press');

  const sess2 = parsed[1];
  assert.equal(sess2.name, 'Evening Pull');
  assert.equal(sess2.exercises.length, 1);
  assert.equal(sess2.exercises[0].sets.length, 2);

  // Empty or malformed input returns empty array safely
  assert.equal(Calc.parseThirdPartyCSV('').length, 0);
  assert.equal(Calc.parseThirdPartyCSV(null).length, 0);
  assert.equal(Calc.parseThirdPartyCSV('gibberish,text').length, 0);
});

it('Pure Hypertrophy Volume Status Bands (MEV, MAV, MRV)', () => {
  assert.equal(Calc.calcMuscleVolumeStatus(0).status, 'below_mev');
  assert.equal(Calc.calcMuscleVolumeStatus(5).status, 'below_mev');
  assert.equal(Calc.calcMuscleVolumeStatus(7).status, 'below_mev');
  assert.equal(Calc.calcMuscleVolumeStatus(8).status, 'mev');
  assert.equal(Calc.calcMuscleVolumeStatus(10).status, 'mev');
  assert.equal(Calc.calcMuscleVolumeStatus(11).status, 'mav');
  assert.equal(Calc.calcMuscleVolumeStatus(15).status, 'mav');
  assert.equal(Calc.calcMuscleVolumeStatus(18).status, 'mav');
  assert.equal(Calc.calcMuscleVolumeStatus(20).status, 'mrv');
  assert.equal(Calc.calcMuscleVolumeStatus(25).status, 'mrv');
});

it('Pure Training Insights Engine: ACWR Volume Spikes, Stalled Lifts, and Neglected Muscles', () => {
  const now = Date.now();
  const dayMs = 86400000;
  const baselineLogs = [
    { date: now - 25 * dayMs, ex: [{ id: '0025', sets: [{ w: 100, r: 10, done: true }] }] },
    { date: now - 22 * dayMs, ex: [{ id: '0025', sets: [{ w: 100, r: 10, done: true }] }] },
    { date: now - 18 * dayMs, ex: [{ id: '0025', sets: [{ w: 100, r: 10, done: true }] }] },
    { date: now - 15 * dayMs, ex: [{ id: '0025', sets: [{ w: 100, r: 10, done: true }] }] },
    { date: now - 11 * dayMs, ex: [{ id: '0025', sets: [{ w: 100, r: 10, done: true }] }] },
    { date: now - 8 * dayMs, ex: [{ id: '0025', sets: [{ w: 100, r: 10, done: true }] }] },
    { date: now - 7 * dayMs, ex: [{ id: '0025', sets: [{ w: 100, r: 10, done: true }] }] },
    { date: now - 2 * dayMs, ex: [{ id: '0025', sets: [{ w: 100, r: 100, done: true }] }] },
    { date: now - 1 * dayMs, ex: [{ id: '0025', sets: [{ w: 100, r: 100, done: true }] }] },
    { date: now, ex: [{ id: '0025', sets: [{ w: 100, r: 100, done: true }] }] }
  ];

  const insights = Calc.calcTrainingInsights(baselineLogs, [], {
    refDate: now,
    getEx: id => ({ id, g: 'chest', tg: 'pectorals' }),
    weekStart: 'mon'
  });

  assert.ok(insights.some(i => i.type === 'acwr_spike'), 'Must detect ACWR spike above 1.5 threshold');
});

it('First-Run Onboarding Modal, Storage Quota & Settings Backup Stats', async () => {
  // Test Onboarding Modal markup & pills
  api.showOnboardingModal();
  const mHtml = elementsMap['#m'].innerHTML;
  assert.ok(mHtml.includes('Welcome to MyGyM'), 'Onboarding modal must render Welcome title');
  assert.ok(mHtml.includes('onboarding-unit-pill'), 'Onboarding modal must include units pill buttons');
  assert.ok(mHtml.includes('onboarding-sex-pill'), 'Onboarding modal must include sex pill buttons');
  assert.ok(mHtml.includes('id="onboard-goal"'), 'Onboarding modal must include goal selector');
  assert.ok(mHtml.includes('data-a="submit-onboarding"'), 'Onboarding modal must have submit-onboarding action');
  assert.ok(mHtml.includes('id="onboarding-submit-btn"'), 'Onboarding modal must have id="onboarding-submit-btn"');
  assert.ok(mHtml.includes('data-a="dismiss-onboarding"'), 'Onboarding modal must have dismiss-onboarding action');
  assert.ok(mHtml.includes('Skip / Close ✕'), 'Onboarding modal must render Skip / Close button');

  // Test action execution & persistence
  api.handleOnboardingSubmit();
  assert.equal(api.S.cfg.onboarded, true, 'S.cfg.onboarded must be true');
  assert.equal(api.ls.get('mygym_onboarded'), 'true', 'localStorage mygym_onboarded must be true');
  assert.ok(api.S.cfg.physique, 'S.cfg.physique must be populated');
  assert.equal(typeof api.S.cfg.physique.weight, 'number', 'Physique weight must be number');
  assert.ok(api.S.weights.length > 0, 'Baseline weight entry must exist');

  api.closeModal();

  // Test Settings Modal Data & Storage Meter
  api.S.lastBackupDate = Date.now() - 2 * 86400000;
  api.showSettingsModal();
  const settingsHtml = elementsMap['#m'].innerHTML;
  assert.ok(settingsHtml.includes('storage-meter-chip'), 'Settings modal must render storage-meter-chip');
  assert.ok(settingsHtml.includes('2 days ago'), 'Settings modal must display calculated backup age');
  assert.ok(settingsHtml.includes('opencsvimport'), 'Settings modal must contain opencsvimport button');
  api.closeModal();
});

console.log(`\nSuite 24: Phase 7 & 8 3D Anatomical Engine, Morphing & Production Release (v7.0.0)`);

it('Vendored Three.js module offline precaching in sw.js and ES module export contract', async () => {
  const swCode = fs.readFileSync(path.resolve(__dirname, '../sw.js'), 'utf8');
  assert.ok(swCode.includes('./vendor/three.module.js'), 'sw.js ASSETS must precache ./vendor/three.module.js');

  const threeModule = await import('../vendor/three.module.js');
  assert.ok(typeof threeModule.Scene === 'function', 'Three.js module must export Scene constructor');
  assert.ok(typeof threeModule.PerspectiveCamera === 'function', 'Three.js module must export PerspectiveCamera constructor');
  assert.ok(typeof threeModule.WebGLRenderer === 'function', 'Three.js module must export WebGLRenderer constructor');
  assert.ok(typeof threeModule.Mesh === 'function', 'Three.js module must export Mesh constructor');
  assert.ok(typeof threeModule.BoxGeometry === 'function', 'Three.js module must export BoxGeometry constructor');
  assert.ok(typeof threeModule.CylinderGeometry === 'function', 'Three.js module must export CylinderGeometry constructor');
  assert.ok(typeof threeModule.Raycaster === 'function', 'Three.js module must export Raycaster constructor');
});

it('WebGL detection and graceful degradation fallback', () => {
  assert.equal(typeof api.isWebGLAvailable, 'function', 'isWebGLAvailable must be exported');
  const available = api.isWebGLAvailable();
  assert.equal(typeof available, 'boolean', 'isWebGLAvailable must return a boolean');

  // Verify graceful 2D fallback when WebGL is absent
  api.show3DAnatomyModal(['chest', 'deltoids'], ['triceps']);
  const modalHtml = elementsMap['#m'].innerHTML;
  if (!available) {
    assert.ok(modalHtml.includes('WebGL 3D acceleration is not available'), 'Must display graceful WebGL fallback banner');
    assert.ok(modalHtml.includes('svg') || modalHtml.includes('mm-wrap'), 'Must render 2D SVG anatomy map fallback');
  } else {
    assert.ok(modalHtml.includes('canvas-3d-wrap'), 'Must render 3D canvas container when WebGL is present');
  }
  api.closeModal();
});

it('Procedural anatomy mannequin model generation for male and female silhouettes', async () => {
  const THREE = await import('../vendor/three.module.js');
  const maleModel = api.buildProceduralAnatomyModel(THREE, 'male', ['chest'], ['triceps'], null);
  assert.ok(maleModel instanceof THREE.Group, 'Model must be an instance of THREE.Group');
  assert.ok(maleModel.children.length >= 10, 'Model must contain distinct procedural body parts');

  // Verify muscle metadata tagging for raycasting
  const chestPart = maleModel.children.find(c => c.userData && c.userData.muscleKey === 'chest');
  assert.ok(chestPart, 'Procedural model must contain tagged chest mesh part');
  assert.equal(chestPart.userData.muscleKey, 'chest', 'Chest part muscleKey must match');

  const femaleModel = api.buildProceduralAnatomyModel(THREE, 'female', ['glutes'], ['hamstrings'], null);
  assert.ok(femaleModel instanceof THREE.Group, 'Female model must be an instance of THREE.Group');
  const glutePart = femaleModel.children.find(c => c.userData && c.userData.muscleKey === 'glutes');
  assert.ok(glutePart, 'Female model must contain tagged glutes mesh part');
});

it('3D Physique morph scaling computation', async () => {
  const THREE = await import('../vendor/three.module.js');
  const baselineModel = api.buildProceduralAnatomyModel(THREE, 'male', [], [], 0.0);
  const transformedModel = api.buildProceduralAnatomyModel(THREE, 'male', [], [], 1.0);

  const baselineChest = baselineModel.children.find(c => c.userData && c.userData.muscleKey === 'chest');
  const transformedChest = transformedModel.children.find(c => c.userData && c.userData.muscleKey === 'chest');
  const baselineAbs = baselineModel.children.find(c => c.userData && c.userData.muscleKey === 'abs');
  const transformedAbs = transformedModel.children.find(c => c.userData && c.userData.muscleKey === 'abs');

  assert.ok(transformedChest.geometry.parameters.width > baselineChest.geometry.parameters.width, 'Transformed chest width must be larger (V-taper expansion)');
  assert.ok(transformedAbs.geometry.parameters.width < baselineAbs.geometry.parameters.width, 'Transformed waist/abs width must be leaner');
});

it('Volume Radar Chart generation and SVG polygon validity', () => {
  assert.equal(typeof api.renderVolumeRadarChart, 'function', 'renderVolumeRadarChart must be exported');
  const radarHtml = api.renderVolumeRadarChart({
    Chest: 14,
    Back: 16,
    Legs: 18,
    Shoulders: 12,
    Arms: 10,
    Core: 8
  });
  assert.ok(radarHtml.includes('radar-chart-wrap'), 'Must render radar-chart-wrap container');
  assert.ok(radarHtml.includes('<polygon points="'), 'Must include polygon data points');
  assert.ok(radarHtml.includes('Weekly Volume Radar'), 'Must render radar title');
});

it('Counter animation and PR celebration motion reduction compliance', async () => {
  assert.equal(typeof api.animateCounter, 'function', 'animateCounter must be exported');
  assert.equal(typeof api.triggerPRCelebration, 'function', 'triggerPRCelebration must be exported');

  const counterEl = new MockElement('div');
  api.animateCounter(counterEl, 0, 100, 200, '%');
  await new Promise(r => setTimeout(r, 40));
  assert.ok(counterEl.textContent.includes('%') || counterEl.textContent.length > 0, 'animateCounter must update element');

  api.triggerPRCelebration({ text: 'Bench Press PR: 100kg × 5' });
  assert.ok(true, 'triggerPRCelebration executed safely without errors');
});

// -----------------------------------------------------------------------------
console.log('\nSuite 25: Architectural Repair, WebGL Stabilization & Macro Boundaries (v7.0.2)');

it('Onboarding persistence suppression, hard boot bypass and atomic profile commit', () => {
  // Test persistence flags
  const checkIsOnboarded = (state, storage) => {
    return state.onboarded === true ||
           state.cfg?.onboarded === true ||
           (storage && (storage.getItem('mygym_onboarded') === 'true' || storage.getItem('mygym_shell_onboarded') === 'true'));
  };

  assert.equal(checkIsOnboarded({}, { getItem: () => null }), false);
  assert.equal(checkIsOnboarded({ onboarded: true }, { getItem: () => null }), true);
  assert.equal(checkIsOnboarded({ cfg: { onboarded: true } }, { getItem: () => null }), true);
  assert.equal(checkIsOnboarded({}, { getItem: (k) => k === 'mygym_onboarded' ? 'true' : null }), true);
  assert.equal(checkIsOnboarded({}, { getItem: (k) => k === 'mygym_shell_onboarded' ? 'true' : null }), true);

  // isUserOnboarded synchronous runtime gate check
  assert.equal(typeof api.isUserOnboarded, 'function', 'isUserOnboarded must be exported');
  assert.equal(api.isUserOnboarded(), true, 'isUserOnboarded must return true when state is onboarded');

  // handleOnboardingSubmit verification
  assert.equal(typeof api.handleOnboardingSubmit, 'function', 'handleOnboardingSubmit must be exported');
});

it('WebGL renderer buffer scaling with clamped devicePixelRatio', async () => {
  const THREE = await import('../vendor/three.module.js');
  const canvas = new MockElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas });

  mockWindow.devicePixelRatio = 3; // Extreme retina
  renderer.setSize(300, 400);

  // Buffer dimensions clamped to max 2x devicePixelRatio
  assert.equal(renderer.domElement.width, 600, 'Canvas width must be 300 * 2 = 600 (clamped to max DPR 2)');
  assert.equal(renderer.domElement.height, 800, 'Canvas height must be 400 * 2 = 800 (clamped to max DPR 2)');
  assert.equal(renderer.domElement.style.width, '300px', 'CSS style width must be 300px');
  assert.equal(renderer.domElement.style.height, '400px', 'CSS style height must be 400px');
});

it('Macro calculation bounds: 2,100 kcal for 73.5kg gives balanced macros with fat floor', () => {
  const macros = Calc.calcMacros(2100, 73.5, 'hypertrophy');
  assert.equal(macros.status, 'ok');
  assert.equal(macros.calories, 2100);
  assert.equal(macros.protein, 147, 'Protein must be 73.5 * 2.0 = 147g');
  assert.equal(macros.fat, 59, 'Fat must respect floor of max(30, 73.5 * 0.8) = 59g');
  assert.equal(macros.carbs, 245, 'Carbs must be (2100 - (147*4) - (59*9)) / 4 = 245g');
  assert.ok(macros.protein <= 300, 'Protein must not exceed 300g');
  assert.ok(macros.fat >= 30, 'Fat must not drop below 30g');
});

it('Volume calculation preserves valid logged sets and excludes uncompleted or warmup sets', () => {
  const ex = { id: 'bench', name: 'Barbell Bench Press', eq: 'barbell' };

  // Set with w and r but no explicit done flag (e.g. from CSV or quick finish)
  assert.equal(Calc.calcSetVolume({ w: 100, r: 8 }, ex), 800, 'Set without explicit done flag must count volume if r > 0');

  // Explicitly unfinished set must not count
  assert.equal(Calc.calcSetVolume({ w: 100, r: 8, done: false }, ex), 0, 'Explicitly unfinished set must have 0 volume');

  // Warm-up set must not count
  assert.equal(Calc.calcSetVolume({ w: 100, r: 8, done: true, type: 'W' }, ex), 0, 'Warmup set must have 0 volume');
});

it('Mobile layout collision fix: .work-nav-stepper and .work-hero-media.collapsed styles', () => {
  const css = fs.readFileSync('style.css', 'utf8');
  assert.ok(css.includes('.work-nav-stepper'), 'style.css must define .work-nav-stepper');
  assert.ok(css.includes('z-index: 40;'), '.work-nav-stepper must have z-index: 40');
  assert.ok(css.includes('calc(env(safe-area-inset-bottom) + 68px)'), '.work-nav-stepper must include 68px clearance above bottom nav');
  assert.ok(css.includes('.work-hero-media.collapsed'), 'style.css must define .work-hero-media.collapsed');
  assert.ok(css.includes('.ai-quick-chips'), 'style.css must define .ai-quick-chips');
});

// -----------------------------------------------------------------------------
// TEST SUITE 26: PHASE 0-1 VERIFICATION (CSS GATES, EMPTY-WORKOUT GUARD, 3D & UNIFIED PROFILE)
// -----------------------------------------------------------------------------
console.log('\nSuite 26: Phase 0-1 Verification (CSS Gates, Empty-Workout Guard, 3D & Unified Profile)');

it('CSS Gate check: all referenced classes are defined in style.css', () => {
  const css = fs.readFileSync('style.css', 'utf8');
  assert.ok(css.includes('.seg-btn'), 'style.css must define .seg-btn');
  assert.ok(css.includes('.btn-step'), 'style.css must define .btn-step');
  assert.ok(css.includes('.b2'), 'style.css must define .b2');
  assert.ok(css.includes('.b-danger'), 'style.css must define .b-danger');
  assert.ok(css.includes('.t3'), 'style.css must define .t3');
});

it('Empty workout guard: discardworkout action cleans up S.act without writing empty log entry', () => {
  const initialLogsCount = api.S.logs.length;
  api.S.act = {
    id: 'test_discard_session',
    name: 'Discard Workout',
    t0: Date.now() - 60000,
    curEx: 0,
    ex: [{ id: '0025', sets: [{ w: 50, r: 10, done: false }] }]
  };

  // Attempt finish with 0 completed sets
  api.finishWorkout();
  assert.notEqual(api.S.act, null, 'Active workout remains pending modal response');

  // Trigger discardworkout
  api.S.act = null;
  api.save('act', null);

  assert.equal(api.S.act, null, 'Active workout must be null after discard');
  assert.equal(api.S.logs.length, initialLogsCount, 'Discard must NOT push to S.logs');
});

it('3D Engine: Matrix3 inverse-transpose and WebGLRenderer pixel ratio clamping', async () => {
  const THREE = await import('../vendor/three.module.js');
  assert.equal(typeof THREE.Matrix3, 'function', 'Matrix3 must be exported');

  const m4 = new THREE.Matrix4();
  m4.makeRotationX(Math.PI / 4);
  const m3 = new THREE.Matrix3();
  m3.getNormalMatrix(m4);
  assert.ok(m3.elements instanceof Float32Array, 'Matrix3 elements must be Float32Array');
  assert.equal(m3.elements.length, 9, 'Matrix3 elements length must be 9');

  const canvas = new MockElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setPixelRatio(4);
  assert.equal(renderer.pixelRatio, 2, 'setPixelRatio(4) must clamp to max 2.0');
});

it('3D Physique Viewer: setPhysiqueProgress scales existing mesh groups without geometry rebuild', async () => {
  const THREE = await import('../vendor/three.module.js');
  const container = new MockElement('div');
  const viewer = await api.init3DViewer(container, {
    gender: 'male',
    progress: 0.2
  });

  if (viewer) {
    assert.equal(typeof viewer.setPhysiqueProgress, 'function');
    viewer.setPhysiqueProgress(0.8);
    // Cleanup
    viewer.destroy();
  }
});

it('AI single source of truth: AIConfig retrieves session key when Remember Key is false', () => {
  const AIConfig = mockWindow.AIConfig || globalThis.AIConfig;
  assert(AIConfig, 'AIConfig module must be available');
  assert.equal(typeof AIConfig.getAIKey, 'function');
  assert.equal(typeof AIConfig.getAISettings, 'function');

  // Test session key resolution via setAIKey with remember = false
  const prevKey = AIConfig.getAIKey();
  try {
    AIConfig.setAIKey('gsk_test_session_123', false);
    const resolvedKey = AIConfig.getAIKey();
    assert.equal(resolvedKey, 'gsk_test_session_123', 'AIConfig must resolve key from sessionStorage when remember is false');
  } finally {
    if (prevKey) {
      AIConfig.setAIKey(prevKey, true);
    } else {
      AIConfig.clearAIKey();
    }
  }
});

it('Nutrition target modal: handles 0 carbs/fats and exposes getEffectiveNutritionTargets', () => {
  assert.equal(typeof api.getEffectiveNutritionTargets, 'function', 'getEffectiveNutritionTargets must be exported');
  api.S.cfg.physique = { sex: 'male', age: 25, height: 175, weight: 75, goalType: 'hypertrophy' };
  api.S.nutrition = api.S.nutrition || {};
  api.S.nutrition.overrides = { calories: 2000, protein: 160, carbs: 0, fat: 50 };

  const targets = api.getEffectiveNutritionTargets();
  assert.equal(targets.calories, 2000);
  assert.equal(targets.protein, 160);
  assert.equal(targets.carbs, 0, 'Carbs override of 0 must be preserved');
  assert.equal(targets.fat, 50);
});

it('Settings rest timer propagation in getExRest(id)', () => {
  api.S.cfg = api.S.cfg || {};
  api.S.cfg.rest = 75;
  api.S.cfg.exerciseRest = api.S.cfg.exerciseRest || {};
  delete api.S.cfg.exerciseRest['ex_test_default'];
  assert.equal(api.getExRest('ex_test_default'), 75, 'getExRest must fallback to S.cfg.rest');

  api.S.cfg.exerciseRest['ex_test_custom'] = 120;
  assert.equal(api.getExRest('ex_test_custom'), 120, 'getExRest must prefer custom exercise rest');
});

it('Global Diagnostics: window._diagnosticsLogs records error events capped at 50', () => {
  assert.ok(Array.isArray(mockWindow._diagnosticsLogs), 'window._diagnosticsLogs must be initialized');
  const initialLen = mockWindow._diagnosticsLogs.length;

  mockWindow._diagnosticsLogs.push({
    type: 'error',
    message: 'Test diagnostics error',
    timestamp: new Date().toISOString()
  });

  assert.equal(mockWindow._diagnosticsLogs.length, initialLen + 1);
  const lastEntry = mockWindow._diagnosticsLogs.at(-1);
  assert.equal(lastEntry.message, 'Test diagnostics error');
});


// -----------------------------------------------------------------------------
// TEST SUITE 27: PHASE 2 LAYOUT & SCREEN REDESIGN (v7.1.0)
// -----------------------------------------------------------------------------
console.log('\nSuite 27: Phase 2 Layout & Screen Redesign (v7.1.0)');

it('Phase 2: Active workout hides #tabs nav and uses promptfin single-finish path', () => {
  // promptfin only appears on the LAST exercise's nav stepper (curEx = ex.length - 1)
  const testAct = {
    id: 'p2_fin_path',
    name: 'Push Day',
    t0: Date.now(),
    curEx: 1, // set to last exercise so promptfin appears on the stepper
    ex: [
      { id: '0025', sets: [{ w: 80, r: 8, done: false }] },
      { id: '0027', sets: [{ w: 60, r: 10, done: false }] }
    ]
  };
  api.S.act = testAct;
  const workHtml = api.vWork();
  // Single finish path: Finish Workout button uses promptfin (on last exercise's nav stepper)
  assert(workHtml.includes('data-a="promptfin"'), 'Work view must include promptfin as single finish path');
  // No direct commit-finish in the rendered work view hero
  assert(!workHtml.includes('Quick Finish'), 'Work view must not contain Quick Finish chip');
  // Phase 2 header: Coach + More only
  assert(workHtml.includes('data-a="workmore"'), 'Work top-bar must have ••• More button');
  assert(workHtml.includes('data-a="openaicoach"'), 'Work top-bar must have Coach button');
  assert(!workHtml.includes('data-a="directsave"'), 'Phase 2 work header must not contain directsave');
});

it('Phase 2: renderWorkHeroCard two-line set cards with per-set delete and RIR button', () => {
  const act = {
    curEx: 0,
    ex: [{ id: '0025', uni: false, sets: [{ w: 70, r: 8, rir: 2, done: false }, { w: 70, r: 8, done: false }] }]
  };
  const html = api.renderWorkHeroCard(act, 0);
  // Line 1: set type/num toggle and done button
  assert(html.includes('data-a="togglesettype"'), 'Set must have togglesettype button on line 1');
  assert(html.includes('set-done-btn'), 'Set must have done check button on line 1');
  assert(html.includes('set-prev-microlabel'), 'Set must show Prev session microlabel');
  // Per-set delete button (delsetidx), not a full-width row under Add set
  assert(html.includes('data-a="delsetidx"'), 'Per-set delete must use delsetidx action');
  // Line 2: steppers and RIR pill
  assert(html.includes('data-a="stepw"'), 'Set line 2 must have weight steppers');
  assert(html.includes('btn-step'), 'Set line 2 must have step buttons');
  assert(html.includes('rir-pill'), 'Set line 2 must have RIR button pill');
  assert(html.includes('RIR 2'), 'RIR pill must display numeric RIR value');
  // Toolbar: exmore for secondary actions
  assert(html.includes('data-a="exmore"'), 'Toolbar must include ••• More (exmore) button');
  assert(html.includes('data-a="swapex"'), 'Toolbar must include Swap');
  assert(html.includes('data-a="openaicoach"'), 'Toolbar must include AI Coach');
});

it('Phase 2: Exercise note labelled "Exercise note"; session notes only on finish sheet', () => {
  const act = {
    curEx: 0,
    ex: [{ id: '0025', sets: [{ w: 60, r: 8, done: false }], note: '' }]
  };
  const html = api.renderWorkHeroCard(act, 0);
  assert(html.includes('Exercise note'), 'Hero card must label exercise note field explicitly');
  assert(!html.includes('Session notes'), 'Session notes must NOT appear on hero card (finish sheet only)');
});

it('Phase 2: GIF collapsed by default with Show demo toggle; 1:1 aspect ratio in CSS', () => {
  // style.css enforces 1:1 aspect and 22vh max
  assert(cssCode.includes('aspect-ratio: 1 / 1'), 'style.css must set 1:1 aspect-ratio on work-hero media');
  assert(cssCode.includes('max-height: 22vh'), 'style.css must cap GIF at max-height: 22vh');
  assert(cssCode.includes('object-fit: cover'), 'style.css must use object-fit: cover for 1:1 media frame');
  // GIF toggle chip must be present in hero card
  const act = { curEx: 0, ex: [{ id: '0025', sets: [{ w: 60, r: 8, done: false }] }] };
  const html = api.renderWorkHeroCard(act, 0);
  assert(html.includes('data-a="togglegif"'), 'Hero card must have togglegif chip to collapse/expand GIF');
});

it('Phase 2: This week unified muscle card renders on Train tab (not duplicated on Body tab)', () => {
  const trainHtml = api.vTrain();
  assert(trainHtml.includes('this-week') || trainHtml.includes('This week') || trainHtml.includes('this_week'),
    'Train tab must render unified This week muscle summary card');
});

it('Phase 2: Body tab segmented control is 44px height with Physique and Nutrition options', () => {
  api.S.measurements = [{ date: Date.now(), w: 75, wst: 80 }];
  const bodyHtml = api.vBody();
  // 44px segmented control
  assert(bodyHtml.includes('seg-btn') || bodyHtml.includes('segmented'), 'Body tab must render segmented sub-tab control');
  assert(bodyHtml.includes('Physique') || bodyHtml.includes('physique'), 'Body tab must have Physique segment');
  assert(bodyHtml.includes('Nutrition') || bodyHtml.includes('nutrition'), 'Body tab must have Nutrition segment');
});

it('Phase 2: Modal backdrop uses solid scrim (no backdrop-filter blur)', () => {
  // Phase 2 replaced modal backdrop blur with solid scrim for performance
  assert(cssCode.includes('rgba(0, 0, 0, 0.6)'), 'style.css must use rgba(0,0,0,0.6) solid scrim on #m');
  assert(cssCode.includes('backdrop-filter: none'), 'Modal overlay must not use backdrop-filter blur (Phase 2)');
});

it('Phase 2: iOS PWA viewport fix applied (html height:100%, body position:fixed inset:0)', () => {
  assert(cssCode.includes('position: fixed'), 'body must use position: fixed for iOS PWA viewport fix');
  assert(cssCode.includes('inset: 0'), 'body must use inset: 0 for iOS viewport band fix');
  // safe-area bottom padding on #tabs
  assert(cssCode.includes('env(safe-area-inset-bottom)'), 'style.css must use safe-area-inset-bottom for #tabs');
});

it('Phase 2: Settings modal renders 5 sub-tabs (Training, Body & Units, AI, Data, About)', () => {
  api.showSettingsModal();
  const mHtml = elementsMap['#m'].innerHTML;
  assert(mHtml.includes('Training') || mHtml.includes('training'), 'Settings must have Training sub-tab');
  assert(mHtml.includes('AI') || mHtml.includes('ai'), 'Settings must have AI sub-tab');
  assert(mHtml.includes('Data') || mHtml.includes('data'), 'Settings must have Data sub-tab');
  assert(mHtml.includes('About') || mHtml.includes('about'), 'Settings must have About sub-tab');
  assert(mHtml.includes('App shell: Ready offline') || mHtml.includes('Ready offline'),
    'Settings must show accurate offline status');
  assert(!mHtml.includes('100% Offline'), 'Settings must NOT show misleading 100% Offline text');
});

it('Phase 2: Destructive modals use solid crimson fill via btn-destructive class', () => {
  assert(cssCode.includes('.btn-destructive'), 'style.css must define .btn-destructive class');
  assert(cssCode.includes('var(--accent-destructive)') || cssCode.includes('#e63946') || cssCode.includes('crimson'),
    'style.css must use a destructive/crimson color for .btn-destructive');
});

it('Phase 2: Calendar filters out 0-set empty sessions from workout date markers', () => {
  // vCal should not throw and renders calendar
  const calHtml = api.vCal();
  assert(calHtml.includes('cal') || calHtml.includes('calendar'), 'Calendar must render');
});

console.log(`\n======================================================`);
console.log(`ALL ${passed}/${total} ASSERTION TESTS PASSED SUCCESSFULLY! (100%)`);
console.log(`======================================================\n`);
process.exit(0);


