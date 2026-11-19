import { activityURL, id, record, rows, string } from "../activity-protocol.js";
import { operationURL } from "../account-forms.js";
import {
  noticeHost,
  numericId,
  type NoticeSession,
} from "../notice-transport.js";
import { query } from "../posts/forms.js";
import type { BatchRatingClientOptions, BatchRatingFailure } from "./types.js";

export const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9]\d{0,19}$/.test(value);
export const on = (value: unknown) =>
  value === true || value === 1 || value === "1";
export const whole = (value: unknown) => {
  const n =
    typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) ? n : null;
};
export const count = (value: unknown) => {
  const n = whole(value);
  return n !== null && n >= 0 ? n : null;
};
export const pluginURL = (origin: string, params: Record<string, string>) =>
  query(`${origin}/plugin.php`, params);
export const jsonPage = (url: string) =>
  query(url, { tsdmapp: "json", nodoc: "1" });
export const jsonWrite = (url: string) => query(url, { tsdmapp: "json" });
export function route(
  value: unknown,
  base: string,
  fields: Record<string, string>,
  optional: readonly string[] = [],
) {
  const url =
    typeof value === "string"
      ? operationURL(value, new URL(base), "/plugin.php", fields)
      : null;
  return url &&
    [...url.searchParams.keys()].every(
      (key) => Object.hasOwn(fields, key) || optional.includes(key),
    )
    ? url
    : null;
}
export function formFrom(
  value: unknown,
  base: string,
  target: Record<string, string>,
  optional: readonly string[] = [],
) {
  const meta = record(value);
  const url = route(meta?.url, base, target, optional);
  const source = record(meta?.fields);
  if (
    !meta ||
    !url ||
    !source ||
    meta.method !== "POST" ||
    (meta.enctype !== undefined &&
      meta.enctype !== "application/x-www-form-urlencoded") ||
    typeof source.formhash !== "string" ||
    !/^[\w-]{1,128}$/.test(source.formhash)
  )
    return null;
  const fields = new URLSearchParams();
  for (const [name, value] of Object.entries(source)) {
    if (
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ||
      typeof value !== "string" ||
      /[\0\r\n]/.test(value)
    )
      return null;
    fields.set(name, value);
  }
  return { url, meta, fields };
}
export function refusal(
  data: Record<string, unknown> | null,
): BatchRatingFailure {
  const code = string(data?.message_key) || string(data?.error);
  const message = string(data?.message);
  return {
    kind: "refused",
    ...(code && { code }),
    ...(message && { message }),
  };
}
export function batchHost(options: BatchRatingClientOptions) {
  const { origin, session, current } = noticeHost({
    origin: options.origin,
    session: () => options.session(),
    transport: {
      request: (url, request) =>
        options.transport.request(
          url,
          request.method === "GET"
            ? { ...request, effect: false }
            : { ...request, effect: true },
        ),
    },
  });
  async function exchange(
    url: string,
    owner: NoticeSession,
    fields?: URLSearchParams,
    effect = false,
  ) {
    if (!current(owner)) return { kind: "session-changed" } as const;
    let response;
    try {
      response = await options.transport.request(
        url,
        fields === undefined
          ? { method: "GET", fresh: true, effect: false, session: owner }
          : {
              method: "POST",
              fresh: true,
              effect,
              session: owner,
              body: fields.toString(),
            },
      );
    } catch {
      return { kind: current(owner) ? "network" : "session-changed" } as const;
    }
    if (!current(owner)) return { kind: "session-changed" } as const;
    if (response.redirect !== "none" || response.url !== url)
      return { kind: "invalid-response" } as const;
    let data: Record<string, unknown> | null = null;
    if (/json/i.test(response.contentType)) {
      try {
        data = record(JSON.parse(response.body));
      } catch {
        /* Report an invalid response at the caller. */
      }
    }
    return { kind: "answer", response, data } as const;
  }
  return { origin, session, current, exchange };
}
export type Exchange = Awaited<
  ReturnType<ReturnType<typeof batchHost>["exchange"]>
>;
export function identify(
  exchange: Extract<Exchange, { kind: "answer" }>,
  owner: NoticeSession,
  allowRaw = false,
) {
  const { data, response } = exchange;
  if (
    [401, 403, 429].includes(response.status) ||
    data?.login === 1 ||
    data?.error === "login"
  )
    return refusal(data);
  if (data?.uid !== undefined && numericId(data.uid) !== owner.memberId)
    return { kind: "session-changed" } as const;
  if (
    response.status !== 200 ||
    !data ||
    (!allowRaw && numericId(data.uid) !== owner.memberId)
  )
    return { kind: "invalid-response" } as const;
  if (data.ok === 0 && data.error === "message") return refusal(data);
  return { kind: "data", data } as const;
}
export function antispam(value: unknown) {
  const rules = record(value);
  return Object.freeze({
    rated: on(rules?.rated),
    same: on(rules?.same),
    locked: on(rules?.locked),
  });
}
export function creditRows(value: unknown) {
  const parsed = rows(value)?.map((row) => {
    const creditId = id(row?.id);
    const name = string(row?.title);
    const min = whole(row?.min),
      max = whole(row?.max);
    if (!row || !creditId || !name || min === null || max === null || min > max)
      return null;
    return Object.freeze({
      id: creditId,
      name,
      unit: string(row.unit),
      min,
      max,
      left: count(row.left),
      score: whole(row.score) ?? 0,
      condition: string(row.cond),
    });
  });
  return parsed?.every((row) => row !== null) &&
    new Set(parsed.map((row) => row.id)).size === parsed.length
    ? Object.freeze(parsed)
    : null;
}
export function postLink(
  value: unknown,
  base: string,
  tid: string,
  pid: string,
) {
  const url =
    typeof value === "string" ? activityURL(value, new URL(base)) : null;
  return url?.pathname === "/forum.php" &&
    url.searchParams.get("mod") === "redirect" &&
    url.searchParams.get("goto") === "findpost" &&
    url.searchParams.get("ptid") === tid &&
    url.searchParams.get("pid") === pid
    ? url.href
    : null;
}
