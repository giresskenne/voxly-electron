import { app, safeStorage } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createMainLogger } from "../debug-log";

const log = createMainLogger("credentials");

type CredentialName = "groqApiKey" | "openaiApiKey";
type CredentialFile = Partial<Record<CredentialName, string>>;

export class CredentialStore {
  private filePath = path.join(app.getPath("userData"), "credentials.json");

  async get(name: CredentialName): Promise<string> {
    const encrypted = (await this.read())[name];
    if (!encrypted) return "";

    try {
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch (error) {
      log.warn("Failed to decrypt credential", { name, error });
      return "";
    }
  }

  async save(name: CredentialName, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is not available on this system.");
    }

    const file = await this.read();
    file[name] = safeStorage.encryptString(trimmed).toString("base64");
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(file, null, 2), { mode: 0o600 });
    log.info("Credential saved", { name });
  }

  async clear(name: CredentialName): Promise<void> {
    const file = await this.read();
    delete file[name];
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(file, null, 2), { mode: 0o600 });
    log.info("Credential cleared", { name });
  }

  async has(name: CredentialName): Promise<boolean> {
    return Boolean((await this.read())[name]);
  }

  private async read(): Promise<CredentialFile> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as CredentialFile;
    } catch {
      return {};
    }
  }
}

export const credentialStore = new CredentialStore();
