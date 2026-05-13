# Web App Agent Task: New Feature Routes

The desktop Electron app has been updated with three new sidebar buttons and a referral modal.
You need to implement the matching backend and frontend routes on the web app side.

---

## 1. `/help` — Help page

**What the desktop app does:** Opens `https://dictafun.com/help` in the browser when the user clicks the "Help" button in the sidebar.

**What you need to build:**
- A public `/help` page (no authentication required).
- Content: FAQs, getting-started guide, hotkey reference, troubleshooting tips, and a contact/support link.
- Recommended: use your existing docs or Intercom/Crisp widget if available; otherwise a static FAQ layout is fine.
- The page should be indexable by search engines.

---

## 2. `/feedback` — Feedback page

**What the desktop app does:** Opens `https://dictafun.com/feedback` in the browser when the user clicks the "Feedback" button in the sidebar.

**What you need to build:**
- A public `/feedback` page (or redirect to your existing feedback tool, e.g. Canny, Typeform, Linear).
- If building natively: a simple form with fields for:
  - Feedback type (Bug report / Feature request / General)
  - Message (textarea)
  - Optional: user email (pre-populated if session exists)
  - Submit button — POSTs to your feedback API endpoint.
- On success, show a thank-you message.
- If you have an existing feedback widget already embedded site-wide, a redirect to that URL is acceptable.

---

## 3. `/referral` — Referral programme

The desktop app shows a **three-tab modal** — Refer / Past invites / Apply referral — and calls four API endpoints. Implement all of them.

### Reward logic (important)
- The **referee** gets 1 free month of Pro immediately on subscribing (Paddle discount coupon).
- The **referrer** earns 1 free month only after the referee dictates **2,000 words** (verified via the `transcriptions` table word-count). The reward is then auto-applied to the referrer's next Paddle subscription payment.
- Both rewards must be idempotent — re-processing the same referral must not grant a second month.

### 3a. Referral code generation
- Each user has one stable referral code, created on first `GET /api/referral/link` and stored in a `referral_codes` table (`userId`, `code` — short alphanumeric, e.g. `r/KENN42`).
- `GET /api/referral/link` (authenticated) → `{ referralUrl: "https://dictafun.com/r/{code}", referralCode: "{code}" }`

### 3b. Referral status (used by Past invites tab)
- `GET /api/referral/status` (authenticated) →
  ```json
  {
    "referralUrl": "https://dictafun.com/r/KENN42",
    "totalInvites": 3,
    "rewardsEarned": 1,
    "invites": [
      { "email": "friend@example.com", "sentAt": "2026-05-01T10:00:00Z", "status": "rewarded" },
      { "email": "other@example.com",  "sentAt": "2026-05-10T08:00:00Z", "status": "signed_up" },
      { "email": "third@example.com",  "sentAt": "2026-05-11T09:00:00Z", "status": "pending" }
    ]
  }
  ```
  Invite statuses: `pending` (email sent, no sign-up yet) → `signed_up` (referee created account) → `rewarded` (referee hit 2,000 words, referrer got their free month).

### 3c. Send invite email
- `POST /api/referral/invite` (authenticated) — body: `{ "email": "friend@example.com" }`.
- Validate email format. Check the daily rate limit (max 10 invites/user/day).
- Write a row to `referral_invites` (`referrerId`, `email`, `sentAt`, `status: "pending"`).
- Send transactional email: "Your friend {agentName} invited you to try Dicta Fun. You'll get your first month of Pro free. Sign up here: {referralUrl}"
- Return `{ "ok": true }`.

### 3d. Apply a referral code (Apply referral tab)
- `POST /api/referral/apply` (authenticated) — body: `{ "code": "KENN42" }`.
- Look up the code in `referral_codes`. Reject if: code doesn't exist, referrer is the same user, this user has already applied a referral code.
- Mark the invite row as `signed_up` (or create one if the referrer sent no email invite).
- Apply a Paddle discount to the applying user's next checkout / subscription for 1 free month.
- Return `{ "ok": true }` on success, appropriate error message on failure.

### 3e. Referral landing page
- `GET /r/:code` — public page that sets a `ref={code}` cookie (30-day expiry, HttpOnly, SameSite=Lax) and redirects to `/signup`.
- On successful subscription, read the `ref` cookie to trigger the `POST /api/referral/apply` flow server-side.

### 3f. Word-count webhook / background job
- After each transcription is saved, check whether the referee (the applier) has now reached 2,000 total words.
- If yes and the referrer has not yet been rewarded: apply a Paddle one-month discount to the referrer's subscription and set the invite status to `rewarded`.

### 3g. `/referral` web page
- Authenticated users see the same three-tab UI described above (mirroring the desktop modal). Pre-populate it with data from `GET /api/referral/status`.
- Unauthenticated users → redirect to `/signin?next=/referral`.

---

## Route summary

| Route | Auth required | Purpose |
|---|---|---|
| `GET /help` | No | Help/FAQ page |
| `GET /feedback` | No | Feedback form |
| `GET /referral` | Yes (redirect to sign-in) | Referral dashboard (3-tab UI) |
| `GET /r/:code` | No | Referral landing → sets cookie → redirects to /signup |
| `GET /api/referral/link` | Yes | Returns user's referral code + URL |
| `GET /api/referral/status` | Yes | Returns invite list with statuses + reward count |
| `POST /api/referral/invite` | Yes | Sends invite email, rate-limited 10/day |
| `POST /api/referral/apply` | Yes | Applies a referral code, grants 1 month Pro |

---

## Notes

- Keep the existing `GET /terms` and `GET /privacy` routes — they are still linked from the desktop Settings › Privacy tab.
- The desktop app calls `GET /signup` from the onboarding flow; make sure the `ref` cookie set by `/r/:code` persists through the signup funnel.
- The desktop app calls `GET /pricing` for the upgrade flow — no changes needed there; your existing Paddle checkout flow applies.
