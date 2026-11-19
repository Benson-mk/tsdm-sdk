import {
  attr,
  descendants,
  element,
  hasClass,
  type Element,
  type Node,
} from "../html.js";
import {
  ancestor,
  bankId,
  bankRoute,
  bankText,
  bankURL,
  cells,
  section,
  tableRows,
} from "./protocol.js";
import type {
  BankBlock,
  BankBrowserHandoff,
  BankLogEntry,
  BankService,
  BankServicePage,
  ForumBank,
} from "./types.js";

export function directoryFrom(doc: Node, base: string) {
  const table = section(doc, "银行列表");
  if (!table) return null;
  const seen = new Set<string>();
  const banks: ForumBank[] = [];
  for (const row of tableRows(table)) {
    const columns = cells(row);
    if (columns.length !== 3) continue;
    const links = descendants(
      columns[2]!,
      (node) => node.tagName === "a" && bankText(node) === "进入银行",
    );
    if (!links.length) continue;
    if (links.length !== 1) return null;
    const target = bankRoute(attr(links[0]!, "href"), base, {}, ["bankid"]);
    const id = target?.searchParams.get("bankid");
    const details = bankText(columns[1]);
    const name = /银行名称\s*[:：]\s*(.*?)\s*银行行长\s*[:：]/
      .exec(details)?.[1]
      ?.trim();
    if (!bankId(id) || !name || seen.has(id)) return null;
    seen.add(id);
    banks.push(
      Object.freeze({
        id,
        name,
        description:
          /银行简介\s*[:：]\s*(.*)$/.exec(details)?.[1]?.trim() ?? "",
        hasAccount: bankText(columns[2]).includes("已开户"),
        url: bankURL(new URL(base).origin, { bankid: id }),
      }),
    );
  }
  return banks.length ? Object.freeze(banks) : null;
}

export const services: Record<
  BankService,
  { action: string; heading: string; global?: true }
> = {
  lobby: { action: "", heading: "欢迎来到" },
  savings: { action: "cur", heading: "活期储蓄" },
  fixed: { action: "fix", heading: "定期储蓄" },
  transfer: { action: "chg", heading: "账户汇款" },
  loans: { action: "len", heading: "贷款专柜" },
  account: { action: "pas", heading: "账户管理" },
  overview: { action: "", heading: "我的账户", global: true },
  rankings: { action: "list", heading: "财富排行", global: true },
  trading: { action: "buy", heading: "积分买卖", global: true },
};
export const validPage = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
export function serviceURL(
  origin: string,
  service: BankService,
  bank: string | null,
  page = 1,
) {
  const { action } = services[service];
  return bankURL(origin, {
    ...(bank ? { bankid: bank } : { mode: "other" }),
    ...(action && { action }),
    ...(page > 1 && { page: String(page) }),
  });
}
const tag = (node: Element, name: string) => node.tagName === name;
const skipBlock = (node: Element) =>
  node.tagName === "form" || hasClass(node, "pg");
