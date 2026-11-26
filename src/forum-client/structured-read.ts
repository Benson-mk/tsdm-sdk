import { attr, content, descendants, fragmentFrom, hasClass } from "./html.js";
import { linkedPostVideo } from "./linked-post-video.js";
import { readable } from "./read-thread.js";
import { cleanURL, routeFor } from "./routes.js";
import { decodeStructuredThread } from "./structured-thread.js";
import type {
  Account,
  Board,
  BoardFilterGroup,
  BoardLink,
  Homepage,
  ForumLink,
  HostResponse,
  Pagination,
  Post,
  Thread,
  ThreadRow,
} from "./types.js";

type Failure =
  | "limited"
  | "login"
  | "permission"
  | "missing"
  | "challenge"
  | "incomplete"
  | "invalid";

export type StructuredRead =
  | {
      kind: "homepage";
      homepage: Homepage;
      account: Account;
      sourceURL: string;
    }
  | { kind: "board"; board: Board; account: Account; sourceURL: string }
  | { kind: "thread"; thread: Thread; account: Account; sourceURL: string }
  | { kind: Failure; message: string; account: Account; sourceURL: string };

type Payload = Record<string, unknown>;

function object(value: unknown): Payload | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Payload)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

function positive(value: unknown): string | null {
  const result = string(value);
  return result && /^[1-9]\d*$/.test(result) ? result : null;
}

export function readAccount(payload: Payload): Account {
  const uid = payload.uid;
  if (typeof uid === "number" && Number.isSafeInteger(uid) && uid >= 0)
    return uid === 0
      ? { kind: "guest" }
      : { kind: "member", id: String(uid), name: `Member ${uid}` };
  return { kind: "unknown" };
}

function failure(
  kind: Failure,
  message: string,
  response: HostResponse,
  viewer: Account,
): StructuredRead {
  return { kind, message, account: viewer, sourceURL: response.url };
}

export function parseReadPayload(response: HostResponse): Payload | null {
  if (!/json/i.test(response.contentType) && !/^\s*\{/.test(response.body))
    return null;
  try {
    return object(JSON.parse(response.body));
  } catch {
    return null;
  }
}

export function structuredFailure(
  payload: Payload,
  response: HostResponse,
  viewer: Account,
): StructuredRead | null {
  if (response.status === 429)
    return failure(
      "limited",
      "The forum is limiting requests. Retry explicitly later.",
      response,
      viewer,
    );
  if (response.status === 404 || response.status === 410)
    return failure(
      "missing",
      "The requested forum resource is missing or has been deleted.",
      response,
      viewer,
    );
  if (response.status === 401 || payload.login === 1)
    return failure(
      "login",
      "Sign in through the native forum, then retry.",
      response,
      viewer,
    );
  const message = string(payload.message) ?? "";
  if (
    payload.ok === 0 &&
    /不存在|已[被經经]*删除|已[被經经]*刪除|not found/i.test(message)
  )
    return failure("missing", message, response, viewer);
  if (
    payload.ok === 0 &&
    /未登录|未登錄|先登录|先登錄|登录后|登入後/.test(message)
  )
    return failure("login", message, response, viewer);
  if (
    response.status === 403 ||
    (payload.ok === 0 && /权限|權限|用户组|用戶組|無權/.test(message))
  )
    return failure(
      "permission",
      "The current account does not have permission to read this resource.",
      response,
      viewer,
    );
  return null;
}

function pages(current: unknown, total: unknown, base: string): Pagination {
  const page = positive(current);
  const count = positive(total);
  if (!page)
    return { current: "", links: [], ...(count ? { total: count } : {}) };
  if (!count || Number(page) > Number(count))
    return { current: page, links: [] };
  const links = [Number(page) - 1, Number(page) + 1]
    .filter((next) => next >= 1 && next <= Number(count))
    .map((next) => {
      const url = new URL(base);
      url.hash = "";
      url.searchParams.delete("viewpid");
      url.searchParams.set("page", String(next));
      return { label: String(next), url: url.href };
    });
  return { current: page, links, total: count };
}

function threadURL(origin: string, id: string): string {
  return `${origin}/forum.php?mod=viewthread&tid=${id}`;
}

function boardURL(origin: string, id: string): string {
  return `${origin}/forum.php?mod=forumdisplay&fid=${id}`;
}

function preview(value: unknown): ThreadRow["preview"] {
  const data = object(value);
  if (!data) return undefined;
  return {
    excerpt: string(data.excerpt),
    reason: string(data.reason),
    imageTotal:
      typeof data.image_total === "number" &&
      Number.isSafeInteger(data.image_total)
        ? data.image_total
        : 0,
  };
}

function boardRow(
  row: Payload,
  origin: string,
  previews: boolean,
): ThreadRow | null {
  const id = positive(row.tid);
  const fid = positive(row.fid);
  const subject = string(row.subject);
  if (!id || !fid || !subject) return null;
  const result: ThreadRow = {
    id,
    rowId: id,
    label: subject,
    url: threadURL(origin, id),
    pinned:
      typeof row.displayorder === "number" &&
      Number.isSafeInteger(row.displayorder)
        ? row.displayorder > 0
        : false,
    moved: row.moved === 1 || row.moved === true,
    category: string(row.typename) ?? "",
    author: string(row.author) ?? "",
    date: string(row.dateline) ?? "",
    replies: string(row.replies) ?? "0",
    views: string(row.views) ?? "0",
    lastPost: positive(row.lastpost)
      ? {
          url: `${origin}/forum.php?mod=redirect&goto=lastpost&tid=${id}`,
          label: "Last post",
        }
      : null,
    latestReply: { author: string(row.lastposter), time: string(row.lastpost) },
    ...(positive(row.price)
      ? { restriction: "paid" }
      : positive(row.readperm)
        ? { restriction: "reading-permission" }
        : {}),
  };
  const excerpt = previews && preview(row.preview);
  if (excerpt) result.preview = excerpt;
  return result;
}

function boardLinks(value: unknown, origin: string): BoardLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const forum = object(entry);
    const id = positive(forum?.fid);
    const name = string(forum?.name);
    return id && name && !forum?.redirect
      ? [
          {
            id,
            label: name,
            url: boardURL(origin, id),
            description: string(forum?.description) ?? "",
            stats: "",
          },
        ]
      : [];
  });
}

