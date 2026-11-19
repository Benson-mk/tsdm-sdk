import { operationURL, token } from "./account-forms.js";
import { positive } from "./discovery/shared.js";
import {
  attr,
  byId,
  children,
  controlDisabled,
  descendants,
  element,
  hasClass,
  label,
  text,
  type Element,
  type Node,
} from "./html.js";

import type { CollectionListQuery } from "./collection-types.js";

export const find = (
  node: Node | undefined,
  test: (element: Element) => boolean,
): Element | undefined => all(node, test)[0];
export const all = (
  node: Node | undefined,
  test: (element: Element) => boolean,
): Element[] => (node ? descendants(node, test) : []);
const cls = (name: string) => (node: Element) => hasClass(node, name);
const tag = (name: string) => (node: Element) => node.tagName === name;
const href = (node: Node | undefined) => (node ? attr(node, "href") : "");
const value = (node: Node | undefined) => (node ? attr(node, "value") : "");
const int = (raw: string) =>
  /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
export const field = (node: Node, name: string): Element | undefined =>
  find(node, (n) => attr(n, "name") === name && !controlDisabled(n));
export const hashField = (node: Node) => token(value(field(node, "formhash")));

export function collectionURL(
  base: URL,
  raw: string,
  query: Record<string, string>,
) {
  return operationURL(raw, base, "/forum.php", { mod: "collection", ...query });
}

export function viewer(node: Node) {
  const ids = new Set(
    all(node, tag("script")).flatMap((s) =>
      [
        ...s.childNodes
          .map(text)
          .join("")
          .matchAll(/\bdiscuz_uid\s*=\s*['"](0|[1-9]\d*)['"]/g),
      ].map((m) => m[1]),
    ),
  );
  return ids.size === 1 ? [...ids][0] : null;
}

export function pageHash(doc: Node, base: URL) {
  const logout = find(
    doc,
    (n) =>
      n.tagName === "a" &&
      Boolean(
        operationURL(href(n), base, "/member.php", {
          mod: "logging",
          action: "logout",
        }),
      ),
  );
  const url = operationURL(href(logout), base, "/member.php", {
    mod: "logging",
    action: "logout",
  });
  return token(url?.searchParams.get("formhash")) || hashField(doc);
}

function pagination(
  root: Node,
  url: URL,
  matches: (raw: string) => URL | null,
) {
  const pagers = all(root, cls("pg"));
  const page = pagers.length ? int(label(find(pagers[0], tag("strong")))) : 1;
  if (page !== Number(url.searchParams.get("page") ?? "1")) return null;
  let last: number | null = pagers.length ? null : 1;
  let nextPage: number | null = null;
  for (const pager of pagers) {
    for (const link of all(pager, tag("a"))) {
      const target = matches(href(link));
      const number = int(target?.searchParams.get("page") ?? "");
      if (number && number > page && (nextPage === null || number < nextPage))
        nextPage = number;
      if (number && number >= page && hasClass(link, "last")) last = number;
    }
    const explicit = find(
      pager,
      (n) =>
        n.tagName === "span" && /^\s*共\s*\d+\s*页\s*$/.test(attr(n, "title")),
    );
    const total = int(
      explicit ? (attr(explicit, "title").match(/\d+/)?.[0] ?? "") : "",
    );
    if (total && total >= page) last = total;
  }
  return { page, totalPages: last, nextPage };
}

function member(root: Node | undefined, url: URL) {
  for (const link of all(root, tag("a"))) {
    const target = operationURL(href(link), url, "/home.php", { mod: "space" });
    const id = positive(target?.searchParams.get("uid"));
    if (id) return { id, name: label(link) };
  }
  return null;
}

function listRow(
  row: Element,
  url: URL,
  order: string | null,
  tid: string | null,
) {
  const link = find(
    find(row, tag("dt")),
    (n) =>
      n.tagName === "a" &&
      Boolean(collectionURL(url, href(n), { action: "view" })),
  );
  const target = collectionURL(url, href(link), { action: "view" });
  const id = positive(target?.searchParams.get("ctid"));
  if (
    !id ||
    !label(link) ||
    (tid && target?.searchParams.get("fromtid") !== tid)
  )
    return null;
  const details = find(row, (n) => n.tagName === "dd" && !hasClass(n, "m"));
  const paragraphs = all(details, tag("p"));
  const creator = find(details, cls("xg1"));
  const counts =
    label(paragraphs[1] === creator ? undefined : paragraphs[1]).match(
      /\d+/g,
    ) ?? [];
  const big = int(
    label(
      find(
        find(row, (n) => n.tagName === "dd" && hasClass(n, "m")),
        tag("strong"),
      ),
    ),
  );
  const first = int(counts[0] ?? "");
  const second = int(counts[1] ?? "");
  const [threadCount, followCount, commentCount] =
    order === "follownum"
      ? [first, big, second]
      : order === "commentnum"
        ? [second, first, big]
        : [big, first, second];
  const relation =
    (["created", "team", "subscribed"] as const).find((_, i) =>
      find(row, cls(`ctag${i}`)),
    ) ?? null;
  const latestLink = find(
    details,
    (n) =>
      n.tagName === "a" &&
      Boolean(operationURL(href(n), url, "/forum.php", { mod: "viewthread" })),
  );
  const latestId = positive(
    operationURL(href(latestLink), url, "/forum.php", {
      mod: "viewthread",
    })?.searchParams.get("tid"),
  );
  return {
    id,
    name: label(link),
    description: paragraphs[0] === creator ? "" : label(paragraphs[0]),
    keywords: all(find(row, cls("ctag_keyword")), tag("a"))
      .map(label)
      .filter(Boolean),
    threadCount,
    followCount,
    commentCount,
    creator: member(creator, url),
    lastUpdate:
      label(creator).match(/\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2})?/)?.[0] ??
      "",
    latestThread: latestId
      ? { id: latestId, subject: label(latestLink) }
      : null,
    relation,
    updated: Boolean(
      link && /(?:^|;)\s*color\s*:\s*red\s*(?:;|$)/i.test(attr(link, "style")),
    ),
  };
}

