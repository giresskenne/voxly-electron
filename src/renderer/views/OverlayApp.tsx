import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, ChevronDown, ClipboardPaste, Clock, Languages, LogIn, Mic, ScrollText, Settings, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings, AudioChunk, CleanupStatus, FullDictationTiming, LangMismatch, PasteAttention, WeeklyUsageStatus } from "../../main/types";
import { TextButton } from "../components/Controls";
import { createRendererLogger } from "../lib/debug-log";
import { I18nProvider, useT } from "../lib/i18n";
import { capture, type AnalyticsEventName, type DictationAnalyticsProperties } from "../services/analytics";

type DictationState = "idle" | "starting" | "recording" | "processing" | "complete" | "error";
type PillVisualState = DictationState | "hover";

const log = createRendererLogger("overlay-ui");
const FN_FLOW_TRACE = import.meta.env.DEV;

function logFnFlow(message: string, meta?: unknown): void {
  if (!FN_FLOW_TRACE) return;
  log.info(`[fn-flow] ${message}`, meta);
}

/** localStorage key for the user's preferred microphone device ID. Empty string means auto-detect. */
const PREF_MIC_KEY = "voxly:micDeviceId";

const CLOUD_CHUNK_MS = 240_000;
const RECORDING_AUDIO_BITS_PER_SECOND = 128_000;
const COMPLETE_RESET_MS = 0;
const PILL_SIZES = {
  idle: { width: 96, height: 7 },
  hover: { width: 124, height: 30 },
  starting: { width: 146, height: 36 },
  recording: { width: 172, height: 36 },
  processing: { width: 146, height: 36 },
  complete: { width: 108, height: 30 },
  error: { width: 96, height: 7 },
} as const satisfies Record<PillVisualState, { width: number; height: number }>;
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

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function errorType(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "Error";
}

function finalizedCleanupStatus(cleanupStatus: CleanupStatus, replacement: "skipped" | "replaced" | "failed"): CleanupStatus {
  if (cleanupStatus === "failed" || replacement === "failed") return "failed";
  if (cleanupStatus === "skipped_short_text" || cleanupStatus === "not_requested") return cleanupStatus;
  return replacement === "replaced" ? "completed_replaced" : "completed_unchanged";
}

function captureDictationEvent(eventName: AnalyticsEventName, properties: DictationAnalyticsProperties): void {
  // Privacy: never send transcript text, audio, app context, selected text, URLs, tokens, or secrets.
  // Only safe timing/mode/status metadata is allowed for dictation analytics.
  capture(eventName, properties);
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
  onKeepOpen: () => void;
  onPasteLastTranscript: () => void;
};

