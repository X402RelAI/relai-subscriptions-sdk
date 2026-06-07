import { describe, it, expect, vi } from "vitest";
import { RelaiSubscriptions } from "../src/index.js";
import { Subscriber } from "../src/subscriber.js";

/** Fake fetch returning canned JSON based on (method, pathname). */
function fakeFetch(routes: (path: string, method: string, calls: number) => unknown) {
  let n = 0;
  const fn = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const json = routes(url.pathname, init.method ?? "GET", n++);
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return fn;
}

const sub = { subscriptionId: "S", planId: "P", status: "active" };

describe("Subscriber.subscribe", () => {
  it("runs the two-stage flow: init-authority → subscribe → confirm", async () => {
    let prepareCalls = 0;
    const fetch = fakeFetch((path) => {
      if (path.endsWith("/subscribe")) {
        prepareCalls++;
        return prepareCalls === 1
          ? { stage: "init-authority", wireTransaction: "INIT" }
          : { stage: "subscribe", wireTransaction: "SUB", subscriptionPda: "pda" };
      }
      if (path.endsWith("/confirm")) return { subscription: sub };
      return {};
    });
    const client = new RelaiSubscriptions({ fetch });
    const signAndSend = vi.fn(async (w: string) => "sig:" + w);
    const s = new Subscriber({ client, wallet: "WALLET", signAndSend, authorityDelayMs: 0 });

    const result = await s.subscribe("P");

    expect(result.subscriptionId).toBe("S");
    expect(signAndSend.mock.calls.map((c) => c[0])).toEqual(["INIT", "SUB"]);
    expect(prepareCalls).toBe(2);
  });

  it("skips the init tx when the authority already exists", async () => {
    const fetch = fakeFetch((path) => {
      if (path.endsWith("/subscribe")) return { stage: "subscribe", wireTransaction: "SUB" };
      if (path.endsWith("/confirm")) return { subscription: sub };
      return {};
    });
    const client = new RelaiSubscriptions({ fetch });
    const signAndSend = vi.fn(async () => "sig");
    const s = new Subscriber({ client, wallet: "WALLET", signAndSend, authorityDelayMs: 0 });

    await s.subscribe("P");
    expect(signAndSend).toHaveBeenCalledOnce();
    expect(signAndSend).toHaveBeenCalledWith("SUB");
  });
});

describe("Subscriber.cancel", () => {
  it("signs the cancel tx and confirms", async () => {
    const fetch = fakeFetch((path) => {
      if (path.endsWith("/cancel")) return { wireTransaction: "CANCEL" };
      if (path.endsWith("/cancel/confirm")) return { subscription: { ...sub, status: "canceled" } };
      return {};
    });
    const client = new RelaiSubscriptions({ apiKey: "sk_x", fetch });
    const signAndSend = vi.fn(async () => "sig");
    const s = new Subscriber({ client, wallet: "WALLET", signAndSend });

    const result = await s.cancel("S");
    expect(result.status).toBe("canceled");
    expect(signAndSend).toHaveBeenCalledWith("CANCEL");
  });
});
