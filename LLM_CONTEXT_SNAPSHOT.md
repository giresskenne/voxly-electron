# Voxly Electron - LLM Context Snapshot

Last updated: 2026-05-09
Workspace: /Users/user/Document/voxly-electron
Branch: fix/fixing-test-transcribe-on-onboarding

## 1) What this app is
Voxly Electron is a desktop dictation app built with Electron + React + TypeScript.

Main user flow:
1. User triggers a global hotkey.
2. App records audio from microphone.
3. Audio is transcribed locally (Whisper) or via cloud provider (Groq), depending on settings + entitlement.
4. Optional cleanup pass runs via OpenAI.
5. Final text is pasted into the currently focused app.
6. Transcription history is saved to SQLite.

Two-window architecture:
- Overlay window (`?app=overlay`): compact transparent always-on-top dictation UI.
- Settings window (`?app=settings`): full settings, onboarding, billing/plan, and history views.

## 2) Stack and runtime
- Electron: 39.2.6
- React: 19.2.0
- TypeScript: 5.8.3
- Build: electron-vite 4 + Vite 7
- DB: node:sqlite (with JSON fallback)
- Packaging: electron-builder

Key runtime split:
- Main process: app lifecycle, IPC handlers, hotkeys, permissions, transcription services, billing/entitlements, update checks, DB.
- Preload: secure `window.electronAPI` bridge.
- Renderer: React views and UI state.

## 3) Important directory map
- `src/main/`
  - `main.ts`: app bootstrap and lifecycle wiring.
  - `ipc.ts`: all IPC handlers.
  - `types.ts`: shared app types for main/preload/renderer.
  - `services/`: whisper, groq, openai cleanup, billing, entitlements, paste, db, settings, hotkeys, update checker.
- `src/preload/index.ts`: typed bridge exposed as `window.electronAPI`.
- `src/renderer/`
  - `views/OverlayApp.tsx`: dictation overlay UI/state machine.
  - `views/SettingsApp.tsx`: settings, onboarding, history/insights, billing UI.
  - `components/Controls.tsx`: design-system button components.
  - `design/theme.css`: source of truth for design tokens.
  - `styles.css`: app styles.

## 4) Core IPC surface (current)
From preload/main wiring, renderer can call:

Settings and runtime
- `getSettings`, `updateSettings`
- `getRuntimeStatus`
- `onSettingsUpdated`

Transcription and history
- `transcribeLocalWhisper`
- `listHistory(limit?)`
- `getWordCountThisWeek()` -> `{ wordsUsed, wordsLimit }`
- `onDictationToggle`, `onDictationStart`, `onDictationStop`

Window and OS integration
- `openPanel`, `setOverlayInteractive`
- `startWindowDrag`, `stopWindowDrag`
- `pasteText`
- `openPermissionSettings`
- `openWebRoute`, `openURL`

Entitlement and billing
- `setSessionToken`, `clearSessionToken`
- `getEntitlementStatus`, `syncEntitlement`
- `startCheckout`

App updates
- `getAppVersion`
- `checkForUpdates(force?)`
- `openUpdateDownload`

## 5) Settings and entitlement model
`AppSettings` includes:
- hotkey and mode (`tap-to-talk` / `push-to-talk`)
- transcription mode (`local` / `cloud`)
- selected whisper model, language, custom dictionary
- cleanup toggle and AI keys
- whisper port and mock mode
- onboarding completion

Entitlements:
- Billing plans: `free | starter | pro`
- Billing status: `active | inactive | paused | past_due | cancelled | unknown`
- Capability gates:
  - free: cloud transcription OFF, cleanup ON
  - starter/pro with active billing: cloud transcription ON, cleanup ON

Main process applies entitlement gating before transcribing and when syncing settings.

## 6) Transcription pipeline
Main flow in IPC/service layer:
1. Entitlements refreshed/synced.
2. Effective settings gated by entitlement.
3. Transcription path:
   - Local path: Whisper server binary.
   - Cloud path: Groq transcription endpoint.
4. If cleanup enabled: OpenAI cleanup service post-processes transcript.
5. Result saved to DB (`transcriptions` table).
6. `transcription:saved` event emitted.

`mockTranscription` mode returns a deterministic test sentence.

## 7) Database and usage accounting
Database service supports SQLite and JSON fallback.

`transcriptions` rows include:
- timestamp
- original text
- processed text
- processing method
- agent name
- error

