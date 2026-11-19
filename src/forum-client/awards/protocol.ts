import { answer, forumURL, readIssue, urlAt } from "../credits/protocol.js";
import {
  integer,
  numericId,
  object,
  type NoticeHost,
  type NoticeSession,
} from "../notice-transport.js";
import type {
  AwardsCatalogue,
  AwardsQuery,
  AwardsRecord,
  AwardsValue,
} from "./types.js";

export { answer, forumURL, readIssue };
export const medalPlugin = "dsu_medalCenter:memcp";
export const titlePlugin = "tsdmtitle:tsdmtitle";
export function pluginURL(
  origin: string,
  id: string,
  query: Record<string, string> = {},
) {
  return urlAt(origin, "/plugin.php", { id, ...query });
}
const catalogues = {
  medals: {
    plugin: medalPlugin,
    records: "medals",
    metadata: ["query", "types", "representation"],
  },
  mymedals: {
    plugin: medalPlugin,
    native: "mymedal",
    records: "medals",
    metadata: ["log", "preview_limit", "hide_warning"],
  },
  medalgrant: {
    plugin: medalPlugin,
    native: "grant",
    records: "medals",
    metadata: [
      "supported",
      "can_grant",
      "can_revoke_all",
      "records",
      "limits",
      "revoke_window",
    ],
  },
  achievements: {
    plugin: "tsdmtitle:achi",
    records: "list",
    metadata: ["activated", "achitype", "types"],
  },
  titles: { plugin: titlePlugin, records: "titles", metadata: ["query"] },
  titleshop: {
    plugin: titlePlugin,
    native: "shop",
    records: "items",
    metadata: ["query", "credit"],
  },
  titleexchange: {
    plugin: titlePlugin,
    native: "exchange",
    records: "items",
    metadata: ["query", "filters"],
  },
  titleissue: {
    plugin: titlePlugin,
    native: "issue",
    records: "titles",
    metadata: ["supported", "can_issue", "limits", "logs"],
  },
  bggrant: {
    plugin: "background:memcp",
    records: "backgrounds",
    metadata: [
      "supported",
      "can_grant",
      "can_manage",
      "keyword",
      "page",
      "pages",
      "count",
      "perpage",
      "expiry",
      "limits",
    ],
  },
} satisfies Record<
  AwardsCatalogue,
  { plugin: string; native?: string; records: string; metadata: string[] }
>;

export function catalogueRoute(
  origin: string,
  catalogue: AwardsCatalogue,
  query: AwardsQuery,
) {
  if (!Object.hasOwn(catalogues, catalogue) || !object(query)) return null;
  const definition: (typeof catalogues)[AwardsCatalogue] & { native?: string } =
    catalogues[catalogue];
  const {
    page = 1,
    typeid = 0,
    filter = "all",
    sort = "order",
    q = "",
    keyword = "",
  } = query;
  if (
    !integer(page, 1) ||
    !integer(typeid, 0) ||
    ![filter, sort, q, keyword].every(
      (value) => typeof value === "string" && value.length <= 255,
    )
  )
    return null;
  const native = pluginURL(
    origin,
    definition.plugin,
    definition.native ? { action: definition.native } : {},
  );
  const parameters: Record<string, string> = { page: String(page) };
  if (catalogue === "medals") {
    Object.assign(parameters, {
      typeid: String(typeid),
      filter,
      sort,
      ...(q ? { q } : {}),
    });
    if (typeid) native.searchParams.set("typeid", String(typeid));
    if (q)
      native.searchParams.set(
        "sq",
        btoa(String.fromCharCode(...new TextEncoder().encode(q))),
      );
  }
  if (catalogue === "titles") parameters.pp = "200";
  if (catalogue === "titleexchange")
    Object.assign(parameters, { filter, ...(q ? { q } : {}) });
  if (catalogue === "bggrant") {
    if (page === 1) delete parameters.page;
    if (keyword) parameters.kw = keyword;
  }
  if (["titleissue", "achievements"].includes(catalogue))
    delete parameters.page;
  else if (page > 1) native.searchParams.set("page", String(page));
  const structured =
    catalogue === "achievements"
      ? pluginURL(origin, "tsdmtitle:achi", {
          tsdmapp: "json",
          tsdmv: "4",
          nodoc: "1",
        })
      : pluginURL(origin, "tsdmapp:api", { action: catalogue, ...parameters });
  return { native, structured, definition, parameters };
}

