import type {
  ModeratorSearchKind,
  ModeratorSearchPage,
  ModeratorSearchItem,
  ModeratorSearchResult,
} from "./types.js";
import type {
  PanelFailure,
  PanelLoginOffer,
  PanelSelectionOutcome,
} from "./types.js";
import type { ActivitySession } from "../activity-client.js";
import { id, record, string } from "../activity-protocol.js";
import {
  addQuery,
  assessSelection,
  exactFields,
  formhash,
  jsonRead,
  pageNumber,
  panelDestination,
  panelRefusal,
  panelRoute,
  positive,
  routeKeys,
  validSelection,
  type PanelContext,
  type PanelFields,
} from "./protocol.js";

const ops = { threads: "thread", posts: "post" } as const;
const filters = {
  threads: [
    "threadoption",
    "users",
    "keywords",
    "starttime",
    "endtime",
    "viewsmore",
    "viewsless",
    "repliesmore",
    "repliesless",
    "noreplydays",
    "typeid",
  ],
  posts: ["threadoption", "users", "keywords", "useip", "starttime", "endtime"],
};
interface BoundSearch {
  owner: ActivitySession;
  kind: ModeratorSearchKind;
  forumId: string;
  revision?: number;
  pages: number;
  servedIds: string[];
  search: { url: URL; fields: PanelFields; endtimeFixed: boolean } | null;
  result: URL | null;
  deletion: { url: URL; fields: PanelFields } | null;
}

function searchURL(
  value: unknown,
  source: URL,
  kind: ModeratorSearchKind,
  forumId: string,
) {
  const url = panelDestination(string(value), source, "thread", ops[kind]);
  if (
    !url ||
    !routeKeys(url, ["fid", "do", "posttableid"]) ||
    (url.searchParams.has("fid") && url.searchParams.get("fid") !== forumId)
  )
    return null;
  return url;
}

function decode(
  data: Record<string, unknown> | null,
  source: URL,
  kind: ModeratorSearchKind,
  forumId: string,
  owner: ActivitySession,
) {
  if (
    data?.ok !== 1 ||
    id(data.uid) !== owner.memberId ||
    data.type !== `modcp_${ops[kind]}` ||
    data.schema !== (kind === "threads" ? 36 : 37) ||
    String(data.fid) !== forumId ||
    !pageNumber(data.page) ||
    !Array.isArray(data[kind])
  )
    return null;
  const pages = data.pages === 0 ? 1 : data.pages;
  if (!pageNumber(pages) || pages < data.page) return null;
  const items: ModeratorSearchItem[] = [];
  for (const value of data[kind]) {
    const row = record(value);
    const threadId = id(row?.tid);
    const rowId = kind === "threads" ? threadId : id(row?.pid);
    const scope = id(row?.fid);
    if (
      !row ||
      !rowId ||
      !threadId ||
      !scope ||
      (forumId !== "0" && scope !== forumId) ||
      items.some((item) => item.id === rowId)
    )
      return null;
    items.push(
      Object.freeze({
        id: rowId,
        forumId: scope,
        threadId,
        subject: string(row.subject),
        message: string(row.message),
        author: string(row.author),
        authorId: id(row.authorid),
      }),
    );
  }
  const search = record(data.search);
  const searchTarget = searchURL(search?.url, source, kind, forumId);
  const searchFields = exactFields(search?.fields, [
    "do",
    "submit",
    "searchsubmit",
    "posttableid",
  ]);
  const boundSearch =
    search?.method === "GET" &&
    search.fid_field === "fid" &&
    searchTarget &&
    searchFields?.do === "search" &&
    (kind === "threads"
      ? searchFields.submit === "true"
      : searchFields.searchsubmit === "true") &&
    data.need_forum !== 1
      ? {
          url: searchTarget,
          fields: searchFields,
          endtimeFixed: record(data.limits)?.endtime_fixed === 1,
        }
      : null;
  const result = searchURL(data.list_url, source, kind, forumId);
  const offered = record(data.delete);
  const deleteUrl = searchURL(offered?.url, source, kind, forumId);
  const deleteFields = exactFields(offered?.fields, [
    "formhash",
    "fid",
    "do",
    "posttableid",
    "deletesubmit",
  ]);
  const deletion =
    kind === "posts" &&
    data.allow_delete === 1 &&
    offered?.method === "POST" &&
    offered.ids_field === "delete[]" &&
    offered.nocredit_field === "nocredit" &&
    deleteUrl &&
    deleteFields?.fid === forumId &&
    deleteFields.do === "delete" &&
    deleteFields.deletesubmit === "true" &&
    formhash(deleteFields.formhash)
      ? { url: addQuery(deleteUrl, { tsdmapp: "json" }), fields: deleteFields }
      : null;
  const page = Object.freeze({
    kind,
    forumId,
    page: data.page,
    pages,
    items: Object.freeze(items),
    canSearch: !!boundSearch,
    canDelete: !!deletion,
  });
  return {
    page,
    bound: {
      owner,
      kind,
      forumId,
      pages,
      servedIds: items.map((item) => item.id),
      search: boundSearch,
      result: result?.searchParams.get("do") === "list" ? result : null,
      deletion,
    },
  };
}

