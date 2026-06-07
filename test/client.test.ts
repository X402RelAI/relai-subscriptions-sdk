import { describe, it, expect, vi } from "vitest";
import { RelaiSubscriptions, RelaiApiError } from "../src/index.js";

type Handler = (url: URL, init: RequestInit) => { status?: number; json: unknown };

function fakeFetch(handler: Handler) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fn = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ url, init });
    const { status = 200, json } = handler(url, init);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const plan = { planId: "P1", name: "Pro", amountBaseUnits: "5000000", status: "active" };

describe("plans.create", () => {
  it("converts amountUsdc → base units, sends Bearer + body", async () => {
    const { fn, calls } = fakeFetch(() => ({ json: { plan } }));
    const relai = new RelaiSubscriptions({ apiKey: "sk_x", fetch: fn });
    const result = await relai.plans.create({ name: "Pro", amountUsdc: 5, periodHours: 720, merchantWallet: "W" });

    expect(result.planId).toBe("P1");
    const call = calls[0]!;
    expect(call.init.method).toBe("POST");
    expect(call.url.pathname).toBe("/subscriptions");
    expect((call.init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk_x");
    const body = JSON.parse(call.init.body as string);
    expect(body.amountBaseUnits).toBe("5000000");
    expect(body.periodHours).toBe(720);
  });

  it("throws without an apiKey on an authed call", async () => {
    const { fn } = fakeFetch(() => ({ json: {} }));
    const relai = new RelaiSubscriptions({ fetch: fn });
    await expect(relai.plans.create({ name: "x", amountUsdc: 1, periodHours: 1, merchantWallet: "W" })).rejects.toThrow(/apiKey/);
  });
});

describe("status", () => {
  it("builds the public /s/:id/status?wallet= query", async () => {
    const { fn, calls } = fakeFetch(() => ({ json: { active: true, status: "active" } }));
    const relai = new RelaiSubscriptions({ fetch: fn });
    const s = await relai.status("P1", "WALLET");
    expect(s.active).toBe(true);
    expect(calls[0]!.url.pathname).toBe("/s/P1/status");
    expect(calls[0]!.url.searchParams.get("wallet")).toBe("WALLET");
  });
});

describe("error handling", () => {
  it("throws RelaiApiError with status + server message", async () => {
    const { fn } = fakeFetch(() => ({ status: 404, json: { error: "plan not found" } }));
    const relai = new RelaiSubscriptions({ fetch: fn });
    await expect(relai.plans.meta("nope")).rejects.toMatchObject({ name: "RelaiApiError", status: 404, message: "plan not found" });
  });
});

describe("requireSubscription middleware", () => {
  function mockRes() {
    const out: { code: number; body: unknown } = { code: 0, body: undefined };
    const res = { status(c: number) { out.code = c; return res; }, json(b: unknown) { out.body = b; return res; }, end() { return res; } };
    return { res, out };
  }

  it("calls next() when the wallet is active", async () => {
    const { fn } = fakeFetch(() => ({ json: { active: true } }));
    const relai = new RelaiSubscriptions({ fetch: fn });
    const mw = relai.requireSubscription("P1", { getWallet: () => "WALLET" });
    const next = vi.fn();
    const { res, out } = mockRes();
    await mw({ headers: {} }, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(out.code).toBe(0);
  });

  it("returns 402 when not subscribed", async () => {
    const { fn } = fakeFetch(() => ({ json: { active: false } }));
    const relai = new RelaiSubscriptions({ fetch: fn });
    const mw = relai.requireSubscription("P1", { getWallet: () => "WALLET" });
    const next = vi.fn();
    const { res, out } = mockRes();
    await mw({ headers: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(out.code).toBe(402);
  });

  it("returns 402 when no wallet is resolved", async () => {
    const { fn } = fakeFetch(() => ({ json: { active: true } }));
    const relai = new RelaiSubscriptions({ fetch: fn });
    const mw = relai.requireSubscription("P1", { getWallet: () => undefined });
    const next = vi.fn();
    const { res, out } = mockRes();
    await mw({ headers: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(out.code).toBe(402);
  });
});
