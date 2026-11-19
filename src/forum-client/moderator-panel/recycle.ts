import type {
  ModeratorRecycleBinKind,
  ModeratorRecycleMode,
  ModeratorRecycleItem,
  ModeratorRecycleBinPage,
  ModeratorRecycleResult,
} from "./types.js";
import type {
  PanelFailure,
  PanelLoginOffer,
  PanelSelectionOutcome,
} from "./types.js";
import type { ActivitySession } from "../activity-client.js";
import { id, record, string } from "../activity-protocol.js";
import {
  attr,
  controlDisabled,
  descendants,
  label,
  type Node,
} from "../html.js";
import {
  activePanelTab,
  authorLink,
  hasNext,
  offeredEmpty,
  panelForms,
  selectedForum,
  selectedRows,
} from "./native.js";
import {
  addQuery,
  assessSelection,
  discoverPanelMode,
  exactFields,
  formhash,
  hidden,
  jsonV4Read,
  jsonV4Write,
  pageNumber,
  panelDestination,
  panelRefusal,
  panelRoute,
  positive,
  validSelection,
  type PanelContext,
  type PanelFields,
} from "./protocol.js";

type BinAction = "restore" | "delete";
const actions = { threads: "recyclebin", posts: "recyclebinpost" } as const;
const postFilters = ["keywords", "users", "starttime", "endtime"];
const threadFilters = [
  ...postFilters,
  "threadoption",
  "typeid",
  "viewsmore",
  "viewsless",
  "repliesmore",
  "repliesless",
  "noreplydays",
];
const binIncludes = (kind: ModeratorRecycleBinKind) =>
  kind === "threads" ? threadFilters : postFilters;
interface BinSearch {
  url: URL;
  token: string;
  filters: readonly string[];
  posttable?: string;
}
interface BinBinding {
  owner: ActivitySession;
  structured: boolean;
  filtered: boolean;
  posttable?: string;
  fields: PanelFields | null;
  search: BinSearch | null;
}
interface BinData extends Omit<BinBinding, "owner"> {
  items: ModeratorRecycleItem[];
  number: number;
  hasNext: boolean;
  restore: boolean;
  clear: boolean;
}
const digits = (value: unknown): value is string =>
  typeof value === "string" && /^\d+$/.test(value);

function nativeBin(
  doc: Node,
  url: URL,
  kind: ModeratorRecycleBinKind,
  forumId: string,
  number: number,
  filtered: boolean,
): BinData | null {
  const action = actions[kind];
  if (!activePanelTab(doc, url, action) || selectedForum(doc) !== forumId)
    return null;
  const searchForms = panelForms(doc, url, action, "search");
  const searchForm = searchForms.length === 1 ? searchForms[0] : undefined;
  const searchUrl =
    searchForm &&
    panelDestination(attr(searchForm, "action"), url, action, "search");
  const searchToken = searchForm && hidden(searchForm, ["formhash"])?.formhash;
  const submitButton =
    searchForm &&
    descendants(
      searchForm,
      (node) =>
        ["button", "input"].includes(node.tagName) &&
        attr(node, "type") === "submit" &&
        attr(node, "name") === "searchsubmit" &&
        attr(node, "value") === "true" &&
        !controlDisabled(node),
    );
  const offered =
    searchForm &&
    descendants(
      searchForm,
      (node) =>
        ["input", "select"].includes(node.tagName) && !controlDisabled(node),
    );
  const search =
    searchUrl &&
    searchUrl.searchParams.size === 3 &&
    formhash(searchToken) &&
    submitButton?.length === 1
      ? {
          url: searchUrl,
          token: searchToken,
          filters: binIncludes(kind).filter((key) =>
            offered?.some((node) => attr(node, "name") === key),
          ),
        }
      : null;
  const bulk = panelForms(doc, url, action).filter(
    (form) => attr(form, "id") === "moderate",
  );
  if (!bulk.length && offeredEmpty(doc))
    return {
      items: [],
      number,
      hasNext: hasNext(doc),
      restore: false,
      clear: false,
      fields: null,
      search,
      filtered,
      structured: false,
    };
  if (bulk.length !== 1) return null;
  const form = bulk[0]!;
  const target = panelDestination(attr(form, "action"), url, action);
  const served = hidden(form, ["formhash", "oldop", "dosubmit", "posttableid"]);
  if (
    !target ||
    target.searchParams.size !== 3 ||
    target.searchParams.get("fid") !== forumId ||
    !served ||
    !formhash(served.formhash) ||
    !["list", "search"].includes(served.oldop ?? "") ||
    served.dosubmit !== "submit" ||
    (kind === "posts" && !digits(served.posttableid))
  )
    return null;
  const fields: PanelFields = {
    formhash: served.formhash,
    ...(kind === "posts" && { posttableid: served.posttableid! }),
  };
  const rows = selectedRows(form, (node) => node.tagName === "tr");
  if (!rows) return null;
  const items = rows.map(({ id: rowId, row }) => {
    const links = descendants(row, (node) => node.tagName === "a");
    const content = links.find((link) =>
      kind === "posts"
        ? /[?&]goto=findpost(?:&|$)/.test(attr(link, "href"))
        : /[?&]tid=(\d+)(?:&|$)/.exec(attr(link, "href"))?.[1] === rowId,
    );
    const author = links.find((link) => authorLink(link));
    const threadId =
      kind === "threads"
        ? rowId
        : id(content && /[?&]ptid=(\d+)/.exec(attr(content, "href"))?.[1]);
    return Object.freeze({
      id: rowId,
      threadId,
      title: label(content),
      author: label(author),
      authorId: authorLink(author),
    });
  });
  const allowed = (value: BinAction) =>
    descendants(
      form,
      (node) =>
        node.tagName === "button" &&
        !controlDisabled(node) &&
        new RegExp(
          `^\\s*modthreads\\('${value}'\\)(?:;\\s*return false)?;?\\s*$`,
        ).test(attr(node, "onclick")),
    ).length > 0;
  return {
    fields,
    ...(kind === "posts" && { posttable: served.posttableid! }),
    items,
    number,
    hasNext: hasNext(doc),
    restore: allowed("restore"),
    clear: allowed("delete"),
    search,
    filtered,
    structured: false,
  };
}

