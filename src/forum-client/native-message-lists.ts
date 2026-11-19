import { first, nativePaging, positive, target } from "./discovery/shared.js";
import {
  attr,
  byId,
  children,
  descendants,
  element,
  hasClass,
  label,
  safeURL,
  text,
  type Element,
  type Node,
} from "./html.js";
import type { NativeMessageListResult } from "./message-client.js";
import { accountFrom } from "./read-thread.js";

export type MessageListFilter = "privatepm" | "announcepm";

function listTarget(node: Element, base: URL) {
  const route = target(attr(node, "href"), base.href, "/home.php", "space");
  return route?.searchParams.get("do") === "pm" &&
    !route.searchParams.has("subop")
    ? route
    : null;
}

function timestamp(row: Node) {
  const time = first(
    row,
    (node) => node.tagName === "span" && hasClass(node, "xg1"),
  );
  if (!time) return null;
  const absolute =
    attr(time, "title") ||
    attr(children(time).find(element) ?? time, "title") ||
    label(time);
  return /^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?$/.test(absolute)
    ? absolute
    : null;
}

function preview(parts: Node[]) {
  return parts.map(text).join("").replace(/\s+/g, " ").trim();
}

function privatePreview(row: Element) {
  const parts = children(row);
  const br = parts.findIndex((node) => element(node) && node.tagName === "br");
  const terminator = (node: Node) =>
    (element(node) && node.tagName === "br") ||
    hasClass(node, "xg1") ||
    hasClass(node, "pm_o");
  if (br === -1) {
    const at = parts.findIndex((node) => hasClass(node, "xg1"));
    const before = text(parts[at - 1]);
    const separator = before.search(/[:：]/);
    return separator >= 0 ? previewText(before.slice(separator + 1)) : null;
  }
  const rest = parts.slice(br + 1);
  const end = rest.findIndex(terminator);
  return end >= 0 ? preview(rest.slice(0, end)) : null;
}

function previewText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function profilePeer(node: Element, base: URL) {
  const href = safeURL(attr(node, "href"), base.href);
  if (!href) return null;
  const url = new URL(href);
  if (url.origin !== base.origin) return null;
  const rewrite = /^\/space-uid-([1-9]\d*)\.html$/.exec(url.pathname);
  if (rewrite) return rewrite[1] ?? null;
  return positive(
    target(href, base.href, "/home.php", "space")?.searchParams.get("uid"),
  );
}

function privateRow(row: Element, id: string, base: URL, memberId: string) {
  const avatar = first(
    row,
    (node) => node.tagName === "dd" && hasClass(node, "avt"),
  );
  const info = first(
    row,
    (node) => node.tagName === "dd" && hasClass(node, "ptm"),
  );
  const profile = avatar && first(avatar, (node) => node.tagName === "a");
  const peerId = profile && profilePeer(profile, base);
  if (!info || !peerId || peerId === memberId) return null;
  const peer = first(
    info,
    (node) => node.tagName === "a" && profilePeer(node, base) === peerId,
  );
  const sender = children(info).find(
    (node) =>
      element(node) &&
      (node.tagName === "a" ||
        (node.tagName === "span" && hasClass(node, "xi2"))),
  );
  const peerName = label(peer);
  const summary = privatePreview(info);
  const time = timestamp(info);
  if (!peerName || !sender || summary === null || !time) return null;
  const selfSent = hasClass(sender, "xi2");
  const url = new URL(
    `/home.php?mod=space&do=pm&subop=view&touid=${peerId}`,
    base,
  );
  return {
    id,
    peerId,
    peerName,
    preview: summary,
    unread: !selfSent && hasClass(row, "newpm"),
    timestamp: time,
    url: url.href,
  };
}

function broadcastRow(row: Element, id: string, base: URL) {
  const cells = children(row).filter(
    (node) => element(node) && node.tagName === "dd",
  );
  const info =
    cells.find((node) => hasClass(node, "ptm")) ?? cells[2] ?? cells.at(-1);
  if (!info) return null;
  const time = timestamp(info);
  if (!time) return null;
  const summary = byId(info, `p_gpmid_${id}`);
  const included = (node: Node): boolean =>
    !["xg1", "pm_o", "o", "p_pop"].some((name) => hasClass(node, name)) &&
    attr(node, "id") !== `gpmlist_${id}_a`;
  const message = summary
    ? label(summary)
    : preview(children(info).filter(included));
  const url = new URL(`/home.php?mod=space&do=pm&subop=viewg&pmid=${id}`, base);
  return {
    id,
    preview: message,
    unread: hasClass(row, "newpm"),
    timestamp: time,
    url: url.href,
  };
}

