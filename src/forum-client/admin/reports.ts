import { object } from "../notice-transport.js";
import { safeURL } from "../routes.js";
import {
  text,
  uid,
  positive,
  records,
  unique,
  reviewReason,
} from "./credits.js";
import { count, flag, id, integer, type Data } from "./wire.js";
import type {
  AdminReport,
  AdminReportDecision,
  AdminReportEffect,
  AdminReports,
  AdminReportScope,
} from "./types.js";

const wireScope = { pending: "new", resolved: "resolved" } as const;
export function reportQuery(scope: AdminReportScope, page: number) {
  if (!Object.hasOwn(wireScope, scope) || !count(page) || page === 0)
    return null;
  return { op: wireScope[scope], ...(page > 1 && { page: String(page) }) };
}
function destination(raw: unknown, origin: string) {
  const url = safeURL(text(raw), origin);
  if (
    !url ||
    url.origin !== origin ||
    new Set(url.searchParams.keys()).size !==
      [...url.searchParams.keys()].length
  )
    return null;
  const mod = url.searchParams.get("mod");
  if (
    url.pathname === "/forum.php" &&
    mod === "viewthread" &&
    uid(url.searchParams.get("tid")) &&
    [...url.searchParams.keys()].every((k) =>
      ["mod", "tid", "pid", "page", "extra"].includes(k),
    )
  )
    return url.href;
  if (
    url.pathname === "/home.php" &&
    mod === "space" &&
    uid(url.searchParams.get("uid")) &&
    [...url.searchParams.keys()].every((k) => ["mod", "uid"].includes(k))
  )
    return url.href;
  return null;
}
export function decodeReports(
  data: Data,
  scope: AdminReportScope,
  origin: string,
): AdminReports | null {
  if (
    data.type !== "adminreport" ||
    data.schema !== 29 ||
    data.op !== wireScope[scope] ||
    !count(data.page) ||
    data.page === 0 ||
    !count(data.pages) ||
    data.pages < data.page ||
    !count(data.count)
  )
    return null;
  const rows = records(data.reports);
  if (!rows || data.count < rows.length) return null;
  const reports: AdminReport[] = [];
  for (const row of rows) {
    const reportId = id(row.id);
    if (!reportId) return null;
    const result = object(row.result);
    const credit = result?.type === "credit" ? object(result.credit) : null;
    const resolution =
      scope === "resolved"
        ? Object.freeze({
            operatorId: id(row.opuid),
            operator: text(row.opname),
            time: count(row.optime) ? row.optime : 0,
            value: credit && integer(result?.value) ? result.value : 0,
            creditTitle: text(credit?.title),
          })
        : null;
    reports.push(
      Object.freeze({
        id: reportId,
        reporterId: id(row.uid),
        reporter: text(row.username),
        message: text(row.message),
        excerpt: text(row.excerpt),
        time: count(row.dateline) ? row.dateline : 0,
        count: positive(row.num, 1),
        forum: text(row.forum),
        forumId: id(row.fid),
        threadId: id(row.tid),
        postId: id(row.pid),
        destination: destination(row.url, origin),
        resolution,
      }),
    );
  }
  if (!unique(reports.map((row) => row.id))) return null;
  const reward = object(data.reward);
  const credit = object(reward?.credit);
  const creditId = id(credit?.id);
  if (
    flag(reward?.enabled) &&
    (!creditId ||
      !integer(reward?.min) ||
      !integer(reward.max) ||
      reward.min > reward.max ||
      !Array.isArray(reward.options) ||
      !reward.options.every(
        (value) =>
          integer(value) &&
          value >= Number(reward.min) &&
          value <= Number(reward.max),
      ))
  )
    return null;
  const offered = flag(reward?.enabled)
    ? Object.freeze({
        credit: Object.freeze({
          id: creditId!,
          title: text(credit?.title),
          unit: text(credit?.unit),
        }),
        min: reward!.min as number,
        max: reward!.max as number,
        options: Object.freeze([...(reward!.options as number[])]),
      })
    : null;
  return Object.freeze({
    kind: "admin-reports",
    scope,
    page: data.page,
    pages: data.pages,
    count: data.count,
    reports: Object.freeze(reports),
    reward: offered,
    maxMessage: positive(object(data.limits)?.msg, 100),
  });
}
function offeredSelection(source: AdminReports, ids: readonly string[]) {
  return (
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.every(
      (value) =>
        uid(value) && source.reports.some((report) => report.id === value),
    ) &&
    unique(ids)
  );
}
export function deleteForm(source: AdminReports, ids: readonly string[]) {
  return offeredSelection(source, ids)
    ? {
        op: "delete",
        ...Object.fromEntries(ids.map((id, index) => [`ids[${index}]`, id])),
      }
    : null;
}
export function resolveForm(
  source: AdminReports,
  decisions: readonly AdminReportDecision[],
) {
  if (
    source.scope !== "pending" ||
    !Array.isArray(decisions) ||
    decisions.some((decision) => !decision) ||
    !offeredSelection(
      source,
      decisions.map((decision) => decision.reportId),
    )
  )
    return null;
  const result: Record<string, string> = { op: "resolve" };
  for (const [index, decision] of decisions.entries()) {
    const amount = decision.reward ?? 0;
    const message = reviewReason(decision.message, source.maxMessage, false);
    if (
      !integer(amount) ||
      message === null ||
      (amount !== 0 &&
        (!source.reward ||
          amount < source.reward.min ||
          amount > source.reward.max ||
          (source.reward.options.length > 0 &&
            !source.reward.options.includes(amount))))
    )
      return null;
    result[`ids[${index}]`] = decision.reportId;
    if (amount) result[`credits[${decision.reportId}]`] = String(amount);
    if (message) result[`msg[${decision.reportId}]`] = message;
  }
  return result;
}
export function reportReceipt(
  data: Data,
  form: Record<string, string>,
  operationId: string,
): AdminReportEffect | null {
  if (
    data.type !== "adminreport" ||
    (data.schema !== undefined && data.schema !== 29) ||
    data.op !== form.op
  )
    return null;
  const requested = Object.entries(form)
    .filter(([name]) => /^ids\[\d+\]$/.test(name))
    .map(([, id]) => id);
  const resolve = form.op === "resolve";
  const raw = resolve ? data.resolved : data.deleted;
  const rawSkipped = resolve ? (data.skipped ?? []) : [];
  if (!Array.isArray(raw) || !Array.isArray(rawSkipped)) return null;
  const applied = raw.map(id);
  const skipped = rawSkipped.map(id);
  const acknowledged = [...applied, ...skipped];
  if (
    !unique(acknowledged) ||
    acknowledged.some((value) => !value || !requested.includes(value))
  )
    return null;
  const unreported = requested.filter((value) => !acknowledged.includes(value));
  return resolve
    ? {
        kind: "reports-resolved",
        operationId,
        resolved: applied as string[],
        skipped: skipped as string[],
        unreported,
      }
    : {
        kind: "reports-deleted",
        operationId,
        deleted: applied as string[],
        unreported,
      };
}
