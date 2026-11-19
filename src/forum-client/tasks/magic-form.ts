import type {
  MagicItem,
  MagicOperation,
  MagicField,
  MagicEffectResult,
  MagicPurchaseTerms,
  PreparedMagicForm,
} from "./types.js";
import {
  answer,
  id,
  int,
  record,
  responseIssue,
  rows,
  string,
} from "../activity-protocol.js";
import {
  attr,
  controlDisabled,
  descendants,
  documentFrom,
  hasClass,
  label,
  text,
  type Element,
  type Node,
} from "../html.js";
import { numericId } from "../notice-transport.js";
import type { HostResponse } from "../types.js";
import { homeRoute, href } from "./protocol.js";

const fieldName = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const privateNames =
  /^(?:formhash|handlekey|operation|mid|magicid|usesubmit|operatesubmit|mod|action|password|inajax|infloat)$/i;
const has = (node: Element, name: string) =>
  node.attrs.some((attribute) => attribute.name === name);
const freezeChoices = (choices: { value: string; label: string }[]) =>
  Object.freeze(choices.map((choice) => Object.freeze(choice)));
function visibleControls(scope: Node) {
  return descendants(
    scope,
    (node) =>
      ["input", "select", "textarea"].includes(node.tagName) &&
      !controlDisabled(node) &&
      !["hidden", "submit", "button", "reset"].includes(
        attr(node, "type").toLowerCase(),
      ),
  );
}
function controls(scope: Node): MagicField[] | null {
  if (
    descendants(
      scope,
      (node) =>
        node.tagName === "script" ||
        node.attrs.some((attribute) =>
          /^(?:on\w+|form|formaction|formmethod|formenctype)$/.test(
            attribute.name,
          ),
        ),
    ).length
  )
    return null;
  const input = visibleControls(scope);
  const all = new Map<string, MagicField>();
  for (const node of input) {
    const name = attr(node, "name");
    const rawType = attr(node, "type").toLowerCase();
    if (!fieldName.test(name) || privateNames.test(name)) return null;
    if (all.has(name)) {
      if (
        rawType !== "radio" ||
        !input
          .filter((item) => attr(item, "name") === name)
          .every((item) => attr(item, "type").toLowerCase() === "radio")
      )
        return null;
      continue;
    }
    let type: MagicField["type"] = "text";
    let value = attr(node, "value");
    let choices: { value: string; label: string }[] = [];
    if (node.tagName === "select") {
      if (has(node, "multiple")) return null;
      type = "choice";
      const options = descendants(
        node,
        (item) => item.tagName === "option" && !controlDisabled(item),
      );
      choices = options.map((item) => ({
        value: has(item, "value") ? attr(item, "value") : label(item),
        label: label(item),
      }));
      const selected = options.findLastIndex((item) => has(item, "selected"));
      value = choices[Math.max(selected, 0)]?.value ?? "";
    } else if (rawType === "radio") {
      type = "choice";
      const options = input.filter((item) => attr(item, "name") === name);
      if (options.some((item) => attr(item, "type").toLowerCase() !== "radio"))
        return null;
      choices = options.map((item) => ({
        value: attr(item, "value"),
        label: label(item.parentNode ?? undefined) || attr(item, "value"),
      }));
      const checked = options.findLast((item) => has(item, "checked"));
      value = checked ? attr(checked, "value") : "";
    } else if (node.tagName === "textarea") {
      type = "textarea";
      value = text(node);
    } else if (rawType === "number" || name === "magicnum") {
      type = "number";
    } else if (!["", "text", "tel"].includes(rawType)) return null;
    if (
      type === "choice" &&
      (!choices.length ||
        new Set(choices.map((choice) => choice.value)).size !== choices.length)
    )
      return null;
    const caption = descendants(
      scope,
      (item) =>
        item.tagName === "label" &&
        !!attr(node, "id") &&
        attr(item, "for") === attr(node, "id"),
    )[0];
    const before = node.parentNode?.childNodes
      .slice(0, node.parentNode.childNodes.indexOf(node))
      .findLast(
        (item) =>
          "tagName" in item &&
          item.tagName === "p" &&
          hasClass(item, "mtm") &&
          hasClass(item, "mbn"),
      );
    const max = attr(node, "maxlength");
    all.set(
      name,
      Object.freeze({
        name,
        label: label(caption ?? before) || name,
        type,
        value,
        choices: freezeChoices(choices),
        maxLength: /^\d+$/.test(max) ? int(Number(max)) : null,
        required:
          has(node, "required") ||
          ["tid", "username", "newusername", "magicnum"].includes(name),
      }),
    );
  }
  return [...all.values()];
}
const number = (value: unknown) => {
  const amount = int(value);
  return amount !== null && amount >= 0 ? amount : null;
};
const fromText = (value: string) =>
  /^\d+$/.test(value) ? number(Number(value)) : null;
