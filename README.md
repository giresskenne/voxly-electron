# Voxly Electron

A desktop dictation overlay built with Electron, React 19, and TypeScript.  
Press a global hotkey → speak → release → transcribed text is pasted at the cursor in any app.

## Features

- Transparent always-on-top overlay with a liquid glass circular mic button
- Local transcription via whisper.cpp (privacy-first, offline, no API key needed)
- Cloud transcription via the authenticated Dicta Fun backend
- Optional AI cleanup pass (punctuation, casing, filler-word removal)
- Push-to-talk and tap-to-talk modes
- Global hotkey registration (macOS, Windows, Linux)
- Transcription history (SQLite)
- Settings panel with guided onboarding

## Tech Stack

- **Electron** + **electron-vite** — desktop shell & build tooling
- **React 19** + **TypeScript** — UI
- **framer-motion** — animations
- **lucide-react** — icons
- **better-sqlite3** — local history store

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file and set the backend URL
cp .env.example .env

# 3. Start in dev mode (hot reload)
npm run dev
```

### Environment variables

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Backend API base URL for auth, billing, cloud transcription, and cleanup |
| `VOXLY_DEBUG` | Set to `1` to enable verbose IPC logging |

`GROQ_API_KEY` and `OPENAI_API_KEY` should live on the backend in production, not in the desktop app. The app calls authenticated backend endpoints for cloud transcription and cleanup.

## Scripts

```bash
npm run dev      # dev mode with electron-vite hot reload
npm run lint     # tsc --noEmit — must be clean before committing
npm run dist:mac # build for macOS
npm run dist:win # build for Windows
```

## Versioning & Releases

This project uses **semantic-release** with GitHub Actions for automatic versioning on every merge.

**Branches:**
- `main` — Production releases (automatic version bump + GitHub release)
- `feature/*` (and `feat/*`, `fix/*`, `chore/*`, `hotfix/*`) — Pre-releases on push

**Commit Convention:**  
All commits must follow [Conventional Commits](https://www.conventionalcommits.org/):
```bash
git commit -m "feat(paste): add Windows nircmd fallback"
git commit -m "fix(overlay): resolve stacking issue"
git commit -m "docs: update README"
```

Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `revert`

**Validation:** Husky pre-commit hooks enforce this locally. For full details, see [VERSIONING.md](./VERSIONING.md).

## Scripts

```bash
npm run build    # type-check + production build
npm run dist     # build + package with electron-builder
```

## Project Structure

```
src/
  main/           Node.js main process — IPC handlers, window manager, services
  preload/        contextBridge — exposes window.electronAPI to the renderer
  renderer/
    views/        OverlayApp.tsx, SettingsApp.tsx, App.tsx (URL router)
    components/   TextButton, IconButton, BrandMark
    design/       theme.css — single source of truth for all CSS tokens
    styles.css    all app CSS
    lib/          cn.ts, debug-log.ts
resources/
  bin/            native binaries (paste, key listener) per platform
  models/         whisper.cpp model files (not committed)
```

## Design System

All CSS tokens live in `src/renderer/design/theme.css`.  
Glass utility classes: `.glass-panel`, `.glass-panel-strong`, `.glass-panel-subtle`, `.glass-btn`.  
Never hardcode hex values — always use the CSS custom properties defined there.

## License

MIT
