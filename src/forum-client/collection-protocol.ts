import { operationURL, scripts, token, unwrap } from "./account-forms.js";
import {
  collectionURL,
  field,
  hashField,
  find,
  all,
} from "./collection-pages.js";
import type {
  CollectionAddDialog,
  CollectionFailure,
} from "./collection-types.js";
import { positive } from "./discovery/shared.js";
import {
  attr,
  byId,
  controlDisabled,
  fragmentFrom,
  hasClass,
  label,
} from "./html.js";
import { numericId, object } from "./notice-transport.js";

export function collectionJSON(body: string): Record<string, unknown> | null {
  try {
    return object(JSON.parse(body));
  } catch {
    return null;
  }
}

const string = (value: unknown) => (typeof value === "string" ? value : "");
const quota = (value: unknown) => {
  const raw = numericId(value);
  return raw && Number.isSafeInteger(Number(raw)) ? Number(raw) : 0;
};
export const addQuery = { action: "edit", op: "addthread" };
export const createQuery = { action: "edit", op: "add" };

export function parseAddDialog(
  body: string,
  tid: string,
  uid: string,
  base: URL,
  v4: boolean,
):
  | CollectionFailure
  | {
      kind: "dialog";
      data: CollectionAddDialog;
      hash: string;
      fields: Record<string, string>;
    }
  | null {
  const data = collectionJSON(body);
  if (data?.login === 1 || data?.message_key === "login_before_enter_home")
    return { kind: "login" };
  if (data && numericId(data.uid) !== null && numericId(data.uid) !== uid)
    return { kind: "session-changed" };
  if (data?.error === "busy") return { kind: "rate-limited" };
  if (
    data &&
    ((data.form === "collection" && data.error === "message") ||
      (data.type === "result" && data.schema === 13 && data.kind !== "page"))
  ) {
    if (data.ok === 0 && string(data.message).trim())
      return { kind: "refused", message: string(data.message) };
    return null;
  }
  if (v4) {
    if (
      data?.type !== "form" ||
      data.form !== "collection" ||
      data.ok !== 1 ||
      data.schema !== 17 ||
      numericId(data.uid) !== uid ||
      positive(data.tid) !== tid ||
      !Array.isArray(data.collections) ||
      !Array.isArray(data.hook_fields) ||
      data.hook_fields.length ||
      !Array.isArray(data.unsupported) ||
      data.unsupported.length
    )
      return null;
    const submit = object(data.submit);
    const action = collectionURL(base, string(submit?.url), addQuery);
    const fields = object(submit?.fields);
    const lists = object(submit?.lists);
    const tids = lists?.["tids[]"];
    const hash = token(fields?.formhash);
    if (
      !action ||
      ![...action.searchParams.keys()].every((key) =>
        ["mod", "action", "op"].includes(key),
      ) ||
      submit?.method !== "POST" ||
      submit.enctype !== "application/x-www-form-urlencoded" ||
      !fields ||
      Object.keys(fields).some(
        (key) =>
          !["inajax", "handlekey", "formhash", "addthread"].includes(key),
      ) ||
      fields.inajax !== "1" ||
      fields.handlekey !== "k_collect" ||
      fields.addthread !== "1" ||
      !hash ||
      !lists ||
      Object.keys(lists).length !== 1 ||
      !Array.isArray(tids) ||
      tids.length !== 1 ||
      positive(tids[0]) !== tid
    )
      return null;
    const choices = data.collections.map((item) => {
      const choice = object(item);
      const id = positive(choice?.ctid);
      const name = string(choice?.name).trim();
      return id && name ? { id, name } : null;
    });
    if (
      choices.some((choice) => !choice) ||
      new Set(choices.map((choice) => choice?.id)).size !== choices.length
    )
      return null;
    const remainingCreate = quota(data.remain_create);
    const create = object(object(data.create)?.submit);
    const createURL = collectionURL(base, string(create?.url), createQuery);
    const createFields = object(create?.fields);
    const canCreate = Boolean(
      remainingCreate > 0 &&
      createURL &&
      [...createURL.searchParams.keys()].every((key) =>
        ["mod", "action", "op"].includes(key),
      ) &&
      create?.method === "POST" &&
      create.enctype === "application/x-www-form-urlencoded" &&
      createFields?.formhash === hash &&
      createFields.collectionsubmit === "1" &&
      createFields.submitcollection === "1" &&
      Object.keys(createFields).length === 3,
    );
    return {
      kind: "dialog",
      data: {
        kind: "add-dialog",
        threadId: tid,
        choices: choices.filter((choice) => choice !== null),
        remainingCreate,
        canCreate,
      },
      hash,
      fields: {
        inajax: "1",
        handlekey: "k_collect",
        formhash: hash,
        addthread: "1",
        "tids[0]": tid,
      },
    };
  }
  const html = unwrap(
    data?.type === "result" && data.schema === 13 && data.kind === "page"
      ? string(data.document)
      : body,
  );
  const doc = fragmentFrom(html);
  const form = byId(doc, "form_addcollectionthread");
  if (!form) return legacyFailure(html, base, ["k_collect"]) ?? null;
  const action = collectionURL(base, attr(form, "action"), addQuery);
  const tids = all(
    form,
    (n) => attr(n, "name") === "tids[]" && !controlDisabled(n),
  );
  const hash = hashField(form);
  if (
    !action ||
    ![...action.searchParams.keys()].every((key) =>
      ["mod", "action", "op"].includes(key),
    ) ||
    attr(form, "method").toLowerCase() !== "post" ||
    !hash ||
    tids.length !== 1 ||
    !tids[0] ||
    attr(tids[0], "value") !== tid ||
    attr(field(form, "addthread") ?? form, "value") !== "1"
  )
    return null;
  const select = find(
    form,
    (n) =>
      n.tagName === "select" &&
      attr(n, "name") === "ctid" &&
      !controlDisabled(n),
  );
  const choices = all(
    select,
    (n) => n.tagName === "option" && !controlDisabled(n),
  ).flatMap((n) => {
    const id = positive(attr(n, "value"));
    return id && label(n) ? [{ id, name: label(n) }] : [];
  });
  const remainingCreate = quota(
    scripts(body).match(/\bremaincreateable\s*=\s*(\d+)\s*;/)?.[1] ??
      scripts(html).match(/\bremaincreateable\s*=\s*(\d+)\s*;/)?.[1],
  );
  if (
    (!select && !remainingCreate) ||
    new Set(choices.map((choice) => choice.id)).size !== choices.length
  )
    return null;
  return {
    kind: "dialog",
    data: {
      kind: "add-dialog",
      threadId: tid,
      choices,
      remainingCreate,
      canCreate: remainingCreate > 0,
    },
    hash,
    fields: {
      formhash: hash,
      addthread: "1",
      handlekey: "k_collect",
      "tids[0]": tid,
    },
  };
}

