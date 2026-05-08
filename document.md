# Voxly — Architecture Document

> For an AI agent rebuilding an equivalent desktop dictation application from scratch with a different design and flow.

---

## What the App Does (One Line)

Voxly is a desktop dictation overlay. The user presses a global hotkey, speaks, releases the hotkey, and the spoken words are instantly pasted into whatever app is focused on screen — as if they had typed them.

---

## The Main Feature: Always-On Dictation Overlay

The entire product revolves around one interaction loop:

```
Press hotkey → Speak → Release hotkey → Text appears where cursor is
```

There is no button to click, no app to switch to, no "copy" step. The result lands at the cursor automatically. The overlay sits on top of every other window at all times, waiting.

---

## The Two Windows

The app runs two persistent windows.

### 1. Dictation Overlay (the core)

A small floating widget, always visible on screen (always-on-top). It is transparent, frameless, and sits over any other application without interrupting it.

- **Default state**: tiny (96×96 px), barely visible
- **During recording**: grows, shows animated feedback
- **Position**: bottom-right corner by default, user can move it

It is the only thing users interact with while dictating. It shows three things:
1. A microphone button that responds to hotkey or click
2. Visual state feedback (idle / recording / processing)
3. A live transcription preview panel that appears above it

This window is **click-through when idle** — clicks pass through it to the app below. It only captures mouse input when the user hovers over it or is mid-recording.

### 2. Control Panel (settings, history)

A normal full-size window (1200×800) that opens on demand. It holds settings, transcription history, model management, etc. Completely separate from the dictation flow. Users can close it and dictation still works.

Both windows run the same React codebase loaded from the same HTML file. They are differentiated by a URL query parameter (`?app=settings`).

---

## The Transcription Pipeline — How It Works

This is the core logic. Speed comes from architecture choices made at every stage.

### Stage 1 — Audio Capture (Renderer Process)

