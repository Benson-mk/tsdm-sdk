import type { HostResponse } from "../index.js";
import type { AccountStatus } from "./account-client.js";
import { scripts, unwrap } from "./account-forms.js";
import { record, target } from "./discovery/shared.js";
import {
  attr,
  byId,
  controlDisabled,
  descendants,
  fragmentFrom,
  hasClass,
  label,
} from "./html.js";
import type { MemberFailure } from "./member-client.js";

type ActorStatus = AccountStatus | { kind: "native-status" };
export interface MemberSession {
  origin: string;
  session(): string | null;
  identity(
    accountId: string,
    continuity: string,
  ): Promise<ActorStatus | MemberFailure>;
  request(
    url: URL,
    continuity: string,
    body?: URLSearchParams,
    effect?: boolean,
  ): Promise<HostResponse | MemberFailure>;
}
export interface CheckedForm {
  url: URL;
  fields: URLSearchParams;
  groups: string[];
  selected: string;
  structured: boolean;
}

export function qualifiedURL(
  raw: unknown,
  dialog: URL,
  route: Record<string, string>,
): URL | null {
  if (typeof raw !== "string") return null;
  const url = target(raw, dialog.href, "/home.php", "spacecp");
  if (!url || url.username || url.password) return null;
  const q = url.searchParams;
  if (!Object.entries(route).every(([key, value]) => q.get(key) === value))
    return null;
  const extras: Record<string, RegExp> = {
    inajax: /^1$/,
    infloat: /^yes$/,
    handlekey: /^\w+$/,
    spaceuid: /^0$/,
  };
  return [...q].every(
    ([key, value]) =>
      Object.hasOwn(route, key) ||
      (Object.hasOwn(extras, key) && extras[key]?.test(value)),
  )
    ? url
    : null;
}

export function fieldsFromObject(value: unknown): URLSearchParams | null {
  const fields = record(value);
  if (!fields) return null;
  const result = new URLSearchParams();
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val !== "string") return null;
    result.set(key, val);
  }
  return result;
}

export function usableForm(payload: Record<string, unknown>): boolean {
  return [
    payload.unsupported,
    payload.hook_fields,
    record(payload.submit)?.lists,
  ].every(
    (value) =>
      value === undefined ||
      (Array.isArray(value) && value.length === 0) ||
      (value !== null &&
        typeof value === "object" &&
        Object.keys(value).length === 0),
  );
}

export function nativeForm(
  html: string,
  dialog: URL,
  route: Record<string, string>,
  editable: readonly string[],
): CheckedForm | null {
  const fragment = fragmentFrom(unwrap(html));
  const forms = descendants(fragment, (node) => node.tagName === "form");
  if (forms.length !== 1) return null;
  const form = forms[0]!;
  const url = qualifiedURL(attr(form, "action"), dialog, route);
  if (!url || attr(form, "method").toLowerCase() !== "post") return null;
  const fields = new URLSearchParams();
  const groups: string[] = [];
  let selected = "";
  for (const field of descendants(form, (node) =>
    ["input", "select", "textarea"].includes(node.tagName),
  )) {
    if (controlDisabled(field)) continue;
    const name = attr(field, "name");
    const type = attr(field, "type").toLowerCase();
    const value = attr(field, "value");
    if (!name || ["submit", "button"].includes(type)) continue;
    if (name === "gid" && editable.includes(name)) {
      if (field.tagName !== "select" && type !== "radio") return null;
      const choices =
        type === "radio"
          ? [field]
          : descendants(field, (node) => node.tagName === "option");
      for (const option of choices) {
        const id = attr(option, "value");
        if (!/^\d{1,3}$/.test(id) || groups.includes(id)) return null;
        if (controlDisabled(option)) continue;
        groups.push(id);
        if (
          option.attrs.some(
            ({ name }) => name === "selected" || name === "checked",
          )
        )
          selected = id;
      }
    } else if (!editable.includes(name)) {
      if (field.tagName !== "input" || type !== "hidden" || fields.has(name))
        return null;
      fields.set(name, value);
    }
  }
  return {
    url,
    fields,
    groups,
    selected: selected || groups[0] || "",
    structured: false,
  };
}

export function ajaxText(
  response: HostResponse,
  payload: Record<string, unknown> | null,
): string {
  return payload
    ? typeof payload.document === "string"
      ? payload.document
      : ""
    : response.body;
}

export function dialogMessage(html: string): string {
  const doc = fragmentFrom(unwrap(html));
  const alert = descendants(doc, (node) =>
    ["alert_info", "alert_error", "alert_right"].some((name) =>
      hasClass(node, name),
    ),
  )[0];
  const message = alert ?? byId(doc, "messagetext");
  return message
    ? label(message)
    : descendants(doc, (node) => node.tagName === "form").length
      ? ""
      : label(doc);
}

export function nativeReceipt(html: string, handle: string) {
  const match = new RegExp(
    `\\bsucceedhandle_${handle}\\(\\s*'[^'\\r\\n]*'\\s*,\\s*'([^'\\r\\n]*)'\\s*,\\s*\\{([^}\\r\\n]*)\\}\\s*\\)`,
  ).exec(scripts(html));
  if (!match) return null;
  const fields = new Map<string, string>();
  for (const pair of match[2]!.matchAll(/'([a-z]+)'\s*:\s*'([^']*)'/gi)) {
    if (fields.has(pair[1]!)) return null;
    fields.set(pair[1]!, pair[2]!);
  }
  return { message: match[1]!, fields };
}
