# Pricing Model

Guide for Electron app integration with backend billing system.

## Plans

Three tiers with monthly and yearly billing:

- **Free**: No cost, core features only, unlimited usage
- **Starter**: Monthly or yearly subscription, additional features
- **Pro**: Monthly or yearly subscription, premium features

Price IDs are configured in backend via `PADDLE_PRICE_*` env vars. See [DEPLOYMENT.md](DEPLOYMENT.md) for production/sandbox price ID setup.

## Billing Status

Profile contains two billing fields:

```typescript
billingPlan: "free" | "starter" | "pro"
billingStatus: "active" | "inactive" | "paused" | "past_due" | "cancelled"
```

**Active plan states:**
- `billingStatus === "active"` → User has a valid, current subscription
- `billingStatus === "inactive"` → User never subscribed or subscription ended
- `billingStatus === "paused"` → User paused (Paddle pause event)
- `billingStatus === "past_due"` → Payment failed, retry pending
- `billingStatus === "cancelled"` → User cancelled subscription

## Feature Gating

The Electron app determines which features to unlock based on the user's plan and status.

### Example: Feature availability by plan

```javascript
// Electron app logic (pseudo-code)
const canUseFeature = (feature, billingPlan, billingStatus) => {
  // Only active paid plans unlock premium features
  const isPremium = billingStatus === "active" && (billingPlan === "starter" || billingPlan === "pro");
  const isPro = billingStatus === "active" && billingPlan === "pro";

  switch (feature) {
    case "export_to_pdf":
      return isPremium;
    case "advanced_analytics":
      return isPro;
    case "api_access":
      return isPro;
    default:
      return true; // Free features available to all
  }
};
```

## API Endpoints

### Get current user and profile

```http
GET /auth/me
Authorization: Bearer <supabase-access-token>
```

**Response:**

```json
{
  "user": {
    "id": "user-uuid",
    "email": "user@example.com",
    "createdAt": "2025-05-01T00:00:00Z"
  },
  "profile": {
    "id": "profile-uuid",
    "userId": "user-uuid",
    "email": "user@example.com",
    "displayName": "User Name",
    "avatarUrl": null,
    "billingPlan": "free",
    "billingStatus": "inactive",
    "paddleCustomerId": null,
    "paddleSubscriptionId": null,
    "createdAt": "2025-05-01T00:00:00Z",
    "updatedAt": "2025-05-01T00:00:00Z"
  }
}
```

### Get profile only

```http
GET /profile
Authorization: Bearer <supabase-access-token>
```

Same profile object as above.

### Initiate checkout

```http
POST /billing/checkout
Authorization: Bearer <supabase-access-token>
Content-Type: application/json

{
  "plan": "starter",
  "interval": "monthly"
}
```

**Response:**

```json
{
  "transactionId": "paddle-transaction-id",
  "checkoutUrl": "https://checkout.paddle.com/p/...",
  "plan": "starter",
  "interval": "monthly"
}
```

Electron app opens `checkoutUrl` in browser or Paddle checkout embed. After user completes payment, Paddle redirects to `PADDLE_CHECKOUT_URL` (default: `https://dictafun.com/checkout`) with `sessionId` param. Backend receives webhook and updates profile billing fields.

### Get Paddle client config

```http
GET /billing/client-config
```

**Response:**

```json
{
  "environment": "sandbox",
  "clientToken": "paddle-client-side-token"
}
```

Used if Electron embeds Paddle client SDK directly instead of redirecting to browser checkout.

## Auth Flow

1. **Login/signup**: User authenticates via Supabase Auth in web app or Electron app
2. **Access token**: Supabase returns `access_token` and `refresh_token`
3. **Backend calls**: Electron app includes `Authorization: Bearer <access_token>` in all API requests
4. **Profile check**: On app start, call `GET /auth/me` to load user's current plan and billing status
5. **Feature gates**: Render UI based on `billingPlan` and `billingStatus`

## Webhook Flow (Backend Only)

When user completes Paddle checkout, Paddle sends webhook to `https://api.dictafun.com/billing/webhook`.

Backend verifies `Paddle-Signature` header, extracts billing data from event, and updates profile:

- Sets `billingPlan` (from `custom_data.plan`)
- Sets `billingStatus` (from transaction/subscription `status`)
- Sets `paddleCustomerId` and `paddleSubscriptionId`

Electron app learns about plan changes on next `GET /auth/me` call (or realtime sync if WebSocket is added later).

## Subscription Lifecycle

### New subscription (user upgrades from free)

1. User clicks "Upgrade" in Electron app
2. App calls `POST /billing/checkout` with plan/interval
3. App opens checkout URL in browser
4. User completes payment in Paddle
5. Paddle sends webhook to backend
6. Backend updates profile: `billingPlan="starter"`, `billingStatus="active"`
7. Next time user calls `GET /auth/me`, app loads new plan and unlocks features

### Renew/retry (subscription active)

- No action needed; Paddle automatically renews on billing date
- Webhook updates profile on renewal or failure (past_due)

### Cancel/pause

- User cancels in Paddle customer portal (or Paddle dashboard)
- Paddle sends webhook to backend
- Backend sets `billingStatus` to `cancelled` or `paused`
- Next `GET /auth/me` call sees inactive status; app reverts to free tier

## Implementation Checklist for Electron

- [ ] On app launch, call `GET /auth/me` to fetch user profile
- [ ] Store `billingPlan` and `billingStatus` in app state
- [ ] Compare profile billing against feature requirements; unlock/lock UI accordingly
- [ ] On upgrade click, call `POST /billing/checkout`
- [ ] Open checkout URL in browser or embedded Paddle client
- [ ] On return to app (or periodic poll), refresh profile via `GET /auth/me`
- [ ] Display current plan and renewal date in settings (parse `paddleSubscriptionId` via Paddle API if needed, or store `updatedAt` timestamp)
- [ ] Handle offline: cache last known plan; warn user if app can't reach backend for 24+ hours

## Local Development

- Backend: `DATABASE_DRIVER=sqlite`, `PADDLE_ENVIRONMENT=sandbox`
- Sandbox price IDs: Get from Paddle dashboard under Development
- Test checkout: Use Paddle test card `4111 1111 1111 1111` with any future expiry
- Webhook testing: Use Paddle's webhook simulator or ngrok tunnel to replay events locally

## Production

- Backend: `DATABASE_DRIVER=supabase`, `PADDLE_ENVIRONMENT=production`
- Production price IDs configured in backend env vars
- Real Paddle credentials in backend env vars
- Webhook endpoint: `https://api.dictafun.com/billing/webhook`
- Electron app points to `https://api.dictafun.com` via env var
