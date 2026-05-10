import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TranscriptionRecord } from "../types";
import { createMainLogger } from "../debug-log";
import { MOCK_TRANSCRIPTION_TEXT } from "./mock-transcription";

const log = createMainLogger("database");

type NewRecord = Omit<TranscriptionRecord, "id" | "timestamp">;
type Statement = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => unknown;
  run: (...params: unknown[]) => unknown;
};
type DatabaseSync = {
  exec: (sql: string) => void;
  prepare: (sql: string) => Statement;
};
type SQLiteModule = {
  DatabaseSync: new (filePath: string) => DatabaseSync;
};
type SqliteRecord = Omit<TranscriptionRecord, "isProcessed"> & { isProcessed: 0 | 1 };
const SQLITE_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export class TranscriptionDatabase {
  private sqlitePath = path.join(app.getPath("userData"), "transcriptions.sqlite");
  private fallbackPath = path.join(app.getPath("userData"), "transcriptions.json");
  private db: DatabaseSync | null = null;
  private rows: TranscriptionRecord[] = [];

  async init(): Promise<void> {
    await mkdir(path.dirname(this.sqlitePath), { recursive: true });
    try {
      log.debug("Initializing SQLite database", { sqlitePath: this.sqlitePath });
      const sqlite = (await import("node:sqlite")) as unknown as SQLiteModule;
      this.db = new sqlite.DatabaseSync(this.sqlitePath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS transcriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          original_text TEXT NOT NULL,
          processed_text TEXT,
          is_processed BOOLEAN DEFAULT 0,
          processing_method TEXT DEFAULT 'none',
          agent_name TEXT,
          error TEXT
        );
      `);
      this.purgeGeneratedMockRows();
      log.info("SQLite database ready");
      return;
    } catch (error) {
      log.warn("SQLite unavailable; falling back to JSON store", error);
      this.db = null;
    }

    try {
      log.debug("Reading fallback transcription history", { fallbackPath: this.fallbackPath });
      this.rows = JSON.parse(await readFile(this.fallbackPath, "utf8")) as TranscriptionRecord[];
      this.rows = this.rows.filter((row) => !isGeneratedMockRow(row));
      await this.persist();
      log.info("Fallback transcription history loaded", { count: this.rows.length });
    } catch (error) {
      log.warn("Fallback history missing or unreadable; creating a new file", error);
      this.rows = [];
      await this.persist();
    }
  }

  async list(limit = 50): Promise<TranscriptionRecord[]> {
    log.debug("Listing transcription history", { limit, backend: this.db ? "sqlite" : "json" });
    if (this.db) {
      const rows = this.db.prepare(`
        SELECT
          id,
          timestamp,
          original_text AS originalText,
          processed_text AS processedText,
          is_processed AS isProcessed,
          processing_method AS processingMethod,
          agent_name AS agentName,
          error
        FROM transcriptions
        ORDER BY datetime(timestamp) DESC
        LIMIT ?
      `).all(limit) as SqliteRecord[];

      const mapped = rows.map((row) => ({
        ...row,
        timestamp: normalizeTimestamp(row.timestamp),
        isProcessed: Boolean(row.isProcessed),
      }));
      log.debug("SQLite history returned", { count: mapped.length });
      return mapped;
    }

    const rows = [...this.rows]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, limit)
      .map((row) => ({ ...row, timestamp: normalizeTimestamp(row.timestamp) }));
    log.debug("JSON history returned", { count: rows.length });
    return rows;
  }

  async wordCountThisWeek(): Promise<{ wordsUsed: number; wordsLimit: number }> {
    const WEEKLY_LIMIT = 10_000;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    if (this.db) {
      const row = this.db.prepare(`
        SELECT COALESCE(SUM(
          LENGTH(TRIM(original_text)) - LENGTH(REPLACE(TRIM(original_text), ' ', '')) +
          CASE WHEN LENGTH(TRIM(original_text)) > 0 THEN 1 ELSE 0 END
        ), 0) AS wordCount
        FROM transcriptions
        WHERE datetime(timestamp) >= datetime(?)
      `).get(sevenDaysAgo) as { wordCount: number };
      return { wordsUsed: row.wordCount, wordsLimit: WEEKLY_LIMIT };
    }

    const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const wordsUsed = this.rows
      .filter((r) => Date.parse(r.timestamp) >= sevenDaysAgoMs)
      .reduce((sum, r) => sum + r.originalText.trim().split(/\s+/).filter(Boolean).length, 0);
    return { wordsUsed, wordsLimit: WEEKLY_LIMIT };
  }

  async save(record: NewRecord): Promise<TranscriptionRecord> {
    log.debug("Saving transcription record", {
      backend: this.db ? "sqlite" : "json",
      isProcessed: record.isProcessed,
      processingMethod: record.processingMethod,
      hasError: Boolean(record.error),
      originalTextLength: record.originalText.length,
      processedTextLength: record.processedText?.length ?? 0,
    });
    if (this.db) {
      const statement = this.db.prepare(`
        INSERT INTO transcriptions (
          timestamp,
          original_text,
          processed_text,
          is_processed,
          processing_method,
          agent_name,
          error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING
          id,
          timestamp,
          original_text AS originalText,
          processed_text AS processedText,
          is_processed AS isProcessed,
          processing_method AS processingMethod,
          agent_name AS agentName,
          error
      `);
      const row = statement.get(
        new Date().toISOString(),
        record.originalText,
        record.processedText,
        record.isProcessed ? 1 : 0,
        record.processingMethod,
        record.agentName,
        record.error,
      ) as SqliteRecord;

      const saved = {
        ...row,
        timestamp: normalizeTimestamp(row.timestamp),
        isProcessed: Boolean(row.isProcessed),
      };
      log.info("SQLite transcription record saved", { id: saved.id });
      return saved;
    }

    const next: TranscriptionRecord = {
      ...record,
      id: this.nextId(),
      timestamp: new Date().toISOString(),
    };
    this.rows.push(next);
    await this.persist();
    log.info("JSON transcription record saved", { id: next.id });
    return next;
  }

  private nextId(): number {
    return this.rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  }

  private async persist(): Promise<void> {
    log.debug("Persisting fallback transcription history", { fallbackPath: this.fallbackPath, count: this.rows.length });
    await writeFile(this.fallbackPath, JSON.stringify(this.rows, null, 2));
  }

  private purgeGeneratedMockRows(): void {
    if (!this.db) return;
    const result = this.db.prepare(`
      DELETE FROM transcriptions
      WHERE original_text = ?
        AND (processed_text IS NULL OR processed_text = ?)
    `).run(MOCK_TRANSCRIPTION_TEXT, MOCK_TRANSCRIPTION_TEXT);
    log.info("Purged generated mock transcription rows", result);
  }
}

export const transcriptionDatabase = new TranscriptionDatabase();

function normalizeTimestamp(timestamp: string): string {
  if (SQLITE_TIMESTAMP_PATTERN.test(timestamp)) {
    return `${timestamp.replace(" ", "T")}Z`;
  }
  return timestamp;
}

function isGeneratedMockRow(row: TranscriptionRecord): boolean {
  return (
    row.originalText === MOCK_TRANSCRIPTION_TEXT &&
    (row.processedText === null || row.processedText === MOCK_TRANSCRIPTION_TEXT)
  );
}
