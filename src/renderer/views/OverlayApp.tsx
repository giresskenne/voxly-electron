import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, ChevronDown, ClipboardPaste, Clock, Languages, Mic, ScrollText, Settings, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings, AudioChunk, LangMismatch, PasteAttention, WeeklyUsageStatus } from "../../main/types";
import { TextButton } from "../components/Controls";
import { createRendererLogger } from "../lib/debug-log";
import { I18nProvider, useT } from "../lib/i18n";

type DictationState = "idle" | "recording" | "processing" | "complete" | "error";
const log = createRendererLogger("overlay-ui");

/** localStorage key for the user's preferred microphone device ID. Empty string means auto-detect. */
const PREF_MIC_KEY = "voxly:micDeviceId";

const CLOUD_CHUNK_MS = 240_000;
const RECORDING_AUDIO_BITS_PER_SECOND = 128_000;
const COMPLETE_RESET_MS = 1000;
/** RMS threshold (0–255) above which we treat the mic as having active voice. */
const VOICE_RMS_THRESHOLD = 14;
const VOICE_POLL_MS = 80;
const AUTO_TRANSLATE_MISMATCH_PAIRS_KEY = "voxly:autoTranslateMismatchPairs";

const LANG_DISPLAY_NAMES: Record<string, string> = {
  en: "English", fr: "French", es: "Spanish", de: "German",
  pt: "Portuguese", it: "Italian", ja: "Japanese", zh: "Chinese",
  ko: "Korean", ru: "Russian", ar: "Arabic",
};

function mismatchPairKey(mismatch: LangMismatch): string {
  return `${mismatch.detected}->${mismatch.configured}`;
}

function getAutoTranslateMismatchPairs(): Set<string> {
  try {
    const raw = localStorage.getItem(AUTO_TRANSLATE_MISMATCH_PAIRS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

function setAutoTranslateMismatchPairs(next: Set<string>): void {
  localStorage.setItem(AUTO_TRANSLATE_MISMATCH_PAIRS_KEY, JSON.stringify(Array.from(next)));
}

function shouldAutoTranslateMismatch(mismatch: LangMismatch): boolean {
  return getAutoTranslateMismatchPairs().has(mismatchPairKey(mismatch));
}

function enableAutoTranslateMismatch(mismatch: LangMismatch): void {
  const next = getAutoTranslateMismatchPairs();
  next.add(mismatchPairKey(mismatch));
  setAutoTranslateMismatchPairs(next);
}

function normalizeComparableText(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

// ─── Sound effects ─────────────────────────────────────────────────────────────

function playTone(type: "start" | "stop"): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.type = "sine";
    if (type === "start") {
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.linearRampToValueAtTime(840, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.11);
      osc.start(now);
      osc.stop(now + 0.11);
    } else {
      osc.frequency.setValueAtTime(840, now);
      osc.frequency.linearRampToValueAtTime(460, now + 0.09);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    }
    osc.onended = () => void ctx.close();
  } catch {
    /* AudioContext not available — fail silently */
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Three pulsing dots — shown when idle/hovered or when recording in silence. */
const PillDots = () => (
  <div className="pill-dots" aria-hidden="true">
    {[0, 1, 2].map((i) => (
      <span key={i} className="pill-dot" style={{ animationDelay: `${i * 200}ms` }} />
    ))}
  </div>
);

/** Five animated wave bars — shown when recording with detected voice. */
const PillWave = () => (
  <div className="pill-wave" aria-hidden="true">
    {[0, 1, 2, 3, 4].map((i) => (
      <span key={i} className="pill-wave__bar" style={{ animationDelay: `${i * 65}ms` }} />
    ))}
  </div>
);

/** Four slower wave bars — shown while processing. */
const PillProcessing = () => (
  <div className="pill-wave pill-wave--processing" aria-hidden="true">
    {[0, 1, 2, 3].map((i) => (
      <span key={i} className="pill-wave__bar" style={{ animationDelay: `${i * 140}ms` }} />
    ))}
  </div>
);

// ─── Pill context menu ────────────────────────────────────────────────────────

/** Microphone device picker — expands inline below the Microphone row. */
const MicrophoneSubmenu = () => {
  const t = useT();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>(() => localStorage.getItem(PREF_MIC_KEY) ?? "");

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === "audioinput")))
      .catch(() => {});
  }, []);

  const selectDevice = (id: string) => {
    localStorage.setItem(PREF_MIC_KEY, id);
    setSelectedId(id);
  };

  const inUseDevice = devices.find((d) => d.deviceId === selectedId);
  const inUseLabel = inUseDevice?.label || t("overlay.menu.autoDetect");

  return (
    <motion.div
      className="pill-mic-submenu"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.15 }}
      style={{ overflow: "hidden" }}
    >
      <button
        type="button"
        className="pill-menu__item"
        onClick={() => selectDevice("")}
      >
        <span className="pill-menu__check">{selectedId === "" && <Check size={13} />}</span>
        <span>{t("overlay.menu.autoDetect")}</span>
      </button>

      {devices
        .filter((d) => d.deviceId !== "default" && d.deviceId !== "")
        .map((d) => (
          <button
            key={d.deviceId}
            type="button"
            className="pill-menu__item"
            onClick={() => selectDevice(d.deviceId)}
          >
            <span className="pill-menu__check">{d.deviceId === selectedId && <Check size={13} />}</span>
            <span>{d.label || "Unknown device"}</span>
          </button>
        ))}

      <div className="pill-mic-submenu__footer">
        <span className="pill-mic-submenu__footer-label">{t("overlay.menu.micInUse")}</span>
        <span>{inUseLabel}</span>
      </div>
    </motion.div>
  );
};

