# Changelog

All notable changes to the MyGyM Progressive Web App are documented in this file.

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
