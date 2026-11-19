import type { ForumTransport } from "../../index.js";
import {
  attr,
  byId,
  descendants,
  hasClass,
  label,
  type Node,
} from "../html.js";
import type { ForumLink } from "../types.js";
import {
  anchors,
  failure,
  first,
  invalid,
  link,
  nativePaging,
  nativeThread,
  positive,
  receive,
  target,
  type Received,
} from "./shared.js";
import type {
  Context,
  DiscoveryFailure,
  DiscoveryThread,
  PageLinks,
} from "./types.js";

type RankingScope = { type: "member" | "thread"; view: string };
export type RankingsResult =
  | DiscoveryFailure
  | (Context &
      PageLinks & {
        kind: "rankings";
        scope: RankingScope;
        rows: (ForumLink & {
          id: string;
          rank: number;
          value: string;
          details: string;
          valueURL: string | null;
          thread: DiscoveryThread | null;
        })[];
        notice: string | null;
      });
function rankingScope(url: URL): RankingScope | null {
  const type = url.searchParams.get("type");
  const view = url.searchParams.get("view") || "";
  if (type === "member" && ["credit", "post", "onlinetime"].includes(view))
    return { type, view };
  if (
    type === "thread" &&
    ["heats", "replies", "views", "favtimes"].includes(view)
  )
    return { type, view };
  return null;
}
function rankingRows(doc: Node, base: string, scope: RankingScope) {
  const list = first(doc, (node) =>
    hasClass(node, scope.type === "member" ? "hasrank" : "tl"),
  );
  if (!list) return null;
  if (scope.type === "member")
    return descendants(list, (node) => node.tagName === "dl").map((entry) => {
      const title = first(
        entry,
        (node) => node.tagName === "dt" && !hasClass(node, "y"),
      );
      const item = link(title && anchors(title)[0], base);
      const profile = item && target(item.url, base, "/home.php", "space");
      const id = profile && positive(profile.searchParams.get("uid"));
      const rank = positive(
        label(first(entry, (node) => hasClass(node, "ranknum"))),
      );
      const valueNode = descendants(entry, (node) => node.tagName === "p").at(
        -1,
      );
      const details = label(valueNode);
      const value = details.split(/[:：]/).at(-1)?.trim();
      return item && id && rank && value
        ? {
            ...item,
            id,
            rank: Number(rank),
            value,
            details,
            valueURL: valueNode
              ? (link(anchors(valueNode)[0], base)?.url ?? null)
              : null,
            thread: null,
          }
        : null;
    });
  return descendants(list, (node) => node.tagName === "tr").flatMap((entry) => {
    const title = first(entry, (node) => node.tagName === "th");
    const subject = title && anchors(title)[0];
    if (!subject) return [];
    const thread = nativeThread(subject, entry, base);
    const rank = positive(label(first(entry, (node) => hasClass(node, "icn"))));
    const valueNode = descendants(entry, (node) => node.tagName === "td").at(
      -1,
    );
    const value = label(valueNode);
    return [
      thread && rank && value
        ? {
            id: thread.id,
            label: thread.label,
            url: thread.url,
            rank: Number(rank),
            value,
            details: value,
            valueURL: valueNode
              ? (link(anchors(valueNode)[0], base)?.url ?? null)
              : null,
            thread,
          }
        : null,
    ];
  });
}

export type TagResult =
  | DiscoveryFailure
  | (Context &
      (
        | {
            kind: "tags";
            tags: (ForumLink & { id: string; count: number | null })[];
          }
        | (PageLinks & {
            kind: "tag";
            tagId: string;
            title: string;
            moreURL: string | null;
            rows: DiscoveryThread[];
          })
      ));
const tagTarget = (value: string, base: string) =>
  target(value, base, "/misc.php", "tag");
