import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Command,
  Copy,
  Disc3,
  KeyRound,
  LockKeyhole,
  Mic,
  MousePointerClick,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  ToggleLeft,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppSettings, RuntimeStatus, TranscriptionRecord } from "../../main/types";
import { BrandMark } from "../components/BrandMark";
import { TextButton } from "../components/Controls";
import { brand, modelOptions, overviewStats, shellNav, writingModes } from "../design/source";
import { cn } from "../lib/cn";
import { createRendererLogger } from "../lib/debug-log";

const log = createRendererLogger("settings-ui");

export function SettingsApp() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [history, setHistory] = useState<TranscriptionRecord[]>([]);
  const [activeSection, setActiveSection] = useState("overview");
  const [groqApiKeyInput, setGroqApiKeyInput] = useState("");
  const [openaiApiKeyInput, setOpenaiApiKeyInput] = useState("");
  const dictionary = useMemo(() => settings?.customDictionary.join(", ") ?? "", [settings]);

  useEffect(() => {
    log.info("Settings app mounted");
    void refresh();
    const off = window.electronAPI.onRuntimeStatus(setRuntime);
    return () => {
      log.info("Settings app unmounted");
      off();
    };
  }, []);

  async function refresh() {
    log.debug("Refreshing settings screen data");
    const [nextSettings, nextRuntime, nextHistory] = await Promise.all([
      window.electronAPI.getSettings(),
      window.electronAPI.getRuntimeStatus(),
      window.electronAPI.listHistory(20),
    ]);
    log.info("Settings screen data refreshed", {
      runtime: nextRuntime,
      historyCount: nextHistory.length,
      onboardingComplete: nextSettings.onboardingComplete,
    });
    setSettings(nextSettings);
    setRuntime(nextRuntime);
    setHistory(nextHistory);
  }

  async function patchSettings(patch: Partial<AppSettings>) {
    log.debug("Patching settings", patch);
    const next = await window.electronAPI.updateSettings(patch);
    setSettings(next);
    setRuntime(await window.electronAPI.getRuntimeStatus());
    log.info("Settings patch applied", patch);
  }

  async function saveCredentials() {
    const patch: Partial<AppSettings> = {};
    if (groqApiKeyInput.trim()) patch.groqApiKey = groqApiKeyInput;
    if (openaiApiKeyInput.trim()) patch.openaiApiKey = openaiApiKeyInput;
    if (Object.keys(patch).length === 0) return;

    await patchSettings(patch);
    setGroqApiKeyInput("");
    setOpenaiApiKeyInput("");
  }

  if (!settings || !runtime) {
    return <div className="app-loading">Loading Voxly...</div>;
  }

  if (!settings.onboardingComplete) {
    log.debug("Rendering onboarding flow");
    return (
      <OnboardingFlow
        settings={settings}
        runtime={runtime}
        onRefresh={refresh}
        onPatchSettings={patchSettings}
      />
    );
  }

  return (
    <main className="settings-shell">
      <aside className="settings-sidebar glass-panel-strong">
        <BrandMark />
        <nav className="sidebar-nav" aria-label="Voxly sections">
          {shellNav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn("sidebar-nav__item", activeSection === item.id && "is-active")}
              onClick={() => {
                log.debug("Sidebar section selected", { section: item.id });
                setActiveSection(item.id);
                document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              <ChevronRight size={15} />
            </button>
          ))}
        </nav>
      </aside>

      <section className="settings-main">
        <header className="settings-hero glass-panel-strong">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="status-dot" data-state={runtime.whisper === "ready" ? "complete" : "processing"} />
              {brand.tagline}
            </div>
            <h1>
              Speak naturally.
              <span> Voxly writes anywhere.</span>
            </h1>
            <p>
              A desktop dictation overlay with local-first transcription, cleanup controls, model management, and a browsable history.
            </p>
          </div>
          <div className="hero-actions">
            <TextButton variant="primary" onClick={() => refresh()}>
              <RefreshCw size={17} />
              Refresh
            </TextButton>
            <TextButton onClick={() => window.electronAPI.openPermissionSettings("microphone")}>
              <Mic size={17} />
              Mic Settings...
            </TextButton>
          </div>
        </header>

        <div className="content-grid">
          <section className="panel glass-panel" id="overview">
            <PanelHeader icon={Radio} title="Runtime" subtitle="Current desktop services" />
            <div className="runtime-grid">
              <RuntimePill label="Hotkey" value={runtime.hotkeyRegistered ? "Registered" : "Failed"} ok={runtime.hotkeyRegistered} />
              <RuntimePill
                label="Whisper"
                value={runtime.whisper}
                ok={runtime.whisper === "ready" || runtime.whisper === "mock" || runtime.whisper === "disabled"}
              />
              <RuntimePill label="Microphone" value={runtime.microphone} ok={runtime.microphone !== "denied"} />
              <RuntimePill label="Accessibility" value={runtime.accessibility} ok={runtime.accessibility !== "denied"} />
            </div>
            <div className="stats-grid">
              {overviewStats.map((stat) => (
                <article key={stat.label} className="stat-card glass-panel-subtle">
                  <strong>{stat.value}</strong>
                  <span>{stat.label}</span>
                  <p>{stat.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel glass-panel" id="dictation">
            <PanelHeader icon={Mic} title="Dictation" subtitle="Overlay behavior and prompt context" />
            <div className="field-grid">
              <label className="field">
                <span>Transcription</span>
                <select
                  value={settings.transcriptionMode}
                  onChange={(event) => patchSettings({ transcriptionMode: event.target.value as AppSettings["transcriptionMode"] })}
                >
                  <option value="local">Local whisper.cpp</option>
                  <option value="cloud">Groq cloud</option>
                </select>
              </label>
              <label className="field">
                <span>Mode</span>
                <select value={settings.mode} onChange={(event) => patchSettings({ mode: event.target.value as AppSettings["mode"] })}>
                  <option value="tap-to-talk">Tap to talk</option>
                  <option value="push-to-talk">Push to talk</option>
                </select>
              </label>
              <label className="field">
                <span>Language</span>
                <input value={settings.language} onChange={(event) => patchSettings({ language: event.target.value })} />
              </label>
              <label className="field field--wide">
                <span>Custom dictionary</span>
                <textarea
                  value={dictionary}
                  onChange={(event) =>
                    patchSettings({
                      customDictionary: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                    })
                  }
                />
              </label>
            </div>
          </section>

          <section className="panel glass-panel" id="models">
            <PanelHeader icon={Disc3} title="Models" subtitle="Local whisper.cpp server target" />
            <div className="model-grid">
              {modelOptions.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  className={cn("model-card glass-panel-subtle", settings.selectedModel === model.id && "is-selected")}
                  onClick={() => patchSettings({ selectedModel: model.id })}
                >
                  <span>{model.label}</span>
                  <small>{model.speed}</small>
                  <small>{model.quality}</small>
                  {settings.selectedModel === model.id && <Check size={16} />}
                </button>
              ))}
            </div>
          </section>

          <section className="panel glass-panel" id="cleanup">
            <PanelHeader icon={Sparkles} title="Cleanup" subtitle="Post-transcription processing" />
            <div className="mode-row">
              {writingModes.map((mode) => (
                <article key={mode.id} className="writing-mode glass-panel-subtle">
                  <mode.icon size={20} />
                  <strong>{mode.label}</strong>
                  <p>{mode.description}</p>
                </article>
              ))}
            </div>
            <label className="switch-row">
              <ToggleLeft size={22} />
              <span>Cleanup enabled</span>
              <input
                type="checkbox"
                checked={settings.cleanupEnabled}
                onChange={(event) => patchSettings({ cleanupEnabled: event.target.checked })}
              />
            </label>
          </section>

          <section className="panel glass-panel" id="hotkeys">
            <PanelHeader icon={KeyRound} title="Hotkey" subtitle="Global shortcut" />
            <div className="field-grid">
              <label className="field field--wide">
                <span>Accelerator</span>
                <input value={settings.hotkey} onChange={(event) => patchSettings({ hotkey: event.target.value })} />
              </label>
            </div>
          </section>

          <section className="panel glass-panel" id="permissions">
            <PanelHeader icon={ShieldAlert} title="Permissions" subtitle="OS access required for dictation" />
            <div className="permission-row">
              <TextButton onClick={() => window.electronAPI.openPermissionSettings("microphone")}>
                <Mic size={17} />
                Microphone...
              </TextButton>
              <TextButton onClick={() => window.electronAPI.openPermissionSettings("accessibility")}>
                <ShieldAlert size={17} />
                Accessibility...
              </TextButton>
            </div>
          </section>

          <section className="panel glass-panel" id="settings">
            <PanelHeader icon={Command} title="Settings" subtitle="Advanced app behavior" />
            <div className="field-grid">
              <label className="field">
                <span>Agent Name</span>
                <input value={settings.agentName} onChange={(event) => patchSettings({ agentName: event.target.value })} />
              </label>
              <div className="field">
                <span>Groq API Key</span>
                <input
                  type="password"
                  value={groqApiKeyInput}
                  placeholder={settings.groqApiKeyConfigured ? "Saved securely" : "Uses GROQ_API_KEY if empty"}
                  onChange={(event) => setGroqApiKeyInput(event.target.value)}
                />
              </div>
              <div className="field">
                <span>OpenAI API Key</span>
                <input
                  type="password"
                  value={openaiApiKeyInput}
                  placeholder={settings.openaiApiKeyConfigured ? "Saved securely" : "Uses OPENAI_API_KEY if empty"}
                  onChange={(event) => setOpenaiApiKeyInput(event.target.value)}
                />
              </div>
              <div className="field">
                <span>Credentials</span>
                <TextButton
                  onClick={() => void saveCredentials()}
                  disabled={!groqApiKeyInput.trim() && !openaiApiKeyInput.trim()}
                >
                  <Check size={17} />
                  Save API Keys
                </TextButton>
              </div>
              <label className="field">
                <span>OpenAI Base URL</span>
                <input
                  value={settings.openaiBaseUrl}
                  onChange={(event) => patchSettings({ openaiBaseUrl: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Whisper Port</span>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={settings.whisperPort}
                  onChange={(event) => patchSettings({ whisperPort: Number(event.target.value) })}
                />
              </label>
              <label className="switch-row switch-row--inset field--wide">
                <Radio size={20} />
                <span>Use mock transcription while developing</span>
                <input
                  type="checkbox"
                  checked={settings.mockTranscription}
                  onChange={(event) => patchSettings({ mockTranscription: event.target.checked })}
                />
              </label>
            </div>
          </section>

          <section className="panel glass-panel panel--wide" id="history">
            <PanelHeader icon={Copy} title="History" subtitle="Recent local transcriptions" />
            <div className="history-list">
              {history.length === 0 ? (
                <p className="empty-state">No transcriptions yet.</p>
              ) : (
                history.map((row) => (
                  <motion.article key={row.id} className="history-item glass-panel-subtle" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <time>{new Date(row.timestamp).toLocaleString()}</time>
                    <p>{row.processedText || row.originalText}</p>
                  </motion.article>
                ))
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

const onboardingSteps: Array<{
  id: string;
  title: string;
  eyebrow: string;
  summary: string;
  icon: LucideIcon;
}> = [
  {
    id: "welcome",
    eyebrow: "Setup",
    title: "Make dictation feel native.",
    summary: "Voxly stays out of the way until you press your shortcut, then pastes the transcript back into the app you were using.",
    icon: Sparkles,
  },
  {
    id: "permissions",
    eyebrow: "Access",
    title: "Grant only what dictation needs.",
    summary: "Microphone access captures speech. Accessibility lets Voxly paste the result back at the cursor.",
    icon: LockKeyhole,
  },
  {
    id: "test",
    eyebrow: "Try It",
    title: "Speak and see it typed.",
    summary: "Record a short clip — Voxly will transcribe it here so you know your microphone and model are working before you start.",
    icon: Mic,
  },
  {
    id: "finish",
    eyebrow: "Ready",
    title: "Try it from anywhere.",
    summary: "Open the overlay, press your shortcut, speak, and Voxly will paste the transcript where your cursor is focused.",
    icon: MousePointerClick,
  },
];

function OnboardingFlow({
  settings,
  runtime,
  onRefresh,
  onPatchSettings,
}: {
  settings: AppSettings;
  runtime: RuntimeStatus;
  onRefresh: () => Promise<void>;
  onPatchSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [micCheck, setMicCheck] = useState<"idle" | "checking" | "granted" | "denied">("idle");
  const step = onboardingSteps[stepIndex];
  const StepIcon = step.icon;
  const isLast = stepIndex === onboardingSteps.length - 1;
  const canGoBack = stepIndex > 0;

  async function completeOnboarding() {
    log.info("Completing onboarding");
    await onPatchSettings({ onboardingComplete: true });
  }

  async function checkMicrophone() {
    log.info("Checking microphone permission from onboarding");
    setMicCheck("checking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      stream.getTracks().forEach((track) => track.stop());
      setMicCheck("granted");
      log.info("Microphone check granted");
      await onRefresh();
    } catch (error) {
      setMicCheck("denied");
      log.warn("Microphone check denied or failed", error);
      await onRefresh();
    }
  }

  return (
    <main className="onboarding-shell">
      <section className="onboarding-window glass-panel-strong">
        <aside className="onboarding-sidebar">
          <BrandMark />
          <ol className="onboarding-steps" aria-label="Onboarding progress">
            {onboardingSteps.map((item, index) => (
              <li key={item.id} className={cn(index === stepIndex && "is-active", index < stepIndex && "is-complete")}>
                {index < stepIndex ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                <span>{item.eyebrow}</span>
              </li>
            ))}
          </ol>
          <TextButton variant="quiet" onClick={completeOnboarding}>
            Skip Setup
          </TextButton>
        </aside>

        <section className="onboarding-content" aria-labelledby="onboarding-title">
          <div className="onboarding-copy">
            <div className="onboarding-icon">
              <StepIcon size={26} />
            </div>
            <p className="onboarding-eyebrow">{step.eyebrow}</p>
            <h1 id="onboarding-title">{step.title}</h1>
            <p>{step.summary}</p>
          </div>

          <div className="onboarding-detail">
            {step.id === "welcome" && <WelcomeStep settings={settings} runtime={runtime} />}
            {step.id === "permissions" && (
              <PermissionsStep runtime={runtime} micCheck={micCheck} onCheckMicrophone={checkMicrophone} onRefresh={onRefresh} />
            )}
            {step.id === "test" && <DictationTestStep settings={settings} />}
            {step.id === "finish" && <FinishStep settings={settings} runtime={runtime} />}
          </div>

          <footer className="onboarding-actions">
            <TextButton variant="glass" disabled={!canGoBack} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}>
              <ArrowLeft size={17} />
              Back
            </TextButton>
            <TextButton
              variant="primary"
              onClick={() => {
                if (isLast) {
                  void completeOnboarding();
                  return;
                }
                log.debug("Advancing onboarding step", { from: step.id, to: onboardingSteps[stepIndex + 1]?.id });
                setStepIndex((current) => Math.min(onboardingSteps.length - 1, current + 1));
              }}
            >
              {isLast ? (
                <>
                  <Check size={17} />
                  Start Using Voxly
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight size={17} />
                </>
              )}
            </TextButton>
          </footer>
        </section>
      </section>
    </main>
  );
}

function WelcomeStep({ settings, runtime }: { settings: AppSettings; runtime: RuntimeStatus }) {
  return (
    <div className="onboarding-preview">
      <div className="shortcut-preview">
        <span>Shortcut</span>
        <strong>{settings.hotkey}</strong>
      </div>
      <div className="mini-overlay">
        <span className="status-dot" data-state={runtime.whisper === "ready" ? "complete" : "processing"} />
        <Mic size={28} />
        <p>Overlay ready</p>
      </div>
      <div className="flow-row" aria-label="Dictation flow">
        <span>Press</span>
        <ChevronRight size={15} />
        <span>Speak</span>
        <ChevronRight size={15} />
        <span>Paste</span>
      </div>
    </div>
  );
}

function PermissionsStep({
  runtime,
  micCheck,
  onCheckMicrophone,
  onRefresh,
}: {
  runtime: RuntimeStatus;
  micCheck: "idle" | "checking" | "granted" | "denied";
  onCheckMicrophone: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const microphoneStatus = micCheck === "granted" ? "granted" : runtime.microphone;
  const microphoneOk = microphoneStatus === "granted";
  const accessibilityOk = runtime.accessibility === "granted" || runtime.accessibility === "unknown";

  return (
    <div className="setup-list">
      <SetupRow
        icon={Mic}
        title="Microphone"
        detail="Required to capture speech locally in the overlay."
        status={micCheck === "checking" ? "Checking" : microphoneStatus}
        ok={microphoneOk}
      >
        <TextButton onClick={() => void onCheckMicrophone()}>
          <Mic size={17} />
          Check Microphone
        </TextButton>
        <TextButton onClick={() => window.electronAPI.openPermissionSettings("microphone")}>
          Open Settings...
        </TextButton>
      </SetupRow>
      <SetupRow
        icon={ShieldAlert}
        title="Accessibility"
        detail="Required on macOS for reliable paste-at-cursor behavior."
        status={runtime.accessibility}
        ok={accessibilityOk}
      >
        <TextButton onClick={() => window.electronAPI.openPermissionSettings("accessibility")}>
          Open Settings...
        </TextButton>
      </SetupRow>
      <TextButton variant="quiet" onClick={() => void onRefresh()}>
        <RefreshCw size={17} />
        Refresh Status
      </TextButton>
    </div>
  );
}

function DictationTestStep({ settings }: { settings: AppSettings }) {
  const [testState, setTestState] = useState<"idle" | "recording" | "processing" | "done" | "error">("idle");
  const [transcript, setTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function startRecording() {
    log.info("Dictation test: starting recording");
    setTestState("recording");
    setTranscript("");
    setErrorMessage("");
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setTestState("processing");
        try {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          const arrayBuffer = await blob.arrayBuffer();
          const result = await window.electronAPI.transcribeLocalWhisper(arrayBuffer, {
            selectedModel: settings.selectedModel,
          });
          setTranscript(result.text);
          setTestState("done");
          log.info("Dictation test complete", { chars: result.text.length });
        } catch (err) {
          log.error("Dictation test transcription failed", err);
          setErrorMessage(err instanceof Error ? err.message : "Transcription failed.");
          setTestState("error");
        }
      };
      recorder.start();
    } catch (err) {
      log.warn("Dictation test mic access failed", err);
      setErrorMessage("Could not access microphone. Check permissions.");
      setTestState("error");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  function reset() {
    setTestState("idle");
    setTranscript("");
    setErrorMessage("");
  }

  const isRecording = testState === "recording";
  const isProcessing = testState === "processing";
  const isBusy = isRecording || isProcessing;

  return (
    <div className="dictation-test">
      <div className="dictation-test__text-zone glass-panel-subtle">
        <textarea
          className="dictation-test__textarea"
          readOnly
          placeholder={
            testState === "idle"
              ? "Your transcription will appear here…"
              : testState === "recording"
                ? "Listening… speak now."
                : testState === "processing"
                  ? "Transcribing…"
                  : transcript || errorMessage
          }
          value={transcript}
          aria-label="Transcription output"
        />
        {testState === "done" && transcript && (
          <div className="dictation-test__badge dictation-test__badge--ok">
            <CheckCircle2 size={14} />
            Transcription successful
          </div>
        )}
        {testState === "error" && (
          <div className="dictation-test__badge dictation-test__badge--err">
            <ShieldAlert size={14} />
            {errorMessage}
          </div>
        )}
      </div>
      <div className="dictation-test__controls">
        {!isBusy && testState !== "done" && (
          <TextButton variant="primary" onClick={() => void startRecording()}>
            <Mic size={17} />
            Start Recording
          </TextButton>
        )}
        {isRecording && (
          <TextButton variant="primary" onClick={stopRecording}>
            <span className="status-dot" data-state="recording" style={{ marginRight: 4 }} />
            Stop Recording
          </TextButton>
        )}
        {isProcessing && (
          <TextButton variant="glass" disabled>
            <span className="status-dot" data-state="processing" style={{ marginRight: 4 }} />
            Transcribing…
          </TextButton>
        )}
        {(testState === "done" || testState === "error") && (
          <TextButton variant="glass" onClick={reset}>
            <RefreshCw size={17} />
            Try Again
          </TextButton>
        )}
      </div>
    </div>
  );
}

function PreferencesStep({
  settings,
  onPatchSettings,
}: {
  settings: AppSettings;
  onPatchSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  return (
    <div className="field-grid onboarding-fields">
      <label className="field">
        <span>Dictation Mode</span>
        <select value={settings.mode} onChange={(event) => onPatchSettings({ mode: event.target.value as AppSettings["mode"] })}>
          <option value="tap-to-talk">Tap to talk</option>
          <option value="push-to-talk">Push to talk</option>
        </select>
      </label>
      <label className="field">
        <span>Model</span>
        <select value={settings.selectedModel} onChange={(event) => onPatchSettings({ selectedModel: event.target.value })}>
          {modelOptions.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} - {model.speed}
            </option>
          ))}
        </select>
      </label>
      <label className="field field--wide">
        <span>Shortcut</span>
        <input value={settings.hotkey} onChange={(event) => onPatchSettings({ hotkey: event.target.value })} />
      </label>
      <label className="switch-row switch-row--inset field--wide">
        <Sparkles size={20} />
        <span>Clean up punctuation and casing</span>
        <input
          type="checkbox"
          checked={settings.cleanupEnabled}
          onChange={(event) => onPatchSettings({ cleanupEnabled: event.target.checked })}
        />
      </label>
    </div>
  );
}

function FinishStep({ settings, runtime }: { settings: AppSettings; runtime: RuntimeStatus }) {
  return (
    <div className="finish-card">
      <div className="finish-card__mic">
        <Mic size={36} />
      </div>
      <dl>
        <div>
          <dt>Shortcut</dt>
          <dd>{settings.hotkey}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{settings.mode === "tap-to-talk" ? "Tap to talk" : "Push to talk"}</dd>
        </div>
        <div>
          <dt>Whisper</dt>
          <dd>{runtime.whisper}</dd>
        </div>
      </dl>
      <TextButton onClick={() => window.electronAPI.openPanel()}>
        <MousePointerClick size={17} />
        Show Control Panel
      </TextButton>
    </div>
  );
}

function SetupRow({
  icon: Icon,
  title,
  detail,
  status,
  ok,
  children,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  status: string;
  ok: boolean;
  children: ReactNode;
}) {
  return (
    <article className="setup-row">
      <div className="setup-row__icon">
        <Icon size={20} />
      </div>
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
        <strong data-ok={ok}>{status}</strong>
      </div>
      <div className="setup-row__actions">{children}</div>
    </article>
  );
}

function PanelHeader({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle: string }) {
  return (
    <header className="panel-header">
      <div className="panel-header__icon">
        <Icon size={20} />
      </div>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </header>
  );
}

function RuntimePill({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="runtime-pill">
      <span>{label}</span>
      <strong data-ok={ok}>{value}</strong>
    </div>
  );
}
