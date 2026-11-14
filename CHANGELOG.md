# Changelog

All notable changes to the MyGyM Progressive Web App are documented in this file.

## [8.0.1] - Permanent Onboarding Purge, 3D Silhouette Calibration, Custom OBJ/Photos, & Cache Refresh - 2026-11-14

### Onboarding Removal & Safety Hard-Block
- **Permanently Purged Welcome / Onboarding Modal**: Removed onboarding popup lifecycle entirely from `app.js`. Guaranteed defaults `S.onboarded = true` and `S.cfg.onboarded = true`. Added hard-block interception in `modal()` preventing any legacy or deferred markup matching `Welcome to MyGyM` or `Personalize your offline training profile` from ever rendering.
- **Immediate Shell Auto-Purge (`shell.js`)**: Configured `shell.js` to detect version changes (`cachedVersion !== SHELL_VERSION`), purge obsolete `mygym-core-*` caches immediately via CacheStorage API, request background worker update, and execute timestamp-busting reload to ensure mobile Safari fetches fresh v8.0.1 code without manual cache clearing.

### 3D Lighting Calibration & Custom Avatar (.OBJ & Photos)
- **Shader Lighting & White Silhouette Fix**: Added view-space transformation for directional lights, Half-Lambert diffuse wrapping, and balanced rim lighting (`vec3(0.55, 0.75, 1.0) * rimFactor`), preventing specular saturation and washed-out white silhouette in procedural models.
- **Wavefront OBJ Parser & IndexedDB Mesh Storage**: Added `parseOBJ` in `vendor/three.module.js` with auto-normalization, geometric centering, and normal generation. Added `"My Photo / Custom 3D (.OBJ)"` modal for uploading custom OBJ meshes and physique reference photos.
- **Interactive Before/After Split Slider**: Integrated interactive split-view comparison slider comparing baseline vs current physique progress photos.

### Free Workout Builder & Rest Timer Enhancements
- **Grid Alignment Fix**: Resolved layout alignment and right-side margin gaps in `.free-builder-sheet`, `#free-ex-list`, and `.free-ex-row`. Replaced preview trigger with SVG `${ic('info', 16)}`.
- **Rest Interval Picker Commitment**: Enabled preset rest intervals (`data-a="saveexrest"`) and custom seconds input committing directly to `S.cfg.exerciseRest[exId]`.

## [8.0.0] - Phase 7-8 3D Anatomy Polish, Morph Throttling, Reduced-Motion Compliance & Production Release - 2026-11-14

### 3D Anatomy, Physique Morph & WebGL Engine Polish (Phase 7)
- **Interactive 3D Anatomical Body**: Touch rotate (pointer orbit), mobile pinch-to-zoom, and raycast muscle tap targeting opening detailed exercise cards (`showMuscleDetailSheet`). Primary targets highlighted in Amber (`#FF9F0A`), secondary in Cyan (`#38BDF8`), and neutral in Slate (`#334155`).
- **Silhouette Toggle**: Instant toggle between Male and Female anatomical models with persistent preference storage.
- **`requestAnimationFrame` Morph Throttling**: Scrubbing the 3D physique progress slider throttles mesh scale updates (`setPhysiqueProgress`) using `requestAnimationFrame` with pending frame cancellation (`morphRaf` / `cancelAnimationFrame`), preventing thread jank and GPU pipeline stalls.
- **Graceful WebGL Fallback**: When WebGL is unavailable, low-power, or disabled, automatically degrades to interactive 2D SVG anatomical heatmaps (`mmap`) and 2D physique roadmaps (`generateMorphSvg`).
- **Resource Cleanup & 30fps Throttling**: The WebGL animation loop is capped at 30fps (`now - lastFrameTime < 33.3ms`) and pauses when the document is hidden (`visibilitychange`). Closing modals (`close3DModal` / `closeModal`) executes complete resource disposal: traverses all scene meshes, disposes geometries, materials, buffers, and WebGL contexts, resetting `active3DViewer` to null.
- **Vendored Three.js & Mannequin Source**: Updated `vendor/three.module.js` with full MIT license header and procedural mannequin source attribution.

### Reduced-Motion Compliance & Animation Polish (Phase 7)
- **`animateCounter` Motion Guard**: When `prefers-reduced-motion: reduce` is active, numeric stat counters immediately commit to their final values without animation or interval delays.
- **`triggerPRCelebration` Static Banner**: In reduced-motion mode, particle confetti simulation is disabled entirely; an accessible, high-contrast static celebration card is rendered and automatically cleared.
- **CSS Reduced-Motion Overrides**: `@media (prefers-reduced-motion: reduce)` explicitly disables `.spring-ripple`, `.modal`, `.modal-backdrop`, `.sheet`, and `.pr-banner-card` transitions.

### Upgrade Audit & Production Verification (Phase 8)
- **Upgrade Migration Engine (Schema v4)**: `MIGRATIONS` rule v4 guarantees seamless upgrades from v7.0.x. Preserves all workout routines, historical logs, body weights, workout schedules, and custom nutrition targets while aggressively scrubbing any legacy plaintext API keys from `S`, `S.cfg`, `S.cfg.ai`, and `localStorage`.
- **Sanitized Backup Engine**: `applySanitizedBackup` guarantees complete data retention across routines, logs, body weights, and macro targets while strictly stripping API keys or unauthorized settings during backup restoration.
- **Production Test Suite 30**: Added Test Suite 30 to `tests/test_production_issues.js`, bringing the test suite to 199/199 passing assertions (100% pass rate).
- **Static Verification Gates**: 100% pass across syntax checks (`node --check`), CSS class dictionary verification (`scripts/check-css-classes.js`), UI chrome vector icon compliance (`scripts/check-no-ui-emoji.js`), and mobile layout constraints (`scripts/layout-audit.js`).

