import { operationURL, token } from "./account-forms.js";
import {
  attr,
  descendants,
  hasClass,
  label,
  type Element,
  type Node,
} from "./html.js";
import { fixedFields, record, type Fields } from "./profile-forms.js";
import type { BlacklistMember } from "./profile-client.js";

export const blacklistQuery = {
  mod: "spacecp",
  ac: "plugin",
  id: "blockuser:spacecp",
};
export interface BlacklistForm {
  action: URL;
  fields: Fields;
}
interface BlacklistPage {
  members: BlacklistMember[];
  count: number | null;
  limit: number | null;
  complete: boolean;
  lookup: BlacklistMember | null;
  lookupError: string;
  add: BlacklistForm | null;
  remove: Map<string, BlacklistForm>;
  structured: boolean;
}
function positive(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value))
    value = String(value);
  return typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : null;
}
const actionOf = (raw: string, base: URL) => {
  const url = operationURL(raw, base, "/home.php", blacklistQuery);
  return url &&
    [...url.searchParams.keys()].every(
      (key) => Object.hasOwn(blacklistQuery, key) || key === "mobile",
    )
    ? url
    : null;
};
function formOf(
  action: URL | null,
  fields: Fields,
  id: string,
  write: "add" | "del",
): BlacklistForm | null {
  const data = new Map(fields);
  if (
    !action ||
    data.size !== fields.length ||
    !token(data.get("formhash")) ||
    data.get(`blockuser${write}`) !== "yes" ||
    data.has(`blockuser${write === "add" ? "del" : "add"}`) ||
    (data.has("buid") && data.get("buid") !== id)
  )
    return null;
  data.set("buid", id);
  return { action, fields: [...data] };
}
function structuredForm(
  value: unknown,
  base: URL,
  id: string,
  write: "add" | "del",
) {
  const form = record(value);
  if (
    form.method !== "POST" ||
    form.enctype !== "application/x-www-form-urlencoded" ||
    form.uid_field !== "buid"
  )
    return null;
  const fields = fixedFields(form.fields);
  return fields
    ? formOf(actionOf(String(form.url ?? ""), base), fields, id, write)
    : null;
}
export function structuredBlacklist(
  data: Record<string, unknown>,
  base: URL,
  owner: string,
  target?: string,
): BlacklistPage | null {
  if (
    data.ok !== 1 ||
    data.type !== "blockuser" ||
    data.schema !== 56 ||
    !Array.isArray(data.list) ||
    typeof data.count !== "number" ||
    !Number.isSafeInteger(data.count) ||
    data.count < data.list.length ||
    typeof data.pages !== "number" ||
    !Number.isSafeInteger(data.pages) ||
    data.pages < 1
  )
    return null;
  const members: BlacklistMember[] = [];
  const remove = new Map<string, BlacklistForm>();
  for (const item of data.list.map(record)) {
    const id = positive(item.uid);
    if (
      !id ||
      id === owner ||
      members.some((row) => row.id === id) ||
      (typeof item.username !== "string" && item.gone !== 1)
    )
      return null;
    members.push({
      id,
      name: item.gone === 1 ? "" : String(item.username).trim(),
    });
    const form = structuredForm(data.remove, base, id, "del");
    if (form) remove.set(id, form);
  }
  const error = record(data.error);
  const lookupError =
    target && typeof error.code === "string" && /^[a-z_]+$/.test(error.code)
      ? error.code
      : "";
  const confirm = record(data.confirm);
  if (target && confirm.uid !== undefined && positive(confirm.uid) !== target)
    return null;
  const listed = members.find((row) => row.id === target);
  const confirmed =
    target &&
    positive(confirm.uid) === target &&
    typeof confirm.username === "string"
      ? { id: target, name: confirm.username.trim() }
      : null;
  const lookup = listed ?? confirmed;
  const add =
    lookup && !listed && !lookupError && data.can_add === 1
      ? structuredForm(data.add, base, lookup.id, "add")
      : null;
  return {
    members,
    count: data.count,
    limit: positive(data.max) ? Number(data.max) : null,
    complete: data.pages === 1 && data.count === members.length,
    lookup,
    lookupError,
    add,
    remove,
    structured: true,
  };
}
function only(node: Node, predicate: (item: Element) => boolean) {
  const results = descendants(node, predicate);
  return results.length === 1 ? results[0] : undefined;
}
const idOf = (node: Node, id: string) =>
  only(node, (item) => attr(item, "id") === id);
