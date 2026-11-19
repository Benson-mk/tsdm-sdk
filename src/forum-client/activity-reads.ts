import {
  attr,
  byId,
  children,
  element,
  hasClass,
  label,
  descendants,
  type Node,
} from "./html.js";
import {
  activityURL,
  answer,
  id,
  int,
  record,
  responseIssue,
  rows,
  string,
  targetMatches,
} from "./activity-protocol.js";
import { numericId } from "./notice-transport.js";
import type { HostResponse } from "./types.js";

import type {
  ActivityFailure,
  ActivityQuery,
  ActivityRead,
  Member,
} from "./activity-read-types.js";

type View = OmitActivityContext<ActivityRead>;
type OmitActivityContext<T> = T extends ActivityRead
  ? Omit<T, "sourceURL" | "viewerId" | "target">
  : never;
const actions = {
  ratings: "viewratings",
  voters: "viewvote",
  moderation: "viewthreadmod",
  payments: "viewpayments",
  warnings: "viewwarning",
  comments: "commentmore",
};
const schemas = {
  ratings: [48, "ratings"],
  voters: [49, "poll_voters"],
  moderation: [50, "thread_mod"],
  payments: [51, "payments"],
  comments: [22, "comments"],
} as const;
export function addWindow(url: URL, handle: string) {
  url.searchParams.set("infloat", "yes");
  url.searchParams.set("handlekey", handle);
  url.searchParams.set("inajax", "1");
  url.searchParams.set("ajaxtarget", `fwin_content_${handle}`);
}
export function activityReadURL(base: URL, q: ActivityQuery, native: boolean) {
  if (
    !Object.hasOwn(actions, q.view) ||
    !id(q.threadId) ||
    (["ratings", "comments"].includes(q.view) &&
      (!("postId" in q) || !id(q.postId))) ||
    (q.view === "warnings" && !id(q.memberId)) ||
    (q.view === "voters" && q.optionId !== undefined && !id(q.optionId)) ||
    (q.view === "comments" && q.page === undefined) ||
    ("page" in q &&
      q.page !== undefined &&
      (int(q.page) === null || q.page < 1))
  )
    return null;
  const url = new URL("/forum.php", base);
  url.search = new URLSearchParams({
    mod: "misc",
    action: actions[q.view],
    tid: q.threadId,
  }).toString();
  if ("postId" in q) url.searchParams.set("pid", q.postId);
  if (q.view === "warnings") url.searchParams.set("uid", q.memberId);
  if (q.view === "voters" && q.optionId)
    url.searchParams.set("polloptionid", q.optionId);
  if ("page" in q && q.page !== undefined)
    url.searchParams.set("page", String(q.page));
  if (
    q.view === "warnings" ||
    q.view === "comments" ||
    (native && q.view === "voters")
  )
    url.searchParams.set("inajax", "1");
  else if (native)
    addWindow(url, q.view === "payments" ? "pay" : actions[q.view]);
  if (!native && q.view !== "warnings") {
    url.searchParams.set("tsdmapp", "json");
    if (q.view === "comments") url.searchParams.set("tsdmform", "1");
    else {
      url.searchParams.set("tsdmv", "4");
      url.searchParams.set("nodoc", "1");
    }
  }
  return url;
}

function requireValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error("Incomplete activity row");
  return value;
}
const str = (value: unknown) =>
  requireValue(typeof value === "string" ? value : null);
const num = (value: unknown) => requireValue(int(value));
const flag = (value: unknown) =>
  requireValue(value === 0 || value === 1 ? value === 1 : null);
