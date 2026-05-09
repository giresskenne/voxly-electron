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
  CreditCard,
  Download,
  Globe,
  HelpCircle,
  Home,
  LockKeyhole,
  LogIn,
  LogOut,
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
import type {
  AppSettings,
  BillingInterval,
  DesktopUpdateStatus,
  EntitlementStatus,
  PaidPlan,
  RuntimeStatus,
  TranscriptionRecord,
} from "../../main/types";
import { BrandMark } from "../components/BrandMark";
import { TextButton } from "../components/Controls";
import { modelOptions } from "../design/source";
import { cn } from "../lib/cn";
import { createRendererLogger } from "../lib/debug-log";

const log = createRendererLogger("settings-ui");
const ENTITLEMENT_REFRESH_MS = 60_000;

const DEFAULT_ENTITLEMENT: EntitlementStatus = {
  isAuthenticated: false,
  billingPlan: "free",
  billingStatus: "unknown",
  canUseCloudTranscription: false,
  canUseCleanup: true,
  checkedAt: new Date(0).toISOString(),
  source: "default",
  reason: "not-checked",
};

function formatPlanLabel(plan: EntitlementStatus["billingPlan"]): string {
  if (plan === "pro") return "Pro plan";
  if (plan === "starter") return "Starter plan";
  return "Free plan";
}

