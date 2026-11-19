import {
  attr,
  children,
  controlDisabled,
  descendants,
  type Element,
} from "../html.js";
import { ancestor, bankId, bankRoute, bankText, has } from "./protocol.js";
import type {
  BankField,
  BankForm,
  BankInput,
  BankOperation,
  BankServicePage,
  BankValues,
} from "./types.js";

export interface OfferedForm {
  form: BankForm;
  url: string;
  fixed: URLSearchParams;
}
const operations = {
  "open-account": {
    service: "lobby",
    action: "open",
    op: "",
    names: ["bankpass", "bankpass2"],
  },
  "close-account": {
    service: "account",
    action: "pas",
    op: "cl",
    names: ["bankpass"],
  },
  "deposit-current": {
    service: "savings",
    action: "cur",
    op: "in",
    names: ["banknum", "bankpass"],
  },
  "withdraw-current": {
    service: "savings",
    action: "cur",
    op: "out",
    names: ["banknum", "bankpass"],
  },
  "settle-interest": { service: "savings", action: "cur", op: "ok", names: [] },
  "deposit-fixed": {
    service: "fixed",
    action: "fix",
    op: "in",
    names: ["banknum", "daynum", "bankpass"],
  },
  "withdraw-fixed": {
    service: "fixed",
    action: "fix",
    op: "out",
    names: ["bankpass"],
  },
  transfer: {
    service: "transfer",
    action: "chg",
    op: "ok",
    names: ["banknum", "touser", "bankpass"],
  },
  "change-password": {
    service: "account",
    action: "pas",
    op: "cg",
    names: ["bankpass", "newbankpass", "newbankpass2"],
  },
  "apply-loan": {
    service: "loans",
    action: "len",
    op: "try",
    names: ["banknum", "daynum", "bankpass"],
  },
} as const;
const inputKinds: Record<BankInput, BankField["type"]> = {
  banknum: "amount",
  daynum: "days",
  touser: "recipient",
  bankpass: "password",
  bankpass2: "password",
  newbankpass: "password",
  newbankpass2: "password",
};
export const integer = (raw: unknown): raw is string =>
  typeof raw === "string" && /^[1-9][0-9]{0,17}$/.test(raw);