export function panelSearch(panel: PanelContext) {
  const bindings = new WeakMap<ModeratorSearchPage, BoundSearch>();
  const revision = { threads: 0, posts: 0 };
  const pending = new Set<ModeratorSearchKind>();

  async function load(
    url: URL,
    owner: ActivitySession,
    kind: ModeratorSearchKind,
    forumId: string,
    version?: number,
    effect = false,
  ): Promise<ModeratorSearchResult> {
    const reply = await panel.read(url, owner, effect);
    if (reply.kind !== "response") return reply;
    const data = reply.parsed.data;
    if (data?.error && data.error !== "0")
      return {
        kind: "refused",
        code: string(data.error_key) || "search-refused",
      };
    const found = decode(data, url, kind, forumId, owner);
    if (
      !found ||
      (url.searchParams.has("page") &&
        String(found.page.page) !== url.searchParams.get("page"))
    )
      return { kind: effect ? "uncertain" : "invalid-response" };
    if (version !== undefined && version !== revision[kind])
      return { kind: "stale" };
    bindings.set(found.page, {
      ...found.bound,
      ...(version !== undefined && { revision: version }),
    });
    return { kind: "search-page", page: found.page };
  }

  return {
    async readSearch(
      kind: ModeratorSearchKind,
      forumId = "0",
    ): Promise<ModeratorSearchResult> {
      if (!Object.hasOwn(ops, kind) || (forumId !== "0" && !positive(forumId)))
        return { kind: "invalid-input" };
      const owner = panel.session();
      if (!owner) return { kind: "refused", code: "login" };
      return load(
        panelRoute(panel.origin, {
          action: "thread",
          op: ops[kind],
          ...(forumId !== "0" && { fid: forumId }),
          ...jsonRead,
        }),
        owner,
        kind,
        forumId,
      );
    },
    async search(
      page: ModeratorSearchPage,
      conditions: Readonly<Record<string, string>>,
      confirmed: boolean,
    ): Promise<ModeratorSearchResult> {
      if (confirmed !== true) return { kind: "not-confirmed" };
      const bound = bindings.get(page);
      if (!bound) return { kind: "stale" };
      const { owner, kind, forumId, search } = bound;
      if (!panel.current(owner)) return { kind: "session-changed" };
      if (!search) return { kind: "refused", code: "search-unavailable" };
      const chosen = exactFields(conditions, filters[kind]);
      if (!chosen || (search.endtimeFixed && chosen.endtime?.trim()))
        return { kind: "invalid-input" };
      const selected = Object.fromEntries(
        Object.entries(chosen)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value),
      );
      if (
        !Object.keys(selected).length ||
        (kind === "posts" &&
          !["users", "keywords", "useip"].some((key) => selected[key]))
      )
        return { kind: "invalid-input" };
      if (pending.has(kind)) return { kind: "stale" };
      const version = ++revision[kind];
      pending.add(kind);
      try {
        return await load(
          addQuery(search.url, {
            ...search.fields,
            fid: forumId,
            ...selected,
            ...jsonRead,
          }),
          owner,
          kind,
          forumId,
          version,
          true,
        );
      } finally {
        pending.delete(kind);
      }
    },
    async readSearchResults(
      page: ModeratorSearchPage,
      number: number,
    ): Promise<ModeratorSearchResult> {
      const bound = bindings.get(page);
      if (
        !bound ||
        bound.revision === undefined ||
        bound.revision !== revision[bound.kind]
      )
        return { kind: "stale" };
      if (!bound.result || !pageNumber(number) || number > bound.pages)
        return { kind: "invalid-input" };
      return load(
        addQuery(bound.result, { page: String(number), ...jsonRead }),
        bound.owner,
        bound.kind,
        bound.forumId,
        bound.revision,
      );
    },
    async deleteSelectedPosts(
      page: ModeratorSearchPage,
      ids: readonly string[],
      keepCredits: boolean,
      confirmed: boolean,
    ): Promise<PanelFailure | PanelSelectionOutcome> {
      if (confirmed !== true) return { kind: "not-confirmed" };
      const bound = bindings.get(page);
      if (
        !bound ||
        (bound.revision !== undefined && bound.revision !== revision.posts) ||
        pending.has("posts")
      )
        return { kind: "stale" };
      if (!panel.current(bound.owner)) return { kind: "session-changed" };
      if (!bound.deletion)
        return { kind: "refused", code: "post-delete-unavailable" };
      if (
        !validSelection(ids, bound.servedIds) ||
        typeof keepCredits !== "boolean"
      )
        return { kind: "invalid-input" };
      const selected = [...ids];
      bindings.delete(page);
      const fields = new URLSearchParams(bound.deletion.fields);
      selected.forEach((id, index) => fields.append(`delete[${index}]`, id));
      if (keepCredits) fields.set("nocredit", "1");
      const after = await panel.write(bound.deletion.url, bound.owner, fields);
      if (after.kind !== "response") return after;
      const data = after.parsed.data;
      const problem = panelRefusal(after.response, after.parsed);
      if (problem) return problem;
      const found = decode(
        data,
        bound.deletion.url,
        "posts",
        bound.forumId,
        bound.owner,
      );
      if (!found) return { kind: "uncertain" };
      if (data?.error && data.error !== "0")
        return {
          kind: "refused",
          code: string(data.error_key) || "post-delete-refused",
        };
      const listed = found.bound.servedIds;
      return assessSelection(
        selected,
        listed,
        data?.message_key === "modcp_thread_delete_succeed" &&
          found.page.page === 1 &&
          found.page.pages === 1,
      );
    },
  };
}
