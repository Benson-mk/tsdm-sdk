import { attr, descendants, hasClass, type Element } from "../html.js";
import {
  ancestor,
  bankId,
  bankRoute,
  bankText,
  bankURL,
  cells,
  has,
  tableRows,
} from "./protocol.js";
import type {
  BankBrowserHandoff,
  BankServicePage,
  BankWithdrawal,
} from "./types.js";

export interface OfferedWithdrawal {
  record: BankWithdrawal;
  url: string;
}
export function recordActions(table: Element, page: BankServicePage) {
  const withdrawals: OfferedWithdrawal[] = [];
  const handoffs: BankBrowserHandoff[] = [];
  let unsupported = false;
  const bank = page.bankId;
  if (!bank || (page.kind !== "fixed" && page.kind !== "loans"))
    return { withdrawals, handoffs, unsupported };
  const rows = tableRows(table);
  const notice = rows.findIndex((row) =>
    cells(row).some(
      (col) =>
        hasClass(col, "footoperation") && bankText(col).includes("注意事项"),
    ),
  );
  for (const link of descendants(table, (node) => node.tagName === "a")) {
    const row = ancestor(link, (node) => node.tagName === "tr");
    const recordTable =
      row && ancestor(row, (node) => node.tagName === "table");
    if (
      !row ||
      !recordTable ||
      recordTable === table ||
      attr(recordTable, "id") !== "ttt" ||
      ancestor(recordTable, (node) => node.tagName === "table") !== table
    )
      continue;
    const outerRow = ancestor(recordTable, (node) => node.tagName === "tr");
    if (notice !== -1 && outerRow && rows.indexOf(outerRow) >= notice) continue;
    const raw = attr(link, "href");
    const label = bankText(link);
    const context = cells(row)
      .filter(
        (col) => !descendants(col, (child) => child.tagName === "a").length,
      )
      .map((col) => bankText(col, (node) => node.tagName === "form"))
      .filter(Boolean)
      .join("\n");
    const action = page.kind === "fixed" ? "fix" : "len";
    const url = bankRoute(raw, page.url, { bankid: bank, action }, [
      "op",
      "noid",
    ]);
    const operation = url?.searchParams.get("op");
    const recordId = url?.searchParams.get("noid");
    const kind =
      page.kind === "fixed" && /取/.test(label)
        ? "withdraw"
        : page.kind === "loans" && /还贷|還貸|还款|還款/.test(label)
          ? "repay-loan"
          : page.kind === "loans" && /取消|撤銷|撤销/.test(label)
            ? "cancel-loan"
            : null;
    if (!kind) continue;
    if (
      !url ||
      !context ||
      !bankId(recordId) ||
      has(link, "onclick") ||
      !page.currency ||
      operation !==
        (kind === "withdraw" ? "out" : kind === "repay-loan" ? "gb" : "gu")
    ) {
      unsupported = true;
      continue;
    }
    if (kind === "withdraw") {
      const record = Object.freeze({ bankId: bank, recordId, label, context });
      withdrawals.push({
        record,
        url: bankURL(url.origin, {
          bankid: bank,
          action,
          op: operation,
          noid: recordId,
        }),
      });
    } else {
      handoffs.push(
        Object.freeze({
          operation: kind,
          destination: url.href,
          bankId: bank,
          recordId,
          context,
        }),
      );
    }
  }
  const uniqueWithdrawals = withdrawals.filter(
    (offer) =>
      withdrawals.filter(
        (test) => offer.record.recordId === test.record.recordId,
      ).length === 1,
  );
  const uniqueHandoffs = handoffs.filter(
    (offer) =>
      handoffs.filter(
        (test) =>
          offer.operation === test.operation &&
          offer.recordId === test.recordId,
      ).length === 1,
  );
  return {
    withdrawals: uniqueWithdrawals,
    handoffs: uniqueHandoffs,
    unsupported:
      unsupported ||
      uniqueWithdrawals.length !== withdrawals.length ||
      uniqueHandoffs.length !== handoffs.length,
  };
}
export const sameWithdrawal = (
  original: OfferedWithdrawal,
  fresh: OfferedWithdrawal,
) =>
  original.url === fresh.url &&
  JSON.stringify(original.record) === JSON.stringify(fresh.record);
