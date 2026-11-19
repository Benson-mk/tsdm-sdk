import type { ForumTransport, HostResponse } from "../../index.js";
import {
  attr,
  byId,
  descendants,
  documentFrom,
  hasClass,
  label,
  safeURL,
  type Element,
  type Node,
} from "../html.js";
import { accountFrom } from "../read-thread.js";
import { routeFor } from "../routes.js";
import {
  parseReadPayload,
  readAccount,
  structuredFailure,
} from "../structured-read.js";
import type { Account, FailureKind, ForumLink } from "../types.js";

import type {
  Context,
  DiscoveryFailure,
  DiscoveryThread,
  PageLinks,
} from "./types.js";

type Payload = Record<string, unknown>;

const unknown: Account = { kind: "unknown" };
export const invalid = (
  sourceURL: string,
  message: string,
): DiscoveryFailure => ({
  kind: "invalid",
  account: unknown,
  sourceURL,
  message,
});
export const failure = (
  context: Context,
  kind: FailureKind,
  message: string,
): DiscoveryFailure => ({ ...context, kind, message });
export function handoff(context: Context, message: string): DiscoveryFailure {
  return {
    ...context,
    kind: "document-navigation",
    destination: context.sourceURL,
    message,
  };
}
export function record(value: unknown): Payload | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Payload)
    : null;
}
export function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
export function positive(value: unknown): string | null {
  return ((typeof value === "number" && integer(value) !== null) ||
    typeof value === "string") &&
    /^[1-9]\d*$/.test(String(value))
    ? String(value)
    : null;
}
function sameOrigin(value: string, base: string): URL | null {
  const resolved = safeURL(value, base);
  if (!resolved) return null;
  const url = new URL(resolved);
  return url.protocol === "https:" && url.origin === new URL(base).origin
    ? url
    : null;
}
export function target(
  value: string,
  base: string,
  path: string,
  mod: string,
  repeatable: readonly string[] = [],
): URL | null {
  const url = sameOrigin(value, base);
  if (
    !url ||
    url.pathname !== path ||
    url.searchParams.get("mod") !== mod ||
    url.hash ||
    [...url.searchParams.keys()].some(
      (key) =>
        !repeatable.includes(key) && url.searchParams.getAll(key).length > 1,
    )
  )
    return null;
  return url;
}
export function clean(url: URL): URL {
  const copy = new URL(url);
  for (const key of ["tsdmapp", "nodoc", "tsdmpreview", "tsdmv"]) {
    if (copy.searchParams.has(key)) copy.searchParams.delete(key);
  }
  return copy;
}
export const first = (
  node: Node,
  predicate: (node: Element) => boolean,
): Element | undefined => descendants(node, predicate)[0];
export const anchors = (node: Node): Element[] =>
  descendants(node, (item) => item.tagName === "a");
