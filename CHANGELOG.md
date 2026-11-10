# Changelog

All notable changes to the MyGyM Progressive Web App are documented in this file.

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
