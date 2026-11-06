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
    return new Date(start.getTime() + 7 * 86400000 - 1);
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
  const isSetDone = (s, uni = false) => Boolean(s && (s.done || (uni && s.sideL && s.sideR)));

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

    if (w > maxWeight && w > 0) {
      return {
        isPR: true,
        type: 'weight',
        desc: `New Heavy Weight PR: ${w} kg (+${rd(w - maxWeight)} kg)`,
        oldVal: maxWeight,
        newVal: w,
        w, r, e1RM: cur1RM
      };
    }

    if (cur1RM > max1RM && cur1RM > 0) {
      return {
        isPR: true,
        type: '1rm',
        desc: `New Estimated 1RM PR: ${cur1RM} kg (+${rd(cur1RM - max1RM)} kg)`,
        oldVal: max1RM,
        newVal: cur1RM,
        w, r, e1RM: cur1RM
      };
    }

    if (r > maxRepsAtWeight && maxRepsAtWeight > 0 && w > 0) {
      return {
        isPR: true,
        type: 'reps',
        desc: `New Rep PR at ${w} kg: ${r} reps (+${r - maxRepsAtWeight} reps)`,
        oldVal: maxRepsAtWeight,
        newVal: r,
        w, r, e1RM: cur1RM
      };
    }

    return null;
  };

  // 5. Tonnage & Volume
  const calcSetVolume = (s, ex = null, cfg = {}, userBodyweight = 75) => {
    if (!s || !isSetDone(s, ex?.uni)) return 0;
    if (ex && isCardioOrMobility(ex)) return 0;

    const r = Math.max(0, Number(s.r) || 0);
    if (r <= 0) return 0;

    let w = Math.max(0, Number(s.w) || 0);
    const bw = Math.max(30, Number(userBodyweight) || 75);

    if (ex && isBodyweightMovement(ex)) {
      if (cfg.includeBodyweightInVolume !== false) {
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
        status: `⚡ Calibrating Baseline (Day ${calibDay} of 14) 🔵`,
        zoneCode: 'calibrating',
        color: 'var(--bl)',
        desc: 'Log workouts over 2-3 weeks to build your chronic fatigue baseline.',
        tooltip: 'Log workouts over 2-3 weeks to build your chronic fatigue baseline.',
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
      desc = 'Sweet spot for hypertrophy and safe progression';
    } else if (acwr <= 1.5) {
      status = 'Overreaching Caution Zone 🟡';
      zoneCode = 'caution';
      color = 'var(--am)';
      desc = 'Fatigue accumulating faster than recovery';
    } else {
      status = 'High Injury Risk / Deload Zone 🔴';
      zoneCode = 'danger';
      color = 'var(--rd)';
      desc = 'Workload spike detected · Consider a deload session';
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
    if (tg === 'obliques' || tg === 'serratus anterior' || n.includes('oblique') || n.includes('russian twist') || n.includes('side plank') || n.includes('woodchopper') || n.includes('pallof')) {
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

    let recentLogs;
    if (options.mode === 'calendar' || options.useCalendarWeek === true) {
      recentLogs = calLogs;
    } else if (options.mode === 'rolling' || options.useCalendarWeek === false) {
      recentLogs = rollingLogs;
    } else {
      // Default: Calendar week bucketing, falling back to rolling if logs are in rolling window
      recentLogs = (calLogs.length >= rollingLogs.length) ? calLogs : rollingLogs;
    }

    const dayGroups = {};
    for (const target of FULL_MUSCLE_TARGETS) {
      dayGroups[target] = new Set();
    }

    for (const log of recentLogs) {
      const dayKey = toLocalDateKey(log.date);
      for (const x of (log.ex || [])) {
        const e = exLookup ? exLookup(x.id) : (x.exInfo || x);
        const stimulated = getStimulatedMuscleGroups(e);
        for (const grp of stimulated) {
          if (dayGroups[grp]) dayGroups[grp].add(dayKey);
        }
      }
    }

    const res = FULL_MUSCLE_TARGETS.map(target => {
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
  const calcBMR = (gender = 'male', weightKg, heightCm, age = 28) => {
    const w = Number(weightKg) || 75;
    const h = Number(heightCm) || 178;
    const a = Number(age) || 28;
    const isFemale = gender === 'female';
    // Mifflin-St Jeor: 10·kg + 6.25·cm − 5·age + 5 (male) or −161 (female)
    const base = 10 * w + 6.25 * h - 5 * a;
    return Math.round(isFemale ? base - 161 : base + 5);
  };

  const calcTDEE = (bmr, activityMultiplier = 1.45) => {
    const mult = Number(activityMultiplier) || 1.45;
    return Math.round(bmr * mult);
  };

  const calcMacros = (targetCalories, weightKg, goal = 'cut') => {
    const cals = Math.max(1000, Number(targetCalories) || 2000);
    const w = Math.max(35, Number(weightKg) || 75);

    const proteinRatio = (goal === 'cut' || goal === 'sixpack') ? 2.2 : (goal === 'bulk' ? 2.0 : 2.2);
    const proteinG = Math.round(w * proteinRatio);
    const proteinKcal = proteinG * 4;

    const fatKcal = cals * 0.25;
    const fatG = Math.round(fatKcal / 9);

    let carbKcal = cals - proteinKcal - (fatG * 9);
    let carbG = Math.round(carbKcal / 4);
    let warning = null;

    if (carbG <= 0) {
      carbG = 0;
      carbKcal = 0;
      warning = 'Carbs clamped at 0g on aggressive deficit. Consider increasing calorie target.';
    }

    return {
      calories: Math.round(cals),
      protein: proteinG,
      proteinKcal,
      fat: fatG,
      fatKcal: Math.round(fatG * 9),
      carbs: carbG,
      carbKcal,
      warning
    };
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
    calcMacros
  };
});
