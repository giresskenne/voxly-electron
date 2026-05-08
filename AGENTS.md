# Voxly Electron — Agent Instructions

This file is read automatically by Claude Code, OpenAI Codex, GitHub Copilot Agent, and similar AI coding agents. Follow every rule here before touching any file.

---

## What This Project Is

A desktop dictation overlay built with Electron + electron-vite + React 19 + TypeScript.  
Two windows: a transparent always-on-top overlay (`?app=overlay`) and a settings panel (`?app=settings`).  
The user presses a global hotkey → speaks → releases → transcribed text is pasted at the cursor.

```
src/
  main/           Node.js main process (IPC handlers, window manager, services)
  preload/        contextBridge bridge — exposes window.electronAPI to renderer
  renderer/       React UI (both windows share one entry point, routed by ?app=)
    views/        OverlayApp.tsx, SettingsApp.tsx, App.tsx (router)
    components/   Controls.tsx (TextButton, IconButton), BrandMark.tsx
    design/       theme.css ← single source of truth for all design tokens
    styles.css    all app CSS (imports theme.css)
    lib/          cn.ts, debug-log.ts
```

---

## Design System — Do Not Deviate

### Token source of truth: `src/renderer/design/theme.css`

All colours, glass values, and gradients live there. **Never hardcode hex values in component files.** Always use the CSS custom properties.

| Token | Value | Use for |
|---|---|---|
| `--gradient-brand` | `linear-gradient(135deg, #2563FF 0%, #20D9FF 45%, #7C3AED 100%)` | primary CTAs, recording state |
| `--gradient-ai` | `linear-gradient(135deg, #7C3AED 0%, #2563FF 100%)` | AI/processing state |
| `--primary` | `#007aff` | focus rings, links, icon accents |
| `--accent` | `#34c759` | success / granted states |
| `--destructive` | `#ff3b30` | errors, cancel |
| `--glass-bg` | `rgba(255,255,255,0.45)` | standard glass surface |
| `--glass-bg-strong` | `rgba(255,255,255,0.6)` | elevated panels, modals |
| `--glass-bg-subtle` | `rgba(255,255,255,0.25)` | secondary cards, text zones |
| `--glass-border` | `rgba(255,255,255,0.5)` | panel borders |
| `--glass-shadow` | navy-tinted soft shadow | all glass surfaces |
| `--glass-glow` | `0 0 40px rgba(37,99,255,0.12)` | hover glow on interactive glass |

### Glass utility classes (defined in `theme.css` + `styles.css`)

```
.glass-panel        blur(24px) saturate(1.8), glass-bg
.glass-panel-strong blur(32px) saturate(2),   glass-bg-strong  ← use for main containers
.glass-panel-subtle blur(16px) saturate(1.5), glass-bg-subtle  ← use for text areas, rows
.glass-btn          same as glass-panel-strong + hover/transition
```

Every `glass-panel*` element **must** have `position: relative` so the `::before` specular layer renders.  
Direct children of glass panels must have `z-index: 1` (already enforced by `.glass-panel > *` in `styles.css`).

### Background

`--background` is `linear-gradient(158deg, #F0F4FF 0%, #E8F0FF 35%, #F4F0FF 70%, #F0F8FF 100%)` — a cool blue-lavender gradient. **Never set a flat grey or white background on any visible shell.** The glass blur effect only looks correct over this gradient.

---

## Component Conventions

### Buttons — always use `TextButton` or `IconButton` from `src/renderer/components/Controls.tsx`

```tsx
<TextButton variant="primary">  // gradient CTA
<TextButton variant="glass">    // glass secondary
<TextButton variant="quiet">    // text-only tertiary
<IconButton label="…">          // square icon button
```

Never create raw `<button>` elements with inline styles for interactive controls.

### State data attributes

Interactive elements communicate state through `data-*` attributes, not class names:

```
data-state="idle | hover | recording | processing | complete | error"
data-ok="true | false"
```

CSS targets these: `.overlay-mic-btn[data-state="recording"] { … }`

---

## IPC / Preload Rules

- The renderer **never** imports from `electron` directly. All IPC goes through `window.electronAPI`.
- `window.electronAPI` is typed via `src/renderer/global.d.ts` → `src/preload/index.ts`.
- If you add a new IPC channel, add it to `src/main/ipc.ts` (handler) **and** `src/preload/index.ts` (bridge) and ensure the type flows through to `global.d.ts`.

---

## TypeScript

- `npm run lint` (`tsc --noEmit`) must pass with zero errors before any change is considered done.
- No `any` unless there is a documented reason in a comment on the same line.
- Props interfaces inline with the component (no separate file for single-use types).

---

## CSS Rules

- All CSS lives in `src/renderer/styles.css` (which imports `design/theme.css`).
- No CSS modules, no Tailwind, no inline `style` objects for layout or theming.
- Inline `style` is acceptable only for dynamic computed values (e.g., animation delay based on array index).
- Every new selector must follow the BEM-ish pattern already in the file: `.block`, `.block__element`, `.block--modifier`.

---

## What NOT to Do

- Do not introduce Tailwind, shadcn/ui, or any new CSS framework.
- Do not add new npm dependencies without a concrete reason.
- Do not change `--gradient-brand` or any `--glass-*` token values — they are synced from the voxly-landing-studio reference repo.
- Do not set `background: white` or `background: #f5f5f7` on any visible surface — it breaks the glass theme.
- Do not disable `backdrop-filter` — it is intentional and required.
- Do not skip `z-index: 1` on children of glass panels — the specular `::before` layer sits at `z-index: 0` and will cover content.
- Do not use `ipcRenderer` directly in renderer code — always go through `window.electronAPI`.
- Do not hardcode port numbers — use `settings.whisperPort`.
- Do not use colored background cards for status/badge labels (e.g. no `background: #F0FDF4` green cards, no tinted-green/red pill backgrounds). Status badges must use `background: transparent` or `var(--glass-bg-subtle)` with `border: 1px solid var(--glass-border)` and `color: var(--muted-foreground)`. Reserve `var(--destructive)` text for genuine error states only — never as a background fill. Colored pill cards are considered "vibe-coded" and break the design system.

---

## Running the App

```bash
npm run dev      # start in dev mode (electron-vite hot reload)
npm run lint     # tsc --noEmit — must be clean before committing
npm run build    # full production build
npm run dist     # build + package with electron-builder
```