export function link(
  node: Element | undefined,
  base: string,
): ForumLink | null {
  const url = node && safeURL(attr(node, "href"), base);
  return url ? { url, label: label(node) } : null;
}
export function nativePaging(
  doc: Node,
  base: string,
  accepts: (url: string) => boolean,
): PageLinks {
  const pager = first(doc, (node) => hasClass(node, "pg"));
  const current =
    pager && label(first(pager, (node) => node.tagName === "strong"));
  const totalNode =
    pager &&
    first(
      pager,
      (node) => node.tagName === "span" && /\d+/.test(attr(node, "title")),
    );
  const total = totalNode && attr(totalNode, "title").match(/\d+/)?.[0];
  const links: ForumLink[] = [];
  let nextURL: string | null = null;
  for (const anchor of pager ? anchors(pager) : []) {
    const entry = link(anchor, base);
    if (!entry || !accepts(entry.url)) continue;
    links.push(entry);
    if (
      hasClass(anchor, "nxt") ||
      entry.label === String(Number(current || 1) + 1)
    )
      nextURL = entry.url;
  }
  return {
    pages: {
      current: current || new URL(base).searchParams.get("page") || "1",
      links,
      ...(total ? { total } : {}),
    },
    nextURL,
  };
}
export function structuredPaging(
  payload: Payload,
  base: URL,
  doc: Node,
  accepts: (url: string) => boolean,
): PageLinks | null {
  const page = positive(payload.page);
  const total = integer(payload.pages);
  if (
    !page ||
    total === null ||
    (total > 0 && Number(page) > total) ||
    ![0, 1].includes(Number(payload.has_next)) ||
    typeof payload.has_next !== "number"
  )
    return null;
  if (total && payload.has_next !== Number(Number(page) < total)) return null;
  const native = nativePaging(doc, base.href, accepts);
  const links = native.pages.current === page ? native.pages.links : [];
  const pageLink = (number: number) => {
    const existing = links.find(
      (item) =>
        Number(new URL(item.url).searchParams.get("page") || "1") === number,
    );
    if (existing) return existing.url;
    const destination = new URL(base);
    destination.searchParams.set("page", String(number));
    links.push({ url: destination.href, label: String(number) });
    return destination.href;
  };
  if (Number(page) > 1) pageLink(Number(page) - 1);
  const nextURL = payload.has_next === 1 ? pageLink(Number(page) + 1) : null;
  return {
    pages: { current: page, links, ...(total ? { total: String(total) } : {}) },
    nextURL,
  };
}
export function structuredRows(
  value: unknown,
  base: string,
  replies = false,
): DiscoveryThread[] | null {
  if (!Array.isArray(value)) return null;
  const rows: DiscoveryThread[] = [];
  for (const raw of value) {
    const row = record(raw);
    if (!row) return null;
    const id = positive(row.tid);
    const postId = positive(row.pid);
    const boardId = positive(row.fid);
    if (
      !id ||
      (replies && !postId) ||
      typeof row.subject !== "string" ||
      !row.subject.trim()
    )
      return null;
    const authorId = row.anonymous === 1 ? null : positive(row.authorid);
    const threadPath = postId
      ? `/forum.php?mod=redirect&goto=findpost&ptid=${id}&pid=${postId}`
      : `/forum.php?mod=viewthread&tid=${id}`;
    rows.push({
      id,
      postId,
      label: row.subject,
      url: new URL(threadPath, base).href,
      board: boardId
        ? {
            id: boardId,
            label: typeof row.forum === "string" ? row.forum : "",
            url: new URL(`/forum.php?mod=forumdisplay&fid=${boardId}`, base)
              .href,
          }
        : null,
      author:
        typeof row.author === "string"
          ? {
              id: authorId,
              name: row.author,
              url: authorId
                ? new URL(`/home.php?mod=space&uid=${authorId}`, base).href
                : null,
            }
          : null,
      summary: typeof row.summary === "string" ? row.summary : null,
    });
  }
  return rows;
}
export function nativeThread(
  anchor: Element | undefined,
  container: Node,
  base: string,
): DiscoveryThread | null {
  const subject = link(anchor, base);
  const route = subject && routeFor(subject.url);
  const id =
    route &&
    positive(
      route.url.searchParams.get("tid") ?? route.url.searchParams.get("ptid"),
    );
  if (
    !subject ||
    !subject.label ||
    !route ||
    !id ||
    !sameOrigin(subject.url, base) ||
    !["thread", "redirect"].includes(route.kind)
  )
    return null;
  const links = anchors(container)
    .map((node) => link(node, base))
    .filter((item) => item !== null);
  const board = links.find((item) => routeFor(item.url)?.kind === "board");
  const author = links.find((item) =>
    target(item.url, base, "/home.php", "space"),
  );
  const boardId = board && positive(new URL(board.url).searchParams.get("fid"));
  return {
    ...subject,
    id,
    postId: positive(route.url.searchParams.get("pid")),
    board: board && boardId ? { ...board, id: boardId } : null,
    author: author
      ? {
          id: positive(new URL(author.url).searchParams.get("uid")),
          name: author.label,
          url: author.url,
        }
      : null,
    summary: null,
  };
}
export function nativeList(doc: Node, base: string): DiscoveryThread[] | null {
  const entries = descendants(
    doc,
    (node) =>
      node.tagName === "tbody" && /^normalthread_\d+$/.test(attr(node, "id")),
  );
  const rows = entries.map((entry) =>
    nativeThread(
      first(entry, (node) => node.tagName === "a" && hasClass(node, "xst")),
      entry,
      base,
    ),
  );
  return rows.length && rows.every((row) => row !== null) ? rows : null;
}