function formatUpdateStatus(status: DesktopUpdateStatus | null, currentVersion: string): string {
  if (!status) return `Current version: ${currentVersion}.`;
  if (status.updateAvailable && status.latestVersion) {
    return `Version ${status.latestVersion} is available.`;
  }
  if (status.latestVersion) {
    return `You are up to date on version ${currentVersion}.`;
  }
  return "Update checks are not configured for this build.";
}

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
  const [entitlement, setEntitlement] = useState<EntitlementStatus>(DEFAULT_ENTITLEMENT);
  const [history, setHistory] = useState<TranscriptionRecord[]>([]);
  const [weeklyUsage, setWeeklyUsage] = useState<{ wordsUsed: number; wordsLimit: number } | null>(null);
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [activeSection, setActiveSection] = useState("home");

  useEffect(() => {
    log.info("Settings app mounted");
    void refresh();
    const offRuntime = window.electronAPI.onRuntimeStatus(setRuntime);
    const offSaved = window.electronAPI.onTranscriptionSaved(() => {
      window.electronAPI.listHistory(20).then(setHistory);
    });
    const offSettings = window.electronAPI.onSettingsUpdated((nextSettings) => {
      setSettings(nextSettings);
    });
    const offDeepLink = window.electronAPI.onDeepLink((url) => {
      log.info("Received deep link", { url });
      void handleDeepLink(url);
    });
    return () => {
      log.info("Settings app unmounted");
      offRuntime();
      offSaved();
      offSettings();
      offDeepLink();
    };
  }, []);

  useEffect(() => {
    const syncOnResume = () => {
      void syncEntitlement(true);
    };
    const onVisibility = () => {
      if (!document.hidden) {
        void syncEntitlement(true);
      }
    };
    window.addEventListener("focus", syncOnResume);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => {
      void syncEntitlement(true);
    }, ENTITLEMENT_REFRESH_MS);

    return () => {
      window.removeEventListener("focus", syncOnResume);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, []);

  async function syncEntitlement(force = false) {
    const synced = await window.electronAPI.syncEntitlement(force);
    setEntitlement(synced.entitlements);
    setSettings(synced.settings);
  }

  async function refresh() {
    log.debug("Refreshing settings screen data");
    const [synced, nextRuntime, nextHistory, nextUsage, nextUpdateStatus] = await Promise.all([
      window.electronAPI.syncEntitlement(),
      window.electronAPI.getRuntimeStatus(),
      window.electronAPI.listHistory(20),
      window.electronAPI.getWordCountThisWeek(),
      window.electronAPI.checkForUpdates(),
    ]);
    log.info("Settings screen data refreshed", {
      runtime: nextRuntime,
      historyCount: nextHistory.length,
      onboardingComplete: synced.settings.onboardingComplete,
      billingPlan: synced.entitlements.billingPlan,
      billingStatus: synced.entitlements.billingStatus,
      updateAvailable: nextUpdateStatus.updateAvailable,
    });
    setSettings(synced.settings);
    setRuntime(nextRuntime);
    setHistory(nextHistory);
    setEntitlement(synced.entitlements);
    setWeeklyUsage(nextUsage);
    setUpdateStatus(nextUpdateStatus);
  }

  async function patchSettings(patch: Partial<AppSettings>) {
    log.debug("Patching settings", patch);
    const next = await window.electronAPI.updateSettings(patch);
    setSettings(next);
    setRuntime(await window.electronAPI.getRuntimeStatus());
    log.info("Settings patch applied", patch);
  }

  async function handleDeepLink(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      log.warn("Invalid deep link", { url });
      return;
    }

    const isAuthCallback = parsed.protocol === "dictafun:" && parsed.hostname === "auth";
    if (!isAuthCallback) return;

    const token = parsed.searchParams.get("token") ?? "";
    if (!token.trim()) {
      log.warn("Auth callback missing token");
      return;
    }

    log.info("Applying auth callback token");
    await window.electronAPI.setSessionToken(token);
    await syncEntitlement(true);
  }

  async function saveSessionToken(token: string) {
    await window.electronAPI.setSessionToken(token);
    await syncEntitlement(true);
  }

  async function clearSession() {
    await window.electronAPI.clearSessionToken();
    await syncEntitlement(true);
  }

  async function startCheckout(plan: PaidPlan, interval: BillingInterval) {
    const session = await window.electronAPI.startCheckout({ plan, interval });
    await syncEntitlement(true);
    return session;
  }

  async function checkForUpdates(force = true) {
    setUpdateBusy(true);
    try {
      setUpdateStatus(await window.electronAPI.checkForUpdates(force));
    } finally {
      setUpdateBusy(false);
    }
  }

  async function openUpdateDownload() {
    await window.electronAPI.openUpdateDownload();
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
            <span>{formatPlanLabel(entitlement.billingPlan)}</span>
          </div>
          <div className="voxly-upgrade-card__usage">
            <div className="voxly-upgrade-card__bar">
              <div
                className="voxly-upgrade-card__bar-fill"
                style={{
                  width: weeklyUsage
                    ? `${Math.min(100, (weeklyUsage.wordsUsed / weeklyUsage.wordsLimit) * 100)}%`
                    : "0%",
                }}
              />
            </div>
            <p>
              {weeklyUsage && weeklyUsage.wordsUsed > 0
                ? `${weeklyUsage.wordsUsed.toLocaleString()} / ${weeklyUsage.wordsLimit.toLocaleString()} words this week`
                : entitlement.isAuthenticated
                  ? `Status: ${entitlement.billingStatus.replace("_", " ")}`
                  : "Sign in to unlock paid features"}
            </p>
          </div>
          <button
            type="button"
            className="voxly-upgrade-btn"
            onClick={() => window.electronAPI.openWebRoute("pricing")}
          >
            <Star size={14} />
            {entitlement.billingPlan === "pro" ? "Manage plan" : "Upgrade to Pro"}
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
            <span className="voxly-profile__plan">{formatPlanLabel(entitlement.billingPlan)}</span>
            <span className="voxly-profile__version">Version {runtime.appVersion}</span>
          </div>
        </button>
      </aside>

      <section className="voxly-main">
        <UpdateBanner
          status={updateStatus}
          busy={updateBusy}
          onCheck={() => void checkForUpdates(true)}
          onDownload={() => void openUpdateDownload()}
        />
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
          <SettingsPage
            settings={settings}
            runtime={runtime}
            entitlement={entitlement}
            updateStatus={updateStatus}
            updateBusy={updateBusy}
            onPatchSettings={patchSettings}
            onSaveSessionToken={saveSessionToken}
            onClearSession={clearSession}
            onStartCheckout={startCheckout}
            onRefreshEntitlement={() => syncEntitlement(true)}
            onCheckUpdates={() => checkForUpdates(true)}
            onOpenUpdate={openUpdateDownload}
          />
        )}
      </section>
    </main>
  );
}

