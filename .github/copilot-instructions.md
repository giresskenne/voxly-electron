# GitHub Copilot Instructions — Voxly Electron

## Design system — never deviate

All CSS tokens are in `src/renderer/design/theme.css`. This is the single source of truth, synced from the voxly-landing-studio reference repo. Do not hardcode hex values; do not change token values.

Key tokens:
- `--gradient-brand`: `linear-gradient(135deg, #2563FF 0%, #20D9FF 45%, #7C3AED 100%)`
- `--gradient-ai`: `linear-gradient(135deg, #7C3AED 0%, #2563FF 100%)`
- `--glass-bg` / `--glass-bg-strong` / `--glass-bg-subtle` for all surfaces
- `--glass-border`, `--glass-shadow`, `--glass-glow` for glass panels
- `--background`: cool blue-lavender gradient — never replace with flat white or grey

Glass utility classes: `.glass-panel`, `.glass-panel-strong`, `.glass-panel-subtle`, `.glass-btn`  
All defined in `theme.css` + `styles.css`. Use them; do not recreate them inline.

Children of glass panels need `z-index: 1` (already enforced globally in `styles.css`).

## Buttons

Always use `TextButton` or `IconButton` from `src/renderer/components/Controls.tsx`.  
Variants: `primary` (CTA), `glass` (secondary), `quiet` (tertiary).  
Never write raw `<button>` elements with custom inline styles.

## State

Interactive elements use `data-state` attributes (`idle | hover | recording | processing | complete | error`), not class names. CSS targets them: `[data-state="recording"] { … }`.

## IPC

The renderer uses `window.electronAPI.*` only. Never import from `electron` in renderer files.  
Types flow: `src/main/ipc.ts` → `src/preload/index.ts` → `src/renderer/global.d.ts`.

## TypeScript

`npm run lint` (`tsc --noEmit`) must pass with zero errors.  
No `any` without an inline comment explaining why.

## CSS

All CSS in `src/renderer/styles.css`. No CSS modules, no Tailwind, no inline style for layout.  
BEM-ish naming: `.block`, `.block__element`, `.block--modifier`.

## Do not add

Tailwind, CSS modules, shadcn/ui, or new CSS frameworks.  
No new npm packages without a reason.  
No `background: white` or flat greys on surfaces — the glass blur requires the gradient background.
