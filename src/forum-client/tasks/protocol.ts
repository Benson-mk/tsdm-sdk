import type { TaskMagicClientOptions, TaskMagicHandoff } from "./types.js";
import { activityURL, answer, responseIssue } from "../activity-protocol.js";
import { nativeIdentity, operationURL } from "../account-forms.js";
import {
  noticeHost,
  numericId,
  type NoticeSession,
} from "../notice-transport.js";
import { query } from "../posts/forms.js";

export const pageMode = { tsdmapp: "json", tsdmv: "4", nodoc: "1" };
export const writeMode = { tsdmapp: "json", tsdmv: "4" };
export const home = (origin: string, params: Record<string, string>) =>
  query(`${origin}/home.php`, params);
export const href = (raw: unknown, base: string) =>
  typeof raw === "string"
    ? (activityURL(raw, new URL(base))?.href ?? null)
    : null;
export function homeRoute(
  raw: unknown,
  source: string,
  required: Record<string, string>,
  optional: string[] = [],
) {
  const url =
    typeof raw === "string"
      ? operationURL(raw, new URL(source), "/home.php", required)
      : null;
  return url &&
    [...url.searchParams.keys()].every(
      (key) => Object.hasOwn(required, key) || optional.includes(key),
    )
    ? url
    : null;
}
export const handoff = (destination: string): TaskMagicHandoff => ({
  kind: "browser-handoff",
  destination,
});

export function taskMagicHost(options: TaskMagicClientOptions) {
  const { origin, session, current } = noticeHost({
    origin: options.origin,
    session: () => options.session(),
    transport: {
      request: (url, request) =>
        options.transport.request(
          url,
          request.method === "POST"
            ? { ...request, effect: true }
            : { ...request, effect: false },
        ),
    },
  });
  async function exchange(
    url: string,
    owner: NoticeSession,
    effect = false,
    body?: string,
  ) {
    if (!current(owner)) return { kind: "session-changed" } as const;
    let response;
    try {
      response = await options.transport.request(
        url,
        body === undefined
          ? { method: "GET", fresh: true, session: owner, effect }
          : { method: "POST", fresh: true, session: owner, effect: true, body },
      );
    } catch {
      return { kind: current(owner) ? "network" : "session-changed" } as const;
    }
    if (!current(owner)) return { kind: "session-changed" } as const;
    if (response.url !== url || response.redirect !== "none")
      return { kind: "invalid-response" } as const;
    return { kind: "response", response } as const;
  }
  async function read(url: string, owner: NoticeSession) {
    const loaded = await exchange(url, owner);
    if (loaded.kind !== "response") return loaded;
    const page = answer(loaded.response);
    const failure = responseIssue(loaded.response, page.data);
    if (failure) return failure;
    const viewer = nativeIdentity(page.html, new URL(url));
    if (
      (page.data?.uid !== undefined &&
        numericId(page.data.uid) !== owner.memberId) ||
      (viewer !== null && viewer !== owner.memberId)
    ) {
      return { kind: "session-changed" } as const;
    }
    if (loaded.response.status !== 200)
      return { kind: "invalid-response" } as const;
    if (
      page.failure ||
      (page.data?.ok === 0 && page.data.error === "message")
    ) {
      return {
        kind: "refused",
        message: page.failure || String(page.data?.message ?? ""),
      } as const;
    }
    return {
      kind: "page",
      page,
      identified:
        viewer === owner.memberId ||
        numericId(page.data?.uid) === owner.memberId,
    } as const;
  }
  async function readCompatible(base: string, owner: NoticeSession) {
    const loaded = await read(query(base, pageMode), owner);
    if (loaded.kind !== "page" || loaded.page.html) return loaded;
    const data = loaded.page.data;
    if (
      (data?.ok === 0 && data.error === "unknown") ||
      (data?.type === "result" && data.kind === "page")
    ) {
      return read(query(base, { tsdmapp: "json" }), owner);
    }
    return loaded;
  }
  return { origin, session, current, exchange, read, readCompatible };
}
