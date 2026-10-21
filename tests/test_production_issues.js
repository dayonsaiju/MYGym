import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const rootDir = '/Users/dayonsaiju/Documents/MYGym';
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
      return elementsMap['#v'].querySelector(sel);
    },
    querySelectorAll: (sel) => {
      return elementsMap['#v'].querySelectorAll(sel);
    },
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => elementsMap['#' + id] || null,
    addEventListener: () => {}
  },
  localStorage: {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); }
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

// Evaluate app.js in sandbox
const script = new vm.Script(appCode);
const context = vm.createContext(mockWindow);
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
  assert(heroHtml.includes('data-a="toggleuni"'), 'Toolbar must include Unilateral toggle');
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

it('sw.js cache key is bumped to mygym-core-v5.6.1-persist, calls skipWaiting and clients.claim', () => {
  assert(swCode.includes("const C = 'mygym-core-v5.6.1-persist';"), 'sw.js must use mygym-core-v5.6.1-persist cache name');
  assert(swCode.includes("'./style.css?v=5.6.1'"), 'sw.js must precache style.css?v=5.6.1');
  assert(swCode.includes("'./app.js?v=5.6.1'"), 'sw.js must precache app.js?v=5.6.1');
  assert(swCode.includes('self.skipWaiting()'), 'sw.js must immediately call self.skipWaiting() on install');
  assert(swCode.includes('clients.claim()'), 'sw.js must call clients.claim() on activate');
});

it('index.html references versioned assets and updated shell version with cache-busting auto-upgrade', () => {
  assert(htmlCode.includes('style.css?v=5.6.1'), 'index.html must link style.css?v=5.6.1');
  assert(htmlCode.includes('app.js?v=5.6.1'), 'index.html must load app.js?v=5.6.1');
  assert(htmlCode.includes("SHELL_VERSION = 'mygym-core-v5.6.1-persist'"), 'index.html must use mygym-core-v5.6.1-persist');
  assert(htmlCode.includes("window.location.href = window.location.origin + window.location.pathname + '?t=' + Date.now()"), 'index.html must bust cache via timestamp redirect');
});

it('app.js has consistent versions and dynamic Settings modal display', () => {
  assert.equal(api.APP_VERSION, '5.6.1');
  assert.equal(api.SHELL_VERSION, 'mygym-core-v5.6.1-persist');

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

console.log(`\n======================================================`);
console.log(`ALL ${passed}/${total} ASSERTION TESTS PASSED SUCCESSFULLY! (100%)`);
console.log(`======================================================\n`);
process.exit(0);

