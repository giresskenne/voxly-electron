import { app, shell } from "electron";
import type { DesktopUpdateFile, DesktopUpdateStatus } from "../types";
import { createMainLogger } from "../debug-log";

type UpdateManifest = {
  tag?: unknown;
  version?: unknown;
  releasedAt?: unknown;
  files?: unknown;
};

const log = createMainLogger("updates");
const UPDATE_CACHE_MS = 6 * 60 * 60 * 1000;

class UpdateChecker {
  private cached: DesktopUpdateStatus | null = null;
  private checkedAtMs = 0;

  async check(force = false): Promise<DesktopUpdateStatus> {
    if (!force && this.cached && Date.now() - this.checkedAtMs < UPDATE_CACHE_MS) {
      return this.cached;
    }

    const status = await this.fetchStatus();
    this.cached = status;
    this.checkedAtMs = Date.now();
    return status;
  }

  async openDownload(): Promise<void> {
    const status = await this.check(true);
    if (!status.downloadUrl) {
      throw new Error(status.reason ?? "No desktop update download is available.");
    }

    await shell.openExternal(status.downloadUrl);
  }

  private async fetchStatus(): Promise<DesktopUpdateStatus> {
    const currentVersion = app.getVersion();
    const manifestUrl = resolveUpdateManifestUrl();

    if (!manifestUrl) {
      return defaultStatus(currentVersion, "missing-update-url");
    }

    try {
      const response = await fetch(manifestUrl, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        return defaultStatus(currentVersion, `update-check-http-${response.status}`);
      }

      const manifest = await response.json() as UpdateManifest;
      const latestVersion = normalizeVersion(readString(manifest.version) ?? readString(manifest.tag));
      if (!latestVersion) {
        return defaultStatus(currentVersion, "missing-latest-version");
      }

      const file = selectPlatformFile(manifest.files);
      const downloadUrl = file ? resolveObjectUrl(file.latestKey, manifestUrl) : undefined;
      const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
      const releaseTag = readString(manifest.tag) ?? `v${latestVersion}`;

      const status: DesktopUpdateStatus = {
        currentVersion,
        latestVersion,
        updateAvailable,
        checkedAt: new Date().toISOString(),
        source: "remote",
        downloadUrl,
        releaseUrl: `https://github.com/giresskenne/voxly-electron/releases/tag/${releaseTag}`,
        fileName: file?.name,
        reason: updateAvailable && !downloadUrl ? "missing-platform-download" : undefined,
      };

      log.info("Desktop update status resolved", {
        currentVersion,
        latestVersion,
        updateAvailable,
        fileName: file?.name,
      });

      return status;
    } catch (error) {
      log.warn("Desktop update check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return defaultStatus(currentVersion, "update-check-failed");
    }
  }
}

export const updateChecker = new UpdateChecker();

function resolveUpdateManifestUrl(): string {
  return (
    process.env.VITE_DESKTOP_UPDATES_URL ??
    process.env.DESKTOP_UPDATES_URL ??
    ""
  ).trim();
}

function resolveDownloadBaseUrl(manifestUrl: string): string {
  const configured = (
    process.env.VITE_DESKTOP_DOWNLOAD_BASE_URL ??
    process.env.DESKTOP_DOWNLOAD_BASE_URL ??
    ""
  ).trim();

  if (configured) return configured.replace(/\/+$/, "");

  const parsed = new URL(manifestUrl);
  parsed.pathname = parsed.pathname.replace(/desktop\/latest\/latest\.json$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function resolveObjectUrl(key: string, manifestUrl: string): string {
  const base = `${resolveDownloadBaseUrl(manifestUrl)}/`;
  return new URL(key.replace(/^\/+/, ""), base).toString();
}

function selectPlatformFile(files: unknown): DesktopUpdateFile | null {
  if (!Array.isArray(files)) return null;

  const os = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows" : "";
  if (!os) return null;

  for (const item of files) {
    if (!isUpdateFile(item)) continue;
    if (item.os === os) return item;
  }

  return null;
}

function isUpdateFile(value: unknown): value is DesktopUpdateFile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DesktopUpdateFile>;
  return (
    typeof candidate.os === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.releaseKey === "string" &&
    typeof candidate.latestKey === "string"
  );
}

function defaultStatus(currentVersion: string, reason: string): DesktopUpdateStatus {
  return {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    checkedAt: null,
    source: "default",
    reason,
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeVersion(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?/);
  return match?.[0] ?? null;
}

function compareVersions(a: string, b: string): number {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);

  for (let i = 0; i < 3; i++) {
    const diff = parsedA[i] - parsedB[i];
    if (diff !== 0) return diff;
  }

  return 0;
}

function parseVersion(version: string): [number, number, number] {
  const [major = "0", minor = "0", patch = "0"] = version.replace(/^v/i, "").split(/[.-]/);
  return [toNumber(major), toNumber(minor), toNumber(patch)];
}

function toNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
