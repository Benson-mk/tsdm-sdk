import { object, numericId } from "../notice-transport.js";
import {
  member,
  text,
  uid,
  username,
  positive,
  records,
  unique,
  reviewReason,
} from "./credits.js";
import { count, flag, id, integer, reasonCode, type Data } from "./wire.js";
import type {
  AdminGroup,
  AdminGroupChoice,
  AdminGroupChange,
  AdminMember,
  AdminMemberLookup,
} from "./types.js";

export function targetQuery(
  target: AdminMemberLookup,
): Record<string, string> | null {
  if (!target) return null;
  if ("memberId" in target)
    return !("username" in target) && uid(target.memberId)
      ? { uid: target.memberId }
      : null;
  return username(target.username) ? { username: target.username } : null;
}
export function matchesTarget(
  target: AdminMember,
  query: Record<string, string>,
) {
  return (
    query.uid === target.memberId ||
    query.username?.toLowerCase() === target.username.toLowerCase()
  );
}
function choices(
  value: unknown,
  zero = false,
): readonly AdminGroupChoice[] | null {
  const data = records(value);
  if (!data) return null;
  const rows = [];
  for (const item of data) {
    const groupId = zero ? numericId(item.groupid) : id(item.groupid);
    if (!groupId || typeof item.title !== "string") return null;
    rows.push(
      Object.freeze({
        id: groupId,
        title: item.title,
        type: text(item.type),
        adminId: count(item.radminid) ? item.radminid : 0,
        relatedAdmin: flag(item.related_adminid),
        allowed: item.allowed === undefined || flag(item.allowed),
      }),
    );
  }
  return unique(rows.map((row) => row.id)) ? Object.freeze(rows) : null;
}
export function decodeGroup(
  data: Data,
  query: Record<string, string>,
): AdminGroup | null {
  if (data.type !== "admingroup" || data.schema !== 27 || data.op !== undefined)
    return null;
  const row = object(data.member);
  const target = member(row);
  const groups = choices(data.groups);
  const extensionChoices = choices(data.extgroups);
  const expiryChoices = choices(data.expgroups, true);
  if (
    !row ||
    !target ||
    !matchesTarget(target, query) ||
    !groups ||
    !extensionChoices ||
    !expiryChoices ||
    !Array.isArray(data.adminids) ||
    !data.adminids.every(count) ||
    !unique(data.adminids) ||
    !Array.isArray(row.extgroupids) ||
    !records(row.ext_expiry)
  )
    return null;
  const extIds = row.extgroupids.map(id);
  if (extIds.some((groupId) => groupId === null) || !unique(extIds))
    return null;
  const exp = object(row.expiry);
  const after = numericId(exp?.groupid);
  const expiry =
    exp && after !== null && count(exp.time) && exp.time > 0
      ? Object.freeze({
          date: text(exp.date),
          groupId: after,
          ...(count(exp.adminid) &&
            exp.adminid > 0 && { adminId: exp.adminid }),
        })
      : null;
  const ext = records(row.ext_expiry)!;
  const extendedGroups = Object.freeze(
    extIds.map((groupId) =>
      Object.freeze({
        groupId: groupId!,
        expiresOn: text(ext.find((item) => id(item.groupid) === groupId)?.date),
      }),
    ),
  );
  const limits = object(data.limits);
  const why = reasonCode(data.why);
  return Object.freeze({
    kind: "admin-group",
    member: target,
    credits: integer(row.credits) ? row.credits : 0,
    expiry,
    extendedGroups,
    groups,
    extensionChoices,
    expiryChoices,
    adminIds: Object.freeze([...data.adminids] as number[]),
    canChange: flag(data.can),
    adminGrant: flag(data.admin_grant),
    ...(why && { why }),
    maxExtensionLength: positive(limits?.extgroups_len, 30),
    maxReason: positive(limits?.reason, 200),
    reasonRequired: flag(data.reason_required),
  });
}
function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
export function groupForm(source: AdminGroup, intent: AdminGroupChange) {
  if (
    !intent ||
    !uid(intent.groupId) ||
    !Array.isArray(intent.extendedGroups) ||
    (intent.notify !== undefined && typeof intent.notify !== "boolean")
  )
    return null;
  const main = source.groups.find(
    (option) => option.id === intent.groupId && option.allowed,
  );
  const admin = intent.adminId ?? 0;
  if (
    !main ||
    !count(admin) ||
    (admin > 0 && (!main.relatedAdmin || !source.adminIds.includes(admin)))
  )
    return null;
  const resultingAdmin = main.relatedAdmin ? admin : main.adminId;
  if (!source.adminGrant && resultingAdmin !== source.member.adminId)
    return null;
  const expiry = intent.expiry;
  if (expiry != null) {
    const after = source.expiryChoices.find(
      (option) => option.id === expiry.groupId && option.allowed,
    );
    const adminAfter = expiry.adminId ?? 0;
    if (
      !after ||
      !date(expiry.date) ||
      !count(adminAfter) ||
      (adminAfter > 0 &&
        (!source.adminIds.includes(adminAfter) ||
          (after.id !== "0" && after.type !== "member")))
    )
      return null;
    if (!source.adminGrant && adminAfter !== (source.expiry?.adminId ?? 0))
      return null;
  } else if (!source.adminGrant && source.expiry?.adminId) return null;
  const groups = intent.extendedGroups;
  if (
    groups.some(
      (group) =>
        !group ||
        !uid(group.groupId) ||
        !source.extensionChoices.some(
          (option) => option.id === group.groupId && option.allowed,
        ) ||
        (group.expiresOn !== undefined &&
          group.expiresOn !== "" &&
          !date(group.expiresOn)),
    )
  )
    return null;
  const ids = groups.map((group) => group.groupId);
  if (!unique(ids) || ids.join("\t").length > source.maxExtensionLength)
    return null;
  const reason = reviewReason(
    intent.reason,
    source.maxReason,
    source.reasonRequired,
  );
  if (reason === null || (intent.notify && !reason)) return null;
  const body: Record<string, string> = {
    uid: source.member.memberId,
    groupid: intent.groupId,
    ...(main.relatedAdmin && admin > 0 && { adminid: String(admin) }),
    expiry: expiry?.date ?? "",
    ...(expiry && {
      expgroupid: expiry.groupId,
      ...(expiry.adminId && { expadminid: String(expiry.adminId) }),
    }),
  };
  for (const [index, groupId] of ids.entries())
    body[`extgroupids[${index}]`] = groupId;
  for (const group of groups)
    if (group.expiresOn) body[`extexpiry[${group.groupId}]`] = group.expiresOn;
  return {
    ...body,
    ...(reason && { reason }),
    ...(intent.notify && { notify: "1" }),
  };
}
export function groupTargetMatches(data: Data, target: string) {
  return (
    (data.target_uid === undefined || id(data.target_uid) === target) &&
    (data.member === undefined || id(object(data.member)?.uid) === target)
  );
}
