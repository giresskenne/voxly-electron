import test from "node:test";
import assert from "node:assert/strict";
import { detectLanguage, normalizeToIso } from "../src/main/services/lang-detect";

test("detects French mismatch phrases from recent dictation logs", () => {
  assert.equal(detectLanguage("Je viens de parler en français"), "fr");
  assert.equal(detectLanguage("Ceci est un test en français"), "fr");
  assert.equal(detectLanguage("Je parle en français mais l'application ne comprend pas"), "fr");
});

test("returns null when short text is still too ambiguous", () => {
  assert.equal(detectLanguage("hello world"), null);
  assert.equal(detectLanguage("test rapide"), null);
});

test("normalizes locale codes to ISO 639-1", () => {
  assert.equal(normalizeToIso("fr-FR"), "fr");
  assert.equal(normalizeToIso("EN_us"), "en");
});