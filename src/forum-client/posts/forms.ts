import { numericId, object } from "../notice-transport.js";
import { safeURL } from "../routes.js";

export const enabled = (value: unknown) => value === 1 || value === true;
export const positive = (value: unknown) => {
  const id = numericId(value);
  return id === "0" ? null : id;
};
export const scalar = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : null;

export function json(body: string) {
  try {
    return object(JSON.parse(body));
  } catch {
    return null;
  }
}

export function query(url: string, values: Record<string, string>) {
  const target = new URL(url);
  for (const [name, value] of Object.entries(values))
    target.searchParams.set(name, value);
  return target.href;
}

export const structured = (url: string) =>
  query(url, { tsdmapp: "json", nodoc: "1" });

export interface EditorTarget {
  boardId: string;
  threadId?: string;
  postId?: string;
}

export function editorURL(origin: string, target: EditorTarget) {
  return query(`${origin}/forum.php`, {
    mod: "post",
    action: target.threadId ? "edit" : "newthread",
    fid: target.boardId,
    ...(target.threadId && target.postId
      ? { tid: target.threadId, pid: target.postId }
      : {}),
  });
}

export function sameOrigin(raw: unknown, source: string) {
  const url = typeof raw === "string" && raw && safeURL(raw, source);
  return url && url.origin === new URL(source).origin ? url : null;
}

export function destination(
  raw: unknown,
  source: string,
  target: EditorTarget,
) {
  const url = sameOrigin(raw, source);
  if (!url || url.pathname !== "/forum.php" || url.hash) return null;
  const q = url.searchParams;
  if (
    [...q.keys()].some((key) => q.getAll(key).length !== 1) ||
    q.get("mod") !== "post" ||
    q.get("action") !== (target.threadId ? "edit" : "newthread") ||
    q.get(target.threadId ? "editsubmit" : "topicsubmit") !== "yes" ||
    q.has(target.threadId ? "topicsubmit" : "editsubmit") ||
    q.has("replysubmit") ||
    q.has("delete")
  )
    return null;
  if (!target.threadId && q.get("fid") !== target.boardId) return null;
  for (const [key, value] of [
    ["fid", target.boardId],
    ["tid", target.threadId],
    ["pid", target.postId],
  ] as const) {
    if (q.has(key) && q.get(key) !== value) return null;
  }
  return url;
}

export interface Limits {
  value: string;
  min?: number | undefined;
  max?: number | undefined;
  hardMax?: number | undefined;
  unit?: string | undefined;
  excludesQuote?: boolean;
}

function limits(value: unknown): Limits | null {
  const data = object(value);
  if (!data || typeof data.value !== "string") return null;
  const bound = (key: string) => {
    const raw = data[key];
    return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
      ? raw
      : undefined;
  };
  return {
    value: data.value,
    min: bound("min"),
    max: bound("max"),
    hardMax: bound("hard_max"),
    unit: scalar(data.unit) ?? undefined,
    excludesQuote: enabled(data.min_excludes_quote),
  };
}

export function validText(
  value: unknown,
  bounds: Limits,
  subject = false,
): value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\0\uD800-\uDFFF]/u.test(value) ||
    (subject && /[\r\n]/.test(value))
  )
    return false;
  const count = (input: string) =>
    bounds.unit === "dstrlen"
      ? [...input].reduce(
          (n, char) => n + (char.codePointAt(0)! > 127 ? 2 : 1),
          0,
        )
      : bounds.unit === "bytes"
        ? new TextEncoder().encode(input).length
        : [...input].length;
  const trimmed = value.trim();
  const minText = bounds.excludesQuote
    ? trimmed.replace(/\[quote(?:=[^\]]*)?\][\s\S]*?\[\/quote\]/gi, "").trim()
    : trimmed;
  const escaped = trimmed.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char]!,
  );
  return (
    count(minText) >= (bounds.min ?? 0) &&
    count(trimmed) <= (bounds.max || Infinity) &&
    (!bounds.hardMax || count(escaped) <= bounds.hardMax)
  );
}

