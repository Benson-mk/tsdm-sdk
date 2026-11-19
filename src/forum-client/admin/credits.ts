import { object } from "../notice-transport.js";
import { count, flag, id, integer, type Data } from "./wire.js";
import type {
  AdminCreditAdjustment,
  AdminCreditLookup,
  AdminCreditMember,
  AdminCredits,
  AdminCreditsAdjusted,
} from "./types.js";

export const text = (value: unknown) =>
  typeof value === "string" ? value : "";
export const uid = (value: unknown): value is string =>
  typeof value === "string" && id(value) === value;
export const positive = (value: unknown, fallback: number) =>
  count(value) && value > 0 ? value : fallback;
export const unique = <T>(values: readonly T[]) =>
  new Set(values).size === values.length;
export const records = (value: unknown) =>
  Array.isArray(value) && value.every(object) ? (value as Data[]) : null;
export const username = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 100 &&
  Boolean(value.trim()) &&
  value.trim() === value &&
  !/[\0\r\n]/.test(value);
export function member(value: unknown) {
  const row = object(value);
  const memberId = id(row?.uid);
  if (!memberId || !username(row?.username)) return null;
  return Object.freeze({
    memberId,
    username: row.username,
    groupId: id(row.groupid),
    group: text(row.group),
    adminId: count(row.adminid) ? row.adminid : 0,
    locked: row.status === -1,
    self: flag(row.self),
    founder: flag(row.founder),
  });
}
function creditMap(value: unknown) {
  const map = object(value);
  if (!map) return null;
  const result: Record<string, number> = {};
  for (const [key, number] of Object.entries(map)) {
    if (!uid(key) || !integer(number)) return null;
    result[key] = number;
  }
  return Object.freeze(result);
}
function creditMembers(value: unknown): readonly AdminCreditMember[] | null {
  const rows = records(value);
  if (!rows) return null;
  const members = [];
  for (const row of rows) {
    const account = member(row);
    const balances = creditMap(row.credits);
    if (!account || !balances) return null;
    members.push(Object.freeze({ member: account, balances }));
  }
  return unique(members.map((row) => row.member.memberId))
    ? Object.freeze(members)
    : null;
}
export function creditQuery(target: AdminCreditLookup) {
  if (!target) return null;
  const { memberIds = [], usernames = [] } = target;
  if (
    !Array.isArray(memberIds) ||
    !Array.isArray(usernames) ||
    memberIds.length + usernames.length > 50 ||
    !memberIds.every(uid) ||
    !usernames.every(username) ||
    !unique(memberIds) ||
    !unique(usernames)
  )
    return null;
  return {
    ...(memberIds.length && { uids: memberIds.join(",") }),
    ...(usernames.length && { usernames: usernames.join("\n") }),
  };
}
export function decodeCredits(
  data: Data,
  query: Record<string, string>,
): AdminCredits | null {
  if (
    data.type !== "admincredit" ||
    data.schema !== 26 ||
    data.op !== undefined
  )
    return null;
  const rows = records(data.credits);
  const members = creditMembers(data.members);
  if (
    !rows ||
    !members ||
    !Array.isArray(data.missing) ||
    !data.missing.every(username)
  )
    return null;
  const ids = query.uids?.split(",") ?? [];
  const names =
    query.usernames?.split("\n").map((name) => name.toLowerCase()) ?? [];
  if (
    members.some(
      ({ member }) =>
        !ids.includes(member.memberId) &&
        !names.includes(member.username.toLowerCase()),
    )
  )
    return null;
  const creditTypes = [];
  for (const row of rows) {
    const typeId = id(row.id);
    if (!typeId || typeof row.title !== "string") return null;
    creditTypes.push(
      Object.freeze({ id: typeId, title: row.title, unit: text(row.unit) }),
    );
  }
  if (!unique(creditTypes.map((row) => row.id))) return null;
  const limits = object(data.limits);
  return Object.freeze({
    kind: "admin-credits",
    members,
    missing: Object.freeze([...data.missing] as string[]),
    creditTypes: Object.freeze(creditTypes),
    limits: Object.freeze({
      users: positive(limits?.users, 50),
      delta: positive(limits?.delta, 99999999),
      reason: positive(limits?.reason, 200),
    }),
    reasonRequired: flag(data.reason_required),
  });
}
export function reviewReason(reason: unknown, max: number, required: boolean) {
  if (reason !== undefined && typeof reason !== "string") return null;
  const value = text(reason).trim();
  return /\0/.test(value) || [...value].length > max || (required && !value)
    ? null
    : value;
}
export function rewardForm(
  source: AdminCredits,
  intent: AdminCreditAdjustment,
) {
  if (
    !intent ||
    !Array.isArray(intent.memberIds) ||
    !intent.memberIds.length ||
    !intent.memberIds.every(uid) ||
    !unique(intent.memberIds) ||
    intent.memberIds.length > source.limits.users ||
    intent.memberIds.some(
      (uid) => !source.members.some((row) => row.member.memberId === uid),
    ) ||
    (intent.notify !== undefined && typeof intent.notify !== "boolean")
  )
    return null;
  const deltas = creditMap(intent.deltas);
  const reason = reviewReason(
    intent.reason,
    source.limits.reason,
    source.reasonRequired,
  );
  if (!deltas || reason === null || (intent.notify && !reason)) return null;
  const changes = Object.entries(deltas).filter(([, value]) => value !== 0);
  if (
    !changes.length ||
    changes.some(
      ([id, value]) =>
        Math.abs(value) > source.limits.delta ||
        !source.creditTypes.some((type) => type.id === id),
    )
  )
    return null;
  return {
    uids: intent.memberIds.join(","),
    ...Object.fromEntries(
      changes.map(([id, value]) => [`credits[${id}]`, String(value)]),
    ),
    ...(reason && { reason }),
    ...(intent.notify && { notify: "1" }),
  };
}
export function rewardReceipt(
  data: Data,
  form: Record<string, string>,
  operationId: string,
): AdminCreditsAdjusted | null {
  if (data.type !== "admincredit" || data.schema !== 26 || data.op !== "reward")
    return null;
  const members = creditMembers(data.members);
  const changed = creditMap(data.changed);
  const requested = form.uids!.split(",");
  if (
    !members ||
    !changed ||
    !count(data.notified) ||
    data.notified > requested.length ||
    members.length !== requested.length ||
    members.some((row) => !requested.includes(row.member.memberId))
  )
    return null;
  const fields = Object.keys(form).filter((k) => /^credits\[/.test(k));
  if (
    Object.keys(changed).length !== fields.length ||
    fields.some((k) => String(changed[k.slice(8, -1)]) !== form[k])
  )
    return null;
  return {
    kind: "credits-adjusted",
    operationId,
    changed,
    notified: data.notified,
    members,
  };
}
