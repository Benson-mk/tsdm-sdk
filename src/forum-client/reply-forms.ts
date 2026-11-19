import {
  attr,
  byId,
  controlDisabled,
  descendants,
  documentFrom,
  text,
} from "./html.js";
import { numericId, object } from "./notice-transport.js";
import { accountFrom } from "./read-thread.js";
import { verificationFields } from "./reply-verification.js";
import type { ReplyOption, ReplyOptionName } from "./replies.js";
import { safeURL } from "./routes.js";
import { parseReadPayload } from "./structured-read.js";
import type { HostResponse } from "./types.js";

export interface ReplyTarget {
  url: URL;
  boardId: string;
  threadId: string;
  quoteId: string | null;
}
const material: readonly ReplyOptionName[] = [
  "usesig",
  "htmlon",
  "parseurloff",
  "smileyoff",
  "bbcodeoff",
  "imgcontent",
];
export const positive = (value: unknown) => {
  const id = numericId(value);
  return id && id !== "0" ? id : null;
};
const formFields = [
  "formhash",
  "posttime",
  "wysiwyg",
  "noticeauthor",
  "noticetrimstr",
  "noticeauthormsg",
  "replysubmit",
  "save",
  "handlekey",
  "reppid",
  "reppost",
  "replyuid",
  ...material,
];
export const bit = (value: unknown) => value === 0 || value === 1;
function endpoint(destination: string, origin: string): URL | null {
  const value = safeURL(destination, origin + "/");
  if (!value) return null;
  const url = new URL(value);
  const q = url.searchParams;
  return url.origin === origin &&
    url.pathname === "/forum.php" &&
    !url.hash &&
    [...q.keys()].every((key) => q.getAll(key).length === 1)
    ? url
    : null;
}
export function replyTarget(
  destination: string,
  origin: string,
): ReplyTarget | null {
  const url = endpoint(destination, origin);
  if (!url) return null;
  const q = url.searchParams;
  const boardId = positive(q.get("fid")),
    threadId = positive(q.get("tid"));
  const quoteId = positive(q.get("reppost"));
  if (
    q.get("mod") !== "post" ||
    q.get("action") !== "reply" ||
    !boardId ||
    !threadId ||
    (q.has("reppost") && !quoteId) ||
    (q.has("replyuid") && (!quoteId || !positive(q.get("replyuid")))) ||
    [...q.keys()].some(
      (key) =>
        ![
          "mod",
          "action",
          "fid",
          "tid",
          "reppost",
          "replyuid",
          "page",
          "extra",
        ].includes(key),
    )
  )
    return null;
  return { url, boardId, threadId, quoteId };
}
function submission(value: unknown, target: ReplyTarget): URL | null {
  const url = typeof value === "string" && endpoint(value, target.url.origin);
  if (!url) return null;
  const q = url.searchParams;
  if (
    q.get("mod") !== "post" ||
    q.get("action") !== "reply" ||
    q.get("fid") !== target.boardId ||
    q.get("tid") !== target.threadId ||
    q.get("replysubmit") !== "yes" ||
    (q.has("reppost") && q.get("reppost") !== target.quoteId) ||
    (q.has("replyuid") &&
      q.get("replyuid") !== target.url.searchParams.get("replyuid")) ||
    (q.has("inajax") && q.get("inajax") !== "1") ||
    (q.has("tsdmapp") && q.get("tsdmapp") !== "json")
  )
    return null;
  return url;
}
export function addQuery(url: URL, key: string, value: string): URL {
  if (url.searchParams.has(key)) return url;
  return new URL(`${url.href}${url.search ? "&" : "?"}${key}=${value}`);
}
export function materialOptions(value: unknown) {
  if (!Array.isArray(value)) return null;
  const options: (ReplyOption & { value: string })[] = [];
  const names = new Set<string>();
  for (const raw of value) {
    const row = object(raw);
    if (
      !row ||
      typeof row.name !== "string" ||
      names.has(row.name) ||
      row.type !== "checkbox" ||
      !bit(row.checked) ||
      !bit(row.disabled) ||
      typeof row.value !== "string"
    )
      return null;
    names.add(row.name);
    const name = material.find((item) => item === row.name);
    if (!name) {
      if (row.name === "adddynamic" && row.checked === 0) continue;
      return null;
    }
    if (row.disabled === 0 && row.value !== "1") return null;
    options.push({
      name,
      value: row.value,
      label: typeof row.label === "string" ? row.label : name,
      checked: row.checked === 1,
      disabled: row.disabled === 1,
    });
  }
  return options;
}
function targetsQuote(fields: Record<string, string>, target: ReplyTarget) {
  if (target.quoteId) {
    return (
      fields.reppid === target.quoteId &&
      fields.reppost === target.quoteId &&
      Boolean(
        fields.noticeauthor && fields.noticeauthormsg && fields.noticetrimstr,
      )
    );
  }
  return (
    !fields.reppid &&
    !fields.reppost &&
    !fields.noticeauthor &&
    !fields.noticeauthormsg &&
    !fields.noticetrimstr &&
    !fields.replyuid
  );
}
export function structuredForm(
  data: Record<string, unknown>,
  target: ReplyTarget,
) {
  const submit = object(data.submit),
    fields = object(submit?.fields);
  const message = object(data.message),
    subject = object(data.subject);
  const action = submission(submit?.url, target);
  const options = materialOptions(data.options);
  const verification = verificationFields(data.seccheck);
  if (
    data.ok !== 1 ||
    data.action !== "reply" ||
    positive(data.fid) !== target.boardId ||
    positive(data.tid) !== target.threadId ||
    positive(object(data.thread)?.tid) !== target.threadId ||
    object(data.thread)?.special !== 0 ||
    submit?.method !== "POST" ||
    !action ||
    !fields ||
    !Object.values(fields).every((value) => typeof value === "string") ||
    !fields.formhash ||
    !options ||
    !message ||
    message.json !== 0 ||
    typeof message.value !== "string" ||
    !subject ||
    !bit(subject.shown) ||
    typeof subject.value !== "string" ||
    !Array.isArray(data.unsupported) ||
    data.unsupported.length ||
    !Array.isArray(data.hook_fields) ||
    data.hook_fields.length ||
    !verification
  )
    return null;
  const supplied = fields as Record<string, string>;
  if (
    !targetsQuote(supplied, target) ||
    Object.keys(supplied).some((key) => !formFields.includes(key)) ||
    supplied.save ||
    (supplied.replyuid !== undefined &&
      supplied.replyuid !== target.url.searchParams.get("replyuid"))
  )
    return null;
  for (const name of material) {
    const fixed = supplied[name];
    if (fixed === undefined) continue;
    if (
      (fixed !== "0" && fixed !== "1") ||
      options.some((option) => option.name === name)
    )
      return null;
    options.push({
      name,
      value: "1",
      label: name,
      disabled: true,
      checked: fixed === "1",
    });
  }
  return {
    action,
    fields: supplied,
    options,
    verification,
    message: message.value,
    subject: subject.shown === 1 ? subject.value : null,
  };
}
export function nativeDocument(body: string): ReturnType<typeof documentFrom> {
  const inner =
    /^\s*(?:<\?xml[^?]*\?>\s*)?<root>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/root>\s*$/.exec(
      body,
    )?.[1];
  return documentFrom(inner ?? body);
}
export function nativeForm(
  response: HostResponse,
  target: ReplyTarget,
  memberId: string,
): NonNullable<ReturnType<typeof structuredForm>> | null {
  const payload = parseReadPayload(response);
  if (
    payload &&
    (typeof payload.document !== "string" ||
      (payload.uid !== undefined && positive(payload.uid) !== memberId))
  )
    return null;
  const source =
    typeof payload?.document === "string"
      ? (typeof payload.head === "string" ? payload.head : "") +
        payload.document
      : response.body;
  const doc = nativeDocument(source);
  const account = accountFrom(doc, response.url);
  if (
    account.kind === "guest" ||
    (account.kind === "member" && account.id !== memberId) ||
    (account.kind === "unknown" && positive(payload?.uid) !== memberId)
  )
    return null;
  if (
    byId(doc, "challenge-form") ||
    byId(doc, "cf-challenge-running") ||
    byId(doc, "messagetext")
  )
    return null;
  const forms = descendants(
    doc,
    (node) => node.tagName === "form" && attr(node, "id") === "postform",
  );
  const form = forms.length === 1 ? forms[0] : undefined;
  if (!form || attr(form, "method").toLowerCase() !== "post") return null;
  const action = submission(attr(form, "action"), target);
  if (
    !action ||
    descendants(form, (node) =>
      /^(sec(?:code|qaa)|secanswer)/i.test(
        attr(node, "id") || attr(node, "name"),
      ),
    ).length ||
    /\bupdate(?:seccode|secqaa)\s*\(/i.test(source)
  )
    return null;
  const fields: Record<string, string> = Object.create(null);
  const rows: unknown[] = [];
  const names = new Set<string>();
  let subject: string | null = null,
    message: string | null = null;
  for (const node of descendants(form, (item) =>
    ["input", "select", "textarea", "button"].includes(item.tagName),
  )) {
    const name = attr(node, "name"),
      type = attr(node, "type").toLowerCase(),
      value = attr(node, "value");
    if (!name || controlDisabled(node)) continue;
    if (names.has(name) || attr(node, "form")) return null;
    names.add(name);
    if (
      name === "subject" &&
      node.tagName === "input" &&
      (!type || type === "text")
    )
      subject = value;
    else if (name === "message" && node.tagName === "textarea")
      message = text(node);
    else if (node.tagName === "input" && type === "checkbox") {
      rows.push({
        name,
        type,
        value,
        disabled: 0,
        checked: Number(node.attrs.some((a) => a.name === "checked")),
      });
    } else if (
      formFields.includes(name) &&
      ((node.tagName === "input" && type === "hidden") ||
        (name === "replysubmit" && type === "submit"))
    )
      fields[name] = value;
    else return null;
  }
  for (const name of material) {
    if (fields[name] === undefined) continue;
    if (fields[name] !== "1" && fields[name] !== "0") return null;
    rows.push({
      name,
      type: "checkbox",
      value: "1",
      disabled: 1,
      checked: Number(fields[name]),
    });
  }
  const options = materialOptions(rows);
  if (
    message === null ||
    !options ||
    !fields.formhash ||
    fields.save ||
    !targetsQuote(fields, target) ||
    (fields.replyuid !== undefined &&
      fields.replyuid !== target.url.searchParams.get("replyuid"))
  )
    return null;
  return { action, fields, options, verification: [], message, subject };
}