export type Pair = [string, string];
export function safeFields(fields: Pair[]) {
  const names = new URLSearchParams(fields);
  return (
    !fields.some(
      ([name]) =>
        /^(?:delete|delpost|replysubmit)(?:$|\[)/i.test(name) ||
        (/^(?:fid|tid|pid|formhash|page|subject|message|save|cronpublish|cronpublishdate|topicsubmit|editsubmit|typeid)(?:$|\[)/i.test(
          name,
        ) &&
          (name.includes("[") || names.getAll(name).length !== 1)),
    ) &&
    (!names.has("save") || ["", "0"].includes(names.get("save")!))
  );
}

export interface Editor {
  url: string;
  fields: Pair[];
  subject: Limits | null;
  replySubject?: string | undefined;
  message: Limits;
  first: boolean;
  canSave: boolean;
  isDraft: boolean;
  canPublish: boolean;
  scheduleValue?: string | undefined;
  scheduledDate?: string | undefined;
  hooks: string[];
  categories: { id: string; label: string }[];
  categoryRequired: boolean;
}

function pairs(value: unknown): Pair[] | null {
  const data = object(value);
  if (!data) return null;
  const result: Pair[] = [];
  for (const [name, raw] of Object.entries(data)) {
    const value = scalar(raw);
    if (!name || value === null) return null;
    result.push([name, value]);
  }
  return result;
}

function suppliedInput(raw: unknown): Pair[] {
  const input = object(raw);
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.name ||
    enabled(input.disabled)
  )
    return [];
  const checkbox = input.type === "checkbox" || input.type === "radio";
  if (checkbox && !enabled(input.checked)) return [];
  const value = scalar(input.value);
  return value !== null || checkbox ? [[input.name, value ?? "on"]] : [];
}

export function structuredEditor(
  data: Record<string, unknown>,
  source: string,
  target: EditorTarget,
): Editor | null {
  const submit = object(data.submit);
  const to = destination(submit?.url, source, target);
  const fields = pairs(submit?.fields);
  const message = limits(data.message);
  const first = enabled(data.first);
  const subject =
    object(data.subject)?.shown === 0 ? null : limits(data.subject);
  const draft = object(data.draft);
  const thread = object(data.thread);
  if (
    !to ||
    submit?.method !== "POST" ||
    !fields ||
    !message ||
    (!target.threadId && !first) ||
    (first && !subject) ||
    data.action !== (target.threadId ? "edit" : "newthread") ||
    positive(data.fid) !== target.boardId ||
    positive(data.tid) !== (target.threadId ?? null) ||
    positive(data.pid) !== (target.postId ?? null) ||
    (target.threadId && positive(thread?.tid) !== target.threadId)
  )
    return null;
  const body = new URLSearchParams(fields);
  if (
    !body.get("formhash") ||
    (data.formhash != null && data.formhash !== body.get("formhash"))
  )
    return null;
  for (const [key, value] of [
    ["fid", target.boardId],
    ["tid", target.threadId],
    ["pid", target.postId],
  ] as const) {
    if (
      (body.has(key) && body.get(key) !== value) ||
      (key !== "fid" && value && !body.has(key) && !to.searchParams.has(key))
    )
      return null;
  }
  if (target.threadId && !body.has("fid") && !to.searchParams.has("fid"))
    return null;
  const options = Array.isArray(data.options) ? data.options : [];
  const inputs = (name: string) => {
    const value = object(data[name])?.inputs;
    return Array.isArray(value) ? value : [];
  };
  const schedule = inputs("cronpublish").map(object);
  const checkbox = schedule.find(
    (item) =>
      item?.name === "cronpublish" &&
      item.type === "checkbox" &&
      !enabled(item.disabled),
  );
  const date = schedule.find(
    (item) => item?.name === "cronpublishdate" && !enabled(item.disabled),
  );
  const types = object(data.types);
  const type = enabled(types?.locked) ? null : object(types?.input);
  const typeInput =
    type?.name === "typeid" && !enabled(type.disabled) ? type : null;
  const categories = (
    Array.isArray(typeInput?.choices) ? typeInput.choices : []
  ).flatMap((raw) => {
    const choice = object(raw);
    const id = positive(choice?.value);
    return id && !enabled(choice?.disabled) && typeof choice?.label === "string"
      ? [{ id, label: choice.label }]
      : [];
  });
  for (const raw of [
    typeInput,
    data.readperm,
    object(data.price)?.input,
    object(data.tags)?.input,
    data.stand,
    data.mygroup,
    ...options,
    ...inputs("replycredit"),
    ...inputs("rushreply"),
    ...schedule,
  ])
    fields.push(...suppliedInput(raw));
  const attachments = object(data.attach)?.fields;
  const attachmentFields = attachments == null ? [] : pairs(attachments);
  if (!attachmentFields) return null;
  fields.push(...attachmentFields);
  if (
    !safeFields(fields) ||
    fields.some(
      ([name, value]) =>
        (name === "fid" && value !== target.boardId) ||
        (name === "tid" && value !== target.threadId) ||
        (name === "pid" && value !== target.postId) ||
        (name === "formhash" && value !== body.get("formhash")),
    )
  )
    return null;
  const hooks: string[] = [];
  for (const group of Array.isArray(data.hook_fields) ? data.hook_fields : []) {
    const names = object(group)?.names;
    if (
      !Array.isArray(names) ||
      names.some((name) => typeof name !== "string" || !name)
    )
      return null;
    hooks.push(...names);
  }
  return {
    url: query(to.href, { tsdmapp: "json" }),
    fields,
    subject: first ? subject : null,
    replySubject: first ? undefined : subject?.value,
    message,
    first,
    canSave: enabled(draft?.can_save) && body.has("save"),
    isDraft: enabled(thread?.draft),
    canPublish: enabled(draft?.publish),
    scheduleValue:
      checkbox && date ? (scalar(checkbox.value) ?? "true") : undefined,
    scheduledDate:
      checkbox && enabled(checkbox.checked)
        ? (scalar(date?.value) ?? "")
        : undefined,
    hooks,
    categories,
    categoryRequired: enabled(types?.required) && !enabled(types?.locked),
  };
}

export function specialEditor(data: Record<string, unknown>) {
  const special = object(data.special);
  return (
    enabled(object(data.forum)?.allowspecialonly) ||
    [special?.current, special?.sortid, object(data.thread)?.special].some(
      (value) => value != null && value !== 0 && value !== "0" && value !== "",
    ) ||
    Boolean(special?.specialextra) ||
    (Array.isArray(data.unsupported) &&
      data.unsupported.some((name) => name !== "seccheck"))
  );
}
