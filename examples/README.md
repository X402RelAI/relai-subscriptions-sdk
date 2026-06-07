# Examples

Two runnable examples for `@relai-fi/subscriptions`:

- **`express-server.ts`** — the merchant/server side: create a plan, receive signed webhooks
  (provision/suspend per subscriber), gate a premium route on an active subscription.
- **`subscribe.ts`** — the subscriber/client side: subscribe a Solana keypair to a plan
  end-to-end (sign + broadcast + confirm), then check status.

## express-server.ts

## Run

From the SDK root, build the package first (the example links it via `file:..`):

```bash
cd ..
npm install && npm run build
cd examples
npm install
npm start            # → http://localhost:3000
```

## Configure

```bash
export RELAI_KEY=sk_...                # your RelAI service key (for /plans)
export MERCHANT_WALLET=<solana-wallet> # where payouts land
# after creating a plan, set these from the response:
export RELAI_PLAN_ID=<planId>
export RELAI_WEBHOOK_SECRET=<webhookSecret>
# optional: export RELAI_BASE_URL=https://api.relai.fi  (default)
```

## Try it

```bash
# create a plan → returns subscribeUrl + webhookSecret (save it)
curl -X POST localhost:3000/plans

# gated route: denied without an active subscription
curl localhost:3000/premium                          # → 402
curl localhost:3000/premium -H "x-wallet: <wallet>"  # → 200 once that wallet subscribes

# status for a wallet
curl localhost:3000/status/<wallet>
```

To receive webhooks locally, expose your port (e.g. `ngrok http 3000`) and use that public URL as the
plan's `webhookUrl` (the example sets it from `PUBLIC_URL`).

> The webhook route is mounted **before** `express.json()` on purpose — the signature is verified
> against the raw request body.

## subscribe.ts (subscriber side)

Subscribe a funded Solana keypair to a plan, end-to-end:

```bash
# keypair JSON = array of bytes (e.g. solana-keygen output), funded with a little
# SOL + the plan's token (devnet USDC for a devnet plan)
export SUBSCRIBER_KEYPAIR=/path/to/keypair.json
export SUBSCRIPTIONS_RPC_URL=https://api.devnet.solana.com   # match the plan's network
npm run subscribe -- <planId>
```

It uses `Subscriber.fromKeypair({ client, connection, keypair })` from
`@relai-fi/subscriptions/subscriber`, which handles the two-stage flow
(init authority → subscribe), signs + broadcasts each tx, and confirms — then prints status.
No api key needed (the subscribe flow is public).
