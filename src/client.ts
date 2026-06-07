import { RelaiApiError } from "./errors.js";
import {
  createWebhookMiddleware,
  constructEvent,
  verifyWebhookSignature,
  type WebhookHandlers,
} from "./webhooks.js";
import type {
  CreatePlanParams,
  Plan,
  PlanMeta,
  PrepareSubscribeResult,
  RevenueSummary,
  Subscription,
  SubscriptionStatusResult,
  ChargeRecord,
} from "./types.js";

export interface RelaiSubscriptionsOptions {
  /** RelAI service key / JWT (Bearer) for merchant endpoints. Optional for public-only use. */
  apiKey?: string;
  /** API base URL. Defaults to https://api.relai.fi */
  baseUrl?: string;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
}

type ReqLike = { headers: Record<string, string | string[] | undefined> };
type ResLike = { status: (code: number) => ResLike; json: (b: unknown) => unknown; end: (b?: unknown) => unknown };
type NextLike = (err?: unknown) => void;

export interface RequireSubscriptionOptions {
  /** Extract the subscriber wallet from the request (header, session, query…). */
  getWallet: (req: ReqLike) => string | undefined | Promise<string | undefined>;
  /** Override the default 402 response when access is denied. */
  onDenied?: (req: ReqLike, res: ResLike, status: SubscriptionStatusResult | null) => void;
}

const USDC_DECIMALS = 6;

function toBaseUnits(p: CreatePlanParams): string {
  if (p.amountBaseUnits != null) return String(p.amountBaseUnits);
  if (p.amountUsdc != null) return String(Math.round(p.amountUsdc * 10 ** USDC_DECIMALS));
  throw new Error("createPlan: provide amountUsdc or amountBaseUnits");
}

export class RelaiSubscriptions {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly _fetch: typeof fetch;

