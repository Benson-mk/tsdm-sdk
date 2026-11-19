import type { ForumTransport } from "../../index.js";
import {
  byId,
  children,
  descendants,
  hasClass,
  label,
  type Node,
} from "../html.js";
import type { Account } from "../types.js";
import {
  anchors,
  failure,
  first,
  handoff,
  integer,
  invalid,
  link,
  nativeList,
  nativePaging,
  nativeThread,
  positive,
  receive,
  sameAccount,
  record,
  structuredPaging,
  structuredRows,
  target,
  type Received,
} from "./shared.js";
import type {
  Context,
  DiscoveryFailure,
  DiscoveryThread,
  PageLinks,
} from "./types.js";

export type GuideView =
  "index" | "hot" | "digest" | "new" | "newthread" | "sofa" | "my";
const guideViews: readonly string[] = [
  "index",
  "hot",
  "digest",
  "new",
  "newthread",
  "sofa",
  "my",
];
export interface GuideModule {
  view: GuideView;
  title: string;
  more: string;
  count: number;
  emptyMessage: string;
  rows: DiscoveryThread[];
}
export type GuideResult =
  | DiscoveryFailure
  | (Context &
      PageLinks & {
        kind: "guide";
        view: GuideView;
        scope: {
          kind: string;
          filter: string;
          boardId: string | null;
          searchKey: string;
        };
        rows: DiscoveryThread[];
        modules: GuideModule[];
      });

const guideKind = (url: URL) =>
  url.searchParams.get("view") === "my"
    ? url.searchParams.get("type") || "thread"
    : "";
function guideTarget(value: string, base: string): URL | null {
  const url = target(value, base, "/forum.php", "guide");
  return url &&
    guideViews.includes(url.searchParams.get("view") ?? "") &&
    ["", "thread", "reply"].includes(guideKind(url))
    ? url
    : null;
}

type MemberActivityKind = "thread" | "reply" | "draft";
export interface MemberActivityOptions {
  viewerId?: string;
}
export type MemberActivityResult =
  | DiscoveryFailure
  | (Context &
      PageLinks & {
        kind: "member-activity";
        owner: { id: string; name: string | null };
        self: boolean | null;
        scope: {
          kind: MemberActivityKind;
          boardId: string | null;
          filter: string;
        };
        hidden: number | null;
        rows: DiscoveryThread[];
      });
function memberTarget(value: string, base: string): URL | null {
  const url = target(value, base, "/home.php", "space");
  if (!url) return null;
  const params = url.searchParams;
  const type = params.get("type") || "thread";
  const filter = params.get("filter") || "";
  if (
    params.get("do") !== "thread" ||
    params.get("view") !== "me" ||
    !["thread", "reply"].includes(type) ||
    (filter === "save" &&
      (type !== "thread" || params.has("uid") || params.has("username"))) ||
    ["uid", "fid", "page"].some(
      (key) => params.has(key) && !positive(params.get(key)),
    )
  )
    return null;
  return url;
}
function memberScope(url: URL) {
  const filter = url.searchParams.get("filter") || "";
  const kind =
    filter === "save"
      ? "draft"
      : url.searchParams.get("type") === "reply"
        ? "reply"
        : "thread";
  return {
    kind,
    filter,
    boardId: positive(url.searchParams.get("fid")),
  } as const;
}