function decodeHomepage(
  payload: Payload,
  response: HostResponse,
  requested: URL,
  viewer: Account,
): StructuredRead | null {
  if (!Array.isArray(payload.categories)) return null;
  const section = requested.searchParams.get("gid");
  const groups = payload.categories.flatMap((entry) => {
    const group = object(entry);
    const id = positive(group?.fid);
    const title = string(group?.name);
    if (!id || !title || (section && id !== section)) return [];
    return [
      {
        title,
        sourceId: id,
        sourceURL: `${requested.origin}/forum.php?gid=${id}`,
        boards: boardLinks(group?.forums, requested.origin),
      },
    ];
  });
  if (!groups.length) return null;
  const available = new Map(
    payload.categories.flatMap((entry) => {
      const forums = object(entry)?.forums;
      if (!Array.isArray(forums)) return [];
      return [
        ...boardLinks(forums, requested.origin),
        ...forums.flatMap((forum) =>
          boardLinks(object(forum)?.subforums, requested.origin),
        ),
      ].map((item) => [item.id, item] as const);
    }),
  );
  const favoriteBoards =
    Array.isArray(payload.favorites) && payload.favorites.length
      ? boardLinks(payload.favorites, requested.origin)
      : Array.isArray(payload.favorite_forums)
        ? payload.favorite_forums.flatMap((id) => {
            const item = available.get(String(id));
            return item ? [item] : [];
          })
        : [];
  const url = cleanURL(response.url);
  return {
    kind: "homepage",
    account: viewer,
    sourceURL: url,
    homepage: {
      url,
      groups,
      favoriteBoards,
      activities: [],
    },
  };
}

const filters = {
  typeid: "category",
  orderby: "order",
  specialtype: "type",
  dateline: "time",
  sortid: "unclassified",
} as const;

