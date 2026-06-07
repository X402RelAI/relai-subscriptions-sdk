/**
 * Runnable example: an Express backend that uses @relai-fi/subscriptions to
 *  - create a plan
 *  - receive signed webhooks and provision/suspend a "service" accordingly
 *  - gate a premium route on an active subscription
 *
 * Run:  npm install && npm start   (from this examples/ folder)
 * Env:  RELAI_KEY (service key), RELAI_WEBHOOK_SECRET (returned when you create a plan),
 *       RELAI_PLAN_ID (a plan to gate on), MERCHANT_WALLET, RELAI_BASE_URL (optional).
 */
import express from "express";
import { RelaiSubscriptions } from "@relai-fi/subscriptions";

const relai = new RelaiSubscriptions({
  apiKey: process.env.RELAI_KEY,
  baseUrl: process.env.RELAI_BASE_URL, // omit for https://api.relai.fi
});

const app = express();

// In-memory "infrastructure" this server provisions per subscriber wallet.
const provisioned = new Set<string>();

// 1) Webhook receiver — MOUNT BEFORE express.json() so the raw body is intact.
app.post(
  "/relai-webhook",
  relai.webhooks.middleware(process.env.RELAI_WEBHOOK_SECRET ?? "set-me", {
    onCreated: (e) => console.log("created:", e.data.subscriberWallet),
    onCharged: (e) => {
      provisioned.add(e.data.subscriberWallet);
      console.log("charged → provisioned:", e.data.subscriberWallet, e.data.merchantAmount, "USDC");
    },
    onPaymentFailed: (e) => {
      provisioned.delete(e.data.subscriberWallet);
      console.log("payment_failed → suspended:", e.data.subscriberWallet);
    },
    onCanceled: (e) => {
      provisioned.delete(e.data.subscriberWallet);
      console.log("canceled → suspended:", e.data.subscriberWallet);
    },
  })
);

app.use(express.json());

// 2) Create a plan (returns the subscribe link + the webhook secret to save).
app.post("/plans", async (_req, res) => {
  try {
    const plan = await relai.plans.create({
      name: "Pro",
      amountUsdc: 5,
      periodHours: 720, // monthly (use 1 for hourly while testing)
      merchantWallet: process.env.MERCHANT_WALLET ?? "<your-solana-wallet>",
      network: "solana-devnet",
      webhookUrl: `${process.env.PUBLIC_URL ?? "http://localhost:3000"}/relai-webhook`,
    });
    res.json({
      planId: plan.planId,
      subscribeUrl: `https://relai.fi/subscribe?plan=${plan.planId}`,
      webhookSecret: plan.webhookSecret, // store this in RELAI_WEBHOOK_SECRET
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 3) Gate a premium route on an active subscription.
app.get(
  "/premium",
  relai.requireSubscription(process.env.RELAI_PLAN_ID ?? "set-me", {
    getWallet: (req) => (req.headers["x-wallet"] as string) || undefined,
    onDenied: (_req, res) => res.status(402).json({ error: "subscribe at relai.fi/subscribe" }),
  }),
  (_req, res) => res.json({ ok: true, secret: "🎉 premium content" })
);

// 4) Check a wallet's status + whether this server provisioned it.
app.get("/status/:wallet", async (req, res) => {
  const status = await relai.status(process.env.RELAI_PLAN_ID ?? "set-me", req.params.wallet);
  res.json({ ...status, provisionedHere: provisioned.has(req.params.wallet) });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`example listening on http://localhost:${port}`));
