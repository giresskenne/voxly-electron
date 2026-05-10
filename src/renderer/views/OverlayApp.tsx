import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings, AudioChunk, PasteAttention } from "../../main/types";
import { TextButton } from "../components/Controls";
import { createRendererLogger } from "../lib/debug-log";

type DictationState = "idle" | "recording" | "processing" | "complete" | "error";
const log = createRendererLogger("overlay-ui");

// ─── Sub-components ───────────────────────────────────────────────────────────

// 3-bar wave icon shown in idle / hover states
const SoundWaveIcon = ({ size = 16 }: { size?: number }) => (
  <div className="sound-wave" style={{ height: size }} aria-hidden="true">
    <div className="sound-wave__bar" style={{ height: size * 0.55 }} />
    <div className="sound-wave__bar" style={{ height: size }} />
    <div className="sound-wave__bar" style={{ height: size * 0.55 }} />
  </div>
);

// 5 animated bars shown during active recording
const RecordingWave = () => (
  <div className="wave-bars-mic" aria-hidden="true">
    {[0, 1, 2, 3, 4].map((i) => (
      <span key={i} style={{ animationDelay: `${i * 90}ms` }} />
    ))}
  </div>
);

// 4 animated bars shown while transcription is processing
const ProcessingWave = () => (
  <div className="wave-bars-mic" aria-hidden="true">
    {[0, 1, 2, 3].map((i) => (
      <span key={i} style={{ animationDelay: `${i * 90}ms` }} />
    ))}
  </div>
);

const stateLabels: Record<DictationState, string> = {
  idle: "Ready",
  recording: "Listening",
  processing: "Processing",
  complete: "Pasted",
  error: "Needs attention",
};
const CLOUD_CHUNK_MS = 240_000;
const RECORDING_AUDIO_BITS_PER_SECOND = 128_000;
const COMPLETE_RESET_MS = 1000;
const ERROR_RESET_MS = 4000;