function decodeTags(
  received: Received,
  tagId: string | null,
  accepts: (value: string) => boolean,
): TagResult {
  const { context, actual, doc } = received;
  const reject = () =>
    failure(
      context,
      "incomplete",
      "The forum did not establish this tag listing.",
    );
  if (!tagId) {
    const cloud = first(doc, (node) => hasClass(node, "taglist"));
    if (!cloud) return reject();
    const tags = anchors(cloud).map((anchor) => {
      const entry = link(anchor, actual.href);
      const url = entry && tagTarget(entry.url, actual.href);
      const id = url && positive(url.searchParams.get("id"));
      const count = attr(anchor, "title").match(/\d+\s*$/)?.[0];
      return entry && id && entry.label
        ? { ...entry, id, count: count === undefined ? null : Number(count) }
        : null;
    });
    return tags.every((item) => item !== null)
      ? { ...context, kind: "tags", tags }
      : reject();
  }
  const main = byId(doc, "ct");
  const title = main && label(first(main, (node) => node.tagName === "h1"));
  const listing = main && first(main, (node) => hasClass(node, "tl"));
  if (!listing || !title) return reject();
  const rows = descendants(
    listing,
    (node) =>
      node.tagName === "tr" &&
      !!first(node, (cell) => cell.tagName === "td" && hasClass(cell, "icn")),
  ).map((entry) => {
    const heading = first(entry, (node) => node.tagName === "th");
    return nativeThread(heading && anchors(heading)[0], entry, actual.href);
  });
  if (
    !rows.every((row) => row !== null) ||
    (!rows.length && !first(listing, (node) => hasClass(node, "emp")))
  )
    return reject();
  const paging = nativePaging(listing, actual.href, accepts);
  const more = anchors(listing)
    .map((anchor) => link(anchor, actual.href))
    .find(
      (item) =>
        item &&
        accepts(item.url) &&
        new URL(item.url).searchParams.get("type") === "thread" &&
        !new URL(item.url).searchParams.has("page") &&
        item.url !== actual.href,
    );
  return {
    ...context,
    ...paging,
    kind: "tag",
    tagId,
    title,
    moreURL: more?.url ?? null,
    rows,
  };
}

export function createActivityReads(origin: string, transport: ForumTransport) {
  return {
    async readRankings(destination: string): Promise<RankingsResult> {
      const requested = target(destination, origin, "/misc.php", "ranklist");
      const scope = requested && rankingScope(requested);
      if (!requested || !scope)
        return invalid(
          destination,
          "Use a supported member or thread ranking URL on this forum.",
        );
      const accepts = (value: string) => {
        const url = target(value, origin, "/misc.php", "ranklist");
        const actual = url && rankingScope(url);
        return actual?.type === scope.type && actual.view === scope.view;
      };
      const received = await receive(requested, transport, false, accepts);
      if ("kind" in received) return received;
      const { context, actual, doc } = received;
      const rows = rankingRows(doc, actual.href, scope);
      if (!rows?.length || rows.some((row) => row === null))
        return failure(
          context,
          "incomplete",
          "The forum did not establish the ranking rows.",
        );
      return {
        ...context,
        ...nativePaging(doc, actual.href, accepts),
        kind: "rankings",
        scope,
        rows: rows.filter((row) => row !== null),
        notice: label(first(doc, (node) => hasClass(node, "notice"))) || null,
      };
    },
    async readTags(destination = "/misc.php?mod=tag"): Promise<TagResult> {
      const requested = tagTarget(destination, origin);
      const tagId = requested?.searchParams.get("id") ?? null;
      const type = requested?.searchParams.get("type");
      if (
        !requested ||
        (tagId !== null && !positive(tagId)) ||
        (type !== null && type !== "thread")
      )
        return invalid(
          destination,
          "Use a tag cloud or thread tag URL on this forum.",
        );
      const accepts = (value: string) => {
        const url = tagTarget(value, origin);
        return (
          !!url &&
          url.searchParams.get("id") === tagId &&
          [null, "thread"].includes(url.searchParams.get("type"))
        );
      };
      const received = await receive(requested, transport, false, accepts);
      return "kind" in received
        ? received
        : decodeTags(received, tagId, accepts);
    },
  };
}