const PillContextMenu = ({ onClose, onKeepOpen, onPasteLastTranscript }: PillMenuProps) => {
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
    <div
      className="pill-menu-anchor"
      onMouseLeave={scheduleClose}
      onMouseEnter={() => {
        cancelClose();
        onKeepOpen();
      }}
    >
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
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [langMismatch, setLangMismatch] = useState<LangMismatch | null>(null);
  /** True when the analyser detects voice above the RMS threshold. */
  const [hasVoice, setHasVoice] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const settingsRef = useRef<AppSettings | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const resetTimerRef = useRef<number | null>(null);
  const menuCloseTimerRef = useRef<number | null>(null);
  const startInFlightRef = useRef(false);
  const stopRequestedDuringStartRef = useRef(false);
  /** Ref-tracked drag state so onClick handler always sees the latest value. */
  const isDraggingRef = useRef(false);
  const analyserCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const voicePollRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingStoppedAtRef = useRef<number | null>(null);
  const lastStateRef = useRef<DictationState>("idle");
  const pendingGuestTrialPromptRef = useRef(false);

  const cancelMenuClose = useCallback(() => {
    if (menuCloseTimerRef.current === null) return;
    window.clearTimeout(menuCloseTimerRef.current);
    menuCloseTimerRef.current = null;
  }, []);

  const closeMenu = useCallback(() => {
    cancelMenuClose();
    setMenuOpen(false);
  }, [cancelMenuClose]);

  const scheduleMenuClose = useCallback(() => {
    cancelMenuClose();
    menuCloseTimerRef.current = window.setTimeout(() => {
      menuCloseTimerRef.current = null;
      setMenuOpen(false);
    }, 350);
  }, [cancelMenuClose]);

  useEffect(() => cancelMenuClose, [cancelMenuClose]);

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

  const showPendingGuestTrialPrompt = useCallback(() => {
    if (!pendingGuestTrialPromptRef.current) return;
    pendingGuestTrialPromptRef.current = false;
    setShowSignInPrompt(true);
  }, []);

  const consumeGuestTrialIfNeeded = useCallback(async () => {
    const currentSettings = settingsRef.current;
    if (isAuthenticated || currentSettings?.guestTrialUsed) return false;
    const next = await window.electronAPI.updateSettings({ guestTrialUsed: true });
    settingsRef.current = next;
    setSettings(next);
    log.info("Guest trial consumed after successful dictation");
    return true;
  }, [isAuthenticated]);

  const openSignInFromOverlay = useCallback(() => {
    setShowSignInPrompt(false);
    void window.electronAPI.openWebRoute("signin");
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
      if (!text.trim()) {
        resetToIdle();
        showPendingGuestTrialPrompt();
        return;
      }
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
      showPendingGuestTrialPrompt();
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Translation failed.");
      return;
    }
    resetTimerRef.current = window.setTimeout(resetToIdle, COMPLETE_RESET_MS);
  }, [preview, resetToIdle, showPendingGuestTrialPrompt]);

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
      settingsRef.current = next;
      setSettings(next);
    });
    window.electronAPI.hasSessionToken().then((hasSession) => {
      setIsAuthenticated(hasSession);
      if (hasSession) {
        pendingGuestTrialPromptRef.current = false;
        setShowSignInPrompt(false);
      }
    });
    window.electronAPI.getWordCountThisWeek().then(setWeeklyUsage);
    const offToggle = window.electronAPI.onDictationToggle(() => {
      log.info("Received dictation toggle from main");
      logFnFlow("renderer received dictation:toggle", {
        state: lastStateRef.current,
        recorderState: recorderRef.current?.state ?? null,
      });
      void toggleDictationRef.current();
    });
    const offStart = window.electronAPI.onDictationStart(() => {
      log.info("Received dictation start from main");
      logFnFlow("renderer received dictation:start", {
        state: lastStateRef.current,
        recorderState: recorderRef.current?.state ?? null,
      });
      void startDictationRef.current();
    });
    const offStop = window.electronAPI.onDictationStop(() => {
      log.info("Received dictation stop from main");
      logFnFlow("renderer received dictation:stop", {
        state: lastStateRef.current,
        recorderState: recorderRef.current?.state ?? null,
        startInFlight: startInFlightRef.current,
      });
      stopDictationRef.current();
    });
    const offSettings = window.electronAPI.onSettingsUpdated((next) => {
      log.debug("Overlay settings updated", next);
      settingsRef.current = next;
      setSettings(next);
    });
    const offSessionUpdated = window.electronAPI.onSessionUpdated((entitlements) => {
      log.info("Overlay received session update", {
        authenticated: entitlements.isAuthenticated,
        billingPlan: entitlements.billingPlan,
        billingStatus: entitlements.billingStatus,
      });
      setIsAuthenticated(entitlements.isAuthenticated);
      if (entitlements.isAuthenticated) {
        pendingGuestTrialPromptRef.current = false;
        setShowSignInPrompt(false);
      }
    });
    const offSessionExpired = window.electronAPI.onSessionExpired(() => {
      log.info("Overlay received session expired");
      setIsAuthenticated(false);
    });
    return () => {
      offToggle();
      offStart();
      offStop();
      offSettings();
      offSessionUpdated();
      offSessionExpired();
    };
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (lastStateRef.current === state) return;
    logFnFlow("overlay state changed", {
      from: lastStateRef.current,
      to: state,
      recorderState: recorderRef.current?.state ?? null,
      chunkCount: chunksRef.current.length,
    });
    lastStateRef.current = state;
  }, [state]);

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
    if (state === "idle" && !menuOpen && !isHovered && !showSignInPrompt) {
      log.debug("Overlay returned to idle — releasing mouse capture");
      void window.electronAPI.setOverlayInteractive(false);
    } else {
      log.debug("Overlay active state — capturing mouse", { state, isHovered, menuOpen });
      void window.electronAPI.setOverlayInteractive(true);
    }
  }, [state, menuOpen, isHovered, showSignInPrompt]);

  const startDictation = useCallback(async () => {
    if (startInFlightRef.current || recorderRef.current?.state === "recording") {
      log.debug("Start dictation ignored because recording is already active");
      logFnFlow("start ignored; recorder already active", {
        startInFlight: startInFlightRef.current,
        recorderState: recorderRef.current?.state ?? null,
      });
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
      const currentSettings = settingsRef.current;
      if (!isAuthenticated && currentSettings?.guestTrialUsed) {
        log.info("Guest trial already used; showing sign-in prompt");
        setState("idle");
        setError("");
        setUsageLimitBlocked(false);
        setPasteAttention(null);
        setPreview("");
        setLangMismatch(null);
        setShowSignInPrompt(true);
        startInFlightRef.current = false;
        return;
      }
      setShowSignInPrompt(false);
      setState("starting");
      setError("");
      setUsageLimitBlocked(false);
      setPasteAttention(null);
      setPreview("");
      playTone("start");
      logFnFlow("recording visual activated before async setup", {
        transcriptionMode: settingsRef.current?.transcriptionMode,
        cleanupMode: settingsRef.current?.cleanupMode,
      });

      const usage = await window.electronAPI.getWordCountThisWeek();
      setWeeklyUsage(usage);
      logFnFlow("weekly usage checked before recording", {
        isLimited: usage.isLimited,
        wordsRemaining: usage.wordsRemaining,
        isLimitReached: usage.isLimitReached,
      });
      if (usage.isLimited && usage.wordsRemaining !== null && usage.wordsRemaining <= 0) {
        setState("error");
        setPreview("");
        setError("You've reached your free weekly word limit.");
        setUsageLimitBlocked(true);
        captureDictationEvent("dictation_failed", {
          transcriptionMode: settingsRef.current?.transcriptionMode,
          cleanupMode: settingsRef.current?.cleanupMode,
          cleanupStatus: "not_requested",
          success: false,
          failureStage: "usage_limit",
          errorType: "UsageLimit",
        });
        startInFlightRef.current = false;
        return;
      }
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
      logFnFlow("microphone stream acquired", {
        mimeType,
        trackCount: stream.getTracks().length,
        preferredMicConfigured: Boolean(prefMicId),
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
        logFnFlow("media recorder onstop fired", {
          chunkCount: chunksRef.current.length,
          recordingMs: recordingStartedAtRef.current && recordingStoppedAtRef.current
            ? Math.round(recordingStoppedAtRef.current - recordingStartedAtRef.current)
            : null,
        });
        recorderRef.current = null;
        void finishDictation();
      };
      recorder.start(CLOUD_CHUNK_MS);
      recordingStartedAtRef.current = performance.now();
      recordingStoppedAtRef.current = null;
      setState("recording");
      logFnFlow("media recorder started", {
        recorderState: recorder.state,
        timesliceMs: CLOUD_CHUNK_MS,
      });
      captureDictationEvent("dictation_started", {
        transcriptionMode: settingsRef.current?.transcriptionMode,
        cleanupMode: settingsRef.current?.cleanupMode,
        cleanupStatus: settingsRef.current?.cleanupEnabled && settingsRef.current.cleanupMode === "fast" ? "pending_background" : undefined,
        success: true,
      });
      startInFlightRef.current = false;
      if (stopRequestedDuringStartRef.current) {
        stopRequestedDuringStartRef.current = false;
        recordingStoppedAtRef.current = performance.now();
        logFnFlow("stop requested during async start; stopping recorder immediately", {
          recorderState: recorder.state,
        });
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }
    } catch (err) {
      startInFlightRef.current = false;
      stopRequestedDuringStartRef.current = false;
      cleanupVoiceDetector();
      setState("error");
      setError(err instanceof Error ? err.message : "Microphone access failed.");
      log.error("Failed to start dictation", err);
      logFnFlow("start dictation failed", {
        errorType: errorType(err),
        message: err instanceof Error ? err.message : String(err),
      });
      captureDictationEvent("dictation_failed", {
        transcriptionMode: settingsRef.current?.transcriptionMode,
        cleanupMode: settingsRef.current?.cleanupMode,
        cleanupStatus: "not_requested",
        success: false,
        failureStage: "microphone",
        errorType: errorType(err),
      });
    }
  }, [isAuthenticated, resetToIdle, cleanupVoiceDetector]);

  const stopDictation = useCallback(() => {
    log.info("Stopping dictation", { recorderState: recorderRef.current?.state });
    logFnFlow("stop requested in renderer", {
      startInFlight: startInFlightRef.current,
      recorderState: recorderRef.current?.state ?? null,
      chunkCount: chunksRef.current.length,
    });
    if (startInFlightRef.current && recorderRef.current?.state !== "recording") {
      stopRequestedDuringStartRef.current = true;
      logFnFlow("stop deferred until recorder finishes starting");
      return;
    }
    if (recorderRef.current?.state === "recording") {
      playTone("stop");
      recordingStoppedAtRef.current = performance.now();
      logFnFlow("media recorder stop called", {
        recordingMs: recordingStartedAtRef.current
          ? Math.round(recordingStoppedAtRef.current - recordingStartedAtRef.current)
          : null,
      });
      recorderRef.current.stop();
    } else {
      logFnFlow("stop ignored; no active recording recorder");
    }
  }, []);

  const toggleDictation = useCallback(async () => {
    log.debug("Toggle dictation requested", { state });
    if (state === "error") {
      resetToIdle();
      return;
    }
    if (state === "recording" || state === "starting") {
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
    logFnFlow("finish dictation started", {
      chunkCount: chunksRef.current.length,
      recordingMs: recordingStartedAtRef.current && recordingStoppedAtRef.current
        ? Math.round(recordingStoppedAtRef.current - recordingStartedAtRef.current)
        : null,
    });
    cleanupVoiceDetector();
    setState("processing");
    setPreview("");
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    let failureStage = "audio_prep";
    let failureMetadata: DictationAnalyticsProperties = {};

    try {
      const currentSettings = settingsRef.current;
      const t0 = performance.now();
      const blob = new Blob(chunksRef.current, { type: preferredMimeType() });
      log.debug("Audio blob prepared", { size: blob.size, type: blob.type });
      if (chunksRef.current.length === 0 || blob.size === 0) {
        log.warn("Empty recording captured; skipping transcription", {
          chunkCount: chunksRef.current.length,
          blobSize: blob.size,
        });
        resetToIdle();
        return;
      }

      const isCloudMode = currentSettings?.transcriptionMode === "cloud";
      let arrayBuffer: ArrayBuffer;
      if (isCloudMode) {
        // Cloud transcription accepts webm/opus natively — skip the expensive WAV conversion.
        arrayBuffer = await blob.arrayBuffer();
        log.debug("Skipped WAV conversion (cloud mode)", { byteLength: arrayBuffer.byteLength });
      } else {
        // Local Whisper needs 16-bit mono 16 kHz WAV.
        arrayBuffer = await blobToWav(blob);
        log.debug("WAV conversion complete", { wavByteLength: arrayBuffer.byteLength });
      }

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
        isCloudMode,
      });
      logFnFlow("audio prepared for transcription", {
        audioPrepMs: Math.round(t1 - t0),
        byteLength: arrayBuffer.byteLength,
        chunkCount: chunks.length,
        isCloudMode,
      });

      const fastPasteEnabled = currentSettings?.cleanupMode === "fast" && currentSettings.cleanupEnabled;
      const transcriptionOptions = fastPasteEnabled
        ? { ...currentSettings, cleanupEnabled: false, saveToHistory: false }
        : currentSettings ?? undefined;
      failureStage = "transcription";
      const result = await window.electronAPI.transcribeLocalWhisper(arrayBuffer, transcriptionOptions, chunks);
      if (!fastPasteEnabled) {
        window.electronAPI.getWordCountThisWeek().then(setWeeklyUsage);
      }

      const t2 = performance.now();
      log.info("Transcription IPC round-trip complete", {
        transcribeMs: Math.round(t2 - t1),
        textLength: result.text.length,
        recordId: result.record?.id,
      });
      logFnFlow("transcription returned to overlay", {
        transcribeMs: Math.round(t2 - t1),
        textLength: result.text.length,
        hasLangMismatch: Boolean(result.langMismatch),
        cleanupStatus: fastPasteEnabled ? "pending_background" : result.timing?.cleanupStatus,
      });

      setPreview(result.text);

      // Nothing was said (blank audio) — silently return to idle without pasting.
      if (!result.text.trim()) {
        log.info("Blank transcription — skipping paste");
        resetToIdle();
        return;
      }

      const textToPaste = result.text;

      await window.electronAPI.setOverlayInteractive(false);
      failureStage = "paste";
      logFnFlow("paste requested from overlay", {
        textLength: textToPaste.length,
        fastPasteEnabled,
      });
      const pasteStartedAt = performance.now();
      const pasteResult = await window.electronAPI.pasteText(textToPaste);
      logFnFlow("paste result returned to overlay", {
        ok: pasteResult.ok,
        attentionKind: pasteResult.attention?.kind ?? null,
        pasteMs: Math.round(performance.now() - pasteStartedAt),
        textLength: textToPaste.length,
      });
      if (!pasteResult.ok) {
        if (pasteResult.attention) {
          setPasteAttention(pasteResult.attention);
          setPreview(result.text);
          setError("Couldn't paste — text is on your clipboard");
          setState("error");
          captureDictationEvent("dictation_failed", {
            transcriptionMode: result.timing?.transcriptionMode ?? currentSettings?.transcriptionMode,
            cleanupMode: result.timing?.cleanupMode ?? currentSettings?.cleanupMode,
            cleanupStatus: fastPasteEnabled ? "pending_background" : result.timing?.cleanupStatus,
            audioDurationMs: recordingStoppedAtRef.current && recordingStartedAtRef.current
              ? Math.max(0, Math.round(recordingStoppedAtRef.current - recordingStartedAtRef.current))
              : undefined,
            audioPrepMs: Math.round(t1 - t0),
            transcriptionMs: result.timing?.transcriptionMs,
            pasteMs: Math.round(performance.now() - t2),
            wordCount: countWords(textToPaste),
            success: false,
            failureStage: "paste",
            errorType: "PasteAttention",
          });
          return;
        }
        throw new Error(pasteResult.message ?? "Text copied, but paste did not complete.");
      }

      const t3 = performance.now();
      const recordingStartedAt = recordingStartedAtRef.current;
      const recordingStoppedAt = recordingStoppedAtRef.current ?? t0;
      const recordingMs = recordingStartedAt === null ? 0 : Math.max(0, Math.round(recordingStoppedAt - recordingStartedAt));
      const cleanupStatus: CleanupStatus = fastPasteEnabled ? "pending_background" : result.timing?.cleanupStatus ?? "not_requested";
      // Build a fully-typed timing object for compile-time verification of all required fields.
      const dictationTiming: FullDictationTiming = {
        recordingMs,
        audioDurationMs: recordingMs,
        audioPrepMs: Math.round(t1 - t0),
        transcriptionMs: result.timing?.transcriptionMs ?? 0,
        cleanupMs: result.timing?.cleanupMs ?? 0,
        dbSaveMs: result.timing?.dbSaveMs ?? 0,
        transcriptionMode: result.timing?.transcriptionMode ?? currentSettings?.transcriptionMode ?? "local",
        cleanupMode: result.timing?.cleanupMode ?? currentSettings?.cleanupMode ?? "accurate",
        cleanupEnabled: fastPasteEnabled ? true : result.timing?.cleanupEnabled ?? Boolean(currentSettings?.cleanupEnabled),
        cleanupSkipped: fastPasteEnabled ? false : result.timing?.cleanupSkipped ?? false,
        cleanupStatus,
        pasteMs: Math.round(t3 - t2),
        totalAfterStopMs: Math.round(t3 - t0),
        audioBytes: arrayBuffer.byteLength,
        timeToRawPasteMs: Math.round(t3 - t0),
        cleanupCompletedAfterPasteMs: null,
        totalFinalizationMs: fastPasteEnabled ? null : Math.round(t3 - t0),
      };
      log.info("Dictation timing", {
        ...dictationTiming,
        transcribeIpcMs: Math.round(t2 - t1),
      });
      failureMetadata = {
        transcriptionMode: dictationTiming.transcriptionMode,
        cleanupMode: dictationTiming.cleanupMode,
        cleanupStatus: dictationTiming.cleanupStatus,
        audioDurationMs: dictationTiming.audioDurationMs,
        audioPrepMs: dictationTiming.audioPrepMs,
        transcriptionMs: dictationTiming.transcriptionMs,
        cleanupMs: dictationTiming.cleanupMs,
        pasteMs: dictationTiming.pasteMs,
        timeToRawPasteMs: dictationTiming.timeToRawPasteMs,
        wordCount: countWords(textToPaste),
      };

      if (fastPasteEnabled) {
        captureDictationEvent("dictation_raw_pasted", {
          ...failureMetadata,
          success: true,
        });
      } else {
        captureDictationEvent("dictation_cleanup_completed", {
          ...failureMetadata,
          cleanupCompletedAfterPasteMs: dictationTiming.cleanupCompletedAfterPasteMs,
          totalFinalizationMs: dictationTiming.totalFinalizationMs,
          success: dictationTiming.cleanupStatus !== "failed",
        });
      }

      setState("complete");
      logFnFlow("overlay marked dictation complete", {
        pasteMs: dictationTiming.pasteMs,
        timeToRawPasteMs: dictationTiming.timeToRawPasteMs,
        fastPasteEnabled,
      });
      const shouldPromptSignIn = await consumeGuestTrialIfNeeded();
      if (fastPasteEnabled) {
        void (async () => {
          try {
            const cleanup = await window.electronAPI.cleanupTranscriptionLater(result.originalText || textToPaste, currentSettings ?? undefined);
            window.electronAPI.getWordCountThisWeek().then(setWeeklyUsage);
            const cleanupDoneAt = performance.now();
            let replacement: "skipped" | "replaced" | "failed" = "skipped";
            if (
              !result.langMismatch
              && normalizeComparableText(cleanup.text) !== normalizeComparableText(textToPaste)
            ) {
              const replaceResult = await window.electronAPI.replaceLastPastedText(textToPaste, cleanup.text);
              replacement = replaceResult.ok ? "replaced" : "failed";
              if (replaceResult.ok) {
                setPreview(cleanup.text);
              }
            }
            const finalDoneAt = performance.now();
            const finalCleanupStatus = finalizedCleanupStatus(cleanup.timing.cleanupStatus, replacement);
            const cleanupCompletedAfterPasteMs = Math.round(cleanupDoneAt - t3);
            const totalFinalizationMs = Math.round(finalDoneAt - t0);
            const finalTiming: FullDictationTiming = {
              ...dictationTiming,
              cleanupMs: cleanup.timing.cleanupMs,
              dbSaveMs: cleanup.timing.dbSaveMs,
              cleanupMode: cleanup.timing.cleanupMode,
              cleanupEnabled: cleanup.timing.cleanupEnabled,
              cleanupSkipped: cleanup.timing.cleanupSkipped,
              cleanupStatus: finalCleanupStatus,
              cleanupCompletedAfterPasteMs,
              totalFinalizationMs,
            };

            log.info("Dictation finalization timing", {
              ...finalTiming,
              replacement,
              recordId: cleanup.record?.id,
              processedLength: cleanup.text.length,
            });
            captureDictationEvent("dictation_cleanup_completed", {
              transcriptionMode: finalTiming.transcriptionMode,
              cleanupMode: finalTiming.cleanupMode,
              cleanupStatus: finalTiming.cleanupStatus,
              audioDurationMs: finalTiming.audioDurationMs,
              audioPrepMs: finalTiming.audioPrepMs,
              transcriptionMs: finalTiming.transcriptionMs,
              cleanupMs: finalTiming.cleanupMs,
              pasteMs: finalTiming.pasteMs,
              timeToRawPasteMs: finalTiming.timeToRawPasteMs,
              cleanupCompletedAfterPasteMs: finalTiming.cleanupCompletedAfterPasteMs,
              totalFinalizationMs: finalTiming.totalFinalizationMs,
              wordCount: countWords(cleanup.text),
              replacement,
              success: finalTiming.cleanupStatus !== "failed",
            });
            if (finalTiming.cleanupStatus === "failed") {
              captureDictationEvent("dictation_failed", {
                transcriptionMode: finalTiming.transcriptionMode,
                cleanupMode: finalTiming.cleanupMode,
                cleanupStatus: finalTiming.cleanupStatus,
                audioDurationMs: finalTiming.audioDurationMs,
                audioPrepMs: finalTiming.audioPrepMs,
                transcriptionMs: finalTiming.transcriptionMs,
                cleanupMs: finalTiming.cleanupMs,
                pasteMs: finalTiming.pasteMs,
                timeToRawPasteMs: finalTiming.timeToRawPasteMs,
                cleanupCompletedAfterPasteMs: finalTiming.cleanupCompletedAfterPasteMs,
                totalFinalizationMs: finalTiming.totalFinalizationMs,
                wordCount: countWords(cleanup.text),
                success: false,
                failureStage: replacement === "failed" ? "replace" : "cleanup",
                errorType: replacement === "failed" ? "PasteReplaceFailed" : "CleanupFailed",
              });
            }
          } catch (err) {
            log.warn("Background cleanup after raw paste failed", err);
            const failedAt = performance.now();
            const failedTiming: FullDictationTiming = {
              ...dictationTiming,
              cleanupStatus: "failed",
              cleanupCompletedAfterPasteMs: Math.round(failedAt - t3),
              totalFinalizationMs: Math.round(failedAt - t0),
            };
            log.info("Dictation finalization timing", {
              ...failedTiming,
              replacement: "failed",
            });
            captureDictationEvent("dictation_cleanup_completed", {
              transcriptionMode: failedTiming.transcriptionMode,
              cleanupMode: failedTiming.cleanupMode,
              cleanupStatus: failedTiming.cleanupStatus,
              audioDurationMs: failedTiming.audioDurationMs,
              audioPrepMs: failedTiming.audioPrepMs,
              transcriptionMs: failedTiming.transcriptionMs,
              cleanupMs: failedTiming.cleanupMs,
              pasteMs: failedTiming.pasteMs,
              timeToRawPasteMs: failedTiming.timeToRawPasteMs,
              cleanupCompletedAfterPasteMs: failedTiming.cleanupCompletedAfterPasteMs,
              totalFinalizationMs: failedTiming.totalFinalizationMs,
              wordCount: failureMetadata.wordCount,
              replacement: "failed",
              success: false,
            });
            captureDictationEvent("dictation_failed", {
              ...failureMetadata,
              cleanupStatus: "failed",
              cleanupCompletedAfterPasteMs: failedTiming.cleanupCompletedAfterPasteMs,
              totalFinalizationMs: failedTiming.totalFinalizationMs,
              success: false,
              failureStage: "cleanup",
              errorType: errorType(err),
            });
          }
        })();
      }
      // If mismatch exists, keep prompt open until user acts (translate or keep).
      if (result.langMismatch) {
        setLangMismatch(result.langMismatch);
        if (shouldPromptSignIn) {
          pendingGuestTrialPromptRef.current = true;
        }
      } else {
        if (shouldPromptSignIn) {
          setShowSignInPrompt(true);
        }
        logFnFlow("scheduling overlay reset after paste", {
          resetMs: COMPLETE_RESET_MS,
        });
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
      captureDictationEvent("dictation_failed", {
        ...failureMetadata,
        success: false,
        failureStage,
        errorType: errorType(err),
      });
    }
  }, [settings, resetToIdle, cleanupVoiceDetector, consumeGuestTrialIfNeeded]);

  // Drives all visual changes — order matters: active states take priority over hover
  const micState = (() => {
    if (state === "starting") return "starting" as const;
    if (state === "recording") return "recording" as const;
    if (state === "processing") return "processing" as const;
    if (state === "complete") return "complete" as const;
    if (state === "error") return "error" as const;
    if (isHovered) return "hover" as const;
    return "idle" as const;
  })();

  /** Pill dimensions driven by state + hover. */
  const pillSize = PILL_SIZES[micState];

  /** Whether the pill is large enough to show inner content. */
  const isPillExpanded =
    state === "starting" ||
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
                  <TextButton
                    variant="primary"
                    onClick={() => {
                      // Privacy: upgrade analytics uses safe CTA metadata only, never dictated content or app context.
                      capture("upgrade_clicked", { source: "overlay_usage_limit" });
                      window.electronAPI.openPanelTab("account");
                    }}
                  >
                    Upgrade plan
                  </TextButton>
                </div>
              </>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {/* Sign-in prompt shown after the guest trial or when recording is gated. */}
      <AnimatePresence>
        {showSignInPrompt && state !== "starting" && state !== "recording" && state !== "processing" && (
          <motion.section
            className="pill-signin-prompt glass-panel-strong"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.18 }}
          >
            <div className="pill-signin-prompt__header">
              <div className="pill-signin-prompt__icon" aria-hidden="true">
                <LogIn size={16} />
              </div>
              <div className="pill-signin-prompt__title-row">
                <span className="pill-signin-prompt__title">Sign in to keep dictating</span>
                <span className="pill-signin-prompt__badge">Cloud included</span>
              </div>
              <button
                type="button"
                className="pill-signin-prompt__close"
                aria-label="Dismiss"
                onClick={() => setShowSignInPrompt(false)}
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>
            <p className="pill-signin-prompt__copy">
              Your first try is ready. Sign in to continue with local dictation or switch to cloud transcription.
            </p>
            <div className="pill-signin-prompt__actions">
              <TextButton variant="primary" onClick={openSignInFromOverlay}>
                Sign in
              </TextButton>
              <TextButton variant="glass" onClick={() => setShowSignInPrompt(false)}>
                Later
              </TextButton>
            </div>
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
                  showPendingGuestTrialPrompt();
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
                showPendingGuestTrialPrompt();
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
          cancelMenuClose();
          setIsHovered(true);
          void window.electronAPI.setOverlayInteractive(true);
        }}
        onMouseLeave={(e) => {
          // Don't close if moving to the menu (pill-menu-anchor is a DOM child of this wrapper
          // but visually outside its layout box — so check relatedTarget just in case).
          const rel = e.relatedTarget as Element | null;
          if (rel?.closest(".pill-menu-anchor")) {
            cancelMenuClose();
            return;
          }
          setIsHovered(false);
          if (menuOpen) scheduleMenuClose();
        }}
      >
        {/* Context menu — appears above the pill when gear is clicked */}
        <AnimatePresence>
          {menuOpen && (
            <PillContextMenu
              onClose={closeMenu}
              onKeepOpen={cancelMenuClose}
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
                cancelMenuClose();
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
            {micState === "starting" && (
              <motion.div
                key="starting"
                className="pill-bar__inner"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
              >
                <PillProcessing />
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
          {(state === "starting" || state === "recording" || state === "processing") && isHovered && (
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
                if (state === "starting" || state === "recording") stopDictation();
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

// Lazy singleton — creating AudioContext has ~50-150 ms cold-start overhead.
// Reusing one instance eliminates that cost for every recording after the first.
let _wavCtx: AudioContext | null = null;
function getWavCtx(): AudioContext {
  if (!_wavCtx || _wavCtx.state === "closed") {
    _wavCtx = new AudioContext({ sampleRate: 16000 });
  }
  return _wavCtx;
}

/**
 * Decode a webm/opus blob with the browser's AudioContext and re-encode as
 * 16-bit mono 16 kHz PCM WAV — the only format whisper.cpp's HTTP server
 * accepts without libav support.
 */
async function blobToWav(blob: Blob): Promise<ArrayBuffer> {
  const raw = await blob.arrayBuffer();
  // 16 kHz is what Whisper expects; AudioContext will resample automatically.
  const ctx = getWavCtx();
  // decodeAudioData consumes a copy of raw internally; the original stays valid.
  const decoded = await ctx.decodeAudioData(raw);

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