export function OverlayApp() {
  const [state, setState] = useState<DictationState>("idle");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [pasteAttention, setPasteAttention] = useState<PasteAttention | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const resetTimerRef = useRef<number | null>(null);
  const startInFlightRef = useRef(false);
  const stopRequestedDuringStartRef = useRef(false);

  const resetToIdle = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setState("idle");
    setPreview("");
    setError("");
    setPasteAttention(null);
  }, []);

  useEffect(() => {
    log.info("Overlay mounted");
    window.electronAPI.getSettings().then((next) => {
      log.debug("Overlay settings loaded", next);
      setSettings(next);
    });
    const offToggle = window.electronAPI.onDictationToggle(() => {
      log.info("Received dictation toggle from main");
      void toggleDictationRef.current();
    });
    const offStart = window.electronAPI.onDictationStart(() => {
      log.info("Received dictation start from main");
      void startDictationRef.current();
    });
    const offStop = window.electronAPI.onDictationStop(() => {
      log.info("Received dictation stop from main");
      stopDictationRef.current();
    });
    const offSettings = window.electronAPI.onSettingsUpdated((next) => {
      log.debug("Overlay settings updated", next);
      setSettings(next);
    });
    return () => {
      offToggle();
      offStart();
      offStop();
      offSettings();
    };
  }, []);

  // Stop window drag on global mouseup so releasing outside the grip still cleans up.
  useEffect(() => {
    if (!isDragging) return;
    const stop = () => {
      setIsDragging(false);
      void window.electronAPI.stopWindowDrag();
    };
    document.addEventListener("mouseup", stop);
    return () => document.removeEventListener("mouseup", stop);
  }, [isDragging]);

  // Only force-interactive when actively recording/processing so the cancel button is reachable.
  // When idle the overlay-anchor hover handlers take care of it; going back to idle clears it.
  useEffect(() => {
    if (state === "idle") {
      log.debug("Overlay returned to idle — releasing mouse capture");
      void window.electronAPI.setOverlayInteractive(false);
    } else {
      log.debug("Overlay active state — capturing mouse", { state });
      void window.electronAPI.setOverlayInteractive(true);
    }
  }, [state]);

  const startDictation = useCallback(async () => {
    if (startInFlightRef.current || recorderRef.current?.state === "recording") {
      log.debug("Start dictation ignored because recording is already active");
      return;
    }
    startInFlightRef.current = true;
    stopRequestedDuringStartRef.current = false;
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    try {
      log.info("Starting dictation");
      setError("");
      setPasteAttention(null);
      setPreview("Listening...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = preferredMimeType();
      log.debug("Media stream acquired", {
        mimeType,
        tracks: stream.getTracks().map((track) => ({ kind: track.kind, label: track.label, enabled: track.enabled })),
      });
      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: RECORDING_AUDIO_BITS_PER_SECOND,
      });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          log.debug("Recorder data available", { size: event.data.size, type: event.data.type });
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        log.info("Recorder stopped");
        recorderRef.current = null;
        void finishDictation();
      };
      recorder.start(CLOUD_CHUNK_MS);
      setState("recording");
      startInFlightRef.current = false;
      if (stopRequestedDuringStartRef.current) {
        stopRequestedDuringStartRef.current = false;
        recorder.stop();
      }
    } catch (err) {
      startInFlightRef.current = false;
      stopRequestedDuringStartRef.current = false;
      setState("error");
      setError(err instanceof Error ? err.message : "Microphone access failed.");
      log.error("Failed to start dictation", err);
      resetTimerRef.current = window.setTimeout(() => {
        log.debug("Resetting overlay after mic error");
        resetToIdle();
      }, ERROR_RESET_MS);
    }
  }, [resetToIdle]);

  const stopDictation = useCallback(() => {
    log.info("Stopping dictation", { recorderState: recorderRef.current?.state });
    if (startInFlightRef.current && recorderRef.current?.state !== "recording") {
      stopRequestedDuringStartRef.current = true;
      return;
    }
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const toggleDictation = useCallback(async () => {
    log.debug("Toggle dictation requested", { state });
    if (state === "error") {
      resetToIdle();
      return;
    }
    if (state === "recording") {
      stopDictation();
      return;
    }
    if (state === "processing") return;
    await startDictation();
  }, [startDictation, state, stopDictation, resetToIdle]);

  const requestStartDictation = useCallback(async () => {
    log.debug("Start dictation requested", { state });
    if (state === "error") {
      resetToIdle();
      return;
    }
    if (state !== "idle" && state !== "complete") return;
    await startDictation();
  }, [resetToIdle, startDictation, state]);

  const requestStopDictation = useCallback(() => {
    log.debug("Stop dictation requested", { state });
    stopDictation();
  }, [state, stopDictation]);

  // Keep a ref so the IPC listener (set up once on mount) always calls the latest version.
  const toggleDictationRef = useRef(toggleDictation);
  const startDictationRef = useRef(requestStartDictation);
  const stopDictationRef = useRef(requestStopDictation);
  useEffect(() => {
    toggleDictationRef.current = toggleDictation;
    startDictationRef.current = requestStartDictation;
    stopDictationRef.current = requestStopDictation;
  }, [requestStartDictation, requestStopDictation, toggleDictation]);

  const finishDictation = useCallback(async () => {
    log.info("Finishing dictation", { chunkCount: chunksRef.current.length });
    setState("processing");
    setPreview("Cleaning up transcript...");
    streamRef.current?.getTracks().forEach((track) => track.stop());

    try {
      const t0 = performance.now();
      const blob = new Blob(chunksRef.current, { type: preferredMimeType() });
      log.debug("Audio blob prepared", { size: blob.size, type: blob.type });
      // Convert webm/opus → 16-bit mono 16 kHz WAV so whisper-server can read it.
      const arrayBuffer = await blobToWav(blob);
      log.debug("WAV conversion complete", { wavByteLength: arrayBuffer.byteLength });
      const chunks = await Promise.all(
        chunksRef.current.map(async (chunk): Promise<AudioChunk> => ({
          buffer: await chunk.arrayBuffer(),
          mimeType: chunk.type || blob.type || "audio/webm",
        })),
      );

      const t1 = performance.now();
      log.debug("Blob ready, sending to main process", {
        blobPrepMs: Math.round(t1 - t0),
        byteLength: arrayBuffer.byteLength,
        chunkCount: chunks.length,
      });

      const result = await window.electronAPI.transcribeLocalWhisper(arrayBuffer, settings ?? undefined, chunks);

      const t2 = performance.now();
      log.info("Transcription IPC round-trip complete", {
        transcribeMs: Math.round(t2 - t1),
        text: result.text,
        recordId: result.record?.id,
      });

      setPreview(result.text);

      // Nothing was said (blank audio) — silently return to idle without pasting.
      if (!result.text.trim()) {
        log.info("Blank transcription — skipping paste");
        resetToIdle();
        return;
      }

      await window.electronAPI.setOverlayInteractive(false);
      const pasteResult = await window.electronAPI.pasteText(result.text);
      if (!pasteResult.ok) {
        if (pasteResult.attention) {
          setPasteAttention(pasteResult.attention);
          setPreview("Copied to clipboard · Paste setup needed");
          setError("");
          setState("error");
          resetTimerRef.current = window.setTimeout(() => {
            log.debug("Resetting overlay after paste setup warning");
            resetToIdle();
          }, ERROR_RESET_MS);
          return;
        }
        throw new Error(pasteResult.message ?? "Text copied, but paste did not complete.");
      }

      const t3 = performance.now();
      log.info("Paste complete", {
        pasteMs: Math.round(t3 - t2),
        totalMs: Math.round(t3 - t0),
        pasteResult,
      });

      setState("complete");
      resetTimerRef.current = window.setTimeout(() => {
        log.debug("Resetting overlay after completion");
        resetToIdle();
      }, COMPLETE_RESET_MS);
    } catch (err) {
      setPasteAttention(null);
      setState("error");
      setError(err instanceof Error ? err.message : "Transcription failed.");
      log.error("Failed to finish dictation", err);
      resetTimerRef.current = window.setTimeout(() => {
        log.debug("Resetting overlay after error");
        resetToIdle();
      }, ERROR_RESET_MS);
    }
  }, [settings, resetToIdle]);

  // Drives all visual changes — order matters: active states take priority over hover
  const micState = (() => {
    if (state === "recording") return "recording" as const;
    if (state === "processing") return "processing" as const;
    if (state === "complete") return "complete" as const;
    if (state === "error") return "error" as const;
    if (isHovered) return "hover" as const;
    return "idle" as const;
  })();

  return (
    <main className="overlay-stage">
      {/* Preview panel — animates in/out above the button whenever not idle */}
      <AnimatePresence>
        {state !== "idle" && (
          <motion.section
            className="preview-panel glass-panel-strong"
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.96 }}
            transition={{ duration: 0.18 }}
          >
            <div className="preview-panel__status">
              <span className="status-dot" data-state={state} />
              <span>{stateLabels[state]}</span>
              {state === "processing" && <Wand2 size={14} />}
              {state === "error" && pasteAttention && <AlertTriangle size={14} />}
            </div>
            <p>{error || preview}</p>
            {state === "error" && pasteAttention && (
              <div className="preview-panel__actions">
                <TextButton variant="quiet" onClick={() => window.electronAPI.openPanel()}>
                  Open
                </TextButton>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {/* Floating mic button + cancel */}
      <div
        className="overlay-anchor"
        onMouseEnter={() => {
          setIsHovered(true);
          void window.electronAPI.setOverlayInteractive(true);
        }}
        onMouseLeave={() => {
          setIsHovered(false);
          if (state === "idle") void window.electronAPI.setOverlayInteractive(false);
        }}
      >
        {/* Drag handle — mousedown/mouseup IPC drag matching reference repo pattern */}
        <div
          className="overlay-drag-grip"
          aria-hidden="true"
          onMouseDown={(e) => {
            if (e.button === 0) {
              e.preventDefault();
              setIsDragging(true);
              void window.electronAPI.startWindowDrag();
            }
          }}
          onMouseUp={() => {
            setIsDragging(false);
            void window.electronAPI.stopWindowDrag();
          }}
        />

        <div className="overlay-anchor__buttons">
          {/* Cancel button — appears on hover during recording */}
          <AnimatePresence>
            {(state === "recording" || state === "processing") && isHovered && (
              <motion.button
                type="button"
                className="overlay-cancel-btn"
                aria-label="Cancel"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.12 }}
                onClick={() => {
                  log.info("Cancel clicked", { state });
                  if (state === "recording") stopDictation();
                }}
              >
                <X size={10} strokeWidth={2.5} />
              </motion.button>
            )}
          </AnimatePresence>

          {/* Circular mic button — visual state driven by micState */}
          <button
            type="button"
            className="overlay-mic-btn"
            data-state={micState}
            aria-label={state === "recording" ? "Stop dictation" : "Start dictation"}
            disabled={state === "processing"}
            onClick={() => {
              log.debug("Mic button clicked", { state });
              void toggleDictation();
            }}
          >
            {(micState === "idle" || micState === "hover") && <SoundWaveIcon size={micState === "idle" ? 14 : 16} />}
            {micState === "complete" && <SoundWaveIcon size={16} />}
            {micState === "recording" && <RecordingWave />}
            {micState === "processing" && <ProcessingWave />}
            {micState === "error" && <X size={16} strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </main>
  );
}

function preferredMimeType(): string {
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  return "";
}

/**
 * Decode a webm/opus blob with the browser's AudioContext and re-encode as
 * 16-bit mono 16 kHz PCM WAV — the only format whisper.cpp's HTTP server
 * accepts without libav support.
 */
async function blobToWav(blob: Blob): Promise<ArrayBuffer> {
  const raw = await blob.arrayBuffer();
  // 16 kHz is what Whisper expects; AudioContext will resample automatically.
  const ctx = new AudioContext({ sampleRate: 16000 });
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(raw);
  } finally {
    await ctx.close();
  }

  const numSamples = decoded.length;
  const sampleRate = decoded.sampleRate; // 16000 after the resampling above

  // Mix all channels down to mono.
  const pcmFloat = new Float32Array(numSamples);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const chan = decoded.getChannelData(ch);
    for (let i = 0; i < numSamples; i++) {
      pcmFloat[i] += chan[i] / decoded.numberOfChannels;
    }
  }

  // Float32 → Int16
  const pcmInt16 = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcmFloat[i]));
    pcmInt16[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }

  // Build RIFF/WAV container.
  const dataLen = pcmInt16.byteLength;
  const wav = new ArrayBuffer(44 + dataLen);
  const v = new DataView(wav);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);           // PCM chunk size
  v.setUint16(20, 1, true);            // format: PCM
  v.setUint16(22, 1, true);            // channels: mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate (mono × 16-bit)
  v.setUint16(32, 2, true);            // block align
  v.setUint16(34, 16, true);           // bits per sample
  str(36, "data");
  v.setUint32(40, dataLen, true);
  new Int16Array(wav, 44).set(pcmInt16);
  return wav;
}
