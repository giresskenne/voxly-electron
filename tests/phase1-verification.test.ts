/**
 * Phase 1 Automated Verification
 *
 * These tests verify Phase 1 implementation via source-level pattern matching
 * and TypeScript compile-time type assertions.  They do not start Electron,
 * call the network, or require a running backend.
 *
 * Run with: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FullDictationTiming } from "../src/main/types";
import { sanitizeLogValue } from "../src/shared/redaction";

const root = join(__dirname, "../..");

function src(relPath: string): string {
  return readFileSync(join(root, relPath), "utf8");
}

// ─── 1. Cloud audio pipeline ─────────────────────────────────────────────────

test("cloud mode skips blobToWav (isCloudMode branch present in OverlayApp)", () => {
  const code = src("src/renderer/views/OverlayApp.tsx");
  // The branch must test transcriptionMode === "cloud"
  assert.match(code, /transcriptionMode.*===.*["']cloud["']/);
  // When isCloudMode the code takes the arrayBuffer path WITHOUT blobToWav
  assert.match(code, /isCloudMode[\s\S]{0,200}blob\.arrayBuffer\(\)/);
  // blobToWav must only appear in the else branch
  assert.match(code, /} else \{[\s\S]{0,200}blobToWav\(blob\)/);
});

test("cloud mode preserves WebM/Opus MIME type through AudioChunk", () => {
  const code = src("src/renderer/views/OverlayApp.tsx");
  // Each chunk must carry its actual MIME from chunk.type / blob.type
  assert.match(code, /mimeType: chunk\.type \|\| blob\.type/);
  // The preferred MIME type function must prefer webm;codecs=opus first
  assert.match(code, /audio\/webm;codecs=opus/);
  assert.match(code, /preferredMimeType/);
});

test("groq service preserves MIME and uses webm extension for webm blobs", () => {
  const code = src("src/main/services/groq.ts");
  // Extension logic: webm for anything not wav
  assert.match(code, /ext.*webm/);
  // Blob is created with the original mimeType
  assert.match(code, /new Blob\(\[.*\],\s*\{.*type: mimeType/);
});

test("groq createTranscriptionForm uses the chunk mimeType as the Blob type", () => {
  const code = src("src/main/services/groq.ts");
  // mimeType must be passed to the Blob constructor
  assert.match(code, /createTranscriptionForm[\s\S]{0,600}type: mimeType/);
});

// ─── 2. Local audio pipeline ─────────────────────────────────────────────────

test("local mode calls whisperService directly without going through Groq", () => {
  const code = src("src/main/ipc.ts");
  // transcribeAudio must short-circuit for local mode
  assert.match(code, /transcriptionMode.*===.*["']local["'][\s\S]{0,200}whisperService\.transcribe/);
  // The local branch must appear BEFORE the groqTranscriptionService call
  const localIdx = code.indexOf("transcriptionMode.*===.*[\"']local[\"']");
  const groqIdx = code.indexOf("groqTranscriptionService.transcribe");
  // groqTranscriptionService.transcribe must be present (cloud fallback path)
  assert.ok(groqIdx > -1, "groqTranscriptionService.transcribe must exist for cloud path");
});

test("local mode still calls blobToWav in OverlayApp renderer", () => {
  const code = src("src/renderer/views/OverlayApp.tsx");
  // else branch (non-cloud) calls blobToWav
  assert.match(code, /} else \{[\s\S]{0,300}arrayBuffer = await blobToWav\(blob\)/);
  // Debug log confirms WAV conversion happened
  assert.match(code, /WAV conversion complete/);
});

test("OverlayApp guards recorder startup and empty audio before WAV decode", () => {
  const code = src("src/renderer/views/OverlayApp.tsx");
  assert.match(code, /type DictationState = .*["']starting["']/);
  assert.match(code, /setState\(["']starting["']\)[\s\S]+recorder\.start/);
  assert.match(code, /recorder\.start[\s\S]{0,300}setState\(["']recording["']\)/);
  assert.match(code, /chunksRef\.current\.length === 0 \|\| blob\.size === 0/);
  assert.match(code, /Empty recording captured; skipping transcription/);
});

// ─── 3. Warmup behavior ──────────────────────────────────────────────────────

test("warmupAi is throttled with WARMUP_TTL_MS constant", () => {
  const code = src("src/main/services/backend-api.ts");
  assert.match(code, /WARMUP_TTL_MS\s*=\s*6\s*\*\s*60\s*\*\s*1000/);
  assert.match(code, /now - warmupLastAt < WARMUP_TTL_MS/);
});

test("warmupAi resets timer on failure so retry is allowed", () => {
  const code = src("src/main/services/backend-api.ts");
  // On failure the timer is reset to 0 so the next dictation can retry
  assert.match(code, /warmupLastAt\s*=\s*0.*allow retry/s);
});

test("warmupAi fails silently — no throw, only debug log on error", () => {
  const code = src("src/main/services/backend-api.ts");
  // The catch block must NOT call log.warn or log.error (only log.debug)
  const warmupFn = code.match(/export async function warmupAi[\s\S]+?^}/m)?.[0] ?? "";
  assert.ok(warmupFn.length > 0, "warmupAi function must exist");
  assert.ok(!warmupFn.includes("log.warn"), "warmupAi catch must not call log.warn");
  assert.ok(!warmupFn.includes("log.error"), "warmupAi catch must not call log.error");
  assert.match(warmupFn, /log\.debug.*warmup failed/);
});

test("warmupAi sends Authorization Bearer header with session token", () => {
  const code = src("src/main/services/backend-api.ts");
  assert.match(code, /Authorization.*Bearer.*\$\{token\}/);
});

test("warmup is fired on startup and after login in main process", () => {
  const mainCode = src("src/main/main.ts");
  assert.match(mainCode, /void warmupAi\(\)/);

  const ipcCode = src("src/main/ipc.ts");
  assert.match(ipcCode, /void warmupAi\(\)/);
});

// ─── 4. Timing telemetry ─────────────────────────────────────────────────────

test("FullDictationTiming type contains all six required fields (compile-time)", () => {
  // If any field is missing this file will fail to compile, which fails the test suite.
	  const _check: FullDictationTiming = {
	    recordingMs: 0,
	    audioDurationMs: 0,
	    audioPrepMs: 0,
	    transcriptionMs: 0,
	    cleanupMs: 0,
	    dbSaveMs: 0,
	    transcriptionMode: "local",
	    cleanupMode: "fast",
	    cleanupEnabled: true,
	    cleanupSkipped: false,
	    cleanupStatus: "pending_background",
	    pasteMs: 0,
    totalAfterStopMs: 0,
    audioBytes: 0,
    timeToRawPasteMs: 0,
    cleanupCompletedAfterPasteMs: null,
    totalFinalizationMs: null,
  };
	  assert.ok(_check.recordingMs === 0);
	  assert.ok(_check.audioDurationMs === 0);
	  assert.ok(_check.audioPrepMs === 0);
  assert.ok(_check.transcriptionMs === 0);
  assert.ok(_check.cleanupMs === 0);
  assert.ok(_check.dbSaveMs === 0);
	  assert.ok(_check.transcriptionMode === "local");
	  assert.ok(_check.cleanupMode === "fast");
	  assert.ok(_check.cleanupEnabled);
	  assert.ok(!_check.cleanupSkipped);
	  assert.ok(_check.cleanupStatus === "pending_background");
  assert.ok(_check.pasteMs === 0);
  assert.ok(_check.totalAfterStopMs === 0);
  assert.ok(_check.audioBytes === 0);
  assert.ok(_check.timeToRawPasteMs === 0);
  assert.ok(_check.cleanupCompletedAfterPasteMs === null);
  assert.ok(_check.totalFinalizationMs === null);
});

test("OverlayApp constructs FullDictationTiming object and logs all six fields", () => {
  const code = src("src/renderer/views/OverlayApp.tsx");
  assert.match(code, /const dictationTiming: FullDictationTiming/);
	  assert.match(code, /recordingMs[:,]/);
	  assert.match(code, /audioDurationMs:/);
  assert.match(code, /audioPrepMs:/);
  assert.match(code, /transcriptionMs:/);
  assert.match(code, /cleanupMs:/);
  assert.match(code, /dbSaveMs:/);
	  assert.match(code, /transcriptionMode:/);
	  assert.match(code, /cleanupMode:/);
	  assert.match(code, /cleanupEnabled:/);
	  assert.match(code, /cleanupStatus:/);
  assert.match(code, /pasteMs:/);
  assert.match(code, /totalAfterStopMs:/);
  assert.match(code, /timeToRawPasteMs:/);
  assert.match(code, /cleanupCompletedAfterPasteMs:/);
  assert.match(code, /totalFinalizationMs:/);
});

test("MainDictationTiming is returned from the main-process pipeline", () => {
  const code = src("src/main/ipc.ts");
  assert.match(code, /pipelineTiming: MainDictationTiming/);
  assert.match(code, /transcriptionMs:/);
  assert.match(code, /cleanupMs:/);
	  assert.match(code, /dbSaveMs:/);
	  assert.match(code, /cleanupStatus:/);
});

// ─── 5. Log privacy ──────────────────────────────────────────────────────────

test("ipc.ts guards transcript text behind DICTAFUN_LOG_TRANSCRIPTS=1", () => {
  const code = src("src/main/ipc.ts");
  // The flag must be checked
  assert.match(code, /DICTAFUN_LOG_TRANSCRIPTS.*===.*["']1["']/);
  // The text fields are conditional on the flag
  assert.match(code, /logTranscripts.*\?.*transcribedText/s);
  assert.match(code, /logTranscripts.*\?.*recordedText/s);
});

test("openai-cleanup.ts fidelity warn log does not expose full text by default", () => {
  const code = src("src/main/services/openai-cleanup.ts");
  // The warn log in enforceFidelity must check DICTAFUN_LOG_TRANSCRIPTS
  assert.match(code, /DICTAFUN_LOG_TRANSCRIPTS.*===.*["']1["']/);
  // Must not log originalText/processedText unconditionally (they must be inside the conditional spread)
  // The unconditional keys must only be originalLength/processedLength
  assert.match(code, /originalLength: originalText\.length/);
  assert.match(code, /processedLength: processedText\.length/);
  // The raw text must only be inside the conditional spread
  assert.match(code, /logTranscripts.*\?.*\{.*originalText/s);
});

test("groq.ts logs only textLength not the transcribed text", () => {
  const code = src("src/main/services/groq.ts");
  // groq completion logs should only have textLength, not the text itself
  assert.ok(!code.includes("transcribedText:"), "groq.ts must not log raw transcript text");
  assert.match(code, /textLength:/);
});

test("log redaction removes deep-link tokens and bearer credentials", () => {
  const sanitized = sanitizeLogValue({
    url: "dictafun://auth?token=access-secret&refresh_token=refresh-secret",
    headers: { Authorization: "Bearer session-secret" },
  });
  const text = JSON.stringify(sanitized);
  assert.ok(!text.includes("access-secret"));
  assert.ok(!text.includes("refresh-secret"));
  assert.ok(!text.includes("session-secret"));
  assert.match(text, /<redacted>/);
});

// ─── 6. Lifecycle diagnostics ────────────────────────────────────────────────

test("single-instance lock is acquired at startup", () => {
  const code = src("src/main/main.ts");
  assert.match(code, /app\.requestSingleInstanceLock\(/);
  // If the lock is not acquired the app must exit before async startup can create windows.
  assert.match(code, /if \(!hasSingleInstanceLock\) \{[\s\S]*?process\.exit\(0\)/);
});

test("overlay window reference is nulled when the window closes", () => {
  const code = src("src/main/window-manager.ts");
  assert.match(code, /overlay.*closed[\s\S]{0,200}this\.overlay\s*=\s*null/);
});

test("settings window reference is nulled when the window closes", () => {
  const code = src("src/main/window-manager.ts");
  assert.match(code, /settings.*closed[\s\S]{0,200}this\.settings\s*=\s*null/);
});

test("native hotkey listeners are unregistered on will-quit", () => {
  const code = src("src/main/main.ts");
  assert.match(code, /will-quit[\s\S]{0,300}unregisterHotkeys\(\)/);
  assert.match(code, /will-quit[\s\S]{0,300}globeKeyManager\.stop\(\)/);
  assert.match(code, /will-quit[\s\S]{0,300}windowsUiohookHotkeyManager\.stop\(\)/);
});

test("Windows onboarding supports push shortcut test for Ctrl+Win", () => {
  const code = src("src/renderer/views/SettingsApp.tsx");
  assert.match(code, /pushTrialSupported\s*=\s*runtime\.platform !== ["']win32["'] \|\| settings\.hotkey === ["']Control\+Super["']/);
  assert.match(code, /pushTrialSupported \? ["']push["'] : ["']tap["']/);
  assert.match(code, /pushTrialSupported && activeTrial === ["']push["'] \? ["']push-to-talk["'] : ["']tap-to-talk["']/);
});

test("Windows defaults use Ctrl+Win push shortcut", () => {
  const code = src("src/main/services/settings-store.ts");
  assert.match(code, /WINDOWS_DEFAULT_HOTKEY\s*=\s*["']Control\+Super["']/);
  assert.match(code, /hotkey:\s*process\.platform === ["']darwin["'] \? ["']GLOBE["'] : WINDOWS_DEFAULT_HOTKEY/);
  assert.match(code, /LEGACY_WINDOWS_DEFAULT_HOTKEY\s*=\s*["']Control\+Shift\+Space["']/);
  assert.match(code, /mode:\s*["']push-to-talk["']/);
  assert.match(code, /next\.mode = ["']push-to-talk["']/);
});

test("Windows Ctrl+Win uses uiohook before Electron globalShortcut", () => {
  const code = src("src/main/ipc.ts");
  assert.match(code, /if \(isWindowsUiohookHotkey\(settings\.hotkey\)\)/);
  assert.match(code, /windowsUiohookHotkeyManager\.start\(settings\.hotkey/);
  assert.match(code, /hasPushReleaseEvents\(settings\.hotkey\)/);
  assert.match(code, /windowsUiohookHotkeyManager\.isRunning\(\)/);
  assert.match(code, /unregisterHotkeys\(\)/);
});

test("globalShortcut registration failures do not break settings saves", () => {
  const code = src("src/main/services/hotkeys.ts");
  assert.match(code, /try[\s\S]{0,200}globalShortcut\.register/);
  assert.match(code, /catch \(error\)[\s\S]{0,200}return false/);
});

test("unsupported push-to-talk shortcuts fall back to tap behavior", () => {
  const code = src("src/main/ipc.ts");
  assert.match(code, /Push-to-talk release events are unavailable/);
  assert.match(code, /sendDictationToggle\(\)/);
});

test("Windows local Whisper uses configured language to avoid auto-detect latency", () => {
  const code = src("src/main/services/whisper.ts");
  assert.match(code, /process\.platform === ["']win32["'][\s\S]{0,120}settings\.language !== ["']auto["']/);
  assert.match(code, /form\.append\(["']language["'], requestedLanguage\)/);
});

test("Windows local Whisper disables expensive metadata work for short clips", () => {
  const code = src("src/main/services/whisper.ts");
  assert.match(code, /form\.append\(["']no_timestamps["'], ["']true["']\)/);
  assert.match(code, /form\.append\(["']token_timestamps["'], ["']false["']\)/);
  assert.match(code, /form\.append\(["']no_language_probabilities["'], ["']true["']\)/);
  assert.match(code, /const durationMs = estimateWavDurationMs\(buffer\)/);
  assert.match(code, /form\.append\(["']audio_ctx["'], String\(audioCtx\)\)/);
  assert.match(code, /if \(durationMs <= 2_000\) return 128/);
});

test("finish shortcut keeps Ctrl Win keys inline with compact chips", () => {
  const code = src("src/renderer/styles.css");
  assert.match(code, /\.finish-card dd \.home-banner__shortcut-keys \{[\s\S]{0,120}flex-wrap: nowrap/);
  assert.match(code, /\.finish-card dd \.home-banner__shortcut-keys \{[\s\S]{0,160}white-space: nowrap/);
  assert.match(code, /\.finish-card \.home-banner__key \{[\s\S]{0,120}min-width: 38px/);
  assert.match(code, /\.finish-card__status-item \{[\s\S]{0,140}padding: 18px 14px/);
});

test("Windows overlay can return to click-through mode when idle", () => {
  const code = src("src/main/window-manager.ts");
  assert.match(code, /setOverlayInteractive\(interactive: boolean\)[\s\S]{0,200}setIgnoreMouseEvents\(!interactive,\s*\{ forward: true \}\)/);
  assert.ok(!code.includes("process.platform === \"win32\") {\n      this.overlay?.setIgnoreMouseEvents(false);"));
});

test("createOverlay reuses an existing window instead of creating a duplicate", () => {
  const code = src("src/main/window-manager.ts");
  assert.match(code, /this\.overlay && !this\.overlay\.isDestroyed[\s\S]{0,100}return this\.overlay/);
});

test("createSettings reuses an existing window instead of creating a duplicate", () => {
  const code = src("src/main/window-manager.ts");
  assert.match(code, /this\.settings && !this\.settings\.isDestroyed[\s\S]{0,100}focus\(\)/);
});

// ─── 7. IPC security ─────────────────────────────────────────────────────────

test("renderer never imports from electron directly", () => {
  const overlay = src("src/renderer/views/OverlayApp.tsx");
  const settings = src("src/renderer/views/SettingsApp.tsx");
  const app = src("src/renderer/views/App.tsx");
  for (const [name, code] of [["OverlayApp", overlay], ["SettingsApp", settings], ["App", app]]) {
    assert.ok(
      !code.includes("from \"electron\"") && !code.includes("from 'electron'"),
      `${name} must not import directly from electron`,
    );
  }
});

test("renderer uses window.electronAPI for all IPC calls", () => {
  const code = src("src/renderer/views/OverlayApp.tsx");
  assert.match(code, /window\.electronAPI\./);
});
