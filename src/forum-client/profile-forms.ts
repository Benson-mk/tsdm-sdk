import { operationURL, token } from "./account-forms.js";
import {
  attr,
  controlDisabled,
  descendants,
  label,
  text,
  type Element,
  type Node,
} from "./html.js";
import type { SettingsField } from "./profile-client.js";

export const profileTabs = ["info", "base", "contact", "edu", "work"];
export type Fields = [string, string][];
export interface Form {
  action: URL;
  fixed: Fields;
  groups: SettingsField[][];
  multipart: boolean;
  representation: "native" | "structured" | "v4";
}
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function fixedFields(input: unknown): Fields | null {
  const fields: Fields = [];
  for (const [key, value] of Object.entries(record(input))) {
    if (
      !nameOK(key) ||
      (typeof value !== "string" && typeof value !== "number")
    )
      return null;
    fields.push([key, String(value)]);
  }
  return fields;
}
const has = (node: Element, name: string) =>
  node.attrs.some((item) => item.name === name);
const nameOK = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z_][\w]*(?:\[[\w]+\])*$/.test(value);
const hashOK = (fields: Fields) =>
  fields.filter(([key]) => key === "formhash").length === 1 &&
  fields.some(([key, value]) => key === "formhash" && token(value));

function structuredField(value: unknown, title: string): SettingsField | null {
  const item = record(value);
  if (!nameOK(item.name) || typeof item.value !== "string") return null;
  if (["text", "textarea"].includes(String(item.type)))
    return { name: item.name, label: title, kind: "text", value: item.value };
  if (
    !Array.isArray(item.choices) ||
    !["select", "radio"].includes(String(item.type))
  )
    return null;
  const choices = item.choices.map(record);
  if (
    !choices.length ||
    choices.some(
      (choice) =>
        typeof choice.value !== "string" || typeof choice.label !== "string",
    )
  )
    return null;
  return {
    name: item.name,
    label: title,
    kind: "choice",
    value: item.value,
    choices: choices.map((choice) => ({
      value: String(choice.value),
      label: String(choice.label),
    })),
  };
}

export function profileForm(
  data: Record<string, unknown>,
  base: URL,
  signature: boolean,
): Form | null {
  if (
    data.ok !== 1 ||
    data.type !== "form" ||
    data.schema !== 17 ||
    data.form !== "profile" ||
    data.vid !== 0 ||
    typeof data.op !== "string" ||
    !profileTabs.includes(data.op) ||
    !Array.isArray(data.hook_fields) ||
    data.hook_fields.length ||
    !Array.isArray(data.unsupported) ||
    data.unsupported.length
  )
    return null;
  const submit = record(data.submit);
  const action = operationURL(String(submit.url ?? ""), base, "/home.php", {
    mod: "spacecp",
    ac: "profile",
    op: data.op,
  });
  const fixed = fixedFields(submit.fields);
  if (
    !action ||
    submit.method !== "POST" ||
    submit.enctype !== "multipart/form-data" ||
    !fixed ||
    !hashOK(fixed)
  )
    return null;
  const sig = record(data.signature);
  const signatureField = structuredField(sig.input, "Signature");
  if (signature) {
    if (signatureField?.name !== "sightml") return null;
    return {
      action,
      fixed,
      groups: [[signatureField]],
      multipart: true,
      representation: "structured",
    };
  }
  if (!Array.isArray(data.fields)) return null;
  const groups: SettingsField[][] = [];
  for (const entry of data.fields.map(record)) {
    const title = typeof entry.title === "string" ? entry.title : "";
    const items = [
      ...(entry.unchangeable === 1 || !Array.isArray(entry.inputs)
        ? []
        : entry.inputs),
      ...(entry.privacy ? [entry.privacy] : []),
    ];
    const group = items.map((item) => structuredField(item, title));
    if (group.some((item) => !item)) continue;
    if (group.length) groups.push(group as SettingsField[]);
  }
  for (const [source, title] of [
    [data.customstatus, "Custom status"],
    [data.timeoffset, "Time zone"],
  ] as const) {
    const field = structuredField(source, title);
    if (field) groups.push([field]);
  }
  return groups.length
    ? { action, fixed, groups, multipart: true, representation: "structured" }
    : null;
}