function value(item: unknown): AwardsValue {
  if (Array.isArray(item)) return Object.freeze(item.map(value));
  if (
    item === null ||
    typeof item === "string" ||
    typeof item === "number" ||
    typeof item === "boolean"
  )
    return item;
  const record = object(item);
  if (!record) return null;
  return Object.freeze(
    Object.fromEntries(
      Object.entries(record)
        .filter(
          ([key]) =>
            !["formhash", "fields", "head", "document", "native_url"].includes(
              key,
            ) && !key.endsWith("_form"),
        )
        .map(([key, field]) => [key, value(field)]),
    ),
  );
}
export const publicRecord = (record: Record<string, unknown>): AwardsRecord =>
  value(record) as AwardsRecord;
export function rows(items: unknown) {
  return Array.isArray(items)
    ? items.map(object).filter((item) => item !== null)
    : [];
}

export async function readReply(
  host: NoticeHost,
  url: URL,
  session: NoticeSession,
) {
  const reply = await host.request(url.href, session);
  if (reply.kind !== "response") return reply;
  const decoded = answer(reply.response);
  const issue = readIssue(reply.response, decoded.data, session.memberId);
  return issue ?? { kind: "decoded" as const, ...decoded };
}

export function endpoint(
  raw: unknown,
  base: URL,
  id: string,
  action: string,
  key = "action",
) {
  const url = forumURL(raw, base, "/plugin.php");
  return url &&
    url.searchParams.size === 2 &&
    url.searchParams.get("id") === id &&
    url.searchParams.get(key) === action
    ? url
    : null;
}
export interface Plan {
  url: URL;
  fields?: Record<string, string>;
  terms: AwardsRecord;
  successPrefix?: string;
}
export function postPlan(
  raw: unknown,
  base: URL,
  id: string,
  action: string,
  extra: Record<string, string>,
  terms: AwardsRecord,
  key = "action",
): Plan | null {
  const form = object(raw);
  const fields = object(form?.fields);
  const url = endpoint(form?.url, base, id, action, key);
  if (
    !url ||
    !fields ||
    (form?.method !== undefined && form.method !== "POST") ||
    typeof fields.formhash !== "string" ||
    !/^[a-zA-Z0-9]{8}$/.test(fields.formhash) ||
    Object.keys(extra).some((name) => Object.hasOwn(fields, name))
  )
    return null;
  const fixed: Record<string, string> = {};
  for (const [name, field] of Object.entries(fields)) {
    if (
      !/^\w[\w[\]-]*$/.test(name) ||
      ["__proto__", "constructor", "prototype"].includes(name) ||
      !["string", "number"].includes(typeof field)
    )
      return null;
    fixed[name] = String(field);
  }
  return { url, fields: { ...fixed, ...extra }, terms };
}
export function selected(items: unknown, id: number, key = "id") {
  if (!integer(id, 1)) return null;
  const matches = rows(items).filter(
    (row) => numericId(row[key]) === String(id),
  );
  return matches.length === 1 ? matches[0]! : null;
}
export function ids(values: unknown, max: number): values is readonly number[] {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.length <= max &&
    values.every((value) => integer(value, 1)) &&
    new Set(values).size === values.length
  );
}
export function limit(limits: unknown, key: string, fallback: number) {
  const n = object(limits)?.[key];
  return integer(n, 1) ? n : fallback;
}
