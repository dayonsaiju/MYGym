#!/usr/bin/env node
/**
 * scripts/generate-exercise-kinds.js
 * Generates the 'kind' field on every entry in exercises.json.
 * Kinds: 'strength' | 'bodyweight' | 'assisted' | 'cardio' | 'mobility' | 'timed'
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const jsonPath = path.resolve(__dirname, '..', 'exercises.json');

const raw = fs.readFileSync(jsonPath, 'utf8');
const exercises = JSON.parse(raw);

function determineKind(e) {
  const n = String(e.n || e.name || '').toLowerCase();
  const bp = String(e.bp || '').toLowerCase();
  const eq = String(e.eq || '').toLowerCase();
  const tg = String(e.tg || '').toLowerCase();

  // 1. Assisted
  if (eq.includes('assisted') || n.includes('assisted')) {
    return 'assisted';
  }

  // 2. Mobility & Flexibility
  if (
    n.includes('stretch') ||
    n.includes('mobility') ||
    n.includes('foam roll') ||
    n.includes('yoga') ||
    n.includes('warm-up') ||
    bp === 'mobility'
  ) {
    return 'mobility';
  }

  // 3. Cardio
  if (
    bp === 'cardio' ||
    tg === 'cardiovascular system' ||
    n.includes('treadmill') ||
    n.includes('elliptical') ||
    n.includes('cycling') ||
    n.includes('stationary bike') ||
    n.includes('rowing machine') ||
    n.includes('jump rope') ||
    n.includes('jumping rope') ||
    n.includes('jumping jack') ||
    n.includes('burpee') ||
    n.includes('high knee') ||
    n.includes('running') ||
    n.includes('jogging')
  ) {
    return 'cardio';
  }

  // 4. Timed (Isometric holds)
  if (
    n.includes('plank') ||
    n.includes('wall sit') ||
    n.includes('hollow hold') ||
    n.includes('l-sit') ||
    n.includes('dead hang')
  ) {
    return 'timed';
  }

  // 5. Bodyweight
  if (
    eq === 'body weight' ||
    eq === 'none' ||
    eq === 'bodyweight' ||
    n.includes('bodyweight') ||
    e.t === 'b'
  ) {
    return 'bodyweight';
  }

  // 6. Strength (default for resistance movements)
  return 'strength';
}

let counts = {
  strength: 0,
  bodyweight: 0,
  assisted: 0,
  cardio: 0,
  mobility: 0,
  timed: 0
};

const updated = exercises.map(e => {
  const kind = determineKind(e);
  counts[kind]++;
  return {
    ...e,
    kind
  };
});

fs.writeFileSync(jsonPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');

console.log(`Updated ${updated.length} exercises with 'kind' field in exercises.json:`);
console.table(counts);