const member = (row: Record<string, unknown>) => ({
  memberId: requireValue(id(row.uid)),
  name: str(row.username),
});
const credit = (value: unknown) => {
  const item = requireValue(record(value));
  return {
    id: requireValue(id(item.id)),
    title: str(item.title),
    unit: str(item.unit),
  };
};
function decodeRows<T>(
  value: unknown,
  map: (row: Record<string, unknown>) => T,
) {
  return requireValue(rows(value)).map((row) => map(requireValue(row)));
}
function paging(data: Record<string, unknown>, length: number) {
  const page = num(data.page),
    pages = num(data.pages),
    count = num(data.count),
    size = num(data.perpage);
  if (
    page < 1 ||
    pages < 0 ||
    count < 0 ||
    size < 1 ||
    length > size ||
    (pages !== Math.ceil(count / size) && !(count === 0 && pages === 1)) ||
    length !== Math.max(0, Math.min(size, count - (page - 1) * size))
  )
    throw new Error("Inconsistent pagination");
  return { page, pages, count, hasNext: page < pages };
}
function structured(
  q: ActivityQuery,
  data: Record<string, unknown>,
): View | null {
  if (
    q.view === "warnings" ||
    data.ok !== 1 ||
    data.type !== schemas[q.view][1] ||
    data.schema !== schemas[q.view][0]
  )
    return null;
  if (
    id(data.tid) !== q.threadId ||
    ("postId" in q && id(data.pid) !== q.postId)
  )
    throw new Error("Missing list target");
  if (q.view === "voters") {
    const optionId = requireValue(id(data.polloptionid));
    if (q.optionId && q.optionId !== optionId)
      throw new Error("Different poll option");
    const options = decodeRows(data.options, (row) => ({
      id: requireValue(id(row.id)),
      text: str(row.text),
      selected: flag(row.selected),
    }));
    if (
      options.filter((o) => o.selected).length !== 1 ||
      !options.some((o) => o.selected && o.id === optionId)
    )
      throw new Error("Unestablished poll option");
    const voters = decodeRows(data.voters, member);
    if (data.overt !== 1) throw new Error("Unestablished voter visibility");
    return {
      kind: "voters",
      rows: voters,
      optionId,
      options,
      ...paging(data, voters.length),
    };
  }
  if (q.view === "comments") {
    const comments = decodeRows(data.comments, (row) => ({
      id: requireValue(id(row.id)),
      memberId: requireValue(id(row.authorid)),
      name: str(row.author),
      time: num(row.dateline),
      message: str(row.comment),
      canDelete: flag(row.can_delete),
      ...(id(row.rpid) ? { replyPostId: id(row.rpid)! } : {}),
    }));
    const scores =
      data.comment_scores === undefined
        ? undefined
        : decodeRows(data.comment_scores, (row) => ({
            name: str(row.name),
            score: requireValue(
              typeof row.score === "number" && Number.isFinite(row.score)
                ? row.score
                : null,
            ),
          }));
    return {
      kind: "comments",
      rows: comments,
      ...(scores ? { scores } : {}),
      ...paging(data, comments.length),
    };
  }
  const count = num(data.count);
  if (rows(data.logs)?.length !== count) throw new Error("Incomplete ledger");
  if (q.view === "ratings")
    return {
      kind: "ratings",
      count,
      rows: decodeRows(data.logs, (row) => ({
        ...member(row),
        credit: credit(row.credit),
        score: num(row.score),
        time: num(row.dateline),
        reason: str(row.reason),
        digest: flag(row.digest),
      })),
      totals: decodeRows(data.totals, (row) => ({
        credit: credit(row.credit),
        score: num(row.score),
      })),
    };
  if (q.view === "payments")
    return {
      kind: "payments",
      count,
      credit: credit(data.credit),
      rows: decodeRows(data.logs, (row) => ({
        ...member(row),
        time: num(row.dateline),
        amount: num(row.amount),
      })),
    };
  const reasonsPublic = flag(data.reasons_public);
  return {
    kind: "moderation",
    count,
    reasonsPublic,
    rows: decodeRows(data.logs, (row) => {
      const operator = requireValue(record(row.operator));
      const memberId = id(operator.uid);
      return {
        operator: {
          label: str(operator.label),
          kind: str(operator.kind),
          ...(memberId ? { memberId } : {}),
        },
        time: num(row.dateline),
        action: str(row.action),
        description: str(row.action_text),
        expiration: num(row.expiration),
        active: flag(row.active),
        unlimited: flag(row.unlimited),
        magic: str(row.magic),
        ...(reasonsPublic ? { reason: str(row.reason) } : {}),
      };
    }),
  };
}