export function nativeMessageList(
  doc: Node,
  base: URL,
  filter: MessageListFilter,
  page: number,
  memberId: string,
): NativeMessageListResult {
  const invalid = { kind: "invalid-response" } as const;
  const viewer = accountFrom(doc, base.href);
  if (viewer.kind === "guest") return { kind: "refused" };
  if (viewer.kind !== "member") return invalid;
  if (viewer.id !== memberId) return { kind: "session-changed" };
  const scope = byId(doc, "ct") ?? doc;
  const activeTabs = descendants(
    scope,
    (node) => node.tagName === "ul" && hasClass(node, "tb"),
  )
    .flatMap((tabs) => children(tabs).filter((tab) => hasClass(tab, "a")))
    .flatMap((tab) => descendants(tab, (node) => node.tagName === "a"))
    .map((node) => listTarget(node, base)?.searchParams.get("filter"))
    .filter((value) => value === "privatepm" || value === "announcepm");
  if (activeTabs.some((active) => active !== filter)) return invalid;
  if (byId(doc, "messagetext") || byId(doc, "main_message")) return invalid;
  const entries = descendants(
    scope,
    (node) => node.tagName === "dl" && /^(g?pmlist)_/.test(attr(node, "id")),
  );
  const ids = new Set<string>();
  const paging = nativePaging(scope, base.href, (value) => {
    const route = target(value, base.href, "/home.php", "space");
    return (
      route?.searchParams.get("do") === "pm" &&
      route.searchParams.get("filter") === filter &&
      !route.searchParams.has("subop") &&
      positive(route.searchParams.get("page")) !== null
    );
  });
  const pager = first(scope, (node) => hasClass(node, "pg"));
  const current =
    pager && label(first(pager, (node) => node.tagName === "strong"));
  if ((current && current !== String(page)) || (!current && page > 1))
    return invalid;
  const next =
    paging.nextURL && Number(new URL(paging.nextURL).searchParams.get("page"));
  const nextPage =
    typeof next === "number" && Number.isSafeInteger(next) && next === page + 1
      ? next
      : null;
  const list = first(scope, (node) => hasClass(node, "pml"));
  const state = first(scope, (node) => hasClass(node, "emp"));
  const stateText = label(state);
  const emptyNotice =
    /^(暂[无無]|暫無|没有|沒有|还没有|還沒有|您没有|您沒有)(任何|新(的)?)?(私人|公共|短)?[消息訊息]{2}[。！!]?$/.test(
      stateText,
    );
  const closed =
    /^(短消息|私人消息|公共消息|短訊息|私人訊息|公共訊息)(功能)?已[关關][闭閉][。！!]?$/.test(
      stateText,
    );
  if (
    entries.length
      ? !list || closed
      : !activeTabs.length || (!emptyNotice && !closed)
  )
    return invalid;
  const common = {
    source: "native",
    memberId,
    page,
    nextPage,
    closed,
  } as const;
  if (filter === "privatepm") {
    const rows = [];
    for (const entry of entries) {
      const id = /^pmlist_([1-9]\d*)$/.exec(attr(entry, "id"))?.[1];
      if (!id || ids.has(id)) return invalid;
      const row = privateRow(entry, id, base, memberId);
      if (!row) return invalid;
      ids.add(id);
      rows.push(row);
    }
    return {
      ...common,
      kind: "private-list",
      effect: "may-clear-private-prompt",
      omittedGroups: 0,
      rows,
    };
  }
  const rows = [];
  for (const entry of entries) {
    const id = /^gpmlist_([1-9]\d*)$/.exec(attr(entry, "id"))?.[1];
    if (!id || ids.has(id)) return invalid;
    const row = broadcastRow(entry, id, base);
    if (!row) return invalid;
    ids.add(id);
    rows.push(row);
  }
  return {
    ...common,
    kind: "broadcast-list",
    effect: "none",
    count: null,
    rows,
  };
}
