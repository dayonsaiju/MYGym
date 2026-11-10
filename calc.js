/**
 * calc.js - Pure Mathematical and Derived Statistics Engine for MyGyM (v5.9.0)
 * ZERO DOM access. Pure functions for Node.js test execution and iOS PWA runtime.
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    const calc = factory();
    root.MYGYM_CALC = calc;
    root.Calc = calc;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // 1. Rounding and Unit Conversions (Weights stored in kg internally, rounded to 0.01)
  const roundWeight = (w, step = 0.01) => {
    const num = Number(w);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.round(num / step) * step;
  };

  const rd = n => Math.round((Number(n) || 0) * 10) / 10;
  const lbsToKg = lbs => roundWeight((Number(lbs) || 0) * 0.45359237, 0.01);
  const kgToLbs = kg => rd((Number(kg) || 0) * 2.20462262);

  const toKg = (val, unit = 'kg') => {
    return unit === 'lbs' ? lbsToKg(val) : roundWeight(val, 0.01);
  };

  const fromKg = (val, unit = 'kg') => {
    return unit === 'lbs' ? kgToLbs(val) : rd(val);
  };

  // 2. Date Formatting and Calendar Week Bucketing (Prevent Timezone & DST errors)
  const toLocalDateKey = d => {
    const date = (d instanceof Date) ? d : new Date(d);
    if (isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const dk = t => {
    const d = new Date(t);
    return d.getFullYear() * 1e4 + (d.getMonth() + 1) * 100 + d.getDate();
  };

  const getStartOfWeek = (dateOrTime, weekStartDay = 'mon') => {
    const d = new Date(dateOrTime);
    if (isNaN(d.getTime())) return new Date();
    const day = d.getDay(); // 0 is Sun, 1 is Mon...
    const diff = weekStartDay === 'sun'
      ? day
      : (day === 0 ? 6 : day - 1);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff, 0, 0, 0, 0);
  };

  const getEndOfWeek = (dateOrTime, weekStartDay = 'mon') => {
    const start = getStartOfWeek(dateOrTime, weekStartDay);
    // Use calendar date math instead of millisecond addition to remain completely immune to DST transitions
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
  };

  // 3. 1RM & True PR Engine
  const brzycki = (w, r) => {
    w = Number(w); r = Number(r);
    if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r < 1) return 0;
    if (r === 1) return rd(w);
    const cappedR = Math.min(10, r);
    return rd((w * 36) / (37 - cappedR));
  };

  const epley = (w, r) => {
    w = Number(w); r = Number(r);
    if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r < 1) return 0;
    if (r === 1) return rd(w);
    return rd(w * (1 + r / 30));
  };

  const estimate1RM = (w, r) => {
    w = Number(w); r = Number(r);
    if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r < 1) return 0;
    if (r <= 10) return brzycki(w, r);
    return epley(w, r);
  };

  const isWarmupSet = s => Boolean(s && (s.type === 'W' || s.type === 'warmup' || s.isWarmup));
  const isSetDone = (s, uni = false) => {
    if (!s) return false;
    if (s.done === true) return true;
    if (s.done === false) return false;
    if (uni) return Boolean(s.sideL && s.sideR);
    return Boolean(Number(s.r) > 0 && !isWarmupSet(s));
  };

  const isDumbbellMovement = ex => {
    if (!ex) return false;
    const eq = (ex.eq || '').toLowerCase();
    const name = (ex.name || '').toLowerCase();
    return eq.includes('dumbbell') || name.includes('dumbbell') || name.includes('db ');
  };

  const isCardioOrMobility = ex => {
    if (!ex) return false;
    if (ex.type === 'timed_cardio' || ex.t === 't' || ex.bp === 'cardio' || ex.g === 'Cardio' || ex.g === 'Mobility') return true;
    const n = (ex.name || '').toLowerCase();
    return n.includes('stretch') || n.includes('mobility') || n.includes('cardio') || n.includes('treadmill') || n.includes('elliptical') || n.includes('bike') || n.includes('rowing machine') || n.includes('jumping jack');
  };

  const isBodyweightMovement = ex => {
    if (!ex) return false;
    return ex.type === 'bodyweight' || ex.t === 'b' || (ex.name || '').toLowerCase().includes('bodyweight');
  };

  const isAssistedMovement = ex => {
    if (!ex) return false;
    return ex.type === 'assisted' || ex.t === 'a' || (ex.name || '').toLowerCase().includes('assisted');
  };

  // 4. PR Detection Engine
  const checkPersonalRecord = (exId, set, historyLogs = [], uni = false, currentLogId = null, currentLogDate = null) => {
    if (!set || !isSetDone(set, uni) || isWarmupSet(set)) return null;
    const w = Number(set.w) || 0;
    const r = Number(set.r) || 0;
    if (r < 1) return null;

    // Filter history strictly EXCLUDING the current session
    const validHistory = (historyLogs || []).filter(l => {
      if (!l) return false;
      if (currentLogId && String(l.id) === String(currentLogId)) return false;
      if (currentLogDate && l.date >= currentLogDate) return false;
      return true;
    });

    let maxWeight = 0;
    let maxRepsAtWeight = 0;
    let max1RM = 0;
    const targetIdStr = String(exId || '');

    for (const l of validHistory) {
      if (!Array.isArray(l.ex)) continue;
      for (const x of l.ex) {
        if (String(x.id) !== targetIdStr || !Array.isArray(x.sets)) continue;
        const xUni = uni || Boolean(x.uni);
        for (const s of x.sets) {
          if (!isSetDone(s, xUni) || isWarmupSet(s)) continue;
          const sw = Number(s.w) || 0;
          const sr = Number(s.r) || 0;
          if (sr < 1) continue;

          if (sw > maxWeight) maxWeight = sw;
          if (Math.abs(sw - w) < 0.01 && sr > maxRepsAtWeight) maxRepsAtWeight = sr;
          const s1rm = estimate1RM(sw, sr);
          if (s1rm > max1RM) max1RM = s1rm;
        }
      }
    }

    const cur1RM = estimate1RM(w, r);

    // If no prior history exists at all for this exercise, first set establishes baseline
    if (max1RM === 0 && maxWeight === 0) {
      return null;
    }

    // Flag drop/failure sets so they count toward volume/fatigue without polluting standard rep PR comparisons
    const isDropOrFailure = set.type === 'drop' || set.type === 'failure';

    if (w > maxWeight && w > 0 && !isDropOrFailure) {
      return {
        isPR: true,
        type: 'weight',
        oldVal: maxWeight,
        newVal: w,
        diff: rd(w - maxWeight),
        w, r, e1RM: cur1RM,
        flag: null,
        get desc() {
          return `New Heavy Weight PR: ${w} kg (+${rd(w - maxWeight)} kg)`;
        }
      };
    }

    if (cur1RM > max1RM && cur1RM > 0 && !isDropOrFailure) {
      return {
        isPR: true,
        type: '1rm',
        oldVal: max1RM,
        newVal: cur1RM,
        diff: rd(cur1RM - max1RM),
        w, r, e1RM: cur1RM,
        flag: null,
        get desc() {
          return `New Estimated 1RM PR: ${cur1RM} kg (+${rd(cur1RM - max1RM)} kg)`;
        }
      };
    }

    if (r > maxRepsAtWeight && maxRepsAtWeight > 0 && w > 0 && !isDropOrFailure) {
      return {
        isPR: true,
        type: 'reps',
        oldVal: maxRepsAtWeight,
        newVal: r,
        diff: r - maxRepsAtWeight,
        w, r, e1RM: cur1RM,
        flag: null,
        get desc() {
          return `New Rep PR at ${w} kg: ${r} reps (+${r - maxRepsAtWeight} reps)`;
        }
      };
    }

    if (isDropOrFailure) {
      return {
        isPR: false,
        flag: set.type,
        w, r, e1RM: cur1RM
      };
    }

    return null;
  };

  // 5. Tonnage & Volume
  // Single default: includeBodyweightInVolume defaults to FALSE
  const calcSetVolume = (s, ex = null, cfg = {}, userBodyweight = 75) => {
    if (!s || !isSetDone(s, ex?.uni)) return 0;
    // Warmup sets never count toward volume
    if (isWarmupSet(s)) return 0;
    if (ex && isCardioOrMobility(ex)) return 0;

    const r = Math.max(0, Number(s.r) || 0);
    if (r <= 0) return 0;

    let w = Math.max(0, Number(s.w) || 0);
    const bw = Math.max(30, Number(userBodyweight) || 75);

    // Single source of truth default: includeBodyweightInVolume is FALSE
    const includeBw = cfg && cfg.includeBodyweightInVolume === true;

    if (ex && isBodyweightMovement(ex)) {
      if (includeBw) {
        w = bw + (w > 0 ? w : 0);
      } else {
        w = (w > 0 ? w : 0);
      }
    } else if (ex && isAssistedMovement(ex)) {
      w = Math.max(0, bw - w);
    }

    const isUni = Boolean(ex?.uni || s.uni);
    const hasBoth = Boolean(s.done || (s.sideL && s.sideR));
    const hasOne = Boolean(s.sideL || s.sideR);
    let mult = isUni ? (hasBoth ? 2 : (hasOne ? 1 : 2)) : 1;

    // Dumbbell convention: per_hand (x2 for volume) vs as_logged (x1)
    const dbMode = cfg.dumbbellWeightMode || cfg.dumbbellConvention || 'per_hand';
    if (ex && isDumbbellMovement(ex) && dbMode === 'per_hand' && !isUni) {
      mult *= 2;
    }

    return roundWeight(w * r * mult, 0.01);
  };

  const calcWorkoutVolume = (workout, cfg = {}, userBodyweight = 75, exLookup = null) => {
    if (!workout || !Array.isArray(workout.ex)) return 0;
    let total = 0;
    for (const x of workout.ex) {
      const exObj = exLookup ? exLookup(x.id) : (x.exInfo || x);
      if (exObj && isCardioOrMobility(exObj)) continue;
      if (!Array.isArray(x.sets)) continue;
      for (const s of x.sets) {
        total += calcSetVolume(s, exObj || x, cfg, userBodyweight);
      }
    }
    return Math.round(total);
  };

  const vol = (l, cfg = {}, userBodyweight = 75) => calcWorkoutVolume(l, cfg, userBodyweight);

  // 6. ACWR (Acute:Chronic Workload Ratio)
  const calcACWR = (logs = [], referenceDate = Date.now(), cfg = {}, userBodyweight = 75, exLookup = null) => {
    const refTime = referenceDate instanceof Date ? referenceDate.getTime() : (typeof referenceDate === 'number' ? referenceDate : Date.now());
    const dayMs = 86400000;
    const acuteCutoff = refTime - 7 * dayMs;
    const chronicCutoff = refTime - 28 * dayMs;

    // Sort chronologically ascending to handle backdated logging
    const sorted = (logs || [])
      .filter(l => l && l.date != null && !isNaN(new Date(l.date).getTime()))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let acuteVolume = 0;
    let chronicVolumeTotal = 0;
    let acuteWorkouts = 0;
    let chronicWorkouts = 0;
    const distinctDaysSet = new Set();
    const validLogDates = [];

    for (const l of sorted) {
      const lDate = new Date(l.date).getTime();
      if (lDate > refTime + 3600000) continue;
      validLogDates.push(lDate);

      const logVol = calcWorkoutVolume(l, cfg, userBodyweight, exLookup);

      if (lDate >= acuteCutoff && lDate <= refTime + 3600000) {
        acuteVolume += logVol;
        acuteWorkouts++;
      }
      if (lDate >= chronicCutoff && lDate <= refTime + 3600000) {
        chronicVolumeTotal += logVol;
        chronicWorkouts++;
        distinctDaysSet.add(toLocalDateKey(lDate));
      }
    }

    const distinctWorkoutDays = distinctDaysSet.size;
    const earliestDate = validLogDates.length ? validLogDates[0] : null;
    const totalHistoryDays = earliestDate ? Math.max(1, Math.floor((refTime - earliestDate) / dayMs) + 1) : 0;

    // Baseline Gate: < 7 distinct workout days OR < 14 days of history
    const isCalibrating = distinctWorkoutDays < 7 || totalHistoryDays < 14;
    const calibDay = Math.min(14, Math.max(validLogDates.length ? 1 : 0, totalHistoryDays));

    const chronicWeeklyAvg = Math.round(chronicVolumeTotal / 4);
    acuteVolume = Math.round(acuteVolume);

    if (isCalibrating) {
      return {
        acuteVolume,
        chronicWeeklyAvg,
        acwr: 'Calibrating',
        acwrNum: null,
        acwrDisplay: 'Calibrating',
        isCalibrating: true,
        distinctWorkoutDays,
        totalHistoryDays,
        calibDay,
        zoneCode: 'calibrating',
        acuteWorkouts,
        chronicWorkouts
      };
    }

    let acwr = 0;
    if (chronicWeeklyAvg > 0) {
      acwr = Math.round((acuteVolume / chronicWeeklyAvg) * 100) / 100;
    } else if (acuteVolume > 0) {
      acwr = 1.0;
    }

    let zoneCode = 'optimal';
    if (acwr < 0.8) {
      zoneCode = 'under';
    } else if (acwr <= 1.3) {
      zoneCode = 'optimal';
    } else if (acwr <= 1.5) {
      zoneCode = 'caution';
    } else {
      zoneCode = 'danger';
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
      zoneCode,
      acuteWorkouts,
      chronicWorkouts
    };
  };

  // 7. Streak Engine (Local date keys)
  const calcStreak = (logs = [], referenceDate = Date.now()) => {
    const s = new Set((logs || []).map(l => toLocalDateKey(l.date)).filter(Boolean));
    const ref = new Date(referenceDate);
    let d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    let n = 0;

    if (!s.has(toLocalDateKey(d))) {
      d.setDate(d.getDate() - 1);
    }

    while (s.has(toLocalDateKey(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  };

  // 8. Weekly 2x Muscle Frequency Tracker (12 Target Muscles)
  const FULL_MUSCLE_TARGETS = [
    'Chest',
    'Back',
    'Quads',
    'Hamstrings',
    'Glutes',
    'Deltoids',
    'Biceps',
    'Triceps',
    'Calves',
    'Forearms',
    'Abs',
    'Obliques'
  ];

  const getStimulatedMuscleGroups = (e) => {
    const groups = new Set();
    if (!e) return groups;
    const g = (e.g || '').toLowerCase();
    const tg = (e.tg || '').toLowerCase();
    const n = (e.name || '').toLowerCase();

    // 1. Chest
    if (g === 'chest' || tg === 'pectorals' || n.includes('bench press') || n.includes('chest') || n.includes('fly') || n.includes('pec deck')) {
      groups.add('Chest');
    }
    // 2. Back
    if (g === 'back' || ['lats', 'upper back', 'spine', 'traps', 'rhomboids'].includes(tg) || n.includes('pull') || n.includes('row') || n.includes('lat') || n.includes('deadlift') || n.includes('shrug')) {
      groups.add('Back');
    }
    // 3. Quads
    if (tg === 'quads' || (g === 'legs' && (n.includes('squat') || n.includes('quad') || n.includes('leg press') || (n.includes('extension') && !n.includes('back')) || n.includes('lunge') || n.includes('hack squat') || n.includes('split squat')))) {
      groups.add('Quads');
    }
    // 4. Hamstrings
    if (tg === 'hamstrings' || (g === 'legs' && (n.includes('leg curl') || n.includes('hamstring') || n.includes('rdl') || n.includes('romanian') || n.includes('good morning') || n.includes('stiff-leg') || n.includes('nordic')))) {
      groups.add('Hamstrings');
    }
    // 5. Glutes
    if (tg === 'glutes' || (g === 'legs' && (n.includes('hip thrust') || n.includes('glute') || n.includes('kickback') || n.includes('bridge') || n.includes('step-up') || n.includes('abductor')))) {
      groups.add('Glutes');
    }
    // 6. Deltoids
    if (g === 'shoulders' || tg === 'delts' || ['deltoids', 'front delts', 'side delts', 'rear delts'].includes(tg) || n.includes('shoulder') || n.includes('overhead press') || n.includes('lateral raise') || n.includes('military') || n.includes('arnold press') || n.includes('rear delt')) {
      groups.add('Deltoids');
    }
    // 7. Biceps
    if (tg === 'biceps' || n.includes('bicep') || (n.includes('curl') && !n.includes('leg') && !n.includes('hamstring') && !n.includes('wrist')) || n.includes('chin-up')) {
      groups.add('Biceps');
    }
    // 8. Triceps
    if (tg === 'triceps' || n.includes('tricep') || n.includes('pushdown') || n.includes('skull crusher') || n.includes('french press') || n.includes('close-grip bench') || n.includes('triceps dip')) {
      groups.add('Triceps');
    }
    // 9. Calves
    if (tg === 'calves' || n.includes('calf') || n.includes('calves') || n.includes('donkey raise') || n.includes('toe press')) {
      groups.add('Calves');
    }
    // 10. Forearms
    if (tg === 'forearms' || n.includes('forearm') || n.includes('wrist curl') || n.includes('farmer') || n.includes('dead hang')) {
      groups.add('Forearms');
    }
    // 11. Abs
    if (g === 'core' || tg === 'abs' || n.includes('crunch') || n.includes('sit-up') || n.includes('leg raise') || (n.includes('plank') && !n.includes('side plank')) || n.includes('ab wheel')) {
      groups.add('Abs');
    }
    // 12. Obliques
    if (tg === 'obliques' || tg === 'serratus anterior' || n.includes('oblique') || n.includes('russian twist') || n.includes('side plank') || n.includes('woodchopper') || n.includes('pallof') || n.includes('serratus')) {
      groups.add('Obliques');
    }

    return groups;
  };

  const calcWeeklyMuscleFrequency = (logs = [], refDate = Date.now(), weekStartDay = 'mon', options = {}, exLookup = null) => {
    const refTime = refDate instanceof Date ? refDate.getTime() : (typeof refDate === 'number' ? refDate : Date.now());
    const sevenDaysAgo = refTime - 7 * 86400000;
    const startOfWeek = getStartOfWeek(refTime, weekStartDay).getTime();
    const endOfWeek = getEndOfWeek(refTime, weekStartDay).getTime();

    const calLogs = (logs || []).filter(l => l && l.date >= startOfWeek && l.date <= endOfWeek);
    const rollingLogs = (logs || []).filter(l => l && l.date >= sevenDaysAgo && l.date <= refTime);

    // Default to rolling 7 days; use calendar week when mode === 'calendar' or useCalendarWeek === true
    let recentLogs;
    if (options.mode === 'calendar' || options.useCalendarWeek === true) {
      recentLogs = calLogs;
    } else {
      recentLogs = rollingLogs;
    }

    const dayGroups = {};
    const setGroups = {};
    for (const target of FULL_MUSCLE_TARGETS) {
      dayGroups[target] = new Set();
      setGroups[target] = 0;
    }

    for (const log of recentLogs) {
      const dayKey = toLocalDateKey(log.date);
      for (const x of (log.ex || [])) {
        const e = exLookup ? exLookup(x.id) : (x.exInfo || x);
        const stimulated = getStimulatedMuscleGroups(e);
        const validSets = Array.isArray(x.sets) ? x.sets.filter(s => s && (s.done || Number(s.r) > 0)).length : 0;
        for (const grp of stimulated) {
          if (dayGroups[grp]) dayGroups[grp].add(dayKey);
          if (typeof setGroups[grp] === 'number') setGroups[grp] += validSets;
        }
      }
    }

    const res = FULL_MUSCLE_TARGETS.map(target => {
      const count = dayGroups[target] ? dayGroups[target].size : 0;
      const sets = setGroups[target] || 0;
      const volStatus = calcMuscleVolumeStatus(sets);
      const opt = count >= 2;
      const partial = count === 1;
      const pips = opt ? `●● (${count}/2 Opt)` : (partial ? '●○ (1/2)' : '○○ (0/2)');
      return {
        muscle: target,
        count,
        days: count,
        sets,
        volumeStatus: volStatus,
        target: 2,
        status: opt ? 'optimal' : (partial ? 'moderate' : 'none'),
        pips
      };
    });

    for (const item of res) {
      res[item.muscle] = item;
    }

    // Aliases for backward compatibility
    res['Shoulders'] = res['Deltoids'];
    res['Arms'] = res['Biceps'];
    res['Hamstrings/Glutes'] = res['Hamstrings'];
    res['Core'] = res['Abs'];

    return res;
  };

  // 9. Progression & "Prev" Prefill
  const getPrevPerformance = (exerciseId, logs = [], beforeTimestamp = Date.now()) => {
    const sid = String(exerciseId || '');
    const beforeTime = beforeTimestamp instanceof Date ? beforeTimestamp.getTime() : Number(beforeTimestamp) || Date.now();

    const sorted = (logs || [])
      .filter(l => l && l.date != null && new Date(l.date).getTime() < beforeTime)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    for (const l of sorted) {
      if (!Array.isArray(l.ex)) continue;
      const found = l.ex.find(x => String(x.id) === sid);
      if (found && Array.isArray(found.sets)) {
        const completedSets = found.sets.filter(s => isSetDone(s, found.uni));
        if (completedSets.length > 0) {
          return {
            ...found,
            sets: completedSets,
            date: l.date,
            logName: l.name || 'Previous Workout',
            lastSet: completedSets[completedSets.length - 1]
          };
        }
      }
    }
    return null;
  };

  const checkDoubleProgression = (rx, completedSets = [], equipment = 'barbell', unit = 'kg') => {
    if (!rx) return null;
    const targetSets = Array.isArray(rx.sets) ? rx.sets.length : (Number(rx.sets) || 3);
    const repFloor = Number(rx.reps) || 8;
    const repCeiling = Math.max(repFloor, Number(rx.reps2) || Number(rx.cur) || repFloor);

    const done = (Array.isArray(completedSets) ? completedSets : []).filter(s => isSetDone(s, rx.uni));
    if (done.length < targetSets) return null;

    // Suggest increment only when ALL working sets hit the rep ceiling
    const allHitCeiling = done.slice(0, targetSets).every(s => (Number(s.r) || 0) >= repCeiling);
    if (!allHitCeiling) return null;

    let inc = 2.5;
    const eq = (equipment || '').toLowerCase();
    if (eq.includes('dumbbell') || eq.includes('db')) inc = unit === 'lbs' ? 5 : 2.0;
    else if (eq.includes('machine') || eq.includes('cable')) inc = unit === 'lbs' ? 10 : 5.0;
    else inc = unit === 'lbs' ? 5 : 2.5;

    return {
      eligible: true,
      suggestedInc: inc,
      repCeiling,
      message: `All ${targetSets} sets hit rep ceiling (${repCeiling})! Suggest +${inc}${unit}`
    };
  };

  // 10. US Navy Body Fat % Math
  const calcNavyBodyFat = (gender = 'male', heightCm, waistCm, neckCm, hipCm = 0) => {
    const isFemale = gender === 'female';
    const h = Number(heightCm);
    const waist = Number(waistCm);
    const neck = Number(neckCm);
    const hip = Number(hipCm);

    if (!h || !waist || !neck || h <= 0 || waist <= 0 || neck <= 0) return null;

    let bf;
    if (isFemale) {
      if (!hip || hip <= 0 || (waist + hip - neck) <= 0) return null;
      const term = waist + hip - neck;
      bf = 495 / (1.29579 - 0.35004 * Math.log10(term) + 0.22100 * Math.log10(h)) - 450;
    } else {
      if ((waist - neck) <= 0) return null;
      const term = waist - neck;
      bf = 495 / (1.0324 - 0.19077 * Math.log10(term) + 0.15456 * Math.log10(h)) - 450;
    }

    if (!Number.isFinite(bf)) return null;
    return Math.max(3.0, Math.min(60.0, rd(bf)));
  };

  // 11. BMR (Mifflin-St Jeor) & Macros
  const calcBMR = (gender, weightKg, heightCm, age) => {
    const w = Number(weightKg);
    const h = Number(heightCm);
    const a = Number(age);
    const g = String(gender || '').toLowerCase();
    const isFemale = g === 'female';
    const isMale = g === 'male';

    if (!isFemale && !isMale) {
      return { status: 'needs_profile', bmr: null, missing: 'gender' };
    }
    if (!w || w <= 0 || !h || h <= 0 || !a || a <= 0) {
      return { status: 'needs_profile', bmr: null, missing: !w ? 'weight' : (!h ? 'height' : 'age') };
    }

    // Mifflin-St Jeor: 10·kg + 6.25·cm − 5·age + 5 (male) or −161 (female)
    const base = 10 * w + 6.25 * h - 5 * a;
    return Math.round(isFemale ? base - 161 : base + 5);
  };

  const calcTDEE = (bmr, activityMultiplier = 1.45) => {
    if (bmr && typeof bmr === 'object' && bmr.status === 'needs_profile') {
      return { status: 'needs_profile', tdee: null };
    }
    const b = Number(bmr);
    if (!b || b <= 0) {
      return { status: 'needs_profile', tdee: null };
    }
    const mult = Number(activityMultiplier) || 1.45;
    return Math.round(b * mult);
  };

  const calcMacros = (targetCalories, weightKg, goal = 'cut') => {
    const cals = Number(targetCalories);
    const w = Number(weightKg);
    if (!cals || cals <= 0 || !w || w <= 0) {
      return {
        status: 'needs_profile',
        calories: 0,
        protein: 0,
        proteinKcal: 0,
        fat: 0,
        fatKcal: 0,
        carbs: 0,
        carbKcal: 0,
        warning: 'Profile setup required (target calories and weight)'
      };
    }

    // Target protein: 2.0g per kg bodyweight (clamped between 50g and 300g)
    const proteinG = Math.min(300, Math.max(50, Math.round(w * 2.0)));
    const proteinKcal = proteinG * 4;

    // Fat floor: at least 30g and at least 0.8g per kg bodyweight
    const fatFloorG = Math.max(30, Math.round(w * 0.8));
    const fatG = Math.max(fatFloorG, Math.round((cals * 0.25) / 9));
    const fatKcal = fatG * 9;

    let carbKcal = cals - proteinKcal - fatKcal;
    let carbG = Math.round(carbKcal / 4);
    let warning = null;

    if (carbG <= 0) {
      carbG = 0;
      carbKcal = 0;
      warning = 'Carbs clamped at 0g on aggressive deficit. Consider increasing calorie target.';
    }

    return {
      status: 'ok',
      calories: Math.round(cals),
      protein: proteinG,
      proteinKcal,
      fat: fatG,
      fatKcal,
      carbs: carbG,
      carbKcal,
      warning
    };
  };

  // 13. Scientific Calorie Burn & Resistance EPOC Engine
  const calcEPOCBurn = activeCalories => {
    const cals = Math.max(0, Number(activeCalories) || 0);
    // Resistance training afterburn (EPOC) is ~12% of total active session calories
    return Math.round(cals * 0.12);
  };

  const calcWorkoutCalorieBurn = (durationMs, weightKg = 75, avgMET = 5.5, volumeKg = 0) => {
    const dur = Math.max(0, Number(durationMs) || 0);
    const wt = Math.max(0, Number(weightKg) || 75);
    let met = Math.max(0, Number(avgMET) || 5.5);
    const volume = Math.max(0, Number(volumeKg) || 0);

    if (dur <= 0 || wt <= 0) {
      return { activeCals: 0, epocCals: 0, totalBurn: 0 };
    }

    // High mechanical tension / high volume session scales MET up to 6.0
    if (volume > 5000 && met < 6.0) {
      met = 6.0;
    }

    // Active Calories = ((MET * 3.5 * weightKg) / 200) * (durationMs / 60000)
    const activeCals = ((met * 3.5 * wt) / 200) * (dur / 60000);
    const epocCals = calcEPOCBurn(activeCals);

    return {
      activeCals: Math.round(activeCals),
      epocCals: Math.round(epocCals),
      totalBurn: Math.round(activeCals + epocCals)
    };
  };

  // 14. Barbell Plate Calculator (Deterministic Float Math)
  const calcPlates = (totalWeight, barWeight = 20, plateTypes = [20, 15, 10, 5, 2.5, 1.25]) => {
    const tot = Math.max(0, Number(totalWeight) || 0);
    const bar = Math.max(0, Number(barWeight) || 0);
    const targetPerSide = Math.max(0, (tot - bar) / 2);
    const sortedPlates = [...plateTypes].map(Number).sort((a, b) => b - a);
    let rem = targetPerSide;
    const plates = [];
    for (const p of sortedPlates) {
      if (p <= 0) continue;
      const count = Math.floor((rem + 0.0001) / p);
      if (count > 0) {
        plates.push({ weight: p, count });
        rem = Math.round((rem - count * p) * 100) / 100;
      }
    }
    const loadedPerSide = plates.reduce((sum, r) => sum + r.weight * r.count, 0);
    const loadedWeight = roundWeight(bar + 2 * loadedPerSide, 0.01);
    return {
      barWeight: bar,
      perSide: roundWeight(targetPerSide, 0.01),
      weightPerSide: roundWeight(targetPerSide, 0.01),
      plates,
      remainder: roundWeight(rem, 0.01),
      rem: roundWeight(rem, 0.01),
      loadedWeight
    };
  };

  // 15. Hypertrophy Target Bands (MEV, MAV, MRV)
  const calcMuscleVolumeStatus = (sets = 0) => {
    const s = Math.max(0, Number(sets) || 0);
    if (s < 8) return { status: 'below_mev', min: 8, max: 10, label: 'Under MEV' };
    if (s <= 10) return { status: 'mev', min: 8, max: 10, label: 'MEV' };
    if (s <= 18) return { status: 'mav', min: 12, max: 18, label: 'MAV' };
    return { status: 'mrv', min: 20, max: null, label: 'MRV' };
  };

  // 16. Local Rule-Based Training Insights (Pure Deterministic Math)
  const calcTrainingInsights = (logs = [], routines = [], options = {}) => {
    const insights = [];
    if (!Array.isArray(logs) || !logs.length) {
      return insights;
    }

    // 1. ACWR Volume Spike check
    const acwrRes = calcACWR(logs, options.refDate || Date.now());
    if (acwrRes && typeof acwrRes.acwr === 'number' && acwrRes.acwr > 1.5 && acwrRes.status !== 'uncalibrated') {
      insights.push({
        type: 'acwr_spike',
        level: 'warning',
        title: 'Workload Volume Spike',
        acwr: acwrRes.acwr,
        message: `Acute workload is ${acwrRes.acwr.toFixed(2)}x chronic baseline (>1.5x threshold). Consider a lighter deload or rest day.`
      });
    }

    // 2. Stalled Lifts (exercises with failed progression across last 2+ sessions)
    const sortedLogs = [...logs].sort((a, b) => (Number(a.date || a.t0) || 0) - (Number(b.date || b.t0) || 0));
    const exHistories = new Map();
    for (const l of sortedLogs) {
      if (!Array.isArray(l.ex)) continue;
      for (const x of l.ex) {
        if (!x || !x.id || !Array.isArray(x.sets)) continue;
        const validSets = x.sets.filter(s => s && (s.done || Number(s.r) > 0));
        if (!validSets.length) continue;
        let maxW = 0, maxR = 0, rir0Count = 0;
        for (const s of validSets) {
          const w = Number(s.w) || 0;
          const r = Number(s.r) || 0;
          if (w > maxW || (w === maxW && r > maxR)) {
            maxW = w;
            maxR = r;
          }
          if (s.rir === 0 || s.rpe >= 10) rir0Count++;
        }
        if (!exHistories.has(x.id)) exHistories.set(x.id, []);
        exHistories.get(x.id).push({
          date: l.date || l.t0,
          name: x.name || 'Exercise',
          maxW,
          maxR,
          rir0Count
        });
      }
    }

    for (const [id, hist] of exHistories.entries()) {
      if (hist.length >= 2) {
        const last = hist[hist.length - 1];
        const prev = hist[hist.length - 2];
        const noWeightProg = last.maxW <= prev.maxW;
        const noRepProg = last.maxR <= prev.maxR;
        if (noWeightProg && noRepProg && (last.rir0Count > 0 || prev.rir0Count > 0)) {
          insights.push({
            type: 'stalled_lift',
            level: 'info',
            exId: id,
            name: last.name,
            weight: last.maxW,
            message: `${last.name} has stalled at ${last.maxW}kg with high fatigue across the last 2 sessions.`
          });
        }
      }
    }

    // 3. Neglected Muscle Groups (< MEV threshold, i.e. < 8 sets in the past 7 days)
    if (typeof options.getEx === 'function') {
      const freqs = calcWeeklyMuscleFrequency(logs, options.refDate || Date.now(), options.weekStart || 'mon', {}, options.getEx);
      const majorMuscles = ['Chest', 'Back', 'Quads', 'Hamstrings', 'Deltoids'];
      for (const m of majorMuscles) {
        const f = freqs.find(item => item.muscle === m);
        const count = f ? (f.count || 0) : 0;
        if (count === 0) {
          insights.push({
            type: 'neglected_muscle',
            level: 'tip',
            muscle: m,
            message: `${m} has 0 logged sessions this week (target: 2x/wk).`
          });
        }
      }
    }

    return insights;
  };

  // 17. Robust Third-Party CSV Importer (Strong, Hevy, MyGyM)
  const parseThirdPartyCSV = (csvText) => {
    if (!csvText || typeof csvText !== 'string') return [];
    const lines = csvText.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];

    const parseLine = line => {
      const result = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (c === ',' && !inQuotes) {
          result.push(cur.trim());
          cur = '';
        } else {
          cur += c;
        }
      }
      result.push(cur.trim());
      return result;
    };

    const rawHeaders = parseLine(lines[0]);
    const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

    let dateIdx = headers.findIndex(h => h.includes('date'));
    let workoutIdx = headers.findIndex(h => h.includes('workout') && !h.includes('notes'));
    let exIdx = headers.findIndex(h => h.includes('exercise') || h.includes('title'));
    let setIdx = headers.findIndex(h => h.includes('set') && !h.includes('type'));
    let weightIdx = headers.findIndex(h => h.includes('weight') || h.includes('kg') || h.includes('lbs'));
    let repsIdx = headers.findIndex(h => h.includes('reps'));
    let rpeIdx = headers.findIndex(h => h.includes('rpe'));
    let rirIdx = headers.findIndex(h => h.includes('rir'));
    let notesIdx = headers.findIndex(h => h.includes('note'));

    if (dateIdx === -1 || exIdx === -1) {
      return [];
    }

    const sessionMap = new Map();

    for (let i = 1; i < lines.length; i++) {
      const cols = parseLine(lines[i]);
      if (cols.length <= Math.max(dateIdx, exIdx)) continue;

      const rawDate = cols[dateIdx] || '';
      const parsedDate = new Date(rawDate);
      const dateVal = isNaN(parsedDate.getTime()) ? Date.now() : parsedDate.getTime();
      const dateKey = new Date(dateVal).toISOString().slice(0, 10);
      const workoutName = workoutIdx !== -1 && cols[workoutIdx] ? cols[workoutIdx] : 'Imported Workout';
      const exName = cols[exIdx] || 'Exercise';
      if (!exName) continue;

      const weight = weightIdx !== -1 ? Math.max(0, parseFloat(cols[weightIdx]) || 0) : 0;
      const reps = repsIdx !== -1 ? Math.max(0, parseInt(cols[repsIdx], 10) || 0) : 0;
      const rpe = rpeIdx !== -1 && cols[rpeIdx] !== '' ? parseFloat(cols[rpeIdx]) || null : null;
      const rir = rirIdx !== -1 && cols[rirIdx] !== '' ? parseInt(cols[rirIdx], 10) || null : null;
      const note = notesIdx !== -1 ? cols[notesIdx] || '' : '';

      const sessionKey = `${dateKey}_${workoutName}`;
      if (!sessionMap.has(sessionKey)) {
        sessionMap.set(sessionKey, {
          date: dateVal,
          name: workoutName,
          exercises: []
        });
      }

      const sess = sessionMap.get(sessionKey);
      let curEx = sess.exercises.find(e => e.name.toLowerCase() === exName.toLowerCase());
      if (!curEx) {
        curEx = {
          name: exName,
          note,
          sets: []
        };
        sess.exercises.push(curEx);
      }

      curEx.sets.push({
        w: weight,
        r: reps,
        done: true,
        ...(rpe != null ? { rpe } : {}),
        ...(rir != null ? { rir } : {})
      });
    }

    return Array.from(sessionMap.values());
  };

  return {
    roundWeight,
    rd,
    lbsToKg,
    kgToLbs,
    toKg,
    fromKg,
    toLocalDateKey,
    dk,
    getStartOfWeek,
    getEndOfWeek,
    brzycki,
    epley,
    estimate1RM,
    isWarmupSet,
    isSetDone,
    isDumbbellMovement,
    isCardioOrMobility,
    isBodyweightMovement,
    isAssistedMovement,
    checkPersonalRecord,
    calcSetVolume,
    calcWorkoutVolume,
    vol,
    calcACWR,
    calcStreak,
    FULL_MUSCLE_TARGETS,
    getStimulatedMuscleGroups,
    calcWeeklyMuscleFrequency,
    getPrevPerformance,
    checkDoubleProgression,
    calcNavyBodyFat,
    calcBMR,
    calcTDEE,
    calcMacros,
    calcEPOCBurn,
    calcWorkoutCalorieBurn,
    calcPlates,
    calcMuscleVolumeStatus,
    calcTrainingInsights,
    parseThirdPartyCSV
  };
});

