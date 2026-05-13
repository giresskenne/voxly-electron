# Next Updates

## Context

- Current state is reasonable to push as-is.
- The main UX friction discussed here is not raw paste speed. Paste is already fast, around 250 ms in the sampled logs.
- The biggest extra latency is the cleanup pass, which currently adds roughly 0.9 s to 1.8 s on top of transcription.
- Current cleanup path is backend-proxied: Electron -> backend -> OpenAI -> backend -> Electron.
- The backend is not just storing API keys. It actively proxies both `/ai/transcriptions` and `/ai/cleanup`.
- Current backend cleanup model is `gpt-4.1-mini`, so the delay is not explained by using a reasoning model by default.

## Highest-Impact Product Changes

1. Add a cleanup decision layer instead of always running cleanup.
   - Skip cleanup for short, already-clean utterances.
   - Use a light cleanup mode for common dictation.
   - Use full cleanup only when the text is long, messy, or clearly list-like.

2. Optimize for perceived speed, not only backend latency.
   - Consider pasting the raw transcript immediately.
   - Optionally replace it only if cleanup produces a materially better result.
   - This should make the app feel much faster even if cleanup still runs in the background.

3. Keep cleanup transport simple.
   - Do not introduce WebSockets for normal cleanup.
   - Cleanup is a one-shot request/response operation, so WebSocket complexity is unlikely to pay off.
   - If partial output is ever needed, SSE is a better fit than WebSocket.

## Cleanup Optimization Recommendations

1. Verify backend cleanup configuration in deployed environments.
   - Local backend code uses `gpt-4.1-mini`.
   - Confirm production does not silently swap to a slower or reasoning-oriented model.

2. Split cleanup into light and heavy modes.
   - Light mode: punctuation, casing, spacing, very small filler cleanup.
   - Heavy mode: list formatting, more aggressive cleanup, special handling for dictated structure.

3. Shorten the default cleanup prompt where possible.
   - The current prompt is doing several things at once.
   - A narrower default prompt should reduce some latency and reduce over-processing risk.

4. Instrument backend latency before changing too much.
   - Measure backend overhead separately from provider latency.
   - Break down time into request arrival, provider call start, provider response, and response serialization.
   - This should confirm how much delay comes from the extra proxy hop versus the model itself.

5. Reduce unnecessary cleanup calls.
   - Very short utterances like simple confirmations should usually bypass cleanup.
   - Already-punctuated or obviously final text should be strong skip candidates.

## Architecture Lessons Worth Borrowing From Voxly

1. Port the policy idea, not the whole system.
   - Voxly separates provider routing from product behavior.
   - A smaller version here would still be useful: `raw`, `light cleanup`, `full cleanup`.

2. Borrow chunking and fallback ideas for cloud transcription if recordings get longer.
   - Voxly handles large cloud uploads more defensively.
   - This is more valuable than importing its realtime complexity.

3. Borrow perceived-speed patterns before transport complexity.
   - The best Voxly lesson here is task-specific routing and progressive UX.
   - It is not WebSocket-by-default.

## What Not To Port Right Now

1. Do not add WebSocket cleanup infrastructure.
   - It will not remove the dominant cleanup latency.
   - It adds complexity without changing the main cost center.

2. Do not port Voxly's full provider matrix.
   - That system supports many providers, local/LAN modes, enterprise modes, and managed cloud modes.
   - This app does not need that scope to solve the current problem.

3. Do not port realtime streaming architecture unless the product goal changes.
   - Voxly uses WebSockets where the product is inherently realtime.
   - This app's current dictation flow is batch-oriented: record, transcribe, cleanup, paste.

## Concrete Near-Term Plan

1. Implement a cleanup decision layer.
2. Add a lightweight cleanup mode for the common case.
3. Add backend timing instrumentation around `/ai/cleanup`.
4. Re-evaluate whether cleanup should happen before paste or after paste.
5. Revisit chunking/fallback only if cloud transcription becomes the next bottleneck.

## Related UI Stability Note

- The hover/click friction issue on the overlay was traced to overlay interactivity being re-enabled while idle.
- That renderer fix is already in place, but follow-up regression testing should include hover-only interactions over text inputs like Apple account fields.