import { object } from "../notice-transport.js";
import { count, flag, id, reasonCode, type Data } from "./wire.js";
import {
  member,
  positive,
  records,
  reviewReason,
  text,
  unique,
} from "./credits.js";
import { groupTargetMatches, matchesTarget } from "./groups.js";
import type {
  AdminBan,
  AdminBanAcknowledged,
  AdminBanChange,
  AdminCleanup,
  AdminCleanupCheckpoint,
  AdminCleanupEffect,
  AdminMemberState,
} from "./types.js";

const knownBans: readonly string[] = ["", "post", "visit", "status"];
const knownCleanup: readonly string[] = [
  "post",
  "postcomment",
  "avatar",
  "profile",
];
const banValue = (value: unknown): value is AdminBan =>
  typeof value === "string" && knownBans.includes(value);
const cleanupValue = (value: unknown): value is AdminCleanup =>
  typeof value === "string" && knownCleanup.includes(value);
const cursor = (value: unknown): value is string =>
  typeof value === "string" && /^\d{1,20}-\d{1,20}$/.test(value);
const asCount = (value: unknown) => (count(value) ? value : 0);

export function decodeMemberState(
  data: Data,
  query: Record<string, string>,
): AdminMemberState | null {
  if (data.type !== "adminban" || data.schema !== 30 || data.op !== undefined)
    return null;
  const row = object(data.member);
  const target = member(row);
  const crimes = records(data.crimes);
  if (
    !row ||
    !target ||
    !matchesTarget(target, query) ||
    !banValue(row.banned) ||
    !crimes ||
    !Array.isArray(data.bans) ||
    !data.bans.every(banValue) ||
    !unique(data.bans) ||
    !Array.isArray(data.clear) ||
    !data.clear.every(cleanupValue) ||
    !unique(data.clear) ||
    !Array.isArray(data.days) ||
    !data.days.every(count) ||
    !unique(data.days)
  )
    return null;
  const limits = object(data.limits);
  const why = reasonCode(data.why);
  const postRows = asCount(row.post_rows);
  const postLeft = count(row.post_left) ? row.post_left : null;
  if (postLeft !== null && postLeft > postRows) return null;
  return Object.freeze({
    kind: "admin-member-state",
    member: target,
    banned: row.banned,
    banExpiry: asCount(row.banexpiry),
    posts: asCount(row.posts),
    threads: asCount(row.threads),
    postRows,
    postLeft,
    clearPending: flag(row.clear_pending),
    canChange: flag(data.can),
    ...(why && { why }),
    bans: Object.freeze(data.bans.slice() as AdminBan[]),
    days: Object.freeze(data.days.slice() as number[]),
    cleanupChoices: Object.freeze(data.clear.slice() as AdminCleanup[]),
    batchSize: asCount(data.batch),
    maxDays: positive(limits?.days, 3650),
    maxReason: positive(limits?.reason, 200),
    reasonRequired: flag(data.reason_required),
    crimes: Object.freeze(
      crimes.map((crime) =>
        Object.freeze({
          action: text(crime.action),
          text: text(crime.action_text),
          time: asCount(crime.dateline),
          reason: text(crime.reason),
          operator: text(crime.operator),
        }),
      ),
    ),
  });
}
export function banForm(source: AdminMemberState, intent: AdminBanChange) {
  if (!intent || !banValue(intent.ban) || !source.bans.includes(intent.ban))
    return null;
  const days = intent.days ?? 0;
  if (
    !count(days) ||
    days > source.maxDays ||
    (days > 0 && !["post", "visit"].includes(intent.ban))
  )
    return null;
  const clear = intent.clear ?? [];
  if (
    !Array.isArray(clear) ||
    !unique(clear) ||
    !clear.every(
      (value) => cleanupValue(value) && source.cleanupChoices.includes(value),
    )
  )
    return null;
  const reason = reviewReason(
    intent.reason,
    source.maxReason,
    source.reasonRequired,
  );
  if (reason === null) return null;
  return {
    op: "ban",
    uid: source.member.memberId,
    bannew: intent.ban,
    ...(days > 0 && { banexpirynew: String(days) }),
    ...(reason && { reason }),
    ...Object.fromEntries(
      clear.map((entry, index) => [`clear[${index}]`, entry]),
    ),
  };
}
function checkpoint(
  memberId: string,
  cursor: string,
  remaining: number,
): AdminCleanupCheckpoint {
  return Object.freeze({
    kind: "cleanup-checkpoint",
    memberId,
    cursor,
    remaining,
  });
}
export function banReceipt(
  data: Data,
  form: Record<string, string>,
  operationId: string,
): AdminBanAcknowledged | null {
  const memberId = form.uid!;
  if (
    data.type !== "adminban" ||
    data.schema !== 30 ||
    data.op !== "ban" ||
    (data.target_uid === undefined && data.member === undefined) ||
    !groupTargetMatches(data, memberId) ||
    !Array.isArray(data.cleared) ||
    !data.cleared.every(cleanupValue) ||
    !unique(data.cleared)
  )
    return null;
  const requested = Object.entries(form)
    .filter(([key]) => /^clear\[\d+\]$/.test(key))
    .map(([, value]) => value);
  if (data.cleared.some((value) => !requested.includes(value))) return null;
  const next = object(data.clear_posts);
  let cleanup: AdminCleanupCheckpoint | null = null;
  if (next !== null) {
    if (
      !requested.includes("post") ||
      (next.pending !== 0 && next.pending !== 1) ||
      !count(next.remaining)
    )
      return null;
    if (flag(next.pending)) {
      const key =
        next.cursor === "" || next.cursor === undefined ? "0-0" : next.cursor;
      if (!cursor(key)) return null;
      cleanup = checkpoint(memberId, key, next.remaining);
    } else if (next.remaining !== 0) return null;
  } else if (data.clear_posts != null) return null;
  return {
    kind: "ban-acknowledged",
    memberId,
    operationId,
    cleared: data.cleared.slice() as AdminCleanup[],
    cleanup,
  };
}
export function cleanupSource(
  source: AdminMemberState | AdminCleanupCheckpoint,
) {
  return source.kind === "cleanup-checkpoint"
    ? source
    : source.clearPending && source.postLeft !== null
      ? checkpoint(source.member.memberId, "0-0", source.postLeft)
      : null;
}
export function cleanupReceipt(
  data: Data,
  source: AdminCleanupCheckpoint,
): AdminCleanupEffect | null {
  if (
    data.type !== "adminban" ||
    data.schema !== 30 ||
    data.op !== "clear" ||
    id(data.target_uid) !== source.memberId ||
    !count(data.remaining) ||
    !count(data.posts) ||
    !count(data.threads)
  )
    return null;
  const base = {
    memberId: source.memberId,
    posts: data.posts,
    threads: data.threads,
  };
  if (data.done === 1 && data.remaining === 0)
    return { kind: "cleanup-complete", ...base, remaining: 0 };
  if (
    data.done !== 0 ||
    data.remaining <= 0 ||
    data.remaining >= source.remaining ||
    !cursor(data.cursor) ||
    data.cursor === source.cursor
  )
    return null;
  return {
    kind: "cleanup-progress",
    ...base,
    remaining: data.remaining,
    next: checkpoint(source.memberId, data.cursor, data.remaining),
  };
}