New free-plan usage helper:
- `wordCountThisWeek()` computes words over a rolling 7-day window.
- Current hard limit used by UI: `10,000` words/week.
- Returned to renderer via `history:word-count-this-week`.

## 8) App update system (new)
New service: `src/main/services/update-checker.ts`

Capabilities:
- Reads update manifest URL from env:
  - `VITE_DESKTOP_UPDATES_URL` (preferred)
  - fallback: `DESKTOP_UPDATES_URL`
- Optional download base:
  - `VITE_DESKTOP_DOWNLOAD_BASE_URL`
  - fallback: derived from manifest URL
- Caches update status for 6 hours.
- Compares semantic versions.
- Selects platform-specific file (`mac`/`windows`) from manifest.
- Exposes:
  - `app:update-check`
  - `app:update-open`
  - `app:version`

Renderer additions:
- Update banner in Settings when update available.
- Manual check + download actions.
- Version shown in sidebar and settings section.

## 9) UI/design system constraints (must preserve)
From project instructions:
- Design token source of truth: `src/renderer/design/theme.css`.
- Use glass classes (`glass-panel`, `glass-panel-strong`, `glass-panel-subtle`, `glass-btn`); do not recreate ad-hoc visuals.
- Never hardcode hex colors for surfaces/theming when token exists.
- Do not use raw `<button>` for interactive controls; prefer `TextButton` / `IconButton` from `Controls.tsx`.
- Renderer must never import Electron directly; only `window.electronAPI`.
- Keep CSS in `src/renderer/styles.css` (no Tailwind/CSS modules in this app).
- `npm run lint` (`tsc --noEmit`) must pass with zero errors.

## 10) Current onboarding/settings state
Notable current behavior in `SettingsApp.tsx`:
- Sidebar free-plan card now uses real weekly usage to drive progress bar width.
- Usage text shows `wordsUsed / wordsLimit` when usage exists.
- Update banner + update controls are present.
- Onboarding now includes a hotkey teaching step (tap vs push trial).
- Finish step summary uses improved whisper status labels.

## 11) Packaging/runtime resource changes (in progress)
Current packaging direction:
- `package.json` now excludes `resources/bin/**` and `resources/models/**` from app files and uses `extraResources` to ship binaries/models to `Resources/bin` and `Resources/models`.
- Service binary resolution in packaged mode now prefers `process.resourcesPath/bin/...` with `app.asar.unpacked` fallback.

This addresses packaged spawn issues (`ENOTDIR`) caused by ASAR paths.

## 12) Environment variables in active use
- `VITE_API_URL` (required): backend API base.
- `VITE_DESKTOP_UPDATES_URL` (new): update manifest URL.
- `VITE_DESKTOP_DOWNLOAD_BASE_URL` (new, optional): installer base URL.
- `VOXLY_DEBUG`: debug logging toggle.

Security note:
- Local `.env` currently contains live-looking API keys. Treat as secret, do not commit, and rotate if exposure is suspected.

## 13) Current git working tree status
Modified files:
- `.env.example`
- `.github/workflows/build-and-upload-installers.yml`
- `README.md`
- `package.json`
- `src/main/ipc.ts`
- `src/main/services/database.ts`
- `src/main/services/globe-key-manager.ts`
- `src/main/services/paste.ts`
- `src/main/services/whisper.ts`
- `src/main/types.ts`
- `src/main/window-manager.ts`
- `src/preload/index.ts`
- `src/renderer/styles.css`
- `src/renderer/views/SettingsApp.tsx`

Untracked file:
- `src/main/services/update-checker.ts`

## 14) Open technical debt / known cleanup targets
- Some UI copy remains hardcoded in renderer and may need centralization.
- Some CSS still uses hardcoded palette values instead of theme tokens in newer shell sections.
- Magic numbers in settings/insights logic should be normalized into constants.
- Consider adding tests around:
  - free-plan usage calculation
  - update manifest parsing/version comparison
  - entitlement gating transitions

## 15) Runbook
- Dev: `npm run dev`
- Type check: `npm run lint`
- Build: `npm run build`
- Dist (platform packages): `npm run dist`

## 16) Short LLM orientation prompt
If an LLM is picking up work in this repo, assume:
- This is an Electron app with strict main/preload/renderer boundaries.
- Any renderer capability must exist as typed preload API and main IPC handler.
- Design tokens and glass UI rules are mandatory, not optional.
- Free-plan usage and desktop updates were recently introduced and are still stabilizing.
- Keep changes minimal, typed, and backward-compatible with current `AppSettings` and `EntitlementStatus` flows.
