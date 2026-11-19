import type { ForumTransport } from "../../index.js";
import { decodeHTML, decodeXML } from "entities";
import {
  attr,
  byId,
  children,
  descendants,
  element,
  hasClass,
  label,
  type Element,
} from "../html.js";
import type { ForumLink } from "../types.js";
import {
  anchors,
  failure,
  first,
  integer,
  invalid,
  link,
  nativePaging,
  receive,
  sameAccount,
  target,
  type Received,
} from "./shared.js";
import type { Context, DiscoveryFailure, PageLinks } from "./types.js";

export interface StatisticsCell {
  text: string;
  header: boolean;
  links: ForumLink[];
}
export interface StatisticsTable {
  title: string | null;
  rows: StatisticsCell[][];
}
export interface TrendData {
  labels: string[];
  series: { id: string; title: string; values: number[] }[];
}
export type StatisticsPage = Context &
  PageLinks & {
    kind: "statistics";
    title: string;
    operation: string;
    links: ForumLink[];
    tables: StatisticsTable[];
    note: string | null;
    trendURL: string | null;
    dailyTrend: TrendData | null;
  };
export type StatisticsResult = DiscoveryFailure | StatisticsPage;
export type TrendResult =
  DiscoveryFailure | (Context & TrendData & { kind: "trend" });
const statTarget = (value: string, base: string) =>
  target(value, base, "/misc.php", "stat", ["types[]"]);