const verdicts = {
  create: ["collection_create_succ", "createcollection"],
  edit: ["collection_edit_succ", "editcollection"],
  delete: ["collection_delete_succ", "deletecollection"],
  add: ["collection_collect_succ", "k_collect"],
  remove: ["collection_remove_thread", "delthread"],
  comment: ["collection_comment_succ", "addComment", "k_addComment"],
  follow: ["collection_follow_succ", "followcollection"],
  unfollow: ["collection_unfollow_succ", "followcollection"],
} as const;
type Operation = keyof typeof verdicts;
export interface EffectTarget {
  operation: Operation;
  id?: string;
  threadIds?: readonly string[];
  collectionIds?: readonly string[];
  structuredOnly?: boolean;
}

type Receipt =
  | { kind: "accepted"; message: string; id?: string }
  | CollectionFailure
  | { kind: "uncertain" };
const uncertain = { kind: "uncertain" } as const;
const unescape = (value: string) => value.replace(/\\(['"\\])/g, "$1");

function legacyFailure(
  html: string,
  base: URL,
  keys: readonly string[],
): CollectionFailure | undefined {
  const doc = fragmentFrom(html);
  if (
    find(
      doc,
      (n) =>
        n.tagName === "a" &&
        Boolean(
          operationURL(attr(n, "href"), base, "/member.php", {
            mod: "logging",
            action: "login",
          }),
        ),
    )
  )
    return { kind: "login" };
  const system = byId(doc, "container");
  const heading = find(system, (n) => n.tagName === "h1");
  const error =
    find(doc, (n) => hasClass(n, "alert_error")) ??
    (label(heading) === "Discuz! System Error"
      ? find(
          find(system, (n) => hasClass(n, "info")),
          (n) => n.tagName === "li",
        )
      : undefined);
  const match = [
    ...scripts(html).matchAll(
      /\berrorhandle_(\w+)\(\s*'((?:[^'\\]|\\.)*)'(?:,\s*\{([^}]*)\})?/g,
    ),
  ].find((m) => keys.includes(m[1] ?? ""));
  const wait = quota(match?.[3]?.match(/'waittime'\s*:\s*'(\d+)'/)?.[1]);
  const message = match?.[2] ? unescape(match[2]) : label(error);
  if (wait) return { kind: "rate-limited", message, retryAfterSeconds: wait };
  return message ? { kind: "refused", message } : undefined;
}

export function decodeCollectionReceipt(
  body: string,
  base: URL,
  uid: string,
  target: EffectTarget,
): Receipt {
  const [key, ...handlers] = verdicts[target.operation];
  const data = collectionJSON(body);
  let url: string;
  let message: string;
  let values: Record<string, unknown>;
  if (data) {
    if (
      data.type !== "result" ||
      data.schema !== 13 ||
      !["handle", "message", "redirect"].includes(string(data.kind))
    )
      return uncertain;
    if (data.login === 1 && data.message_key === "login_before_enter_home")
      return { kind: "login" };
    if (numericId(data.uid) !== uid) return uncertain;
    message = string(data.message);
    values = object(data.values) ?? {};
    if (data.ok === 0 || data.alert === "error") {
      if (data.message_key === "operating_too_fast") {
        const wait = quota(values.waittime);
        return {
          kind: "rate-limited",
          message,
          ...(wait && { retryAfterSeconds: wait }),
        };
      }
      return message ? { kind: "refused", message } : uncertain;
    }
    if (data.ok !== 1 || data.message_key !== key || data.login !== 0)
      return uncertain;
    url = string(data.url);
  } else {
    const html = unwrap(body);
    const failure = legacyFailure(html, base, handlers);
    if (failure) return failure;
    if (target.structuredOnly || html === body) return uncertain;
    const successes = [
      ...scripts(html).matchAll(
        /\bsucceedhandle_(\w+)\(\s*'((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'(?:,\s*\{([^}]*)\})?\s*\)/g,
      ),
    ];
    const [match] = successes;
    if (
      successes.length !== 1 ||
      !match ||
      !handlers.some((handler) => handler === match[1])
    )
      return uncertain;
    url = unescape(match[2] ?? "");
    message = unescape(match[3] ?? "");
    values = Object.fromEntries(
      [...(match[4] ?? "").matchAll(/'(\w+)'\s*:\s*'((?:[^'\\]|\\.)*)'/g)].map(
        (m) => [m[1], unescape(m[2] ?? "")],
      ),
    );
  }
  let destination: URL | null = null;
  if (url) {
    try {
      destination = new URL(url, base);
    } catch {
      return uncertain;
    }
    const keys = [...destination.searchParams.keys()];
    if (
      destination.origin !== base.origin ||
      destination.username ||
      destination.password ||
      destination.hash ||
      new Set(keys).size !== keys.length
    )
      return uncertain;
  }
  const id = target.operation === "create" ? positive(values.ctid) : target.id;
  if (target.operation === "create" && !id) return uncertain;
  if (
    id &&
    ((values.ctid !== undefined && positive(values.ctid) !== id) ||
      (destination?.searchParams.has("ctid") &&
        destination.searchParams.get("ctid") !== id))
  )
    return uncertain;
  if (
    values.ctid !== undefined &&
    !id &&
    (target.collectionIds?.length !== 1 ||
      positive(values.ctid) !== target.collectionIds[0])
  )
    return uncertain;
  if (
    destination?.searchParams.has("ctid") &&
    !id &&
    (target.collectionIds?.length !== 1 ||
      destination.searchParams.get("ctid") !== target.collectionIds[0])
  )
    return uncertain;
  for (const value of [
    values.tid,
    destination?.searchParams.get("tid") ?? undefined,
  ]) {
    if (
      value !== undefined &&
      (target.threadIds?.length !== 1 ||
        positive(value) !== target.threadIds[0])
    )
      return uncertain;
  }
  if (
    ["create", "edit", "remove"].includes(target.operation) &&
    (!id || !collectionURL(base, url, { action: "view", ctid: id }))
  )
    return uncertain;
  if (target.operation === "delete" && !collectionURL(base, url, { op: "my" }))
    return uncertain;
  if (
    (target.operation === "follow" && numericId(values.status) !== "1") ||
    (target.operation === "unfollow" && numericId(values.status) !== "2")
  )
    return uncertain;
  return { kind: "accepted", message, ...(id && { id }) };
}
