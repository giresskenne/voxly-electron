import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BarChart2,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardPaste,
  Copy,
  CreditCard,
  Download,
  Gift,
  Globe,
  Hand,
  Home,
  HelpCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  Keyboard,
  MessageSquare,
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
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  AppSettings,
  BillingInterval,
  DesktopUpdateStatus,
  EntitlementStatus,
  PaidPlan,
  ReferralInvite,
  ReferralStatus,
  RuntimeStatus,
  TranscriptionRecord,
  WeeklyUsageStatus,
} from "../../main/types";
import { BrandMark } from "../components/BrandMark";
import { TextButton } from "../components/Controls";
import heroBg from "../assets/hero-bg-gradient.jpg";
import { modelOptions } from "../design/source";
import { cn } from "../lib/cn";
import { createRendererLogger } from "../lib/debug-log";
import { I18nProvider, displayLanguageOptions, htmlLang, translate, useT } from "../lib/i18n";
import { capture, identifyUserEmail, resetAnalyticsIdentity } from "../services/analytics";

const log = createRendererLogger("settings-ui");
const ENTITLEMENT_REFRESH_MS = 60_000;
const SHORTCUT_TEST_AUDIO_BITS_PER_SECOND = 128_000;
const canSkipOnboarding = import.meta.env.DEV;

function captureUpgradeClicked(properties: Record<string, unknown>): void {
  // Privacy: never send user text, emails, URLs, tokens, or secrets to analytics.
  // Upgrade analytics may include only safe CTA, plan, interval, and app metadata.
  capture("upgrade_clicked", properties);
}

const DEFAULT_ENTITLEMENT: EntitlementStatus = {
  isAuthenticated: false,
  accountEmail: null,
  billingPlan: "free",
  billingStatus: "unknown",
  canUseCloudTranscription: false,
  canUseCleanup: true,
  checkedAt: new Date(0).toISOString(),
  source: "default",
  reason: "not-checked",
};

function formatPlanLabel(plan: EntitlementStatus["billingPlan"], t: ReturnType<typeof useT>): string {
  if (plan === "pro") return t("plan.pro");
  if (plan === "starter") return t("plan.starter");
  return t("plan.free");
}

function formatUpdateStatus(status: DesktopUpdateStatus | null, currentVersion: string, t: ReturnType<typeof useT>): string {
  if (!status) return t("settings.currentVersion", { version: currentVersion });
  if (status.updateAvailable && status.latestVersion) {
    return t("settings.versionAvailable", { version: status.latestVersion });
  }
  if (status.latestVersion) {
    return t("settings.upToDate", { version: currentVersion });
  }
  return t("settings.updateUnavailable");
}

function usagePercent(usage: WeeklyUsageStatus | null): number {
  if (!usage?.wordsLimit) return 0;
  return Math.min(100, Math.round((usage.wordsUsed / usage.wordsLimit) * 100));
}

// ── Help & Feedback Modal ─────────────────────────────────────────────────────

type HelpFeedbackTab = "feedback" | "help";

function HelpFeedbackModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<HelpFeedbackTab>("help");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSend() {
    const trimmed = message.trim();
    if (!trimmed) return;
    setBusy(true);
    setStatus(null);
    try {
      await window.electronAPI.sendFeedback(trimmed);
      setStatus({ ok: true, text: "Thanks for your feedback!" });
      setMessage("");
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : "Failed to send. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hf-modal__backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Help & Feedback">
      <div className="hf-modal__panel glass-panel-strong" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="hf-modal__close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        <h2 className="hf-modal__title">Help &amp; Feedback</h2>

        {/* Tabs */}
        <div className="hf-modal__tabs" role="tablist">
          {([
            ["help", "Help"] as const,
            ["feedback", "Feedback"] as const,
          ]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={cn("hf-modal__tab", tab === id && "is-active")}
              onClick={() => { setTab(id); setStatus(null); }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Tab: Help ── */}
        {tab === "help" && (
          <div className="hf-modal__tab-panel">
            <ul className="hf-modal__help-list">
              <li>
                <span className="hf-modal__help-icon">🎙️</span>
                <div>
                  <strong>Start dictating</strong>
                  <p>Press your hotkey once to start recording, then press it again (or release, in push-to-talk mode) to transcribe.</p>
                </div>
              </li>
              <li>
                <span className="hf-modal__help-icon">⌨️</span>
                <div>
                  <strong>Change your hotkey</strong>
                  <p>Go to Settings and click on the hotkey field to record a new shortcut.</p>
                </div>
              </li>
              <li>
                <span className="hf-modal__help-icon">🔒</span>
                <div>
                  <strong>Microphone or accessibility access</strong>
                  <p>Voxly needs microphone permission to record and accessibility permission to auto-paste text.</p>
                </div>
              </li>
              <li>
                <span className="hf-modal__help-icon">📖</span>
                <div>
                  <strong>Custom dictionary</strong>
                  <p>Add names or technical terms in Settings → Dictionary to improve accuracy.</p>
                </div>
              </li>
            </ul>
            <button
              type="button"
              className="hf-modal__help-link"
              onClick={() => window.electronAPI.openWebRoute("help")}
            >
              View full help docs →
            </button>
          </div>
        )}

        {/* ── Tab: Feedback ── */}
        {tab === "feedback" && (
          <div className="hf-modal__tab-panel">
            <p className="hf-modal__feedback-desc">
              Have a suggestion, found a bug, or just want to say hi? We read every message.
            </p>
            <textarea
              className="hf-modal__textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's on your mind?"
              rows={5}
              aria-label="Feedback message"
            />
            {status && (
              <p className={cn("hf-modal__msg", status.ok && "is-ok")}>{status.text}</p>
            )}
            <div className="hf-modal__actions">
              <button
                type="button"
                className="hf-modal__send-btn"
                onClick={() => void handleSend()}
                disabled={!message.trim() || busy}
              >
                {busy ? "Sending…" : "Send feedback"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Referral Modal ────────────────────────────────────────────────────────────

type ReferralTab = "refer" | "past-invites" | "apply";

function ReferralModal({ onClose, isAuthenticated }: { onClose: () => void; isAuthenticated: boolean }) {
  const [tab, setTab] = useState<ReferralTab>("refer");
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");
  const [applyCode, setApplyCode] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState("");

  const referralUrl = status?.referralUrl ?? null;

  function loadStatus() {
    setLoading(true);
    setLoadError(null);
    void window.electronAPI.getReferralStatus()
      .then((s) => setStatus(s))
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : "Could not load your referral link.");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (isAuthenticated) {
      loadStatus();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated]);

  function handleCopy() {
    if (!referralUrl) return;
    void navigator.clipboard.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSendInvite() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setInviteBusy(true);
    setInviteMsg("");
    try {
      await window.electronAPI.sendReferralInvite(trimmed);
      setInviteMsg("Invite sent!");
      setEmail("");
      loadStatus(); // refresh past-invites count
    } catch (err) {
      setInviteMsg(err instanceof Error ? err.message : "Failed to send invite.");
    } finally {
      setInviteBusy(false);
      setTimeout(() => setInviteMsg(""), 3500);
    }
  }

  async function handleApplyCode() {
    const trimmed = applyCode.trim();
    if (!trimmed) return;
    setApplyBusy(true);
    setApplyMsg("");
    try {
      await window.electronAPI.applyReferralCode(trimmed);
      setApplyMsg("Code applied! Your free month will be credited to your next payment.");
      setApplyCode("");
    } catch (err) {
      setApplyMsg(err instanceof Error ? err.message : "Invalid or already-used code.");
    } finally {
      setApplyBusy(false);
    }
  }

  const inviteCount = status?.invites.length ?? 0;

  return (
    <div className="referral-modal__backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Get a free month">
      <div className="referral-modal__panel glass-panel-strong" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="referral-modal__close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        {/* Header */}
        <h2 className="referral-modal__title">Refer and earn rewards</h2>

        {/* ── Sign-in gate ── */}
        {!isAuthenticated ? (
          <div className="referral-modal__gate">
            <div className="referral-modal__gate-icon">🔒</div>
            <p className="referral-modal__gate-msg">
              Sign in to get your personal invite link and earn a <strong>free month</strong> for every friend you refer.
            </p>
            <button
              type="button"
              className="referral-modal__send-btn"
              onClick={() => { onClose(); void window.electronAPI.openWebRoute("signin"); }}
            >
              Sign in / Sign up
            </button>
          </div>
        ) : (
        <>
        <p className="referral-modal__subtitle">
          Give a friend 1 month of Pro and get <strong>1 free month</strong> for each person you refer.
        </p>

        {/* Tabs */}
        <div className="referral-modal__tabs" role="tablist">
          {([
            ["refer", "Refer"],
            ["past-invites", `Past invites (${inviteCount})`],
            ["apply", "Apply referral"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={cn("referral-modal__tab", tab === id && "is-active")}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Tab: Refer ── */}
        {tab === "refer" && (
          <div className="referral-modal__tab-panel">
            {/* How it works */}
            <p className="referral-modal__section-label">How it works</p>
            <ul className="referral-modal__steps">
              <li><span>📣</span><span>Share your invite link</span></li>
              <li><span>👑</span><span>They sign up and get a <strong>free month of Pro!</strong></span></li>
              <li><span>🎉</span><span>You get a <strong>free month</strong> when they dictate 2,000 words.</span></li>
            </ul>

            {/* Your invite link */}
            <div className="referral-modal__section-label-row">
              <span className="referral-modal__section-label">Your invite link</span>
              <button
                type="button"
                className="referral-modal__refresh"
                onClick={loadStatus}
                aria-label="Refresh link"
              >
                <RefreshCw size={13} />
              </button>
            </div>
            <div className="referral-modal__link-row">
              <input
                className="referral-modal__link-input"
                readOnly
                value={loading ? "Loading your link…" : loadError ? "Could not load link" : (referralUrl ?? "")}
                onFocus={(e) => !loading && !loadError && e.target.select()}
                aria-label="Your referral link"
              />
              <button
                type="button"
                className={cn("referral-modal__copy-btn", copied && "is-copied")}
                onClick={handleCopy}
                disabled={loading || !!loadError || !referralUrl}
                aria-label="Copy referral link"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? "Copied!" : "Copy"}</span>
              </button>
            </div>

            {/* Send invites */}
            <p className="referral-modal__section-label" style={{ marginTop: 16 }}>Send invites</p>
            <div className="referral-modal__email-row">
              <input
                type="email"
                className="referral-modal__email-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleSendInvite()}
                placeholder="email@example.com"
                aria-label="Friend's email address"
              />
              <button
                type="button"
                className="referral-modal__send-btn"
                onClick={() => void handleSendInvite()}
                disabled={!email.trim() || inviteBusy}
              >
                {inviteBusy ? "Sending…" : "Send"}
              </button>
            </div>
            {loadError && <p className="referral-modal__msg" style={{ marginTop: 8 }}>{loadError}</p>}
            {inviteMsg && <p className={cn("referral-modal__msg", inviteMsg.startsWith("Invite") && "is-ok")}>{inviteMsg}</p>}

            {/* Footer note */}
            <p className="referral-modal__footer">
              Rewards auto-applied to your next subscription payment.
            </p>
          </div>
        )}

        {/* ── Tab: Past invites ── */}
        {tab === "past-invites" && (
          <div className="referral-modal__tab-panel">
            {loading && <p className="referral-modal__loading">Loading…</p>}
            {!loading && inviteCount === 0 && (
              <div className="referral-modal__empty">
                <Gift size={32} />
                <p>No invites sent yet.</p>
                <small>Send your first invite from the Refer tab.</small>
              </div>
            )}
            {!loading && inviteCount > 0 && (
              <ul className="referral-modal__invite-list">
                {(status as ReferralStatus).invites.map((invite: ReferralInvite) => (
                  <li key={invite.email} className="referral-modal__invite-row">
                    <span className="referral-modal__invite-email">{invite.email}</span>
                    <span className={cn("referral-modal__invite-status", `is-${invite.status}`)}>
                      {invite.status === "rewarded" ? "Rewarded" : invite.status === "signed_up" ? "Signed up" : "Pending"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── Tab: Apply referral ── */}
        {tab === "apply" && (
          <div className="referral-modal__tab-panel">
            <p className="referral-modal__apply-desc">
              Have a referral code from a friend? Enter it below to get your first month of Pro free.
            </p>
            <div className="referral-modal__email-row">
              <input
                className="referral-modal__email-input"
                value={applyCode}
                onChange={(e) => setApplyCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleApplyCode()}
                placeholder="Enter referral code"
                aria-label="Referral code"
              />
              <button
                type="button"
                className="referral-modal__send-btn"
                onClick={() => void handleApplyCode()}
                disabled={!applyCode.trim() || applyBusy}
              >
                {applyBusy ? "Applying…" : "Apply"}
              </button>
            </div>
            {applyMsg && <p className={cn("referral-modal__msg", applyMsg.startsWith("Code") && "is-ok")}>{applyMsg}</p>}
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

function formatUsageLine(
  usage: WeeklyUsageStatus | null,
  entitlement: EntitlementStatus,
  t: ReturnType<typeof useT>,
): string {
  if (!usage) return t("usage.loading");
  if (!usage.isLimited) return t("usage.unlimited");
  if (usage.wordsLimit === null) return t("usage.unavailable");
  if (usage.wordsUsed > 0) {
    return `${usage.wordsUsed.toLocaleString()} / ${usage.wordsLimit.toLocaleString()} free words this week`;
  }
  return entitlement.isAuthenticated ? t("usage.freeWordsWeek") : t("usage.signInOrUpgrade");
}

function hotkeyModeOptions(t: ReturnType<typeof useT>): Array<{
  value: AppSettings["mode"];
  label: string;
  description: string;
  icon: LucideIcon;
}> {
  return [
    {
      value: "push-to-talk",
      label: t("settings.pressHold"),
      description: t("settings.pressHoldDetail"),
      icon: Mic,
    },
    {
      value: "tap-to-talk",
      label: t("settings.pressTwice"),
      description: t("settings.pressTwiceDetail"),
      icon: MousePointerClick,
    },
  ];
}

function pasteModeOptions(language: AppSettings["displayLanguage"] = "en"): Array<{
  value: AppSettings["cleanupMode"];
  label: string;
  description: string;
  icon: LucideIcon;
}> {
  if (language === "fr-FR") {
    return [
      {
        value: "fast",
        label: "Rapide",
        description: "Colle tout de suite, puis met le texte à jour quand la correction est terminée.",
        icon: Copy,
      },
      {
        value: "accurate",
        label: "Propre",
        description: "Attend la correction, puis colle une seule version soignée.",
        icon: Sparkles,
      },
    ];
  }

  return [
    {
      value: "fast",
      label: "Fast",
      description: "Paste immediately, then update the text after cleanup finishes.",
      icon: Copy,
    },
    {
      value: "accurate",
      label: "Clean",
      description: "Wait for cleanup first, then paste the polished text once.",
      icon: Sparkles,
    },
  ];
}

export function SettingsApp() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [entitlement, setEntitlement] = useState<EntitlementStatus>(DEFAULT_ENTITLEMENT);
  const [history, setHistory] = useState<TranscriptionRecord[]>([]);
  const [weeklyUsage, setWeeklyUsage] = useState<WeeklyUsageStatus | null>(null);
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [activeSection, setActiveSection] = useState("home");
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<"general" | "account" | "privacy">("general");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [helpFeedbackOpen, setHelpFeedbackOpen] = useState(false);
  const lastEntitlementSyncRef = useRef<number>(0);

  useEffect(() => {
    log.info("Settings app mounted");
    void refresh();
    const offRuntime = window.electronAPI.onRuntimeStatus(setRuntime);
    const offSaved = window.electronAPI.onTranscriptionSaved(() => {
      window.electronAPI.listHistory(20).then(setHistory);
      window.electronAPI.getWordCountThisWeek().then(setWeeklyUsage);
    });
    const offSettings = window.electronAPI.onSettingsUpdated((nextSettings) => {
      setSettings(nextSettings);
    });
    const offDeepLink = window.electronAPI.onDeepLink((url) => {
      log.info("Received deep link", { url });
      void handleDeepLink(url);
    });
    const offSessionExpired = window.electronAPI.onSessionExpired(() => {
      log.warn("Session expired — user must sign in again");
      void syncEntitlement(true);
      // Navigate to the account/sign-in tab so the sign-in button is visible
      setActiveSection("settings");
      setSettingsDefaultTab("account");
    });
    const offNavigateTab = window.electronAPI.onSettingsNavigateTab((tab) => {
      log.debug("Navigate-tab event received", { tab });
      setActiveSection("settings");
      if (tab === "account" || tab === "general" || tab === "privacy") {
        setSettingsDefaultTab(tab);
      }
    });
    return () => {
      log.info("Settings app unmounted");
      offRuntime();
      offSaved();
      offSettings();
      offDeepLink();
      offSessionExpired();
      offNavigateTab();
    };
  }, []);

  useEffect(() => {
    const SYNC_DEBOUNCE_MS = 5_000;
    const syncOnResume = () => {
      const now = Date.now();
      if (now - lastEntitlementSyncRef.current < SYNC_DEBOUNCE_MS) return;
      lastEntitlementSyncRef.current = now;
      void syncEntitlement(true);
    };
    const onVisibility = () => {
      if (!document.hidden) syncOnResume();
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

  useEffect(() => {
    document.documentElement.lang = htmlLang(settings?.displayLanguage ?? "en");
  }, [settings?.displayLanguage]);

  useEffect(() => {
    if (entitlement.isAuthenticated && entitlement.accountEmail) {
      identifyUserEmail(entitlement.accountEmail);
    }
  }, [entitlement.accountEmail, entitlement.isAuthenticated]);

  async function syncEntitlement(force = false) {
    const synced = await window.electronAPI.syncEntitlement(force);
    setEntitlement(synced.entitlements);
    setSettings(synced.settings);
    setWeeklyUsage(await window.electronAPI.getWordCountThisWeek());
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

    const refreshToken = parsed.searchParams.get("refresh_token") ?? undefined;
    log.info("Applying auth callback token", { hasRefreshToken: Boolean(refreshToken) });
    await window.electronAPI.setSessionToken(token, refreshToken);
    await syncEntitlement(true);
  }

  async function saveSessionToken(token: string) {
    await window.electronAPI.setSessionToken(token);
    await syncEntitlement(true);
  }

  async function clearSession() {
    await window.electronAPI.clearSessionToken();
    resetAnalyticsIdentity();
    await syncEntitlement(true);
  }

  async function startCheckout(plan: PaidPlan, interval: BillingInterval) {
    // Privacy: checkout analytics includes only safe plan/interval metadata, never checkout URLs or user identity.
    capture("checkout_started", { plan, interval });
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
    return <div className="app-loading">{translate("en", "app.loading")}</div>;
  }

  if (!settings.onboardingComplete) {
    log.debug("Rendering onboarding flow");
    return (
      <I18nProvider language={settings.displayLanguage}>
        <OnboardingFlow
          settings={settings}
          runtime={runtime}
          onRefresh={refresh}
          onPatchSettings={patchSettings}
        />
      </I18nProvider>
    );
  }

  return (
    <I18nProvider language={settings.displayLanguage}>
    <>
    <main className="voxly-shell">
      <aside className="voxly-sidebar">
        {/* Logo */}
        <div className="voxly-sidebar__brand">
          <BrandMark />
        </div>

        {/* Primary nav */}
        <nav className="voxly-nav" aria-label={translate(settings.displayLanguage, "nav.main")}>
          {(["home", "insights", "dictionary"] as const).map((tab) => {
            const Icon = tab === "home" ? Home : tab === "insights" ? BarChart2 : BookOpen;
            const label = tab === "home"
              ? translate(settings.displayLanguage, "nav.home")
              : tab === "insights"
                ? translate(settings.displayLanguage, "nav.insights")
                : translate(settings.displayLanguage, "nav.dictionary");
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

        {/* Upgrade card — premium */}
        <div className="voxly-upgrade-card">
          {/* Top zone: title + stacked bars */}
          <div className="voxly-upgrade-card__top">
            <div className="voxly-upgrade-card__plan-row">
              <span className="voxly-upgrade-card__plan-name">{formatPlanLabel(entitlement.billingPlan, (key, params) => translate(settings.displayLanguage, key, params))}</span>
            </div>
            <div className="voxly-upgrade-card__bars">
              <div className="voxly-upgrade-card__bar voxly-upgrade-card__bar--1">
                <div
                  className="voxly-upgrade-card__bar-fill"
                  style={{ width: `${usagePercent(weeklyUsage)}%` }}
                />
              </div>
              <div className="voxly-upgrade-card__bar voxly-upgrade-card__bar--2" />
              <div className="voxly-upgrade-card__bar voxly-upgrade-card__bar--3" />
            </div>
          </div>
          {/* Bottom zone: words used + description + button */}
          <div className="voxly-upgrade-card__bottom">
            {weeklyUsage && (
              <p className="voxly-upgrade-card__words-used">
                <BarChart2 size={12} />
                {weeklyUsage.wordsUsed.toLocaleString()} words used this week
              </p>
            )}
            {entitlement.billingPlan !== "pro" && weeklyUsage?.wordsLimit && (
              <p className="voxly-upgrade-card__desc">
                You&apos;re on the <strong>Free</strong> plan with{" "}
                <strong>{weeklyUsage.wordsLimit.toLocaleString()} words</strong> per week. Upgrade for unlimited dictation.
              </p>
            )}
            <TextButton
              variant="glass"
              className="voxly-upgrade-card__button"
              onClick={() => {
                captureUpgradeClicked({
                  source: "sidebar_upgrade_card",
                  currentPlan: entitlement.billingPlan,
                });
                setSettingsDefaultTab("account");
                setActiveSection("settings");
              }}
            >
              <Star size={14} />
              {entitlement.billingPlan === "pro"
                ? translate(settings.displayLanguage, "upgrade.managePlan")
                : translate(settings.displayLanguage, "upgrade.upgradeToPro")}
            </TextButton>
          </div>
        </div>

        {/* Secondary links */}
        <nav className="voxly-secondary-nav" aria-label={translate(settings.displayLanguage, "nav.secondary")}>
          <button
            type="button"
            className="voxly-secondary-nav__item voxly-secondary-nav__item--referral"
            onClick={() => setReferralOpen(true)}
          >
            <Gift size={16} />
            <span>{translate(settings.displayLanguage, "nav.referral")}</span>
          </button>
          <button
            type="button"
            className={cn("voxly-secondary-nav__item", activeSection === "settings" && "is-active")}
            onClick={() => setActiveSection("settings")}
          >
            <Settings size={16} />
            <span>{translate(settings.displayLanguage, "nav.settings")}</span>
          </button>
          <button
            type="button"
            className="voxly-secondary-nav__item"
            onClick={() => setHelpFeedbackOpen(true)}
          >
            <HelpCircle size={16} />
            <span>{translate(settings.displayLanguage, "nav.helpAndFeedback")}</span>
          </button>
        </nav>

        {/* Profile */}
        <div className="voxly-profile__wrapper">
          <button
            type="button"
            className="voxly-profile"
            onClick={() => setProfileMenuOpen((v) => !v)}
            aria-label={translate(settings.displayLanguage, "account.settings")}
          >
            <div className="voxly-profile__avatar">
              <UserCircle size={22} />
            </div>
            <div className="voxly-profile__info">
              <span className="voxly-profile__name">{settings.agentName || translate(settings.displayLanguage, "account.yourAccount")}</span>
              <span className="voxly-profile__plan">{formatPlanLabel(entitlement.billingPlan, (key, params) => translate(settings.displayLanguage, key, params))}</span>
              <span className="voxly-profile__version">Version {runtime.appVersion}</span>
            </div>
          </button>
          {profileMenuOpen && (
            <div
              className="voxly-profile__menu glass-panel-strong"
              onMouseLeave={() => setProfileMenuOpen(false)}
            >
              {entitlement.isAuthenticated ? (
                <button
                  type="button"
                  className="voxly-profile__menu-item voxly-profile__menu-item--signout"
                  onClick={() => { void clearSession(); setProfileMenuOpen(false); }}
                >
                  <LogOut size={14} />
                  <span>Sign out</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="voxly-profile__menu-item voxly-profile__menu-item--signin"
                  onClick={() => { void window.electronAPI.openWebRoute("signin"); setProfileMenuOpen(false); }}
                >
                  <LogIn size={14} />
                  <span>Sign in</span>
                </button>
              )}
            </div>
          )}
        </div>
      </aside>

      <section className="voxly-main">
        <UpdateBanner
          status={updateStatus}
          busy={updateBusy}
          onCheck={() => void checkForUpdates(true)}
          onDownload={() => void openUpdateDownload()}
        />
        {runtime.pasteAttention && (activeSection === "home" || activeSection === "settings") && (
          <NeedsAttentionBanner
            runtime={runtime}
            onRefreshStatus={() => {
              void window.electronAPI.getRuntimeStatus().then(setRuntime);
            }}
          />
        )}
        {weeklyUsage?.isLimited && (weeklyUsage.isApproachingLimit || weeklyUsage.isLimitReached) && (
          <UsageLimitBanner usage={weeklyUsage} />
        )}
        {activeSection === "home" && (
          <HomePage history={history} settings={settings} weeklyUsage={weeklyUsage} />
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
            defaultTab={settingsDefaultTab}
            onPatchSettings={patchSettings}
            onClearSession={clearSession}
            onStartCheckout={startCheckout}
            onRefreshEntitlement={() => syncEntitlement(true)}
            onCheckUpdates={() => checkForUpdates(true)}
            onOpenUpdate={openUpdateDownload}
          />
        )}
      </section>
    </main>
    {referralOpen && <ReferralModal onClose={() => setReferralOpen(false)} isAuthenticated={entitlement.isAuthenticated} />}
    {helpFeedbackOpen && <HelpFeedbackModal onClose={() => setHelpFeedbackOpen(false)} />}
    </>
    </I18nProvider>
  );
}

function NeedsAttentionBanner({
  runtime,
  onRefreshStatus,
}: {
  runtime: RuntimeStatus;
  onRefreshStatus: () => void;
}) {
  const t = useT();
  if (!runtime.pasteAttention) return null;

  const isAccessibilityIssue = runtime.pasteAttention.kind === "accessibility";

  return (
    <div className="needs-attention-banner glass-panel-subtle" role="status" aria-live="polite">
      <div className="needs-attention-banner__icon">
        <ShieldAlert size={18} />
      </div>
      <div className="needs-attention-banner__copy">
        <strong>{t("status.needsAttention")}</strong>
        <p>{runtime.pasteAttention.summary}</p>
        <p className="needs-attention-banner__detail">{runtime.pasteAttention.detail}</p>
      </div>
      <div className="needs-attention-banner__actions">
        {isAccessibilityIssue ? (
          <TextButton variant="glass" onClick={() => window.electronAPI.openPermissionSettings("accessibility")}>
            {t("status.openAccessibility")}
          </TextButton>
        ) : (
          <TextButton variant="glass" onClick={() => window.electronAPI.openApplicationsFolder()}>
            {t("status.openApplications")}
          </TextButton>
        )}
        <TextButton variant="quiet" onClick={onRefreshStatus}>
          <RefreshCw size={15} />
          {t("status.refresh")}
        </TextButton>
      </div>
    </div>
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
  const t = useT();
  if (!status?.updateAvailable) return null;

  return (
    <div className="app-update-banner glass-panel-subtle" role="status">
      <div className="app-update-banner__icon">
        <Download size={18} />
      </div>
      <div className="app-update-banner__copy">
        <strong>{t("update.ready", { version: status.latestVersion ?? "" })}</strong>
        <p>{t("update.running", { version: status.currentVersion })}</p>
      </div>
      <div className="app-update-banner__actions">
        <TextButton variant="quiet" disabled={busy} onClick={onCheck}>
          <RefreshCw size={15} />
          {busy ? t("update.checking") : t("update.check")}
        </TextButton>
        {status.downloadUrl && (
          <TextButton variant="primary" onClick={onDownload}>
            <Download size={15} />
            {t("update.download")}
          </TextButton>
        )}
      </div>
    </div>
  );
}

function UsageLimitBanner({ usage }: { usage: WeeklyUsageStatus }) {
  const t = useT();
  if (!usage.wordsLimit) return null;
  const wordsRemaining = Math.max(0, usage.wordsRemaining ?? 0);
  const title = usage.isLimitReached ? t("limit.reachedTitle") : t("limit.almostTitle");
  const detail = usage.isLimitReached
    ? t("limit.reachedDetail")
    : t("limit.remainingDetail", { count: wordsRemaining.toLocaleString() });

  return (
    <div className="usage-limit-banner glass-panel-subtle" role="status" aria-live="polite">
      <div className="usage-limit-banner__icon">
        <Sparkles size={18} />
      </div>
      <div className="usage-limit-banner__copy">
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <TextButton
        variant="primary"
        onClick={() => {
          captureUpgradeClicked({ source: "usage_limit_banner" });
          window.electronAPI.openWebRoute("pricing");
        }}
      >
        <Star size={15} />
        {t("overlay.upgrade")}
      </TextButton>
    </div>
  );
}

// ── Hotkey display chip ───────────────────────────────────────────────────────

function normalizeShortcutPart(part: string, platform?: RuntimeStatus["platform"]): string {
  switch (part.trim().toLowerCase()) {
    case "control":
      return "Ctrl";
    case "commandorcontrol":
      return platform === "darwin" ? "Cmd" : "Ctrl";
    case "meta":
      return platform === "win32" ? "Win" : "Cmd";
    case "super":
      return platform === "win32" ? "Win" : "Super";
    case "option":
      return "Opt";
    case "return":
      return "Enter";
    default:
      return part.trim();
  }
}

function HotkeyChip({ hotkey, platform }: { hotkey: string; platform?: RuntimeStatus["platform"] }) {
  const t = useT();
  if (hotkey === "GLOBE" || hotkey === "Fn") {
    return (
      <div className="home-banner__shortcut-keys">
        <span className="home-banner__shortcut-press">{t("shortcut.press")}</span>
        {/* FN-only key */}
        <span className="home-banner__key-chip home-banner__key-chip--fn">FN</span>
        <span className="home-banner__shortcut-or">{t("shortcut.or")}</span>
        {/* Combined fn + globe key matching physical macOS key layout */}
        <span className="home-banner__key-chip home-banner__key-chip--globe">
          <span className="home-banner__key-chip-fn">fn</span>
          <Globe size={12} className="home-banner__key-chip-globe" />
        </span>
      </div>
    );
  }

  if (platform) {
    const parts = hotkey.split("+").map((part) => normalizeShortcutPart(part, platform)).filter(Boolean);
    return (
      <div className="home-banner__shortcut-keys">
        <span className="home-banner__shortcut-press">{t("shortcut.press")}</span>
        {parts.map((part, index) => (
          <span key={`${part}-${index}`} className="home-banner__shortcut-part">
            <span className="home-banner__key">{part}</span>
            {index < parts.length - 1 && <span className="home-banner__shortcut-plus">+</span>}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="home-banner__shortcut-keys">
      <span className="home-banner__shortcut-press">{t("shortcut.press")}</span>
      <span className="home-banner__key">{hotkey}</span>
    </div>
  );
}

// ── Home Page ─────────────────────────────────────────────────────────────────

function HomePage({
  history,
  settings,
  weeklyUsage,
}: {
  history: TranscriptionRecord[];
  settings: AppSettings;
  weeklyUsage: WeeklyUsageStatus | null;
}) {
  const t = useT();
  return (
    <div className="voxly-page">
      {/* Hero banner */}
      <div className="home-banner" style={{ backgroundImage: `url(${heroBg})` }}>
        <div className="home-banner__copy">
          <h1>{t("home.titleLine1")}<br /><span>{t("home.titleLine2")}</span></h1>
          <p>{t("home.subtitle")}</p>
        </div>
        <div className="home-banner__shortcut">
          <HotkeyChip hotkey={settings.hotkey} />
        </div>
      </div>

      {weeklyUsage?.isLimited && weeklyUsage.wordsLimit !== null && (
        <div className="home-usage glass-panel-subtle">
          <div className="home-usage__copy">
            <span>{t("home.freeWeeklyUsage")}</span>
            <strong>{weeklyUsage.wordsUsed.toLocaleString()} / {weeklyUsage.wordsLimit.toLocaleString()} {t("home.words")}</strong>
          </div>
          <div className="home-usage__bar" aria-hidden="true">
            <div className="home-usage__bar-fill" style={{ width: `${usagePercent(weeklyUsage)}%` }} />
          </div>
        </div>
      )}

      {/* History list */}
      <div className="voxly-section-header">
        <h2>{t("home.recentDictations")}</h2>
      </div>

      {history.length === 0 ? (
        <div className="voxly-empty-state">
          <Mic size={36} />
          <p>{t("home.noDictations")}</p>
          <small>{t("home.historyHint")}</small>
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
                      {t("home.cleaned")}
                    </span>
                  )}
                  <span className="home-history__words">{wordCount} {t("home.words")}</span>
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
  const t = useT();
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
        <h2>{t("insights.title")}</h2>
        <p>{t("insights.subtitle")}</p>
      </div>

      {!hasData ? (
        <div className="voxly-empty-state">
          <BarChart2 size={36} />
          <p>{t("insights.noData")}</p>
          <small>{t("insights.noDataHint")}</small>
        </div>
      ) : (
        <>
          <div className="insights-grid">
            <MetricCard
              label={t("insights.totalDictations")}
              value={String(totalDictations)}
              detail={t("insights.sessionsRecorded")}
            />
            <MetricCard
              label={t("insights.totalWords")}
              value={totalWords >= 1000 ? `${(totalWords / 1000).toFixed(1)}k` : String(totalWords)}
              detail={t("insights.wordsSpoken")}
            />
            <MetricCard
              label={t("insights.cleaned")}
              value={String(cleanedCount)}
              detail={t("insights.cleanedDetail")}
            />
            <MetricCard
              label={t("insights.timeSaved")}
              value={`~${Math.round(totalWords / 130)} min`}
              detail={t("insights.timeSavedDetail")}
            />
          </div>

          <div className="voxly-section-header" style={{ marginTop: 28 }}>
            <h2>{t("insights.recentActivity")}</h2>
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
                  <span className="insights-activity__words">{words} {t("home.words")}</span>
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
  const t = useT();
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
          <h3>{t("dictionary.title")}</h3>
          <p>{t("dictionary.subtitle")}</p>
        </div>
      </div>

      {/* Controls row */}
      <div className="dict-controls">
        <div className="dict-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("dictionary.search")}
            aria-label={t("dictionary.search")}
          />
        </div>
        <div className="dict-add">
          <input
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addWord()}
            placeholder={t("dictionary.addPlaceholder")}
            aria-label={t("dictionary.addPlaceholder")}
          />
          <TextButton variant="primary" onClick={addWord} disabled={!newWord.trim()}>
            <Plus size={16} />
            {t("dictionary.add")}
          </TextButton>
        </div>
      </div>

      {/* Word list */}
      {filtered.length === 0 ? (
        <div className="voxly-empty-state">
          <BookOpen size={36} />
          <p>{words.length === 0 ? t("dictionary.noWords") : t("dictionary.noMatches")}</p>
          <small>
            {words.length === 0
              ? t("dictionary.emptyHint")
              : t("dictionary.searchHint")}
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

// ── Settings Page — Apple HIG tabbed layout ───────────────────────────────────

type SettingsTabId = "general" | "account" | "privacy";

function SettingsTabBtn({
  id,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  id: SettingsTabId;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`sp-tab-${id}`}
      aria-selected={active}
      aria-controls={`sp-panel-${id}`}
      className={cn("sp-tab", active && "is-active")}
      onClick={onClick}
    >
      <Icon size={20} />
      <span>{label}</span>
    </button>
  );
}

function SettingsPage({
  settings,
  runtime,
  entitlement,
  updateStatus,
  updateBusy,
  defaultTab,
  onPatchSettings,
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
  defaultTab?: SettingsTabId;
  onPatchSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onClearSession: () => Promise<void>;
  onStartCheckout: (plan: PaidPlan, interval: BillingInterval) => Promise<unknown>;
  onRefreshEntitlement: () => Promise<void>;
  onCheckUpdates: () => Promise<void>;
  onOpenUpdate: () => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(defaultTab ?? "general");
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("yearly");
  const [accountBusy, setAccountBusy] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState<PaidPlan | null>(null);
  const [accountMessage, setAccountMessage] = useState("");
  const t = useT();

  async function handleSignOut() {
    setAccountBusy(true);
    setAccountMessage("");
    try {
      await onClearSession();
      setAccountMessage("Signed out.");
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

  async function handleStartCheckout(plan: PaidPlan) {
    captureUpgradeClicked({
      source: "pricing_card",
      plan,
      interval: billingInterval,
      currentPlan: entitlement.billingPlan,
    });
    setCheckoutBusy(plan);
    setAccountMessage("");
    try {
      await onStartCheckout(plan, billingInterval);
      setAccountMessage("Checkout opened in your browser. Return here after payment to refresh.");
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "Unable to start checkout.");
    } finally {
      setCheckoutBusy(null);
    }
  }

  return (
    <div className="voxly-page">
      {/* Apple HIG toolbar row with account status on account tab */}
      <div className="sp-toolbar-row">
        <div className="sp-toolbar" role="tablist" aria-label="Settings sections">
          <SettingsTabBtn id="general" label="General" icon={Settings} active={activeTab === "general"} onClick={() => setActiveTab("general")} />
          <SettingsTabBtn id="account" label="Account" icon={CreditCard} active={activeTab === "account"} onClick={() => setActiveTab("account")} />
          <SettingsTabBtn id="privacy" label="Privacy" icon={Shield} active={activeTab === "privacy"} onClick={() => setActiveTab("privacy")} />
        </div>

        {activeTab === "account" && (
          <div className="account-status account-status--inline">
            <div className="account-status__avatar">
              <UserCircle size={24} />
            </div>
            <div className="account-status__info">
              <span className="account-status__name">
                {settings.agentName || "Your account"}
              </span>
              <span className="account-status__plan">
                {formatPlanLabel(entitlement.billingPlan, t)}
                {entitlement.billingStatus !== "unknown" && ` · ${entitlement.billingStatus.replace(/_/g, " ")}`}
              </span>
            </div>
            <div className="account-status__actions">
              <TextButton disabled={accountBusy} onClick={() => void handleRefreshEntitlement()}>
                <RefreshCw size={15} />
                Refresh
              </TextButton>
              {entitlement.isAuthenticated ? (
                <TextButton variant="quiet" disabled={accountBusy} onClick={() => void handleSignOut()}>
                  <LogOut size={15} />
                  Sign Out
                </TextButton>
              ) : (
                <TextButton variant="glass" onClick={() => window.electronAPI.openWebRoute("signin")}>
                  <LogIn size={15} />
                  Sign In
                </TextButton>
              )}
            </div>
          </div>
        )}
      </div>

      {/* General ── name, hotkey, mode, cleanup, updates */}
      {activeTab === "general" && (
        <div id="sp-panel-general" role="tabpanel" aria-labelledby="sp-tab-general" className="settings-rows">
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
              <p>Choose how Dicta Fun starts and stops recording.</p>
            </div>
            <div className="settings-mode-options" role="radiogroup" aria-label="Hotkey mode">
              {hotkeyModeOptions(t).map((option) => {
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
              <h3>Paste mode</h3>
              <p>Choose whether Dicta Fun pastes instantly or waits for cleaned text first.</p>
            </div>
            <div className="settings-mode-options" role="radiogroup" aria-label="Paste mode">
              {pasteModeOptions().map((option) => {
                const Icon = option.icon;
                const disabled = !settings.cleanupEnabled || !entitlement.canUseCleanup;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      "settings-mode-option",
                      settings.cleanupMode === option.value && "settings-mode-option--active",
                      disabled && "settings-mode-option--disabled",
                    )}
                  >
                    <input
                      type="radio"
                      name="paste-mode"
                      value={option.value}
                      checked={settings.cleanupMode === option.value}
                      disabled={disabled}
                      onChange={() => void onPatchSettings({ cleanupMode: option.value })}
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
              <h3>App version</h3>
              <p>{formatUpdateStatus(updateStatus, runtime.appVersion, t)}</p>
            </div>
            <div className="settings-row__actions">
              <span className="settings-version-pill">v{runtime.appVersion}</span>
              <TextButton disabled={updateBusy} onClick={() => void onCheckUpdates()}>
                <RefreshCw size={16} />
                {updateBusy ? "Checking..." : "Check for Updates"}
              </TextButton>
              {updateStatus?.updateAvailable && updateStatus.downloadUrl && (
                <TextButton variant="primary" onClick={() => void onOpenUpdate()}>
                  <Download size={16} />
                  Download Update
                </TextButton>
              )}
            </div>
          </div>

          {canSkipOnboarding && (
            <div className="settings-row">
              <div>
                <h3>Developer onboarding</h3>
                <p>Reset setup completion and show the onboarding flow again.</p>
              </div>
              <TextButton variant="quiet" onClick={() => void onPatchSettings({ onboardingComplete: false })}>
                <RefreshCw size={16} />
                Rerun Onboarding
              </TextButton>
            </div>
          )}

          <div className="settings-row">
            <div>
              <h3>Langue de l&apos;interface / Display language</h3>
              <p>Choose the language used throughout the app.</p>
            </div>
            <select
              className="settings-select"
              value={settings.displayLanguage}
              onChange={(e) => void onPatchSettings({ displayLanguage: e.target.value as AppSettings["displayLanguage"] })}
            >
              {displayLanguageOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Account ── plan status + pricing cards */}
      {activeTab === "account" && (
        <div id="sp-panel-account" role="tabpanel" aria-labelledby="sp-tab-account">
          {/* Billing interval toggle */}
          <div className="pricing-billing-toggle">
            <span className={cn("pricing-billing-toggle__label", billingInterval === "monthly" && "pricing-billing-toggle__label--active")}>
              Monthly
            </span>
            <button
              type="button"
              className="pricing-billing-toggle__switch"
              data-state={billingInterval}
              aria-label="Toggle billing interval"
              onClick={() => setBillingInterval(billingInterval === "monthly" ? "yearly" : "monthly")}
            />
            <span className={cn("pricing-billing-toggle__label", billingInterval === "yearly" && "pricing-billing-toggle__label--active")}>
              Annually
            </span>
          </div>

          {/* Pricing cards */}
          <div className="pricing-grid">
            {/* Free */}
            <article className="pricing-card pricing-card--cta-dark">
              <div className="pricing-card__head">
                <div className="pricing-card__eyebrow">
                  <span className="pricing-card__label">Starter</span>
                  {entitlement.billingPlan === "free" && (
                    <span className="pricing-card__badge">Current plan</span>
                  )}
                </div>
                <h3 className="pricing-card__title">Free</h3>
                <div className="pricing-card__price-row">
                  <span className="pricing-card__price-current">$0</span>
                </div>
                <p className="pricing-card__desc">Full DictaFun experience.</p>
              </div>
              <div className="pricing-card__cta">
                <TextButton
                  disabled={entitlement.billingPlan === "free"}
                  onClick={() => {
                    captureUpgradeClicked({
                      source: "pricing_card",
                      plan: "free",
                      currentPlan: entitlement.billingPlan,
                    });
                    window.electronAPI.openWebRoute("pricing");
                  }}
                >
                  {entitlement.billingPlan === "free" ? "Current plan" : "Download"}
                </TextButton>
              </div>
              <hr className="pricing-card__divider" />
              <div className="pricing-card__features">
                <p className="pricing-card__features-label">Included features</p>
                <ul className="pricing-card__feature-list">
                  {[
                    "Full DictaFun experience",
                    "Cloud transcription",
                    "AI cleanup",
                    "2,000 words/week",
                    "No credit card required",
                  ].map((f) => (
                    <li key={f} className="pricing-card__feature">
                      <Check size={14} />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </article>

            {/* Starter / Plus — featured */}
            <article className="pricing-card pricing-card--featured">
              <div className="pricing-card__head">
                <div className="pricing-card__eyebrow">
                  <span className="pricing-card__label">Best for daily writing</span>
                  <span className="pricing-card__badge pricing-card__badge--featured">
                    {entitlement.billingPlan === "starter" ? "Current plan" : "Launch plan"}
                  </span>
                </div>
                <h3 className="pricing-card__title">Dicta Fun Plus</h3>
                <div className="pricing-card__price-row">
                  <span className="pricing-card__price-current">
                    {billingInterval === "yearly" ? "$7" : "$8"}
                  </span>
                  <span className="pricing-card__price-period">/ month</span>
                </div>
                <p className="pricing-card__desc">For everyday users who want to speak instead of type.</p>
              </div>
              <div className="pricing-card__cta">
                <TextButton
                  variant="primary"
                  disabled={checkoutBusy === "starter" || entitlement.billingPlan === "starter"}
                  onClick={() => void handleStartCheckout("starter")}
                >
                  {entitlement.billingPlan === "starter"
                    ? "Current plan"
                    : checkoutBusy === "starter"
                    ? "Opening checkout…"
                    : "Get Plus"}
                </TextButton>
              </div>
              <hr className="pricing-card__divider" />
              <div className="pricing-card__features">
                <p className="pricing-card__features-label">Everything in Free, plus…</p>
                <ul className="pricing-card__feature-list">
                  {["Higher monthly usage", "Custom cleanup instructions", "Custom dictionary & templates", "Faster processing"].map((f) => (
                    <li key={f} className="pricing-card__feature">
                      <Check size={14} />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </article>

            {/* Pro */}
            <article className="pricing-card pricing-card--cta-dark">
              <div className="pricing-card__head">
                <div className="pricing-card__eyebrow">
                  <span className="pricing-card__label">For professionals</span>
                  {entitlement.billingPlan === "pro" && (
                    <span className="pricing-card__badge">Current plan</span>
                  )}
                </div>
                <h3 className="pricing-card__title">Dicta Fun Pro</h3>
                <div className="pricing-card__price-row">
                  {billingInterval === "yearly" && (
                    <span className="pricing-card__price-old">$45</span>
                  )}
                  <span className="pricing-card__price-current">
                    {billingInterval === "yearly" ? "$15" : "$45"}
                  </span>
                  <span className="pricing-card__price-period">/ month</span>
                </div>
                <p className="pricing-card__desc">For heavy users, creators, founders, students, and professionals.</p>
              </div>
              <div className="pricing-card__cta">
                <TextButton
                  disabled={checkoutBusy === "pro" || entitlement.billingPlan === "pro"}
                  onClick={() => void handleStartCheckout("pro")}
                >
                  {entitlement.billingPlan === "pro"
                    ? "Current plan"
                    : checkoutBusy === "pro"
                    ? "Opening checkout…"
                    : "Get Pro"}
                </TextButton>
              </div>
              <hr className="pricing-card__divider" />
              <div className="pricing-card__features">
                <p className="pricing-card__features-label">Everything in Free, plus…</p>
                <ul className="pricing-card__feature-list">
                  {["Unlimited voice writing", "Advanced rewrites & modes", "File/audio upload transcription", "Priority processing & support"].map((f) => (
                    <li key={f} className="pricing-card__feature">
                      <Check size={14} />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          </div>

          {!!accountMessage && <p className="account-message">{accountMessage}</p>}
        </div>
      )}

      {/* Privacy ── permissions */}
      {activeTab === "privacy" && (
        <div id="sp-panel-privacy" role="tabpanel" aria-labelledby="sp-tab-privacy" className="settings-rows">
          <div className="settings-row">
            <div>
              <h3>Microphone</h3>
              <p>Required to capture your voice for dictation.</p>
            </div>
            <div className="settings-row__actions">
              <TextButton onClick={() => window.electronAPI.openPermissionSettings("microphone")}>
                <Mic size={16} />
                Open Microphone Settings…
              </TextButton>
            </div>
          </div>

          {runtime.platform === "darwin" && (
            <div className="settings-row">
              <div>
                <h3>Accessibility</h3>
                <p>Allows Dicta Fun to paste transcribed text at your cursor position.</p>
              </div>
              <div className="settings-row__actions">
                <TextButton onClick={() => window.electronAPI.openPermissionSettings("accessibility")}>
                  <ShieldAlert size={16} />
                  Open Accessibility Settings…
                </TextButton>
              </div>
            </div>
          )}

          <div className="settings-row">
            <div>
              <h3>Privacy policy</h3>
              <p>Review how Dicta Fun handles your data.</p>
            </div>
            <div className="settings-row__actions">
              <TextButton variant="quiet" onClick={() => window.electronAPI.openWebRoute("privacy")}>
                <Globe size={16} />
                View Privacy Policy
              </TextButton>
            </div>
          </div>

          <div className="settings-row">
            <div>
              <h3>Terms of service</h3>
              <p>Read the terms that govern your use of Dicta Fun.</p>
            </div>
            <div className="settings-row__actions">
              <TextButton variant="quiet" onClick={() => window.electronAPI.openWebRoute("terms")}>
                <Globe size={16} />
                View Terms
              </TextButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type OnboardingStepId = "language" | "welcome" | "plan" | "permissions" | "hotkey" | "paste-mode" | "finish";

type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  eyebrow: string;
  summary: string;
  icon?: LucideIcon;
};

function onboardingStepsFor(language: AppSettings["displayLanguage"]): OnboardingStep[] {
  if (language === "fr-FR") {
    return [
      {
        id: "language",
        eyebrow: "Langue",
        title: "Choisissez votre langue.",
        summary: "Dicta Fun utilisera cette langue pour l'interface, les exemples et les tests de dictée.",
        icon: Globe,
      },
      {
        id: "welcome",
        eyebrow: "Configuration",
        title: "Une dictée qui reste naturelle.",
        summary: "Dicta Fun reste discret jusqu'à ce que vous utilisiez votre raccourci, puis colle le texte dans l'application ouverte.",
        icon: MousePointerClick,
      },
      {
        id: "plan",
        eyebrow: "Offre gratuite",
        title: "Commencez avec 2 000 mots gratuits chaque semaine.",
        summary: "La dictée gratuite est limitée chaque semaine. Dicta Fun vous préviendra quand vous approcherez de la limite.",
        icon: Star,
      },
      {
        id: "permissions",
        eyebrow: "Accès",
        title: "Autorisez seulement ce dont la dictée a besoin.",
        summary: "Le microphone capture votre voix. Sur macOS, Accessibilité permet de coller le résultat à l'emplacement du curseur.",
        icon: LockKeyhole,
      },
      {
        id: "hotkey",
        eyebrow: "Raccourci",
        title: "Apprenez votre raccourci.",
        summary: "Testez d'abord le maintien du raccourci pendant que vous parlez, puis l'appui une fois pour démarrer et une fois pour arrêter.",
        icon: Keyboard,
      },
      {
        id: "paste-mode",
        eyebrow: "Mode de collage",
        title: "Testez les deux modes de collage.",
        summary: "Rapide colle tout de suite. Propre attend le texte corrigé.",
        icon: Sparkles,
      },
      {
        id: "finish",
        eyebrow: "Prêt",
        title: "Prêt dans toutes vos applications.",
        summary: "Placez votre curseur où vous voulez écrire, puis utilisez le raccourci que vous venez de tester.",
        icon: Check,
      },
    ];
  }

  return [
    {
      id: "language",
      eyebrow: "Language",
      title: "Choose your language.",
      summary: "Dicta Fun will use this language for the interface, examples, and dictation tests.",
      icon: Globe,
    },
    {
      id: "welcome",
      eyebrow: "Setup",
      title: "Make dictation feel native.",
      summary: "Dicta Fun stays out of the way until you press your shortcut, then pastes the transcript back into the app you were using.",
      icon: MousePointerClick,
    },
    {
      id: "plan",
      eyebrow: "Free Plan",
      title: "Start with 2,000 free words each week.",
      summary: "Free dictation is capped weekly. Dicta Fun will warn you as you approach the limit and point you to upgrade when you need more.",
      icon: Star,
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
      summary: "First hold the shortcut while speaking, then try pressing once to start and once to stop. Each test transcribes here.",
      icon: Keyboard,
    },
    {
      id: "paste-mode",
      eyebrow: "Paste Mode",
      title: "Try both paste modes.",
      summary: "Fast pastes immediately. Clean waits for polished text.",
      icon: Sparkles,
    },
    {
      id: "finish",
      eyebrow: "Ready",
      title: "Ready from anywhere.",
      summary: "Use the shortcut you tested and Dicta Fun will paste the transcript where your cursor is focused.",
      icon: Check,
    },
  ];
}

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
  const [shortcutComplete, setShortcutComplete] = useState(false);
  const [pasteModeComplete, setPasteModeComplete] = useState(false);
  const onboardingSteps = onboardingStepsFor(settings.displayLanguage);
  const step = onboardingSteps[stepIndex];
  const StepIcon = step.icon;
  const stepTransitionKey = `${step.id}-${settings.displayLanguage}`;
  const isLast = stepIndex === onboardingSteps.length - 1;
  const canGoBack = stepIndex > 0;
  const canContinue =
    (step.id !== "hotkey" || shortcutComplete || canSkipOnboarding) &&
    (step.id !== "paste-mode" || pasteModeComplete);

  async function completeOnboarding() {
    log.info("Completing onboarding");
    await onPatchSettings({ onboardingComplete: true });
    // Privacy: onboarding analytics records completion only, never user-entered settings or trial transcript text.
    capture("onboarding_completed", { completedStep: step.id, skipped: step.id !== "finish" });
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
      <section className="onboarding-window">
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
          {canSkipOnboarding && (
            <TextButton variant="quiet" onClick={completeOnboarding}>
              Skip Setup
            </TextButton>
          )}
        </aside>

        <section className="onboarding-content" data-step={step.id} aria-labelledby="onboarding-title">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${stepTransitionKey}-copy`}
              className="onboarding-copy"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <p className="onboarding-eyebrow">
                {StepIcon && <StepIcon size={15} aria-hidden="true" />}
                <span>{step.eyebrow}</span>
              </p>
              <h1 id="onboarding-title">{step.title}</h1>
              <p>{step.summary}</p>
            </motion.div>
          </AnimatePresence>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${stepTransitionKey}-detail`}
              className="onboarding-detail"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {step.id === "language" && <LanguageStep settings={settings} onPatchSettings={onPatchSettings} />}
              {step.id === "welcome" && <WelcomeStep settings={settings} runtime={runtime} />}
              {step.id === "plan" && <PlanStep />}
              {step.id === "permissions" && (
                <PermissionsStep runtime={runtime} micCheck={micCheck} onCheckMicrophone={checkMicrophone} onRefresh={onRefresh} />
              )}
              {step.id === "hotkey" && (
                <HotkeyTeachStep
                  settings={settings}
                  runtime={runtime}
                  onCompletionChange={setShortcutComplete}
                  onPatchSettings={onPatchSettings}
                />
              )}
              {step.id === "paste-mode" && (
                <PasteModeTeachStep
                  settings={settings}
                  onCompletionChange={setPasteModeComplete}
                  onPatchSettings={onPatchSettings}
                />
              )}
              {step.id === "finish" && <FinishStep settings={settings} runtime={runtime} />}
            </motion.div>
          </AnimatePresence>

          <footer className="onboarding-actions">
            <TextButton variant="glass" disabled={!canGoBack} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}>
              <ArrowLeft size={17} />
              Back
            </TextButton>
            <TextButton
              variant="primary"
              disabled={!canContinue}
              onClick={() => {
                if (!canContinue) return;
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
              ) : step.id === "hotkey" && !shortcutComplete ? (
                <>
                  {canSkipOnboarding ? "Continue (Dev Skip)" : "Complete Both Tests"}
                  <ArrowRight size={17} />
                </>
              ) : step.id === "paste-mode" && !pasteModeComplete ? (
                <>
                  Try Both Modes
                  <ArrowRight size={17} />
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

function LanguageStep({
  settings,
  onPatchSettings,
}: {
  settings: AppSettings;
  onPatchSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const options: Array<{
    value: AppSettings["displayLanguage"];
    transcriptionLanguage: string;
    label: string;
    description: string;
  }> = [
    {
      value: "en",
      transcriptionLanguage: "en",
      label: "English",
      description: "Use English for setup, examples, and transcription tests.",
    },
    {
      value: "fr-FR",
      transcriptionLanguage: "fr",
      label: "Français",
      description: "Utiliser le français pour la configuration, les exemples et les tests de dictée.",
    },
  ];

  return (
    <div className="language-pick">
      <div className="language-pick__options" role="radiogroup" aria-label="Onboarding language">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn("language-pick__option", settings.displayLanguage === option.value && "language-pick__option--active")}
          >
            <input
              type="radio"
              name="onboarding-language"
              value={option.value}
              checked={settings.displayLanguage === option.value}
              onChange={() => void onPatchSettings({ displayLanguage: option.value, language: option.transcriptionLanguage })}
            />
            <Globe size={20} />
            <span>{option.label}</span>
            <small>{option.description}</small>
          </label>
        ))}
      </div>
    </div>
  );
}

function WelcomeStep({ settings, runtime }: { settings: AppSettings; runtime: RuntimeStatus }) {
  return (
    <div className="onboarding-preview">
      <div className="shortcut-preview">
        <span className="shortcut-preview__label">
          <Keyboard size={14} aria-hidden="true" />
          <span>Shortcut</span>
        </span>
        <HotkeyChip hotkey={settings.hotkey} platform={runtime.platform} />
      </div>
      <div className="mini-overlay">
        <span className="status-dot" data-state={runtime.whisper === "ready" ? "complete" : "processing"} />
        <Mic size={28} />
        <p>Overlay ready</p>
      </div>
      <div className="flow-row" aria-label="Dictation flow">
        <span className="flow-row__item">
          <Keyboard size={14} aria-hidden="true" />
          <span>Press</span>
        </span>
        <ChevronRight size={15} />
        <span className="flow-row__item">
          <Mic size={14} aria-hidden="true" />
          <span>Speak</span>
        </span>
        <ChevronRight size={15} />
        <span className="flow-row__item">
          <ClipboardPaste size={14} aria-hidden="true" />
          <span>Paste</span>
        </span>
      </div>
    </div>
  );
}

function PlanStep() {
  return (
    <div className="plan-preview">
      <div className="plan-preview__header">
        <span className="plan-preview__label">Free weekly words</span>
        <div className="plan-preview__count">
          <strong>2,000</strong>
          <span>words</span>
        </div>
      </div>
      <div className="plan-preview__bar" aria-hidden="true">
        <div className="plan-preview__bar-fill" />
      </div>
      <div className="plan-preview__rows">
        <div>
          <CheckCircle2 size={16} />
          <span>Warnings near 80% usage</span>
        </div>
        <div>
          <CheckCircle2 size={16} />
          <span>Upgrade prompt when you need more room</span>
        </div>
      </div>
      <div className="plan-preview__footer">
        <TextButton variant="glass" onClick={() => window.electronAPI.openWebRoute("pricing")}>
          <Star size={17} />
          View upgrade options
        </TextButton>
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
  runtime,
  onCompletionChange,
  onPatchSettings,
}: {
  settings: AppSettings;
  runtime: RuntimeStatus;
  onCompletionChange: (complete: boolean) => void;
  onPatchSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  type TrialId = "push" | "tap";
  type TrialState = {
    status: "waiting" | "recording" | "processing" | "done" | "error";
    transcript: string;
    error: string;
  };

  const [activeTrial, setActiveTrial] = useState<TrialId>("push");
  const [trialStates, setTrialStates] = useState<Record<TrialId, TrialState>>({
    push: { status: "waiting", transcript: "", error: "" },
    tap: { status: "waiting", transcript: "", error: "" },
  });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const activeTrialRef = useRef<TrialId>("push");
  const trialStatesRef = useRef(trialStates);
  const recorderTrialRef = useRef<TrialId | null>(null);
  const startInFlightRef = useRef(false);
  const stopRequestedDuringStartRef = useRef(false);
  const pushDone = trialStates.push.status === "done";
  const tapDone = trialStates.tap.status === "done";
  const bothDone = pushDone && tapDone;
  const shortcutLabel = runtime.platform === "darwin" ? "Fn / Globe" : settings.hotkey;
  const t = useT();

  useEffect(() => {
    onCompletionChange(bothDone);
  }, [bothDone, onCompletionChange]);

  useEffect(() => {
    activeTrialRef.current = activeTrial;
  }, [activeTrial]);

  useEffect(() => {
    trialStatesRef.current = trialStates;
  }, [trialStates]);

  useEffect(() => {
    if (bothDone) return;
    const desiredMode: AppSettings["mode"] = activeTrial === "push" ? "push-to-talk" : "tap-to-talk";
    if (settings.mode !== desiredMode) {
      void onPatchSettings({ mode: desiredMode });
    }
  }, [activeTrial, bothDone, onPatchSettings, settings.mode]);

  const updateTrial = useCallback((trial: TrialId, patch: Partial<TrialState>) => {
    setTrialStates((current) => ({
      ...current,
      [trial]: {
        ...current[trial],
        ...patch,
      },
    }));
  }, []);

  const startTrialRecording = useCallback(async (trial: TrialId) => {
    const currentState = trialStatesRef.current[trial].status;
    if (
      startInFlightRef.current ||
      recorderRef.current !== null ||
      currentState === "recording" ||
      currentState === "processing" ||
      currentState === "done"
    ) {
      return;
    }

    log.info("Shortcut onboarding test: starting recording", { trial });
    startInFlightRef.current = true;
    stopRequestedDuringStartRef.current = false;
    chunksRef.current = [];
    recorderTrialRef.current = trial;
    updateTrial(trial, { status: "recording", transcript: "", error: "" });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const mimeType = preferredRecordingMimeType();
      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: SHORTCUT_TEST_AUDIO_BITS_PER_SECOND,
      });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const stoppedTrial = recorderTrialRef.current ?? trial;
        const chunks = chunksRef.current;
        recorderRef.current = null;
        recorderTrialRef.current = null;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        updateTrial(stoppedTrial, { status: "processing", error: "" });

        try {
          const blob = new Blob(chunks, { type: preferredRecordingMimeType() });
          const wavBuffer = await recordingBlobToWav(blob);
          const audioChunks = await Promise.all(
            chunks.map(async (chunk) => ({
              buffer: await chunk.arrayBuffer(),
              mimeType: chunk.type || blob.type || "audio/webm",
            })),
          );
          const result = await window.electronAPI.transcribeLocalWhisper(wavBuffer, {
            cleanupEnabled: false,
            saveToHistory: false,
            selectedModel: settings.selectedModel,
          }, audioChunks);

          if (!result.text.trim()) {
            updateTrial(stoppedTrial, {
              status: "error",
              transcript: "",
              error: "No speech detected. Press the shortcut and try again.",
            });
            return;
          }

          updateTrial(stoppedTrial, { status: "done", transcript: result.text, error: "" });
          if (stoppedTrial === "push") {
            setActiveTrial("tap");
          }
        } catch (err) {
          log.error("Shortcut onboarding test transcription failed", err);
          updateTrial(stoppedTrial, {
            status: "error",
            transcript: "",
            error: err instanceof Error ? err.message : "Transcription failed. Try again.",
          });
        }
      };
      recorder.start();
      startInFlightRef.current = false;
      if (stopRequestedDuringStartRef.current) {
        stopRequestedDuringStartRef.current = false;
        recorder.stop();
      }
    } catch (err) {
      startInFlightRef.current = false;
      stopRequestedDuringStartRef.current = false;
      log.warn("Shortcut onboarding test mic access failed", err);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      recorderTrialRef.current = null;
      updateTrial(trial, {
        status: "error",
        transcript: "",
        error: "Could not access microphone. Check permissions, then press the shortcut again.",
      });
    }
  }, [settings.selectedModel, updateTrial]);

  const stopTrialRecording = useCallback(() => {
    if (startInFlightRef.current && recorderRef.current?.state !== "recording") {
      stopRequestedDuringStartRef.current = true;
      return;
    }
    if (recorderRef.current?.state === "recording") {
      log.info("Shortcut onboarding test: stopping recording", { trial: recorderTrialRef.current });
      recorderRef.current.stop();
    }
  }, []);

  const handleTapToggle = useCallback(() => {
    const trial = activeTrialRef.current;
    if (trial !== "tap") return;
    if (recorderRef.current?.state === "recording") {
      stopTrialRecording();
      return;
    }
    void startTrialRecording("tap");
  }, [startTrialRecording, stopTrialRecording]);

  useEffect(() => {
    void window.electronAPI.setHotkeyTestCaptureActive(true);
    const offStart = window.electronAPI.onDictationStart(() => {
      if (activeTrialRef.current === "push") {
        void startTrialRecording("push");
      }
    });
    const offStop = window.electronAPI.onDictationStop(() => {
      if (activeTrialRef.current === "push") {
        stopTrialRecording();
      }
    });
    const offToggle = window.electronAPI.onDictationToggle(handleTapToggle);

    return () => {
      offStart();
      offStop();
      offToggle();
      void window.electronAPI.setHotkeyTestCaptureActive(false);
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      onCompletionChange(false);
    };
  }, [handleTapToggle, onCompletionChange, startTrialRecording, stopTrialRecording]);

  return (
    <div className="hotkey-teach">
      <div className="hotkey-teach__shortcut">
        <span className="hotkey-teach__shortcut-label">
          <Keyboard size={14} aria-hidden="true" />
          <span>Shortcut</span>
        </span>
        <HotkeyChip hotkey={settings.hotkey} platform={runtime.platform} />
      </div>

      <ShortcutTrialCard
        active={activeTrial === "push"}
        done={pushDone}
        icon={Mic}
        title="1. Press and hold"
        instruction={`Hold ${shortcutLabel}, speak a short sentence, then release to stop.`}
        state={trialStates.push}
      />

      <ShortcutTrialCard
        active={activeTrial === "tap"}
        done={tapDone}
        icon={MousePointerClick}
        title="2. Press twice"
        instruction={`Press ${shortcutLabel} once, speak, then press it again to stop.`}
        state={trialStates.tap}
        disabled={!pushDone}
      />

      {bothDone && (
        <div className="hotkey-teach__pick">
          <p className="hotkey-teach__pick-label">Which felt better?</p>
          <div className="settings-mode-options" role="radiogroup" aria-label="Preferred hotkey mode">
            {hotkeyModeOptions(t).map((option) => {
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

function ShortcutTrialCard({
  active,
  done,
  disabled = false,
  icon: Icon,
  title,
  instruction,
  state,
}: {
  active: boolean;
  done: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  title: string;
  instruction: string;
  state: {
    status: "waiting" | "recording" | "processing" | "done" | "error";
    transcript: string;
    error: string;
  };
}) {
  const placeholder = disabled
    ? "Complete the first test to unlock this one."
    : state.status === "recording"
      ? "Listening... speak now."
      : state.status === "processing"
        ? "Transcribing..."
        : state.status === "error"
          ? state.error
          : "Your transcription will appear here.";
  const dotState = state.status === "waiting"
    ? active ? "starting" : "idle"
    : state.status === "done"
      ? "complete"
      : state.status;

  return (
    <article
      className={cn(
        "hotkey-teach__trial",
        active && "hotkey-teach__trial--active",
        done && "hotkey-teach__trial--done",
        disabled && "hotkey-teach__trial--disabled",
      )}
    >
      <div className="hotkey-teach__trial-label">
        <Icon size={17} />
        <span>
          <strong>{title}</strong>
          {" — "}
          {instruction}
        </span>
        {done && <CheckCircle2 size={17} className="hotkey-teach__check" />}
      </div>
      <div className="hotkey-teach__status">
        <span className="status-dot" data-state={dotState} />
        <span>
          {disabled
            ? "Waiting"
            : state.status === "recording"
              ? "Listening"
              : state.status === "processing"
                ? "Transcribing"
                : state.status === "done"
                  ? "Complete"
                  : state.status === "error"
                    ? "Try again"
                    : active
                      ? "Press the shortcut now"
                      : "Up next"}
        </span>
      </div>
      <textarea
        className="hotkey-teach__textarea"
        readOnly
        value={state.transcript}
        placeholder={placeholder}
        aria-label={`${title} transcription output`}
      />
    </article>
  );
}

function pasteModeSampleFor(language: AppSettings["displayLanguage"]): { raw: string; clean: string } {
  if (language === "fr-FR") {
    return {
      raw: "rappelle à camille de relire les notes du projet avant la réunion client de demain",
      clean: "Rappelle à Camille de relire les notes du projet avant la réunion client de demain.",
    };
  }

  return {
    raw: "please remind camille to review the project notes before tomorrow's client meeting",
    clean: "Please remind Camille to review the project notes before tomorrow's client meeting.",
  };
}

function PasteModeTeachStep({
  settings,
  onCompletionChange,
  onPatchSettings,
}: {
  settings: AppSettings;
  onCompletionChange: (complete: boolean) => void;
  onPatchSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  type PasteTrialId = AppSettings["cleanupMode"];
  type PasteTrialState = {
    status: "waiting" | "raw" | "cleaning" | "done";
    output: string;
  };

  const [trialStates, setTrialStates] = useState<Record<PasteTrialId, PasteTrialState>>({
    fast: { status: "waiting", output: "" },
    accurate: { status: "waiting", output: "" },
  });
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const sample = pasteModeSampleFor(settings.displayLanguage);
  const pasteOptions = pasteModeOptions(settings.displayLanguage);
  const isFrench = settings.displayLanguage === "fr-FR";
  const fastDone = trialStates.fast.status === "done";
  const cleanDone = trialStates.accurate.status === "done";
  const bothDone = fastDone && cleanDone;
  const trialRunning = Object.values(trialStates).some((state) => state.status === "raw" || state.status === "cleaning");

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current = [];
  }, []);

  useEffect(() => {
    onCompletionChange(bothDone);
  }, [bothDone, onCompletionChange]);

  useEffect(() => clearTimers, [clearTimers]);

  const updateTrial = useCallback((trial: PasteTrialId, patch: Partial<PasteTrialState>) => {
    setTrialStates((current) => ({
      ...current,
      [trial]: {
        ...current[trial],
        ...patch,
      },
    }));
  }, []);

  const runTrial = useCallback((trial: PasteTrialId) => {
    if (trialRunning) return;
    void onPatchSettings({ cleanupEnabled: true, cleanupMode: trial });

    if (trial === "fast") {
      updateTrial("fast", { status: "raw", output: sample.raw });
      timersRef.current.push(
        setTimeout(() => updateTrial("fast", { status: "cleaning", output: sample.raw }), 650),
        setTimeout(() => updateTrial("fast", { status: "done", output: sample.clean }), 1450),
      );
      return;
    }

    updateTrial("accurate", { status: "cleaning", output: "" });
    timersRef.current.push(
      setTimeout(() => updateTrial("accurate", { status: "done", output: sample.clean }), 1100),
    );
  }, [onPatchSettings, sample.clean, sample.raw, trialRunning, updateTrial]);

  return (
    <div className="paste-mode-teach">
      <div className="paste-mode-teach__trials">
        <PasteModeTrialCard
          mode="fast"
          language={settings.displayLanguage}
          title={isFrench ? "Rapide" : "Fast"}
          description={isFrench ? "Colle, puis corrige." : "Paste, then clean."}
          state={trialStates.fast}
          disabled={trialRunning || fastDone}
          onRun={() => runTrial("fast")}
        />
        <PasteModeTrialCard
          mode="accurate"
          language={settings.displayLanguage}
          title={isFrench ? "Propre" : "Clean"}
          description={isFrench ? "Corrige, puis colle." : "Clean, then paste."}
          state={trialStates.accurate}
          disabled={trialRunning || cleanDone}
          onRun={() => runTrial("accurate")}
        />
      </div>

      {bothDone && (
        <div className="paste-mode-teach__pick">
          <p className="paste-mode-teach__pick-label">{isFrench ? "Mode par défaut" : "Default paste mode"}</p>
          <div className="settings-mode-options" role="radiogroup" aria-label="Default paste mode">
            {pasteOptions.map((option) => {
              const Icon = option.icon;
              return (
                <label
                  key={option.value}
                  className={cn("settings-mode-option", settings.cleanupMode === option.value && "settings-mode-option--active")}
                >
                  <input
                    type="radio"
                    name="paste-mode-onboarding"
                    value={option.value}
                    checked={settings.cleanupMode === option.value}
                    onChange={() => void onPatchSettings({ cleanupEnabled: true, cleanupMode: option.value })}
                  />
                  <Icon size={17} />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PasteModeTrialCard({
  mode,
  language,
  title,
  description,
  state,
  disabled,
  onRun,
}: {
  mode: AppSettings["cleanupMode"];
  language: AppSettings["displayLanguage"];
  title: string;
  description: string;
  state: {
    status: "waiting" | "raw" | "cleaning" | "done";
    output: string;
  };
  disabled: boolean;
  onRun: () => void;
}) {
  const Icon = mode === "fast" ? Copy : Sparkles;
  const isFrench = language === "fr-FR";
  const statusLabel = state.status === "waiting"
    ? isFrench ? "Prêt" : "Ready"
    : state.status === "raw"
      ? isFrench ? "Collé" : "Pasted"
      : state.status === "cleaning"
        ? mode === "fast"
          ? isFrench ? "Correction" : "Cleaning"
          : isFrench ? "Correction" : "Cleaning"
        : isFrench ? "Terminé" : "Complete";
  const placeholder = state.status === "waiting"
    ? isFrench ? "Lancez le test." : "Run the test."
    : state.status === "cleaning" && mode === "accurate"
      ? isFrench ? "Attente du texte corrigé..." : "Waiting for cleaned text..."
      : "";
  const dotState = state.status === "done" ? "complete" : state.status === "waiting" ? "idle" : "processing";

  return (
    <article className={cn("paste-mode-teach__trial", state.status === "done" && "paste-mode-teach__trial--done")}>
      <div className="paste-mode-teach__trial-header">
        <Icon size={18} />
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {state.status === "done" && <CheckCircle2 size={17} className="paste-mode-teach__check" />}
      </div>
      <div className="paste-mode-teach__status">
        <span className="status-dot" data-state={dotState} />
        <span>{statusLabel}</span>
      </div>
      <textarea
        className="paste-mode-teach__textarea"
        readOnly
        value={state.output}
        placeholder={placeholder}
        aria-label={`${title} paste output`}
      />
      <div className="paste-mode-teach__trial-action">
        <TextButton variant="glass" disabled={disabled} onClick={onRun}>
          <Icon size={17} />
          {state.status === "done" ? isFrench ? "Testé" : "Tested" : isFrench ? `Tester ${title}` : `Test ${title}`}
        </TextButton>
      </div>
    </article>
  );
}

function preferredRecordingMimeType(): string {
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  return "";
}

async function recordingBlobToWav(blob: Blob): Promise<ArrayBuffer> {
  const raw = await blob.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(raw);
  } finally {
    await ctx.close();
  }

  const pcmFloat = new Float32Array(decoded.length);
  for (let channelIndex = 0; channelIndex < decoded.numberOfChannels; channelIndex++) {
    const channel = decoded.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < decoded.length; sampleIndex++) {
      pcmFloat[sampleIndex] += channel[sampleIndex] / decoded.numberOfChannels;
    }
  }

  const pcmInt16 = new Int16Array(decoded.length);
  for (let sampleIndex = 0; sampleIndex < decoded.length; sampleIndex++) {
    const sample = Math.max(-1, Math.min(1, pcmFloat[sampleIndex]));
    pcmInt16[sampleIndex] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }

  const dataLength = pcmInt16.byteLength;
  const wav = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wav);
  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, decoded.sampleRate, true);
  view.setUint32(28, decoded.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);
  new Int16Array(wav, 44).set(pcmInt16);
  return wav;
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
    case "missing": return "Local model unavailable";
    case "error": return "Error loading model";
    case "disabled": return "Disabled";
    default: return String(status);
  }
}

function FinishStep({ settings, runtime }: { settings: AppSettings; runtime: RuntimeStatus }) {
  const modeLabel = settings.mode === "tap-to-talk" ? "Tap to talk" : "Push to talk";
  const pasteLabel = settings.cleanupMode === "fast" ? "Fast" : "Clean";

  return (
    <div className="finish-card">
      <div className="finish-card__header">
        <div className="finish-card__mic">
          <Mic size={30} />
        </div>
        <div>
          <span>Dictation is ready</span>
          <h2>Use it in any app.</h2>
          <p>Keep your cursor where you want text to appear, then use the shortcut you just tested.</p>
        </div>
      </div>
      <dl className="finish-card__status">
        <div className="finish-card__status-item">
          <dt>
            <Keyboard size={14} aria-hidden="true" />
            <span>Shortcut</span>
          </dt>
          <dd><HotkeyChip hotkey={settings.hotkey} platform={runtime.platform} /></dd>
        </div>
        <div className="finish-card__status-item">
          <dt>Mode</dt>
          <dd>
            <span className="finish-card__status-value">
              <Hand size={14} aria-hidden="true" />
              <span>{modeLabel}</span>
            </span>
          </dd>
        </div>
        <div className="finish-card__status-item">
          <dt>Paste</dt>
          <dd>
            <span className="finish-card__status-value">
              {settings.cleanupMode === "fast" ? <Zap size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
              <span>{pasteLabel}</span>
            </span>
          </dd>
        </div>
        <div className="finish-card__status-item">
          <dt>AI Model</dt>
          <dd>
            <span className="finish-card__status-value" data-ok={runtime.whisper === "ready"}>
              <CheckCircle2 size={14} aria-hidden="true" />
              <span>{whisperStatusLabel(runtime.whisper)}</span>
            </span>
          </dd>
        </div>
      </dl>
      <div className="finish-card__actions">
        <TextButton variant="glass" onClick={() => window.electronAPI.openPanel()}>
          <MousePointerClick size={17} />
          Show Control Panel
        </TextButton>
      </div>
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
