import type { ForumTransport } from "../../index.js";
import { byId, descendants, hasClass, label } from "../html.js";
import {
  anchors,
  clean,
  failure,
  first,
  handoff,
  integer,
  invalid,
  nativePaging,
  nativeThread,
  positive,
  receive,
  sameAccount,
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

export interface SearchQuery {
  keyword?: string;
  authorName?: string;
  authorId?: string;
  boardIds?: readonly string[];
  sinceSeconds?: number;
  fullText?: boolean;
  orderBy?: "lastpost" | "dateline" | "replies" | "views";
  ascending?: boolean;
}
export type SearchPage = Context &
  PageLinks & {
    kind: "search";
    searchId: string;
    keyword: string | null;
    fullText: boolean | null;
    count: number | null;
    rows: DiscoveryThread[];
  };
export type SearchResult = DiscoveryFailure | SearchPage;
const searchPath = "/search.php?mod=forum";
const searchOrder: readonly string[] = [
  "lastpost",
  "dateline",
  "replies",
  "views",
];
function searchTarget(value: string, base: string): URL | null {
  return target(value, base, "/search.php", "forum");
}
function resultTarget(value: string, base: string): URL | null {
  const url = searchTarget(value, base);
  const order = url?.searchParams.get("orderby");
  const direction = url?.searchParams.get("ascdesc");
  if (
    !url ||
    !positive(url.searchParams.get("searchid")) ||
    (order && !searchOrder.includes(order)) ||
    (direction && !["asc", "desc"].includes(direction)) ||
    url.searchParams.get("searchsubmit") !== "yes" ||
    [...url.searchParams.keys()].some(
      (key) =>
        ![
          "mod",
          "searchid",
          "orderby",
          "ascdesc",
          "searchsubmit",
          "page",
          "tsdmapp",
          "nodoc",
          "tsdmpreview",
          "tsdmv",
        ].includes(key),
    )
  )
    return null;
  return url;
}
function searchBase(
  base: URL,
  id: string,
  order: string,
  direction: string,
  page: string,
): URL {
  const url = new URL(searchPath, base);
  url.searchParams.set("searchid", id);
  url.searchParams.set("orderby", order);
  url.searchParams.set("ascdesc", direction);
  url.searchParams.set("searchsubmit", "yes");
  if (page !== "1") url.searchParams.set("page", page);
  return url;
}
function submissionURL(origin: string, query: SearchQuery): URL | null {
  const {
    keyword = "",
    authorName = "",
    authorId,
    boardIds = [],
    sinceSeconds,
    fullText,
    orderBy,
    ascending,
  } = query;
  if (
    !(keyword.trim() || authorName.trim() || authorId) ||
    (authorId !== undefined && !positive(authorId)) ||
    boardIds.some((id) => !positive(id)) ||
    (sinceSeconds !== undefined && integer(sinceSeconds) === null) ||
    (orderBy && !searchOrder.includes(orderBy))
  )
    return null;
  const url = new URL(searchPath, origin);
  const params = url.searchParams;
  params.set("srchtxt", keyword);
  if (authorName) params.set("srchuname", authorName);
  if (authorId) params.set("srchuid", authorId);
  if (boardIds.length === 1) params.set("srchfid[]", boardIds[0]!);
  if (boardIds.length > 1) params.set("srchfid", boardIds.join("_"));
  if (sinceSeconds) params.set("srchfrom", String(sinceSeconds));
  if (fullText) params.set("srchtype", "fulltext");
  if ((orderBy && orderBy !== "lastpost") || ascending) {
    params.set("orderby", orderBy ?? "lastpost");
    params.set("ascdesc", ascending ? "asc" : "desc");
  }
  params.set("searchsubmit", "yes");
  return url;
}
function decodeSearch(received: Received, prior?: SearchPage): SearchResult {
  const { context, actual, payload, doc } = received;
  const returned = resultTarget(actual.href, actual.href);
  const returnedId = returned?.searchParams.get("searchid");
  const accepts =
    (id: string, order: string, direction: string) => (value: string) => {
      const params = resultTarget(value, actual.href)?.searchParams;
      return (
        params?.get("searchid") === id &&
        (params.get("orderby") || "lastpost") === order &&
        (params.get("ascdesc") || "desc") === direction
      );
    };
  if (
    payload?.ok === 1 &&
    payload.type === "search" &&
    (integer(payload.schema) ?? 0) >= 6
  ) {
    const id = positive(payload.searchid);
    const page = positive(payload.page);
    const count = integer(payload.count);
    const order = payload.orderby;
    const direction = payload.ascdesc;
    const rows = structuredRows(payload.threads, actual.href);
    if (
      !id ||
      (returnedId && returnedId !== id) ||
      (prior && prior.searchId !== id)
    )
      return failure(
        context,
        "invalid",
        "The page belongs to a different or unestablished search.",
      );
    if (
      page &&
      count !== null &&
      rows &&
      (count === 0) === (rows.length === 0) &&
      typeof order === "string" &&
      searchOrder.includes(order) &&
      (direction === "asc" || direction === "desc")
    ) {
      const base = returned ?? searchBase(actual, id, order, direction, page);
      if (
        returned &&
        ((returned.searchParams.get("orderby") || "lastpost") !== order ||
          (returned.searchParams.get("ascdesc") || "desc") !== direction)
      )
        return failure(
          context,
          "invalid",
          "The search order changed during the result read.",
        );
      const paging = structuredPaging(
        payload,
        base,
        doc,
        accepts(id, order, direction),
      );
      if (paging)
        return {
          ...context,
          ...paging,
          sourceURL: base.href,
          kind: "search",
          searchId: id,
          count,
          rows,
          keyword: typeof payload.keyword === "string" ? payload.keyword : null,
          fullText:
            payload.fulltext === 1
              ? true
              : payload.fulltext === 0
                ? false
                : null,
        };
    }
  }
  const listing = byId(doc, "threadlist");
  const summary = first(doc, (node) => hasClass(node, "sttl"));
  const countText = label(summary).match(
    /(?:内容|內容|主题|主題)\s*(\d+)\s*个|\b(\d+)\s+(?:results|matches)/i,
  );
  const count = countText ? Number(countText[1] ?? countText[2]) : null;
  const entries = listing
    ? descendants(
        listing,
        (node) => node.tagName === "li" && hasClass(node, "pbw"),
      )
    : [];
  const rows = entries.map((entry) => {
    const heading = first(entry, (node) => node.tagName === "h3");
    const row = nativeThread(
      heading && anchors(heading)[0],
      entry,
      actual.href,
    );
    const paragraphs = descendants(entry, (node) => node.tagName === "p");
    return row
      ? {
          ...row,
          summary: paragraphs.length >= 3 ? label(paragraphs[1]) : null,
        }
      : null;
  });
  const empty =
    count === 0 &&
    !!first(
      doc,
      (node) =>
        hasClass(node, "emp") &&
        /没有找到|沒有找到|no matching/i.test(label(node)),
    );
  const pager = nativePaging(
    doc,
    actual.href,
    (value) => !!resultTarget(value, actual.href),
  );
  const ids = new Set(
    [
      returnedId,
      ...pager.pages.links.map((item) =>
        new URL(item.url).searchParams.get("searchid"),
      ),
    ].filter((id): id is string => !!id),
  );
  if (ids.size > 1)
    return failure(
      context,
      "invalid",
      "The returned links describe different searches.",
    );
  const id = [...ids][0];
  if (
    id &&
    (!prior || id === prior.searchId) &&
    (rows.length || empty) &&
    rows.every((row) => row !== null)
  ) {
    const template = new URL(pager.pages.links[0]?.url ?? actual.href);
    const base =
      returned ??
      searchBase(
        actual,
        id,
        template.searchParams.get("orderby") || "lastpost",
        template.searchParams.get("ascdesc") || "desc",
        pager.pages.current,
      );
    const keyword =
      summary && first(summary, (node) => hasClass(node, "emfont"));
    return {
      ...context,
      ...pager,
      sourceURL: base.href,
      kind: "search",
      searchId: id,
      count,
      rows,
      keyword: keyword ? label(keyword) : (prior?.keyword ?? null),
      fullText: null,
    };
  }
  return failure(
    context,
    "incomplete",
    "The forum did not establish this search result. The submission may have used quota or credits.",
  );
}

export function createSearchReads(origin: string, transport: ForumTransport) {
  return {
    async openSearch(): Promise<DiscoveryFailure> {
      const requested = new URL(searchPath, origin);
      const received = await receive(requested, transport, true, (value) => {
        const url = searchTarget(value, origin);
        return (
          !!url &&
          !url.searchParams.has("searchid") &&
          !url.searchParams.has("searchsubmit")
        );
      });
      if ("kind" in received) return received;
      return handoff(
        received.context,
        "Open the native search form to inspect forum controls and restrictions.",
      );
    },
    async submitSearch(query: SearchQuery): Promise<SearchResult> {
      const requested = submissionURL(origin, query);
      if (!requested)
        return invalid(
          new URL(searchPath, origin).href,
          "Provide valid search criteria before submitting.",
        );
      const received = await receive(requested, transport, true, (value) => {
        const url = searchTarget(value, origin);
        return (
          !!url &&
          (url.href === requested.href ||
            clean(url).href === requested.href ||
            !!resultTarget(value, origin))
        );
      });
      return "kind" in received ? received : decodeSearch(received);
    },
    async continueSearch(
      prior: SearchPage,
      destination = prior.nextURL,
    ): Promise<SearchResult> {
      const requested = destination && resultTarget(destination, origin);
      if (
        !requested ||
        requested.searchParams.get("searchid") !== prior.searchId ||
        !prior.pages.links.some((item) => item.url === destination)
      )
        return invalid(
          prior.sourceURL,
          "Choose a continuation offered by these search results.",
        );
      const received = await receive(
        requested,
        transport,
        true,
        (value) =>
          resultTarget(value, origin)?.searchParams.get("searchid") ===
          prior.searchId,
      );
      if ("kind" in received) return received;
      if (
        !sameAccount(prior.account, received.context.account) &&
        (prior.account.kind !== "unknown" ||
          received.context.account.kind !== "unknown")
      )
        return failure(
          received.context,
          "invalid",
          "The search viewer changed or could not be established.",
        );
      return decodeSearch(received, prior);
    },
  };
}
