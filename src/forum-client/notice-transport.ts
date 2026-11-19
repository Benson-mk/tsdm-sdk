import { safeURL } from "./routes.js";
import type { HostResponse } from "./types.js";

export interface NoticeSession {
  readonly memberId: string;
  readonly continuity: string;
}

export type NoticeRequest = {
  readonly fresh: true;
  readonly session: NoticeSession;
} & (
  | {
      readonly method: "GET";
      readonly body?: never;
      readonly effect?: boolean;
    }
  | { readonly method: "POST"; readonly body: string }
);

export interface NoticeClientOptions {
  origin: string;
  session(): NoticeSession | null;
  transport: {
    request(
      url: string,
      request: NoticeRequest,
    ): Promise<HostResponse & { redirect: "none" | "opaque" | "followed" }>;
  };
}

export type NoticeFailure =
  | "session-changed"
  | "rate-limited"
  | "unsupported"
  | "refused"
  | "network"
  | "invalid-response";

export function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function integer(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

export function numericId(value: unknown): string | null {
  if (integer(value, 0)) return String(value);
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value) ? value : null;
}

export type NoticeHost = ReturnType<typeof noticeHost>;

export function noticeHost(options: NoticeClientOptions) {
  const base = safeURL(options.origin);
  if (!base || options.origin !== base.origin) {
    throw new TypeError("A canonical HTTPS forum origin is required.");
  }
  function session(): NoticeSession | null {
    const value = options.session();
    return value && /^[1-9]\d*$/.test(value.memberId) && value.continuity
      ? Object.freeze({ memberId: value.memberId, continuity: value.continuity })
      : null;
  }
  function current(expected: NoticeSession): boolean {
    const actual = session();
    return actual?.memberId === expected.memberId && actual.continuity === expected.continuity;
  }
  async function request(
    url: string,
    expected: NoticeSession,
    body?: string,
    effect?: boolean,
  ) {
    if (!current(expected)) return { kind: "session-changed" } as const;
    let response;
    try {
      response = await options.transport.request(
        url,
        body === undefined
          ? { fresh: true, session: expected, method: "GET", ...(effect && { effect }) }
          : { fresh: true, session: expected, method: "POST", body },
      );
    } catch {
      return { kind: current(expected) ? "network" : "session-changed" } as const;
    }
    if (!current(expected)) return { kind: "session-changed" } as const;
    if (response.redirect !== "none" || response.url !== url) {
      return { kind: "invalid-response" } as const;
    }
    return { kind: "response", response } as const;
  }
  return { origin: base.origin, session, current, request };
}

export function noticeJSON(response: HostResponse):
  | { kind: "json"; data: Record<string, unknown> }
  | { kind: NoticeFailure } {
  if (response.status === 429) return { kind: "rate-limited" };
  if (response.status === 401 || response.status === 403) return { kind: "refused" };
  if (response.status < 200 || response.status >= 300) return { kind: "invalid-response" };
  let data;
  try {
    data = object(JSON.parse(response.body));
  } catch {
    return { kind: "unsupported" };
  }
  if (!data) return { kind: "invalid-response" };
  if (data.ok === 0) {
    if (data.error === "busy") return { kind: "rate-limited" };
    if (data.error === "action" || data.error === "off") return { kind: "unsupported" };
    return { kind: "refused" };
  }
  return data.ok === 1 ? { kind: "json", data } : { kind: "invalid-response" };
}