function buyField(value: string): MagicField {
  return Object.freeze({
    name: "magicnum",
    label: "Quantity",
    type: "number",
    value,
    maxLength: null,
    choices: Object.freeze([]),
    required: true,
  });
}
type FormRecord = {
  url: string;
  fields: URLSearchParams;
  form: PreparedMagicForm;
  legacy: boolean;
};
function ready(
  raw: unknown,
  source: string,
  item: MagicItem,
  operation: MagicOperation,
  fields: URLSearchParams,
  offered: MagicField[],
  notes: string[],
  purchase: MagicPurchaseTerms | null,
  legacy: boolean,
): FormRecord | "invalid" {
  const url = homeRoute(
    raw,
    source,
    { mod: "magic", action: operation === "buy" ? "shop" : "mybox" },
    ["infloat", "inajax"],
  );
  const target = operation === "buy" ? "mid" : "magicid";
  const targetValue = operation === "buy" ? item.identifier : item.id;
  const submit = operation === "buy" ? "operatesubmit" : "usesubmit";
  if (
    !url ||
    (url.searchParams.has("infloat") &&
      url.searchParams.get("infloat") !== "yes") ||
    (url.searchParams.has("inajax") &&
      url.searchParams.get("inajax") !== "1") ||
    fields.get(target) !== targetValue ||
    !/^[\w-]{1,128}$/.test(fields.get("formhash") ?? "") ||
    fields.get("handlekey") !== "magics" ||
    fields.get("operation") !== operation ||
    fields.get(submit) !== "yes" ||
    [...fields.keys()].some(
      (key) =>
        !fieldName.test(key) ||
        (privateNames.test(key) &&
          !["formhash", "handlekey", "operation", target, submit].includes(
            key,
          )),
    )
  )
    return "invalid";
  for (const control of offered) fields.delete(control.name);
  return {
    url: url.href,
    fields,
    legacy,
    form: Object.freeze({
      operation,
      magicId: item.id,
      identifier: item.identifier,
      name: item.name,
      notes: Object.freeze(notes),
      fields: Object.freeze(offered),
      purchase: purchase && Object.freeze(purchase),
    }),
  };
}
export function structuredMagicForm(
  data: Record<string, unknown>,
  source: string,
  item: MagicItem,
  operation: MagicOperation,
) {
  if (
    data.type !== "form" ||
    data.schema !== 17 ||
    data.ok !== 1 ||
    data.form !== `magic${operation}`
  )
    return "invalid";
  if (
    [data.unsupported, data.hook_fields].some(
      (value) => value != null && (!Array.isArray(value) || value.length),
    )
  )
    return "browser";
  const meta = record(data.magic);
  const submit = record(data.submit);
  const raw = record(submit?.fields);
  if (
    !meta ||
    meta.identifier !== item.identifier ||
    (item.id !== null && id(meta.magicid) !== item.id) ||
    !raw ||
    submit?.method !== "POST" ||
    (submit.enctype != null &&
      submit.enctype !== "application/x-www-form-urlencoded")
  )
    return "invalid";
  const fields = new URLSearchParams();
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== "string" || value.includes("\0")) return "invalid";
    fields.set(name, value);
  }
  if (data.formhash != null && data.formhash !== fields.get("formhash"))
    return "invalid";
  if (operation === "buy") {
    const qty = record(data.num);
    if (qty?.name !== "magicnum") return "invalid";
    const price = number(data.price);
    const purchase = {
      price,
      unitPrice: number(data.discountprice) ?? price,
      balance: number(data.balance),
      unitWeight: number(data.weight),
      freeWeight: number(data.free_weight),
      stock: number(data.stock),
      credit: record(data.credit),
    };
    if (purchase.unitPrice === null) return "browser";
    return ready(
      submit.url,
      source,
      item,
      operation,
      fields,
      [buyField(string(qty.value) || "1")],
      [string(meta.description)].filter(Boolean),
      purchase,
      false,
    );
  }
  const markup = documentFrom(string(data.show_html));
  const offered = controls(markup);
  const declared = rows(data.controls);
  const types: Record<MagicField["type"], string[]> = {
    text: ["text", "tel"],
    number: ["number"],
    textarea: ["textarea"],
    choice: ["select", "select-one", "radio"],
  };
  if (
    !offered ||
    !declared ||
    declared.length !== offered.length ||
    new Set(declared.map((row) => row?.name)).size !== declared.length ||
    declared.some(
      (row) =>
        !offered.some(
          (control) =>
            control.name === row?.name &&
            types[control.type].includes(string(row?.type)),
        ),
    )
  )
    return "browser";
  const notes = Array.isArray(data.texts)
    ? data.texts.filter((value): value is string => typeof value === "string")
    : [];
  return ready(
    submit.url,
    source,
    item,
    operation,
    fields,
    offered,
    notes,
    null,
    false,
  );
}
export function nativeMagicForm(
  doc: Node,
  source: string,
  item: MagicItem,
  operation: MagicOperation,
) {
  const forms = descendants(
    doc,
    (node) => node.tagName === "form" && attr(node, "id") === "magicform",
  );
  if (forms.length !== 1) return "browser";
  const form = forms[0]!;
  if (attr(form, "method").toLowerCase() !== "post") return "invalid";
  const fields = new URLSearchParams();
  const hidden = descendants(
    form,
    (node) =>
      node.tagName === "input" &&
      attr(node, "type").toLowerCase() === "hidden" &&
      !controlDisabled(node),
  );
  for (const node of hidden) {
    const name = attr(node, "name");
    const value = attr(node, "value");
    if (has(node, "form") || (fields.has(name) && fields.get(name) !== value))
      return "invalid";
    fields.set(name, value);
  }
  const paragraphs = descendants(form, (node) => node.tagName === "p");
  const notes = paragraphs.map(label).filter(Boolean);
  if (operation === "buy") {
    const inputs = visibleControls(form);
    if (
      inputs.length !== 1 ||
      attr(inputs[0]!, "name") !== "magicnum" ||
      has(inputs[0]!, "form")
    )
      return "browser";
    const read = (name: string) => {
      const nodes = descendants(form, (node) => attr(node, "id") === name);
      return nodes.length === 1 ? fromText(label(nodes[0])) : null;
    };
    const stock = paragraphs.find((node) => /^库存\s*[:：]/.test(label(node)));
    const scripts = descendants(doc, (node) => node.tagName === "script")
      .map((node) => node.childNodes.map(text).join(""))
      .join("\n");
    const literal = (name: string) => {
      const matches = [
        ...scripts.matchAll(
          new RegExp(`\\bvar\\s+${name}\\s*=\\s*(\\d+)\\s*;`, "g"),
        ),
      ];
      return matches.length === 1 ? fromText(matches[0]![1]!) : null;
    };
    const price = read("magicprice");
    const purchase = {
      price,
      unitPrice: read("discountprice") ?? price,
      balance: literal("totalcredit"),
      unitWeight: read("magicweight"),
      freeWeight: literal("totalweight"),
      stock: stock ? fromText(/\d+/.exec(label(stock))?.[0] ?? "") : null,
      credit: null,
    };
    if (purchase.unitPrice === null) return "browser";
    return ready(
      attr(form, "action"),
      source,
      item,
      operation,
      fields,
      [buyField(attr(inputs[0]!, "value") || "1")],
      notes,
      purchase,
      true,
    );
  }
  const details = descendants(
    form,
    (node) => node.tagName === "dl" && hasClass(node, "xld"),
  );
  const settings =
    details.length === 1
      ? descendants(
          details[0]!,
          (node) => node.tagName === "div" && hasClass(node, "pns"),
        )
      : [];
  if (
    settings.length !== 1 ||
    visibleControls(form).some(
      (node) => !visibleControls(settings[0]!).includes(node),
    )
  )
    return "browser";
  const offered = controls(settings[0]!);
  return offered
    ? ready(
        attr(form, "action"),
        source,
        item,
        operation,
        fields,
        offered,
        notes,
        null,
        true,
      )
    : "browser";
}
export function magicBody(
  form: PreparedMagicForm,
  fields: URLSearchParams,
  raw: Readonly<Record<string, string>>,
) {
  const values = record(raw);
  const result = new URLSearchParams(fields);
  if (
    !values ||
    Object.keys(values).some(
      (key) => !form.fields.some((control) => control.name === key),
    )
  )
    return null;
  for (const field of form.fields) {
    const value = Object.hasOwn(values, field.name)
      ? values[field.name]
      : field.value;
    if (
      typeof value !== "string" ||
      value.includes("\0") ||
      (field.required && !value.trim()) ||
      (field.type !== "textarea" && /[\r\n]/.test(value)) ||
      (field.maxLength !== null && value.length > field.maxLength) ||
      (field.name === "tid" && !id(value)) ||
      (field.type === "number" && fromText(value) === null) ||
      (field.type === "choice" &&
        !field.choices.some((choice) => choice.value === value))
    )
      return null;
    result.set(field.name, value);
  }
  const terms = form.purchase;
  if (terms) {
    const count = fromText(result.get("magicnum") ?? "");
    if (!count || (terms.stock !== null && count > terms.stock)) return null;
    const cost = terms.unitPrice === null ? null : terms.unitPrice * count;
    const weight = terms.unitWeight === null ? null : terms.unitWeight * count;
    if (
      (cost !== null &&
        (!Number.isSafeInteger(cost) ||
          (terms.balance !== null && cost > terms.balance))) ||
      (weight !== null &&
        (!Number.isSafeInteger(weight) ||
          (terms.freeWeight !== null && weight > terms.freeWeight)))
    )
      return null;
  }
  return result;
}