const classOf = (node: Node, cls: string) =>
  only(node, (item) => hasClass(item, cls));
const uidLabel = (node: Node) =>
  /^UID\s*(\d+)$/.exec(label(classOf(node, "bu-uid")))?.[1];
function linkedUid(node: Node, base: URL) {
  const raw = attr(node, "href");
  const url = operationURL(raw, base, "/home.php", { mod: "space" });
  if (url) return positive(url.searchParams.get("uid"));
  const rewritten = /^(?:\/)?space-uid-([1-9]\d*)\.html$/.exec(raw)?.[1];
  return rewritten ?? null;
}
function nativeAction(
  form: Element | undefined,
  base: URL,
  id: string,
  write: "add" | "del",
) {
  if (form?.tagName !== "form" || attr(form, "method").toLowerCase() !== "post")
    return null;
  const fields: Fields = descendants(
    form,
    (node) => node.tagName === "input",
  ).map((node) => [attr(node, "name"), attr(node, "value")]);
  if (
    descendants(
      form,
      (node) => node.tagName === "input" && attr(node, "type") !== "hidden",
    ).length ||
    !fields.some(([key, value]) => key === "buid" && value === id)
  )
    return null;
  return formOf(actionOf(attr(form, "action"), base), fields, id, write);
}
export function nativeBlacklist(
  doc: Node,
  html: string,
  base: URL,
  owner: string,
  target?: string,
): BlacklistPage | null {
  if (!/<\/html>/i.test(html)) return null;
  const page = idOf(doc, "bu_page");
  if (!page) return null;
  const quota = /\b(\d{1,6})\s*[/／]\s*(\d{1,6})\b/.exec(
    label(idOf(page, "bu_quota")),
  );
  const count = quota ? Number(quota[1]) : null;
  const limit = quota && Number(quota[2]) > 0 ? Number(quota[2]) : null;
  const table = idOf(page, "bu_list");
  const empty = idOf(page, "bu_empty");
  if (
    table
      ? table.tagName !== "table" || empty
      : !empty ||
        empty.tagName !== "p" ||
        !hasClass(empty, "bu-empty") ||
        !label(empty) ||
        !idOf(page, "bu_listtitle") ||
        count !== 0
  )
    return null;
  const members: BlacklistMember[] = [];
  const remove = new Map<string, BlacklistForm>();
  for (const row of table
    ? descendants(
        table,
        (node) =>
          node.tagName === "tr" && node.parentNode?.nodeName !== "thead",
      )
    : []) {
    const id = /^bu_row_([1-9]\d*)$/.exec(attr(row, "id"))?.[1];
    const name = classOf(row, "bu-name");
    const link = name ? only(name, (node) => node.tagName === "a") : undefined;
    if (
      !id ||
      id === owner ||
      members.some((member) => member.id === id) ||
      !link ||
      linkedUid(link, base) !== id ||
      uidLabel(row) !== id
    )
      return null;
    members.push({ id, name: label(link) });
    const form = nativeAction(classOf(row, "bu-delform"), base, id, "del");
    if (form) remove.set(id, form);
  }
  const confirm = idOf(page, "bu_confirm");
  if (target && confirm && uidLabel(confirm) !== target) return null;
  const listed = members.find((member) => member.id === target);
  const name = confirm ? label(idOf(confirm, "bu_confirmname")) : "";
  const lookup = listed ?? (target && name ? { id: target, name } : null);
  const add =
    confirm && lookup && !listed
      ? nativeAction(idOf(confirm, "bu_addform"), base, lookup.id, "add")
      : null;
  const complete =
    count === members.length &&
    !descendants(page, (node) => hasClass(node, "pg")).length;
  return {
    members,
    count,
    limit,
    complete,
    lookup,
    lookupError: "",
    add,
    remove,
    structured: false,
  };
}
