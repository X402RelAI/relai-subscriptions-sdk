# @relai-fi/subscriptions

TypeScript SDK for **RelAI subscriptions** — recurring USDC billing on Solana, built on Solana's
native subscriptions program. Create plans, run the subscribe flow, verify signed webhooks, and gate
access with one middleware.

- **Non-custodial** — funds settle wallet-to-wallet, straight to the merchant.
- **Zero runtime dependencies** — uses global `fetch` + Node `crypto`.
- **ESM + CJS**, fully typed.

```bash
npm install @relai-fi/subscriptions
```

> Requires Node 18+. Get a RelAI service key at [relai.fi](https://relai.fi) and read the
> [docs](https://relai.fi/documentation/subscriptions).

---

## Quick start

```ts
import { RelaiSubscriptions } from "@relai-fi/subscriptions";

const relai = new RelaiSubscriptions({ apiKey: process.env.RELAI_KEY });
```

### Create a plan (merchant)

```ts
const plan = await relai.plans.create({
  name: "Pro",
  amountUsdc: 5,          // or amountBaseUnits: "5000000"
  periodHours: 720,       // ≈ monthly (minimum 1 = hourly)
  merchantWallet: "<your-solana-wallet>",
  network: "solana",      // or "solana-devnet" to test
  webhookUrl: "https://your-app.com/relai-webhook",
});

// Share the subscribe link:
const url = `https://relai.fi/subscribe?plan=${plan.planId}`;

// Keep plan.webhookSecret — you need it to verify webhooks.
```

Other merchant calls:

```ts
await relai.plans.list();
await relai.plans.deactivate(plan.planId);
await relai.plans.subscribers(plan.planId);   // { subscriptions, summary }
await relai.plans.charges(plan.planId);        // charge history
await relai.revenue();                         // MRR, collected, fees, past-due
```

### Subscribe flow (the subscriber's wallet signs)

Two stages: the on-chain `subscribe` needs the wallet's delegate authority to exist first.

```ts
const wallet = "<subscriber-wallet>";

let prep = await relai.subscribe.prepare(plan.planId, wallet);
if (prep.stage === "init-authority") {
  await signAndSend(prep.wireTransaction);     // your wallet signs the base64 tx
  prep = await relai.subscribe.prepare(plan.planId, wallet);
}
const sig = await signAndSend(prep.wireTransaction);
await relai.subscribe.confirm(plan.planId, wallet, sig);
```

(`signAndSend` is your own wallet-adapter code: deserialize the base64 tx, sign, broadcast.)

### Cancel

```ts
const { wireTransaction } = await relai.subscriptions.prepareCancel(subscriptionId);
const sig = await signAndSend(wireTransaction);   // subscriber signs
await relai.subscriptions.confirmCancel(subscriptionId);
```

---

## Webhooks

Set `webhookUrl` on the plan, then receive signed events. Mount the middleware **before** any JSON
body parser (the signature is over the raw bytes).

```ts
import express from "express";
const app = express();

app.post(
  "/relai-webhook",
  relai.webhooks.middleware(process.env.RELAI_WEBHOOK_SECRET!, {
    onCharged:       (e) => provision(e.data.subscriberWallet),
    onPaymentFailed: (e) => suspend(e.data.subscriberWallet),
    onCanceled:      (e) => suspend(e.data.subscriberWallet),
    onCreated:       (e) => welcome(e.data.subscriberWallet),
  })
);

app.use(express.json()); // other routes after the webhook
```

Events: `subscription.created`, `subscription.charged`, `subscription.payment_failed`,
`subscription.canceled`. The middleware replies `200` on success, `401` on a bad signature, and
`500` if your handler throws (so RelAI retries).

Verify manually (any framework):

```ts
import { constructEvent } from "@relai-fi/subscriptions";
const event = constructEvent(rawBody, req.headers["x-relai-signature"], secret); // throws if invalid
```

---

## Gate a service on a subscription

One middleware to protect a route — a web app, an API, a VM control endpoint:

```ts
app.get(
  "/premium",
  relai.requireSubscription(plan.planId, {
    getWallet: (req) => req.headers["x-wallet"] as string, // however you know the user's wallet
    // onDenied: (req, res) => res.redirect("/subscribe"),  // optional
  }),
  (req, res) => res.send("welcome, subscriber")
);
```

Or check status directly:

```ts
const { active } = await relai.status(plan.planId, wallet);
```

---

## API

| Call | Auth | Description |
|---|---|---|
| `plans.create(params)` | key | Publish a plan on-chain |
| `plans.list()` | key | Your plans |
| `plans.deactivate(planId)` | key | Stop new subscribers |
| `plans.subscribers(planId)` | key | Subscribers + summary |
| `plans.charges(planId)` | key | Charge history |
| `plans.meta(planId)` | public | Public plan terms |
| `revenue()` | key | MRR / collected / fees / past-due |
| `status(planId, wallet)` | public | Is the wallet subscribed? |
| `subscribe.prepare(planId, wallet)` | public | Next unsigned subscribe tx |
| `subscribe.confirm(planId, wallet, sig)` | public | Confirm after broadcast |
| `subscriptions.prepareCancel(id)` | key | Unsigned cancel tx |
| `subscriptions.confirmCancel(id)` | key | Mark canceled |
| `webhooks.middleware(secret, handlers)` | — | Express webhook receiver |
| `webhooks.constructEvent(raw, sig, secret)` | — | Verify + parse an event |
| `requireSubscription(planId, opts)` | — | Express access gate |

Amounts are token base units (USDC = 6 decimals): `5000000` = `$5.00`. `plans.create` accepts
`amountUsdc` as a convenience.

## License

MIT