  constructor(opts: RelaiSubscriptionsOptions = {}) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.relai.fi").replace(/\/$/, "");
    this._fetch = opts.fetch ?? globalThis.fetch;
    if (!this._fetch) throw new Error("No fetch available — pass `fetch` in options (Node 18+ has it global).");
  }

  private async request<T>(method: string, path: string, opts: { auth?: boolean; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.auth) {
      if (!this.apiKey) throw new Error(`${path} requires an apiKey — set it in the constructor.`);
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    const res = await this._fetch(url.toString(), {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    const json = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const msg = (json as { error?: string })?.error ?? `RelAI ${method} ${path} failed (${res.status})`;
      throw new RelaiApiError(res.status, msg, json ?? text);
    }
    return json as T;
  }

  // ── Plans (merchant — needs apiKey) ────────────────────────────────────────
  readonly plans = {
    /** Create + publish a plan on-chain. */
    create: async (params: CreatePlanParams): Promise<Plan> => {
      const body = {
        name: params.name,
        amountBaseUnits: toBaseUnits(params),
        periodHours: params.periodHours,
        merchantWallet: params.merchantWallet,
        network: params.network,
        linkedApiId: params.linkedApiId ?? null,
        webhookUrl: params.webhookUrl ?? null,
        metadataUri: params.metadataUri,
        endTs: params.endTs,
      };
      const { plan } = await this.request<{ plan: Plan }>("POST", "/subscriptions", { auth: true, body });
      return plan;
    },
    /** List the plans owned by the API key. */
    list: async (): Promise<Plan[]> => {
      const { plans } = await this.request<{ plans: Plan[] }>("GET", "/subscriptions", { auth: true });
      return plans;
    },
    /** Deactivate a plan (no new subscribers; existing ones keep their on-chain delegation). */
    deactivate: async (planId: string): Promise<Plan> => {
      const { plan } = await this.request<{ plan: Plan }>("POST", `/subscriptions/${encodeURIComponent(planId)}/deactivate`, { auth: true });
      return plan;
    },
    /** Subscribers + summary for a plan. */
    subscribers: async (planId: string): Promise<{ plan: Plan; subscriptions: Subscription[]; summary: { total: number; active: number } }> =>
      this.request("GET", `/subscriptions/${encodeURIComponent(planId)}/subscribers`, { auth: true }),
    /** Charge history for a plan. */
    charges: async (planId: string): Promise<ChargeRecord[]> => {
      const { charges } = await this.request<{ charges: ChargeRecord[] }>("GET", `/subscriptions/${encodeURIComponent(planId)}/charges`, { auth: true });
      return charges;
    },
    /** Public, non-sensitive plan terms (for a subscribe page). */
    meta: (planId: string): Promise<PlanMeta> => this.request("GET", `/s/${encodeURIComponent(planId)}/meta`),
  };

  /** Revenue summary across all of the API key's plans (MRR, collected, fees…). */
  revenue(): Promise<RevenueSummary> {
    return this.request("GET", "/subscriptions/revenue", { auth: true });
  }

  /** Is `wallet` actively subscribed to `planId`? (public — gate your own service with this) */
  status(planId: string, wallet: string): Promise<SubscriptionStatusResult> {
    return this.request("GET", `/s/${encodeURIComponent(planId)}/status`, { query: { wallet } });
  }

  // ── Subscribe flow (public — subscriber's wallet signs) ─────────────────────
  readonly subscribe = {
    /**
     * Build the next unsigned transaction the subscriber must sign. Two-stage:
     * call it, sign+broadcast the returned tx; if `stage === "init-authority"`,
     * call again to get the `subscribe` tx, then `confirm`.
     */
    prepare: (planId: string, subscriberWallet: string): Promise<PrepareSubscribeResult> =>
      this.request("POST", `/s/${encodeURIComponent(planId)}/subscribe`, { body: { subscriberWallet } }),
    /** Confirm a subscribe after the signed tx is broadcast. */
    confirm: async (planId: string, subscriberWallet: string, signature: string): Promise<Subscription> => {
      const { subscription } = await this.request<{ subscription: Subscription }>("POST", `/s/${encodeURIComponent(planId)}/confirm`, {
        body: { subscriberWallet, signature },
      });
      return subscription;
    },
  };

  // ── Cancel (merchant-initiated build of the subscriber-signed cancel tx) ─────
  readonly subscriptions = {
    /** Build the unsigned cancel transaction (the subscriber signs it). */
    prepareCancel: (subscriptionId: string): Promise<{ wireTransaction: string }> =>
      this.request("POST", `/subscriptions/subscription/${encodeURIComponent(subscriptionId)}/cancel`, { auth: true }),
    /** Mark a subscription canceled after the cancel tx is broadcast. */
    confirmCancel: async (subscriptionId: string): Promise<Subscription> => {
      const { subscription } = await this.request<{ subscription: Subscription }>(
        "POST",
        `/subscriptions/subscription/${encodeURIComponent(subscriptionId)}/cancel/confirm`,
        { auth: true },
      );
      return subscription;
    },
  };

  // ── Webhooks (verify + Express middleware) ──────────────────────────────────
  readonly webhooks = {
    verify: verifyWebhookSignature,
    constructEvent,
    /** Express/Connect middleware — verifies signature + dispatches typed handlers. */
    middleware: createWebhookMiddleware,
  };

  /**
   * Express/Connect middleware that gates a route on an active subscription.
   *
   *   app.get("/premium", relai.requireSubscription(planId, {
   *     getWallet: (req) => req.headers["x-wallet"],
   *   }), handler)
   */
  requireSubscription(planId: string, opts: RequireSubscriptionOptions) {
    return async (req: ReqLike, res: ResLike, next: NextLike): Promise<void> => {
      const wallet = await opts.getWallet(req);
      const deny = (status: SubscriptionStatusResult | null) => {
        if (opts.onDenied) return opts.onDenied(req, res, status);
        res.status(402).json({ error: "Active subscription required", planId });
      };
      if (!wallet) return void deny(null);
      let status: SubscriptionStatusResult;
      try {
        status = await this.status(planId, wallet);
      } catch {
        return void deny(null);
      }
      if (status.active) return void next();
      deny(status);
    };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
