/**
 * Subscriber-side helpers — the wallet that pays.
 *
 * Subpath: `@relai-fi/subscriptions/subscriber`. Kept out of the main entry so
 * the core SDK stays dependency-free; this module needs `@solana/web3.js`
 * (declared as a peer dependency).
 */
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import type { RelaiSubscriptions } from "./client.js";
import type { Subscription, SubscriptionStatusResult } from "./types.js";

/** Signs a base64 *unsigned* transaction and broadcasts it; resolves to the tx signature. */
export type SignAndSend = (wireTransactionBase64: string) => Promise<string>;

/**
 * Build a `SignAndSend` from a web3.js Connection + Keypair (Node / testing).
 * For a browser wallet, write your own `SignAndSend` around `wallet.signTransaction`.
 */
export function keypairSignAndSend(connection: Connection, keypair: Keypair): SignAndSend {
  return async (wireBase64: string): Promise<string> => {
    const tx = VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64"));
    tx.sign([keypair]);
    const sig = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  };
}

export interface SubscriberOptions {
  client: RelaiSubscriptions;
  /** The subscriber's wallet address (base58). */
  wallet: string;
  /** How to sign + broadcast an unsigned base64 tx. */
  signAndSend: SignAndSend;
  /** Delay after the init-authority tx before re-preparing the subscribe (account visibility). */
  authorityDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Drives the full subscriber flow against the public RelAI endpoints — no api key.
 *
 *   import { Subscriber } from "@relai-fi/subscriptions/subscriber";
 *   const sub = Subscriber.fromKeypair({ client, connection, keypair });
 *   await sub.subscribe(planId);
 */
export class Subscriber {
  private readonly client: RelaiSubscriptions;
  readonly wallet: string;
  private readonly signAndSend: SignAndSend;
  private readonly authorityDelayMs: number;

  constructor(opts: SubscriberOptions) {
    this.client = opts.client;
    this.wallet = opts.wallet;
    this.signAndSend = opts.signAndSend;
    this.authorityDelayMs = opts.authorityDelayMs ?? 2500;
  }

  /** Convenience constructor: derives the wallet + signer from a web3.js Keypair. */
  static fromKeypair(opts: { client: RelaiSubscriptions; connection: Connection; keypair: Keypair; authorityDelayMs?: number }): Subscriber {
    return new Subscriber({
      client: opts.client,
      wallet: opts.keypair.publicKey.toBase58(),
      signAndSend: keypairSignAndSend(opts.connection, opts.keypair),
      authorityDelayMs: opts.authorityDelayMs,
    });
  }

  /**
   * Subscribe to a plan end-to-end: handles the two-stage flow (init authority,
   * then subscribe), signs + broadcasts each tx, and confirms. Returns the
   * persisted subscription.
   */
  async subscribe(planId: string): Promise<Subscription> {
    let prep = await this.client.subscribe.prepare(planId, this.wallet);
    if (prep.stage === "init-authority") {
      await this.signAndSend(prep.wireTransaction);
      await sleep(this.authorityDelayMs);
      prep = await this.client.subscribe.prepare(planId, this.wallet);
    }
    const signature = await this.signAndSend(prep.wireTransaction);
    return this.client.subscribe.confirm(planId, this.wallet, signature);
  }

  /** Cancel a subscription end-to-end (sign the cancel tx + confirm). */
  async cancel(subscriptionId: string): Promise<Subscription> {
    const { wireTransaction } = await this.client.subscriptions.prepareCancel(subscriptionId);
    await this.signAndSend(wireTransaction);
    return this.client.subscriptions.confirmCancel(subscriptionId);
  }

  /** This wallet's status for a plan. */
  status(planId: string): Promise<SubscriptionStatusResult> {
    return this.client.status(planId, this.wallet);
  }
}
