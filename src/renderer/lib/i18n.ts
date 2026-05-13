import { createContext, createElement, useContext, type ReactNode } from "react";
import type { DisplayLanguage } from "../../main/types";

export const displayLanguageOptions: Array<{ value: DisplayLanguage; label: string }> = [
  { value: "en", label: "English" },
  { value: "fr-FR", label: "Français (France)" },
];

export type TranslationKey =
  | "app.loading"
  | "nav.main"
  | "nav.home"
  | "nav.insights"
  | "nav.dictionary"
  | "nav.secondary"
  | "nav.referral"
  | "nav.settings"
  | "nav.helpAndFeedback"
  | "account.settings"
  | "account.yourAccount"
  | "plan.free"
  | "plan.starter"
  | "plan.pro"
  | "upgrade.managePlan"
  | "upgrade.upgradeToPro"
  | "usage.loading"
  | "usage.unlimited"
  | "usage.unavailable"
  | "usage.freeWordsWeek"
  | "usage.signInOrUpgrade"
  | "status.needsAttention"
  | "status.openAccessibility"
  | "status.openApplications"
  | "status.refresh"
  | "update.ready"
  | "update.running"
  | "update.checking"
  | "update.check"
  | "update.download"
  | "limit.reachedTitle"
  | "limit.almostTitle"
  | "limit.reachedDetail"
  | "limit.remainingDetail"
  | "shortcut.press"
  | "shortcut.or"
  | "home.titleLine1"
  | "home.titleLine2"
  | "home.subtitle"
  | "home.startSpeaking"
  | "home.freeWeeklyUsage"
  | "home.recentDictations"
  | "home.noDictations"
  | "home.historyHint"
  | "home.cleaned"
  | "home.words"
  | "insights.title"
  | "insights.subtitle"
  | "insights.noData"
  | "insights.noDataHint"
  | "insights.totalDictations"
  | "insights.sessionsRecorded"
  | "insights.totalWords"
  | "insights.wordsSpoken"
  | "insights.cleaned"
  | "insights.cleanedDetail"
  | "insights.timeSaved"
  | "insights.timeSavedDetail"
  | "insights.recentActivity"
  | "dictionary.title"
  | "dictionary.subtitle"
  | "dictionary.search"
  | "dictionary.addPlaceholder"
  | "dictionary.add"
  | "dictionary.noWords"
  | "dictionary.noMatches"
  | "dictionary.emptyHint"
  | "dictionary.searchHint"
  | "settings.tab.general"
  | "settings.tab.account"
  | "settings.tab.privacy"
  | "settings.sections"
  | "settings.yourName"
  | "settings.yourNameDetail"
  | "settings.yourNamePlaceholder"
  | "settings.displayLanguage"
  | "settings.displayLanguageDetail"
  | "settings.hotkey"
  | "settings.hotkeyDetail"
  | "settings.hotkeyMode"
  | "settings.hotkeyModeDetail"
  | "settings.hotkeyModeLabel"
  | "settings.pressHold"
  | "settings.pressHoldDetail"
  | "settings.pressTwice"
  | "settings.pressTwiceDetail"
  | "settings.textCleanup"
  | "settings.textCleanupDetail"
  | "settings.toggleCleanup"
  | "settings.appVersion"
  | "settings.checkUpdates"
  | "settings.downloadUpdate"
  | "settings.currentVersion"
  | "settings.versionAvailable"
  | "settings.upToDate"
  | "settings.updateUnavailable"
  | "account.refresh"
  | "account.signOut"
  | "account.signIn"
  | "account.monthly"
  | "account.annually"
  | "privacy.microphone"
  | "privacy.microphoneDetail"
  | "privacy.openMicrophone"
  | "privacy.accessibility"
  | "privacy.accessibilityDetail"
  | "privacy.openAccessibility"
  | "privacy.privacyPolicy"
  | "privacy.privacyPolicyDetail"
  | "privacy.viewPrivacy"
  | "privacy.terms"
  | "privacy.termsDetail"
  | "privacy.viewTerms"
  | "overlay.ready"
  | "overlay.listening"
  | "overlay.processing"
  | "overlay.pasted"
  | "overlay.needsAttention"
  | "overlay.listeningPreview"
  | "overlay.cleaningPreview"
  | "overlay.copiedSetup"
  | "overlay.open"
  | "overlay.upgrade"
  | "overlay.startDictation"
  | "overlay.stopDictation"
  | "overlay.cancel"
  | "error.weeklyLimit"
  | "error.microphone"
  | "error.paste"
  | "error.transcription"
  | "overlay.menu.hideForHour"
  | "overlay.menu.settings"
  | "overlay.menu.microphone"
  | "overlay.menu.autoDetect"
  | "overlay.menu.micInUse"
  | "overlay.menu.transcriptHistory"
  | "overlay.menu.pasteLastTranscript"
  | "overlay.translatePrompt.translate"
  | "overlay.translatePrompt.keep";