The web `MediaRecorder` API records from the microphone into the renderer (Electron's web view). Audio is collected in memory as an array of binary chunks.

**Key choices for speed:**
- AGC (Automatic Gain Control), echo cancellation, and noise suppression are **disabled** in the browser constraints. These cause OS-level side-effects (e.g., Windows AGC can change the system mic volume permanently) and add latency.
- Audio is recorded in WebM/Opus format — a compact, high-quality codec that keeps file size small, which matters for IPC transfer.

When the user stops dictating, the chunks are merged into a single `Blob`.

```
getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
→ MediaRecorder collects chunks[]
→ On stop: new Blob(chunks, { type: "audio/webm" })
```

### Stage 2 — IPC Transfer (Renderer → Main Process)

The `Blob` is converted to an `ArrayBuffer` and sent over Electron's IPC bridge to the main Node.js process.

```
blob.arrayBuffer()                     // in renderer
→ ipcRenderer.invoke("transcribe-local-whisper", arrayBuffer, options)
→ ipcMain.handle("transcribe-local-whisper", ...)   // in main process
```

This is synchronous from the renderer's perspective (it `awaits` the invoke). The main process does all heavy work and returns the final text string.

### Stage 3 — Transcription (Main Process)

The main process uses **whisper.cpp**, a C/C++ port of OpenAI's Whisper model that runs on CPU (and optionally GPU). The key architectural decision here is how whisper.cpp is invoked.

#### The HTTP Server Mode — Why It's Fast

Naively, one would spawn a whisper.cpp child process per recording. That takes 2–5 seconds just to load the model into memory every time.

Voxly avoids this by running whisper.cpp as a **persistent HTTP inference server** on a local port (e.g., `http://127.0.0.1:PORT`). The server is started once when the app launches (or when the model is first selected), model is loaded into RAM once, and stays running.

For every new transcription, the audio is POST'd to this server as a multipart HTTP request. The server processes the audio and returns JSON.

```
App startup:
  whisper-server --model ggml-base.bin --port 9999 &  (stays running)

Per dictation:
  POST http://127.0.0.1:9999/inference
    Content-Type: multipart/form-data
    audio file: audio.webm
    language: en
    prompt: "React TypeScript Voxly"  ← custom dictionary
  
  ← { "text": "Transcribed sentence here." }
```

**Net effect**: Model load time (the slow part) happens once. Per-transcription latency is just inference time — usually under 1 second for short utterances on a modern CPU.

#### Model is Pre-Warmed

On app startup (before the user has even dictated), Voxly immediately starts the whisper server with whatever model the user last selected. When the user dictates for the first time, the server is already warm.

#### Inference on the Audio Buffer

The main process receives the ArrayBuffer, writes it to a temporary file, and POSTs it to the whisper HTTP server. After receiving the result, the temporary file is deleted.

```
Buffer → tmp file (e.g., /tmp/audio-xyz.webm)
→ POST to whisper server
→ delete tmp file
→ return text
```

#### Custom Dictionary (Prompt Parameter)

Whisper accepts an initial prompt that biases it toward certain words. The user can maintain a list of uncommon words (names, jargon, project names). These are joined into a string and sent as the `prompt` field in the multipart body. Whisper treats them as context, making it much more likely to transcribe those words correctly.

### Stage 4 — Text Delivery: Paste at Cursor

After the transcription text is returned to the renderer, it is immediately pasted into whatever application was focused before dictation started.

**The paste flow:**

1. Save the current clipboard content
2. Write the transcribed text to the system clipboard
3. Briefly un-focus the dictation overlay (so keyboard events go to the previous app)
4. Simulate `Cmd+V` (macOS) / `Ctrl+V` (Windows/Linux) programmatically
5. Restore the original clipboard content

The simulation uses native binaries rather than Electron APIs to be reliable across all apps:

| Platform | Primary method | How |
|---|---|---|
| macOS | `CGEvent` API | Compiled Swift binary injects keypress events at OS level |
| Windows | `SendInput` Win32 API | Compiled C binary sends virtual keystrokes |
| Linux | `uinput` (Wayland) / `XTest` (X11) | Compiled C binary; falls back to `wtype`, `xdotool`, `ydotool` |

The paste is invisible to the user. From their perspective, they spoke, and the words appeared.

---

## The Hotkey System

A global hotkey triggers start/stop dictation regardless of which application is focused. This requires OS-level keyboard hook registration, not standard web APIs.

**Registration:**

| Platform | Mechanism |
|---|---|
| macOS (standard) | Electron's `globalShortcut` API |
| macOS Globe/Fn key | Native Swift listener binary (separate child process) |
| Windows | Electron `globalShortcut` + optional native low-level hook for push-to-talk |
| Linux X11/Wayland (GNOME) | D-Bus service + `gsettings` (GNOME custom keybindings) |
| Linux Wayland (Hyprland) | D-Bus service + `hyprctl keyword bind` |

**Push-to-talk vs Tap-to-talk:**

- **Tap-to-talk**: Press once to start, press again to stop. Works everywhere.
- **Push-to-talk**: Hold to record, release to stop. Requires key-down and key-up events, which only the native low-level hook binaries can provide.

---

## The Live Transcription Preview

A third floating window (the preview overlay) appears above the main mic button during recording. It shows a live transcription as the user speaks, then transitions to the final cleaned-up text.

**States:**

```
listening  →  live (appends words as they come)  →  cleanup (optional AI pass)  →  final (auto-hides after 4s)
```

The window is transparent, always-on-top, and non-interactive (`focusable: false`). It resizes dynamically with the content — shrinks for short phrases, grows for longer passages, with a scroll limit at ~520px height.

Main process pushes updates via IPC to this window:
- `onPreviewText` — replace all content
- `onPreviewAppend` — append a new chunk
- `onPreviewHold` — freeze display, optionally show a spinner (AI cleanup in progress)
- `onPreviewResult` — show final text
- `onPreviewHide` — fade out and reset

---

## The Two Transcription Modes

### Local Mode (Privacy-first)

- Uses whisper.cpp binary bundled with the app
- Audio never leaves the machine
- Model lives in `~/.cache/openwhispr/whisper-models/`
- 6 model sizes (tiny → large → turbo), user picks the speed/quality tradeoff
- Works offline completely

### Cloud Mode

**Transcription: Groq — `whisper-large-v3-turbo`** (216× real-time speed, requires `GROQ_API_KEY`)

Audio is POSTed to `https://api.groq.com/openai/v1/audio/transcriptions` as `multipart/form-data`. The response is JSON containing the transcription text.

For recordings larger than ~4 MB (long audio), the audio is split into 240-second segments, uploaded in parallel, and the results are concatenated.

Groq's Whisper endpoint is OpenAI-compatible — the same request shape as the OpenAI Whisper API, just a different base URL and key.

---

## Optional: AI Cleanup Pass

**Cleanup / rewrite: OpenAI — `gpt-4.1-mini`** (requires `OPENAI_API_KEY`)

After raw transcription, the text can optionally be processed by an LLM via the OpenAI Chat Completions API (`https://api.openai.com/v1`):

- **Cleanup mode**: Fixes punctuation, capitalisation, removes filler words ("um", "uh")
- **Agent mode**: If the user addresses their named voice assistant (e.g., "Hey Nova, summarise this into bullet points"), the LLM processes the instruction and the *result* of the instruction gets pasted — not the raw speech

The cleanup pass runs after transcription and before the final paste. During this phase, the preview window shows a spinner.

---

## Data Persistence

Every transcription is saved locally to a SQLite database (`better-sqlite3`). Schema:

```sql
CREATE TABLE transcriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  original_text TEXT NOT NULL,   -- raw whisper output
  processed_text TEXT,           -- post-cleanup text (if any)
  is_processed BOOLEAN DEFAULT 0,
  processing_method TEXT DEFAULT 'none',
  agent_name TEXT,
  error TEXT
);
```

The history is browsable from the Control Panel.

---

## Process Architecture Summary

```
┌─────────────────────────────────────────────────────┐
│  Renderer Process (Chromium)                        │
│  ┌─────────────────┐   ┌────────────────────────┐  │
│  │  Dictation UI   │   │  Control Panel UI      │  │
│  │  (React, App.jsx)│  │  (React, ControlPanel) │  │
│  └────────┬────────┘   └────────────────────────┘  │
└───────────┼─────────────────────────────────────────┘
            │  IPC (contextBridge, invoke/on)
┌───────────┼─────────────────────────────────────────┐
│  Main Process (Node.js)                             │
│  ┌────────▼────────────────────────────────────┐   │
│  │  ipcHandlers.js                             │   │
│  │  ├─ transcribe-local-whisper                │   │
│  │  ├─ paste-text                              │   │
│  │  ├─ db-save-transcription                   │   │
│  │  └─ ...                                     │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌──────────────┐  ┌────────────┐  ┌────────────┐  │
│  │  whisper.js  │  │clipboard.js│  │database.js │  │
│  │  (HTTP client│  │(native bin)│  │(SQLite)    │  │
│  │  to server)  │  └────────────┘  └────────────┘  │
│  └──────┬───────┘                                   │
└─────────┼───────────────────────────────────────────┘
          │  HTTP POST (loopback)
┌─────────▼───────────────────────────────────────────┐
│  whisper-cpp Server (child process, port 9999)      │
│  Model loaded in RAM, waiting for audio             │
└─────────────────────────────────────────────────────┘
```

---

## Key Design Decisions to Replicate (or Diverge From)

| Decision | Why Voxly Made It | Alternative to Consider |
|---|---|---|
| whisper.cpp as persistent HTTP server | Eliminates model load time per request | Could use streaming inference if whisper supported it better |
| Bundled native binaries for paste | Guaranteed to work across all apps and window managers | D-Bus portal (Wayland) is cleaner but less supported |
| WebM/Opus from MediaRecorder | Compact, browser-native, good quality | WAV would be simpler to debug but 10× larger |
| ArrayBuffer over IPC (not streaming) | Simple, reliable | Streaming audio chunks over IPC would allow true real-time, but adds complexity |
| Separate overlay window for preview | Doesn't require activating or resizing main window | Could use a native OS notification-style popover |
| SQLite for history | Zero-dependency, local, fast | IndexedDB in renderer would avoid IPC, but less queryable |
| Context isolation ON | Security: renderer can't access Node.js directly | Disabling it simplifies code but is a security risk |
| Pre-warming model at startup | Makes first dictation just as fast as subsequent ones | Could lazy-start and accept first-time delay |
| Disabling browser audio processing | Avoids AGC side-effects on Windows | Could let OS handle it if targeting simpler setups |

---

## OS Permissions — Full Requirements

This app touches the microphone, the keyboard (global hotkey), and the clipboard (simulated paste). Each of those requires explicit OS permission. Missing any one of them causes a silent failure.

---

### macOS

macOS has the strictest permission model. Three separate permissions are needed.

#### 1. Microphone Permission

Required to record audio via `getUserMedia()`.

**How it's granted**: The system prompts once automatically when `getUserMedia()` is first called. The user clicks "Allow". After that it's remembered.

**What you must declare** — in `electron-builder.json`, add a `plist` entry to `mac.extendInfo`:

```json
{
  "mac": {
    "extendInfo": {
      "NSMicrophoneUsageDescription": "This app uses the microphone to transcribe your speech."
    }
  }
}
```

Without this string, macOS rejects the permission prompt entirely and `getUserMedia()` returns an error.

**Entitlement** — in your `.entitlements.mac.plist`:

```xml
<key>com.apple.security.device.audio-input</key>
<true/>
```

**How to check at runtime**:
```javascript
const { systemPreferences } = require('electron');
const status = systemPreferences.getMediaAccessStatus('microphone');
// 'not-determined' | 'granted' | 'denied' | 'restricted'
if (status === 'not-determined') {
  await systemPreferences.askForMediaAccess('microphone');
}
```

#### 2. Accessibility Permission (for simulated paste)

Required to simulate `Cmd+V` via `CGEvent` (the native keypress injection). This is how pasting to the focused app works.

**How it's granted**: The user must manually go to **System Settings → Privacy & Security → Accessibility** and toggle the app on. There is no automatic prompt — you can only open the settings panel and tell the user to do it.

**There is no API to auto-grant this.** You can only:
- Check if it's granted: `systemPreferences.isTrustedAccessibilityClient(false)` → returns `true/false`
- Trigger the permission dialog/open settings: `systemPreferences.isTrustedAccessibilityClient(true)` — passing `true` prompts the system dialog

**Entitlement** — in your `.entitlements.mac.plist`:
```xml
<key>com.apple.security.automation.apple-events</key>
<true/>
```

**Fallback**: If accessibility is not granted, `CGEvent` keypress injection fails silently. You need to detect this and fall back to writing text to the clipboard and showing a "Press Cmd+V to paste" message.

#### 3. Hardened Runtime + Entitlements (for distribution)

For a notarized/signed build (required to distribute outside the App Store), you must enable **hardened runtime** and provide an entitlements file. Without this, Apple's notarization rejects the app.

**`electron-builder.json`**:
```json
{
  "mac": {
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "resources/entitlements.mac.plist",
    "entitlementsInherit": "resources/entitlements.mac.plist"
  }
}
```

**`resources/entitlements.mac.plist`** — minimum required:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- Allow JIT compilation (Chromium/V8 requires this) -->
  <key>com.apple.security.cs.allow-jit</key>
  <true/>

  <!-- Allow unsigned executable memory (Electron requires this) -->
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>

  <!-- Microphone access -->
  <key>com.apple.security.device.audio-input</key>
  <true/>

  <!-- AppleScript / Accessibility for paste simulation -->
  <key>com.apple.security.automation.apple-events</key>
  <true/>

  <!-- Required if spawning child processes (whisper server, etc.) -->
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

Without `allow-jit`, Chromium (Electron's renderer) fails to start on notarized builds.

#### 4. Opening the System Settings Panel from Code

When a permission is missing, show a button that takes the user directly to the relevant pane:

```javascript
const { shell } = require('electron');

// Microphone privacy settings
shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');

// Accessibility settings
shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');

// Sound input device settings
shell.openExternal('x-apple.systempreferences:com.apple.preference.sound?input');
```

---

### Windows

Windows has a lighter permission model — no entitlements files, no code signing required to run locally. But there are two things you must handle.

#### 1. Microphone Permission (Windows 10/11 Privacy Settings)

The user must have microphone access enabled in **Settings → Privacy & Security → Microphone**. If it's off, `getUserMedia()` returns a `NotAllowedError`.

**How to check**: Catch the `getUserMedia()` error and check `error.name === 'NotAllowedError'`. There is no API to query mic permission status ahead of time on Windows from Electron.

**How to open settings from code**:
```javascript
const { shell } = require('electron');
shell.openExternal('ms-settings:privacy-microphone');
```

**No entitlements needed** — Windows does not have an entitlements system. The browser prompt from `getUserMedia()` is sufficient if the system setting allows it.

#### 2. Paste Simulation — No Special Permission Needed

On Windows, simulating `Ctrl+V` via `SendInput` (Win32 API) does **not** require any special permission. Any process can send input events to any other window. This is a significant difference from macOS.

The compiled C binary (`windows-fast-paste.exe`) calls `SendInput()` directly. No UAC prompt, no accessibility settings. It just works.

#### 3. Code Signing (for distribution)

Not required to run, but Windows SmartScreen will show a warning when users download an unsigned `.exe` or NSIS installer. For distribution, you need:
- An **EV Code Signing Certificate** (from DigiCert, Sectigo, etc.)
- Configure in `electron-builder.json`:
```json
{
  "win": {
    "certificateSubjectName": "Your Company Name",
    "signingHashAlgorithms": ["sha256"],
    "signDlls": true
  }
}
```

Without a certificate the app runs fine, but users see "Windows protected your PC" on first launch.

#### 4. No Admin Rights Needed

The app runs as a normal user process. The whisper server child process, the native paste binary, the global hotkey hook — none of these require administrator elevation. If your app asks for UAC elevation, something is wrong.

---

### Linux

Linux has no unified permission system — it varies by desktop environment. But there are three things to handle.

#### 1. Microphone Permission

On most Linux desktops, microphone access via `getUserMedia()` just works if the browser (Chromium/Electron) has access to PulseAudio, PipeWire, or ALSA. There is no system-wide privacy permission dialog like macOS/Windows.

**However** — in some hardened environments (Flatpak sandboxes, certain snap packages, SELinux policies), mic access can be blocked. For a standard `.AppImage` or `.deb` distribution, no special handling is needed.

**PipeWire note**: On modern Linux (Fedora 34+, Ubuntu 22.04+), PulseAudio is often replaced by PipeWire. Electron accesses audio through PulseAudio compatibility layer (`pipewire-pulse`). No code change needed — it's transparent.

#### 2. Paste Simulation — Needs a Tool Installed

Unlike macOS/Windows, Linux has no built-in API for simulating keystrokes. The app needs at least one of these tools to be present on the user's machine:

| Environment | Required tool | Install |
|---|---|---|
| X11 | `xdotool` | `apt install xdotool` / `dnf install xdotool` |
| Wayland (wlroots: Sway, Hyprland) | `wtype` | `apt install wtype` |
| GNOME Wayland | `xdotool` (via XWayland) or `ydotool` | `apt install xdotool` |
| Any (fallback) | `ydotool` + `ydotoold` daemon | `apt install ydotool` |

**What to do**: Bundle a compiled native binary (`linux-fast-paste` using `uinput`/`XTest`) as the primary method. This works without any tool installed on most systems. Fall back to `xdotool`/`wtype`/`ydotool` for environments where `uinput` access is restricted.

The `uinput` device (`/dev/uinput`) requires the user to be in the `input` group or the device to have permissive permissions. On most desktop distros this is the case by default.

#### 3. Global Hotkey — GNOME Wayland Needs Special Handling

Electron's `globalShortcut` API **does not work on GNOME Wayland** due to Wayland's security isolation. The workaround:

1. Create a D-Bus service at `com.yourapp.App`
2. Register a custom GNOME keybinding via `gsettings` that runs a `dbus-send` command pointing to your service
3. When GNOME triggers the keybinding, it calls your D-Bus `Toggle()` method

This requires `dbus-next` npm package and detecting the desktop environment at runtime:
```javascript
const isGnomeWayland = process.env.XDG_SESSION_TYPE === 'wayland' &&
                       process.env.XDG_CURRENT_DESKTOP?.includes('GNOME');
```

On X11 and non-GNOME Wayland compositors, Electron's `globalShortcut` API works normally.

---

### Summary Table

| Permission | macOS | Windows | Linux |
|---|---|---|---|
| Microphone | `NSMicrophoneUsageDescription` + `audio-input` entitlement + system prompt | Privacy setting ON + `getUserMedia()` prompt | Generally works by default; PipeWire compatible |
| Paste / keyboard injection | Accessibility permission (manual, user must grant) + `automation.apple-events` entitlement | None — `SendInput` works freely | `uinput` group membership or `xdotool`/`wtype` installed |
| Global hotkey | `globalShortcut` API (no permission) | `globalShortcut` API (no permission) | `globalShortcut` on X11; D-Bus + gsettings on GNOME Wayland |
| Spawn child processes | `cs.disable-library-validation` entitlement | None needed | None needed |
| Hardened runtime | Required for notarization: `allow-jit` + `allow-unsigned-executable-memory` | Not applicable | Not applicable |
| Distribution signing | Apple Developer account + notarization | EV certificate (optional but recommended) | GPG signing for `.deb`/`.rpm` repos (optional) |

---

### Child Process Cleanup on Quit

**This applies to all platforms.**

When Electron quits, child processes spawned with `child_process.spawn()` (like the whisper server) do **not** automatically die. They keep running in the background, holding their port. On the next app launch, the server tries to bind the same port and fails.

Always register a quit handler:

```javascript
const { app } = require('electron');
let whisperProcess = null;

// When spawning:
whisperProcess = spawn('./whisper-server', ['--port', '9999']);

// When quitting:
app.on('will-quit', () => {
  if (whisperProcess) {
    whisperProcess.kill('SIGTERM');
    whisperProcess = null;
  }
});
```

If you have multiple child processes (whisper server, paste binary watcher, etc.), keep references to all of them and terminate all in `will-quit`. On Windows, use `.kill()` without a signal (SIGTERM is not supported — Electron/Node handles the translation).

---

## Critical Electron Implementation Details

These are the three things most likely to silently break and block a build.

### 1. preload.js — The IPC Bridge

Electron runs with **context isolation ON** by default, which means the renderer (React) has no access to Node.js or Electron APIs. You cannot call `require('electron')` or `ipcRenderer` directly from a React component.

The solution is a `preload.js` script that runs in a privileged context and explicitly exposes safe methods to the web page via `contextBridge`:

```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  transcribeLocalWhisper: (buffer, opts) =>
    ipcRenderer.invoke('transcribe-local-whisper', buffer, opts),
  pasteText: (text, opts) =>
    ipcRenderer.invoke('paste-text', text, opts),
  onStartDictation: (cb) =>
    ipcRenderer.on('startDictation', (_, ...args) => cb(...args)),
  // etc.
});
```

Then in React: `window.electronAPI.transcribeLocalWhisper(...)` — not `ipcRenderer` directly.

This is configured in the `BrowserWindow` constructor:
```javascript
new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,   // must be true
    sandbox: false,           // must be false for IPC to work
    nodeIntegration: false,   // must be false
  }
})
```

### 2. FFmpeg — Audio Format Conversion

`MediaRecorder` produces WebM/Opus audio. whisper.cpp's inference server expects audio it can decode — it uses FFmpeg internally, but the FFmpeg binary must be available on the system or bundled with the app.

Voxly bundles FFmpeg via the `ffmpeg-static` npm package, which provides a prebuilt FFmpeg binary per platform. The binary path is resolved at runtime:

```javascript
const ffmpegPath = require('ffmpeg-static');
// → /path/to/app/node_modules/ffmpeg-static/ffmpeg
```

This path is passed to whisper.cpp or used directly to convert WebM → WAV before POSTing:
```
ffmpeg -i audio.webm -ar 16000 -ac 1 -f wav audio.wav
```

whisper.cpp works best on **16kHz mono WAV**. If your pipeline sends WebM directly to the server, verify the server's built-in FFmpeg handles it — otherwise pre-convert.

### 3. ASAR Unpacking — Running Native Binaries in Production

When Electron packages the app, all files are zipped into `app.asar`. You **cannot execute a binary** that lives inside an ASAR archive — the OS can't find it as a real file path.

Native binaries (whisper-server, paste binaries, key listeners) must be excluded from ASAR packing. In `electron-builder.json`:

```json
{
  "asarUnpack": [
    "node_modules/ffmpeg-static/**",
    "resources/bin/**"
  ]
}
```

These files end up at `app.asar.unpacked/...` at runtime. When resolving their paths in code, use:

```javascript
// Works in both dev and production:
const binPath = app.isPackaged
  ? path.join(process.resourcesPath, 'bin', 'whisper-server')
  : path.join(__dirname, 'resources', 'bin', 'whisper-server');
```

If you skip this, the app works perfectly in `npm run dev` and silently fails after packaging.

---

## Minimum Viable Rebuild Checklist

To build a different but equivalent app, these are the non-negotiable pieces:

1. **Electron app** with at minimum 2 windows: a transparent always-on-top overlay + a settings panel
2. **MediaRecorder** in renderer to capture mic audio
3. **IPC bridge** (contextBridge) to transfer audio to main process
4. **whisper.cpp HTTP server** spawned as a child process on a loopback port — this is what makes it fast
5. **Model pre-warming** on startup
6. **Native paste binary** per platform, or at minimum `shell.exec` Cmd+V simulation
7. **Global hotkey** registration with at least one GNOME Wayland fallback if targeting Linux
8. **SQLite** (or equivalent) for local history
9. **Temporary file cleanup** after every transcription
10. **Custom prompt injection** into whisper for user-defined vocabulary
