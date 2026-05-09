import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BarChart2,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Globe,
  HelpCircle,
  Home,
  LockKeyhole,
  Mic,
  MousePointerClick,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  UserCircle,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AppSettings, RuntimeStatus, TranscriptionRecord } from "../../main/types";
import { BrandMark } from "../components/BrandMark";
import { TextButton } from "../components/Controls";
import { modelOptions } from "../design/source";
import { cn } from "../lib/cn";
import { createRendererLogger } from "../lib/debug-log";

const log = createRendererLogger("settings-ui");
const hotkeyModeOptions: Array<{
  value: AppSettings["mode"];
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: "tap-to-talk",
    label: "Press twice",
    description: "Press once to start, then press again to stop.",
    icon: MousePointerClick,
  },
  {
    value: "push-to-talk",
    label: "Press and hold",
    description: "Hold the hotkey while speaking, release to stop.",
    icon: Mic,
  },
];

export function SettingsApp() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [history, setHistory] = useState<TranscriptionRecord[]>([]);
  const [activeSection, setActiveSection] = useState("home");

  useEffect(() => {
    log.info("Settings app mounted");
    void refresh();
    const offRuntime = window.electronAPI.onRuntimeStatus(setRuntime);
    const offSaved = window.electronAPI.onTranscriptionSaved(() => {
      window.electronAPI.listHistory(20).then(setHistory);
    });
    return () => {
      log.info("Settings app unmounted");
      offRuntime();
      offSaved();
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


  if (!settings || !runtime) {
    return <div className="app-loading">Loading Dicta Fun...</div>;
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
    <main className="voxly-shell">
      <aside className="voxly-sidebar">
        {/* Logo */}
        <div className="voxly-sidebar__brand">
          <BrandMark />
        </div>

        {/* Primary nav */}
        <nav className="voxly-nav" aria-label="Main navigation">
          {(["home", "insights", "dictionary"] as const).map((tab) => {
            const Icon = tab === "home" ? Home : tab === "insights" ? BarChart2 : BookOpen;
            const label = tab === "home" ? "Home" : tab === "insights" ? "Insights" : "Dictionary";
            return (
              <button
                key={tab}
                type="button"
                className={cn("voxly-nav__item", activeSection === tab && "is-active")}
                onClick={() => {
                  log.debug("Tab selected", { tab });
                  setActiveSection(tab);
                }}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        {/* Spacer */}
        <div className="voxly-sidebar__spacer" />

        {/* Upgrade card */}
        <div className="voxly-upgrade-card">
          <div className="voxly-upgrade-card__header">
            <span>Free plan</span>
          </div>
          <div className="voxly-upgrade-card__usage">
            <div className="voxly-upgrade-card__bar">
              <div className="voxly-upgrade-card__bar-fill" style={{ width: "40%" }} />
            </div>
            <p>400 / 1,000 words remaining</p>
          </div>
          <button
            type="button"
            className="voxly-upgrade-btn"
            onClick={() => window.electronAPI.openWebRoute("pricing")}
          >
            <Star size={14} />
            Upgrade to Pro
          </button>
        </div>

        {/* Secondary links */}
        <nav className="voxly-secondary-nav" aria-label="Secondary navigation">
          <button
            type="button"
            className="voxly-secondary-nav__item"
            onClick={() => window.electronAPI.openWebRoute("signup")}
          >
            <Users size={16} />
            <span>Invite a friend</span>
          </button>
          <button
            type="button"
            className={cn("voxly-secondary-nav__item", activeSection === "settings" && "is-active")}
            onClick={() => setActiveSection("settings")}
          >
            <Settings size={16} />
            <span>Settings</span>
          </button>
          <button
            type="button"
            className="voxly-secondary-nav__item"
            onClick={() => window.electronAPI.openWebRoute("privacy")}
          >
            <Shield size={16} />
            <span>Privacy</span>
          </button>
          <button
            type="button"
            className="voxly-secondary-nav__item"
            onClick={() => window.electronAPI.openWebRoute("terms")}
          >
            <HelpCircle size={16} />
            <span>Terms</span>
          </button>
        </nav>

        {/* Profile */}
        <button
          type="button"
          className="voxly-profile"
          onClick={() => window.electronAPI.openWebRoute("signin")}
          aria-label="Account settings"
        >
          <div className="voxly-profile__avatar">
            <UserCircle size={22} />
          </div>
          <div className="voxly-profile__info">
            <span className="voxly-profile__name">{settings.agentName || "Your account"}</span>
            <span className="voxly-profile__plan">Free plan</span>
          </div>
        </button>
      </aside>

      <section className="voxly-main">
        {activeSection === "home" && (
          <HomePage history={history} settings={settings} />
        )}
        {activeSection === "insights" && (
          <InsightsPage history={history} />
        )}
        {activeSection === "dictionary" && (
          <DictionaryPage settings={settings} onPatchSettings={patchSettings} />
        )}
        {activeSection === "settings" && (
          <SettingsPage settings={settings} runtime={runtime} onPatchSettings={patchSettings} />
        )}
      </section>
    </main>
  );
}

// ── Hotkey display chip ───────────────────────────────────────────────────────

function HotkeyChip({ hotkey }: { hotkey: string }) {
  if (hotkey === "GLOBE" || hotkey === "Fn") {
    return (
      <div className="home-banner__shortcut-keys">
        <span className="home-banner__shortcut-press">Press</span>
        {/* FN-only key */}
        <span className="home-banner__key-chip home-banner__key-chip--fn">FN</span>
        <span className="home-banner__shortcut-or">or</span>
        {/* Combined fn + globe key matching physical macOS key layout */}
        <span className="home-banner__key-chip home-banner__key-chip--globe">
          <span className="home-banner__key-chip-fn">fn</span>
          <Globe size={12} className="home-banner__key-chip-globe" />
        </span>
      </div>
    );
  }
  return (
    <div className="home-banner__shortcut-keys">
      <span className="home-banner__shortcut-press">Press</span>
      <span className="home-banner__key">{hotkey}</span>
    </div>
  );
}

// ── Home Page ─────────────────────────────────────────────────────────────────

function HomePage({ history, settings }: { history: TranscriptionRecord[]; settings: AppSettings }) {
  return (
    <div className="voxly-page">
      {/* Hero banner */}
      <div className="home-banner">
        <div className="home-banner__copy">
          <h1>Speak naturally.<br /><span>Dicta Fun writes it clearly.</span></h1>
          <p>Press the shortcut or start a recording to turn your thoughts into polished text.</p>
        </div>
        <div className="home-banner__actions">
          <TextButton variant="primary" onClick={() => window.electronAPI.openPanel()}>
            <Mic size={17} />
            Start speaking
          </TextButton>
        </div>
        <div className="home-banner__shortcut">
          <HotkeyChip hotkey={settings.hotkey} />
        </div>
      </div>

      {/* History list */}
      <div className="voxly-section-header">
        <h2>Recent dictations</h2>
      </div>

      {history.length === 0 ? (
        <div className="voxly-empty-state">
          <Mic size={36} />
          <p>No dictations yet.</p>
          <small>Your transcription history will appear here.</small>
        </div>
      ) : (
        <div className="home-history">
          {history.map((row, i) => {
            const text = row.processedText ?? row.originalText;
            const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
            const date = new Date(row.timestamp);
            const isProcessed = row.isProcessed;
            return (
              <motion.article
                key={row.id}
                className="home-history__item"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <div className="home-history__meta">
                  <time className="home-history__time">
                    {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })},{" "}
                    {date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  </time>
                  {isProcessed && (
                    <span className="home-history__badge home-history__badge--cleaned">
                      Cleaned
                    </span>
                  )}
                  <span className="home-history__words">{wordCount} words</span>
                </div>
                <p className="home-history__preview">{text}</p>
              </motion.article>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Insights Page ─────────────────────────────────────────────────────────────

function InsightsPage({ history }: { history: TranscriptionRecord[] }) {
  const totalWords = history.reduce((sum, row) => {
    const text = row.processedText ?? row.originalText;
    return sum + text.trim().split(/\s+/).filter(Boolean).length;
  }, 0);
  const totalDictations = history.length;
  const cleanedCount = history.filter((r) => r.isProcessed).length;

  const hasData = totalDictations > 0;

  return (
    <div className="voxly-page">
      <div className="voxly-section-header">
        <h2>Your insights</h2>
        <p>A summary of how you've been using Dicta Fun.</p>
      </div>

      {!hasData ? (
        <div className="voxly-empty-state">
          <BarChart2 size={36} />
          <p>No data yet.</p>
          <small>Start dictating to see your usage stats here.</small>
        </div>
      ) : (
        <>
          <div className="insights-grid">
            <MetricCard
              label="Total dictations"
              value={String(totalDictations)}
              detail="Sessions recorded"
            />
            <MetricCard
              label="Total words"
              value={totalWords >= 1000 ? `${(totalWords / 1000).toFixed(1)}k` : String(totalWords)}
              detail="Words spoken"
            />
            <MetricCard
              label="Cleaned"
              value={String(cleanedCount)}
              detail="Dictations polished by AI"
            />
            <MetricCard
              label="Time saved"
              value={`~${Math.round(totalWords / 130)} min`}
              detail="vs. typing at 40 wpm"
            />
          </div>

          <div className="voxly-section-header" style={{ marginTop: 28 }}>
            <h2>Recent activity</h2>
          </div>
          <div className="insights-activity">
            {history.slice(0, 7).map((row) => {
              const text = row.processedText ?? row.originalText;
              const words = text.trim().split(/\s+/).filter(Boolean).length;
              const date = new Date(row.timestamp);
              return (
                <div key={row.id} className="insights-activity__row">
                  <span className="insights-activity__date">
                    {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                  <div className="insights-activity__bar-wrap">
                    <div
                      className="insights-activity__bar"
                      style={{ width: `${Math.min(100, (words / Math.max(1, totalWords / history.length)) * 50)}%` }}
                    />
                  </div>
                  <span className="insights-activity__words">{words} words</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="metric-card">
      <strong className="metric-card__value">{value}</strong>
      <span className="metric-card__label">{label}</span>
      <p className="metric-card__detail">{detail}</p>
    </article>
  );
}

// ── Dictionary Page ───────────────────────────────────────────────────────────

function DictionaryPage({
  settings,
  onPatchSettings,
}: {
  settings: AppSettings;
  onPatchSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [newWord, setNewWord] = useState("");

  const words = settings.customDictionary;
  const filtered = words.filter((w) => w.toLowerCase().includes(search.toLowerCase()));

  function addWord() {
    const trimmed = newWord.trim();
    if (!trimmed || words.includes(trimmed)) return;
    void onPatchSettings({ customDictionary: [...words, trimmed] });
    setNewWord("");
  }

  function removeWord(word: string) {
    void onPatchSettings({ customDictionary: words.filter((w) => w !== word) });
  }

  return (
    <div className="voxly-page">
      {/* Explainer banner */}
      <div className="dict-banner">
        <div className="dict-banner__icon">
          <BookOpen size={22} />
        </div>
        <div>
          <h3>Dicta Fun learns the words you use.</h3>
          <p>Add names, company terms, acronyms, and phrases so Dicta Fun writes them correctly every time.</p>
        </div>
      </div>

      {/* Controls row */}
      <div className="dict-controls">
        <div className="dict-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search words…"
            aria-label="Search dictionary"
          />
        </div>
        <div className="dict-add">
          <input
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addWord()}
            placeholder="Add a word or phrase…"
            aria-label="New word"
          />
          <TextButton variant="primary" onClick={addWord} disabled={!newWord.trim()}>
            <Plus size={16} />
            Add
          </TextButton>
        </div>
      </div>

      {/* Word list */}
      {filtered.length === 0 ? (
        <div className="voxly-empty-state">
          <BookOpen size={36} />
          <p>{words.length === 0 ? "No words yet." : "No matches."}</p>
          <small>
            {words.length === 0
              ? "Add words Dicta Fun should recognise — names, brands, or technical terms."
              : "Try a different search."}
          </small>
        </div>
      ) : (
        <div className="dict-list">
          {filtered.map((word) => (
            <div key={word} className="dict-list__row">
              <span className="dict-list__word">{word}</span>
              <button
                type="button"
                className="dict-list__delete"
                onClick={() => removeWord(word)}
                aria-label={`Remove ${word}`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Settings Page (simplified) ────────────────────────────────────────────────

function SettingsPage({
  settings,
  runtime,
  onPatchSettings,
}: {
  settings: AppSettings;
  runtime: RuntimeStatus;
  onPatchSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  return (
    <div className="voxly-page">
      <div className="voxly-section-header">
        <h2>Settings</h2>
        <p>Manage your Dicta Fun preferences.</p>
      </div>

      <div className="settings-rows">
        <div className="settings-row">
          <div>
            <h3>Your name</h3>
            <p>How Dicta Fun refers to you when cleaning up dictations.</p>
          </div>
          <input
            className="settings-input"
            value={settings.agentName}
            onChange={(e) => void onPatchSettings({ agentName: e.target.value })}
            placeholder="Your name"
          />
        </div>

        <div className="settings-row">
          <div>
            <h3>Hotkey</h3>
            <p>Global shortcut to start and stop dictation.</p>
          </div>
          <div className="settings-hotkey-display">
            <HotkeyChip hotkey={settings.hotkey} />
          </div>
        </div>

        <div className="settings-row settings-row--stacked">
          <div>
            <h3>Hotkey mode</h3>
            <p>Choose how Dicta Fun starts and stops recording from the global shortcut.</p>
          </div>
          <div className="settings-mode-options" role="radiogroup" aria-label="Hotkey mode">
            {hotkeyModeOptions.map((option) => {
              const Icon = option.icon;
              return (
                <label
                  key={option.value}
                  className={cn("settings-mode-option", settings.mode === option.value && "settings-mode-option--active")}
                >
                  <input
                    type="radio"
                    name="hotkey-mode"
                    value={option.value}
                    checked={settings.mode === option.value}
                    onChange={() => void onPatchSettings({ mode: option.value })}
                  />
                  <Icon size={17} />
                  <span>{option.label}</span>
                  <small>{option.description}</small>
                </label>
              );
            })}
          </div>
        </div>

        <div className="settings-row">
          <div>
            <h3>Text cleanup</h3>
            <p>Automatically polish punctuation and casing after you dictate.</p>
          </div>
          <label className="settings-toggle" aria-label="Toggle text cleanup">
            <input
              type="checkbox"
              checked={settings.cleanupEnabled}
              onChange={(e) => void onPatchSettings({ cleanupEnabled: e.target.checked })}
            />
            <span className="settings-toggle__track" />
          </label>
        </div>

        <div className="settings-row">
          <div>
            <h3>Permissions</h3>
            <p>Microphone{runtime.platform === "darwin" ? " and accessibility" : ""} access required for dictation.</p>
          </div>
          <div className="settings-row__actions">
            <TextButton onClick={() => window.electronAPI.openPermissionSettings("microphone")}>
              <Mic size={16} />
              Microphone…
            </TextButton>
            {runtime.platform === "darwin" && (
              <TextButton onClick={() => window.electronAPI.openPermissionSettings("accessibility")}>
                <ShieldAlert size={16} />
                Accessibility…
              </TextButton>
            )}
          </div>
        </div>
      </div>
    </div>
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
    summary: "Dicta Fun stays out of the way until you press your shortcut, then pastes the transcript back into the app you were using.",
    icon: Sparkles,
  },
  {
    id: "permissions",
    eyebrow: "Access",
    title: "Grant only what dictation needs.",
    summary: "Microphone access captures speech. On macOS, Accessibility lets Dicta Fun paste the result back at the cursor.",
    icon: LockKeyhole,
  },
  {
    id: "test",
    eyebrow: "Try It",
    title: "Speak and see it typed.",
    summary: "Record a short clip — Dicta Fun will transcribe it here so you know your microphone and model are working before you start.",
    icon: Mic,
  },
  {
    id: "finish",
    eyebrow: "Ready",
    title: "Try it from anywhere.",
    summary: "Open the overlay, press your shortcut, speak, and Dicta Fun will paste the transcript where your cursor is focused.",
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
                  Start Using Dicta Fun
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
      {runtime.platform === "darwin" && (
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
      )}
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