export function collectionList(
  root: Element,
  url: URL,
  tab: CollectionListQuery["tab"] | "related",
) {
  const order = url.searchParams.get("order");
  const tid = url.searchParams.get("tid");
  const op = url.searchParams.get("op");
  function matches(raw: string, matchOrder = true) {
    const target = collectionURL(url, raw, {});
    if (
      !target ||
      target.searchParams.has("action") ||
      target.searchParams.get("tid") !== tid ||
      target.searchParams.get("op") !== op
    )
      return null;
    if (
      matchOrder &&
      (target.searchParams.get("order") ?? "dateline") !== (order ?? "dateline")
    )
      return null;
    return target;
  }
  const tabs = find(root, cls("tb"));
  const active = find(tabs, (n) => n.tagName === "li" && hasClass(n, "a"));
  if (!matches(href(find(active, tag("a"))), false)) return null;
  if (
    op === "all" &&
    order &&
    !find(
      root,
      (n) => n.tagName === "a" && hasClass(n, "a") && Boolean(matches(href(n))),
    )
  )
    return null;
  const list = find(root, cls("clct_list"));
  if (!list && !find(root, cls("emp"))) return null;
  const rows = all(list, cls("xld")).map((row) =>
    listRow(row, url, order, tid),
  );
  if (rows.some((row) => !row || (op === "my" && !row.relation))) return null;
  const page = pagination(root, url, matches);
  if (!page) return null;
  const items = rows
    .filter((row) => row !== null)
    .filter((row) =>
      tab === "owned"
        ? row.relation !== "subscribed"
        : tab === "subscribed"
          ? row.relation === "subscribed"
          : true,
    );
  const canCreate = all(tabs, tag("a")).some((link) => {
    const target = collectionURL(url, href(link), { action: "edit" });
    return (
      target &&
      (target.searchParams.get("op") ?? "add") === "add" &&
      [...target.searchParams.keys()].every((key) =>
        ["mod", "action", "op", "formhash"].includes(key),
      )
    );
  });
  return { kind: "list" as const, tab, ...page, items, canCreate };
}

function titleOf(head: Element, url: URL, id: string) {
  const link = find(find(head, tag("h1")), tag("a"));
  return collectionURL(url, href(link), { action: "view", ctid: id })
    ? label(link)
    : "";
}

function threadRow(row: Element, url: URL, id: string) {
  const cell = find(row, tag("th"));
  const link = find(cell, (n) => n.tagName === "a" && hasClass(n, "xst"));
  const target = operationURL(href(link), url, "/forum.php", {
    mod: "viewthread",
  });
  const tid = positive(target?.searchParams.get("tid"));
  if (
    !tid ||
    (target?.searchParams.has("ctid") &&
      target.searchParams.get("ctid") !== id) ||
    !cell ||
    !link
  )
    return null;
  const reason =
    attr(cell, "title")
      .match(/[:：]\s*([\s\S]*)/)?.[1]
      ?.trim() ?? "";
  const by = find(row, cls("by"));
  const cite = find(by, tag("cite"));
  const num = find(row, cls("num"));
  return {
    id: tid,
    subject: attr(link, "title").trim() || label(link),
    reason,
    author: member(cite, url),
    authorName: label(cite),
    date: label(find(by, tag("em"))),
    replies: int(label(find(num, tag("a")))),
    views: int(label(find(num, tag("em")))),
  };
}

