import {
  attr,
  controlDisabled,
  descendants,
  documentFrom,
  fragmentFrom,
  hasClass,
  label,
  text,
  type Element,
} from "./html.js";

import { accountFrom } from "./read-thread.js";

import type { AccountChange, AccountChangeField } from "./account-client.js";

export const methods = {
  password: "chgpassword",
  email: "chgemail",
  "security-question": "chgquestion",
} as const;
const visible = {
  chgpassword: { newpassword: ["password"], renewpassword: ["password"] },
  chgemail: { email: ["text", "email"] },
  chgquestion: { questionidnew: ["select"], answernew: ["text", "password"] },
};
type Method = (typeof methods)[AccountChange];

export function token(value: unknown): string {
  return typeof value === "string" && /^\w+$/.test(value) ? value : "";
}

export function unwrap(body: string): string {
  return (
    /^\s*(?:<\?xml[^>]*\?>\s*)?<root>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/root>\s*$/.exec(
      body,
    )?.[1] ?? body
  );
}

export function scripts(body: string): string {
  return descendants(
    fragmentFrom(unwrap(body)),
    (node) => node.tagName === "script",
  )
    .map((node) => node.childNodes.map(text).join(""))
    .join("\n");
}

export function operationURL(
  raw: string,
  base: URL,
  path: string,
  query: Record<string, string>,
): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, base);
    if (
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname !== path
    )
      return null;
    const seen = new Set<string>();
    for (const key of url.searchParams.keys()) {
      if (seen.has(key)) return null;
      seen.add(key);
    }
    return Object.entries(query).every(
      ([key, value]) => url.searchParams.get(key) === value,
    )
      ? url
      : null;
  } catch {
    return null;
  }
}

function methodURL(raw: string, base: URL, method: Method): URL | null {
  return operationURL(raw, base, "/home.php", {
    mod: "spacecp",
    ac: "account",
    op: "verify",
    method,
  });
}

function signed(url: URL): boolean {
  return Boolean(
    url.searchParams.get("sign") && url.searchParams.get("idstring"),
  );
}

function float(url: URL): URL {
  if (!url.searchParams.has("inajax")) url.search += "&inajax=1";
  else url.searchParams.set("inajax", "1");
  return url;
}

function readOnly(url: URL): boolean {
  return (
    !url.searchParams.has("submit") && !url.searchParams.has("security_submit")
  );
}

