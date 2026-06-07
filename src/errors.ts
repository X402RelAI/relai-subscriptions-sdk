/** Thrown when the RelAI API returns a non-2xx response. */
export class RelaiApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "RelaiApiError";
    this.status = status;
    this.body = body;
  }
}

/** Thrown when a webhook signature fails verification. */
export class WebhookSignatureError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}