export function collectionDetail(root: Element, url: URL, id: string) {
  const head = find(root, (n) => hasClass(n, "bm") && hasClass(n, "bml"));
  const table = find(root, cls("tl"));
  const name = head && titleOf(head, url, id);
  if (!name || !head || !table) return null;
  const matches = (raw: string) =>
    collectionURL(url, raw, { action: "view", ctid: id });
  const page =
    pagination(table, url, matches) ?? pagination(root, url, matches);
  if (!page) return null;
  const threads = all(
    table,
    (n) => n.tagName === "tr" && Boolean(find(n, cls("xst"))),
  ).map((row) => threadRow(row, url, id));
  if (threads.some((row) => !row)) return null;
  const signedLink = (op: string) => {
    const query = { action: "edit", op, ctid: id };
    const link = find(
      head,
      (n) => n.tagName === "a" && Boolean(collectionURL(url, href(n), query)),
    );
    return token(
      collectionURL(url, href(link), query)?.searchParams.get("formhash"),
    );
  };
  const editHash = signedLink("edit");
  const deleteHash = signedLink("remove");
  const removeForm = find(
    table,
    (n) =>
      n.tagName === "form" &&
      attr(n, "method").toLowerCase() === "post" &&
      Boolean(
        collectionURL(url, attr(n, "action"), {
          action: "edit",
          op: "delthread",
        }),
      ),
  );
  const removeHash =
    removeForm && value(field(removeForm, "ctid")) === id
      ? hashField(removeForm)
      : "";
  const removable = removeForm
    ? all(
        removeForm,
        (n) =>
          n.tagName === "input" &&
          attr(n, "name") === "delthread[]" &&
          !controlDisabled(n),
      )
        .map((n) => attr(n, "value"))
        .filter((tid) => threads.some((thread) => thread?.id === tid))
    : [];
  const body = find(head, cls("bm_c"));
  const people = find(body, cls("mbn"));
  const workers = all(people, (n) => attr(n, "id").startsWith("k_worker_uid_"));
  const creator =
    all(people, tag("p"))
      .map((n) => member(n, url))
      .find((n) => n && !workers.some((w) => member(w, url)?.id === n.id)) ??
    null;
  const description =
    body &&
    children(body)
      .filter((n) => element(n) && n.tagName === "div" && !attr(n, "class"))
      .at(-1);
  const rating = find(
    body,
    (n) => Boolean(attr(n, "title")) && Boolean(find(n, cls("clct_ratestar"))),
  );
  const average = rating ? Number(attr(rating, "title")) : NaN;
  const follow = byId(head, "followlink");
  const following = Boolean(find(follow, cls("u")));
  const followHref = href(follow);
  const offeredFollow =
    follow?.tagName === "a" &&
    (["javascript;", "javascript:;"].includes(followHref) ||
      Boolean(
        collectionURL(url, followHref, {
          action: "follow",
          op: following ? "unfo" : "follow",
          ctid: id,
        }),
      ));
  const counts = all(find(root, cls("tns")), tag("p"));
  return {
    data: {
      kind: "detail" as const,
      id,
      name,
      ...page,
      description: label(description),
      creator,
      keywords: all(
        people,
        (n) => n.tagName === "a" && href(n).includes("source=collectionsearch"),
      ).map(label),
      maintainers: workers
        .map((worker) => member(worker, url))
        .filter((item) => item !== null),
      averageRating:
        Number.isFinite(average) && average >= 1 && average <= 5
          ? average
          : null,
      ratingCount: int(label(rating).match(/\d+/)?.[0] ?? ""),
      followCount: int(label(byId(head, "follownum_display"))),
      threadCount: int(label(counts[0])),
      commentCount: int(label(counts[1])),
      followState: offeredFollow
        ? following
          ? ("following" as const)
          : ("can-follow" as const)
        : ("unavailable" as const),
      threads: threads.filter((item) => item !== null),
      canManage: Boolean(editHash || deleteHash || removeHash),
    },
    editHash,
    deleteHash,
    removeHash,
    removable,
  };
}

const stars = (root: Node | undefined) => {
  const star = find(root, cls("star"));
  return star
    ? int(attr(star, "class").match(/\bstar([1-5])\b/)?.[1] ?? "")
    : null;
};

export function collectionComments(root: Element, url: URL, id: string) {
  const head = find(root, (n) => hasClass(n, "bm") && hasClass(n, "bml"));
  const name = head && titleOf(head, url, id);
  if (!name || find(root, cls("tl"))) return null;
  const matches = (raw: string) =>
    collectionURL(url, raw, { action: "view", op: "comment", ctid: id });
  const page = pagination(root, url, matches);
  if (!page) return null;
  const form = find(
    root,
    (n) =>
      n.tagName === "form" &&
      attr(n, "method").toLowerCase() === "post" &&
      Boolean(
        collectionURL(url, attr(n, "action"), { action: "comment", ctid: id }),
      ) &&
      field(n, "message")?.tagName === "textarea",
  );
  const list = find(root, cls("xld"));
  if (!list && !form && !find(root, cls("emp"))) return null;
  const comments = all(list, tag("dl")).map((row) => {
    const head = find(row, tag("dt"));
    const body = all(
      row,
      (n) => n.tagName === "dd" && !hasClass(n, "m") && !hasClass(n, "cl"),
    ).at(-1);
    return {
      author: member(head, url),
      time: label(find(head, cls("xg1"))),
      message: label(body),
      rating: stars(find(row, (n) => n.tagName === "dd" && hasClass(n, "cl"))),
    };
  });
  return {
    data: {
      kind: "comments" as const,
      id,
      name,
      ...page,
      comments,
      canComment: Boolean(form),
      canRate: Boolean(form && field(form, "ratescore")),
      myRating: stars(form),
    },
    formHash: form ? hashField(form) : "",
  };
}