function structuredBin(
  data: Record<string, unknown>,
  url: URL,
  owner: ActivitySession,
  kind: ModeratorRecycleBinKind,
  forumId: string,
  filtered: boolean,
): BinData | null {
  if (
    data.ok !== 1 ||
    data.schema !== 45 ||
    id(data.uid) !== owner.memberId ||
    String(data.fid) !== forumId ||
    data.enabled !== 1 ||
    data.need_forum === 1 ||
    !pageNumber(data.page) ||
    typeof data.pages !== "number" ||
    !Number.isSafeInteger(data.pages) ||
    !Array.isArray(data[kind])
  )
    return null;
  const action = actions[kind];
  const items: ModeratorRecycleItem[] = [];
  for (const raw of data[kind]) {
    const row = record(raw);
    const rowId = id(kind === "threads" ? row?.tid : row?.pid);
    if (
      !row ||
      !rowId ||
      id(row.fid) !== forumId ||
      items.some((item) => item.id === rowId)
    )
      return null;
    items.push(
      Object.freeze({
        id: rowId,
        threadId: id(row.tid),
        title: string(kind === "threads" ? row.subject : row.message),
        author: string(row.author),
        authorId: id(row.authorid),
      }),
    );
  }
  const offer = record(data.submit);
  const dest = panelDestination(string(offer?.url), url, action);
  const fixed = exactFields(offer?.fields, [
    "formhash",
    "oldop",
    "dosubmit",
    "posttableid",
  ]);
  const canSend =
    dest &&
    dest.searchParams.size === 3 &&
    dest.searchParams.get("fid") === forumId &&
    offer?.method === "POST" &&
    offer.ids_field === "moderate[]" &&
    offer.action_field === "op" &&
    fixed?.dosubmit === "submit" &&
    ["list", "search"].includes(fixed.oldop ?? "") &&
    formhash(fixed.formhash) &&
    (kind !== "posts" || digits(fixed.posttableid));
  const fields =
    canSend && fixed
      ? {
          formhash: fixed.formhash!,
          ...(kind === "posts" && { posttableid: fixed.posttableid! }),
        }
      : null;
  const available =
    Array.isArray(offer?.actions) && fields ? offer.actions : [];
  const searchOffer = record(data.search);
  const searchUrl = panelDestination(
    string(searchOffer?.url),
    url,
    action,
    "search",
  );
  const searchFields = exactFields(searchOffer?.fields, [
    "formhash",
    "searchsubmit",
  ]);
  const table =
    data.posttableid === undefined
      ? fixed?.posttableid
      : String(data.posttableid);
  const search =
    searchUrl &&
    searchUrl.searchParams.size === 3 &&
    searchOffer?.method === "POST" &&
    searchOffer.fid_field === "fid" &&
    searchFields?.searchsubmit === "true" &&
    formhash(searchFields.formhash) &&
    (kind === "threads" ||
      (searchOffer.posttable_field === "posttableid" && digits(table)))
      ? {
          url: addQuery(searchUrl, jsonV4Write),
          token: searchFields.formhash,
          filters: binIncludes(kind),
          ...(kind === "posts" && table !== undefined && { posttable: table }),
        }
      : null;
  return {
    fields,
    ...(kind === "posts" && digits(table) && { posttable: table }),
    items,
    number: data.page,
    hasNext: data.page < data.pages,
    restore: available.includes("restore"),
    clear: data.can_delete === 1 && available.includes("delete"),
    search,
    filtered,
    structured: true,
  };
}