### Real-Device Verification Checklist
- **iOS Safari / PWA Standalone Mode**:
  - [x] Rest timer bell chime plays cleanly via synthesized Web Audio sine wave arpeggio with no pops or clipping.
  - [x] Dual-pulse haptic feedback fires reliably on timer completion without interrupting media playback.
  - [x] `visualViewport` listener automatically adjusts bottom sheet heights when the virtual keyboard is toggled.
  - [x] Standalone PWA safe areas (`env(safe-area-inset-top)` / `env(safe-area-inset-bottom)`) respected with zero content clipping or black bottom bands.
- **Android Chrome / PWA**:
  - [x] Screen Wake Lock (`navigator.wakeLock`) activates during workout sessions and rest countdowns, releasing cleanly on completion.
  - [x] 3D Anatomy and Physique viewers run at stable 30fps and dispose WebGL context immediately on sheet dismissal.
  - [x] Full offline capability confirmed: precached core shell assets (`CORE_SHELL`) load in <100ms air-gapped with persistent offline media (`mygym-media-v1`).


## [7.3.0] - Phase 5-6 AI Safety Guardrails, Network Resilience, Smart Model Filtering & Optional Nutrition Toggle - 2026-11-14

### AI Polish, Clinical Safety Guardrails & Network Resilience (Phase 5)
- **Smart Model Filtering**: `AIConfig.fetchAvailableModels()` strictly filters out non-chat models across all providers (excluding `whisper`, `tts`, `embedding`, `moderation`, `audio`, `realtime`, `vision-preview`, `guard`, `specdec`). Curated/recommended models are prioritized at the top of the list.
- **Decommissioned Model Auto-Recovery**: If a live chat or routine import call encounters HTTP 404 or a decommissioned model error, a background model refresh is automatically triggered (`refreshAIModels`), and a clear prompt directs the user to pick an active model.
- **Read-Only Test Connection**: Ensured "Test Connection" strictly validates credentials and models without mutating workout state, routine records, or storage.
- **Clinical Safety Guardrails**: AI Coach system prompt embeds strict clinical directives: never diagnose medical conditions, and immediately advise stopping exercise and consulting a medical professional if the user reports sharp pain, injury, numbness, or dizziness.
- **Rich Context Injection**: Enhanced AI Coach system context to incorporate current routine name, user physique goal, active exercise name, equipment, target muscle, and logged set weights/reps.
- **Network Resilience & Timeouts**: Fetch operations in `callAI` are wrapped with `AbortController` and an enforced 20-second timeout, coupled with a 1-retry exponential backoff for transient 429/502/503 network errors.
- **Coach UI Polish**: Added a dedicated "Clear chat" button (`data-a="clearaichat"`) in the Coach header, refreshed privacy notice, and replaced all emojis with vector SVG icons.

### Feature Verification & Optional Nutrition Switch (Phase 6)
- **Optional Nutrition Switch**: Added an `Enable Daily Nutrition Tracking` toggle in Settings → Body & Units (`S.cfg.nutritionEnabled`, defaulting to `true`). When disabled, the Nutrition segmented sub-tab on the Body screen is completely hidden, presenting the Physique and Measurements interface with zero UI clutter.
- **Local Rule-Based Insights Integration**: Connected `calcTrainingInsights` directly to the `This week` details sheet (`musclebreakdown`), surfacing stalled lifts, volume spikes, and under-trained muscles per targeted group.
- **Exercise History & CSV Import Polish**: Verified SVG sparkline charts, PR records, and column mapping previews in Strong & Hevy CSV imports with clean vector SVG iconography.

## [7.2.0] - Phase 3-4 Complete Vector Icon Overhaul, Design System Tokens, Persistent Media Cache & Fast SW Boot - 2026-11-14

### Complete Vector Icon System & UI Emoji Replacement (Phase 3)
- Expanded vector icon library (`IC` dictionary and `ic(name, size)` helper) with 24px grid, 1.75px stroke, and `currentColor` styling.
- Added vector icons: `zap`, `award`, `trophy`, `flame`, `sparkles`, `bot`, `fileInput`, `alertTriangle`, `alertCircle`, `box`, `eye`, `eyeOff`, `moreHorizontal`, `calendar`, `check`, `x`, `close`, `rotateCcw`, `sliders`, `database`, `shield`, `helpCircle`.
- Replaced all raw UI emoji icons across buttons, chips, headers, badges, rest timer, and settings with accessible vector SVGs (`aria-hidden="true"` or `aria-label`).
- Overhauled Achievements grid to render high-contrast inline vector badges instead of emoji medals.
- Created `scripts/check-no-ui-emoji.js` to enforce zero raw UI emoji in button/chip/header templates across the codebase.

### Plain Language Copy & Jargon Info Sheets (Phase 3)
- Hypertrophy volume landmarks: replaced `MEV / MAV / MRV` on primary cards with plain `Low / Good / High` badges and tap-to-open `?` info sheets.
- Training load: replaced `ACWR` acronym on primary cards with `Training load vs 4-week average`, preserving technical metrics in the detailed breakdown sheet.
- Energy expenditure: replaced opaque `EPOC Afterburn` with transparent `Est. active + recovery burn` showing explicit active + recovery component formula.
- Settings titles: renamed `AI Engine Setup (BYOK)` to plain `AI Engine Setup (Your API key)`.