const statOp = (url: URL) => url.searchParams.get("op") || "basic";
function statScopeMatches(left: URL, right: URL): boolean {
  const ignored = [
    "mod",
    "op",
    "page",
    "tsdmapp",
    "nodoc",
    "tsdmpreview",
    "tsdmv",
  ];
  const scope = (url: URL) =>
    JSON.stringify(
      [...url.searchParams]
        .filter(([key, value]) => !ignored.includes(key) && value !== "")
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
    );
  return statOp(left) === statOp(right) && scope(left) === scope(right);
}
function enclosing(
  node: Element,
  predicate: (node: Element) => boolean,
): Element | null {
  for (
    let parent = node.parentNode;
    parent && element(parent);
    parent = parent.parentNode
  ) {
    if (predicate(parent)) return parent;
  }
  return null;
}
function statsTables(main: Element, base: string): StatisticsTable[] {
  const tables = descendants(
    main,
    (node) =>
      node.tagName === "table" &&
      hasClass(node, "dt") &&
      !enclosing(node, (parent) => parent.tagName === "form"),
  );
  const results: StatisticsTable[] = [];
  for (const table of tables) {
    const rows = descendants(
      table,
      (node) =>
        node.tagName === "tr" &&
        enclosing(node, (parent) => parent.tagName === "table") === table,
    )
      .map((row) =>
        children(row)
          .filter(
            (cell): cell is Element =>
              element(cell) && ["td", "th"].includes(cell.tagName),
          )
          .map((cell) => ({
            text: label(cell),
            header: cell.tagName === "th",
            links: anchors(cell)
              .map((anchor) => link(anchor, base))
              .filter((item) => item !== null),
          })),
      )
      .filter((cells) => cells.length);
    if (!rows.length) continue;
    const parent = table.parentNode;
    const previous = results.at(-1);
    if (
      parent &&
      hasClass(parent, "str") &&
      previous?.rows.length === rows.length
    ) {
      previous.rows.forEach((row, index) => row.push(...rows[index]!));
      continue;
    }
    const title =
      label(first(table, (node) => node.tagName === "caption")) ||
      attr(table, "summary");
    results.push({ title: title || null, rows });
  }
  return results;
}
function dailyTrend(tables: StatisticsTable[]): TrendData | null {
  for (const table of tables) {
    const daily = table.rows.filter(
      ([date, value, ...rest]) =>
        date &&
        value &&
        !rest.length &&
        !date.header &&
        /^\d{4}-\d{1,2}-\d{1,2}$/.test(date.text) &&
        /^(0|[1-9]\d*)$/.test(value.text),
    );
    if (daily.length)
      return {
        labels: daily.map((row) => row[0]!.text),
        series: [
          {
            id: "daily-posts",
            title: table.rows[0]?.[1]?.text ?? "",
            values: daily.map((row) => Number(row[1]!.text)),
          },
        ],
      };
  }
  return null;
}
function decodeStatistics(
  received: Received,
  accepts: (value: string) => boolean,
): StatisticsResult {
  const { context, actual, doc } = received;
  const main = byId(doc, "ct");
  const body = main && first(main, (node) => hasClass(node, "mn"));
  const title =
    body &&
    label(first(body, (node) => node.tagName === "h1" && hasClass(node, "mt")));
  if (!main || !body || !title)
    return failure(
      context,
      "incomplete",
      "The forum did not return a statistics page.",
    );
  const links = anchors(main)
    .map((anchor) => link(anchor, actual.href))
    .filter(
      (entry): entry is ForumLink =>
        entry !== null && !!statTarget(entry.url, actual.href),
    );
  const tables = statsTables(body, actual.href);
  const chart = byId(body, "statchart");
  const scripts = chart
    ? descendants(body, (node) => node.tagName === "script")
    : [];
  const chartSource = scripts
    .flatMap(children)
    .flatMap((node) => ("value" in node ? [node.value] : []))
    .join("\n");
  const supplied = chartSource.match(
    /\b(?:draw)?statchart\(\s*(['"])([^'"]+)\1\s*\)/,
  )?.[2];
  const trend =
    supplied &&
    !supplied.includes("{") &&
    statTarget(decodeHTML(supplied), actual.href);
  const trendURL =
    trend &&
    trend.searchParams.get("xml") === "1" &&
    statOp(trend) === statOp(actual)
      ? trend.href
      : null;
  if (!tables.length && !chart)
    return failure(context, "incomplete", "The statistics content is missing.");
  return {
    ...context,
    ...nativePaging(body, actual.href, accepts),
    kind: "statistics",
    title,
    operation: statOp(actual),
    links,
    tables,
    note: label(first(body, (node) => hasClass(node, "notice"))) || null,
    trendURL,
    dailyTrend: chart && !trendURL ? dailyTrend(tables) : null,
  };
}

// Parse only the forum's chart grammar. A document type or any other XML shape is incomplete.
function valuesFromXML(source: string): Map<string, string> | null {
  const values = new Map<string, string>();
  for (const entry of source.matchAll(
    /\s*<value\s+xid=(['"])(\d+)\1\s*>([^<]*)<\/value>/gy,
  )) {
    const [, , id, value] = entry;
    if (!id || value === undefined || values.has(id)) return null;
    values.set(id, decodeXML(value.trim()));
  }
  const grammar = /^(?:\s*<value\s+xid=(?:'\d+'|"\d+")\s*>[^<]*<\/value>)+\s*$/;
  return values.size && grammar.test(source) ? values : null;
}
function parseTrend(xml: string): TrendData | null {
  const chart =
    /^\s*(?:<\?xml[^?]*\?>\s*)?<chart>\s*<xaxis>([^]*?)<\/xaxis>\s*<graphs>([^]*?)<\/graphs>\s*<\/chart>\s*$/.exec(
      xml,
    );
  if (!chart) return null;
  const axis = valuesFromXML(chart[1]!);
  const graphs = chart[2]!.trim();
  if (!axis || !graphs || [...axis.values()].some((value) => !value))
    return null;
  const series: TrendData["series"] = [];
  const ids = new Set<string>();
  const graphPattern =
    /\s*<graph\s+gid=(['"])(\d+)\1\s+title=(['"])((?:(?!\3)[^<])*)\3\s*>([^]*?)<\/graph>/gy;
  let position = 0;
  for (const match of graphs.matchAll(graphPattern)) {
    const [, , id, , title, points] = match;
    if (!id || title === undefined || points === undefined || ids.has(id))
      return null;
    const values = valuesFromXML(points);
    if (!values || values.size !== axis.size) return null;
    const ordered: number[] = [];
    for (const key of axis.keys()) {
      const value = values.get(key);
      if (
        value === undefined ||
        !/^\d+$/.test(value) ||
        integer(Number(value)) === null
      )
        return null;
      ordered.push(Number(value));
    }
    series.push({ id, title: decodeXML(title), values: ordered });
    ids.add(id);
    position = match.index + match[0].length;
  }
  if (!series.length || position !== graphs.length) return null;
  return {
    labels: [...axis.values()].map((value) =>
      value.replace(/^(\d{2})(\d{2})$/, "$1-$2"),
    ),
    series,
  };
}

export function createStatisticsReads(
  origin: string,
  transport: ForumTransport,
) {
  return {
    async readStatistics(
      destination = "/misc.php?mod=stat",
    ): Promise<StatisticsResult> {
      const requested = statTarget(destination, origin);
      if (
        !requested ||
        requested.searchParams.has("xml") ||
        requested.searchParams.has("exportexcel") ||
        ![
          "basic",
          "forumstat",
          "team",
          "modworks",
          "memberlist",
          "trend",
        ].includes(statOp(requested))
      )
        return invalid(destination, "Use a statistics page URL on this forum.");
      const accepts = (value: string) => {
        const url = statTarget(value, origin);
        return (
          !!url &&
          !url.searchParams.has("xml") &&
          !url.searchParams.has("exportexcel") &&
          statScopeMatches(url, requested)
        );
      };
      const received = await receive(requested, transport, false, accepts);
      return "kind" in received
        ? received
        : decodeStatistics(received, accepts);
    },
    async readTrend(page: StatisticsPage): Promise<TrendResult> {
      const source = statTarget(page.sourceURL, origin);
      const requested = page.trendURL && statTarget(page.trendURL, origin);
      if (
        !source ||
        !requested ||
        requested.searchParams.get("xml") !== "1" ||
        statOp(source) !== statOp(requested)
      )
        return invalid(
          page.sourceURL,
          "Use the same-forum XML destination supplied by the statistics page.",
        );
      const received = await receive(
        requested,
        transport,
        false,
        (value) => value === requested.href,
      );
      if ("kind" in received) return received;
      const { context, body } = received;
      if (
        context.account.kind !== "unknown" &&
        page.account.kind !== "unknown" &&
        !sameAccount(context.account, page.account)
      )
        return failure(
          context,
          "invalid",
          "The statistics viewer changed before the trend read.",
        );
      const chart = parseTrend(body);
      return chart
        ? { ...context, ...chart, kind: "trend" }
        : failure(
            context,
            "incomplete",
            "The forum did not return a complete trend chart.",
          );
    },
  };
}