export interface Received {
  context: Context;
  actual: URL;
  payload: Payload | null;
  doc: Node;
  body: string;
}
export async function receive(
  requested: URL,
  transport: ForumTransport,
  app: boolean,
  accepts: (destination: string) => boolean,
): Promise<Received | DiscoveryFailure> {
  const request = new URL(requested);
  if (app) request.searchParams.set("tsdmapp", "json");
  let response: HostResponse;
  try {
    response = await transport.request(request.href, { fresh: true });
  } catch {
    return failure(
      { account: unknown, sourceURL: requested.href },
      "network",
      "The forum request did not complete.",
    );
  }
  const actual = sameOrigin(response.url, requested.href);
  if (!actual)
    return invalid(
      requested.href,
      "The host returned a destination outside this forum.",
    );
  const payload = parseReadPayload(response);
  const html = payload
    ? [payload.head, payload.document]
        .filter((part): part is string => typeof part === "string")
        .join("")
    : response.body;
  const doc = documentFrom(html);
  const header = accountFrom(doc, actual.href);
  const envelope = readAccount(payload ?? {});
  const account = envelope.kind === "unknown" ? header : envelope;
  const context = { account, sourceURL: clean(actual).href };
  const explicit = structuredFailure(payload ?? {}, response, account);
  if (explicit && "message" in explicit) return { ...explicit, ...context };
  const message =
    (typeof payload?.message === "string" ? payload.message : "") ||
    label(byId(doc, "messagetext") ?? byId(doc, "main_message"));
  const title = label(first(doc, (node) => node.tagName === "title"));
  if (
    byId(doc, "challenge-form") ||
    byId(doc, "cf-challenge-running") ||
    /Just a moment|Checking your browser|安全验证|驗證您的瀏覽器/i.test(title)
  )
    return failure(
      context,
      "challenge",
      "The forum requires native verification.",
    );
  if (message) {
    const kind =
      byId(doc, "messagelogin") ||
      /未登录|未登錄|先登录|先登錄|登录后|登入後/.test(message)
        ? "login"
        : /过期|過期|失效|expired/i.test(message)
          ? "expired"
          : /频繁|頻繁|秒[内內]|rate limit/i.test(message)
            ? "throttle"
            : /权限|權限|用户组|用戶組|無權|已关闭|已關閉/.test(message)
              ? "permission"
              : /积分|積分|金币|金幣|credits?/i.test(message)
                ? "cost"
                : "invalid";
    return failure(context, kind, message);
  }
  if (
    response.redirect === "opaque" ||
    response.status < 200 ||
    response.status >= 300 ||
    !accepts(actual.href)
  )
    return invalid(
      requested.href,
      "The forum did not return the requested discovery view.",
    );
  if (
    envelope.kind !== "unknown" &&
    header.kind !== "unknown" &&
    !sameAccount(envelope, header)
  )
    return invalid(
      requested.href,
      "The response identifies conflicting viewer accounts.",
    );
  return { context, actual: clean(actual), payload, doc, body: response.body };
}
export function sameAccount(left: Account, right: Account): boolean {
  return (
    left.kind === right.kind &&
    left.kind !== "unknown" &&
    (left.kind !== "member" ||
      (right.kind === "member" && left.id === right.id))
  );
}
