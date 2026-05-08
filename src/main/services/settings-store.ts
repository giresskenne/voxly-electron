import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppSettings } from "../types";
import { createMainLogger } from "../debug-log";
import { credentialStore } from "./credential-store";

const log = createMainLogger("settings");

const defaults: AppSettings = {
  hotkey: "CommandOrControl+Shift+Space",
  mode: "tap-to-talk",
  transcriptionMode: "local",
  selectedModel: "base",
  language: "en",
  customDictionary: ["Voxly", "Whisper", "Electron", "TypeScript"],
  cleanupEnabled: true,
  agentName: "Nova",
  groqApiKey: "",
  groqApiKeyConfigured: false,
  openaiApiKey: "",
  openaiApiKeyConfigured: false,
  openaiBaseUrl: "https://api.openai.com/v1",
  whisperPort: 9999,
  mockTranscription: true,
  onboardingComplete: false,
};

export class SettingsStore {
  private filePath = path.join(app.getPath("userData"), "settings.json");
  private cache: AppSettings = defaults;

  async load(): Promise<AppSettings> {
    try {
      log.debug("Reading settings file", { filePath: this.filePath });
      const file = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(file) as Partial<AppSettings>;
      await this.migratePlaintextCredentials(parsed);
      this.cache = await this.withCredentialStatus({ ...defaults, ...this.sanitizeSettings(parsed) });
      await this.persist();
      log.info("Settings loaded", this.cache);
    } catch {
      log.warn("Settings file missing or unreadable; writing defaults", { filePath: this.filePath });
      await this.save(defaults);
    }

    return this.cache;
  }

  get(): AppSettings {
    log.debug("Settings requested");
    return this.cache;
  }

  async save(next: Partial<AppSettings>): Promise<AppSettings> {
    log.debug("Saving settings patch", next);
    await this.saveCredentials(next);
    this.cache = await this.withCredentialStatus({ ...this.cache, ...this.sanitizeSettings(next) });
    await this.persist();
    log.info("Settings saved", this.cache);
    return this.cache;
  }

  private async saveCredentials(next: Partial<AppSettings>): Promise<void> {
    if (typeof next.groqApiKey === "string" && next.groqApiKey.trim()) {
      await credentialStore.save("groqApiKey", next.groqApiKey);
    }
    if (typeof next.openaiApiKey === "string" && next.openaiApiKey.trim()) {
      await credentialStore.save("openaiApiKey", next.openaiApiKey);
    }
  }

  private async migratePlaintextCredentials(settings: Partial<AppSettings>): Promise<void> {
    if (typeof settings.groqApiKey === "string" && settings.groqApiKey.trim()) {
      await credentialStore.save("groqApiKey", settings.groqApiKey);
    }
    if (typeof settings.openaiApiKey === "string" && settings.openaiApiKey.trim()) {
      await credentialStore.save("openaiApiKey", settings.openaiApiKey);
    }
  }

  private sanitizeSettings(settings: Partial<AppSettings>): Partial<AppSettings> {
    const next = { ...settings };
    next.groqApiKey = "";
    next.openaiApiKey = "";
    return next;
  }

  private async withCredentialStatus(settings: AppSettings): Promise<AppSettings> {
    return {
      ...settings,
      groqApiKey: "",
      groqApiKeyConfigured: await credentialStore.has("groqApiKey"),
      openaiApiKey: "",
      openaiApiKeyConfigured: await credentialStore.has("openaiApiKey"),
    };
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.cache, null, 2), { mode: 0o600 });
  }
}

export const settingsStore = new SettingsStore();