function UpdateBanner({
  status,
  busy,
  onCheck,
  onDownload,
}: {
  status: DesktopUpdateStatus | null;
  busy: boolean;
  onCheck: () => void;
  onDownload: () => void;
}) {
  if (!status?.updateAvailable) return null;

  return (
    <div className="app-update-banner glass-panel-subtle" role="status">
      <div className="app-update-banner__icon">
        <Download size={18} />
      </div>
      <div className="app-update-banner__copy">
        <strong>Dicta Fun {status.latestVersion} is ready</strong>
        <p>You are running {status.currentVersion}.</p>
      </div>
      <div className="app-update-banner__actions">
        <TextButton variant="quiet" disabled={busy} onClick={onCheck}>
          <RefreshCw size={15} />
          {busy ? "Checking..." : "Check"}
        </TextButton>
        {status.downloadUrl && (
          <TextButton variant="primary" onClick={onDownload}>
            <Download size={15} />
            Download Update
          </TextButton>
        )}
      </div>
    </div>
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
  entitlement,
  updateStatus,
  updateBusy,
  onPatchSettings,
  onSaveSessionToken,
  onClearSession,
  onStartCheckout,
  onRefreshEntitlement,
  onCheckUpdates,
  onOpenUpdate,
}: {
  settings: AppSettings;
  runtime: RuntimeStatus;
  entitlement: EntitlementStatus;
  updateStatus: DesktopUpdateStatus | null;
  updateBusy: boolean;
  onPatchSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onSaveSessionToken: (token: string) => Promise<void>;
  onClearSession: () => Promise<void>;
  onStartCheckout: (plan: PaidPlan, interval: BillingInterval) => Promise<unknown>;
  onRefreshEntitlement: () => Promise<void>;
  onCheckUpdates: () => Promise<void>;
  onOpenUpdate: () => Promise<void>;
}) {
  const [sessionToken, setSessionToken] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<PaidPlan>("starter");
  const [selectedInterval, setSelectedInterval] = useState<BillingInterval>("monthly");
  const [accountBusy, setAccountBusy] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");

  async function handleSaveSessionToken() {
    if (!sessionToken.trim()) {
      setAccountMessage("Paste an access token first.");
      return;
    }

    setAccountBusy(true);
    setAccountMessage("");
    try {
      await onSaveSessionToken(sessionToken);
      setSessionToken("");
      setAccountMessage("Account connected. Plan status updated.");
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "Failed to save token.");
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleSignOut() {
    setAccountBusy(true);
    setAccountMessage("");
    try {
      await onClearSession();
      setAccountMessage("Signed out from this desktop app.");
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "Failed to sign out.");
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleRefreshEntitlement() {
    setAccountBusy(true);
    setAccountMessage("");
    try {
      await onRefreshEntitlement();
      setAccountMessage("Plan status refreshed.");
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleStartCheckout() {
    setCheckoutBusy(true);
    setAccountMessage("");
    try {
      await onStartCheckout(selectedPlan, selectedInterval);
      setAccountMessage("Checkout opened in your browser. Return here after payment to refresh.");
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "Unable to start checkout.");
    } finally {
      setCheckoutBusy(false);
    }
  }

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

        <div className="settings-row">
          <div>
            <h3>App version</h3>
            <p>{formatUpdateStatus(updateStatus, runtime.appVersion)}</p>
          </div>
          <div className="settings-row__actions">
            <span className="settings-version-pill">v{runtime.appVersion}</span>
            <TextButton disabled={updateBusy} onClick={() => void onCheckUpdates()}>
              <RefreshCw size={16} />
              {updateBusy ? "Checking..." : "Check Updates"}
            </TextButton>
            {updateStatus?.updateAvailable && updateStatus.downloadUrl && (
              <TextButton variant="primary" onClick={() => void onOpenUpdate()}>
                <Download size={16} />
                Download Update
              </TextButton>
            )}
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
              disabled={!entitlement.canUseCleanup}
              onChange={(e) => void onPatchSettings({ cleanupEnabled: e.target.checked })}
            />
            <span className="settings-toggle__track" />
          </label>
        </div>

        <div className="settings-row settings-row--stacked">
          <div>
            <h3>Account & billing</h3>
            <p>
              Manage subscription directly in the desktop app. Current plan: {formatPlanLabel(entitlement.billingPlan)}
              {` (${entitlement.billingStatus.replace("_", " ")}).`}
            </p>
          </div>
          <div className="settings-row__actions">
            <input
              className="settings-input settings-input--mono"
              value={sessionToken}
              onChange={(e) => setSessionToken(e.target.value)}
              placeholder="Paste Supabase access token"
              aria-label="Session access token"
            />
            <TextButton variant="primary" disabled={accountBusy || !sessionToken.trim()} onClick={() => void handleSaveSessionToken()}>
              <LogIn size={16} />
              Connect Account
            </TextButton>
            <TextButton disabled={accountBusy} onClick={() => void handleRefreshEntitlement()}>
              <RefreshCw size={16} />
              Refresh Plan
            </TextButton>
            <TextButton variant="quiet" disabled={accountBusy || !entitlement.isAuthenticated} onClick={() => void handleSignOut()}>
              <LogOut size={16} />
              Sign Out
            </TextButton>
          </div>
          <div className="settings-row__actions">
            <select
              className="settings-input"
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value as PaidPlan)}
              aria-label="Checkout plan"
            >
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
            </select>
            <select
              className="settings-input"
              value={selectedInterval}
              onChange={(e) => setSelectedInterval(e.target.value as BillingInterval)}
              aria-label="Checkout interval"
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <TextButton
              variant="primary"
              disabled={checkoutBusy || !entitlement.isAuthenticated}
              onClick={() => void handleStartCheckout()}
            >
              <CreditCard size={16} />
              {checkoutBusy ? "Opening Checkout..." : "Start Checkout"}
            </TextButton>
          </div>
          {!!accountMessage && <p>{accountMessage}</p>}
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
    icon: MousePointerClick,
  },
  {
    id: "permissions",
    eyebrow: "Access",
    title: "Grant only what dictation needs.",
    summary: "Microphone access captures speech. On macOS, Accessibility lets Dicta Fun paste the result back at the cursor.",
    icon: LockKeyhole,
  },
  {
    id: "hotkey",
    eyebrow: "Shortcut",
    title: "Learn your shortcut.",
    summary: "Try both modes — tap once to start and again to stop, or hold while speaking. Then choose the one that fits you best.",
    icon: Zap,
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
    icon: Check,
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
            {step.id === "hotkey" && (
              <HotkeyTeachStep settings={settings} onPatchSettings={onPatchSettings} />
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
        <span className="shortcut-preview__label">Shortcut</span>
        <HotkeyChip hotkey={settings.hotkey} />
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

function HotkeyTeachStep({
  settings,
  onPatchSettings,
}: {
  settings: AppSettings;
  onPatchSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const [tapDone, setTapDone] = useState(false);
  const [holdDone, setHoldDone] = useState(false);
  const [tapState, setTapState] = useState<"idle" | "recording">("idle");
  const [holdState, setHoldState] = useState<"idle" | "recording">("idle");

  function handleTapClick() {
    if (tapState === "idle") {
      setTapState("recording");
    } else {
      setTapState("idle");
      setTapDone(true);
    }
  }

  function handleHoldMouseDown() {
    setHoldState("recording");
  }

  function handleHoldMouseUp() {
    setHoldState("idle");
    setHoldDone(true);
  }

  const bothDone = tapDone && holdDone;

  return (
    <div className="hotkey-teach">
      {/* Tap-to-talk trial */}
      <div className={cn("hotkey-teach__trial", tapDone && "hotkey-teach__trial--done")}>
        <div className="hotkey-teach__trial-label">
          <MousePointerClick size={16} />
          <span><strong>Tap to talk</strong> — press once to start, press again to stop</span>
          {tapDone && <CheckCircle2 size={16} className="hotkey-teach__check" />}
        </div>
        <button
          type="button"
          className={cn("hotkey-teach__demo-btn", tapState === "recording" && "hotkey-teach__demo-btn--active")}
          onClick={handleTapClick}
          disabled={tapDone}
        >
          {tapState === "idle"
            ? tapDone ? "Done ✓" : "Press to start"
            : "Press again to stop"}
        </button>
      </div>

      {/* Push-to-talk trial */}
      <div className={cn("hotkey-teach__trial", holdDone && "hotkey-teach__trial--done")}>
        <div className="hotkey-teach__trial-label">
          <Mic size={16} />
          <span><strong>Push to talk</strong> — hold while speaking, release to stop</span>
          {holdDone && <CheckCircle2 size={16} className="hotkey-teach__check" />}
        </div>
        <button
          type="button"
          className={cn("hotkey-teach__demo-btn", holdState === "recording" && "hotkey-teach__demo-btn--active")}
          onMouseDown={handleHoldMouseDown}
          onMouseUp={handleHoldMouseUp}
          onMouseLeave={holdState === "recording" ? handleHoldMouseUp : undefined}
          disabled={holdDone}
        >
          {holdDone ? "Done ✓" : "Hold to talk"}
        </button>
      </div>

      {/* Mode picker — shown once both are tried */}
      {bothDone && (
        <div className="hotkey-teach__pick">
          <p className="hotkey-teach__pick-label">Which felt better?</p>
          <div className="settings-mode-options" role="radiogroup" aria-label="Preferred hotkey mode">
            {hotkeyModeOptions.map((option) => {
              const Icon = option.icon;
              return (
                <label
                  key={option.value}
                  className={cn("settings-mode-option", settings.mode === option.value && "settings-mode-option--active")}
                >
                  <input
                    type="radio"
                    name="hotkey-mode-onboarding"
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
          <p className="hotkey-teach__hint">You can change this anytime in Settings.</p>
        </div>
      )}
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

function whisperStatusLabel(status: RuntimeStatus["whisper"]): string {
  switch (status) {
    case "ready": return "Ready";
    case "starting": return "Starting up…";
    case "mock": return "Demo mode";
    case "missing": return "Model not downloaded — dictation will use cloud";
    case "error": return "Error loading model";
    case "disabled": return "Disabled";
    default: return String(status);
  }
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
          <dd><HotkeyChip hotkey={settings.hotkey} /></dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{settings.mode === "tap-to-talk" ? "Tap to talk" : "Push to talk"}</dd>
        </div>
        <div>
          <dt>AI Model</dt>
          <dd>{whisperStatusLabel(runtime.whisper)}</dd>
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
