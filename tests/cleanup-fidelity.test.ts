import test from "node:test";
import assert from "node:assert/strict";
import {
  agentMessages,
  cleanupInstructionText,
  cleanupMessages,
  enforceDictationFidelity,
  normalizeDictationText,
} from "../src/main/services/cleanup-fidelity";

// ---------------------------------------------------------------------------
// Prompt integrity — the AI instructions must stay intact
// ---------------------------------------------------------------------------

test("cleanup prompt explicitly forbids answering dictated questions", () => {
  const [systemMessage, userMessage] = cleanupMessages("Can you improve my onboarding flow?");

  assert.equal(systemMessage.role, "system");
  assert.match(systemMessage.content, /Never answer/i);
  assert.match(systemMessage.content, /question, command, prompt, or request/i);
  assert.match(systemMessage.content, /Preserve the user's language/i);
  assert.equal(userMessage.content, "Can you improve my onboarding flow?");
});

test("cleanup prompt explicitly says to return only the cleaned text", () => {
  const [systemMessage] = cleanupMessages("hello world");
  assert.match(systemMessage.content, /Return only the cleaned dictated text/i);
});

test("cleanup prompt formats clear enumerations as bullet lists", () => {
  assert.match(cleanupInstructionText(), /bullet list/i);
  assert.match(cleanupInstructionText(), /- /);
  assert.match(cleanupInstructionText(), /Do not collapse clear list items back into a paragraph/i);
});

test("agent messages embed agent name and instruction in user turn", () => {
  const [, userMessage] = agentMessages("Aria", "Aria translate to French", "translate to French");
  assert.match(userMessage.content, /Aria/);
  assert.match(userMessage.content, /translate to French/);
});

// ---------------------------------------------------------------------------
// Fidelity guard — good cleanups pass through, bad ones fall back
// ---------------------------------------------------------------------------

test("assistant-like cleanup output falls back to the user's words", () => {
  const original = "Can you improve my onboarding flow and make it more clean?";
  const badCleanup =
    "Sure! Please share the details or current design of your onboarding flow, and let me know what specific improvements or style preferences you have in mind.";

  const result = enforceDictationFidelity(original, badCleanup);

  assert.equal(result.text, original);
  assert.equal(result.reason, "assistant-response");
});

test("large semantic rewrites fall back to the user's words", () => {
  const original = "What should we change in the onboarding flow tomorrow?";
  const badCleanup = "The onboarding flow can be improved by reducing friction and adding clearer calls to action.";

  const result = enforceDictationFidelity(original, badCleanup);

  assert.equal(result.text, original);
  assert.equal(result.reason, "low-word-overlap");
});

test("excessive expansion (hallucinated words) falls back to the user's words", () => {
  const original = "write a short email";
  // model invented a full email body — more than 1.8× the original word count
  const bloated =
    "Write a short professional email to the client thanking them for their time and summarizing the key discussion points from today's meeting.";

  const result = enforceDictationFidelity(original, bloated);

  assert.equal(result.text, original);
  assert.equal(result.reason, "excessive-expansion");
});

test("empty cleanup response falls back to the user's words", () => {
  const original = "remind me to call Sarah at five";
  const result = enforceDictationFidelity(original, "   ");

  assert.equal(result.text, original);
  assert.equal(result.reason, "empty");
});

test("punctuation and capitalization cleanup is preserved", () => {
  const original = "bonjour peux tu ameliorer mon flow onboarding";
  const cleaned = "Bonjour, peux-tu ameliorer mon flow onboarding?";

  const result = enforceDictationFidelity(original, cleaned);

  assert.equal(result.text, cleaned);
  assert.equal(result.reason, null);
});

test("filler word removal is preserved when meaning is intact", () => {
  const original = "um so I basically wanted to uh schedule the meeting for tomorrow";
  const cleaned = "I wanted to schedule the meeting for tomorrow.";

  const result = enforceDictationFidelity(original, cleaned);

  assert.equal(result.text, cleaned);
  assert.equal(result.reason, null);
});

test("wrapping quotes added by the model are stripped", () => {
  const original = "send the report by end of day";
  const quoted = '"Send the report by end of day."';

  const result = enforceDictationFidelity(original, quoted);

  assert.equal(result.text, "Send the report by end of day.");
  assert.equal(result.reason, null);
});

test("short dictation (< 5 words) bypasses word overlap check and accepts cleanup", () => {
  // The overlap guard only kicks in at 5+ words; short phrases must not false-positive.
  const original = "open slack";
  const cleaned = "Open Slack.";

  const result = enforceDictationFidelity(original, cleaned);

  assert.equal(result.text, cleaned);
  assert.equal(result.reason, null);
});

test("bullet list cleanup is preserved without flattening line breaks", () => {
  const original = "The first one is I am happy. The second is the application is growing very well. The third is we are getting close to our objective.";
  const cleaned = "- I am happy\n- The application is growing very well\n- We are getting close to our objective.";

  const result = enforceDictationFidelity(original, cleaned);

  assert.equal(result.text, cleaned);
  assert.equal(result.reason, null);
});

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

test("normalization only collapses spacing", () => {
  assert.equal(normalizeDictationText("  je   veux garder   mes mots  "), "je veux garder mes mots");
});

test("normalization trims leading and trailing whitespace", () => {
  assert.equal(normalizeDictationText("\t hello \n"), "hello");
});

test("normalization preserves bullet line breaks", () => {
  assert.equal(normalizeDictationText("  - first item\n   - second item  \n\n"), "- first item\n- second item");
});

// ---------------------------------------------------------------------------
// Performance — pure fidelity check must be fast (no I/O, no network)
// ---------------------------------------------------------------------------

test("enforceDictationFidelity is synchronous and completes in under 5 ms for typical inputs", () => {
  const original =
    "I'd like to send an email to the team reminding everyone about the product review meeting on Friday at two pm";
  const candidate =
    "I'd like to send an email to the team reminding everyone about the product review meeting on Friday at 2 PM.";

  const start = performance.now();
  for (let i = 0; i < 200; i++) {
    enforceDictationFidelity(original, candidate);
  }
  const avg = (performance.now() - start) / 200;

  // Each call should be well under 5 ms — it is pure string manipulation.
  assert.ok(avg < 5, `Average call time ${avg.toFixed(3)} ms exceeded 5 ms threshold`);
});