export function privacyFilter(
  data: Record<string, unknown>,
  base: URL,
): Form | null {
  if (
    data.ok !== 1 ||
    data.type !== "privacy_filter" ||
    data.schema !== 55 ||
    !Array.isArray(data.hook_fields) ||
    data.hook_fields.length
  )
    return null;
  const submit = record(data.submit);
  const action = operationURL(String(submit.url ?? ""), base, "/home.php", {
    mod: "spacecp",
    ac: "privacy",
    op: "filter",
  });
  const fixed = fixedFields(submit.fields);
  if (
    !action ||
    submit.method !== "POST" ||
    submit.enctype !== "application/x-www-form-urlencoded" ||
    !fixed ||
    !hashOK(fixed)
  )
    return null;
  const groups: SettingsField[][] = [];
  for (const key of ["groups", "feeds", "notices"]) {
    const rows = data[key];
    if (!Array.isArray(rows)) return null;
    for (const row of rows.map(record)) {
      const category =
        key === "groups" ? "gid" : key === "feeds" ? "icon" : "note";
      if (
        !nameOK(row.field) ||
        !row.field.startsWith(`privacy[filter_${category}][`) ||
        typeof row.value !== "string" ||
        (key === "groups" && row.checked !== 0 && row.checked !== 1)
      )
        return null;
      groups.push([
        {
          kind: "toggle",
          name: row.field,
          label: String(row.name ?? row.field),
          value: key !== "groups" || row.checked === 1,
          checkedValue: row.value,
        },
      ]);
    }
  }
  return groups.length
    ? { action, fixed, groups, multipart: false, representation: "v4" }
    : null;
}
function nativeField(node: Element, form: Element): SettingsField | null {
  const name = attr(node, "name");
  if (!nameOK(name)) return null;
  const title =
    label(
      descendants(
        form,
        (item) =>
          item.tagName === "label" &&
          Boolean(attr(node, "id")) &&
          attr(item, "for") === attr(node, "id"),
      )[0],
    ) || name;
  if (node.tagName === "textarea")
    return { kind: "text", name, label: title, value: text(node) };
  if (node.tagName === "select") {
    if (has(node, "multiple")) return null;
    const opts = descendants(
      node,
      (item) => item.tagName === "option" && !controlDisabled(item),
    );
    const choices = opts.map((option) => ({
      value: has(option, "value") ? attr(option, "value") : label(option),
      label: label(option),
    }));
    const selected = opts.findLastIndex((option) => has(option, "selected"));
    const choice = choices[Math.max(0, selected)];
    return choice
      ? { kind: "choice", name, label: title, value: choice.value, choices }
      : null;
  }
  const type = attr(node, "type").toLowerCase() || "text";
  if (type === "checkbox")
    return {
      kind: "toggle",
      name,
      label: title,
      value: has(node, "checked"),
      checkedValue: has(node, "value") ? attr(node, "value") : "on",
    };
  if (["text", "url", "email", "number"].includes(type))
    return { kind: "text", name, label: title, value: attr(node, "value") };
  return null;
}

export function nativeForm(
  doc: Node,
  base: URL,
  ac: "profile" | "privacy" | "avatar",
  op?: string,
): Form | null {
  const query = { mod: "spacecp", ac, ...(op ? { op } : {}) };
  for (const form of descendants(
    doc,
    (node) =>
      node.tagName === "form" && attr(node, "method").toLowerCase() === "post",
  )) {
    if (ac === "profile" && attr(form, "target") !== "frame_profile") continue;
    if (ac === "avatar" && attr(form, "id") !== "headform") continue;
    const action = operationURL(attr(form, "action"), base, "/home.php", query);
    if (
      !action ||
      (ac === "profile" &&
        !profileTabs.includes(action.searchParams.get("op") ?? ""))
    )
      continue;
    const fixed: Fields = [];
    const groups: SettingsField[][] = [];
    let submit = "";
    for (const field of descendants(
      form,
      (node) =>
        ["select", "textarea", "input", "button"].includes(node.tagName) &&
        !controlDisabled(node),
    )) {
      const name = attr(field, "name");
      const type = attr(field, "type").toLowerCase();
      if (
        type === "hidden" ||
        type === "submit" ||
        (field.tagName === "button" && !type)
      ) {
        if (!nameOK(name)) return null;
        if (type !== "hidden") {
          if (submit) return null;
          submit = name;
        }
        fixed.push([name, has(field, "value") ? attr(field, "value") : "true"]);
        continue;
      }
      const item = nativeField(field, form);
      if (!item || (ac === "privacy" && item.kind === "text")) return null;
      groups.push([item]);
    }
    if (!groups.length || !hashOK(fixed)) return null;
    const expected =
      ac === "profile"
        ? "profilesubmitbtn"
        : ac === "avatar"
          ? "headsubmit"
          : op === "filter"
            ? "privacy2submit"
            : op === "other"
              ? "privacy3submit"
              : "privacysubmit";
    if (!fixed.some(([name, value]) => name === expected && value)) return null;
    if (ac !== "profile")
      return {
        action,
        fixed,
        groups,
        multipart: false,
        representation: "native",
      };
    if (attr(form, "enctype").toLowerCase() !== "multipart/form-data")
      return null;
    const cells = new Map<string, SettingsField[]>();
    for (const [field] of groups) {
      if (!field) continue;
      const name = /^privacy\[([^\]]+)\]$/.exec(field.name)?.[1] ?? field.name;
      const key = ["birthyear", "birthmonth", "birthday"].includes(name)
        ? "birthday"
        : name;
      const cell = cells.get(key) ?? [];
      cell.push(field);
      cells.set(key, cell);
    }
    return {
      action,
      fixed,
      groups: [...cells.values()],
      multipart: true,
      representation: "native",
    };
  }
  return null;
}

export function settingsBody(
  form: Form,
  changes: Readonly<Record<string, string | boolean>>,
  entireTab: boolean,
): Fields | null {
  const fields = new Map(
    form.groups.flat().map((field) => [field.name, field]),
  );
  const entries = Object.entries(changes);
  if (
    !entries.length ||
    entries.some(([name, value]) => {
      const field = fields.get(name);
      if (!field) return true;
      if (field.kind === "toggle") return typeof value !== "boolean";
      if (typeof value !== "string") return true;
      return (
        field.kind === "choice" &&
        !field.choices.some((choice) => choice.value === value)
      );
    })
  )
    return null;
  const pairs: Fields = [...form.fixed];
  for (const group of form.groups) {
    if (
      !entireTab &&
      !group.some((field) => Object.hasOwn(changes, field.name))
    )
      continue;
    for (const field of group) {
      const value = Object.hasOwn(changes, field.name)
        ? changes[field.name]
        : field.value;
      if (field.kind === "toggle") {
        if (value === true) pairs.push([field.name, field.checkedValue]);
      } else if (typeof value === "string") pairs.push([field.name, value]);
    }
  }
  return pairs;
}