export function panelRecycle(panel: PanelContext) {
  const bindings = new WeakMap<ModeratorRecycleBinPage, BinBinding>();
  const readUrl = (
    kind: ModeratorRecycleBinKind,
    forumId: string,
    number: number,
    structured: boolean,
  ) =>
    panelRoute(panel.origin, {
      action: actions[kind],
      fid: forumId,
      ...(number > 1 && { page: String(number) }),
      ...(structured && jsonV4Read),
    });
  function decode(
    reply: Extract<
      Awaited<ReturnType<PanelContext["write"]>>,
      { kind: "response" }
    >,
    url: URL,
    owner: ActivitySession,
    kind: ModeratorRecycleBinKind,
    forumId: string,
    number: number,
    filtered: boolean,
  ) {
    const { data, doc } = reply.parsed;
    if (data?.type === `modcp_${actions[kind]}`)
      return structuredBin(data, url, owner, kind, forumId, filtered);
    return nativeBin(doc, url, kind, forumId, number, filtered);
  }
  function expose(
    bin: BinData,
    owner: ActivitySession,
    kind: ModeratorRecycleBinKind,
    forumId: string,
  ): ModeratorRecycleResult {
    const page = Object.freeze({
      kind,
      forumId,
      number: bin.number,
      hasNext: bin.hasNext,
      items: Object.freeze(bin.items),
      canSearch: !!bin.search,
      canRestore: bin.restore,
      canPermanentlyDelete: bin.clear,
    });
    bindings.set(page, {
      owner,
      structured: bin.structured,
      filtered: bin.filtered,
      ...(bin.posttable !== undefined && { posttable: bin.posttable }),
      fields: bin.fields,
      search: bin.search,
    });
    return { kind: "recycle-bin", page };
  }
  async function load(
    kind: ModeratorRecycleBinKind,
    forumId: string,
    number: number,
    owner: ActivitySession,
    structured: boolean,
  ): Promise<ModeratorRecycleResult> {
    const url = readUrl(kind, forumId, number, structured);
    const reply = await panel.read(url, owner);
    if (reply.kind !== "response") return reply;
    const bin = decode(reply, url, owner, kind, forumId, number, false);
    if (
      !bin &&
      structured &&
      reply.parsed.data?.type !== `modcp_${actions[kind]}`
    )
      return load(kind, forumId, number, owner, false);
    if (!bin || bin.number !== number) return { kind: "invalid-response" };
    return expose(bin, owner, kind, forumId);
  }
  async function change(
    page: ModeratorRecycleBinPage,
    ids: readonly string[],
    op: BinAction,
    confirmed: boolean,
  ): Promise<PanelFailure | PanelSelectionOutcome> {
    if (confirmed !== true) return { kind: "not-confirmed" };
    const bound = bindings.get(page);
    if (!bound) return { kind: "stale" };
    if (!panel.current(bound.owner)) return { kind: "session-changed" };
    if (
      !bound.fields ||
      !(op === "restore" ? page.canRestore : page.canPermanentlyDelete)
    )
      return { kind: "refused", code: `bin-${op}-unavailable` };
    if (
      !validSelection(
        ids,
        page.items.map((item) => item.id),
      )
    )
      return { kind: "invalid-input" };
    const selected = [...ids];
    const url = panelRoute(panel.origin, {
      action: actions[page.kind],
      fid: page.forumId,
      page: "1",
      ...(bound.structured && jsonV4Write),
    });
    const fields = new URLSearchParams({
      ...bound.fields,
      op,
      oldop: "list",
      dosubmit: "submit",
    });
    selected.forEach((item, index) => fields.set(`moderate[${index}]`, item));
    bindings.delete(page);
    const reply = await panel.write(url, bound.owner, fields);
    if (reply.kind !== "response") return reply;
    const problem = panelRefusal(reply.response, reply.parsed);
    if (problem) return problem;
    const returned = decode(
      reply,
      url,
      bound.owner,
      page.kind,
      page.forumId,
      1,
      false,
    );
    const tableMatches = (actual: string | undefined) =>
      page.kind === "threads" ||
      actual === bound.posttable ||
      (actual === undefined && bound.posttable === "0");
    if (!returned || returned.number !== 1) return { kind: "uncertain" };
    const listed = new Set(
      tableMatches(returned.posttable)
        ? returned.items.map((item) => item.id)
        : [],
    );
    const limit = bound.filtered ? 1 : page.number;
    for (let number = 1; number <= limit; number++) {
      const verified = await load(
        page.kind,
        page.forumId,
        number,
        bound.owner,
        bound.structured,
      );
      if (
        verified.kind !== "recycle-bin" ||
        !tableMatches(bindings.get(verified.page)?.posttable)
      )
        return assessSelection(selected, [...listed], false);
      verified.page.items.forEach((item) => listed.add(item.id));
      if (!verified.page.hasNext || selected.every((item) => listed.has(item)))
        return assessSelection(selected, [...listed], true);
    }
    return assessSelection(selected, [...listed], false);
  }
  return {
    async readRecycleBin(
      kind: ModeratorRecycleBinKind,
      forumId: string,
      number = 1,
      mode: ModeratorRecycleMode = "auto",
    ): Promise<ModeratorRecycleResult> {
      if (
        !Object.hasOwn(actions, kind) ||
        !positive(forumId) ||
        !pageNumber(number) ||
        (mode !== "auto" && mode !== "native")
      )
        return { kind: "invalid-input" };
      const owner = panel.session();
      if (!owner) return { kind: "refused", code: "login" };
      const structured =
        mode === "native"
          ? false
          : await discoverPanelMode(panel, owner, actions[kind]);
      return typeof structured === "boolean"
        ? load(kind, forumId, number, owner, structured)
        : structured;
    },
    async searchRecycleBin(
      page: ModeratorRecycleBinPage,
      conditions: Readonly<Record<string, string>>,
      confirmed: boolean,
    ): Promise<ModeratorRecycleResult> {
      if (confirmed !== true) return { kind: "not-confirmed" };
      const bound = bindings.get(page);
      if (!bound) return { kind: "stale" };
      if (!panel.current(bound.owner)) return { kind: "session-changed" };
      if (!bound.search)
        return { kind: "refused", code: "bin-search-unavailable" };
      const chosen = exactFields(conditions, bound.search.filters);
      if (!chosen) return { kind: "invalid-input" };
      const criteria = Object.fromEntries(
        Object.entries(chosen)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value),
      );
      if (!Object.keys(criteria).length) return { kind: "invalid-input" };
      const { url, token, posttable } = bound.search;
      const fields = new URLSearchParams({
        formhash: token,
        fid: page.forumId,
        ...criteria,
        ...(posttable !== undefined && { posttableid: posttable }),
        searchsubmit: "true",
      });
      const reply = await panel.write(url, bound.owner, fields);
      if (reply.kind !== "response") return reply;
      const problem = panelRefusal(reply.response, reply.parsed);
      if (problem) return problem;
      const bin = decode(
        reply,
        url,
        bound.owner,
        page.kind,
        page.forumId,
        1,
        true,
      );
      return bin && bin.number === 1
        ? expose(bin, bound.owner, page.kind, page.forumId)
        : { kind: "uncertain" };
    },
    restoreFromRecycleBin: (
      page: ModeratorRecycleBinPage,
      ids: readonly string[],
      confirmed: boolean,
    ) => change(page, ids, "restore", confirmed),
    permanentlyDeleteFromRecycleBin: (
      page: ModeratorRecycleBinPage,
      ids: readonly string[],
      confirmed: boolean,
    ) => change(page, ids, "delete", confirmed),
  };
}
