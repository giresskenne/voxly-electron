# Dictafun Performance & Context Roadmap

## Goal

Improve Dictafun response speed first, then later add privacy-safe context extraction.

The implementation must happen in phases. Do not mix phases.

---

# PHASE 1 — Response Time Improvements

## Objective

Make Dictafun feel faster after the user stops speaking.

This phase focuses only on latency and pipeline efficiency.

Do not implement context extraction in this phase.

## Problems Found

Current flow is mostly batch-based:

```text
record audio
→ stop recording
→ convert audio to WAV
→ send full audio
→ transcribe
→ cleanup
→ paste
```

This creates avoidable latency.

## Required Changes

### 1. Respect transcription mode

File:

```text
src/main/ipc.ts
```

Update `transcribeAudio()` so it respects:

```ts
settings.transcriptionMode
```

Expected behavior:

```text
local mode → use local Whisper directly
cloud mode → use Groq/backend cloud transcription directly
```

Do not try Groq first when local mode is selected.

---

### 2. Avoid WAV conversion for cloud mode

File:

```text
src/renderer/views/OverlayApp.tsx
```

Current issue:

```text
MediaRecorder records compressed audio
→ app converts it to WAV
→ upload gets larger and slower
```

Expected behavior:

```text
cloud mode → send original webm/opus blob
local mode → convert to WAV only if local Whisper requires WAV
```

---

### 3. Fix MIME handling

Files:

```text
src/main/services/groq.ts
src/main/ipc.ts
src/renderer/views/OverlayApp.tsx
```

The MIME type should match the real audio format.

Do not label WebM as WAV or WAV as WebM.

---

### 4. Add warmup behavior

Wispr Flow calls:

```http
GET /warmup
```

and receives:

```json
{"status":"warmed"}
```

Dictafun should add similar behavior.

Electron should try:

```http
GET /ai/warmup
```

When to call warmup:

```text
on app launch
after login
when opening overlay
before first dictation if warmup is stale
```

Warmup should be cached for 5–10 minutes.

If the endpoint does not exist yet, fail silently and continue.

---

### 5. Add structured timing telemetry

Track one timing object per dictation:

```ts
{
  recordingMs: number;
  audioPrepMs: number;
  transcriptionMs: number;
  cleanupMs: number;
  dbSaveMs: number;
  pasteMs: number;
  totalAfterStopMs: number;
  audioBytes: number;
  transcriptionMode: "local" | "cloud";
  cleanupEnabled: boolean;
}
```

Expose it through IPC or save it locally for future Settings UI.

---

### 6. Reduce transcript logging

Do not log full transcript text in production.

Replace:

```ts
transcribedText: originalText
cleanedText: cleanup.text
```

with:

```ts
textLength
wordCount
```

Only allow full transcript logging if:

```text
DICTAFUN_LOG_TRANSCRIPTS=1
```

---

## Out of Scope for Phase 1

Do not implement:

```text
context extraction
active app text reading
voice profile
ASR keyword extraction
streaming transcription
WebSocket audio pipeline
UI redesign
billing changes
```

---

## Acceptance Criteria

Phase 1 is complete when:

```text
npm run lint passes
cloud mode no longer converts audio to WAV
local mode does not try Groq first
warmup call exists and fails safely
timing telemetry is available
production logs do not expose full transcript text
```

---

# PHASE 2 — Privacy-Safe Context Extraction

## Objective

Improve transcription accuracy using current app context.

This phase should only start after Phase 1 is complete.

## Inspiration

Wispr Flow appears to call:

```http
POST /llm/extract_asr_words
```

with visible textbox context.

Dictafun should implement a safer version.

## Rules

Context extraction must be:

```text
opt-in
limited
privacy-safe
redacted
transparent to users
```

## Required Behavior

Only capture:

```text
selected text, OR
focused text field content around cursor, OR
last 500–1000 safe characters
```

Do not capture:

```text
full window text
sidebars
entire Notes app content
emails
tokens
API keys
URLs unless user allows it
```

## Backend Endpoint

Add later:

```http
POST /ai/context-keywords
```

Input:

```json
{
  "appName": "Notes",
  "contextText": "...",
  "language": "en"
}
```

Output:

```json
{
  "keywords": ["Dictafun", "Supabase", "Privly"],
  "styleHints": ["technical notes", "startup/product names"]
}
```

---

# PHASE 3 — Streaming / Realtime Pipeline

## Objective

Move from batch transcription to streaming transcription.

Current:

```text
record full audio
→ upload after stop
→ wait
```

Target:

```text
record chunks every 500–1000ms
→ stream while user speaks
→ receive partial transcript
→ finalize after stop
```

This is the largest architecture change and should not be mixed with Phase 1.

---

# Agent Instruction

When asked to implement a phase:

```text
Implement only the requested phase.
Do not implement future phases.
Keep the diff minimal.
Preserve Electron main/preload/renderer boundaries.
Do not import Electron directly in renderer.
Keep TypeScript strict.
Run npm run lint.
```

---

# Prompt to Coding Agent

```text
Read AI_AGENT_PHASES.md.

Implement ONLY PHASE 1 — Response Time Improvements.

Do not implement Phase 2 or Phase 3.
Do not add context extraction.
Do not redesign the UI.
Keep the diff minimal and typed.
Make npm run lint pass.
```