function boardFilters(payload: Payload, base: string): BoardFilterGroup[] {
  const options = object(payload.filters);
  return Object.entries(filters).flatMap(([key, kind]) => {
    const values =
      key === "typeid"
        ? object(payload.types)?.items
        : key === "sortid"
          ? object(payload.sorts)?.items
          : options?.[key];
    if (!Array.isArray(values)) return [];
    const links = values.flatMap((entry) => {
      const option = object(entry);
      const value = string(option?.value ?? option?.id);
      const name = string(option?.name);
      if (!value || !name) return [];
      const url = new URL(base);
      url.searchParams.delete("page");
      url.searchParams.set("filter", key);
      url.searchParams.set(key, value);
      return [{ label: name, url: url.href }];
    });
    return links.length ? [{ sourceId: key, kind, links }] : [];
  });
}

function returnedView(
  destination: string,
  values: Record<string, string>,
  page: unknown,
): string {
  const url = new URL(destination);
  for (const [key, value] of Object.entries(values)) {
    url.searchParams.delete(key);
    if (value !== "" && value !== "0") url.searchParams.set(key, value);
  }
  url.searchParams.delete("page");
  if (positive(page) && page !== 1 && page !== "1")
    url.searchParams.set("page", String(page));
  return url.href;
}

function board(
  payload: Payload,
  response: HostResponse,
  requested: NonNullable<ReturnType<typeof routeFor>>,
  viewer: Account,
  previews: boolean,
): StructuredRead {
  const forum = object(payload.forum);
  const id = forum && positive(forum.fid);
  const expected = requested.url.searchParams.get("fid");
  if (id && id !== expected)
    return failure(
      "invalid",
      "The returned board identity did not match the requested board.",
      response,
      viewer,
    );
  if (!forum || !id || !Array.isArray(payload.threads))
    return failure(
      "incomplete",
      "The structured board listing is incomplete.",
      response,
      viewer,
    );
  const rows = payload.threads
    .map((row) => object(row))
    .map((row) => (row ? boardRow(row, requested.url.origin, previews) : null));
  if (rows.some((row) => row === null))
    return failure(
      "incomplete",
      "A structured board row could not be interpreted.",
      response,
      viewer,
    );
  const query = Object.fromEntries(
    Object.entries(object(payload.query) ?? {}).flatMap(([key, value]) => {
      const item =
        Object.hasOwn(filters, key) ||
        ["filter", "ascdesc", "digest", "recommend", "archiveid"].includes(key)
          ? string(value)
          : null;
      return item === null ? [] : [[key, item]];
    }),
  );
  const count =
    Number.isSafeInteger(payload.count) && Number(payload.count) >= 0
      ? Number(payload.count)
      : undefined;
  if (
    !rows.length &&
    (count !== 0 ||
      positive(payload.page) !== "1" ||
      positive(payload.pages) !== "1" ||
      payload.hiddenexists === 1 ||
      !Object.hasOwn(query, "filter") ||
      Object.entries(query).some(
        ([key, value]) =>
          requested.url.searchParams.has(key) &&
          requested.url.searchParams.get(key) !== value,
      ) ||
      [...requested.url.searchParams.keys()].some(
        (key) =>
          (Object.hasOwn(filters, key) || key === "filter") &&
          !Object.hasOwn(query, key),
      ))
  )
    return failure(
      "incomplete",
      "The response did not establish an empty board view.",
      response,
      viewer,
    );
  const url = returnedView(cleanURL(response.url), query, payload.page);
  const filterGroups = boardFilters(payload, url);
  return {
    kind: "board",
    account: viewer,
    sourceURL: cleanURL(response.url),
    board: {
      id,
      title: string(forum.name) ?? `Board ${id}`,
      url,
      boards: boardLinks(payload.subforums, requested.url.origin),
      threads: rows.filter((row) => row !== null),
      filters: filterGroups.flatMap((group) => group.links),
      filterGroups,
      criteria: filterGroups.flatMap((group) =>
        group.links.filter((link) => {
          const params = new URL(link.url).searchParams;
          return query[group.sourceId] === params.get(group.sourceId);
        }),
      ),
      pages: pages(payload.page, payload.pages, url),
      empty: rows.length
        ? ""
        : "The forum returned no visible threads for this view.",
      ...(count === undefined ? {} : { count }),
      query,
    },
  };
}