function inspect(native: Element, page: BankServicePage): OfferedForm[] | null {
  const target = bankRoute(attr(native, "action"), page.url);
  if (
    !target ||
    attr(native, "method").toLowerCase() !== "post" ||
    (attr(native, "enctype") &&
      attr(native, "enctype") !== "application/x-www-form-urlencoded")
  )
    return null;
  const fixed = new URLSearchParams();
  const visible = new Map<BankInput, Element>();
  const radios: string[] = [];
  let submit: Element | null = null;
  for (const control of descendants(native, (node) =>
    ["input", "select", "textarea", "button"].includes(node.tagName),
  )) {
    const name = attr(control, "name");
    const type =
      attr(control, "type").toLowerCase() ||
      (control.tagName === "button" ? "submit" : "text");
    const value = attr(control, "value");
    if (
      controlDisabled(control) ||
      has(control, "readonly") ||
      ["form", "formaction", "formmethod", "formenctype"].some((key) =>
        has(control, key),
      )
    )
      return null;
    if (page.kind === "transfer" && name === "taxcheck" && type === "button")
      continue;
    if (
      name === "banksubmit" &&
      type === "submit" &&
      ["button", "input"].includes(control.tagName)
    ) {
      if (submit || value !== "true") return null;
      submit = control;
    } else if (control.tagName === "input" && type === "hidden") {
      if (
        !["bankid", "action", "op", "noid", "fixid", "formhash"].includes(name) ||
        !value ||
        fixed.has(name) ||
        /[\0\r\n]/.test(value)
      )
        return null;
      if (name === "formhash" && !/^[\w-]{1,128}$/.test(value)) return null;
      fixed.set(name, value);
    } else if (
      control.tagName === "input" &&
      type === "radio" &&
      name === "op"
    ) {
      radios.push(value);
    } else if (control.tagName === "input" && Object.hasOwn(inputKinds, name)) {
      const key = name as BankInput;
      const expectedType = inputKinds[key];
      if (
        visible.has(key) ||
        (expectedType === "password"
          ? type !== "password" || value !== ""
          : !["text", "number"].includes(type))
      )
        return null;
      visible.set(key, control);
    } else return null;
  }
  if (!submit || !page.bankId || fixed.get("bankid") !== page.bankId)
    return null;
  const inlineId = fixed.get("fixid");
  const recordId = inlineId ?? fixed.get("noid");
  if ((inlineId && fixed.has("noid")) || (recordId !== null && !bankId(recordId)))
    return null;
  const label =
    children(submit)
      .map((node) => bankText(node))
      .join(" ")
      .trim() || attr(submit, "value");
  const context =
    page.kind === "fixed" && fixed.has("noid") && fixed.get("op") === "out"
      ? bankText(native, (node) => node.tagName === "a")
          .replace(/\s*(?:银行|銀行)?密[码碼]\s*[:：]?\s*$/, "")
          .trim()
      : page.kind === "savings" && fixed.get("op") === "ok"
        ? bankText(native)
        : bankText(
            ancestor(native, (node) => node.tagName === "tr") ?? undefined,
            (node) => node.tagName === "form",
          );
  if (inlineId) {
    const row = ancestor(native, (node) => node.tagName === "tr");
    const recordTable = row && ancestor(row, (node) => node.tagName === "table");
    if (!recordTable || attr(recordTable, "id") !== "ttt" || !context || !/取/.test(label))
      return null;
  }
  const choices = (
    Object.entries(operations) as [
      BankOperation,
      (typeof operations)[BankOperation],
    ][]
  ).filter(([operation, shape]) => {
    if (
      shape.service !== page.kind ||
      fixed.get("action") !== shape.action ||
      (operation === "withdraw-fixed") !== Boolean(recordId) ||
      shape.names.length !== visible.size ||
      !shape.names.every((name) => visible.has(name))
    )
      return false;
    if (operation === "deposit-current" || operation === "withdraw-current") {
      return (
        !fixed.has("op") &&
        radios.length === 2 &&
        radios.includes("in") &&
        radios.includes("out")
      );
    }
    return radios.length === 0 && (fixed.get("op") ?? "") === shape.op;
  });
  if (!choices.length) return null;
  return choices.map(([operation, shape]) => {
    const fields = [...visible].map(([name, control]): BankField => {
      const type = inputKinds[name];
      const max = attr(control, "maxlength");
      const maxLength = /^\d{1,6}$/.test(max)
        ? Number(max)
        : type === "recipient"
          ? 100
          : null;
      const defaultMin =
        type === "amount"
          ? operation === "transfer"
            ? "10"
            : "1"
          : type === "days"
            ? operation === "deposit-fixed"
              ? "30"
              : "1"
            : null;
      const minimum = attr(control, "min");
      const min =
        defaultMin && integer(minimum) && BigInt(minimum) > BigInt(defaultMin)
          ? minimum
          : defaultMin;
      return Object.freeze({ name, type, min, maxLength });
    });
    const body = new URLSearchParams(fixed);
    if (radios.length) body.set("op", shape.op);
    return {
      form: Object.freeze({
        operation,
        bankId: page.bankId!,
        recordId,
        label,
        context,
        fields: Object.freeze(fields),
      }),
      url: target.href,
      fixed: body,
    };
  });
}
export function readForms(table: Element, page: BankServicePage) {
  const offers: OfferedForm[] = [];
  let unsupported = false;
  for (const form of descendants(
    table,
    (node) =>
      node.tagName === "form" &&
      descendants(node, (child) => attr(child, "name") === "banksubmit")
        .length > 0,
  )) {
    const candidates = page.currency && inspect(form, page);
    if (candidates) offers.push(...candidates);
    else unsupported = true;
  }
  const duplicates = new Set(
    offers
      .filter((offer, index) =>
        offers.some(
          (other, next) =>
            index !== next &&
            other.form.operation === offer.form.operation &&
            other.form.recordId === offer.form.recordId,
        ),
      )
      .map((offer) => offer.form),
  );
  return {
    offers: offers.filter((offer) => !duplicates.has(offer.form)),
    unsupported: unsupported || duplicates.size > 0,
  };
}
export function sameForm(original: OfferedForm, fresh: OfferedForm) {
  const key = (offer: OfferedForm) =>
    [...offer.fixed.entries()].filter(([name]) => name !== "formhash").sort();
  return (
    original.url === fresh.url &&
    JSON.stringify(original.form) === JSON.stringify(fresh.form) &&
    JSON.stringify(key(original)) === JSON.stringify(key(fresh))
  );
}
export function formBody(offer: OfferedForm, values: BankValues) {
  if (!values || typeof values !== "object" || Array.isArray(values))
    return null;
  const { fields } = offer.form;
  if (
    Object.keys(values).length !== fields.length ||
    Object.keys(values).some(
      (name) => !fields.some((field) => field.name === name),
    )
  )
    return null;
  const result = new URLSearchParams(offer.fixed);
  for (const { name, type, min, maxLength } of fields) {
    const value = values[name];
    if (
      typeof value !== "string" ||
      !value ||
      /[\0\r\n]/.test(value) ||
      (maxLength !== null && value.length > maxLength)
    )
      return null;
    if (
      (type === "amount" || type === "days") &&
      (!integer(value) || (min !== null && BigInt(value) < BigInt(min)))
    )
      return null;
    if (type === "recipient" && (value !== value.trim() || value.length > 100))
      return null;
    if (
      (name === "bankpass2" && value !== values.bankpass) ||
      (name === "newbankpass2" && value !== values.newbankpass)
    )
      return null;
    result.set(name, value);
  }
  result.set("banksubmit", "true");
  return result;
}