function person(node: Node, url: URL): Member | null {
  const a = descendants(node, (n) => n.tagName === "a")[0];
  const profile = a && activityURL(attr(a, "href"), url);
  const memberId =
    profile?.pathname === "/home.php" &&
    profile.searchParams.get("mod") === "space" &&
    id(profile.searchParams.get("uid"));
  return memberId ? { memberId, name: label(a) } : null;
}
function native(
  q: ActivityQuery,
  doc: ReturnType<typeof answer>["doc"],
  url: URL,
): View | null {
  const part = (node: Node, cls: string) =>
    descendants(node, (n) => hasClass(n, cls))[0];
  const operator = (node: Node) => {
    const who = person(node, url);
    return { label: label(node), ...(who ? { memberId: who.memberId } : {}) };
  };
  if (q.view === "comments") {
    if (!part(doc, "psth")) return null;
    const comments = descendants(doc, (n) => hasClass(n, "pstl")).flatMap(
      (node) => {
        const author = part(node, "psta"),
          content = part(node, "psti");
        if (!author || !content) return []; // A summary or score block has no author/content pair.
        const date = part(content, "xg1");
        if (!date) throw new Error("Missing comment date");
        const time = descendants(date, (n) => Boolean(attr(n, "title")))[0];
        return [
          {
            ...requireValue(person(author, url)),
            time: time ? attr(time, "title") : label(date),
            message: children(content)
              .filter((n) => n !== date)
              .map((n) => (element(n) && n.tagName === "br" ? "\n" : label(n)))
              .join(" ")
              .trim(),
          },
        ];
      },
    );
    const pg = part(doc, "pg");
    if (!comments.length && !/还没有点评|暂无点评|没有点评/.test(label(doc)))
      return null;
    const page = pg
      ? Number(label(descendants(pg, (n) => n.tagName === "strong")[0]))
      : q.page;
    const pages =
      pg &&
      Number(
        /共\s*(\d+)\s*页/.exec(
          attr(
            descendants(pg, (n) => attr(n, "title").startsWith("共"))[0] ?? pg,
            "title",
          ),
        )?.[1],
      );
    return {
      kind: "comments",
      rows: comments,
      ...(page > 0 ? { page } : {}),
      ...(pages ? { pages } : {}),
      ...(pg ? { hasNext: Boolean(part(pg, "nxt")) } : {}),
    };
  }
  if (q.view === "voters") {
    const list = part(doc, "voterl");
    if (!list) return null;
    const options = descendants(doc, (n) => n.tagName === "option").map(
      (n) => ({
        id: requireValue(id(attr(n, "value"))),
        text: label(n),
        selected: n.attrs.some((a) => a.name === "selected"),
      }),
    );
    const optionId = options.find((o) => o.selected)?.id;
    if (q.optionId && optionId !== q.optionId) return null;
    return {
      kind: "voters",
      rows: descendants(list, (n) => n.tagName === "li").map((n) =>
        requireValue(person(n, url)),
      ),
      ...(optionId ? { optionId } : {}),
      options,
      hasNext: Boolean(part(doc, "nxt")),
    };
  }
  const tables = descendants(
    doc,
    (n) => n.tagName === "table" && hasClass(n, "list"),
  );
  if (tables.length !== 1) return null;
  const table = tables[0]!;
  const cells = (n: Node) =>
    descendants(n, (c) => c.tagName === "td" || c.tagName === "th");
  const head = descendants(table, (n) => n.tagName === "thead")[0];
  if (!head) return null;
  const headers = cells(head).map(label);
  const entries = descendants(table, (n) => n.tagName === "tbody")
    .flatMap((body) => descendants(body, (n) => n.tagName === "tr"))
    .map(cells);
  if (entries.some((row) => row.length !== headers.length)) return null;
  if (q.view === "warnings" && headers.join("|") === "操作者|时间|理由")
    return {
      kind: "warnings",
      rows: entries.map(([actor, time, reason]) => ({
        operator: operator(actor!),
        time: label(time),
        reason: label(reason),
      })),
      summary: label(part(doc, "pns")),
    };
  if (
    q.view === "ratings" &&
    byId(doc, "return_viewratings") &&
    headers.join("|") === "积分|用户名|时间|理由"
  )
    return {
      kind: "ratings",
      rows: entries.map(([score, actor, time, reason]) => {
        const parts = requireValue(/^(.+?)\s+([+-]?\d+)$/.exec(label(score)));
        return {
          ...requireValue(person(actor!, url)),
          credit: { title: parts[1]! },
          score: num(Number(parts[2])),
          time: label(time),
          reason: label(reason),
        };
      }),
    };
  if (
    q.view === "payments" &&
    byId(doc, "return_pay") &&
    headers.slice(0, 2).join("|") === "用户名|时间" &&
    headers.length === 3
  )
    return {
      kind: "payments",
      credit: { title: headers[2]! },
      rows: entries.map(([actor, time, amount]) => {
        const displayAmount = label(amount);
        const amountText = requireValue(
          /^([+-]?\d+)(?:\s.*)?$/.exec(displayAmount),
        );
        return {
          ...requireValue(person(actor!, url)),
          time: label(time),
          amount: num(Number(amountText[1])),
          displayAmount,
        };
      }),
    };
  if (
    q.view === "moderation" &&
    byId(doc, "return_viewthreadmod") &&
    headers.slice(0, 4).join("|") === "操作者|时间|操作|有效期"
  )
    return {
      kind: "moderation",
      reasonsPublic: headers[4] === "理由",
      rows: entries.map(([actor, time, action, expiration, reason]) => ({
        operator: operator(actor!),
        time: label(time),
        description: label(action),
        expiration: label(expiration),
        active: !action!.attrs.some((a) => a.name === "disabled"),
        ...(reason ? { reason: label(reason) } : {}),
      })),
    };
  return null;
}

