/** Solana network a plan settles on. */
export type Network = "solana" | "solana-devnet";

export type PlanStatus = "active" | "inactive";
export type SubscriptionStatus = "active" | "canceled" | "past_due";

/** A published subscription plan (merchant side). */
export interface Plan {
  planId: string;
  userId: string;
  name: string;
  amountBaseUnits: string;
  periodHours: number;
  merchantWallet: string;
  network: Network;
  mint: string;
  onchainPlanAddress: string;
  onchainOwner: string;
  linkedApiId?: string | null;
  metadataUri?: string;
  webhookUrl?: string | null;
  /** Returned to the plan owner only — use it to verify webhook signatures. */
  webhookSecret?: string | null;
  feeBps?: number;
  feeWallet?: string;
  status: PlanStatus;
  createdAt: string;
}

/** Public, non-sensitive view of a plan (for a subscribe page). */
export type PlanMeta = Pick<
  Plan,
  "planId" | "name" | "amountBaseUnits" | "periodHours" | "network" | "mint" | "merchantWallet" | "onchainPlanAddress" | "metadataUri"
>;

export interface CreatePlanParams {
  name: string;
  /** Per-period charge. Provide EITHER `amountUsdc` (e.g. 5 = $5) OR `amountBaseUnits`. */
  amountUsdc?: number;
  amountBaseUnits?: string | number;
  /** Billing cadence in hours. Minimum 1 (hourly). e.g. 720 ≈ monthly. */
  periodHours: number;
  /** Solana wallet that receives the payouts. */
  merchantWallet: string;
  network?: Network;
  /** Link the plan to a RelAI marketplace API → subscribers skip the per-call 402. */
  linkedApiId?: string | null;
  /** Receive signed events (subscription.created/charged/payment_failed/canceled). */
  webhookUrl?: string | null;
  metadataUri?: string;
  /** Unix seconds; 0 = open-ended. */
  endTs?: number;
}

export interface Subscription {
  subscriptionId: string;
  planId: string;
  subscriberWallet: string;
  merchantWallet: string;
  network: Network;
  amountBaseUnits: string;
  periodHours: number;
  status: SubscriptionStatus;
  currentPeriodIndex: number;
  nextChargeTs: number;
  onchainSubscriptionAddress: string;
  lastChargeSig?: string | null;
  createdAt: string;
}

export interface SubscriptionStatusResult {
  active: boolean;
  status?: SubscriptionStatus;
  planId?: string;
  planActive?: boolean;
  subscriptionId?: string;
  currentPeriodIndex?: number;
  nextChargeTs?: number;
  amountBaseUnits?: string;
  periodHours?: number;
  reason?: string;
}

/** Returned by `subscribe.prepare` — a two-stage, wallet-signed flow. */
export interface PrepareSubscribeResult {
  /** `init-authority` first (one-time per wallet+mint), then `subscribe`. */
  stage: "init-authority" | "subscribe";
  /** Base64 unsigned transaction for the subscriber's wallet to sign + broadcast. */
  wireTransaction: string;
  subscriptionPda?: string;
  planPda?: string;
}

export interface ChargeRecord {
  subscriptionId: string;
  subscriberWallet: string;
  periodIndex: number;
  amount: string;
  merchantAmount?: string;
  feeAmount?: string;
  signature?: string | null;
  status: "success" | "failed";
  error?: string;
  ts?: number;
  chargedAt?: string;
}

export interface PlanRevenue {
  planId: string;
  name: string;
  status: PlanStatus;
  amountBaseUnits: string;
  periodHours: number;
  activeSubscribers: number;
  totalSubscribers: number;
  pastDue: number;
  mrrBaseUnits: string;
  collectedBaseUnits: string;
  feesBaseUnits: string;
  chargeCount: number;
}

export interface RevenueSummary {
  activeSubscribers: number;
  totalSubscribers: number;
  pastDue: number;
  mrrBaseUnits: string;
  collectedBaseUnits: string;
  feesBaseUnits: string;
  plans: PlanRevenue[];
}

// ── Webhooks ────────────────────────────────────────────────────────────────

export type WebhookEventType =
  | "subscription.created"
  | "subscription.charged"
  | "subscription.payment_failed"
  | "subscription.canceled";

export interface WebhookEventData {
  subscriptionId: string;
  planId: string;
  subscriberWallet: string;
  merchantWallet: string;
  status: SubscriptionStatus;
  currentPeriodIndex: number;
  nextChargeTs: number;
  amountBaseUnits: string;
  periodHours: number;
  onchainSubscriptionAddress: string;
  // present on subscription.charged
  amount?: string;
  merchantAmount?: string;
  feeAmount?: string;
  feeBps?: number;
  signature?: string;
  periodIndex?: number;
  // present on subscription.payment_failed
  error?: string;
}

export interface WebhookEvent {
  type: WebhookEventType;
  planId: string;
  data: WebhookEventData;
  sentAt: string;
}
