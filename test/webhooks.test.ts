import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import {
  verifyWebhookSignature,
  constructEvent,
  createWebhookMiddleware,
  WebhookSignatureError,
  type WebhookEvent,
} from "../src/index.js";

const secret = "whsec_test";
const event: WebhookEvent = {
  type: "subscription.charged",
  planId: "P",
  data: {
    subscriptionId: "S",
    planId: "P",
    subscriberWallet: "WALLET",
    merchantWallet: "M",
    status: "active",
    currentPeriodIndex: 1,
    nextChargeTs: 123,
    amountBaseUnits: "5000000",
    periodHours: 720,
    onchainSubscriptionAddress: "sub",
    merchantAmount: "4750000",
    feeAmount: "250000",
  },
  sentAt: "2026-01-01T00:00:00.000Z",
};
const body = JSON.stringify(event);
const sign = (b: string, s: string) => "sha256=" + crypto.createHmac("sha256", s).update(b).digest("hex");

function mockRes() {
  const out: { code: number; body: unknown } = { code: 0, body: undefined };
  const res = {
    status(c: number) { out.code = c; return res; },
    json(b: unknown) { out.body = b; return res; },
    end() { return res; },
  };
  return { res, out };
}

describe("verifyWebhookSignature", () => {
  it("accepts a valid signature", () => {
    expect(verifyWebhookSignature(body, sign(body, secret), secret)).toBe(true);
  });
  it("rejects a bad signature, wrong secret, or missing header", () => {
    expect(verifyWebhookSignature(body, "sha256=deadbeef", secret)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, "other"), secret)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
  });
  it("works with a Buffer body", () => {
    expect(verifyWebhookSignature(Buffer.from(body), sign(body, secret), secret)).toBe(true);
  });
});

describe("constructEvent", () => {
  it("verifies + parses a typed event", () => {
    const e = constructEvent(body, sign(body, secret), secret);
    expect(e.type).toBe("subscription.charged");
    expect(e.data.merchantAmount).toBe("4750000");
  });
  it("throws WebhookSignatureError on a bad signature", () => {
    expect(() => constructEvent(body, "sha256=bad", secret)).toThrow(WebhookSignatureError);
  });
});

describe("createWebhookMiddleware", () => {
  it("dispatches the typed handler and replies 200", async () => {
    const onCharged = vi.fn();
    const onEvent = vi.fn();
    const mw = createWebhookMiddleware(secret, { onCharged, onEvent });
    const { res, out } = mockRes();
    await mw({ headers: { "x-relai-signature": sign(body, secret) }, body }, res, () => {});
    expect(onEvent).toHaveBeenCalledOnce();
    expect(onCharged).toHaveBeenCalledOnce();
    expect(onCharged.mock.calls[0]![0].data.subscriberWallet).toBe("WALLET");
    expect(out.code).toBe(200);
    expect(out.body).toEqual({ received: true });
  });

  it("replies 401 on a bad signature and skips handlers", async () => {
    const onCharged = vi.fn();
    const mw = createWebhookMiddleware(secret, { onCharged });
    const { res, out } = mockRes();
    await mw({ headers: { "x-relai-signature": "sha256=bad" }, body }, res, () => {});
    expect(onCharged).not.toHaveBeenCalled();
    expect(out.code).toBe(401);
  });

  it("replies 500 when a handler throws (so RelAI retries)", async () => {
    const mw = createWebhookMiddleware(secret, {
      onCharged: () => { throw new Error("db down"); },
    });
    const { res, out } = mockRes();
    await mw({ headers: { "x-relai-signature": sign(body, secret) }, body }, res, () => {});
    expect(out.code).toBe(500);
  });
});