export function decodeStructuredThreadPost(
  row: Payload,
  origin: string,
  threadId: string,
): Post | null {
  const id = positive(row.pid);
  if (!id) return null;
  const bodyHTML = typeof row.body_html === "string" ? row.body_html : "";
  const message = string(row.message);
  const fragment = fragmentFrom(bodyHTML);
  const restriction =
    row.deleted === 1
      ? "deleted"
      : row.invisible === 1
        ? "invisible"
        : (typeof row.message_reason === "string" && row.message_reason) ||
          (descendants(fragment, (node) => hasClass(node, "locked")).length
            ? "locked"
            : null);
  const body = bodyHTML
    ? content(fragment, origin)
    : message && !restriction
      ? [{ kind: "text" as const, text: message }]
      : [];
  if (!readable(body) && !restriction) return null;
  const messageCells = descendants(
    fragment,
    (node) => node.tagName === "td" && attr(node, "id") === `postmessage_${id}`,
  );
  if (messageCells.length === 1 && messageCells[0])
    body.push(...linkedPostVideo(messageCells[0]));
  return {
    id,
    author: string(row.author) ?? "Anonymous",
    authorId: positive(row.authorid),
    floor: string(row.position) ?? "",
    date: string(row.dateline) ?? "",
    url: `${origin}/forum.php?mod=redirect&goto=findpost&ptid=${threadId}&pid=${id}`,
    content: body,
    ...(restriction ? { restriction } : {}),
    ...(row.hot === 1 ? { promoted: true } : {}),
  };
}

function thread(
  payload: Payload,
  response: HostResponse,
  requested: NonNullable<ReturnType<typeof routeFor>>,
  actual: NonNullable<ReturnType<typeof routeFor>>,
  viewer: Account,
): StructuredRead {
  const details = object(payload.thread);
  const forum = object(payload.forum);
  const id = details && positive(details.tid);
  const expected = requested.url.searchParams.get("tid") ?? "";
  if (
    id &&
    ((requested.kind === "thread" && id !== expected) ||
      (actual.kind === "thread" && actual.url.searchParams.get("tid") !== id))
  )
    return failure(
      "invalid",
      "The returned thread identity did not match the requested thread.",
      response,
      viewer,
    );
  if (!details || !id)
    return failure(
      "incomplete",
      "The thread identity was absent.",
      response,
      viewer,
    );
  if (requested.kind === "redirect") {
    const expectedThread =
      requested.url.searchParams.get("ptid") ??
      requested.url.searchParams.get("tid");
    if (expectedThread && expectedThread !== id)
      return failure(
        "invalid",
        "The exact-post redirect landed in a different thread.",
        response,
        viewer,
      );
  }
  if (!Array.isArray(payload.posts))
    return failure(
      "incomplete",
      "The structured thread post list is incomplete.",
      response,
      viewer,
    );
  const posts = payload.posts
    .map((row) => object(row))
    .map((row) =>
      row ? decodeStructuredThreadPost(row, requested.url.origin, id) : null,
    );
  if (posts.some((row) => row === null))
    return failure(
      "incomplete",
      "A structured thread post could not be interpreted.",
      response,
      viewer,
    );
  if (!posts.length)
    return failure(
      "incomplete",
      "The structured thread did not establish an empty post view.",
      response,
      viewer,
    );
  const target =
    requested.kind === "redirect"
      ? (requested.url.searchParams.get("pid") ??
        /^#pid([1-9]\d*)$/.exec(actual.url.hash)?.[1] ??
        null)
      : (/^#pid([1-9]\d*)$/.exec(requested.url.hash)?.[1] ??
        requested.url.searchParams.get("viewpid") ??
        /^#pid([1-9]\d*)$/.exec(actual.url.hash)?.[1] ??
        null);
  if (
    (target && !posts.some((row) => row?.id === target)) ||
    (requested.kind === "redirect" && !target)
  )
    return failure(
      "invalid",
      "The exact post was not present in the returned thread.",
      response,
      viewer,
    );
  const authorId = positive(payload.authorid);
  const order = string(payload.ordertype);
  const base =
    actual.kind === "thread"
      ? cleanURL(actual.url.href)
      : threadURL(requested.url.origin, id);
  const url = returnedView(
    base,
    {
      ...(payload.authorid === undefined ? {} : { authorid: authorId ?? "0" }),
      ...(order === null ? {} : { ordertype: order }),
    },
    payload.page,
  );
  const special = threadSpecial(payload.special);
  const threadValue: Thread = {
    id,
    title: string(details.subject) ?? `Thread ${id}`,
    url,
    posts: posts.filter((row): row is Post => row !== null),
    pages: pages(payload.page, payload.pages, url),
    filters: [],
    parent:
      forum && positive(forum.fid)
        ? {
            label: string(forum.name) ?? `Board ${forum.fid}`,
            url: boardURL(requested.url.origin, positive(forum.fid)!),
          }
        : null,
    target,
    notices: [],
    ...(authorId ? { authorId } : {}),
    ...(order === "1" || order === "0" || order === "2"
      ? { order: order === "1" ? "descending" : "ascending" }
      : {}),
    ...(special ? { special } : {}),
  };
  return {
    kind: "thread",
    account: viewer,
    sourceURL: cleanURL(response.url),
    thread: threadValue,
  };
}

