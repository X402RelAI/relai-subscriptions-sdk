/**
 * Runnable example: the SUBSCRIBER side. Subscribes a Solana keypair to a plan
 * end-to-end (prepare → sign → broadcast → confirm), then prints its status.
 *
 * Run:  npm install && npm run subscribe -- <planId>
 * Env:
 *   SUBSCRIBER_KEYPAIR   path to a Solana keypair JSON file (array of bytes),
 *                        funded with a little SOL + the plan's token (e.g. devnet USDC)
 *   RELAI_PLAN_ID        the plan to subscribe to (or pass as the first arg)
 *   SUBSCRIPTIONS_RPC_URL  Solana RPC (default https://api.devnet.solana.com)
 *   RELAI_BASE_URL       RelAI API base (default https://api.relai.fi)
 */
import fs from "node:fs";
import { Connection, Keypair } from "@solana/web3.js";
import { RelaiSubscriptions } from "@relai-fi/subscriptions";
import { Subscriber } from "@relai-fi/subscriptions/subscriber";

const keypairPath = process.env.SUBSCRIBER_KEYPAIR;
const planId = process.argv[2] ?? process.env.RELAI_PLAN_ID;

if (!keypairPath || !planId) {
  console.error("usage: SUBSCRIBER_KEYPAIR=<keypair.json> npm run subscribe -- <planId>");
  process.exit(2);
}

const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));
const connection = new Connection(process.env.SUBSCRIPTIONS_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const client = new RelaiSubscriptions({ baseUrl: process.env.RELAI_BASE_URL });

const subscriber = Subscriber.fromKeypair({ client, connection, keypair });

console.log("subscriber wallet:", subscriber.wallet);
console.log("subscribing to plan:", planId, "…");

const subscription = await subscriber.subscribe(planId);
console.log("✓ subscribed:", subscription.subscriptionId, "—", subscription.status);

const status = await subscriber.status(planId);
console.log("status:", status);

// To cancel later:
//   await subscriber.cancel(subscription.subscriptionId)