type TranslationParams = Record<string, string | number>;
type TranslationCatalog = Record<TranslationKey, string>;

const translations: Record<DisplayLanguage, TranslationCatalog> = {
  en: {
    "app.loading": "Loading Dicta Fun...",
    "nav.main": "Main navigation",
    "nav.home": "Home",
    "nav.insights": "Insights",
    "nav.dictionary": "Dictionary",
    "nav.secondary": "Secondary navigation",
    "nav.referral": "Get a free month",
    "nav.settings": "Settings",
    "nav.helpAndFeedback": "Help & Feedback",
    "account.settings": "Account settings",
    "account.yourAccount": "Your account",
    "plan.free": "Free plan",
    "plan.starter": "Starter plan",
    "plan.pro": "Pro plan",
    "upgrade.managePlan": "Manage plan",
    "upgrade.upgradeToPro": "Upgrade to Pro",
    "usage.loading": "Loading weekly usage",
    "usage.unlimited": "Unlimited weekly words",
    "usage.unavailable": "Weekly usage unavailable",
    "usage.freeWordsWeek": "2,000 free words each week",
    "usage.signInOrUpgrade": "Sign in or upgrade for more usage",
    "status.needsAttention": "Needs attention",
    "status.openAccessibility": "Open Accessibility",
    "status.openApplications": "Open /Applications",
    "status.refresh": "Refresh Status",
    "update.ready": "Dicta Fun {version} is ready",
    "update.running": "You are running {version}.",
    "update.checking": "Checking...",
    "update.check": "Check",
    "update.download": "Download Update",
    "limit.reachedTitle": "Free weekly word limit reached",
    "limit.almostTitle": "Free weekly word limit almost reached",
    "limit.reachedDetail": "Upgrade to keep dictating this week.",
    "limit.remainingDetail": "{count} free words remaining this week.",
    "shortcut.press": "Press",
    "shortcut.or": "or",
    "home.titleLine1": "Speak naturally.",
    "home.titleLine2": "Dicta Fun writes it clearly.",
    "home.subtitle": "Press the shortcut or start a recording to turn your thoughts into polished text.",
    "home.startSpeaking": "Start speaking",
    "home.freeWeeklyUsage": "Free weekly usage",
    "home.recentDictations": "Recent dictations",
    "home.noDictations": "No dictations yet.",
    "home.historyHint": "Your transcription history will appear here.",
    "home.cleaned": "Cleaned",
    "home.words": "words",
    "insights.title": "Your insights",
    "insights.subtitle": "A summary of how you've been using Dicta Fun.",
    "insights.noData": "No data yet.",
    "insights.noDataHint": "Start dictating to see your usage stats here.",
    "insights.totalDictations": "Total dictations",
    "insights.sessionsRecorded": "Sessions recorded",
    "insights.totalWords": "Total words",
    "insights.wordsSpoken": "Words spoken",
    "insights.cleaned": "Cleaned",
    "insights.cleanedDetail": "Dictations polished by AI",
    "insights.timeSaved": "Time saved",
    "insights.timeSavedDetail": "vs. typing at 40 wpm",
    "insights.recentActivity": "Recent activity",
    "dictionary.title": "Dicta Fun learns the words you use.",
    "dictionary.subtitle": "Add names, company terms, acronyms, and phrases so Dicta Fun writes them correctly every time.",
    "dictionary.search": "Search words...",
    "dictionary.addPlaceholder": "Add a word or phrase...",
    "dictionary.add": "Add",
    "dictionary.noWords": "No words yet.",
    "dictionary.noMatches": "No matches.",
    "dictionary.emptyHint": "Add words Dicta Fun should recognise — names, brands, or technical terms.",
    "dictionary.searchHint": "Try a different search.",
    "settings.tab.general": "General",
    "settings.tab.account": "Account",
    "settings.tab.privacy": "Privacy",
    "settings.sections": "Settings sections",
    "settings.yourName": "Your name",
    "settings.yourNameDetail": "How Dicta Fun refers to you when cleaning up dictations.",
    "settings.yourNamePlaceholder": "Your name",
    "settings.displayLanguage": "Display language",
    "settings.displayLanguageDetail": "Choose the language used in the app interface.",
    "settings.hotkey": "Hotkey",
    "settings.hotkeyDetail": "Global shortcut to start and stop dictation.",
    "settings.hotkeyMode": "Hotkey mode",
    "settings.hotkeyModeDetail": "Choose how Dicta Fun starts and stops recording.",
    "settings.hotkeyModeLabel": "Hotkey mode",
    "settings.pressHold": "Press and hold",
    "settings.pressHoldDetail": "Hold the hotkey while speaking, release to stop.",
    "settings.pressTwice": "Press twice",
    "settings.pressTwiceDetail": "Press once to start, then press again to stop.",
    "settings.textCleanup": "Text cleanup",
    "settings.textCleanupDetail": "Automatically polish punctuation and casing after you dictate.",
    "settings.toggleCleanup": "Toggle text cleanup",
    "settings.appVersion": "App version",
    "settings.checkUpdates": "Check for Updates",
    "settings.downloadUpdate": "Download Update",
    "settings.currentVersion": "Current version: {version}.",
    "settings.versionAvailable": "Version {version} is available.",
    "settings.upToDate": "You are up to date on version {version}.",
    "settings.updateUnavailable": "Update checks are not configured for this build.",
    "account.refresh": "Refresh",
    "account.signOut": "Sign Out",
    "account.signIn": "Sign In",
    "account.monthly": "Monthly",
    "account.annually": "Annually",
    "privacy.microphone": "Microphone",
    "privacy.microphoneDetail": "Required to capture your voice for dictation.",
    "privacy.openMicrophone": "Open Microphone Settings...",
    "privacy.accessibility": "Accessibility",
    "privacy.accessibilityDetail": "Allows Dicta Fun to paste transcribed text at your cursor position.",
    "privacy.openAccessibility": "Open Accessibility Settings...",
    "privacy.privacyPolicy": "Privacy policy",
    "privacy.privacyPolicyDetail": "Review how Dicta Fun handles your data.",
    "privacy.viewPrivacy": "View Privacy Policy",
    "privacy.terms": "Terms of service",
    "privacy.termsDetail": "Read the terms that govern your use of Dicta Fun.",
    "privacy.viewTerms": "View Terms",
    "overlay.ready": "Ready",
    "overlay.listening": "Listening",
    "overlay.processing": "Processing",
    "overlay.pasted": "Pasted",
    "overlay.needsAttention": "Needs attention",
    "overlay.listeningPreview": "Listening...",
    "overlay.cleaningPreview": "Cleaning up transcript...",
    "overlay.copiedSetup": "Copied to clipboard · Paste setup needed",
    "overlay.open": "Open",
    "overlay.upgrade": "Upgrade",
    "overlay.startDictation": "Start dictation",
    "overlay.stopDictation": "Stop dictation",
    "overlay.cancel": "Cancel",
    "error.weeklyLimit": "Weekly free word limit reached. Upgrade to keep dictating this week.",
    "error.microphone": "Microphone access failed.",
    "error.paste": "Text copied, but paste did not complete.",
    "error.transcription": "Transcription failed.",
    "overlay.menu.hideForHour": "Hide for 1 hour",
    "overlay.menu.settings": "Settings",
    "overlay.menu.microphone": "Microphone",
    "overlay.menu.autoDetect": "Auto-detect",
    "overlay.menu.micInUse": "Mic in use:",
    "overlay.menu.transcriptHistory": "Transcript history",
    "overlay.menu.pasteLastTranscript": "Paste last transcript",
    "overlay.translatePrompt.translate": "Translate",
    "overlay.translatePrompt.keep": "Keep",
  },
  "fr-FR": {
    "app.loading": "Chargement de Dicta Fun...",
    "nav.main": "Navigation principale",
    "nav.home": "Accueil",
    "nav.insights": "Statistiques",
    "nav.dictionary": "Dictionnaire",
    "nav.secondary": "Navigation secondaire",
    "nav.referral": "Obtenir un mois gratuit",
    "nav.settings": "Réglages",
    "nav.helpAndFeedback": "Aide & Commentaires",
    "account.settings": "Réglages du compte",
    "account.yourAccount": "Votre compte",
    "plan.free": "Offre gratuite",
    "plan.starter": "Offre Starter",
    "plan.pro": "Offre Pro",
    "upgrade.managePlan": "Gérer l'offre",
    "upgrade.upgradeToPro": "Passer à Pro",
    "usage.loading": "Chargement de l'utilisation hebdomadaire",
    "usage.unlimited": "Mots hebdomadaires illimités",
    "usage.unavailable": "Utilisation hebdomadaire indisponible",
    "usage.freeWordsWeek": "2 000 mots gratuits par semaine",
    "usage.signInOrUpgrade": "Connectez-vous ou changez d'offre pour plus d'utilisation",
    "status.needsAttention": "Action requise",
    "status.openAccessibility": "Ouvrir Accessibilité",
    "status.openApplications": "Ouvrir /Applications",
    "status.refresh": "Actualiser l'état",
    "update.ready": "Dicta Fun {version} est prêt",
    "update.running": "Vous utilisez la version {version}.",
    "update.checking": "Vérification...",
    "update.check": "Vérifier",
    "update.download": "Télécharger la mise à jour",
    "limit.reachedTitle": "Limite hebdomadaire de mots gratuits atteinte",
    "limit.almostTitle": "Limite hebdomadaire de mots gratuits bientôt atteinte",
    "limit.reachedDetail": "Passez à une offre supérieure pour continuer à dicter cette semaine.",
    "limit.remainingDetail": "{count} mots gratuits restants cette semaine.",
    "shortcut.press": "Appuyer sur",
    "shortcut.or": "ou",
    "home.titleLine1": "Parlez naturellement.",
    "home.titleLine2": "Dicta Fun écrit clairement.",
    "home.subtitle": "Utilisez le raccourci ou lancez un enregistrement pour transformer vos idées en texte soigné.",
    "home.startSpeaking": "Commencer à parler",
    "home.freeWeeklyUsage": "Utilisation gratuite hebdomadaire",
    "home.recentDictations": "Dictées récentes",
    "home.noDictations": "Aucune dictée pour le moment.",
    "home.historyHint": "Votre historique de transcription apparaîtra ici.",
    "home.cleaned": "Corrigé",
    "home.words": "mots",
    "insights.title": "Vos statistiques",
    "insights.subtitle": "Un résumé de votre utilisation de Dicta Fun.",
    "insights.noData": "Aucune donnée pour le moment.",
    "insights.noDataHint": "Commencez à dicter pour voir vos statistiques ici.",
    "insights.totalDictations": "Nombre de dictées",
    "insights.sessionsRecorded": "Sessions enregistrées",
    "insights.totalWords": "Nombre de mots",
    "insights.wordsSpoken": "Mots prononcés",
    "insights.cleaned": "Corrigées",
    "insights.cleanedDetail": "Dictées améliorées par l'IA",
    "insights.timeSaved": "Temps gagné",
    "insights.timeSavedDetail": "par rapport à 40 mots/min au clavier",
    "insights.recentActivity": "Activité récente",
    "dictionary.title": "Dicta Fun apprend les mots que vous utilisez.",
    "dictionary.subtitle": "Ajoutez des noms, termes d'entreprise, acronymes et expressions pour que Dicta Fun les écrive correctement.",
    "dictionary.search": "Rechercher des mots...",
    "dictionary.addPlaceholder": "Ajouter un mot ou une expression...",
    "dictionary.add": "Ajouter",
    "dictionary.noWords": "Aucun mot pour le moment.",
    "dictionary.noMatches": "Aucun résultat.",
    "dictionary.emptyHint": "Ajoutez les mots que Dicta Fun doit reconnaître : noms, marques ou termes techniques.",
    "dictionary.searchHint": "Essayez une autre recherche.",
    "settings.tab.general": "Général",
    "settings.tab.account": "Compte",
    "settings.tab.privacy": "Confidentialité",
    "settings.sections": "Sections des réglages",
    "settings.yourName": "Votre nom",
    "settings.yourNameDetail": "Nom utilisé par Dicta Fun lors de la correction de vos dictées.",
    "settings.yourNamePlaceholder": "Votre nom",
    "settings.displayLanguage": "Langue de l'interface",
    "settings.displayLanguageDetail": "Choisissez la langue utilisée dans l'application.",
    "settings.hotkey": "Raccourci",
    "settings.hotkeyDetail": "Raccourci global pour démarrer et arrêter la dictée.",
    "settings.hotkeyMode": "Mode du raccourci",
    "settings.hotkeyModeDetail": "Choisissez comment Dicta Fun démarre et arrête l'enregistrement.",
    "settings.hotkeyModeLabel": "Mode du raccourci",
    "settings.pressHold": "Maintenir appuyé",
    "settings.pressHoldDetail": "Maintenez le raccourci pendant que vous parlez, puis relâchez pour arrêter.",
    "settings.pressTwice": "Appuyer deux fois",
    "settings.pressTwiceDetail": "Appuyez une fois pour démarrer, puis une seconde fois pour arrêter.",
    "settings.textCleanup": "Correction du texte",
    "settings.textCleanupDetail": "Améliore automatiquement la ponctuation et la casse après la dictée.",
    "settings.toggleCleanup": "Activer ou désactiver la correction du texte",
    "settings.appVersion": "Version de l'application",
    "settings.checkUpdates": "Rechercher des mises à jour",
    "settings.downloadUpdate": "Télécharger la mise à jour",
    "settings.currentVersion": "Version actuelle : {version}.",
    "settings.versionAvailable": "La version {version} est disponible.",
    "settings.upToDate": "Vous utilisez déjà la version {version}.",
    "settings.updateUnavailable": "La recherche de mises à jour n'est pas configurée pour cette version.",
    "account.refresh": "Actualiser",
    "account.signOut": "Se déconnecter",
    "account.signIn": "Se connecter",
    "account.monthly": "Mensuel",
    "account.annually": "Annuel",
    "privacy.microphone": "Microphone",
    "privacy.microphoneDetail": "Nécessaire pour capturer votre voix pendant la dictée.",
    "privacy.openMicrophone": "Ouvrir les réglages du microphone...",
    "privacy.accessibility": "Accessibilité",
    "privacy.accessibilityDetail": "Permet à Dicta Fun de coller le texte transcrit à l'emplacement du curseur.",
    "privacy.openAccessibility": "Ouvrir les réglages d'accessibilité...",
    "privacy.privacyPolicy": "Politique de confidentialité",
    "privacy.privacyPolicyDetail": "Consultez la manière dont Dicta Fun traite vos données.",
    "privacy.viewPrivacy": "Voir la politique de confidentialité",
    "privacy.terms": "Conditions d'utilisation",
    "privacy.termsDetail": "Lire les conditions qui régissent votre utilisation de Dicta Fun.",
    "privacy.viewTerms": "Voir les conditions",
    "overlay.ready": "Prêt",
    "overlay.listening": "Écoute",
    "overlay.processing": "Traitement",
    "overlay.pasted": "Collé",
    "overlay.needsAttention": "Action requise",
    "overlay.listeningPreview": "Écoute...",
    "overlay.cleaningPreview": "Correction de la transcription...",
    "overlay.copiedSetup": "Copié dans le presse-papiers · Configuration du collage requise",
    "overlay.open": "Ouvrir",
    "overlay.upgrade": "Changer d'offre",
    "overlay.startDictation": "Démarrer la dictée",
    "overlay.stopDictation": "Arrêter la dictée",
    "overlay.cancel": "Annuler",
    "error.weeklyLimit": "Limite hebdomadaire de mots gratuits atteinte. Passez à une offre supérieure pour continuer à dicter cette semaine.",
    "error.microphone": "Accès au microphone impossible.",
    "error.paste": "Le texte a été copié, mais le collage n'a pas abouti.",
    "error.transcription": "Échec de la transcription.",
    "overlay.menu.hideForHour": "Masquer pendant 1 heure",
    "overlay.menu.settings": "Réglages",
    "overlay.menu.microphone": "Microphone",
    "overlay.menu.autoDetect": "Détection automatique",
    "overlay.menu.micInUse": "Micro utilisé :",
    "overlay.menu.transcriptHistory": "Historique des transcriptions",
    "overlay.menu.pasteLastTranscript": "Coller la dernière transcription",
    "overlay.translatePrompt.translate": "Traduire",
    "overlay.translatePrompt.keep": "Conserver",
  },
};

const I18nContext = createContext<DisplayLanguage>("en");

export function I18nProvider({ language, children }: { language: DisplayLanguage; children: ReactNode }) {
  return createElement(I18nContext.Provider, { value: language }, children);
}

export function useDisplayLanguage(): DisplayLanguage {
  return useContext(I18nContext);
}

export function useT(): (key: TranslationKey, params?: TranslationParams) => string {
  const language = useDisplayLanguage();
  return (key, params) => translate(language, key, params);
}

export function translate(language: DisplayLanguage, key: TranslationKey, params: TranslationParams = {}): string {
  const template = translations[language]?.[key] ?? translations.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

export function htmlLang(language: DisplayLanguage): string {
  return language === "fr-FR" ? "fr-FR" : "en";
}