function threadSpecial(value: unknown): Thread["special"] {
  const special = object(value);
  if (!special) return;
  const type = special.type;
  if (type === "poll" && Array.isArray(special.choices)) {
    const resultsVisible =
      special.results_visible === 1 || special.results_visible === true;
    const choices = special.choices.flatMap((entry) => {
      const choice = object(entry);
      const id = positive(choice?.id);
      const text = string(choice?.text);
      const votes = choice?.votes;
      return id && text
        ? [
            {
              id,
              text,
              ...(resultsVisible && typeof votes === "number" ? { votes } : {}),
            },
          ]
        : [];
    });
    return { type, choices, resultsVisible };
  }
  if (
    type === "activity" ||
    type === "debate" ||
    type === "reward" ||
    type === "trade"
  ) {
    const displayKeys = {
      activity: [
        "class",
        "place",
        "starttimefrom",
        "starttimeto",
        "expiration",
        "cost",
        "credit",
        "number",
        "applied_count",
        "closed",
      ],
      debate: [
        "affirmpoint",
        "negapoint",
        "affirmvotes",
        "negavotes",
        "endtime",
        "ended",
        "umpire",
        "result",
      ],
      reward: ["credit", "price", "resolved"],
      trade: ["count", "credit_unit"],
    }[type];
    const details = Object.fromEntries(
      displayKeys.flatMap((key) => {
        const item = special[key];
        return item === null ||
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"
          ? [[key, item]]
          : [];
      }),
    );
    return { type, details };
  }
}

export function decodeStructured(
  response: HostResponse,
  requestedURL: string,
  payload: Payload,
  previews: boolean,
): StructuredRead | null {
  const requested = routeFor(requestedURL);
  const actual = routeFor(response.url);
  if (
    !requested ||
    !actual ||
    requested.url.origin !== actual.url.origin ||
    payload.ok !== 1
  )
    return null;
  const viewer = readAccount(payload);
  if (
    requested.kind === "directory" &&
    actual.kind === "directory" &&
    payload.type === "index" &&
    payload.schema === 5
  )
    return decodeHomepage(payload, response, requested.url, viewer);
  if (
    requested.kind === "board" &&
    actual.kind === "board" &&
    payload.type === "forum" &&
    payload.schema === 2
  ) {
    if (
      actual.url.searchParams.get("fid") !==
      requested.url.searchParams.get("fid")
    )
      return failure(
        "invalid",
        "The response landed on a different board.",
        response,
        viewer,
      );
    return board(payload, response, requested, viewer, previews);
  }
  if (
    (requested.kind === "thread" || requested.kind === "redirect") &&
    (actual.kind === "thread" ||
      (actual.kind === "redirect" && requested.kind === "redirect"))
  ) {
    const page = decodeStructuredThread(payload);
    if (page) return thread(page, response, requested, actual, viewer);
  }
  return null;
}