export function magicResult(
  response: HostResponse,
  member: string,
  form: PreparedMagicForm,
  fields: URLSearchParams,
  legacy: boolean,
): MagicEffectResult {
  const { magicId, identifier } = form;
  const buy = form.operation === "buy";
  const result = (kind: "uncertain" | "used" | "purchased") => ({
    kind,
    magicId,
    identifier,
  });
  const page = answer(response);
  const failure = responseIssue(response, page.data);
  if (failure) return failure;
  if (response.status !== 200) return result("uncertain");
  const destination = (raw: unknown) => {
    if (homeRoute(raw, response.url, { mod: "magic", action: "mybox" }))
      return true;
    const url = href(raw, response.url);
    const target = url && new URL(url);
    return (
      !buy &&
      !!target &&
      target.pathname === "/forum.php" &&
      target.searchParams.get("mod") === "viewthread" &&
      id(target.searchParams.get("tid")) !== null &&
      target.searchParams.get("tid") === fields.get("tid")
    );
  };
  const data = page.data;
  if (data) {
    if (
      data.type !== "result" ||
      data.schema !== 13 ||
      numericId(data.uid) !== member ||
      !["message", "handle"].includes(string(data.kind))
    )
      return result("uncertain");
    const key = string(data.message_key);
    const message = label(documentFrom(string(data.message)));
    if (data.ok === 0 || data.alert === "error")
      return {
        kind: "refused",
        ...(key && { code: key }),
        ...(message && { message }),
      };
    if (data.url && !destination(data.url)) return result("uncertain");
    if (data.ok === 1 && buy && key === "magics_buy_succeed")
      return result("purchased");
    if (
      data.ok === 1 &&
      !buy &&
      data.kind === "handle" &&
      data.handlekey === "magics" &&
      !!message
    )
      return result("used");
    return result("uncertain");
  }
  if (legacy) {
    const success =
      /\bsucceedhandle_magics\(\s*'([^'\\]+)'\s*,\s*'([^'\\]+)'/.exec(
        page.html,
      );
    if (success && destination(success[1]))
      return result(buy ? "purchased" : "used");
    const refused = /\berrorhandle_magics\(\s*'([^'\\]+)'/.exec(page.html);
    if (refused)
      return { kind: "refused", message: label(documentFrom(refused[1]!)) };
  }
  return result("uncertain");
}
