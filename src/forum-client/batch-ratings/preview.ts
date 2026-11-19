import { id, record, rows, string } from "../activity-protocol.js";
import {
  antispam,
  count,
  creditRows,
  formFrom,
  isId,
  on,
  postLink,
  whole,
} from "./protocol.js";
import type {
  BatchRatingAccess,
  BatchRatingIssue,
  BatchRatingItem,
  BatchRatingMode,
  BatchRatingPreview,
  BatchRatingQuota,
  BatchRatingSelection,
  BatchRatingSettings,
} from "./types.js";

type Form = NonNullable<ReturnType<typeof formFrom>>;
const modeCodes = {
  threads: ["list", 1],
  posts: ["check", 2],
  floors: ["range", 3],
} as const;
const defaults = {
  mode_field: "brmode",
  fid_field: "fid",
  tid_field: "tid",
  tids_field: "tids",
  pids_field: "pids",
  floors_field: "floors",
  recalc_field: "recalc",
  submit_field: "ratesubmit",
  score_field: "score{id}",
  reason_field: "reason",
  notify_field: "sendreasonpm",
  exclude_field: "exclude",
  rated_field: "as_rated",
  same_field: "as_same",
  cond_field: "cond[{id}]",
  mult_field: "mult[{pid}]",
};
type Names = typeof defaults;
const fieldKeys = Object.keys(defaults) as (keyof Names)[];
const reserved = new Set([
  "formhash",
  "id",
  "bract",
  "batchid",
  "itemid",
  "tsdmapp",
  "nodoc",
  ...Object.values(defaults).filter((value) => !value.includes("{")),
]);
function namesOf(meta: Record<string, unknown>): Names | null {
  const names = { ...defaults };
  for (const key of fieldKeys) {
    const raw = meta[key];
    if (raw === undefined) continue;
    if (typeof raw !== "string") return null;
    const template = defaults[key].match(/\{(?:id|pid)\}/)?.[0];
    const plain = /^[A-Za-z][A-Za-z0-9_]{0,48}$/;
    if (template) {
      const marker = template === "{id}" ? "\\{id\\}" : "\\{pid\\}";
      if (
        !new RegExp(
          `^[A-Za-z][A-Za-z0-9_]{0,48}(?:${marker}|\\[${marker}\\])$`,
        ).test(raw)
      )
        return null;
      const rendered = raw.replace(template, "1");
      if (/^(?:cond\[|mult\[|score\d)/i.test(rendered) && raw !== defaults[key])
        return null;
    } else if (
      !plain.test(raw) ||
      (reserved.has(raw.toLowerCase()) && raw !== defaults[key])
    )
      return null;
    names[key] = raw;
  }
  if (
    new Set(
      Object.values(names).map((name) => name.replace(/\{(?:id|pid)\}/, "#")),
    ).size !== fieldKeys.length
  )
    return null;
  return names;
}
function modeOf(form: Form, mode: BatchRatingMode) {
  const [key, code] = modeCodes[mode];
  const modes = record(form.meta.modes);
  const queryMode = form.url.searchParams.get("brmode");
  return (!modes || whole(modes[key]) === code) &&
    (!queryMode || queryMode === String(code))
    ? String(code)
    : null;
}
function floorsOf(raw: unknown, max: number) {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  const parts = raw
    .trim()
    .replace(/[～－—至〜]/g, "~")
    .replace(/\s*[~-]\s*/g, "~")
    .split(/[\s,，、;；]+/)
    .filter(Boolean);
  if (!parts.length || parts.length > max) return null;
  const ranges = parts.map((part) => {
    const match = /^(\d{1,7})(?:~(\d{0,7}))?$/.exec(part);
    if (!match) return null;
    const from = Number(match[1]);
    const to =
      match[2] === undefined
        ? from
        : match[2] === ""
          ? Infinity
          : Number(match[2]);
    return from > 0 && to >= from ? { from, to } : null;
  });
  if (!ranges.every((range) => range !== null)) return null;
  ranges.sort((a, b) => a.from - b.from);
  const floors = ranges
    .map(({ from, to }) =>
      to === from ? String(from) : `${from}~${Number.isFinite(to) ? to : ""}`,
    )
    .join(" ");
  return { floors, ranges };
}
const distinctIds = (items: unknown, limit: number): items is string[] =>
  Array.isArray(items) &&
  items.length > 0 &&
  items.length <= limit &&
  items.every(isId) &&
  new Set(items).size === items.length;

export function selectionFields(
  access: BatchRatingAccess,
  form: Form,
  requested: BatchRatingSelection,
) {
  if (!requested || !access.forumId || !access.modes.includes(requested.mode))
    return null;
  const names = namesOf(form.meta);
  const mode = modeOf(form, requested.mode);
  if (
    !names ||
    !mode ||
    [...form.fields.keys()].some((key) => key !== "formhash")
  )
    return null;
  const fields = new URLSearchParams(form.fields);
  fields.set(names.mode_field, mode);
  fields.set(names.fid_field, access.forumId);
  if (requested.mode !== "threads") {
    if (!access.threadId) return null;
    fields.set(names.tid_field, access.threadId);
  }
  let selection: BatchRatingSelection;
  if (requested.mode === "floors") {
    const parsed = floorsOf(requested.floors, access.limits.floorSegments);
    if (!parsed) return null;
    fields.set(names.floors_field, parsed.floors);
    selection = Object.freeze({ mode: "floors", floors: parsed.floors });
  } else {
    const listMode = requested.mode === "threads";
    const ids = listMode ? requested.threadIds : requested.postIds;
    if (!distinctIds(ids, access.limits.maxTotal)) return null;
    fields.set(listMode ? names.tids_field : names.pids_field, ids.join(","));
    const fixed = Object.freeze([...ids]);
    selection = listMode
      ? Object.freeze({ mode: "threads", threadIds: fixed })
      : Object.freeze({ mode: "posts", postIds: fixed });
  }
  return { selection, fields };
}
export function itemFrom(
  row: Record<string, unknown> | null,
  base: string,
): BatchRatingItem | null {
  const threadId = id(row?.tid),
    postId = id(row?.pid),
    position = count(row?.position),
    multiplier = count(row?.mult ?? 1);
  const status = string(row?.status);
  if (!threadId || !postId || !position || !multiplier || !status || !row)
    return null;
  return Object.freeze({
    itemId: id(row.itemid),
    threadId,
    postId,
    position,
    multiplier,
    status,
    authorId: id(row.authorid),
    author: string(row.author),
    subject: string(row.subject),
    statusText: string(row.status_text),
    url: postLink(row.url, base, threadId, postId),
    canUndo: on(row.can_undo) && status === "applied",
  });
}
export function previewFrom(
  data: Record<string, unknown>,
  base: string,
  access: BatchRatingAccess,
  selection: BatchRatingSelection,
) {
  const form = formFrom(data.submit, base, { id: "batchrate:rate" }, [
    "brmode",
  ]);
  const names = form && namesOf(form.meta);
  const mode = form && modeOf(form, selection.mode);
  const threadId = selection.mode === "threads" ? null : access.threadId;
  const forumId = access.forumId;
  if (
    !form ||
    !names ||
    !mode ||
    !forumId ||
    data.ok !== 1 ||
    data.type !== "batchrate_confirm" ||
    data.schema !== 33 ||
    id(data.fid) !== forumId ||
    id(data.tid) !== threadId ||
    whole(data.mode) !== Number(mode)
  )
    return null;
  const { fields } = form;
  const floors =
    selection.mode === "floors"
      ? floorsOf(selection.floors, access.limits.floorSegments)
      : null;
  const fixed = {
    [names.mode_field]: mode,
    [names.fid_field]: forumId,
    [names.tid_field]: threadId ?? "0",
    [names.tids_field]:
      selection.mode === "threads" ? selection.threadIds.join(",") : "",
    [names.pids_field]:
      selection.mode === "posts" ? selection.postIds.join(",") : "",
    [names.floors_field]: floors?.floors ?? "",
  };
  const rawFloor = floors
    ? floorsOf(data.floors, access.limits.floorSegments)?.floors
    : null;
  if (
    (floors && rawFloor !== floors.floors) ||
    [...fields.keys()].some(
      (key) => key !== "formhash" && !Object.hasOwn(fixed, key),
    ) ||
    Object.entries(fixed).some(
      ([key, value]) => (fields.get(key) ?? "") !== value,
    )
  )
    return null;
  const items = rows(data.items)?.map((row) => itemFrom(row, base));
  const total = count(data.total),
    eligible = count(data.apply),
    multiplierSum = count(data.multsum),
    chunks = count(data.chunks);
  if (
    !items?.every((item) => item !== null) ||
    total !== items.length ||
    total > access.limits.maxTotal ||
    eligible === null ||
    eligible > total ||
    multiplierSum === null ||
    chunks === null ||
    new Set(items.map((item) => item.postId)).size !== items.length
  )
    return null;
  const selected = (item: BatchRatingItem) =>
    selection.mode === "threads"
      ? item.position === 1 && selection.threadIds.includes(item.threadId)
      : item.threadId === threadId &&
        (selection.mode === "posts"
          ? selection.postIds.includes(item.postId)
          : floors?.ranges.some(
              ({ from, to }) => item.position >= from && item.position <= to,
            ));
  if (!items.every(selected)) return null;
  const credits = creditRows(data.credits);
  const rawQuota = rows(data.quota);
  if (!credits || !rawQuota) return null;
  const quota = rawQuota.map((row) => {
    const creditId = id(row?.id),
      need = count(row?.need);
    return creditId && need !== null && row
      ? Object.freeze({
          id: creditId,
          need,
          left: count(row.left),
          ok: on(row.ok),
        })
      : null;
  });
  if (!quota.every((row) => row !== null)) return null;
  const thresholds =
    rows(data.cond_credits) ??
    credits.map((credit) => ({
      id: credit.id,
      title: credit.name,
      cond: credit.condition,
    }));
  const validThresholds = thresholds.map((row) => {
    const creditId = id(row?.id);
    return creditId && row
      ? { id: creditId, name: string(row.title), condition: string(row.cond) }
      : null;
  });
  if (!validThresholds.every((row) => row !== null)) return null;
  const check = record(data.precheck);
  const issues: BatchRatingIssue[] = (rows(check?.errors) ?? []).flatMap(
    (row) =>
      row
        ? [
            Object.freeze({
              code: string(row.code),
              creditId: id(row.id),
              message: string(row.message),
            }),
          ]
        : [],
  );
  if (Array.isArray(data.errors))
    for (const message of data.errors)
      if (typeof message === "string")
        issues.push(Object.freeze({ code: "forum", creditId: null, message }));
  const reason = record(data.reason),
    notify = record(data.notify);
  const reasonRequired = on(reason?.required) || access.reasonRequired,
    notifyForced = on(notify?.forced) || access.notifyForced;
  const rules = antispam(data.antispam);
  const blocked = on(data.blocked);
  const settings = Object.freeze({
    scores: Object.freeze(
      Object.fromEntries(credits.map((credit) => [credit.id, credit.score])),
    ),
    conditions: Object.freeze(
      Object.fromEntries(
        validThresholds.map((credit) => [credit.id, credit.condition]),
      ),
    ),
    multipliers: Object.freeze(
      Object.fromEntries(items.map((item) => [item.postId, item.multiplier])),
    ),
    reason: string(reason?.value),
    notify: on(notify?.checked) || notifyForced,
    exclude: string(data.exclude),
    rated: rules.rated || rules.locked || access.antispam.locked,
    same: rules.same || rules.locked || access.antispam.locked,
  });
  const inRange = items
    .filter((item) => item.status === "pending")
    .every(
      (item) =>
        item.multiplier <= access.limits.maxMultiplier &&
        credits.every(
          (credit) =>
            credit.score === 0 ||
            (credit.score * item.multiplier >= credit.min &&
              credit.score * item.multiplier <= credit.max),
        ),
    );
  const canCreate =
    !blocked &&
    eligible > 0 &&
    issues.length === 0 &&
    (!check || on(check.ok)) &&
    quota.every((row) => row.ok) &&
    credits.some((credit) => credit.score !== 0) &&
    (!reasonRequired || !!settings.reason.trim()) &&
    inRange;
  const preview: BatchRatingPreview = Object.freeze({
    forumId,
    threadId,
    selection,
    items: Object.freeze(items),
    credits,
    conditionCredits: Object.freeze(
      validThresholds.map(({ id, name }) => Object.freeze({ id, name })),
    ),
    quota: Object.freeze(quota as BatchRatingQuota[]),
    issues: Object.freeze(issues),
    total,
    eligible,
    multiplierSum,
    chunks,
    blocked,
    canCreate,
    reasonRequired,
    notifyForced,
    antispam: rules,
    ratedOverridden: on(record(data.antispam)?.rated_overridden),
    settings,
  });
  return { preview, form, names };
}
export function settingsFields(
  recorded: NonNullable<ReturnType<typeof previewFrom>>,
  access: BatchRatingAccess,
  incoming: BatchRatingSettings,
  create: boolean,
) {
  const { preview, form, names } = recorded;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming))
    return null;
  const settings = { ...preview.settings, ...incoming };
  const score = record(settings.scores),
    conditions = record(settings.conditions),
    multiples = record(settings.multipliers);
  const text = (value: unknown, limit: number): value is string =>
    typeof value === "string" && value.length <= limit && !value.includes("\0");
  if (
    !score ||
    !conditions ||
    !multiples ||
    !text(settings.reason, 1024) ||
    !text(settings.exclude, 8192) ||
    [settings.notify, settings.rated, settings.same].some(
      (value) => typeof value !== "boolean",
    )
  )
    return null;
  const fields = new URLSearchParams(form.fields);
  let selection = preview.selection;
  if (selection.mode === "floors") {
    const floors = floorsOf(
      settings.floors ?? selection.floors,
      access.limits.floorSegments,
    );
    if (!floors) return null;
    fields.set(names.floors_field, floors.floors);
    selection = Object.freeze({ mode: "floors", floors: floors.floors });
  } else if (settings.floors !== undefined) return null;
  fields.set(create ? names.submit_field : names.recalc_field, "1");
  const seen = new Set(fields.keys());
  function writeNamed(
    template: string,
    token: string,
    id: string,
    value: string,
  ) {
    const key = template.replace(token, id);
    if (
      seen.has(key) ||
      reserved.has(key.toLowerCase()) ||
      /^(?:ratesubmit|recalc)$/i.test(key)
    )
      return false;
    seen.add(key);
    fields.set(key, value);
    return true;
  }
  for (const [id, value] of Object.entries(score)) {
    if (
      !preview.credits.some((credit) => credit.id === id) ||
      typeof value !== "number" ||
      !Number.isSafeInteger(value)
    )
      return null;
    if (value && !writeNamed(names.score_field, "{id}", id, String(value)))
      return null;
  }
  fields.set(names.reason_field, settings.reason.trim());
  if (settings.notify || preview.notifyForced)
    fields.set(names.notify_field, "1");
  if (selection.mode !== "threads") {
    fields.set(names.exclude_field, settings.exclude.trim());
    const locked = preview.antispam.locked || access.antispam.locked;
    if (settings.rated || locked) fields.set(names.rated_field, "1");
    if (settings.same || locked) fields.set(names.same_field, "1");
  }
  for (const [id, value] of Object.entries(conditions)) {
    if (
      !preview.conditionCredits.some((credit) => credit.id === id) ||
      !text(value, 128)
    )
      return null;
    if (value.trim() && !writeNamed(names.cond_field, "{id}", id, value.trim()))
      return null;
  }
  for (const [id, value] of Object.entries(multiples)) {
    if (
      !preview.items.some((item) => item.postId === id) ||
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > access.limits.maxMultiplier
    )
      return null;
    if (value > 1 && !writeNamed(names.mult_field, "{pid}", id, String(value)))
      return null;
  }
  return { fields, selection };
}