export function decodeActivityRead(
  q: ActivityQuery,
  response: HostResponse,
  url: URL,
  viewerId: string,
): ActivityRead | ActivityFailure | null {
  const { data, doc, failure } = answer(response);
  const context = { sourceURL: url.href, viewerId, target: q };
  if (data?.uid !== undefined && numericId(data.uid) !== viewerId)
    return {
      kind: "session-changed",
      message: "The view was served to a different account.",
    };
  if (
    data &&
    (!targetMatches(data, q) ||
      (q.view === "voters" &&
        q.optionId &&
        data.polloptionid !== undefined &&
        id(data.polloptionid) !== q.optionId))
  )
    return {
      kind: "invalid",
      message: "The forum returned a different target.",
    };
  const issue = responseIssue(response, data);
  if (issue) return issue;
  if (response.status !== 200)
    return {
      kind: "incomplete",
      message: `Forum returned HTTP ${response.status}.`,
    };
  const code = string(data?.message_key);
  if (
    q.view === "ratings" &&
    (code === "thread_rate_log_nonexistence" ||
      /指定帖子在近一年内没有评分记录/.test(failure))
  )
    return { ...context, kind: "ratings", rows: [], count: 0 };
  if (q.view === "warnings" && /指定帖子没有警告记录/.test(failure))
    return { ...context, kind: "warnings", rows: [] };
  if (
    q.view === "voters" &&
    data?.type === "poll_voters" &&
    data.schema === 49 &&
    data.overt === 0
  )
    return {
      kind: "refused",
      code: "thread_poll_nopermission",
      message: "The forum marked this poll's voters private.",
    };
  const message = string(data?.message) || failure;
  if (
    failure ||
    (data?.ok === 0 &&
      message &&
      !["off", "action", "unknown"].includes(string(data.error)))
  )
    return { kind: "refused", code, message };
  let view: View | null = null;
  try {
    if (data && numericId(data.uid) === viewerId) view = structured(q, data);
  } catch {
    /* An incomplete structured result may still carry the native view. */
  }
  if (!view) {
    try {
      view = native(q, doc, url);
    } catch {
      /* Let the client try the native representation. */
    }
  }
  return view ? { ...context, ...view } : null;
}