function nextPage(scope: Element, base: string, page: number) {
  const required = Object.fromEntries(new URL(base).searchParams);
  required.page = String(page + 1);
  return descendants(
    scope,
    (node) =>
      tag(node, "a") &&
      ancestor(node, (parent) => hasClass(parent, "pg")) !== null,
  ).some((link) => bankRoute(attr(link, "href"), base, required));
}
function walletFrom(doc: Node) {
  const wallets = descendants(
    doc,
    (node) =>
      tag(node, "li") &&
      ancestor(
        node,
        (parent) => tag(parent, "div") && hasClass(parent, "tbn"),
      ) !== null &&
      /[（(]\s*银行货币\s*[)）]/.test(bankText(node)),
  );
  const item = wallets.length === 1 ? wallets[0] : null;
  const font = item && descendants(item, (node) => tag(node, "font"))[0];
  const total =
    item &&
    descendants(
      item,
      (node) =>
        tag(node, "b") &&
        ancestor(node, (parent) => tag(parent, "span")) !== null,
    )[0];
  return {
    currency: bankText(font ?? undefined).replace(/\s*[:：]\s*$/, ""),
    walletBalance: bankText(total ?? undefined),
  };
}
export function serviceFrom(
  doc: Node,
  url: string,
  kind: BankService,
  bank: string | null,
  page: number,
): { service: BankServicePage; table: Element } | null {
  const service = services[kind];
  const table = section(doc, service.heading, kind === "lobby");
  if (!table) return null;
  const roots: Element[] = [table];
  if (kind === "rankings") {
    const siblings = table.parentNode?.childNodes ?? [];
    const following = siblings.slice(siblings.indexOf(table) + 1).find(element);
    if (following?.tagName === "table" && attr(following, "id") === "ttt")
      roots.push(following);
  }
  const blocks: BankBlock[] = [];
  for (const root of roots) {
    for (const row of descendants(root, (node) => tag(node, "tr"))) {
      if (
        descendants(row, (node) => tag(node, "table") || tag(node, "h2")).length
      )
        continue;
      const columns = cells(row);
      const text = columns
        .map((col) => bankText(col, skipBlock))
        .filter((value) => value && !/^ip\s*:/i.test(value))
        .join("\n");
      if (text)
        blocks.push(
          Object.freeze({
            text,
            heading: columns.some((col) => hasClass(col, "footoperation")),
          }),
        );
    }
  }
  const summary =
    kind === "savings"
      ? (blocks.find(
          (block) => block.heading && block.text.includes("您当前的存款金额为"),
        )?.text ?? "")
      : "";
  if (kind === "savings" && !summary) return null;
  const interest =
    kind === "savings"
      ? (descendants(table, (node) => tag(node, "p"))
          .map((node) => bankText(node))
          .find((text) => text.includes("您当前可得利息"))
          ?.replace(/手动结息/g, "")
          .trim() ?? "")
      : "";
  const noticeStart = blocks.findIndex(
    (block) => block.heading && block.text.includes("注意事项"),
  );
  const notices =
    noticeStart < 0
      ? []
      : blocks.slice(noticeStart + 1).map((block) => block.text);
  const transferFeeRate =
    kind === "transfer"
      ? (/汇款手续费率为\s*([0-9]{1,8}(?:\.[0-9]{1,8})?)\s*‰/.exec(
          blocks.map((block) => block.text).join(" "),
        )?.[1] ?? null)
      : null;
  const handoff: BankBrowserHandoff[] =
    kind === "trading"
      ? [Object.freeze({ operation: "trade-points", destination: url })]
      : [];
  const servicePage: BankServicePage = {
    kind,
    bankId: bank,
    url,
    page,
    ...walletFrom(doc),
    summary,
    interest,
    notices: Object.freeze(notices),
    blocks: Object.freeze(blocks),
    forms: [],
    withdrawals: [],
    handoffs: handoff,
    hasNext: roots.some((root) => nextPage(root, url, page)),
    unsupportedForms: false,
    transferFeeRate,
  };
  return { service: servicePage, table };
}
export function logsFrom(doc: Node, url: string, page: number) {
  const table = section(doc, "理财日志");
  if (!table) return null;
  const records = descendants(
    table,
    (node) =>
      tag(node, "table") &&
      attr(node, "id") === "ttt" &&
      ancestor(node, (parent) => tag(parent, "table")) === table,
  );
  if (records.length !== 1) return null;
  let empty = false;
  const entries: BankLogEntry[] = [];
  for (const row of tableRows(records[0]!)) {
    const columns = cells(row);
    if (columns.length === 1) {
      const text = bankText(columns[0], (node) => hasClass(node, "pg"));
      if (
        !text &&
        descendants(columns[0]!, (node) => hasClass(node, "pg")).length
      )
        continue;
      if (/^还没有相关数据。?$/.test(text)) {
        empty = true;
        continue;
      }
      return null;
    }
    if (columns.length !== 3) return null;
    const message = /^Info:\s*(.+)$/.exec(bankText(columns[0]))?.[1];
    const time = /^Time:\s*(.+)$/.exec(bankText(columns[1]))?.[1];
    if (!message || !time) return null;
    entries.push(Object.freeze({ message, time }));
  }
  return (entries.length === 0) === empty
    ? { entries: Object.freeze(entries), hasNext: nextPage(table, url, page) }
    : null;
}