export function nativeIdentity(body: string, base: URL): string | null {
  const doc = documentFrom(body);
  const viewer = accountFrom(doc, base.href);
  const head = descendants(doc, (node) => node.tagName === "head")[0];
  const code = head
    ? descendants(head, (node) => node.tagName === "script")
        .map((node) => node.childNodes.map(text).join(""))
        .join("\n")
    : "";
  const ids = new Set(
    [...code.matchAll(/\bdiscuz_uid\s*=\s*['"](0|[1-9]\d*)['"]/g)].map(
      (item) => item[1]!,
    ),
  );
  const headerId =
    viewer.kind === "member" ? viewer.id : viewer.kind === "guest" ? "0" : null;
  if (headerId) ids.add(headerId);
  return ids.size === 1 ? [...ids][0]! : null;
}

export function accountOpening(
  body: string,
  base: URL,
  method: Method,
  expectedId: string,
): URL | null {
  if (nativeIdentity(body, base) !== expectedId) return null;
  const doc = fragmentFrom(unwrap(body));
  if (
    descendants(
      doc,
      (node) =>
        hasClass(node, "alert_error") || attr(node, "id") === "messagelogin",
    ).length
  )
    return null;
  for (const table of descendants(
    doc,
    (node) => node.tagName === "table" && hasClass(node, "tfm"),
  )) {
    for (const link of descendants(table, (node) => node.tagName === "a")) {
      const url = methodURL(attr(link, "href"), base, method);
      if (
        !url ||
        !readOnly(url) ||
        !token(url.searchParams.get("formhash")) ||
        url.searchParams.has("verify") ||
        signed(url)
      )
        continue;
      url.searchParams.set("inajax", "1");
      url.searchParams.set("infloat", "yes");
      url.searchParams.set("handlekey", "security_verify");
      return url;
    }
  }
  return null;
}

interface PrivateForm {
  action: URL;
  hidden: URLSearchParams;
  fields: AccountChangeField[];
}
export type AccountStep =
  | { kind: "verify" | "change"; form: PrivateForm }
  | { kind: "password-choice" | "signed"; url: URL }
  | { kind: "browser" | "refused" | "invalid" };

function fieldLabel(form: Element, control: Element): string {
  const id = attr(control, "id");
  const associated =
    id &&
    descendants(
      form,
      (node) => node.tagName === "label" && attr(node, "for") === id,
    )[0];
  return associated
    ? label(associated).replace(/\s*[:：]$/, "")
    : attr(control, "name");
}

function formFields(
  form: Element,
  action: URL,
  submit: string,
  expected: Record<string, string[]>,
): PrivateForm | null {
  const hidden = new URLSearchParams();
  const fields: AccountChangeField[] = [];
  const seen = new Set<string>();
  const controls = descendants(
    form,
    (node) =>
      ["input", "button", "select", "textarea"].includes(node.tagName) &&
      !controlDisabled(node),
  );
  for (const control of controls) {
    const name = attr(control, "name");
    const type =
      control.tagName === "input"
        ? attr(control, "type").toLowerCase() || "text"
        : control.tagName;
    if (!name || seen.has(name)) return null;
    seen.add(name);
    if (
      type === "hidden" ||
      (type === "button" &&
        name === submit &&
        ["", "submit"].includes(attr(control, "type")))
    ) {
      hidden.set(
        name,
        attr(control, "value") || (type === "button" ? "true" : ""),
      );
      continue;
    }
    if (!Object.hasOwn(expected, name) || !expected[name]?.includes(type))
      return null;
    const field = {
      name,
      label: fieldLabel(form, control),
      obscure: type === "password" || name === "answernew",
    };
    if (type !== "select") {
      fields.push(field);
      continue;
    }
    if (control.attrs.some(({ name }) => name === "multiple")) return null;
    const options = descendants(
      control,
      (node) => node.tagName === "option" && !controlDisabled(node),
    );
    const choices = options.map((node) => ({
      value:
        node.attrs.find(({ name }) => name === "value")?.value ?? label(node),
      label: label(node),
    }));
    const selected = options.findIndex((option) =>
      option.attrs.some(({ name }) => name === "selected"),
    );
    const initial = choices[Math.max(selected, 0)]?.value;
    if (initial === undefined) return null;
    fields.push({ ...field, choices, initial });
  }
  if (
    !hidden.get(submit) ||
    !token(hidden.get("formhash")) ||
    hidden.get("formhash") !== action.searchParams.get("formhash") ||
    fields.length !== Object.keys(expected).length
  )
    return null;
  return { action: float(action), hidden, fields };
}

export function accountStep(
  body: string,
  base: URL,
  method: Method,
  signedFrom?: URL,
): AccountStep {
  const doc = fragmentFrom(unwrap(body));
  const code = scripts(body);
  const link = new RegExp(
    `\\bshowWindow\\(\\s*["']${method}["']\\s*,\\s*["']([^"']+)["']`,
  ).exec(code)?.[1];
  if (link && !signedFrom) {
    const url = methodURL(link.replaceAll("&amp;", "&"), base, method);
    if (url && readOnly(url) && signed(url) && !url.searchParams.has("verify"))
      return { kind: "signed", url: float(url) };
    return { kind: "invalid" };
  }
  const forms = descendants(doc, (node) => node.tagName === "form");
  for (const form of forms) {
    const url = methodURL(attr(form, "action"), base, method);
    if (!url || attr(form, "method").toLowerCase() !== "post") continue;
    const params = url.searchParams;
    if (
      !signedFrom &&
      params.get("verify") === "password" &&
      params.get("security_submit") === "yes" &&
      !params.has("submit") &&
      !signed(url)
    ) {
      const parsed = formFields(form, url, "security_submit", {
        password: ["password"],
      });
      return parsed ? { kind: "verify", form: parsed } : { kind: "invalid" };
    }
    if (
      params.get("submit") === "yes" &&
      signed(url) &&
      !params.has("security_submit") &&
      !params.has("verify") &&
      (!signedFrom ||
        ["idstring", "sign", "formhash"].every(
          (key) => params.get(key) === signedFrom.searchParams.get(key),
        ))
    ) {
      const parsed = formFields(form, url, "submit", visible[method]);
      return parsed ? { kind: "change", form: parsed } : { kind: "invalid" };
    }
  }
  if (forms.length) return { kind: "invalid" };
  let otherCheck = false;
  for (const anchor of descendants(doc, (node) => node.tagName === "a")) {
    const url = methodURL(attr(anchor, "href"), base, method);
    const verify = url?.searchParams.get("verify");
    if (!url || !verify || !readOnly(url)) continue;
    if (verify === "password")
      return { kind: "password-choice", url: float(url) };
    otherCheck = true;
  }
  if (otherCheck) return { kind: "browser" };
  return {
    kind:
      /\berrorhandle_(?:security_verify)?\(\s*['"]/.test(code) &&
      label(doc) !== "验证通过"
        ? "refused"
        : "invalid",
  };
}

export function nativeChangeResult(
  body: string,
): "changed" | "refused" | "unverified" {
  const doc = fragmentFrom(unwrap(body));
  const message = label(doc);
  const code = scripts(body);
  if (message === "修改成功" && /\blocation\.reload\(\)/.test(code))
    return "changed";
  if (
    message === "Email 地址无效" ||
    descendants(doc, (node) => hasClass(node, "alert_error")).length ||
    /\berrorhandle_\w*\(\s*['"]/.test(code)
  )
    return "refused";
  return "unverified";
}