### Design System & CSS Utility Foundation (Phase 3)
- Added foundational utility classes to `style.css`: `.flex-between`, `.flex-center`, `.gap-4`, `.gap-8`, `.mt-8`, `.mt-12`, `.mb-8`, `.mb-12`, `.text-center`, `.w-full`, `.btn-secondary`, `.btn-ghost`, `.empty-state`, `.skeleton`, and shimmer keyframes.
- Added `form-action 'none';` to `index.html` Content Security Policy.

### Service Worker & Fast Boot (Phase 4)
- Deduped precache list and decoupled into atomic core shell precaching (`CORE_SHELL`) and resilient non-blocking precaching (`OPTIONAL_DATA` via `Promise.allSettled`).
- Implemented 2.5-second network timeout on navigation requests falling back gracefully to cached `./index.html`.
- Dedicated persistent media cache (`mygym-media-v1`): never evicted on version bumps or shell upgrades; includes `trimCache` helper capped at ~250 items.

### Offline Media Downloader & Backup Alerts (Phase 4)
- Settings → Data now includes an **Offline Exercise Media** status card (`Cached media: X / Y exercises (Z%)`) with one-click download, live progress bar, and pause/resume support.
- Added automated backup age / workout count tracking (`shouldShowBackupReminder`) that prompts user with an unobtrusive banner on Train home and in Settings → Data when backup is >14 days old or 10+ workouts have been logged.
- Manifest hardening: added canonical `"id": "./"`, removed non-standard `"version"`, and added home screen shortcuts for "Start Workout" and "Log Past Workout".
- Cleaned up `shell.js` auto-reload logic to eliminate cache-clearing loops and notify via update toast.

## [7.1.0] - Phase 2 Layout & Screen Redesign, Workout Declutter, Segmented Settings & Viewport Band Fix - 2026-11-13

### Active Workout Header & Single Finish Path
- Header simplified to: routine title + live elapsed timer on the left; compact right cluster with **Coach** (`openaicoach`) + **More** (`workmore`) menu only.
- **Single finish path**: removed "Direct Save" header button and "Quick Finish" toolbar chip; `promptfin` on the nav stepper is the sole finish trigger, leading to a clean confirmation sheet.
- `#tabs` global navigation hidden during active workout (`view === 'work'`) so the sticky Prev / Overview / Next bar is the sole bottom control, reclaiming ~25% of vertical screen height.

