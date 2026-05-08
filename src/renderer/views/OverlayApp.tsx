import { AnimatePresence, motion } from "framer-motion";
import { Wand2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings, AudioChunk } from "../../main/types";
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

export function OverlayApp() {
  const [state, setState] = useState<DictationState>("idle");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [isHovered, setIsHovered] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    log.info("Overlay mounted");
    window.electronAPI.getSettings().then((next) => {
      log.debug("Overlay settings loaded", next);
      setSettings(next);
    });
    return window.electronAPI.onDictationToggle(() => {
      log.info("Received dictation toggle from main");
      void toggleDictation();
    });
  }, []);

  useEffect(() => {
    const interactive = state !== "idle";
    log.debug("Overlay state changed", { state, interactive });
    void window.electronAPI.setOverlayInteractive(interactive);
  }, [state]);

  const startDictation = useCallback(async () => {
    try {
      log.info("Starting dictation");
      setError("");
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
        void finishDictation();
      };
      recorder.start(CLOUD_CHUNK_MS);
      setState("recording");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Microphone access failed.");
      log.error("Failed to start dictation", err);
    }
  }, []);

  const stopDictation = useCallback(() => {
    log.info("Stopping dictation", { recorderState: recorderRef.current?.state });
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const toggleDictation = useCallback(async () => {
    log.debug("Toggle dictation requested", { state });
    if (state === "recording") {
      stopDictation();
      return;
    }
    if (state === "processing") return;
    await startDictation();
  }, [startDictation, state, stopDictation]);

  const finishDictation = useCallback(async () => {
    log.info("Finishing dictation", { chunkCount: chunksRef.current.length });
    setState("processing");
    setPreview("Cleaning up transcript...");
    streamRef.current?.getTracks().forEach((track) => track.stop());

    try {
      const blob = new Blob(chunksRef.current, { type: preferredMimeType() });
      log.debug("Audio blob prepared", { size: blob.size, type: blob.type });
      const arrayBuffer = await blob.arrayBuffer();
      const chunks = await Promise.all(
        chunksRef.current.map(async (chunk): Promise<AudioChunk> => ({
          buffer: await chunk.arrayBuffer(),
          mimeType: chunk.type || blob.type || "audio/webm",
        })),
      );
      const result = await window.electronAPI.transcribeLocalWhisper(arrayBuffer, settings ?? undefined, chunks);
      log.info("Transcription returned", { text: result.text, recordId: result.record.id });
      setPreview(result.text);
      const pasteResult = await window.electronAPI.pasteText(result.text);
      log.info("Paste completed", pasteResult);
      setState("complete");
      window.setTimeout(() => {
        log.debug("Resetting overlay after completion");
        setState("idle");
        setPreview("");
      }, 4000);
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Transcription failed.");
      log.error("Failed to finish dictation", err);
    }
  }, [settings]);

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
    <main
      className="overlay-stage"
      onMouseEnter={() => window.electronAPI.setOverlayInteractive(true)}
      onMouseLeave={() => {
        log.debug("Overlay mouse leave", { state });
        if (state === "idle") void window.electronAPI.setOverlayInteractive(false);
      }}
    >
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
            </div>
            <p>{error || preview}</p>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Floating mic button + cancel */}
      <div
        className="overlay-anchor"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
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
    </main>
  );
}

function preferredMimeType(): string {
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  return "";
}
