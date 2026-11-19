import {
  unsupportedV4,
  v4ForMember,
  type V4CapabilityGroup,
} from "../v4-selection.js";
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
          : {
              method: "POST",
              fresh: true,
              session: owner,
              effect: true,
              body,
            },
      );
    } catch {
      return {
        kind: current(owner) ? "network" : "session-changed",
      } as const;
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
    if (page.failure || (page.data?.ok === 0 && !unsupportedV4(page.data))) {
      return {
        kind: "refused",
        message: page.failure || String(page.data?.message ?? ""),
      } as const;
    }
    return {
      kind: "page",
      page,
      v4: new URL(url).searchParams.get("tsdmv") === "4",
      identified:
        viewer === owner.memberId ||
        numericId(page.data?.uid) === owner.memberId,
    } as const;
  }
  const capability = (
    group: V4CapabilityGroup,
    name: string,
    owner: NoticeSession,
  ) =>
    v4ForMember(origin, group, name, owner.memberId, (url) =>
      exchange(url, owner),
    );
  async function readCompatible(
    base: string,
    owner: NoticeSession,
    group: "task_pages" | "magic_pages",
    name: string,
    schema: number,
  ) {
    const selected = await capability(group, name, owner);
    if (selected.kind === "session-changed" || selected.kind === "refused")
      return selected;
    const legacy = () => read(query(base, { tsdmapp: "json" }), owner);
    if (selected.kind !== "v4") return legacy();
    const loaded = await read(query(base, pageMode), owner);
    if (loaded.kind !== "page" || loaded.page.html) return loaded;
    const data = loaded.page.data;
    return data?.type === name && data.schema === schema ? loaded : legacy();
  }
  async function readV4Only(
    base: string,
    owner: NoticeSession,
    group: "task_pages" | "magic_pages",
    name: string,
  ) {
    const selected = await capability(group, name, owner);
    if (selected.kind === "session-changed" || selected.kind === "refused")
      return selected;
    return selected.kind === "v4"
      ? read(query(base, pageMode), owner)
      : handoff(base);
  }
  return {
    origin,
    session,
    current,
    exchange,
    read,
    capability,
    readCompatible,
    readV4Only,
  };
}