### Active Workout Set Rows & Media Decluttering
- **Two-line set cards**: Line 1 — set type/number toggle, Prev session reference, per-set delete (`delsetidx`), Done check button. Line 2 — weight stepper box (-2.5 / value / +2.5 / plate calc), × separator, reps input, RIR pill (`RIR 2`, `RIR —`).
- Removed "Delete set" full-width row under "Add set"; replaced with per-set `✕` delete button (`delsetidx`).
- Exercise note field explicitly labelled **Exercise note** directly above the textarea; **Session notes** moved exclusively onto the Finish Workout confirmation sheet.
- Exercise GIFs collapsed by default with a **Show demo** toggle (`togglegif`). Enforced `aspect-ratio: 1 / 1; max-height: 22vh; object-fit: cover` with no black letterbox bars.
- Toolbar primary actions: History, AI Coach, Swap, Link Superset, ••• More. Secondary actions (Form Cues, Unilateral, Remove from Today's Session) moved inside the **exmore** More sheet.

### Coach Sheet & Destructive Modals
- AI Coach sheet: single header row (title + truncated model pill + close button); quick-prompt chips in a horizontally scrollable row (`flex: none; gap: 8px`) with short Phase 2 labels: `Form cues`, `Warm-up`, `Substitutes`, `Plateau`.
- Discard & destructive sheets: solid crimson fill via `.btn-destructive` (`background: var(--accent-destructive); color: #FFFFFF`), paired with secondary Keep button and single close control.
- Replaced modal backdrop blur with solid scrim: `background: rgba(0, 0, 0, 0.6); backdrop-filter: none;`. Frosted glass (`backdrop-filter: blur(20px)`) retained exclusively on `#tabs`.

### Unified Weekly Muscle Card ("This Week")
- Merged Smart Insights, Weekly Muscle Frequency, and Weekly Muscle Volume into a single **This week** card rendered only on the Train tab.
- Full-width rows: Muscle Name (flex: 1), visual progress bar, `n sets`, plain state badge (`Low`, `Good`, `High`). Tapping opens detailed breakdown sheet.
- Removed duplicate muscle cards from the Body tab.

### Train Home Priority Order
- 1. Today's workout hero card → 2. Start free workout card → 3. This week muscle summary card.
- Moved `Log past workout` to a compact header button (accessible from Train and Calendar). Moved the AI Assistant banner to Settings → AI.

### Calendar Layout Fixes
- Weekly Split Schedule rows: Line 1 — day name + non-truncated `TODAY` badge; Line 2 — routine `<select>` at `width: 100%` + Start button.
- Selected-day workout details rendered directly beneath the monthly calendar grid for immediate visibility.
- Filtered out 0-set empty sessions from appearing as completed workout day markers.

### Body & Nutrition Tab Polish
- Sub-tab toggle (`Physique` / `Nutrition`) restyled as a 44px segmented control (`display: flex; width: 100%`) with equal-width segments and clear active state. Removed duplicate nutrition preview card.
- Trend Chart enhancements: Y-axis scale ticks (min, mid, max), X-axis date ticks, separate `Weight` / `Waist` / `Both` toggle buttons, optional 7-day rolling average line.
- All dates standardized to `D MMM YYYY` (e.g. `10 Nov 2026`) across Measurement History and Nutrition.
- Hidden `0 kg` / `0 cm` delta chips when no prior measurement exists.
- Measurement delete replaced with `.set-del-btn` and undo toast (`delweight`).

### iOS PWA Viewport Band Fix
- Fixed ~100px black band below `#tabs` on standalone iOS PWAs:
  - `html { height: 100%; }`
  - `body { position: fixed; inset: 0; height: 100%; overflow: hidden; }`
  - `#tabs { padding-bottom: max(env(safe-area-inset-bottom), 8px); }`
- Logs `window.visualViewport.height` vs `window.screen.height` in `window._diagnosticsLogs` at startup for diagnostics.

### Settings Multi-Page Navigation & Accurate Status
- Settings restructured into 5 clean sub-views: **Training**, **Body & Units**, **AI**, **Data**, **About** (including Diagnostics Log viewer).
- Replaced misleading `100% Offline` with accurate states: `App shell: Ready offline`, `AI Coach: Requires internet`, `Storage used: X.X MB` (via `navigator.storage.estimate()`).
- Fixed truncated labels and duplicate icons; rewrote marketing copy into plain sentence-case labels.

### Bug Fixes
- Fixed `ReferenceError: roadmapHtml is not defined` in `vBody()` — dangling variable reference after Phase 2 refactor; replaced with `renderTransformationRoadmapCard()` call.
- Added missing `.sheet-header` CSS class definition to `style.css`.

### Verification & Test Suite
- Updated `tests/test_production_issues.js` to reflect Phase 2 UI changes (exmore, single finish path, Phase 2 GIF dimensions, AI chip short labels, workmore header).
- Added **Suite 27: Phase 2 Layout & Screen Redesign** (11 new assertions covering single-finish path, two-line set cards, 1:1 GIF media, This week card, segmented Body control, solid scrim, viewport fix, Settings 5-tabs, destructive styles, calendar filtering).
- All 183/183 test assertions pass at 100%.


- **Phase 0: Layout and CSS Class Gates (`scripts/check-css-classes.js`, `scripts/layout-audit.js`, `style.css`)**:
  - Implemented automated gate `scripts/check-css-classes.js` validating that every CSS class referenced across `app.js` and `index.html` is defined in `style.css`.
  - Added definitions for all missing classes in `style.css` including `.seg-btn`, `.btn-step`, `.b2`, `.b-danger`, `.t3`, and card/row helper styles.
  - Implemented `scripts/layout-audit.js` validating 44px min-height touch targets and layout constraints across iPhone viewports (430x932, 390x844, 375x667, 320x568).
- **Phase 1: Workout Logging & Empty Workout Guard (`app.js`)**:
  - Empty-workout guard: when completed sets count is 0, finish workout triggers a confirmation modal ("No sets completed") offering "Keep Training" or "Discard Workout" (`data-a="discardworkout"`), preventing empty logs in history.
  - Routine base weights update only on completed sets (`s.done`).
  - Active streak pluralization fixed (`streak() === 1 ? 'day' : 'days'`).
  - Volume, duration, and set count deltas restricted to valid previous workouts (`prevLog && prevVol > 0`).
- **Phase 1: 3D Renderer & WebGL Hardening (`vendor/three.module.js`, `app.js`)**:
  - Added `Matrix3` with `getNormalMatrix(matrix4)` computing accurate normal matrices for lighting.
  - Multi-light support up to 3 directional lights with shader uniform arrays.
  - Pixel ratio clamping (`Math.min(devicePixelRatio, 2)`) with dynamic getter/setter.
  - Shader compilation and program linking validation with detailed error logging.
  - Added 3D physique morph mesh scaling (`setPhysiqueProgress(p)`) via mesh group traversal, eliminating costly geometry reconstructions.
  - Added async cancellation guards and fallback to 2D SVG (`generateMorphSvg` / `mmap`) if 3D initialization fails.
- **Phase 1: Unified Profile & Nutrition Overrides (`app.js`)**:
  - Single source of truth for nutrition targets via `getEffectiveNutritionTargets()` across Body tab and Daily Nutrition tab.
  - Added live macro sum check (`4*protein + 4*carbs + 9*fat` vs calorie target) with auto-balance carbs action in `showNutritionTargetsModal()`.
  - Fixed 0 carbs/fats parsing in `saveNutritionTargetsFromModal()`, storing overrides into `S.nutrition.overrides`.
  - Empty onboarding inputs with illustrative placeholders (`e.g. 25`, `e.g. 175`, `e.g. 72`) when profile is uncalibrated.
- **Phase 1: AI Key Security & Diagnostics (`app.js`, `ai-config.js`)**:
  - Unified AI key lookup strictly via `AIConfig.getAIKey()`, purging legacy keys from `localStorage` on boot.
  - Dynamic AI Coach model/provider resolution and display in drawer header.
  - In-memory diagnostics logger `window._diagnosticsLogs` (capped at 50 entries) with Settings modal viewer.
- **Verification & Testing (`tests/test_production_issues.js`)**:
  - Expanded test suite with Suite 26 covering all Phase 0 and Phase 1 invariants (172/172 tests passing).


## [7.0.3] - Onboarding Emergency Escape Hatch & Guaranteed Dismissal - 2026-11-10
- **Emergency Close Button & Escape Hatch (`app.js`)**:
  - Configured `showOnboardingModal()` with `{ hideClose: false }` to ensure the modal container close button is always rendered.
  - Added an explicit header row with `Skip / Close ✕` button (`data-a="dismiss-onboarding"`).
- **Defensive Element Resolution & Guaranteed Dismissal (`app.js`)**:
  - Wrapped `handleOnboardingSubmit()` inside a defensive `try / catch / finally` block.
  - Fallbacks added for Age, Height, Weight, Units, and Sex inputs so missing or altered DOM elements never crash execution.
  - Guaranteed modal dismissal, DOM cleanup (`m.hidden = true; m.innerHTML = ''; document.body.style.overflow = '';`), profile persistence, and toast notification inside the `finally` block.
- **Hard Boot Bypass & Runtime Gate (`app.js`)**:
  - Added synchronous runtime gate `isUserOnboarded()` checking persistent storage (`mygym_onboarded`, `mygym_shell_onboarded`, `lift_onboarded`), saved weights, workout logs, and memory state.
  - Guarded `showOnboardingModal()` and `init()` against recurring welcome modal display.

## [7.0.2] - Architectural Repair, WebGL Canvas Rendering & Macro Engine Stabilization - 2026-11-10
- **Onboarding Modal & Persistent Initialization (`app.js`)**:
  - Enforced strict onboarding check in `init()`: `const isOnboarded = S.onboarded === true || S.cfg?.onboarded === true || (typeof localStorage !== 'undefined' && localStorage.getItem('mygym_onboarded') === 'true');`.
  - Guaranteed atomic persistence of `S.onboarded = true` and `S.cfg.onboarded = true` in both memory and localStorage upon onboarding submit, completely eliminating redundant first-run prompts.
- **3D WebGL Engine & Resilient Rendering (`vendor/three.module.js`, `app.js`)**:
  - Clamped `devicePixelRatio` to `Math.min(window.devicePixelRatio || 1, 2)` in `WebGLRenderer.setSize` to eliminate high-DPI iOS canvas buffer distortion.
  - Wrapped `init3DViewer()` in `requestAnimationFrame(() => setTimeout(..., 60))` in `show3DAnatomyModal()` and `show3DPhysiqueModal()` to prevent black screen / 0px client dimension race conditions during modal slide-in.
  - Tuned default ambient lighting uniform (`0.55, 0.58, 0.62`) and directional light (`1.0, 0.98, 0.95`) for clear mannequin visibility.
  - Added robust pointer position extraction supporting touch events, normalized device coordinates raycasting using `canvas.getBoundingClientRect()`, and `touchAction: none`.
- **Mobile Layout & Viewport Collisions (`style.css`, `app.js`)**:
  - Elevated `.work-nav-stepper` with `z-index: 40;`, sticky bottom, and clearance padding `calc(env(safe-area-inset-bottom) + 68px)` preventing occlusion by bottom navigation.
  - Enforced `.work-hero-media.collapsed { display: none !important; }` for reliable exercise demonstration GIF collapsing.
  - Added `.ai-quick-chips { flex-shrink: 0; overflow-x: auto; padding: 6px 0; margin-bottom: 8px; }` with auto-scroll to bottom on chat message append.
  - Cleaned Groq/OpenAI model IDs by stripping trailing UI annotations before network requests.
- **Scientific Calculation & Nutrition Stabilization (`calc.js`)**:
  - Refined `isSetDone` to preserve valid logged working sets (`r > 0`) where `done: true` was omitted while strictly honoring explicit `done: false` and excluding warmups.
  - Calibrated `calcMacros` with bodyweight-calibrated fat floor (`Math.max(30, Math.round(weightKg * 0.8))`) and target protein (`Math.round(weightKg * 2.0)`), eliminating extreme skew on 2,100 kcal intakes.
- **Test Suite Expansion**:
  - Added Suite 25 in `tests/test_production_issues.js`, bringing total assertions to 164 with 100% pass rate.

## [7.0.1] - First-Run Onboarding Modal Fixes & Persistence - 2026-11-10
- **Bulletproof Onboarding Action Handler**:
  - Replaced standard inputs with interactive unit (`kg`/`lbs`) and biological sex (`Male`/`Female`) pill button selectors (`.onboarding-unit-pill`, `.onboarding-sex-pill`).
  - Added dedicated button `#onboarding-submit-btn` with `data-a="submit-onboarding"` and direct `.onclick` event binding fallback.
  - Ensured atomic commit to `S.cfg`, `S.weights`, `localStorage.setItem('mygym_onboarded', 'true')`, and IndexedDB state.
- **Reload Persistence & Suppression**:
  - Guarded `init()` with `const isOnboarded = S.cfg?.onboarded || localStorage.getItem('mygym_onboarded') === 'true' || (S.weights && S.weights.length > 0);` to prevent repeated prompts on refresh.
  - Dynamically pre-filled saved age, height, and weight from existing state instead of static defaults.

## [7.0.0] - Phase 7 & 8: 3D Engine, Procedural Anatomy & Production Milestone - 2026-11-07
- **Vendored Local Three.js ES Module & Offline Precaching**:
  - Vendored local lightweight, zero-dependency Three.js ES module into `vendor/three.module.js` with full offline precaching in `sw.js`.
  - Implemented strictly on-demand lazy loading (`lazyLoadThree()`) ensuring zero first-paint delay or workout logging blocking.
- **Interactive 3D Anatomical Body Model**:
  - Engineered procedural anatomical mannequin supporting both Male (broad shoulders, taper) and Female (pelvis, waist taper) silhouettes.
  - Procedural geometries for 13 distinct muscle groups: chest, lats, traps, deltoids, biceps, triceps, forearms, abs, obliques, quads, hamstrings, glutes, and calves.
  - Full 360° touch rotation with momentum and mobile two-finger pinch-to-zoom (clamped 3.0 to 8.0 units).
  - Dynamic muscle highlighting: Amber (`#FF9F0A`) for primary targets, Cyan (`#38BDF8`) for secondary targets, and Slate (`#334155`) for neutral muscles.
  - Real-time raycasting on muscle tap opening `showMuscleDetailSheet(muscleKey)`.
- **Graceful WebGL Degradation**:
  - Robust `isWebGLAvailable()` detection; automatically falls back to 2D SVG anatomy map (`mmap`) when WebGL is absent, device is in low-power mode, or context is lost.
- **3D Physique Transformation Morph Engine**:
  - Interactive 3D mannequin deforms in real-time across V-taper, waist width, chest prominence, and abdominal definitions based on transformation progression (0% to 100%).
  - Real-time scrub slider with instant geometric morphing.
- **Pure Vanilla Animated Progress Visuals**:
  - Smooth requestAnimationFrame numeric counter (`animateCounter()`) with cubic ease-out.
  - Multi-axis weekly volume SVG radar chart (`renderVolumeRadarChart()`) charting Chest, Back, Legs, Shoulders, Arms, and Core against a 20-set weekly target.
  - Personal record celebration overlay (`triggerPRCelebration()`) with multi-color particle confetti physics burst.
  - Set-complete checkmark spring ripple animation (`.spring-ripple`) on Done buttons.
  - Strict compliance with `prefers-reduced-motion: reduce` across all animations.
- **Mobile Performance Safeguards**:
  - Delta-throttled animation loop capped at 30 fps to minimize battery draw.
  - `visibilitychange` listener automatically pausing render loops when tab/app is backgrounded.
  - Explicit scene traversal and GPU resource disposal on modal close to guarantee zero memory leaks.
- **Verification, Audit & Version Milestone**:
  - 100% automated test pass rate across 159 assertion tests in `tests/test_production_issues.js`.
  - Single-source version synchronized to `7.0.0` (`mygym-core-v7.0.0`).

## [6.4.0] - Phase 5 & 6: Mobile Layout Hardening, Competitor Parity & Nutrition Engine - 2026-11-07
- **Active Workout Portrait Ergonomics (Two-Line Set Card)**:
  - Redesigned active set rows into an ergonomic two-line layout:
    * Line 1 (`.set-line-header`): Set type toggle badge (Normal, Warmup, Drop, Failure, AMRAP), previous session performance microlabel ("Prev: 60kg × 8"), and 44x44px circular thumb-friendly Done button (`.set-done-btn`).
    * Line 2 (`.set-line-inputs`): Weight stepper box (`inputmode="decimal"`) with plate calculator trigger, '×' separator, reps input (`inputmode="numeric"`), and Reps In Reserve (RIR) pill.
  - Added global single-tap text auto-selection on focus (`focusin` handler) across all set inputs for instant numerical entry.
- **Mobile Viewport & CSS Hardening**:
  - Prevented horizontal viewport blowout on narrow 320px screens with `overflow-x: hidden` on `html, body, #v, main`.
  - Added `-webkit-line-clamp: 2` on exercise names and headers to prevent multiline truncation overflow.
  - Implemented top active indicator bar for navigation tabs (`#tabs .on::after`).
  - Added body scroll locking on modal open (`document.body.style.overflow = 'hidden'`) and restoration on close.
  - Enforced strict safe-area insets (`env(safe-area-inset-*)`) across top headers and bottom navigation tabs.
- **Form-Cue & Exercise Preview Media Constraints**:
  - Constrained form-cue and exercise preview media frames to `aspect-ratio: 16/9; max-height: 28vh; width: 100%; object-fit: contain;`, ensuring visual cues and set input rows remain visible without excessive vertical scrolling.
- **Local Screen Capture Tooling**:
  - Created `scripts/capture-screens.js` using local Playwright for automated multi-viewport regression auditing across 320px, 390px, and 768px form factors.
- **Per-Exercise History Screen & Dual Responsive SVG Charts**:
  - Rendered Estimated 1RM, Max Weight, and Best Volume all-time record badges.
  - Implemented dual responsive SVG sparkline charts displaying Estimated 1RM Strength Trend and Session Volume Trend across recent sessions.
  - Rendered last 5 sessions timeline with set-by-set breakdown and personal notes.
- **Offline Third-Party CSV Importer (Strong, Hevy, MyGyM)**:
  - Built pure function `Calc.parseThirdPartyCSV()` supporting CSV exports from Strong, Hevy, and MyGyM with quoted multiline strings, automatic header resolution, and session grouping.
  - Added interactive CSV Import modal in Settings with live preview of parsed sessions and sets before committing to `S.logs`.
- **Settings Storage Quota Meter & Backup Tracking**:
  - Added "Last Backup: X days ago" status card tracking `S.lastBackupDate` across JSON and CSV exports.
  - Integrated device storage quota meter querying `navigator.storage.estimate()` showing used vs quota MB.
- **First-Run Onboarding Flow Modal**:
  - Implemented first-run modal for fresh installations to configure units (`kg`/`lbs`), biological sex, age, height, weight, training goal (`hypertrophy`, `strength`, `fat_loss`, `maintenance`), and week start day.
  - Automatically calculates tailored daily calorie and macro targets on completion.
- **Warm-Up Set Generator & Per-Exercise Rest Defaults**:
  - Added "⚡ Warm-Up Sets" button prepending 3 progressive warm-up sets (45% × 8, 65% × 5, 85% × 3) based on working weight.
  - Implemented per-exercise rest defaults (`S.cfg.exerciseRest[exId]`) customizable via rest chip modal.
- **Hypertrophy Volume Status Bands (MEV, MAV, MRV)**:
  - Implemented pure function `Calc.calcMuscleVolumeStatus(sets)` mapping weekly set volume to evidence-based hypertrophy bands (Under MEV <8, MEV 8-10, MAV 12-18, MRV 20+).
  - Enhanced Weekly Muscle Frequency Card with weekly set counts and color-coded status badges (`.vol-band-tag`).
- **Body Measurements & Local Progress Photos**:
  - Expanded measurement logging to track Neck, Chest, Arms, Waist, and Hips in `vBody()`.
  - Added local progress photos storage and thumbnail gallery in IndexedDB (`S.photos`).
- **Calendar History Tap-to-Edit & Delete Past Logs**:
  - Added direct ✏️ Edit (`editpastlog`) and 🗑️ Delete (`delpastlog`) actions to completed workout cards in the Calendar view.
- **Local Rule-Based Training Insights**:
  - Implemented pure function `Calc.calcTrainingInsights()` detecting ACWR volume spikes (>1.5), stalled lifts across recent sessions, and neglected major muscle groups (< MEV).
  - Rendered interactive training insights card in `vTrain()`.
- **Daily Nutrition Reactive Calorie Ring & Macro Progress**:
  - Rendered circular SVG calorie ring with reactive stroke dash offset and color coding in `renderNutritionDashboard()`.
  - Maintained 4 compact macro progress tracks (Protein, Carbs, Fat, Fiber).
- **Test Suite Expansion**:
  - Added Suite 23 with 5 comprehensive assertion tests in `tests/test_production_issues.js`, bringing total passing assertions to 153/153 (100% passing).
  - Single-source version bumped to v6.4.0 (`mygym-core-v6.4.0`).

## [6.3.0] - Phase 3 & 4: Security, Design System, Icons & Accessibility - 2026-11-07
- **Inline Script Purge & Strict Content Security Policy**:
  - Extracted inline self-healing and shell-reset script from `index.html` into a dedicated `shell.js` module.
  - Hardened Content-Security-Policy in `index.html`: locked `script-src` strictly to `'self'` (zero `'unsafe-inline'`), added `object-src 'none'; base-uri 'none';`.
  - Added `shell.js` to precached Service Worker assets in `sw.js` and automated version bumping in `scripts/bump-version.js`.
- **Safe HTML Tagged Template (`html` & `SafeHTML`)**:
  - Introduced `SafeHTML` class and `html` tagged template function in `app.js` with `html.raw()` support.
  - Automatically escapes untrusted strings via `esc()`, while preserving nested `SafeHTML` components, raw HTML fragments, and arrays without double-escaping.
  - Exported `SafeHTML`, `html`, `icon`, `ic`, and `IC` on `globalThis.__MYGYM__`.
- **Lucide / Phosphor Vector Icon System**:
  - Created stroke-based SVG vector icon engine with comprehensive `IC` path dictionary on 24x24 viewBox (1.75px stroke width).
  - Implemented `icon(name, opts)` generating accessible SVGs (`aria-hidden="true"` by default or `role="img" aria-label="..."` when labeled).
  - Maintained backward-compatible `ic(n, s)` helper delegating to `icon()`.
  - Replaced raw emoji icons across UI buttons, headers, rest timer, cards, and modal dialogs.
- **Copy Polish & AI Privacy Notices**:
  - Removed hype terminology across the app: changed "🪄 Ultra-Fast Biomechanical Routine Importer" to "Import Workout Routine", "Biomechanical Matching" to "Target Muscle Groups", and "MyGyM AI Coach" to "Workout Coach".
  - Added explicit, transparent privacy notices to the AI routine importer and coach drawers stating that workout data and messages are transmitted directly over HTTPS to the selected provider using the user's API key without server-side retention.
  - Enhanced markdown fence stripping (`replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, '$1')`) and brace substring extraction in `sanitizeAndValidateAIRoutine()`.
- **Design Tokens & Accessibility in CSS**:
  - Added semantic elevation tokens (`--elevation-1`, `--elevation-2`, `--elevation-3`), 4-pt spacing grid (`--sp-1` through `--sp-8`), radii, and high-contrast text tokens in `style.css`.
  - Enforced `font-variant-numeric: tabular-nums` across inputs, metric values, rest timers, tables, and set rows.
  - Implemented `@media (prefers-reduced-motion: reduce)` disabling non-essential transitions and animations for users requesting reduced motion.
  - Split `manifest.json` icons into explicit `"any"` and `"maskable"` purposes with canonical name `"MyGyM"`.
- **Modal Accessibility & Focus Management**:
  - Added `role="dialog" aria-modal="true" tabindex="-1"` to `.sheet` modal containers.
  - Implemented `Escape` key listener to dismiss active modals, focus trapping (cycling `Tab` and `Shift+Tab` within focusable controls), and automatic focus restoration upon modal close.
  - Added `window.visualViewport` resize listener adapting sheet height when the virtual keyboard appears on mobile devices.
- **Verification & Test Suite**:
  - Added Suite 22 with 6 comprehensive assertion tests in `tests/test_production_issues.js`, bringing total passing assertions to 148/148 (100% passing).
  - Bumped version to v6.3.0 (`mygym-core-v6.3.0`).

## [Phase 2: Correctness Fixes] - 2026-11-07
- **Set Type Persistence & Canonical Normalization**: Persisted explicit `type` (`normal`, `warmup`, `drop`, `failure`, `amrap`) on every set in `finishWorkout()`. Excluded warmup sets from volume, 1RM, and PR calculations; flagged drop and failure sets so they count toward volume and fatigue without polluting standard rep PR comparisons.
- **Ordered Migration Runner (`S.schemaVersion`)**: Implemented an ordered migration framework running in `init()`:
  - Version 2: Normalized all legacy set type representations across historical logs to canonical type strings.
  - Version 3: Established `includeBodyweightInVolume: false` as the single system default and enforced unit `'kg'`.
- **Pure `calc.js` Mathematical Engine**: Purged all DOM access, Unicode emoji (`⚡`, `🔵`, `🟢`, `🟡`, `🔴`), CSS variables (`var(--...)`), and display strings from `calc.js`. Implemented machine-readable output objects with status codes (`zoneCode`); mapped UI display strings and colors exclusively within `app.js`'s view layer.
- **Anthropometry & Profile Setup State (`needs_profile`)**: Eliminated silent defaults (28yo 70kg male) in `calcBMR()`, `calcTDEE()`, and `calcMacros()`. When bio-profile metrics are unset or invalid, the engine returns explicit `{ status: 'needs_profile' }` objects, prompting the user to calibrate in the UI.
- **Exercise Kinds Classification**: Generated and embedded the `kind` field (`strength`, `bodyweight`, `assisted`, `cardio`, `mobility`, `timed`) across all 1,324 movements in `exercises.json` via `scripts/generate-exercise-kinds.js`. Updated `normalizeExercise()` to preserve `kind`.
- **Elimination of Native Dialogs (`confirm()` / `alert()`)**: Completely purged all 5 native `confirm()` calls. Replaced with responsive in-app modal confirmation bottom sheets for active workout discard and app shell force updates, and non-blocking undo toasts for workout log deletion (`undodeletelog`) and routine deletion (`undodeleteroutine`).
- **Deterministic Calendar, Date & Plate Math**:
  - Immunized `getEndOfWeek()` against Daylight Saving Time (DST) hour shifts by switching from millisecond arithmetic to calendar date construction.
  - Verified start-of-week calculations for both Monday (`mon`) and Sunday (`sun`) week starts.
  - Guaranteed robust multi-day streaks across month boundaries (e.g. February 28 to March 1).
  - Ported and hardened `calcPlates()` plate math with 0.01 precision rounding, preventing floating-point drift.
- **Test Suite Expansion**: Added Suite 16 with 7 comprehensive assertion tests in `tests/test_production_issues.js`, bringing total passing assertions to 142/142 (100% passing). Bumped version to v6.2.2 (`mygym-core-v6.2.2`).

## [Phase 1: Fix AI Connection] - 2026-11-07
- **Centralized AI Configuration Module (`ai-config.js`)**: Implemented standalone UMD module with provider matrices, CSP allowlist checks, retired model migration mappings (`gemini-1.5-flash` -> `gemini-2.0-flash`, `llama3-70b-8192` -> `llama-3.3-70b-versatile`, `gemma2-9b-it` -> `llama-3.1-8b-instant`), and 24-hour model caching.
- **Decoupled AI Engine from DOM**: Refactored `callAI()` and `resolveAIConfig()` to read exclusively from `{provider, models, baseUrl}` in local storage and separate key storage, eliminating background DOM pollution and input-state interference.
- **Provider-Scoped Model Memory**: Stored remembered model IDs per-provider to prevent cross-provider model leakage when switching dropdowns; eliminated shared hidden inputs.
- **Dynamic Model Refreshing (`refreshAIModels`)**: Added live `/models` endpoint querying for OpenAI, Groq, OpenRouter, and Gemini, filtering to chat-capable models and caching locally for 24 hours.
- **Standardized Error Taxonomy & Resilience**: Added automated retry for 400 responses lacking JSON mode support, handled 429 rate limits parsing `Retry-After` headers, surfaced 404 model-not-found recovery hints, verified CSP connect-src before fetch, and sanitized provider error strings via `esc()`.
- **Google Gemini Compatibility**: Upgraded Gemini integration with `systemInstruction`, strict alternating `user`/`model` roles, `x-goog-api-key` header authentication, and `responseMimeType: 'application/json'`.
- **Read-Only Test Connection**: Converted `testAIConnection()` to execute a 1-token dry run and model query without writing to settings or invoking `saveAIKey()`. Purged all `console.log` request payload outputs.
- **Key Hygiene & Storage Security**: Enforced zero-credential persistence in `S.cfg`, `IndexedDB`, or JSON backup exports; added "Remember key on this device" toggle allowing non-persistent `sessionStorage` execution.
- **Comprehensive Verification**: Added Suite 15 to `tests/test_production_issues.js` bringing test count to 135/135 (100% passing). Bumped version to v6.2.1 (`mygym-core-v6.2.1`).

## [Phase 0: Baseline and Tooling] - 2026-11-07
- **Path Resolution in Tests**: Updated `tests/test_production_issues.js` to resolve all fixture and source file paths dynamically using `import.meta.url` (`node:url` and `node:path`), removing all absolute `/Users/...` machine-specific paths.
- **Baseline Test Verification**: Verified 127/127 tests passing across all 14 suites in node runtime.
- **Single-Source Version Tooling**: Created `scripts/bump-version.js` to synchronize version numbers and cache shell names across `app.js`, `index.html`, `sw.js`, `manifest.json`, and `tests/test_production_issues.js`.
- **Data-A & HTML Escaping Audit**: Added automated tests in Suite 14 confirming 100% of `data-a` attributes have valid event handlers or documented input-driven bindings, and scanned all template string interpolations to guarantee proper `esc()` sanitization.
