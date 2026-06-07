import crypto from "node:crypto";
import { WebhookSignatureError } from "./errors.js";
import type { WebhookEvent } from "./types.js";

export const SIGNATURE_HEADER = "x-relai-signature";
export const EVENT_HEADER = "x-relai-event";
export const DELIVERY_HEADER = "x-relai-delivery";

function hmac(secret: string, payload: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verify a webhook signature. `rawBody` MUST be the exact bytes received
 * (string or Buffer) — not a re-serialized JSON object.
 */
export function verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const payload = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  return timingSafeEqual(signatureHeader, hmac(secret, payload));
}

/**
 * Verify + parse a webhook into a typed `WebhookEvent`. Throws
 * `WebhookSignatureError` if the signature is invalid.
 */
export function constructEvent(rawBody: string | Buffer, signatureHeader: string | undefined, secret: string): WebhookEvent {
  if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) {
    throw new WebhookSignatureError();
  }
  const payload = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  return JSON.parse(payload) as WebhookEvent;
}

// ── Express/Connect middleware ───────────────────────────────────────────────

type Headers = Record<string, string | string[] | undefined>;
interface ReqLike {
  headers: Headers;
  body?: unknown;
  on?: (event: string, cb: (chunk: Buffer) => void) => void;
}
interface ResLike {
  status: (code: number) => ResLike;
  json: (body: unknown) => unknown;
  end: (body?: unknown) => unknown;
}
type NextLike = (err?: unknown) => void;

export interface WebhookHandlers {
  /** Fires for every verified event (before the type-specific handler). */
  onEvent?: (event: WebhookEvent) => void | Promise<void>;
  onCreated?: (event: WebhookEvent) => void | Promise<void>;
  onCharged?: (event: WebhookEvent) => void | Promise<void>;
  onPaymentFailed?: (event: WebhookEvent) => void | Promise<void>;
  onCanceled?: (event: WebhookEvent) => void | Promise<void>;
  /** Called on signature/parse failure (defaults to a 401/400 response). */
  onError?: (err: unknown, req: ReqLike, res: ResLike) => void;
}

function readRawBody(req: ReqLike): Promise<string> {
  // already buffered (express.raw / a Buffer / string)?
  if (typeof req.body === "string") return Promise.resolve(req.body);
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString("utf8"));
  // otherwise read the stream ourselves
  return new Promise((resolve, reject) => {
    if (!req.on) {
      reject(new Error("Cannot read raw body: mount the webhook middleware BEFORE any JSON body parser, or use express.raw()."));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject as (chunk: Buffer) => void);
  });
}

function headerValue(h: Headers, key: string): string | undefined {
  const v = h[key] ?? h[key.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Express/Connect middleware that verifies the signature and dispatches typed
 * handlers. Mount it BEFORE any JSON body parser so the raw bytes are intact.
 *
 *   app.post("/relai-webhook", relai.webhooks.middleware(secret, {
 *     onCharged: (e) => provision(e.data.subscriberWallet),
 *     onPaymentFailed: (e) => suspend(e.data.subscriberWallet),
 *   }))
 */
export function createWebhookMiddleware(secret: string, handlers: WebhookHandlers) {
  return async (req: ReqLike, res: ResLike, _next: NextLike): Promise<void> => {
    let event: WebhookEvent;
    try {
      const raw = await readRawBody(req);
      event = constructEvent(raw, headerValue(req.headers, SIGNATURE_HEADER), secret);
    } catch (err) {
      if (handlers.onError) return void handlers.onError(err, req, res);
      const code = err instanceof WebhookSignatureError ? 401 : 400;
      res.status(code).json({ error: (err as Error)?.message ?? "webhook error" });
      return;
    }
    try {
      await handlers.onEvent?.(event);
      if (event.type === "subscription.created") await handlers.onCreated?.(event);
      else if (event.type === "subscription.charged") await handlers.onCharged?.(event);
      else if (event.type === "subscription.payment_failed") await handlers.onPaymentFailed?.(event);
      else if (event.type === "subscription.canceled") await handlers.onCanceled?.(event);
      res.status(200).json({ received: true });
    } catch (err) {
      // Handler threw — 500 so RelAI retries the delivery.
      res.status(500).json({ error: (err as Error)?.message ?? "handler error" });
    }
  };
}
