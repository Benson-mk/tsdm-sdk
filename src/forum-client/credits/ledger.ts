import {
  attr,
  byId,
  children,
  descendants,
  element,
  hasClass,
  label,
  type Node,
} from "../html.js";
import type { NoticeHost } from "../notice-transport.js";
import {
  answer,
  creditPageAvailable,
  bit,
  failure,
  forumURL,
  nativeIdentity,
  nativeMessage,
  numericId,
  positive,
  readIssue,
  record,
  string,
  urlAt,
  whole,
} from "./protocol.js";
import type {
  AttendanceCalendar,
  CreditBalance,
  CreditChange,
  CreditLog,
  CreditLogQuery,
  CreditValue,
  CreditsFailure,
  CreditsSession,
} from "./types.js";

type Query = Required<CreditLogQuery>;
const invalidRead = (message: string) => failure("invalid-response", message);
const login = () =>
  failure("refused", "Sign in to read your credits.", "login");
function date(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00Z`)) &&
    new Date(`${value}T00:00Z`).toISOString().slice(0, 10) === value
  );
}
function queryOf(q: CreditLogQuery): Query | null {
  const {
    creditId = "0",
    direction = 0,
    operation = "",
    start = "",
    end = "",
    page = 1,
  } = q;
  if (
    numericId(creditId) !== creditId ||
    ![-1, 0, 1].includes(direction) ||
    typeof operation !== "string" ||
    !/^[A-Za-z0-9_]{0,20}$/.test(operation) ||
    typeof start !== "string" ||
    typeof end !== "string" ||
    (start && !date(start)) ||
    (end && !date(end)) ||
    (start && end && start > end) ||
    whole(page) === null ||
    page < 1
  )
    return null;
  return { creditId, direction, operation, start, end, page };
}
function monthlyBounds(month: string) {
  const first = `${month}-01`;
  if (!date(first)) return null;
  const until = new Date(`${first}T00:00Z`);
  until.setUTCMonth(until.getUTCMonth() + 1, 0);
  return { start: first, end: until.toISOString().slice(0, 10) };
}
function boundsMatch(row: CreditChange, q: Query) {
  return (!q.start || row.date >= q.start) && (!q.end || row.date <= q.end);
}
function acceptedQuery(data: Record<string, unknown>, q: Query) {
  const echo = record(data.query);
  return (
    echo &&
    numericId(echo.exttype) === q.creditId &&
    String(echo.income) === String(q.direction) &&
    echo.optype === q.operation &&
    echo.starttime === q.start &&
    echo.endtime === q.end &&
    data.page === q.page
  );
}
function all<T>(value: unknown, parse: (item: unknown) => T | null) {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parse);
  return parsed.every((v): v is T => v !== null) ? parsed : null;
}
function rawCredit(raw: unknown): CreditValue | null {
  const row = record(raw),
    id = positive(row?.id),
    title = string(row?.title),
    value = whole(row?.value);
  if (!id || !title || value === null) return null;
  return {
    id,
    title,
    value,
    ...(typeof row?.unit === "string" ? { unit: row.unit } : {}),
  };
}
function forumDate(epoch: number, offset: number) {
  const t = new Date((epoch + offset * 3600) * 1000);
  return Number.isFinite(t.valueOf()) ? t.toISOString().slice(0, 10) : null;
}
function apiRows(rows: unknown, offset: unknown, base: URL) {
  if (
    typeof offset !== "number" ||
    !Number.isFinite(offset) ||
    offset < -14 ||
    offset > 14
  )
    return null;
  return all(rows, (raw) => {
    const row = record(raw),
      id = positive(row?.logid),
      timestamp = whole(row?.dateline);
    const operation = string(row?.operation),
      changes = all(row?.changes, rawCredit),
      after = all(row?.after, rawCredit);
    const date =
      timestamp !== null && timestamp > 0 ? forumDate(timestamp, offset) : null;
    if (!id || !date || timestamp === null || !operation || !changes || !after)
      return null;
    const direction =
      row?.type === "income"
        ? "income"
        : row?.type === "expense"
          ? "expense"
          : "unknown";
    const destination = forumURL(row?.url, base);
    return {
      id,
      operation,
      operationCode: string(row?.optype),
      direction,
      changes,
      after,
      detail: string(row?.detail),
      date,
      timestamp,
      ...(destination ? { destination: destination.href } : {}),
    } satisfies CreditChange;
  });
}
function routes(scope: Node, base: URL) {
  return descendants(scope, (n) => n.tagName === "a")
    .map((n) => forumURL(attr(n, "href"), base, "/home.php"))
    .filter((url): url is URL => Boolean(url));
}
function creditRuleLink(url: URL) {
  const q = url.searchParams;
  return (
    url.pathname === "/home.php" &&
    q.get("mod") === "spacecp" &&
    q.get("ac") === "credit" &&
    q.get("op") === "rule" &&
    [...q.keys()].length === 3
  );
}
function ruleHandoff(url: URL | undefined) {
  return url
    ? {
        rules: {
          kind: "browser-handoff" as const,
          destination: url.href,
          message: "Open the native credit rules page.",
        },
      }
    : {};
}
function apiBalance(
  data: Record<string, unknown>,
  source: URL,
  memberId: string,
): CreditBalance | null {
  if (
    data.ok !== 1 ||
    data.type !== "credit_base" ||
    data.schema !== 52 ||
    numericId(data.uid) !== memberId
  )
    return null;
  const credits = all(data.credits, rawCredit),
    total = record(data.total),
    value = whole(total?.value);
  const recent = apiRows(data.logs, data.timeoffset, source);
  if (!credits?.length || value === null || !recent) return null;
  const urls = Array.isArray(data.tabs)
    ? data.tabs.map((x) => forumURL(record(x)?.url, source, "/home.php"))
    : [];
  const formula = string(total?.formula);
  return {
    kind: "credit-balance",
    memberId,
    source: "plugin",
    credits,
    total: { value, ...(formula ? { formula } : {}) },
    recent,
    ...ruleHandoff(
      urls.find((url): url is URL => url !== null && creditRuleLink(url)),
    ),
  };
}
function apiFilters(data: unknown) {
  const f = record(data);
  const items = (rows: unknown) =>
    all(rows, (raw) => {
      const item = record(raw),
        value = item?.value,
        name = string(item?.name);
      return (typeof value === "string" || typeof value === "number") && name
        ? { value: String(value), name }
        : null;
    });
  const credit = items(f?.exttype),
    direction = items(f?.income),
    operation = items(f?.optype);
  return credit && direction && operation
    ? { credit, direction, operation }
    : null;
}
function apiLog(
  data: Record<string, unknown>,
  source: URL,
  q: Query,
  memberId: string,
): CreditLog | CreditsFailure | null {
  if (
    data.ok !== 1 ||
    data.type !== "credit" ||
    data.schema !== 12 ||
    data.op !== "log" ||
    numericId(data.uid) !== memberId
  )
    return null;
  if (!acceptedQuery(data, q))
    return invalidRead(
      "The response did not preserve the requested credit filters, bounds or page.",
    );
  const rows = apiRows(data.logs, data.timeoffset, source),
    filters = apiFilters(data.filters);
  const count = whole(data.count),
    pages = whole(data.pages);
  if (
    !rows ||
    !filters ||
    count === null ||
    count < rows.length ||
    pages === null ||
    pages < 1 ||
    q.page > pages ||
    !bit(data.has_next) ||
    (data.has_next === 1) !== q.page < pages ||
    (!rows.length && count > 0)
  )
    return null;
  if (!rows.every((row) => boundsMatch(row, q)))
    return invalidRead(
      "The forum returned a credit row outside the requested dates.",
    );
  return {
    kind: "credit-log",
    memberId,
    source: "plugin",
    query: q,
    rows,
    filters,
    count,
    page: q.page,
    pages,
    hasNext: data.has_next === 1,
  };
}
function nativeChanges(value: string): CreditValue[] | null {
  if (!value || value === "-") return [];
  const items = [...value.matchAll(/([^\d+\-\s]+)\s*([+-]?\d+)/g)];
  return items.length
    ? items.map((m) => ({ title: m[1]!, value: Number(m[2]) }))
    : null;
}
function nativeRows(doc: Node, base: URL) {
  const tables = descendants(
    doc,
    (n) => n.tagName === "table" && hasClass(n, "dt"),
  );
  const table = tables.find(
    (t) =>
      descendants(t, (n) => n.tagName === "th")
        .map(label)
        .join("|") === "操作|积分变更|变更后|详情|变更时间",
  );
  if (!table) return null;
  const rows: CreditChange[] = [];
  for (const tr of descendants(table, (n) => n.tagName === "tr")) {
    const cells = children(tr).filter((n) => element(n) && n.tagName === "td");
    if (!cells.length) continue;
    if (cells.length === 1 && /暂无|没有|无记录/.test(label(cells[0])))
      continue;
    if (cells.length !== 5) return null;
    const [action, change, balance, details, time] = cells;
    const bits = /^(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(label(time));
    const iso = bits
      ? `${bits[1]}-${bits[2]!.padStart(2, "0")}-${bits[3]!.padStart(2, "0")}`
      : "";
    const operation = label(action),
      changes = nativeChanges(label(change)),
      after = nativeChanges(label(balance));
    if (!operation || !changes || !after || !date(iso)) return null;
    const actionURL = action
      ? routes(action, base).find(
          (u) =>
            u.searchParams.get("ac") === "credit" &&
            u.searchParams.get("op") === "log",
        )
      : undefined;
    const direction =
      changes.length && changes.every((c) => c.value >= 0)
        ? "income"
        : changes.length && changes.every((c) => c.value <= 0)
          ? "expense"
          : "unknown";
    const link = details && descendants(details, (n) => n.tagName === "a")[0];
    const destination = link && forumURL(attr(link, "href"), base);
    rows.push({
      operation,
      operationCode: actionURL?.searchParams.get("optype") ?? "",
      direction,
      changes,
      after,
      detail: label(details),
      date: iso,
      ...(destination ? { destination: destination.href } : {}),
    });
  }
  return rows;
}
function nativeBalance(
  doc: Node,
  url: URL,
  memberId: string,
): CreditBalance | null {
  const ledger = descendants(
    doc,
    (n) => n.tagName === "ul" && hasClass(n, "creditl"),
  );
  if (ledger.length !== 1) return null;
  const entries = descendants(ledger[0]!, (n) => n.tagName === "li");
  const credits: CreditValue[] = [];
  let total: CreditBalance["total"] | undefined;
  for (const entry of entries) {
    const em = descendants(entry, (n) => n.tagName === "em")[0];
    const title = label(em).replace(/[\s:：]+$/, "");
    const raw = children(entry)
      .filter((n) => n !== em && !element(n))
      .map(label)
      .join("");
    if (!title || !/^[-+]?\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      return null;
    const value = Number(raw);
    if (title === "积分") {
      const formula = label(descendants(entry, (n) => hasClass(n, "xg1"))[0]);
      total = { value, ...(formula ? { formula } : {}) };
    } else credits.push({ title, value });
  }
  const recent = nativeRows(doc, url);
  if (!credits.length || !total || !recent) return null;
  return {
    kind: "credit-balance",
    memberId,
    source: "native",
    credits,
    total,
    recent,
    ...ruleHandoff(routes(doc, url).find(creditRuleLink)),
  };
}
function nativeLog(
  doc: Node,
  url: URL,
  q: Query,
  memberId: string,
): CreditLog | null {
  function control(name: string) {
    return (
      byId(doc, name) ??
      descendants(
        doc,
        (n) =>
          ["input", "select"].includes(n.tagName) && attr(n, "name") === name,
      )[0]
    );
  }
  function options(name: string) {
    const found = control(name);
    return found ? descendants(found, (n) => n.tagName === "option") : [];
  }
  for (const [key, expected, defaultValue] of [
    ["exttype", q.creditId, "0"],
    ["income", String(q.direction), "0"],
    ["optype", q.operation, ""],
    ["starttime", q.start, ""],
    ["endtime", q.end, ""],
  ] as const) {
    const found = control(key),
      choices = options(key);
    const selected =
      choices.find((n) => n.attrs.some((a) => a.name === "selected")) ??
      choices[0];
    const actual = selected
      ? attr(selected, "value")
      : found
        ? attr(found, "value")
        : defaultValue;
    if ((actual || defaultValue) !== expected) return null;
  }
  if (!control("exttype") && !control("income") && !control("optype"))
    return null;
  const rows = nativeRows(doc, url);
  if (!rows || rows.some((row) => !boundsMatch(row, q))) return null;
  const pager = descendants(doc, (n) => hasClass(n, "pg"))[0];
  const marked = pager
    ? Number(label(descendants(pager, (n) => n.tagName === "strong")[0]))
    : 1;
  if (q.page !== marked) return null;
  const next =
    pager &&
    descendants(pager, (n) => n.tagName === "a" && hasClass(n, "nxt"))[0];
  const filters = (name: string) =>
    options(name).map((n) => ({ value: attr(n, "value"), name: label(n) }));
  return {
    kind: "credit-log",
    memberId,
    source: "native",
    query: q,
    rows,
    page: q.page,
    ...(pager ? { hasNext: Boolean(next) } : {}),
    filters: {
      credit: filters("exttype"),
      direction: filters("income"),
      operation: filters("optype"),
    },
  };
}
export function createLedger(host: NoticeHost) {
  const base = urlAt(host.origin, "/home.php", {
    mod: "spacecp",
    ac: "credit",
    op: "base",
  });
  async function load<T>(
    url: URL,
    owner: CreditsSession,
    version4: boolean,
    api: (
      data: Record<string, unknown>,
      source: URL,
    ) => T | CreditsFailure | null,
    native: (doc: Node, source: URL) => T | null,
  ): Promise<T | CreditsFailure> {
    const lean = new URL(url.href);
    lean.searchParams.set("tsdmapp", "json");
    if (version4) lean.searchParams.set("tsdmv", "4");
    lean.searchParams.set("nodoc", "1");
    const available =
      !version4 || (await creditPageAvailable(host, owner, "credit_base"));
    if (typeof available !== "boolean") return available;
    for (const source of available ? [lean, url] : [url]) {
      const result = await host.request(source.href, owner);
      if (result.kind !== "response")
        return failure(result.kind, "Credit view unavailable.");
      const { data, html } = answer(result.response),
        issue = readIssue(result.response, data, owner.memberId);
      if (issue) return issue;
      const parsed = data && api(data, source);
      if (parsed) return parsed;
      if (!html) continue;
      const identity = nativeIdentity(html, source);
      if (identity === "0") return login();
      if (identity !== null && identity !== owner.memberId)
        return failure(
          "session-changed",
          "The credit page was served to another account.",
        );
      const { doc, message, isError } = nativeMessage(html);
      if (isError && message) return failure("refused", message);
      if (
        identity === owner.memberId ||
        numericId(data?.uid) === owner.memberId
      ) {
        const page = native(doc, source);
        if (page) return page;
      }
    }
    return invalidRead(
      "The forum did not establish the requested credit view.",
    );
  }
  async function log(owner: CreditsSession, q: Query) {
    const url = urlAt(host.origin, "/home.php", {
      mod: "spacecp",
      ac: "credit",
      op: "log",
      exttype: q.creditId,
      income: String(q.direction),
      optype: q.operation,
      starttime: q.start,
      endtime: q.end,
      page: String(q.page),
    });
    return load(
      url,
      owner,
      false,
      (data, source) => apiLog(data, source, q, owner.memberId),
      (doc, source) => nativeLog(doc, source, q, owner.memberId),
    );
  }
  return {
    async readCreditBalance(): Promise<CreditBalance | CreditsFailure> {
      const owner = host.session();
      return owner
        ? load(
            base,
            owner,
            true,
            (data, source) => apiBalance(data, source, owner.memberId),
            (doc, source) => nativeBalance(doc, source, owner.memberId),
          )
        : login();
    },
    async readCreditLog(
      query: CreditLogQuery = {},
    ): Promise<CreditLog | CreditsFailure> {
      const owner = host.session(),
        q = queryOf(query);
      if (!q)
        return failure(
          "invalid-input",
          "Choose valid credit filters, inclusive dates and a positive page.",
        );
      return owner ? log(owner, q) : login();
    },
    async readAttendanceCalendar(
      month: string,
      { maxPages = 8 }: { maxPages?: number } = {},
    ): Promise<AttendanceCalendar | CreditsFailure> {
      const range = monthlyBounds(month);
      if (!range || whole(maxPages) === null || maxPages < 1 || maxPages > 30)
        return failure(
          "invalid-input",
          "Choose a valid month and a page limit from 1 to 30.",
        );
      const owner = host.session();
      if (!owner) return login();
      const days = new Set<string>(),
        ids = new Set<string>();
      const progress = (
        pagesRead: number,
        complete: boolean,
        interruption?: CreditsFailure,
      ): AttendanceCalendar => ({
        kind: "attendance-calendar",
        memberId: owner.memberId,
        month,
        ...range,
        days: [...days].sort(),
        pagesRead,
        complete,
        ...(interruption ? { interruption } : {}),
      });
      for (let page = 1; page <= maxPages; page++) {
        const r = await log(owner, {
          ...range,
          creditId: "0",
          direction: 0,
          operation: "",
          page,
        });
        if (r.kind !== "credit-log")
          return page === 1 || r.kind === "session-changed"
            ? r
            : progress(page - 1, false, r);
        if (r.rows.some((row) => row.id && ids.has(row.id)))
          return progress(
            page - 1,
            false,
            invalidRead("The credit pages repeated previously seen rows."),
          );
        for (const row of r.rows) {
          if (row.id) ids.add(row.id);
          if (
            /签到|簽到/.test(row.operation) ||
            /恭喜.*(?:签到|簽到).*成功|(?:签到|簽到)(?:额外|額外)(?:奖励|獎勵)/.test(
              row.detail,
            )
          )
            days.add(row.date);
        }
        if (r.hasNext !== true) return progress(page, r.hasNext === false);
      }
      return progress(maxPages, false);
    },
  };
}
