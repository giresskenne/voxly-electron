import type { EntitlementStatus, WeeklyUsageStatus } from "../types";

export const FREE_WEEKLY_WORD_LIMIT = 2_000;
const FREE_WEEKLY_WARNING_RATIO = 0.8;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function buildWeeklyUsageStatus(
  wordsUsed: number,
  entitlement: EntitlementStatus,
  additionalWords = 0,
): WeeklyUsageStatus {
  const normalizedWordsUsed = Math.max(0, Math.round(wordsUsed));
  const projectedWordsUsed = Math.max(0, normalizedWordsUsed + Math.max(0, Math.round(additionalWords)));
  const isLimited = entitlement.billingPlan === "free" || entitlement.billingStatus !== "active";

  if (!isLimited) {
    return {
      wordsUsed: normalizedWordsUsed,
      wordsLimit: null,
      wordsRemaining: null,
      usageRatio: 0,
      isLimited: false,
      isApproachingLimit: false,
      isLimitReached: false,
    };
  }

  const usageRatio = projectedWordsUsed / FREE_WEEKLY_WORD_LIMIT;
  return {
    wordsUsed: normalizedWordsUsed,
    wordsLimit: FREE_WEEKLY_WORD_LIMIT,
    wordsRemaining: Math.max(0, FREE_WEEKLY_WORD_LIMIT - normalizedWordsUsed),
    usageRatio,
    isLimited: true,
    isApproachingLimit: usageRatio >= FREE_WEEKLY_WARNING_RATIO && usageRatio < 1,
    isLimitReached: usageRatio >= 1,
  };
}