type PillMenuProps = {
  onClose: () => void;
  onPasteLastTranscript: () => void;
};

const PillContextMenu = ({ onClose, onPasteLastTranscript }: PillMenuProps) => {
  const t = useT();
  const [micOpen, setMicOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleClose = () => {
    if (closeTimerRef.current !== null) return; // already scheduled
    closeTimerRef.current = setTimeout(onClose, 350);
  };
  const cancelClose = () => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  // Close when clicking outside both panels
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".pill-menu") && !target?.closest(".pill-mic-submenu")) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    };
  }, [onClose]);

  return (
    <div className="pill-menu-anchor" onMouseLeave={scheduleClose} onMouseEnter={cancelClose}>
      <motion.div
        className="pill-menu glass-panel-strong"
        initial={{ opacity: 0, y: 8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.96 }}
        transition={{ duration: 0.14 }}
      >
      <button
        type="button"
        className="pill-menu__item"
        onClick={() => {
          void window.electronAPI.hideOverlayForHour();
          onClose();
        }}
      >
        <Clock size={15} />
        <span>{t("overlay.menu.hideForHour")}</span>
      </button>

      <button
        type="button"
        className="pill-menu__item"
        onClick={() => {
          void window.electronAPI.openPanel();
          onClose();
        }}
      >
        <Settings size={15} />
        <span>{t("overlay.menu.settings")}</span>
      </button>

      <div className="pill-menu__divider" />

      {/* Microphone row — click toggles mic picker inline */}
      <div className="pill-menu__item-group">
        <button
          type="button"
          className="pill-menu__item pill-menu__item--has-sub"
          aria-expanded={micOpen}
          onClick={() => setMicOpen((v) => !v)}
        >
          <Mic size={15} />
          <span>{t("overlay.menu.microphone")}</span>
          <ChevronDown size={13} className="pill-menu__chevron" style={{ transform: micOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
        </button>

        <AnimatePresence>
          {micOpen && <MicrophoneSubmenu />}
        </AnimatePresence>
      </div>

      <div className="pill-menu__divider" />

      <button
        type="button"
        className="pill-menu__item"
        onClick={() => {
          void window.electronAPI.openPanel();
          onClose();
        }}
      >
        <ScrollText size={15} />
        <span>{t("overlay.menu.transcriptHistory")}</span>
      </button>

      <button
        type="button"
        className="pill-menu__item"
        onClick={() => {
          onPasteLastTranscript();
          onClose();
        }}
      >
        <ClipboardPaste size={15} />
        <span>{t("overlay.menu.pasteLastTranscript")}</span>
      </button>
      </motion.div>
    </div>
  );
};

export function OverlayApp() {
  const [state, setState] = useState<DictationState>("idle");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [weeklyUsage, setWeeklyUsage] = useState<WeeklyUsageStatus | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [usageLimitBlocked, setUsageLimitBlocked] = useState(false);
  const [pasteAttention, setPasteAttention] = useState<PasteAttention | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [langMismatch, setLangMismatch] = useState<LangMismatch | null>(null);
  /** True when the analyser detects voice above the RMS threshold. */
  const [hasVoice, setHasVoice] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const resetTimerRef = useRef<number | null>(null);
  const startInFlightRef = useRef(false);
  const stopRequestedDuringStartRef = useRef(false);
  /** Ref-tracked drag state so onClick handler always sees the latest value. */
  const isDraggingRef = useRef(false);
  const analyserCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const voicePollRef = useRef<number | null>(null);

  /** Tear down the voice-level analyser completely. */
  const cleanupVoiceDetector = useCallback(() => {
    if (voicePollRef.current !== null) {
      window.clearInterval(voicePollRef.current);
      voicePollRef.current = null;
    }
    analyserRef.current = null;
    if (analyserCtxRef.current) {
      void analyserCtxRef.current.close();
      analyserCtxRef.current = null;
    }
    setHasVoice(false);
  }, []);

  const resetToIdle = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setState("idle");
    setPreview("");
    setError("");
    setUsageLimitBlocked(false);
    setPasteAttention(null);
    setLangMismatch(null);
  }, []);

  /** Re-paste the most recent transcript without re-recording. */
  const pasteLastTranscript = useCallback(async () => {
    try {
      const records = await window.electronAPI.listHistory(1);
      const last = records[0];
      const text = last?.processedText ?? last?.originalText ?? "";
      if (!text.trim()) {
        setState("error");
        setError("No previous transcript found.");
        return;
      }
      await window.electronAPI.setOverlayInteractive(false);
      const result = await window.electronAPI.pasteText(text);
      if (!result.ok) {
        setState("error");
        setError(result.message ?? "Paste failed — text is on your clipboard.");
        if (result.attention) setPasteAttention(result.attention);
      } else {
        setState("complete");
        resetTimerRef.current = window.setTimeout(resetToIdle, COMPLETE_RESET_MS);
      }
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Paste failed.");
    }
  }, [resetToIdle]);

  /** Translate the last pasted text and re-paste. */
  const translateAndRepaste = useCallback(async (mismatch: LangMismatch, alwaysTranslate = false) => {
    log.debug("Language mismatch prompt action", {
      action: "translate",
      detected: mismatch.detected,
      configured: mismatch.configured,
    });
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    if (alwaysTranslate) {
      enableAutoTranslateMismatch(mismatch);
    }
    setLangMismatch(null);
    setState("processing");
    try {
      const historyFallback = async () => {
        const records = await window.electronAPI.listHistory(1);
        return records[0]?.processedText ?? records[0]?.originalText ?? "";
      };
      const text = preview.trim() || await historyFallback();
      if (!text.trim()) { resetToIdle(); return; }
      const { text: translated } = await window.electronAPI.translateText(text, mismatch.configured);
      if (
        mismatch.detected !== mismatch.configured
        && normalizeComparableText(translated) === normalizeComparableText(text)
      ) {
        throw new Error("Translation returned unchanged text.");
      }
      const pasteResult = await window.electronAPI.replaceLastPastedText(text, translated);
      if (!pasteResult.ok) {
        setState("error");
        setError(pasteResult.message ?? "Paste failed.");
        return;
      }
      setPreview(translated);
      setState("complete");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Translation failed.");
      return;
    }
    resetTimerRef.current = window.setTimeout(resetToIdle, COMPLETE_RESET_MS);
  }, [preview, resetToIdle]);

  useEffect(() => {
    if (langMismatch && state === "complete") {
      log.debug("Language mismatch prompt shown", {
        detected: langMismatch.detected,
        configured: langMismatch.configured,
      });
    }
  }, [langMismatch, state]);

  useEffect(() => {
    log.info("Overlay mounted");
    window.electronAPI.getSettings().then((next) => {
      log.debug("Overlay settings loaded", next);
      setSettings(next);
    });
    window.electronAPI.getWordCountThisWeek().then(setWeeklyUsage);
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

  // Keep interactivity in sync with all overlay-visible states so hover cannot leave the window click-blocking.
  useEffect(() => {
    if (state === "idle" && !menuOpen && !isHovered) {
      log.debug("Overlay returned to idle — releasing mouse capture");
      void window.electronAPI.setOverlayInteractive(false);
    } else {
      log.debug("Overlay active state — capturing mouse", { state, isHovered, menuOpen });
      void window.electronAPI.setOverlayInteractive(true);
    }
  }, [state, menuOpen, isHovered]);

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
      const usage = await window.electronAPI.getWordCountThisWeek();
      setWeeklyUsage(usage);
      if (usage.isLimited && usage.wordsRemaining !== null && usage.wordsRemaining <= 0) {
        setState("error");
        setPreview("");
        setError("You've reached your free weekly word limit.");
        setUsageLimitBlocked(true);
        startInFlightRef.current = false;
        return;
      }
      log.info("Starting dictation");
      setError("");
      setUsageLimitBlocked(false);
      setPasteAttention(null);
      setPreview("");
      playTone("start");
      const prefMicId = localStorage.getItem(PREF_MIC_KEY) ?? "";
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(prefMicId ? { deviceId: { ideal: prefMicId } } : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];

      // Set up real-time voice-level detection for the dots↔waves visual switch.
      cleanupVoiceDetector();
      try {
        const actx = new AudioContext();
        analyserCtxRef.current = actx;
        const analyser = actx.createAnalyser();
        analyser.fftSize = 256;
        actx.createMediaStreamSource(stream).connect(analyser);
        analyserRef.current = analyser;
        const data = new Uint8Array(analyser.frequencyBinCount);
        voicePollRef.current = window.setInterval(() => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(data);
          const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
          setHasVoice(avg > VOICE_RMS_THRESHOLD);
        }, VOICE_POLL_MS);
      } catch {
        log.debug("Voice level detection unavailable");
      }

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
      cleanupVoiceDetector();
      setState("error");
      setError(err instanceof Error ? err.message : "Microphone access failed.");
      log.error("Failed to start dictation", err);
    }
  }, [resetToIdle, cleanupVoiceDetector]);

  const stopDictation = useCallback(() => {
    log.info("Stopping dictation", { recorderState: recorderRef.current?.state });
    if (startInFlightRef.current && recorderRef.current?.state !== "recording") {
      stopRequestedDuringStartRef.current = true;
      return;
    }
    if (recorderRef.current?.state === "recording") {
      playTone("stop");
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
    cleanupVoiceDetector();
    setState("processing");
    setPreview("");
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
      window.electronAPI.getWordCountThisWeek().then(setWeeklyUsage);

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

      let textToPaste = result.text;

      await window.electronAPI.setOverlayInteractive(false);
      const pasteResult = await window.electronAPI.pasteText(textToPaste);
      if (!pasteResult.ok) {
        if (pasteResult.attention) {
          setPasteAttention(pasteResult.attention);
          setPreview(result.text);
          setError("Couldn't paste — text is on your clipboard");
          setState("error");
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
      // If mismatch exists, keep prompt open until user acts (translate or keep).
      if (result.langMismatch) {
        setLangMismatch(result.langMismatch);
      } else {
        resetTimerRef.current = window.setTimeout(() => {
          log.debug("Resetting overlay after completion");
          resetToIdle();
        }, COMPLETE_RESET_MS);
      }
    } catch (err) {
      setPasteAttention(null);
      setState("error");
      const raw = err instanceof Error ? err.message : "Transcription failed.";
      // Strip the Electron IPC wrapper prefix if present
      const ipcPrefix = "Error invoking remote method 'transcribe:local-whisper': Error: ";
      const message = raw.startsWith(ipcPrefix) ? raw.slice(ipcPrefix.length) : raw;
      setError(message);
      setUsageLimitBlocked(message.toLowerCase().includes("word limit"));
      log.error("Failed to finish dictation", err);
    }
  }, [settings, resetToIdle, cleanupVoiceDetector]);

  // Drives all visual changes — order matters: active states take priority over hover
  const micState = (() => {
    if (state === "recording") return "recording" as const;
    if (state === "processing") return "processing" as const;
    if (state === "complete") return "complete" as const;
    if (state === "error") return "error" as const;
    if (isHovered) return "hover" as const;
    return "idle" as const;
  })();

  /** Pill dimensions driven by state + hover. */
  const pillSize = (() => {
    if (state === "recording") return { width: 220, height: 40 };
    if (state === "processing") return { width: 180, height: 40 };
    if (state === "complete") return { width: 130, height: 32 };
    if (isHovered && state === "idle") return { width: 144, height: 32 };
    return { width: 110, height: 8 }; // resting thin line
  })();

  /** Whether the pill is large enough to show inner content. */
  const isPillExpanded =
    state === "recording" ||
    state === "processing" ||
    state === "complete" ||
    (state === "idle" && isHovered);

  return (
    <I18nProvider language={settings?.displayLanguage ?? "en"}>
      <main className="overlay-stage">
      {/* ── Error panel — only appears on error ── */}
      <AnimatePresence>
        {state === "error" && (
          <motion.section
            className="pill-error-panel glass-panel-strong"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.18 }}
          >
            <div className="pill-error-panel__header">
              <AlertTriangle size={13} />
              <span>{error || "Something went wrong"}</span>
              <button
                type="button"
                className="pill-error-dismiss"
                aria-label="Dismiss"
                onClick={resetToIdle}
              >
                <X size={10} strokeWidth={2.5} />
              </button>
            </div>
            {pasteAttention && (
              <>
                <p className="pill-error-panel__hint">Press ⌘V to paste — text is on your clipboard</p>
                <div className="pill-error-panel__actions">
                  <TextButton variant="quiet" onClick={() => window.electronAPI.openPanel()}>
                    Fix paste setup
                  </TextButton>
                </div>
              </>
            )}
            {!pasteAttention && (usageLimitBlocked || weeklyUsage?.isLimitReached) && (
              <>
                <p className="pill-error-panel__hint">You've used your free words for this week. Upgrade for unlimited dictation.</p>
                <div className="pill-error-panel__actions">
                  <TextButton variant="primary" onClick={() => window.electronAPI.openPanelTab("account")}>Upgrade plan</TextButton>
                </div>
              </>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {/* ── Language mismatch translation prompt ── */}
      <AnimatePresence>
        {langMismatch && state === "complete" && (
          <motion.div
            className="pill-translate-prompt"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.18 }}
          >
            {/* Header row: icon + title + badge + close */}
            <div className="pill-translate-prompt__header">
              <div className="pill-translate-prompt__icon" aria-hidden="true">
                <Languages size={18} />
              </div>
              <div className="pill-translate-prompt__title-row">
                <span className="pill-translate-prompt__title">
                  {LANG_DISPLAY_NAMES[langMismatch.detected] ?? langMismatch.detected} detected
                </span>
                <span className="pill-translate-prompt__badge">
                  {langMismatch.detected.toUpperCase()} → {langMismatch.configured.toUpperCase()}
                </span>
              </div>
              <button
                type="button"
                className="pill-translate-prompt__close"
                aria-label="Dismiss"
                onClick={() => {
                  log.debug("Language mismatch prompt action", {
                    action: "keep",
                    detected: langMismatch.detected,
                    configured: langMismatch.configured,
                  });
                  resetToIdle();
                }}
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>

            {/* Description */}
            <p className="pill-translate-prompt__label">
              {`You're speaking ${LANG_DISPLAY_NAMES[langMismatch.detected] ?? langMismatch.detected}, but your transcription language is set to `}
              <strong>{LANG_DISPLAY_NAMES[langMismatch.configured] ?? langMismatch.configured}</strong>
              {`. Translate this dictation to ${LANG_DISPLAY_NAMES[langMismatch.configured] ?? langMismatch.configured} or continue in ${LANG_DISPLAY_NAMES[langMismatch.detected] ?? langMismatch.detected}?`}
            </p>

            {/* Primary actions */}
            <div className="pill-translate-prompt__actions">
              <TextButton variant="primary" onClick={() => void translateAndRepaste(langMismatch)}>
                Translate to {LANG_DISPLAY_NAMES[langMismatch.configured] ?? langMismatch.configured}
              </TextButton>
              <TextButton variant="glass" onClick={() => {
                log.debug("Language mismatch prompt action", {
                  action: "keep",
                  detected: langMismatch.detected,
                  configured: langMismatch.configured,
                });
                resetToIdle();
              }}>
                Continue in {LANG_DISPLAY_NAMES[langMismatch.detected] ?? langMismatch.detected}
              </TextButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Pill bar + hover controls ── */}
      <div
        className="pill-bar-wrapper"
        onMouseEnter={() => {
          setIsHovered(true);
          void window.electronAPI.setOverlayInteractive(true);
        }}
        onMouseLeave={(e) => {
          // Don't close if moving to the menu (pill-menu-anchor is a DOM child of this wrapper
          // but visually outside its layout box — so check relatedTarget just in case).
          const rel = e.relatedTarget as Element | null;
          if (rel?.closest(".pill-menu-anchor")) return;
          setIsHovered(false);
          // Give user 350ms to reach the context menu before closing it
          setTimeout(() => setMenuOpen(false), 350);
        }}
      >
        {/* Context menu — appears above the pill when gear is clicked */}
        <AnimatePresence>
          {menuOpen && (
            <PillContextMenu
              onClose={() => setMenuOpen(false)}
              onPasteLastTranscript={() => void pasteLastTranscript()}
            />
          )}
        </AnimatePresence>

        {/* Settings/menu gear button — only visible when idle and hovered */}
        <AnimatePresence>
          {isHovered && state === "idle" && (
            <motion.button
              type="button"
              className="pill-hover-btn"
              aria-label="Open menu"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.12 }}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((prev) => !prev);
              }}
            >
              <Settings size={12} />
            </motion.button>
          )}
        </AnimatePresence>

        {/* The main pill — framer-motion spring handles width/height transitions */}
        <motion.div
          className="pill-bar"
          data-state={micState}
          animate={pillSize}
          transition={{ type: "spring", stiffness: 260, damping: 32, mass: 0.8 }}
          aria-label={state === "recording" ? "Stop dictation" : "Start dictation"}
          role="button"
          tabIndex={0}
          onMouseDown={(e) => {
            // Allow dragging the pill when idle
            if (e.button === 0 && state === "idle") {
              isDraggingRef.current = false; // reset; set to true only on actual move
              e.preventDefault();
            }
          }}
          onMouseMove={(e) => {
            if (e.buttons === 1 && state === "idle" && !isDraggingRef.current) {
              isDraggingRef.current = true;
              setIsDragging(true);
              void window.electronAPI.startWindowDrag();
            }
          }}
          onClick={() => {
            if (!isDraggingRef.current) void toggleDictation();
          }}
        >
          {/* Inner content — fades in/out when pill expands */}
          <AnimatePresence mode="wait">
            {(micState === "idle" || micState === "hover") && isPillExpanded && (
              <motion.div
                key="dots"
                className="pill-bar__inner"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
              >
                <PillDots />
              </motion.div>
            )}
            {micState === "recording" && (
              <motion.div
                key="wave"
                className="pill-bar__inner"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
              >
                {hasVoice ? <PillWave /> : <PillDots />}
              </motion.div>
            )}
            {micState === "processing" && (
              <motion.div
                key="processing"
                className="pill-bar__inner"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
              >
                <PillProcessing />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Cancel button — appears to the right of the pill while recording */}
        <AnimatePresence>
          {(state === "recording" || state === "processing") && isHovered && (
            <motion.button
              type="button"
              className="pill-hover-btn pill-hover-btn--danger"
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
              <X size={12} strokeWidth={2.5} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </main>
    </I18nProvider>
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