function legacyViewer(doc: Node): Account {
  const head = first(doc, (node) => node.tagName === "head");
  const uids = new Set<string>();
  for (const script of head
    ? descendants(head, (node) => node.tagName === "script")
    : []) {
    for (const child of children(script)) {
      if (!("value" in child)) continue;
      for (const match of child.value.matchAll(
        /\b(?:var\s+|,)\s*discuz_uid\s*=\s*(['"])(\d+)\1(?=[,;\s]|$)/g,
      )) {
        if (match[2]) uids.add(match[2]);
      }
    }
  }
  const id = uids.size === 1 ? [...uids][0] : undefined;
  if (id === "0") return { kind: "guest" };
  return id
    ? { kind: "member", id, name: `Member ${id}` }
    : { kind: "unknown" };
}

function nativeMemberActivity(
  received: Received,
  scope: ReturnType<typeof memberScope>,
  accepts: (value: string) => boolean,
): MemberActivityResult | null {
  const { context, actual, doc } = received;
  const viewer = context.account;
  const ownerId =
    actual.searchParams.get("uid") ||
    (viewer.kind === "member" ? viewer.id : null);
  if (!ownerId || actual.searchParams.get("username")) return null;
  const form = byId(doc, "delform");
  const table = form && first(form, (node) => node.tagName === "table");
  if (!table || form?.tagName !== "form") return null;
  if (
    scope.kind === "draft" &&
    !anchors(doc).some((anchor) => {
      const selection = link(anchor, actual.href);
      return (
        !!selection &&
        accepts(selection.url) &&
        (hasClass(anchor, "a") ||
          (!!anchor.parentNode && hasClass(anchor.parentNode, "a")))
      );
    })
  )
    return null;
  const rows: DiscoveryThread[] = [];
  let topic: DiscoveryThread | null = null;
  let empty = false;
  for (const row of descendants(table, (node) => node.tagName === "tr")) {
    if (hasClass(row, "th")) continue;
    if (
      first(
        row,
        (node) =>
          hasClass(node, "emp") &&
          /还没有相关的帖子|還沒有相關的帖子/.test(label(node)),
      )
    ) {
      empty = true;
      continue;
    }
    const heading = first(row, (node) => node.tagName === "th");
    if (scope.kind !== "reply" || hasClass(row, "bw0_all")) {
      topic = nativeThread(heading && anchors(heading)[0], row, actual.href);
      if (!topic || (scope.boardId && topic.board?.id !== scope.boardId))
        return null;
      if (scope.kind !== "reply") rows.push(topic);
      continue;
    }
    const reply = nativeThread(anchors(row)[0], row, actual.href);
    if (!topic || !reply?.postId || reply.id !== topic.id) return null;
    rows.push({
      ...topic,
      url: reply.url,
      postId: reply.postId,
      summary: reply.label,
    });
  }
  if (!rows.length && !empty) return null;
  const self = viewer.kind === "member" ? ownerId === viewer.id : null;
  return {
    ...context,
    ...nativePaging(doc, actual.href, accepts),
    kind: "member-activity",
    scope,
    self,
    owner: {
      id: ownerId,
      name:
        self &&
        viewer.kind === "member" &&
        viewer.name !== `Member ${viewer.id}`
          ? viewer.name
          : null,
    },
    hidden: null,
    rows,
  };
}

export function createListReads(origin: string, transport: ForumTransport) {
  return {
    async readGuide(
      destination = "/forum.php?mod=guide&view=index",
    ): Promise<GuideResult> {
      const requested = guideTarget(destination, origin);
      if (!requested)
        return invalid(destination, "Use a guide URL on this forum.");
      const view = requested.searchParams.get("view") as GuideView;
      const accepts = (value: string) => {
        const url = guideTarget(value, origin);
        return (
          !!url &&
          url.searchParams.get("view") === view &&
          guideKind(url) === guideKind(requested) &&
          ["fid", "filter", "searchkey"].every(
            (key) =>
              (url.searchParams.get(key) || "") ===
              (requested.searchParams.get(key) || ""),
          )
        );
      };
      const received = await receive(requested, transport, true, accepts);
      if ("kind" in received) return received;
      const { context, actual, payload, doc } = received;
      const kind = guideKind(requested);
      const filter = requested.searchParams.get("filter") || "";
      const boardId = positive(requested.searchParams.get("fid"));
      const searchKey = requested.searchParams.get("searchkey") || "";
      const scope = { kind, filter, boardId, searchKey };
      if (view === "my" && context.account.kind !== "member")
        return failure(
          context,
          context.account.kind === "guest" ? "login" : "incomplete",
          "The guide requires an established member account.",
        );
      if (
        payload?.ok === 1 &&
        payload.type === "guide" &&
        (integer(payload.schema) ?? 0) >= 7
      ) {
        if (
          payload.view !== view ||
          payload.kind !== kind ||
          payload.filter !== filter ||
          (payload.searchkey ?? "") !== searchKey ||
          positive(payload.fid) !== boardId
        )
          return failure(
            context,
            "invalid",
            "The guide scope differs from the requested view.",
          );
        const rows = structuredRows(
          payload.threads,
          actual.href,
          kind === "reply",
        );
        const paging = structuredPaging(payload, actual, doc, accepts);
        const modules: GuideModule[] = [];
        for (const item of Array.isArray(payload.modules)
          ? payload.modules
          : []) {
          const module = record(item);
          const more =
            typeof module?.more === "string" &&
            guideTarget(module.more, actual.href);
          const entries = structuredRows(module?.threads, actual.href);
          const count = integer(module?.count);
          if (
            !module ||
            !more ||
            more.searchParams.get("view") !== module.view ||
            !entries ||
            count === null ||
            typeof module.title !== "string" ||
            typeof module.empty !== "string"
          )
            return failure(
              context,
              "incomplete",
              "The guide index contains an incomplete module.",
            );
          modules.push({
            view: module.view as GuideView,
            title: module.title,
            more: more.href,
            count,
            emptyMessage: module.empty,
            rows: entries,
          });
        }
        if (rows && paging && (view !== "index" || modules.length > 0))
          return {
            ...context,
            ...paging,
            kind: "guide",
            view,
            scope,
            rows,
            modules,
          };
      }
      const rows =
        view !== "index" && view !== "my" ? nativeList(doc, actual.href) : null;
      if (rows)
        return {
          ...context,
          ...nativePaging(doc, actual.href, accepts),
          kind: "guide",
          view,
          scope,
          rows,
          modules: [],
        };
      return handoff(
        context,
        "Open this guide view in the native forum to see the requested listing.",
      );
    },
    async readMemberActivity(
      destination: string,
      options: MemberActivityOptions = {},
    ): Promise<MemberActivityResult> {
      const requested = memberTarget(destination, origin);
      if (!requested)
        return invalid(destination, "Use a member activity URL on this forum.");
      const scope = memberScope(requested);
      const accepts = (value: string) => {
        const url = memberTarget(value, origin);
        if (!url) return false;
        const actualScope = memberScope(url);
        return (
          actualScope.kind === scope.kind &&
          actualScope.filter === scope.filter &&
          actualScope.boardId === scope.boardId &&
          ["uid", "username"].every(
            (key) =>
              url.searchParams.get(key) === requested.searchParams.get(key),
          )
        );
      };
      const received = await receive(requested, transport, true, accepts);
      if ("kind" in received) return received;
      const { actual, payload, doc } = received;
      const legacy = legacyViewer(doc);
      const reported = received.context.account;
      if (
        legacy.kind !== "unknown" &&
        reported.kind !== "unknown" &&
        !sameAccount(legacy, reported)
      )
        return failure(
          received.context,
          "invalid",
          "The member page identifies conflicting viewer accounts.",
        );
      const viewer = reported.kind === "unknown" ? legacy : reported;
      const context = { ...received.context, account: viewer };
      if (viewer.kind === "guest")
        return failure(context, "login", "Sign in to read member activity.");
      if (
        options.viewerId !== undefined &&
        (viewer.kind !== "member" || viewer.id !== options.viewerId)
      )
        return failure(
          context,
          "invalid",
          "The page was not served to the expected viewer.",
        );
      if (
        payload?.ok === 1 &&
        payload.type === "mythread" &&
        (integer(payload.schema) ?? 0) >= 9
      ) {
        const owner = record(payload.owner);
        const ownerId = positive(owner?.uid);
        const self = viewer.kind === "member" && viewer.id === ownerId;
        const expectedOwner = actual.searchParams.get("username")
          ? null
          : actual.searchParams.get("uid");
        const ownerSpecified =
          actual.searchParams.has("uid") ||
          !!actual.searchParams.get("username");
        if (
          !ownerId ||
          !owner ||
          typeof owner.username !== "string" ||
          !owner.username.trim() ||
          (expectedOwner && ownerId !== expectedOwner) ||
          (!ownerSpecified && !self) ||
          payload.self !== Number(self) ||
          payload.view !== "me" ||
          payload.kind !== scope.kind ||
          payload.filter !== scope.filter ||
          positive(payload.fid) !== scope.boardId
        )
          return failure(
            context,
            "invalid",
            "The returned owner, viewer or list scope differs from the requested activity.",
          );
        const rows = structuredRows(
          payload.threads,
          actual.href,
          scope.kind === "reply",
        );
        const paging = structuredPaging(payload, actual, doc, accepts);
        if (
          rows &&
          paging &&
          (!scope.boardId ||
            rows.every((row) => row.board?.id === scope.boardId))
        )
          return {
            ...context,
            ...paging,
            kind: "member-activity",
            owner: { id: ownerId, name: owner.username },
            self,
            scope,
            hidden: integer(payload.hidden),
            rows,
          };
      }
      const native = nativeMemberActivity(
        { ...received, context },
        scope,
        accepts,
      );
      if (native) return native;
      return handoff(
        context,
        "Open the requested activity in the native forum to see this listing.",
      );
    },
  };
}
